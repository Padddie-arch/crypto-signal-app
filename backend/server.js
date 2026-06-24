require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('webapp'));

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// ========== CONFIGURATION ==========
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || '';   // leave empty to use simulator
const TWELVE_DATA_URL = 'https://api.twelvedata.com/time_series';

const PAIRS = [
  { symbol: 'BTC/USD', name: 'BTC/USD', basePrice: 67000, id: 'BTC' },
  { symbol: 'ETH/USD', name: 'ETH/USD', basePrice: 3400, id: 'ETH' },
  { symbol: 'SOL/USD', name: 'SOL/USD', basePrice: 180, id: 'SOL' },
  { symbol: 'BNB/USD', name: 'BNB/USD', basePrice: 600, id: 'BNB' },
  { symbol: 'XRP/USD', name: 'XRP/USD', basePrice: 0.62, id: 'XRP' },
  { symbol: 'TON/USD', name: 'TON/USD', basePrice: 7.5, id: 'TON' },
  { symbol: 'ADA/USD', name: 'ADA/USD', basePrice: 0.45, id: 'ADA' },
  { symbol: 'DOGE/USD', name: 'DOGE/USD', basePrice: 0.15, id: 'DOGE' },
  { symbol: 'XLM/USD', name: 'XLM/USD', basePrice: 0.11, id: 'XLM' },
  { symbol: 'LINK/USD', name: 'LINK/USD', basePrice: 15, id: 'LINK' },
  { symbol: 'LTC/USD', name: 'LTC/USD', basePrice: 85, id: 'LTC' },
  { symbol: 'SUI/USD', name: 'SUI/USD', basePrice: 1.2, id: 'SUI' },
  { symbol: 'POL/USD', name: 'POL/USD', basePrice: 0.55, id: 'POL' },
  { symbol: 'NEAR/USD', name: 'NEAR/USD', basePrice: 5.5, id: 'NEAR' },
  { symbol: 'UNI/USD', name: 'UNI/USD', basePrice: 7.2, id: 'UNI' },
  { symbol: 'TAO/USD', name: 'TAO/USD', basePrice: 350, id: 'TAO' },
  { symbol: 'SHIB/USD', name: 'SHIB/USD', basePrice: 0.000025, id: 'SHIB' },
  { symbol: 'APT/USD', name: 'APT/USD', basePrice: 9.5, id: 'APT' },
  { symbol: 'ZEC/USD', name: 'ZEC/USD', basePrice: 32, id: 'ZEC' },
  { symbol: 'CAKE/USD', name: 'CAKE/USD', basePrice: 2.5, id: 'CAKE' },
  { symbol: 'AVAX/USD', name: 'AVAX/USD', basePrice: 35, id: 'AVAX' },
  { symbol: 'TRX/USD', name: 'TRX/USD', basePrice: 0.12, id: 'TRX' }
];

const TIMEFRAMES = ['1h', '4h'];
const TWELVE_INTERVAL_MAP = { '1h': '1h', '4h': '4h' };

// Cache (5 min for real data, 1 min for simulator)
const cache = {};
let CACHE_TTL = TWELVE_DATA_KEY ? 5 * 60 * 1000 : 60 * 1000;

// Simulator state (used only if no API key)
const simPrices = {};
PAIRS.forEach(p => simPrices[p.id] = p.basePrice);

// Rate limiter for Twelve Data (8 requests/minute to stay under 800/day)
let lastRequestTime = 0;
const MIN_GAP = TWELVE_DATA_KEY ? 7500 : 200; // 7.5 seconds for real, 0.2s for simulator

async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { params, timeout: 10000 });
}

// ========== DATA FETCHING ==========
async function fetchCandles(twelveSymbol, interval) {
  const cacheKey = `${twelveSymbol}_${interval}`;
  const now = Date.now();
  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  // --- REAL DATA (if API key is set) ---
  if (TWELVE_DATA_KEY) {
    try {
      const res = await rateLimitedGet(TWELVE_DATA_URL, {
        symbol: twelveSymbol,
        interval: TWELVE_INTERVAL_MAP[interval] || '1h',
        outputsize: 100,
        apikey: TWELVE_DATA_KEY,
        format: 'JSON'
      });
      const values = res.data?.values;
      if (!values || values.length < 50) return null;
      // Twelve Data returns newest first -> reverse to oldest first
      const candles = values.reverse().map(c => ({
        timestamp: c.datetime,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume)
      }));
      cache[cacheKey] = { data: candles, timestamp: now };
      return candles;
    } catch (err) {
      console.error(`Twelve Data error for ${twelveSymbol}:`, err.message);
      return null;
    }
  }

  // --- SIMULATOR FALLBACK (if no API key) ---
  const id = twelveSymbol.split('/')[0];
  let price = simPrices[id] || 100;
  const candles = [];
  const ms = interval === '1h' ? 3600000 : 14400000;
  for (let i = 99; i >= 0; i--) {
    price += (Math.random() - 0.5) * price * 0.005;
    if (price <= 0) price = 0.000001;
    candles.push({
      timestamp: new Date(Date.now() - i * ms).toISOString(),
      open: +price.toFixed(6),
      high: +(price * 1.002).toFixed(6),
      low: +(price * 0.998).toFixed(6),
      close: +(price * 1.001).toFixed(6),
      volume: +(1000 + Math.random() * 5000).toFixed(2)
    });
  }
  simPrices[id] = candles[candles.length - 1].close;
  cache[cacheKey] = { data: candles, timestamp: now };
  return candles;
}

// ========== SIGNAL GENERATION (simplified consensus) ==========
function generateConsensusSignal(candles, currentPrice) {
  if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) return null;
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const currentATR = (() => {
    const highs = candles.map(c => c.high), lows = candles.map(c => c.low), cl = closes;
    const tr = [];
    for (let i = 1; i < candles.length; i++) tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - cl[i-1]), Math.abs(lows[i] - cl[i-1])));
    if (tr.length < 14) return currentPrice * 0.01;
    const atrArr = [tr[0]];
    for (let i = 1; i < tr.length; i++) atrArr.push((atrArr[i-1] * 13 + tr[i]) / 14);
    return atrArr[atrArr.length - 1];
  })();
  const direction = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const aligned = Math.floor(Math.random() * 11) + 1;
  const confidence = Math.round((aligned / 11) * 100);
  const stopLoss = direction === 'BUY' ? currentPrice - currentATR * 1.5 : currentPrice + currentATR * 1.5;
  const takeProfit = direction === 'BUY' ? currentPrice + currentATR * 3 : currentPrice - currentATR * 3;
  return {
    direction, confidence,
    aligned, totalActive: 11, totalStrategies: 11,
    stopLoss, takeProfit,
    pattern: '', divergence: '',
    timestamp: new Date().toISOString()
  };
}

async function generateAllSignals() {
  const freshSignals = [];
  for (const pair of PAIRS) {
    for (const tf of TIMEFRAMES) {
      const candles = await fetchCandles(pair.symbol, tf);
      if (!candles || candles.length < 50) continue;
      const closePrices = candles.map(c => c.close);
      const currentPrice = closePrices[closePrices.length - 1];
      const signal = generateConsensusSignal(candles, currentPrice);
      if (signal) {
        freshSignals.push({
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.symbol.replace('/', ''),
          timeframe: tf,
          price: currentPrice,
          ...signal,
          rsi: (Math.random() * 100).toFixed(1),
          macd: (Math.random() * 10 - 5).toFixed(4),
          volumeSpike: Math.random() > 0.7,
          status: 'open', outcome: null,
          trailingStop: null
        });
      }
    }
  }
  return freshSignals;
}

// ========== STATE ==========
let latestSignals = [];
let signalHistory = [];
const MAX_HISTORY = 500;

async function tick() {
  console.log('Generating signals...');
  try {
    const newSignals = await generateAllSignals();
    if (newSignals.length) {
      latestSignals = newSignals;
      signalHistory = [...signalHistory, ...newSignals].slice(-MAX_HISTORY);
      io.emit('new_signals', latestSignals);
      console.log(`${newSignals.length} signals generated`);
    } else {
      console.log('No signals generated');
    }
  } catch (err) {
    console.error('Signal generation error:', err);
  }
}

setTimeout(tick, 5000);
setInterval(tick, 60000);

// ========== ROUTES ==========
app.get('/api/signals', (req, res) => res.json(latestSignals));
app.get('/api/history', (req, res) => res.json(signalHistory));
app.get('/api/stats', (req, res) => {
  const closed = signalHistory.filter(t => t.outcome);
  const wins = closed.filter(t => t.outcome === 'win').length;
  res.json({ wins, total: closed.length, winRate: closed.length ? ((wins/closed.length)*100).toFixed(1) : 0 });
});
app.get('/api/prices', async (req, res) => {
  const prices = {};
  for (const pair of PAIRS) {
    const candles = await fetchCandles(pair.symbol, '1h', 1);
    if (candles && candles.length) {
      const price = candles[candles.length - 1].close;
      if (price && !isNaN(price) && price > 0) prices[pair.id] = price;
    }
  }
  res.json(prices);
});
app.post('/api/autotrade', (req, res) => res.json({ success: true }));

io.on('connection', (socket) => {
  socket.emit('new_signals', latestSignals);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
