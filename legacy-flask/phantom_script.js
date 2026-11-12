/*
 * PhantomTrace - Phantom Script
 * Instagram'da bir profil sayfasındayken tarayıcı konsoluna (F12 > Console) yapıştır.
 * Şifre girilmez; mevcut oturum çerezleri kullanılır. Veri sadece 127.0.0.1'e gider.
 * Durdurmak için konsolda:  window.__phantomStop = true
 */
(async () => {
  "use strict";

  const CONFIG = {
    SERVER_URL: "http://127.0.0.1:5000/api/sync",
    FETCH_FOLLOWERS: true,
    FETCH_FOLLOWING: true,
    PAGE_SIZE: 50,
    MIN_DELAY_MS: 2500,          // sayfalar arası rastgele bekleme
    MAX_DELAY_MS: 6000,
    LONG_PAUSE_EVERY: 8,         // her N sayfada bir uzun mola
    LONG_PAUSE_MIN_MS: 15000,
    LONG_PAUSE_MAX_MS: 30000,
    MAX_RETRIES: 3,
    IG_APP_ID: "936619743392459" // Instagram web istemcisinin herkese açık app id'si
  };

  const tag = "color:#a78bfa;font-weight:bold";
  const log = (...a) => console.log("%c[PhantomTrace]", tag, ...a);
  const warn = (...a) => console.warn("[PhantomTrace]", ...a);
  const fail = (...a) => console.error("[PhantomTrace]", ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

  class FatalError extends Error {}
  window.__phantomStop = false;

  const getCookie = (name) => {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  };

  const RESERVED = new Set([
    "", "explore", "reels", "reel", "direct", "accounts", "p", "stories", "tv",
    "about", "legal", "web", "api", "challenge", "emails", "nametag", "session"
  ]);

  function detectUsername() {
    const seg = location.pathname.split("/").filter(Boolean)[0];
    if (!seg || RESERVED.has(seg.toLowerCase())) return null;
    return seg;
  }

  const csrf = getCookie("csrftoken");

  async function igFetch(path) {
    let lastErr = null;
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      if (window.__phantomStop) throw new FatalError("Kullanıcı tarafından durduruldu");
      try {
        const res = await fetch(path, {
          credentials: "include",
          headers: {
            "X-IG-App-ID": CONFIG.IG_APP_ID,
            "X-CSRFToken": csrf,
            "X-Requested-With": "XMLHttpRequest",
            Accept: "*/*"
          }
        });

        if (res.status === 429) {
          const wait = rand(60000, 120000);
          warn(`Rate limit (429). ${Math.round(wait / 1000)} sn bekleniyor... (deneme ${attempt}/${CONFIG.MAX_RETRIES})`);
          lastErr = new Error("Rate limit (429)");
          await sleep(wait);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw new FatalError(`Erişim reddedildi (${res.status}). Oturum kapalı olabilir, profil gizli olabilir ya da Instagram geçici kısıt koymuş olabilir.`);
        }
        if (res.status === 404) throw new FatalError("Profil/endpoint bulunamadı (404).");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("json")) throw new FatalError("JSON yerine HTML döndü (oturum yok ya da Instagram yönlendirdi).");

        const data = await res.json();
        if (data && data.status === "fail") {
          throw new FatalError("Instagram hata döndürdü: " + (data.message || "bilinmiyor"));
        }
        return data;
      } catch (e) {
        if (e instanceof FatalError) throw e;
        lastErr = e;
        if (attempt < CONFIG.MAX_RETRIES) {
          const wait = rand(5000, 10000) * attempt;
          warn(`İstek hatası: ${e.message}. ${Math.round(wait / 1000)} sn sonra tekrar...`);
          await sleep(wait);
        }
      }
    }
    throw lastErr || new Error("Bilinmeyen istek hatası");
  }

  async function getProfileInfo(username) {
    const data = await igFetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
    const u = data && data.data && data.data.user;
    if (!u || !u.id) throw new FatalError("Profil bilgisi alınamadı (yapı değişmiş olabilir).");
    return {
      id: String(u.id),
      username: u.username || username,
      is_private: !!u.is_private,
      followed_by_viewer: !!u.followed_by_viewer,
      reported_followers: u.edge_followed_by ? u.edge_followed_by.count : null,
      reported_following: u.edge_follow ? u.edge_follow.count : null
    };
  }

  async function fetchList(userId, type, expected) {
    const users = new Map();
    let maxId = null;
    let page = 0;

    while (true) {
      const qs = new URLSearchParams({ count: String(CONFIG.PAGE_SIZE) });
      if (maxId) qs.set("max_id", String(maxId));
      if (type === "followers") qs.set("search_surface", "follow_list_page");

      const data = await igFetch(`/api/v1/friendships/${userId}/${type}/?${qs.toString()}`);
      for (const u of data.users || []) {
        const id = String(u.pk || u.pk_id || u.id || "");
        if (id && u.username) users.set(id, { id, username: u.username, full_name: u.full_name || "" });
      }
      page++;
      log(`${type}: ${users.size}${expected ? " / ~" + expected : ""} (sayfa ${page})`);

      const next = data.next_max_id;
      if (!next || String(next) === String(maxId)) break;
      maxId = next;

      await sleep(rand(CONFIG.MIN_DELAY_MS, CONFIG.MAX_DELAY_MS));
      if (page % CONFIG.LONG_PAUSE_EVERY === 0) {
        const w = rand(CONFIG.LONG_PAUSE_MIN_MS, CONFIG.LONG_PAUSE_MAX_MS);
        log(`Uzun mola: ${Math.round(w / 1000)} sn`);
        await sleep(w);
      }
    }

    const list = [...users.values()];
    if (expected && list.length < expected * 0.9) {
      warn(`${type}: ${list.length} kullanıcı alındı, Instagram ~${expected} diyor. Liste eksik olabilir; kıyas sonuçlarına temkinli yaklaş.`);
    }
    return list;
  }

  async function deliver(payload) {
    window.__phantomPayload = payload; // her durumda konsolda erişilebilir kalsın
    const body = JSON.stringify(payload);
    try {
      // no-cors + text/plain: preflight gerektirmez. Yanıt okunamaz (opaque), bu normaldir.
      await fetch(CONFIG.SERVER_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body
      });
      log("✅ Veri sunucuya gönderildi. Kontrol et: http://127.0.0.1:5000");
      return;
    } catch (e) {
      warn("Sunucuya gönderilemedi (sunucu kapalı veya Instagram CSP/tarayıcı engeli): " + e.message);
    }
    try {
      const blob = new Blob([body], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `phantomtrace_${payload.profile.username}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      log("📁 JSON dosyası indirildi. Dashboard'daki 'Manuel yükleme' bölümünden yükle.");
    } catch (e) {
      fail("Dosya indirilemedi. Veri window.__phantomPayload içinde duruyor: " + e.message);
    }
  }

  // ------------------------------------------------------------------ ana akış
  try {
    if (!location.hostname.endsWith("instagram.com")) throw new FatalError("Bu script sadece instagram.com üzerinde çalışır.");
    if (!csrf) throw new FatalError("Oturum bulunamadı (csrftoken yok). Instagram'a giriş yapmış olmalısın.");

    const username = detectUsername();
    if (!username) throw new FatalError("Bir profil sayfasında olmalısın (instagram.com/kullanici_adi).");

    log(`@${username} için profil bilgisi alınıyor...`);
    const info = await getProfileInfo(username);
    const isSelf = info.id === getCookie("ds_user_id");
    if (info.is_private && !info.followed_by_viewer && !isSelf) {
      throw new FatalError("Bu profil gizli ve takip etmiyorsun; listeler alınamaz.");
    }
    log(`Profil ID: ${info.id} | takipçi ~${info.reported_followers} | takip ~${info.reported_following}`);

    const payload = {
      version: 1,
      scanned_at: new Date().toISOString(),
      profile: {
        id: info.id,
        username: info.username,
        is_private: info.is_private,
        reported_followers: info.reported_followers,
        reported_following: info.reported_following
      },
      followers: null,   // eksik/yarım liste gönderilmez (yanlış "takibi bıraktı" sonuçlarını önler)
      following: null,
      errors: []
    };

    const jobs = [];
    if (CONFIG.FETCH_FOLLOWING) jobs.push(["following", info.reported_following]);
    if (CONFIG.FETCH_FOLLOWERS) jobs.push(["followers", info.reported_followers]);

    for (const [type, expected] of jobs) {
      try {
        log(`${type} çekiliyor...`);
        payload[type] = await fetchList(info.id, type, expected);
      } catch (e) {
        payload.errors.push(`${type}: ${e.message}`);
        fail(`${type} alınamadı: ${e.message}`);
        if (window.__phantomStop) break;
      }
      await sleep(rand(CONFIG.MIN_DELAY_MS, CONFIG.MAX_DELAY_MS));
    }

    if (!payload.followers && !payload.following) throw new FatalError("Hiçbir liste tamamlanamadı, gönderilecek veri yok.");
    await deliver(payload);
  } catch (e) {
    fail(e.message || e);
  }
})();
