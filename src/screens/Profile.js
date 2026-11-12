import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { computeDelta, getProfile } from '../db';
import { C } from '../theme';

const fmt = (iso) => new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

export default function Profile({ profileId, go }) {
  const [data, setData] = useState(null);
  const [snapId, setSnapId] = useState(null);
  const [deltas, setDeltas] = useState(null);
  const [tab, setTab] = useState('followers_added');
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await getProfile(profileId);
        if (!d || d.history.length === 0) throw new Error('Profil bulunamadı');
        setData(d);
        setSnapId(d.history[0].id);
      } catch (e) { setError(e.message); }
    })();
  }, [profileId]);

  const snap = useMemo(() => data?.history.find((s) => s.id === snapId), [data, snapId]);

  useEffect(() => {
    if (!snap) return;
    (async () => {
      try {
        const [followers, following] = await Promise.all([computeDelta(snap, 'followers'), computeDelta(snap, 'following')]);
        setDeltas({ followers, following });
      } catch (e) { setError(e.message); }
    })();
  }, [snap]);

  if (error) return <View style={{ padding: 16 }}><Text style={{ color: C.bad }}>{error}</Text></View>;
  if (!data || !snap || !deltas) return <ActivityIndicator style={{ marginTop: 40 }} color={C.accent} />;

  const tabs = [
    { key: 'followers_added', label: 'Takipçi +', n: deltas.followers.added.length, color: C.ok, list: deltas.followers.added, st: deltas.followers.status },
    { key: 'followers_removed', label: 'Takipçi −', n: deltas.followers.removed.length, color: C.bad, list: deltas.followers.removed, st: deltas.followers.status },
    { key: 'following_added', label: 'Takip +', n: deltas.following.added.length, color: C.ok, list: deltas.following.added, st: deltas.following.status },
    { key: 'following_removed', label: 'Takip −', n: deltas.following.removed.length, color: C.bad, list: deltas.following.removed, st: deltas.following.status },
  ];
  const cur = tabs.find((t) => t.key === tab);
  const statusMsg = { missing: 'Bu taramada bu liste alınmadı.', baseline: 'İlk veri: kıyaslanacak önceki tarama yok. Daha sonra tekrar tara.' }[cur.st];

  const mismatch = (got, rep) => rep && got < rep * 0.9;
  const incomplete = (snap.has_followers && mismatch(snap.followers_count, snap.reported_followers))
    || (snap.has_following && mismatch(snap.following_count, snap.reported_following));

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Pressable onPress={() => go('home')}><Text style={{ color: C.dim, marginBottom: 6 }}>← Geri</Text></Pressable>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>@{data.profile.username}</Text>
      <Text style={{ color: C.dim, marginBottom: 8 }}>
        Takipçi {snap.has_followers ? snap.followers_count : '-'} · Takip {snap.has_following ? snap.following_count : '-'}
        {snap.reported_followers != null ? `  (IG: ${snap.reported_followers}/${snap.reported_following})` : ''}
      </Text>
      {incomplete && (
        <Text style={{ color: C.warn, marginBottom: 8 }}>
          ⚠ Alınan sayı Instagram'ın bildirdiğinden belirgin düşük; liste eksik olabilir, farklar güvenilir olmayabilir.
        </Text>
      )}

      <View style={{ height: 40, marginBottom: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {data.history.map((s) => (
            <Pressable key={s.id} onPress={() => setSnapId(s.id)}
              style={{ paddingHorizontal: 12, justifyContent: 'center', marginRight: 8, borderRadius: 20, borderWidth: 1,
                borderColor: s.id === snapId ? C.accent : C.border, backgroundColor: s.id === snapId ? '#2a2145' : 'transparent' }}>
              <Text style={{ color: s.id === snapId ? C.accent : C.dim, fontSize: 12 }}>#{s.id} · {fmt(s.taken_at)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
        {tabs.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', borderWidth: 1,
              borderColor: t.key === tab ? t.color : C.border, backgroundColor: C.card }}>
            <Text style={{ color: t.key === tab ? t.color : C.dim, fontSize: 12, fontWeight: '700' }}>{t.label}</Text>
            <Text style={{ color: C.text, fontWeight: '800' }}>{t.st === 'ok' ? t.n : '-'}</Text>
          </Pressable>
        ))}
      </View>

      {statusMsg ? (
        <Text style={{ color: C.dim, marginTop: 8 }}>{statusMsg}</Text>
      ) : (
        <FlatList
          data={cur.list}
          keyExtractor={(u) => u.user_id}
          ListEmptyComponent={<Text style={{ color: C.dim, marginTop: 8 }}>Değişiklik yok.</Text>}
          renderItem={({ item: u }) => (
            <Pressable onPress={() => Linking.openURL('https://www.instagram.com/' + u.username + '/')}
              style={{ paddingVertical: 10, borderBottomColor: C.border, borderBottomWidth: 1 }}>
              <Text style={{ color: C.text, fontWeight: '600' }}>@{u.username}</Text>
              {u.full_name ? <Text style={{ color: C.dim, fontSize: 12 }}>{u.full_name}</Text> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
