import React, { useEffect, useState } from 'react';
import { BackHandler, Platform, StatusBar, View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import Home from './src/screens/Home';
import Scan from './src/screens/Scan';
import Profile from './src/screens/Profile';
import { C } from './src/theme';

export default function App() {
  const [route, setRoute] = useState({ name: 'home' });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name !== 'home') {
        setRoute({ name: 'home' });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [route]);

  const go = (name, params = {}) => setRoute({ name, ...params });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 }}>
      <ExpoStatusBar style="light" />
      {route.name === 'home' && <Home go={go} />}
      {route.name === 'scan' && <Scan go={go} />}
      {route.name === 'profile' && <Profile profileId={route.profileId} go={go} />}
    </View>
  );
}
