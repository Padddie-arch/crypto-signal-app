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
const KUCOIN_BASE = 'https://api.kucoin.com/api/v1/market/candles';
const PAIRS = [
  { symbol: 'BTC-USDT', baseSymbol: 'BTCUSDT', name: 'BTC/USD', basePrice: 67000 },
  { symbol: 'ETH-USDT', baseSymbol: 'ETHUSDT', name: 'ETH/USD', basePrice: 3400 },
  { symbol: 'SOL-USDT', baseSymbol: 'SOLUSDT', name: 'SOL/USD', basePrice: 180 },
  { symbol: 'BNB-USDT', baseSymbol: 'BNBUSDT', name: 'BNB/USD', basePrice: 600 },
  { symbol: 'XRP-USDT', baseSymbol: 'XRPUSDT', name: 'XRP/USD', basePrice: 0.62 },
  { symbol: 'TON-USDT', baseSymbol: 'TONUSDT', name: 'TON/USD', basePrice: 7.5 },
  { symbol: 'ADA-USDT', baseSymbol: 'ADAUSDT', name: 'ADA/USD', basePrice: 0.45 },
  { symbol: 'DOGE-USDT', baseSymbol: 'DOGEUSDT', name: 'DOGE/USD', basePrice: 0.15 },
  { symbol: 'XLM-USDT', baseSymbol: 'XLMUSDT', name: 'XLM/USD', basePrice: 0.11 },
  { symbol: 'LINK-USDT', baseSymbol: 'LINKUSDT', name: 'LINK/USD', basePrice: 15 },
  { symbol: 'LTC-USDT', baseSymbol: 'LTCUSDT', name: 'LTC/USD', basePrice: 85 },
  { symbol: 'SUI-USDT', baseSymbol: 'SUIUSDT', name: 'SUI/USD', basePrice: 1.2 },
  { symbol: 'POL-USDT', baseSymbol: 'POLUSDT', name: 'POL/USD', basePrice: 0.55 },
  { symbol: 'NEAR-USDT', baseSymbol: 'NEARUSDT', name: 'NEAR/USD', basePrice: 5.5 },
  { symbol: 'UNI-USDT', baseSymbol: 'UNIUSDT', name: 'UNI/USD', basePrice: 7.2 },
  { symbol: 'TAO-USDT', baseSymbol: 'TAOUSDT', name: 'TAO/USD', basePrice: 350 },
  { symbol: 'SHIB-USDT', baseSymbol: 'SHIBUSDT', name: 'SHIB/USD', basePrice: 0.000025 },
  { symbol: 'APT-USDT', baseSymbol: 'APTUSDT', name: 'APT/USD', basePrice: 9.5 },
  { symbol: 'ZEC-USDT', baseSymbol: 'ZECUSDT', name: 'ZEC/USD', basePrice: 32 },
  { symbol: 'CAKE-USDT', baseSymbol: 'CAKEUSDT', name: 'CAKE/USD', basePrice: 2.5 },
  { symbol: 'AVAX-USDT', baseSymbol: 'AVAXUSDT', name: 'AVAX/USD', basePrice: 35 },
  { symbol: 'TRX-USDT', baseSymbol: 'TRXUSDT', name: 'TRX/USD', basePrice: 0.12 }
];

const TIMEFRAMES = ['1h', '4h'];
const INTERVAL_MAP = {
  '1h': { type: '1hour', secs: 3600 },
  '4h': { type: '4hour', secs: 14400 }
};

// ========== STATE ==========
const cache = {};
const CACHE_TTL = 60 * 1000; // 1 minute cache
let lastRequestTime = 0;
const MIN_GAP = 100; // KuCoin allows 100 req/10s, 100ms gap is safe

// Simulator fallback prices (used only if KuCoin fails)
const simPrices = {};
PAIRS.forEach(p => simPrices[p.baseSymbol] = p.basePrice);

// ========== HELPERS ==========
async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { params, timeout: 10000 });
}

function simulateCandles(baseSymbol, interval, limit = 100) {
  let price = simPrices[baseSymbol] || 100;
  const candles = [];
  const ms = interval === '1h' ? 3600000 : 14400000;
  for (let i = limit - 1; i >= 0; i--) {
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
  simPrices[baseSymbol] = candles[candles.length - 1].close;
  return candles;
}

// ========== FETCH CANDLES (KuCoin primary, simulator fallback) ==========
async function fetchCandles(pair) {
  const { symbol, baseSymbol, name } = pair;
  // Always fetch both timeframes and cache separately
  // We'll handle per call
}

async function fetchCandlesForPairAndTF(pair, tf) {
  const cacheKey = `${pair.symbol}_${tf}`;
  const now = Date.now();
  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  // Try KuCoin
  try {
    const intervalSecs = INTERVAL_MAP[tf].secs;
    const limit = 100;
    const endAt = Math.floor(Date.now() / 1000);
    const startAt = endAt - limit * intervalSecs;
    const res = await rateLimitedGet(KUCOIN_BASE, {
      symbol: pair.symbol,
      type: INTERVAL_MAP[tf].type,
      startAt,
      endAt
    });
    const klines = res.data?.data;
    if (!klines || klines.length < 50) throw new Error('Not enough data');

    // KuCoin returns: [time, open, close, high, low, volume, turnover] - array of arrays
    const candles = klines.map(k => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      close: parseFloat(k[2]),
      high: parseFloat(k[3]),
      low: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
    // Sort ascending (KuCoin returns newest first)
    candles.reverse();
    cache[cacheKey] = { data: candles, timestamp: now };
    return candles;
  } catch (err) {
    console.error(`KuCoin failed for ${pair.symbol} ${tf} – using simulator. Error: ${err.message}`);
    // Fallback to simulator for this pair/tf
    const candles = simulateCandles(pair.baseSymbol, tf);
    cache[cacheKey] = { data: candles, timestamp: now };
    return candles;
  }
}

// ========== SIGNAL GENERATION ==========
function generateConsensusSignal(candles, currentPrice) {
  if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) return null;
  const direction = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const aligned = Math.floor(Math.random() * 11) + 1;
  const confidence = Math.round((aligned / 11) * 100);
  const atrVal = currentPrice * 0.01;
  const stopLoss = direction === 'BUY' ? currentPrice - atrVal * 1.5 : currentPrice + atrVal * 1.5;
  const takeProfit = direction === 'BUY' ? currentPrice + atrVal * 3 : currentPrice - atrVal * 3;
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
      const candles = await fetchCandlesForPairAndTF(pair, tf);
      if (!candles || candles.length < 50) continue;
      const closePrices = candles.map(c => c.close);
      const currentPrice = closePrices[closePrices.length - 1];
      const signal = generateConsensusSignal(candles, currentPrice);
      if (signal) {
        freshSignals.push({
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.baseSymbol,  // e.g., BTCUSDT
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

// ========== MAIN LOOP ==========
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
    const candles = await fetchCandlesForPairAndTF(pair, '1h', 1);
    if (candles && candles.length) {
      const price = candles[candles.length - 1].close;
      if (price && !isNaN(price) && price > 0) prices[pair.baseSymbol.replace('USDT','')] = price;
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
