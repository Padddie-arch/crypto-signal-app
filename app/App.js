import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import io from 'socket.io-client';
import HomeScreen from './screens/HomeScreen';
import ChartScreen from './screens/ChartScreen';

const Stack = createStackNavigator();
const SERVER_URL = 'https://your-backend-url.onrender.com'; // replace after deploy

export default function App() {
  const [signals, setSignals] = useState([]);
  const [memeCoins, setMemeCoins] = useState([]);

  useEffect(() => {
    const socket = io(SERVER_URL);
    socket.on('new_signals', (data) => {
      const normal = data.filter(s => !s.type);
      const meme = data.filter(s => s.type === 'meme_coin');
      setSignals(prev => [...normal, ...prev].slice(0, 50));
      setMemeCoins(meme);
    });
    return () => socket.disconnect();
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}>
        <Stack.Screen name="Home">
          {props => <HomeScreen {...props} signals={signals} memeCoins={memeCoins} />}
        </Stack.Screen>
        <Stack.Screen name="Chart" component={ChartScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
