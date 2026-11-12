// WebView'a enjekte edilen tarama scripti (phantom_script.js'in mobil uyarlaması).
// Sunucuya POST yerine window.ReactNativeWebView.postMessage ile uygulamaya veri verir.
// Not: Hermes release derlemesinde Function.toString kullanılamadığı için düz string.
export const SCAN_SCRIPT = String.raw`
(function () {
  "use strict";
  var OPTS = window.__phantomOpts || { followers: true, following: true };
  function post(type, text, extra) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: type, text: text }, extra || {})));
    } catch (e) {}
  }
  if (window.__phantomRunning) { post("warn", "Tarama zaten çalışıyor."); return; }
  window.__phantomRunning = true;
  window.__phantomStop = false;

  var CONFIG = {
    PAGE_SIZE: 50,
    MIN_DELAY_MS: 2500, MAX_DELAY_MS: 6000,
    LONG_PAUSE_EVERY: 8, LONG_PAUSE_MIN_MS: 15000, LONG_PAUSE_MAX_MS: 30000,
    MAX_RETRIES: 3,
    IG_APP_ID: "936619743392459"
  };
  var RESERVED = ["", "explore", "reels", "reel", "direct", "accounts", "p", "stories", "tv",
    "about", "legal", "web", "api", "challenge", "emails", "nametag", "session"];

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var rand = function (a, b) { return Math.floor(a + Math.random() * (b - a)); };
  function FatalError(msg) { this.message = msg; this.fatal = true; }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function detectUsername() {
    var seg = location.pathname.split("/").filter(Boolean)[0];
    if (!seg || RESERVED.indexOf(seg.toLowerCase()) !== -1) return null;
    return seg;
  }
  var csrf = getCookie("csrftoken");

  async function igFetch(path) {
    var lastErr = null;
    for (var attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      if (window.__phantomStop) throw new FatalError("Kullanıcı tarafından durduruldu");
      try {
        var res = await fetch(path, {
          credentials: "include",
          headers: {
            "X-IG-App-ID": CONFIG.IG_APP_ID,
            "X-CSRFToken": csrf,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "*/*"
          }
        });
        if (res.status === 429) {
          var wait = rand(60000, 120000);
          post("warn", "Rate limit (429). " + Math.round(wait / 1000) + " sn bekleniyor... (deneme " + attempt + "/" + CONFIG.MAX_RETRIES + ")");
          lastErr = new Error("Rate limit (429)");
          await sleep(wait);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw new FatalError("Erişim reddedildi (" + res.status + "). Oturum kapalı, profil gizli ya da Instagram geçici kısıt koymuş olabilir.");
        }
        if (res.status === 404) throw new FatalError("Profil/endpoint bulunamadı (404).");
        if (!res.ok) throw new Error("HTTP " + res.status);
        var ct = res.headers.get("content-type") || "";
        if (ct.indexOf("json") === -1) throw new FatalError("JSON yerine HTML döndü (oturum yok ya da Instagram yönlendirdi).");
        var data = await res.json();
        if (data && data.status === "fail") throw new FatalError("Instagram hata döndürdü: " + (data.message || "bilinmiyor"));
        return data;
      } catch (e) {
        if (e && e.fatal) throw e;
        lastErr = e;
        if (attempt < CONFIG.MAX_RETRIES) {
          var w2 = rand(5000, 10000) * attempt;
          post("warn", "İstek hatası: " + (e && e.message) + ". " + Math.round(w2 / 1000) + " sn sonra tekrar...");
          await sleep(w2);
        }
      }
    }
    throw lastErr || new Error("Bilinmeyen istek hatası");
  }

  async function getProfileInfo(username) {
    var data = await igFetch("/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username));
    var u = data && data.data && data.data.user;
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
    var users = new Map();
    var maxId = null;
    var page = 0;
    while (true) {
      var qs = new URLSearchParams({ count: String(CONFIG.PAGE_SIZE) });
      if (maxId) qs.set("max_id", String(maxId));
      if (type === "followers") qs.set("search_surface", "follow_list_page");
      var data = await igFetch("/api/v1/friendships/" + userId + "/" + type + "/?" + qs.toString());
      var arr = data.users || [];
      for (var i = 0; i < arr.length; i++) {
        var u = arr[i];
        var id = String(u.pk || u.pk_id || u.id || "");
        if (id && u.username) users.set(id, { id: id, username: u.username, full_name: u.full_name || "" });
      }
      page++;
      post("log", type + ": " + users.size + (expected ? " / ~" + expected : "") + " (sayfa " + page + ")");
      var next = data.next_max_id;
      if (!next || String(next) === String(maxId)) break;
      maxId = next;
      await sleep(rand(CONFIG.MIN_DELAY_MS, CONFIG.MAX_DELAY_MS));
      if (page % CONFIG.LONG_PAUSE_EVERY === 0) {
        var w = rand(CONFIG.LONG_PAUSE_MIN_MS, CONFIG.LONG_PAUSE_MAX_MS);
        post("log", "Uzun mola: " + Math.round(w / 1000) + " sn");
        await sleep(w);
      }
    }
    var list = Array.from(users.values());
    if (expected && list.length < expected * 0.9) {
      post("warn", type + ": " + list.length + " kullanıcı alındı, Instagram ~" + expected + " diyor. Liste eksik olabilir; kıyas sonuçlarına temkinli yaklaş.");
    }
    return list;
  }

  (async function main() {
    try {
      if (location.hostname.slice(-13) !== "instagram.com") throw new FatalError("Bu script sadece instagram.com üzerinde çalışır.");
      if (!csrf) throw new FatalError("Oturum bulunamadı (csrftoken yok). Önce Instagram'a giriş yap.");
      var username = detectUsername();
      if (!username) throw new FatalError("Bir profil sayfasında olmalısın (instagram.com/kullanici_adi).");

      post("log", "@" + username + " için profil bilgisi alınıyor...");
      var info = await getProfileInfo(username);
      var isSelf = info.id === getCookie("ds_user_id");
      if (info.is_private && !info.followed_by_viewer && !isSelf) {
        throw new FatalError("Bu profil gizli ve takip etmiyorsun; listeler alınamaz.");
      }
      post("log", "Profil ID: " + info.id + " | takipçi ~" + info.reported_followers + " | takip ~" + info.reported_following);

      var payload = {
        version: 1,
        scanned_at: new Date().toISOString(),
        profile: {
          id: info.id, username: info.username, is_private: info.is_private,
          reported_followers: info.reported_followers, reported_following: info.reported_following
        },
        followers: null,
        following: null,
        errors: []
      };

      var jobs = [];
      if (OPTS.following) jobs.push(["following", info.reported_following]);
      if (OPTS.followers) jobs.push(["followers", info.reported_followers]);

      for (var j = 0; j < jobs.length; j++) {
        var type = jobs[j][0];
        try {
          post("log", type + " çekiliyor...");
          payload[type] = await fetchList(info.id, type, jobs[j][1]);
        } catch (e) {
          payload.errors.push(type + ": " + (e && e.message));
          post("error", type + " alınamadı: " + (e && e.message));
          if (window.__phantomStop) break;
        }
        await sleep(rand(CONFIG.MIN_DELAY_MS, CONFIG.MAX_DELAY_MS));
      }

      if (!payload.followers && !payload.following) throw new FatalError("Hiçbir liste tamamlanamadı, kaydedilecek veri yok.");
      post("payload", null, { payload: payload });
    } catch (e) {
      post("error", (e && e.message) || String(e));
    } finally {
      window.__phantomRunning = false;
      post("done");
    }
  })();
})();
`;

// Sayfanın konumunu (hangi profilde olduğunu) uygulamaya bildirir. SPA geçişleri için periyodik.
export const LOCATION_PROBE = String.raw`
(function () {
  if (window.__ptProbe) return;
  window.__ptProbe = true;
  setInterval(function () {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "loc", host: location.hostname, path: location.pathname }));
    } catch (e) {}
  }, 1200);
})();
true;
`;

export function buildScan(opts) {
  return 'window.__phantomOpts = ' + JSON.stringify(opts) + ';\n' + SCAN_SCRIPT + '\ntrue;';
}
