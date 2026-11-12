import React, { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useKeepAwake } from 'expo-keep-awake';
import { buildScan, LOCATION_PROBE } from '../injected';
import { ingest } from '../db';
import { C } from '../theme';

const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const RESERVED = ['', 'explore', 'reels', 'reel', 'direct', 'accounts', 'p', 'stories', 'tv', 'about', 'legal', 'web', 'api', 'challenge', 'emails', 'nametag', 'session'];

export default function Scan({ go }) {
  useKeepAwake(); // tarama sırasında ekran kapanmasın (WebView arka planda kısılır)
  const web = useRef(null);
  const logRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [user, setUser] = useState(null);
  const [wantFollowers, setWantFollowers] = useState(true);
  const [wantFollowing, setWantFollowing] = useState(true);
  const [logs, setLogs] = useState([]);
  const [savedId, setSavedId] = useState(null);

  const addLog = (kind, text) => setLogs((l) => [...l.slice(-150), { kind, text, k: Math.random() }]);

  const start = () => {
    if (!wantFollowers && !wantFollowing) return Alert.alert('Seçim yap', 'En az bir liste seçmelisin.');
    setSavedId(null);
    setRunning(true);
    addLog('log', 'Tarama başlatıldı. Ekranı kapatma, uygulamadan çıkma.');
    web.current?.injectJavaScript(buildScan({ followers: wantFollowers, following: wantFollowing }));
  };

  const stop = () => {
    web.current?.injectJavaScript('window.__phantomStop = true; true;');
    addLog('warn', 'Durdurma istendi, mevcut istek bitince duracak...');
  };

  const onMessage = async (ev) => {
    let m;
    try { m = JSON.parse(ev.nativeEvent.data); } catch { return; }
    if (m.type === 'loc') {
      const seg = m.path.split('/').filter(Boolean)[0];
      const ok = m.host.endsWith('instagram.com') && seg && !RESERVED.includes(seg.toLowerCase());
      setUser(ok ? seg : null);
    } else if (m.type === 'payload') {
      try {
        const r = await ingest(m.payload);
        setSavedId(r.profileId);
        addLog('ok', `✅ @${r.username} kaydedildi (takipçi: ${r.followers ?? '-'}, takip: ${r.following ?? '-'})`);
      } catch (e) {
        addLog('error', 'Kayıt hatası: ' + e.message);
      }
    } else if (m.type === 'done') {
      setRunning(false);
    } else if (m.type === 'log' || m.type === 'warn' || m.type === 'error') {
      addLog(m.type, m.text);
    }
  };

  const colorOf = (k) => ({ warn: C.warn, error: C.bad, ok: C.ok }[k] || C.dim);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={web}
        source={{ uri: 'https://www.instagram.com/' }}
        userAgent={UA}
        injectedJavaScript={LOCATION_PROBE}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        style={{ flex: 1, backgroundColor: C.bg }}
      />

      <View style={{ backgroundColor: C.card, padding: 10, borderTopColor: C.border, borderTopWidth: 1 }}>
        <Text style={{ color: user ? C.text : C.dim, marginBottom: 6 }}>
          {user ? `Profil: @${user}` : 'Giriş yap, sonra taranacak profile git'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ color: C.text }}>Takipçi</Text>
          <Switch value={wantFollowers} onValueChange={setWantFollowers} disabled={running} />
          <Text style={{ color: C.text, marginLeft: 12 }}>Takip edilen</Text>
          <Switch value={wantFollowing} onValueChange={setWantFollowing} disabled={running} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!running ? (
            <Pressable onPress={start} disabled={!user}
              style={{ flex: 2, backgroundColor: user ? C.accent : C.border, padding: 12, borderRadius: 10, alignItems: 'center' }}>
              <Text style={{ color: user ? '#0f0f14' : C.dim, fontWeight: '800' }}>Taramayı başlat</Text>
            </Pressable>
          ) : (
            <Pressable onPress={stop} style={{ flex: 2, backgroundColor: C.bad, padding: 12, borderRadius: 10, alignItems: 'center' }}>
              <Text style={{ color: '#0f0f14', fontWeight: '800' }}>Durdur</Text>
            </Pressable>
          )}
          {savedId && !running ? (
            <Pressable onPress={() => go('profile', { profileId: savedId })}
              style={{ flex: 1, borderColor: C.ok, borderWidth: 1, padding: 12, borderRadius: 10, alignItems: 'center' }}>
              <Text style={{ color: C.ok, fontWeight: '700' }}>Sonuç</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => go('home')} disabled={running}
              style={{ flex: 1, borderColor: C.border, borderWidth: 1, padding: 12, borderRadius: 10, alignItems: 'center', opacity: running ? 0.4 : 1 }}>
              <Text style={{ color: C.text }}>Kapat</Text>
            </Pressable>
          )}
        </View>

        {logs.length > 0 && (
          <ScrollView ref={logRef} style={{ maxHeight: 110, marginTop: 8 }}
            onContentSizeChange={() => logRef.current?.scrollToEnd({ animated: false })}>
            {logs.map((l) => (
              <Text key={l.k} style={{ color: colorOf(l.kind), fontSize: 12, fontFamily: 'monospace' }}>{l.text}</Text>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
