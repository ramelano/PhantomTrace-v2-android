"""PhantomTrace - SQLite veritabanı şeması (zaman damgalı snapshot mantığı)."""
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Profile(db.Model):
    """Taranan Instagram profili (Instagram'ın sabit sayısal ID'si ile eşleşir)."""
    __tablename__ = "profiles"

    id = db.Column(db.Integer, primary_key=True)
    ig_id = db.Column(db.String(32), unique=True, nullable=False, index=True)
    username = db.Column(db.String(64), nullable=False, index=True)
    is_private = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

    snapshots = db.relationship(
        "Snapshot", backref="profile", cascade="all, delete-orphan",
        order_by="Snapshot.id.desc()", lazy="dynamic",
    )


class Snapshot(db.Model):
    """Bir profilin belirli bir andaki anlık görüntüsü."""
    __tablename__ = "snapshots"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False, index=True)
    taken_at = db.Column(db.DateTime, default=datetime.now, nullable=False)

    # Bu taramada hangi listeler eksiksiz alındı? (Yarım liste kıyaslamayı bozar, o yüzden kaydedilmez.)
    has_followers = db.Column(db.Boolean, default=False, nullable=False)
    has_following = db.Column(db.Boolean, default=False, nullable=False)

    followers_count = db.Column(db.Integer, default=0)       # gerçekten kaydedilen sayı
    following_count = db.Column(db.Integer, default=0)
    reported_followers = db.Column(db.Integer, nullable=True)  # Instagram'ın bildirdiği sayı
    reported_following = db.Column(db.Integer, nullable=True)

    entries = db.relationship("SnapshotEntry", backref="snapshot", cascade="all, delete-orphan", lazy="dynamic")


class SnapshotEntry(db.Model):
    """Bir snapshot içindeki tek bir kullanıcı satırı (followers veya following)."""
    __tablename__ = "snapshot_entries"

    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey("snapshots.id"), nullable=False)
    list_type = db.Column(db.String(16), nullable=False)  # "followers" | "following"
    user_id = db.Column(db.String(32), nullable=False)    # kullanıcı adı değişse bile ID sabit
    username = db.Column(db.String(64), nullable=False)
    full_name = db.Column(db.String(200), default="")

    __table_args__ = (
        db.Index("ix_entry_snap_type", "snapshot_id", "list_type"),
    )
