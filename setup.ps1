# Create all files for Crypto Signal App
$backendDir = "backend"
$appDir = "app"
New-Item -ItemType Directory -Force -Path $backendDir, "$backendDir\services", "$backendDir\models", $appDir, "$appDir\components", "$appDir\screens"

# ─── backend/package.json ───
@'
{
  "name": "crypto-signal-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2",
    "axios": "^1.6.2",
    "node-binance-api": "^0.13.1",
    "ta": "^0.3.0",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "node-cron": "^3.0.3"
  }
}
'@ | Out-File -FilePath "$backendDir\package.json" -Encoding UTF8

# ─── backend/.env ───
@'
BINANCE_API_KEY=your_binance_api_key_here
BINANCE_SECRET_KEY=your_binance_secret_key_here
ONESIGNAL_APP_ID=your_onesignal_app_id
ONESIGNAL_REST_API_KEY=your_onesignal_rest_key
AUTO_TRADE_ENABLED=false
PORT=3000
'@ | Out-File -FilePath "$backendDir\.env" -Encoding UTF8

# ─── backend/server.js ───
@'
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const cron = require('node-cron');
const binanceService = require('./services/binanceService');
const solanaService = require('./services/solanaService');
const signalGenerator = require('./services/signalGenerator');
const notificationService = require('./services/notificationService');
const tradeHistory = require('./models/tradeHistory');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

let connectedClients = [];
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  connectedClients.push(socket);
  socket.on('disconnect', () => {
    connectedClients = connectedClients.filter(s => s.id !== socket.id);
  });
});

app.get('/api/signals', (req, res) => {
  const signals = signalGenerator.getLatestSignals();
  res.json(signals);
});

app.post('/api/autotrade', (req, res) => {
  const { enabled } = req.body;
  process.env.AUTO_TRADE_ENABLED = enabled ? 'true' : 'false';
  res.json({ success: true, autoTrade: process.env.AUTO_TRADE_ENABLED });
});

app.post('/api/keys', (req, res) => {
  const { apiKey, secretKey } = req.body;
  process.env.BINANCE_API_KEY = apiKey;
  process.env.BINANCE_SECRET_KEY = secretKey;
  binanceService.updateKeys(apiKey, secretKey);
  res.json({ success: true });
});

cron.schedule('* * * * *', async () => {
  console.log('Generating signals...');
  try {
    const newSignals = await signalGenerator.generateAll();
    if (newSignals.length > 0) {
      io.emit('new_signals', newSignals);
      notificationService.sendPushForSignals(newSignals);
    }
  } catch (err) {
    console.error('Signal generation error:', err);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
'@ | Out-File -FilePath "$backendDir\server.js" -Encoding UTF8

# ─── backend/services/binanceService.js ───
@'
const Binance = require('node-binance-api');
const ta = require('ta');
let binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_SECRET_KEY
});

const updateKeys = (apiKey, secretKey) => {
  binance = new Binance().options({ APIKEY: apiKey, APISECRET: secretKey });
};

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    const candles = await binance.candlesticks(symbol, interval, false, { limit });
    const closes = candles.map(c => parseFloat(c[4]));
    const volumes = candles.map(c => parseFloat(c[5]));
    const rsiArray = ta.rsi(closes, 14);
    const lastRsi = rsiArray[rsiArray.length - 1] || 50;
    const macdObj = ta.macd(closes);
    const lastMacd = macdObj?.macd?.[macdObj.macd.length-1] || 0;
    const lastSignal = macdObj?.signal?.[macdObj.signal.length-1] || 0;
    const macdHistogram = lastMacd - lastSignal;
    const volSma = volumes.length > 10 ? volumes.slice(-10).reduce((a,b)=>a+b,0)/10 : volumes[volumes.length-1];
    const lastVolume = volumes[volumes.length-1];
    const volumeSpike = lastVolume > volSma * 1.5;
    const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a,b)=>a+b,0)/20 : closes[closes.length-1];
    const currentPrice = closes[closes.length-1];
    return {
      price: currentPrice,
      rsi: lastRsi,
      macd: lastMacd,
      macdSignal: lastSignal,
      macdHistogram,
      volumeSpike,
      ma20,
      priceVsMa: currentPrice > ma20 ? 'above' : 'below',
      rawCandles: candles
    };
  } catch (err) {
    console.error(`Error fetching indicators for ${symbol}:`, err.message);
    return null;
  }
}

async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  try {
    const order = await binance.marketBuy(signal.symbol, signal.quantity || 0.001);
    return order;
  } catch (err) {
    console.error('Order error:', err.message);
    return null;
  }
}

module.exports = { getIndicators, updateKeys, placeOrder };
'@ | Out-File -FilePath "$backendDir\services\binanceService.js" -Encoding UTF8

# ─── backend/services/solanaService.js ───
@'
const axios = require('axios');

async function findNewSolanaMemeCoins() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: { vs_currency: 'usd', category: 'solana-ecosystem', order: 'market_cap_desc', per_page: 10, page: 1 }
    });
    const coins = res.data;
    const memeKeywords = ['meme', 'dog', 'cat', 'pepe', 'woof', 'inu', 'shib', 'bonk', 'wif'];
    const memeCoins = coins.filter(c =>
      memeKeywords.some(kw => c.name.toLowerCase().includes(kw) || c.symbol.toLowerCase().includes(kw))
    ).map(c => ({
      name: c.name,
      symbol: c.symbol,
      price: c.current_price,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      priceChange24h: c.price_change_percentage_24h,
      probability: Math.min(85, 30 + (c.price_change_percentage_24h > 5 ? 30 : 10) + (c.total_volume > 1e6 ? 20 : 0))
    }));
    return memeCoins;
  } catch (err) {
    console.error('Solana meme coin error:', err.message);
    return [];
  }
}
module.exports = { findNewSolanaMemeCoins };
'@ | Out-File -FilePath "$backendDir\services\solanaService.js" -Encoding UTF8

# ─── backend/services/signalGenerator.js ───
@'
const binanceService = require('./binanceService');
const solanaService = require('./solanaService');
const tradeHistory = require('../models/tradeHistory');
const notificationService = require('./notificationService');

let latestSignals = [];

function predictTrend(prices) {
  const n = prices.length;
  if (n < 5) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope;
}

function confidenceScore(rsi, macdHistogram, volumeSpike, trendSlope, priceVsMa) {
  let score = 50;
  if (rsi < 30) score += 15;
  else if (rsi < 40) score += 10;
  else if (rsi > 70) score -= 15;
  else if (rsi > 60) score -= 5;
  if (macdHistogram > 0) score += 10; else score -= 10;
  if (volumeSpike) score += 10;
  if (trendSlope > 0) score += 10; else score -= 5;
  if (priceVsMa === 'above') score += 5; else score -= 5;
  return Math.max(0, Math.min(100, score));
}

async function generateAll() {
  const pairs = [
    { symbol: 'BTCUSDT', name: 'BTC/USD' },
    { symbol: 'ETHUSDT', name: 'ETH/USD' },
    { symbol: 'SOLUSDT', name: 'SOL/USD' },
    { symbol: 'BNBUSDT', name: 'BNB/USD' },
    { symbol: 'XRPUSDT', name: 'XRP/USD' },
    { symbol: 'XAUUSDT', name: 'XAU/USD' },
    { symbol: 'XAGUSDT', name: 'XAG/USD' }
  ];
  const timeframes = ['15m', '30m', '1h', '2h', '4h', '1d'];
  const freshSignals = [];

  for (const pair of pairs) {
    for (const tf of timeframes) {
      const indicators = await binanceService.getIndicators(pair.symbol, tf);
      if (!indicators) continue;
      const trendSlope = predictTrend(indicators.rawCandles.slice(-20).map(c => parseFloat(c[4])));
      const conf = confidenceScore(
        indicators.rsi,
        indicators.macdHistogram,
        indicators.volumeSpike,
        trendSlope,
        indicators.priceVsMa
      );
      if (conf >= 70) {
        const direction = trendSlope > 0 ? 'BUY' : 'SELL';
        const stopLoss = indicators.price * (direction === 'BUY' ? 0.98 : 1.02);
        const takeProfit = indicators.price * (direction === 'BUY' ? 1.04 : 0.96);
        const signal = {
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.symbol,
          timeframe: tf,
          direction,
          price: indicators.price,
          confidence: conf,
          stopLoss,
          takeProfit,
          trailingStop: direction === 'BUY' ? indicators.price * 0.99 : indicators.price * 1.01,
          rsi: indicators.rsi,
          macd: indicators.macdHistogram,
          volumeSpike: indicators.volumeSpike,
          aiTrend: trendSlope > 0 ? 'up' : 'down',
          timestamp: new Date().toISOString()
        };
        freshSignals.push(signal);
        tradeHistory.add(signal);
      }
    }
  }

  const memeCoins = await solanaService.findNewSolanaMemeCoins();
  if (memeCoins.length > 0) {
    memeCoins.forEach(coin => {
      const signal = {
        id: Date.now() + Math.random(),
        type: 'meme_coin',
        name: coin.name,
        symbol: coin.symbol,
        price: coin.price,
        confidence: coin.probability,
        probability: coin.probability,
        volume24h: coin.volume24h,
        priceChange24h: coin.priceChange24h,
        timestamp: new Date().toISOString()
      };
      freshSignals.push(signal);
    });
  }

  latestSignals = freshSignals;
  return freshSignals;
}

function getLatestSignals() {
  return latestSignals;
}

module.exports = { generateAll, getLatestSignals };
'@ | Out-File -FilePath "$backendDir\services\signalGenerator.js" -Encoding UTF8

# ─── backend/services/notificationService.js ───
@'
const axios = require('axios');
async function sendPushForSignals(signals) {
  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) return;
  const highConfSignals = signals.filter(s => s.confidence && s.confidence >= 80);
  if (highConfSignals.length === 0) return;
  const contents = { en: `${highConfSignals.length} high-confidence signals detected!` };
  const headings = { en: '🔔 New Trading Signals' };
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: process.env.ONESIGNAL_APP_ID,
      included_segments: ['All'],
      contents,
      headings,
      data: { type: 'signals' }
    }, {
      headers: { Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}` }
    });
  } catch (err) {
    console.error('Push notification error:', err.response?.data || err.message);
  }
}
module.exports = { sendPushForSignals };
'@ | Out-File -FilePath "$backendDir\services\notificationService.js" -Encoding UTF8

# ─── backend/models/tradeHistory.js ───
@'
const trades = [];
const MAX_HISTORY = 200;
function add(signal) {
  trades.push(signal);
  if (trades.length > MAX_HISTORY) trades.shift();
}
function getAll() {
  return trades;
}
module.exports = { add, getAll };
'@ | Out-File -FilePath "$backendDir\models\tradeHistory.js" -Encoding UTF8

# ======================= APP (React Native Expo) =======================

# ─── app/package.json ───
@'
{
  "name": "crypto-signal-app",
  "version": "1.0.0",
  "main": "node_modules/expo/AppEntry.js",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "build:android": "expo build:android"
  },
  "dependencies": {
    "expo": "~50.0.0",
    "expo-status-bar": "~1.11.1",
    "react": "18.2.0",
    "react-native": "0.73.2",
    "socket.io-client": "^4.7.2",
    "react-native-chart-kit": "^6.12.0",
    "react-native-svg": "~13.9.0",
    "@react-navigation/native": "^6.1.7",
    "@react-navigation/stack": "^6.3.17",
    "react-native-gesture-handler": "~2.12.0",
    "react-native-safe-area-context": "4.6.4",
    "react-native-screens": "~3.25.0"
  }
}
'@ | Out-File -FilePath "$appDir\package.json" -Encoding UTF8

# ─── app/App.js ───
@'
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
'@ | Out-File -FilePath "$appDir\App.js" -Encoding UTF8

# ─── app/screens/HomeScreen.js ───
@'
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import SignalCard from '../components/SignalCard';

export default function HomeScreen({ navigation, signals, memeCoins }) {
  const [autoTrade, setAutoTrade] = useState(false);
  const toggleAutoTrade = async (val) => {
    setAutoTrade(val);
    await fetch('https://your-backend-url.onrender.com/api/autotrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: val })
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.autoTradeRow}>
        <Text style={styles.autoText}>Auto Trade</Text>
        <Switch value={autoTrade} onValueChange={toggleAutoTrade} trackColor={{ false: '#555', true: '#00c853' }} />
      </View>
      <Text style={styles.sectionTitle}>🔥 High Confidence Signals</Text>
      <FlatList
        data={signals.sort((a,b) => b.confidence - a.confidence)}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => <SignalCard signal={item} onChartPress={() => navigation.navigate('Chart', { symbol: item.symbol })} />}
      />
      {memeCoins.length > 0 && (
        <View style={styles.memeSection}>
          <Text style={styles.memeTitle}>🐶 New Solana Meme Coins</Text>
          {memeCoins.map(coin => (
            <View key={coin.symbol} style={styles.memeItem}>
              <Text style={styles.memeText}>{coin.name} ({coin.symbol}) - ${coin.price.toFixed(6)} | Prob: {coin.probability}%</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', paddingTop: 10 },
  autoTradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#1a1a2e', marginBottom: 10 },
  autoText: { color: '#fff', fontSize: 16 },
  sectionTitle: { color: '#ffaa00', fontSize: 20, fontWeight: 'bold', marginLeft: 15, marginBottom: 10 },
  memeSection: { padding: 15, backgroundColor: '#16213e', marginTop: 10 },
  memeTitle: { color: '#ff66aa', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  memeItem: { paddingVertical: 5 },
  memeText: { color: '#ddd', fontSize: 14 }
});
'@ | Out-File -FilePath "$appDir\screens\HomeScreen.js" -Encoding UTF8

# ─── app/screens/ChartScreen.js ───
@'
import React, { useEffect, useState } from 'react';
import { View, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import axios from 'axios';

export default function ChartScreen({ route }) {
  const { symbol } = route.params;
  const [data, setData] = useState({ labels: [], datasets: [{ data: [] }] });
  useEffect(() => {
    axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=20`)
      .then(res => {
        const closes = res.data.map(c => parseFloat(c[4]));
        const labels = res.data.map((_, i) => i.toString());
        setData({ labels, datasets: [{ data: closes }] });
      })
      .catch(err => console.error(err));
  }, [symbol]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f0f1a', justifyContent: 'center', alignItems: 'center' }}>
      <LineChart
        data={data}
        width={Dimensions.get('window').width - 20}
        height={300}
        chartConfig={{ backgroundColor: '#1a1a2e', backgroundGradientFrom: '#1a1a2e', backgroundGradientTo: '#16213e', color: (opacity = 1) => `rgba(0, 200, 255, ${opacity})`, labelColor: () => '#fff' }}
        bezier
      />
    </View>
  );
}
'@ | Out-File -FilePath "$appDir\screens\ChartScreen.js" -Encoding UTF8

# ─── app/components/SignalCard.js ───
@'
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function SignalCard({ signal, onChartPress }) {
  const isBuy = signal.direction === 'BUY';
  return (
    <TouchableOpacity onPress={onChartPress} style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[styles.pair, { color: isBuy ? '#00e676' : '#ff5252' }]}>{signal.pair} {signal.direction}</Text>
        <Text style={styles.timeframe}>{signal.timeframe}</Text>
      </View>
      <Text style={styles.price}>Price: ${signal.price?.toFixed(2)}</Text>
      <Text style={styles.confidence}>Confidence: {signal.confidence}%</Text>
      {signal.rsi && <Text style={styles.info}>RSI: {signal.rsi.toFixed(1)} | MACD: {signal.macd.toFixed(4)}</Text>}
      <Text style={styles.info}>SL: ${signal.stopLoss?.toFixed(2)} | TP: ${signal.takeProfit?.toFixed(2)}</Text>
      <Text style={styles.info}>Trailing Stop: ${signal.trailingStop?.toFixed(2)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1a1a2e', padding: 15, marginHorizontal: 10, marginVertical: 5, borderRadius: 10, borderLeftWidth: 5, borderLeftColor: '#ffaa00' },
  pair: { fontSize: 18, fontWeight: 'bold' },
  timeframe: { color: '#aaa', fontSize: 14 },
  price: { color: '#fff', fontSize: 16, marginTop: 5 },
  confidence: { color: '#ffaa00', fontSize: 15, fontWeight: 'bold' },
  info: { color: '#ccc', fontSize: 13, marginTop: 2 }
});
'@ | Out-File -FilePath "$appDir\components\SignalCard.js" -Encoding UTF8

# ─── ecosystem.config.js (for local PM2) ───
@'
module.exports = {
  apps: [{
    name: 'crypto-backend',
    script: 'server.js',
    cwd: './backend',
    watch: false,
    env: { NODE_ENV: 'production' }
  }]
};
'@ | Out-File -FilePath "ecosystem.config.js" -Encoding UTF8

Write-Host "✅ All files created successfully!" -ForegroundColor Green
Write-Host "Now run: cd backend; npm install; cd ..; cd app; npm install; cd .." -ForegroundColor Yellow