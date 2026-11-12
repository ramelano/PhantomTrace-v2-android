// PhantomTrace v2 - yerel SQLite (Flask sürümündeki snapshot/delta mantığının portu)
import * as SQLite from 'expo-sqlite';

let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('phantomtrace.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ig_id TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL,
          is_private INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL,
          taken_at TEXT NOT NULL,
          has_followers INTEGER NOT NULL DEFAULT 0,
          has_following INTEGER NOT NULL DEFAULT 0,
          followers_count INTEGER NOT NULL DEFAULT 0,
          following_count INTEGER NOT NULL DEFAULT 0,
          reported_followers INTEGER,
          reported_following INTEGER
        );
        CREATE INDEX IF NOT EXISTS ix_snap_profile ON snapshots (profile_id);
        CREATE TABLE IF NOT EXISTS snapshot_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          snapshot_id INTEGER NOT NULL,
          list_type TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          full_name TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS ix_entry_snap_type ON snapshot_entries (snapshot_id, list_type);
      `);
      return db;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

function cleanUsers(raw) {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) throw new Error('Liste alanı dizi olmalı');
  const out = new Map();
  for (const u of raw) {
    if (!u || typeof u !== 'object') continue;
    const uid = String(u.id || u.pk || '').trim();
    const uname = String(u.username || '').trim();
    if (uid && uname) out.set(uid, [uname.slice(0, 64), String(u.full_name || '').slice(0, 200)]);
  }
  return out;
}

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

// Scan ekranından gelen payload'ı kaydeder. Döner: { profileId, username, followers, following }
export async function ingest(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Geçersiz veri');
  const prof = payload.profile || {};
  const igId = String(prof.id || '').trim();
  const username = String(prof.username || '').trim();
  if (!igId || !username) throw new Error('profile.id ve profile.username zorunlu');

  const followers = cleanUsers(payload.followers);
  const following = cleanUsers(payload.following);
  if (followers === null && following === null) throw new Error('Ne takipçi ne takip listesi var');

  const db = await getDb();
  const now = new Date().toISOString();
  let profileId;

  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync('SELECT id FROM profiles WHERE ig_id = ?', [igId]);
    if (existing) {
      profileId = existing.id;
      await db.runAsync('UPDATE profiles SET username = ?, is_private = ? WHERE id = ?',
        [username, prof.is_private ? 1 : 0, profileId]);
    } else {
      const r = await db.runAsync(
        'INSERT INTO profiles (ig_id, username, is_private, created_at) VALUES (?, ?, ?, ?)',
        [igId, username, prof.is_private ? 1 : 0, now]);
      profileId = r.lastInsertRowId;
    }

    const snap = await db.runAsync(
      `INSERT INTO snapshots (profile_id, taken_at, has_followers, has_following,
         followers_count, following_count, reported_followers, reported_following)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [profileId, now, followers ? 1 : 0, following ? 1 : 0,
        followers ? followers.size : 0, following ? following.size : 0,
        toInt(prof.reported_followers), toInt(prof.reported_following)]);
    const snapId = snap.lastInsertRowId;

    const stmt = await db.prepareAsync(
      'INSERT INTO snapshot_entries (snapshot_id, list_type, user_id, username, full_name) VALUES (?, ?, ?, ?, ?)');
    try {
      for (const [ltype, data] of [['followers', followers], ['following', following]]) {
        if (!data) continue;
        for (const [uid, [uname, fname]] of data) {
          await stmt.executeAsync([snapId, ltype, uid, uname, fname]);
        }
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });

  return {
    profileId,
    username,
    followers: followers ? followers.size : null,
    following: following ? following.size : null,
  };
}

export async function listProfiles() {
  const db = await getDb();
  return db.getAllAsync(`
    SELECT p.id, p.username, p.is_private,
           (SELECT COUNT(*) FROM snapshots s WHERE s.profile_id = p.id) AS scan_count,
           l.taken_at AS last_at, l.followers_count AS last_followers, l.following_count AS last_following,
           l.has_followers AS last_has_followers, l.has_following AS last_has_following
    FROM profiles p
    LEFT JOIN snapshots l ON l.id = (SELECT MAX(id) FROM snapshots WHERE profile_id = p.id)
    ORDER BY l.taken_at DESC`);
}

export async function getProfile(profileId) {
  const db = await getDb();
  const profile = await db.getFirstAsync('SELECT * FROM profiles WHERE id = ?', [profileId]);
  if (!profile) return null;
  const history = await db.getAllAsync('SELECT * FROM snapshots WHERE profile_id = ? ORDER BY id DESC', [profileId]);
  return { profile, history };
}

export async function deleteProfile(profileId) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'DELETE FROM snapshot_entries WHERE snapshot_id IN (SELECT id FROM snapshots WHERE profile_id = ?)', [profileId]);
    await db.runAsync('DELETE FROM snapshots WHERE profile_id = ?', [profileId]);
    await db.runAsync('DELETE FROM profiles WHERE id = ?', [profileId]);
  });
}

async function entryMap(snapshotId, ltype) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    'SELECT user_id, username, full_name FROM snapshot_entries WHERE snapshot_id = ? AND list_type = ?',
    [snapshotId, ltype]);
  return new Map(rows.map((r) => [r.user_id, { user_id: r.user_id, username: r.username, full_name: r.full_name }]));
}

// status: 'missing' (bu taramada liste yok) | 'baseline' (önceki yok) | 'ok'
export async function computeDelta(snap, ltype) {
  const has = ltype === 'followers' ? snap.has_followers : snap.has_following;
  if (!has) return { status: 'missing', added: [], removed: [] };

  const db = await getDb();
  const flag = ltype === 'followers' ? 'has_followers' : 'has_following';
  const prev = await db.getFirstAsync(
    `SELECT * FROM snapshots WHERE profile_id = ? AND id < ? AND ${flag} = 1 ORDER BY id DESC LIMIT 1`,
    [snap.profile_id, snap.id]);
  if (!prev) return { status: 'baseline', added: [], removed: [] };

  const [cur, old] = await Promise.all([entryMap(snap.id, ltype), entryMap(prev.id, ltype)]);
  const sortFn = (a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase());
  const added = [...cur.values()].filter((u) => !old.has(u.user_id)).sort(sortFn);
  const removed = [...old.values()].filter((u) => !cur.has(u.user_id)).sort(sortFn);
  return { status: 'ok', prevAt: prev.taken_at, added, removed };
}
