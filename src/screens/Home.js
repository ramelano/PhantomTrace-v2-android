import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { deleteProfile, listProfiles } from '../db';
import { C } from '../theme';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '-');

export default function Home({ go }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems(await listProfiles());
      setError(null);
    } catch (e) {
      setError('Veritabanı okunamadı: ' + e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirmDelete = (p) =>
    Alert.alert('Profili sil', `@${p.username} ve tüm taramaları silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil', style: 'destructive',
        onPress: async () => {
          try { await deleteProfile(p.id); await load(); } catch (e) { Alert.alert('Hata', e.message); }
        },
      },
    ]);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ color: C.accent, fontSize: 26, fontWeight: '800' }}>PhantomTrace</Text>
      <Text style={{ color: C.dim, marginBottom: 14 }}>Takipçi / takip değişimlerini yerelde izler</Text>

      <Pressable onPress={() => go('scan')}
        style={{ backgroundColor: C.accent, padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 14 }}>
        <Text style={{ color: '#0f0f14', fontWeight: '800', fontSize: 16 }}>＋ Yeni tarama</Text>
      </Pressable>

      {error && <Text style={{ color: C.bad, marginBottom: 8 }}>{error}</Text>}

      <FlatList
        data={items}
        keyExtractor={(p) => String(p.id)}
        ListEmptyComponent={
          <Text style={{ color: C.dim, marginTop: 24, lineHeight: 22 }}>
            Henüz tarama yok. "Yeni tarama" ile Instagram'a giriş yap, bir profile git ve taramayı başlat.
            Farkları görmek için aynı profili daha sonra tekrar tara.
          </Text>
        }
        renderItem={({ item: p }) => (
          <Pressable onPress={() => go('profile', { profileId: p.id })} onLongPress={() => confirmDelete(p)}
            style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>
              @{p.username}{p.is_private ? '  🔒' : ''}
            </Text>
            <Text style={{ color: C.dim, marginTop: 4 }}>
              {p.scan_count} tarama · son: {fmt(p.last_at)}
            </Text>
            <Text style={{ color: C.dim, marginTop: 2 }}>
              Takipçi {p.last_has_followers ? p.last_followers : '-'} · Takip {p.last_has_following ? p.last_following : '-'}
            </Text>
          </Pressable>
        )}
      />
      {items.length > 0 && <Text style={{ color: C.dim, fontSize: 12, textAlign: 'center' }}>Silmek için profile uzun bas</Text>}
    </View>
  );
}
