"""PhantomTrace - Flask backend: veri alımı, snapshot kaydı, delta (fark) hesabı, dashboard."""
import json
import os
from datetime import datetime

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, url_for
from flask_cors import CORS
from sqlalchemy.exc import SQLAlchemyError

from models import Profile, Snapshot, SnapshotEntry, db

ALLOWED_ORIGINS = ["https://www.instagram.com", "https://instagram.com"]


def create_app():
    app = Flask(__name__)
    base_dir = os.path.abspath(os.path.dirname(__file__))
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(base_dir, "phantomtrace.db")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # büyük listeler için
    app.config["SECRET_KEY"] = os.environ.get("PT_SECRET", os.urandom(16).hex())

    CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}})
    db.init_app(app)
    with app.app_context():
        db.create_all()

    # ---------------------------------------------------------------- yardımcılar
    def clean_users(raw):
        """Gelen listeyi {user_id: (username, full_name)} sözlüğüne çevirir. Liste yoksa None."""
        if raw is None:
            return None
        if not isinstance(raw, list):
            raise ValueError("Liste alanı dizi (array) olmalı")
        out = {}
        for u in raw:
            if not isinstance(u, dict):
                continue
            uid = str(u.get("id") or u.get("pk") or "").strip()
            uname = str(u.get("username") or "").strip()
            if uid and uname:
                out[uid] = (uname[:64], str(u.get("full_name") or "")[:200])
        return out

    def ingest(payload):
        """Payload'ı doğrular, profili bulur/oluşturur ve yeni bir snapshot kaydeder."""
        if not isinstance(payload, dict):
            raise ValueError("Geçersiz JSON gövdesi")
        prof = payload.get("profile") or {}
        ig_id = str(prof.get("id") or "").strip()
        username = str(prof.get("username") or "").strip()
        if not ig_id or not username:
            raise ValueError("profile.id ve profile.username zorunludur")

        followers = clean_users(payload.get("followers"))
        following = clean_users(payload.get("following"))
        if followers is None and following is None:
            raise ValueError("Ne followers ne de following listesi var")

        def to_int(v):
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        profile = Profile.query.filter_by(ig_id=ig_id).first()
        if profile is None:
            profile = Profile(ig_id=ig_id, username=username)
            db.session.add(profile)
            db.session.flush()
        profile.username = username
        profile.is_private = bool(prof.get("is_private"))

        snap = Snapshot(
            profile_id=profile.id,
            taken_at=datetime.now(),
            has_followers=followers is not None,
            has_following=following is not None,
            followers_count=len(followers or {}),
            following_count=len(following or {}),
            reported_followers=to_int(prof.get("reported_followers")),
            reported_following=to_int(prof.get("reported_following")),
        )
        db.session.add(snap)
        db.session.flush()

        rows = []
        for ltype, data in (("followers", followers), ("following", following)):
            if data is None:
                continue
            for uid, (uname, fname) in data.items():
                rows.append(SnapshotEntry(snapshot_id=snap.id, list_type=ltype,
                                          user_id=uid, username=uname, full_name=fname))
        db.session.bulk_save_objects(rows)
        db.session.commit()
        return profile, snap

    def entry_map(snapshot_id, ltype):
        rows = (db.session.query(SnapshotEntry.user_id, SnapshotEntry.username, SnapshotEntry.full_name)
                .filter_by(snapshot_id=snapshot_id, list_type=ltype).all())
        return {r.user_id: (r.username, r.full_name) for r in rows}

    def previous_snapshot(snap, ltype):
        """Aynı profilin, bu listeyi içeren bir önceki snapshot'ı."""
        flag = Snapshot.has_followers if ltype == "followers" else Snapshot.has_following
        return (Snapshot.query
                .filter(Snapshot.profile_id == snap.profile_id, Snapshot.id < snap.id, flag.is_(True))
                .order_by(Snapshot.id.desc()).first())

    def compute_delta(snap, ltype):
        """
        status: 'missing'  -> bu taramada liste çekilmemiş
                'baseline' -> ilk veri, kıyaslanacak önceki yok
                'ok'       -> added / removed dolu
        """
        has = snap.has_followers if ltype == "followers" else snap.has_following
        if not has:
            return {"status": "missing", "prev": None, "added": [], "removed": []}
        prev = previous_snapshot(snap, ltype)
        if prev is None:
            return {"status": "baseline", "prev": None, "added": [], "removed": []}

        cur, old = entry_map(snap.id, ltype), entry_map(prev.id, ltype)

        def pack(ids, source):
            items = [{"user_id": i, "username": source[i][0], "full_name": source[i][1]} for i in ids]
            return sorted(items, key=lambda x: x["username"].lower())

        return {
            "status": "ok",
            "prev": prev,
            "added": pack(cur.keys() - old.keys(), cur),     # yeni eklenenler
            "removed": pack(old.keys() - cur.keys(), old),   # çıkanlar
        }

    # ---------------------------------------------------------------- API
    @app.post("/api/sync")
    def api_sync():
        try:
            origin = request.headers.get("Origin")
            if origin and origin not in ALLOWED_ORIGINS and not origin.startswith("http://127.0.0.1"):
                return jsonify(ok=False, error="İzin verilmeyen origin"), 403
            # no-cors modunda içerik tipi text/plain gelir; bu yüzden force=True
            payload = request.get_json(force=True, silent=True)
            if payload is None:
                payload = json.loads(request.get_data(as_text=True) or "null")
            profile, snap = ingest(payload)
            app.logger.info("Snapshot kaydedildi: @%s (#%s) followers=%s following=%s",
                            profile.username, snap.id, snap.followers_count, snap.following_count)
            return jsonify(ok=True, profile=profile.username, snapshot_id=snap.id,
                           followers=snap.followers_count, following=snap.following_count)
        except (ValueError, json.JSONDecodeError) as e:
            db.session.rollback()
            return jsonify(ok=False, error=str(e)), 400
        except SQLAlchemyError as e:
            db.session.rollback()
            app.logger.exception("DB hatası")
            return jsonify(ok=False, error=f"Veritabanı hatası: {e.__class__.__name__}"), 500
        except Exception as e:  # noqa: BLE001
            db.session.rollback()
            app.logger.exception("Beklenmeyen hata")
            return jsonify(ok=False, error=str(e)), 500

    @app.post("/upload")
    def upload():
        """CSP/ağ engeli yüzünden script veriyi gönderemezse inen JSON dosyası buradan yüklenir."""
        try:
            f = request.files.get("file")
            if not f or not f.filename:
                flash("Dosya seçilmedi.", "error")
                return redirect(url_for("index"))
            profile, snap = ingest(json.loads(f.read().decode("utf-8")))
            flash(f"@{profile.username} için snapshot #{snap.id} kaydedildi.", "ok")
            return redirect(url_for("profile_view", profile_id=profile.id))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as e:
            db.session.rollback()
            flash(f"Geçersiz dosya: {e}", "error")
        except SQLAlchemyError:
            db.session.rollback()
            app.logger.exception("DB hatası")
            flash("Veritabanı hatası, terminal çıktısına bak.", "error")
        return redirect(url_for("index"))

    # ---------------------------------------------------------------- Sayfalar
    @app.get("/")
    def index():
        try:
            items = []
            for p in Profile.query.order_by(Profile.username).all():
                last = p.snapshots.first()
                items.append({"profile": p, "last": last, "scan_count": p.snapshots.count()})
            items.sort(key=lambda x: x["last"].taken_at if x["last"] else datetime.min, reverse=True)
            return render_template("index.html", items=items)
        except SQLAlchemyError:
            app.logger.exception("Liste okunamadı")
            return render_template("index.html", items=[], error="Veritabanı okunamadı."), 500

    @app.get("/profile/<int:profile_id>")
    def profile_view(profile_id):
        try:
            profile = db.session.get(Profile, profile_id)
            if profile is None:
                abort(404)
            history = profile.snapshots.all()
            if not history:
                abort(404)
            snap_id = request.args.get("snapshot", type=int)
            snap = next((s for s in history if s.id == snap_id), history[0])
            deltas = {t: compute_delta(snap, t) for t in ("followers", "following")}
            return render_template("profile.html", profile=profile, snap=snap,
                                   history=history, deltas=deltas)
        except SQLAlchemyError:
            app.logger.exception("Profil okunamadı")
            abort(500)

    @app.errorhandler(404)
    def not_found(_):
        return render_template("index.html", items=[], error="Sayfa/profil bulunamadı."), 404

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
