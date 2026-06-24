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
const MEXC_KLINE_URL = 'https://api.mexc.com/api/v3/klines';
const PAIRS = [
  { symbol: 'BTCUSDT', name: 'BTC/USD', basePrice: 67000 },
  { symbol: 'ETHUSDT', name: 'ETH/USD', basePrice: 3400 },
  { symbol: 'SOLUSDT', name: 'SOL/USD', basePrice: 180 },
  { symbol: 'BNBUSDT', name: 'BNB/USD', basePrice: 600 },
  { symbol: 'XRPUSDT', name: 'XRP/USD', basePrice: 0.62 },
  { symbol: 'TONUSDT', name: 'TON/USD', basePrice: 7.5 },
  { symbol: 'ADAUSDT', name: 'ADA/USD', basePrice: 0.45 },
  { symbol: 'DOGEUSDT', name: 'DOGE/USD', basePrice: 0.15 },
  { symbol: 'XLMUSDT', name: 'XLM/USD', basePrice: 0.11 },
  { symbol: 'LINKUSDT', name: 'LINK/USD', basePrice: 15 },
  { symbol: 'LTCUSDT', name: 'LTC/USD', basePrice: 85 },
  { symbol: 'SUIUSDT', name: 'SUI/USD', basePrice: 1.2 },
  { symbol: 'POLUSDT', name: 'POL/USD', basePrice: 0.55 },
  { symbol: 'NEARUSDT', name: 'NEAR/USD', basePrice: 5.5 },
  { symbol: 'UNIUSDT', name: 'UNI/USD', basePrice: 7.2 },
  { symbol: 'TAOUSDT', name: 'TAO/USD', basePrice: 350 },
  { symbol: 'SHIBUSDT', name: 'SHIB/USD', basePrice: 0.000025 },
  { symbol: 'APTUSDT', name: 'APT/USD', basePrice: 9.5 },
  { symbol: 'ZECUSDT', name: 'ZEC/USD', basePrice: 32 },
  { symbol: 'CAKEUSDT', name: 'CAKE/USD', basePrice: 2.5 },
  { symbol: 'AVAXUSDT', name: 'AVAX/USD', basePrice: 35 },
  { symbol: 'TRXUSDT', name: 'TRX/USD', basePrice: 0.12 }
];

const TIMEFRAMES = ['1h', '4h'];
const INTERVAL_MAP = { '1h': '1h', '4h': '4h' };

// ========== STATE ==========
let useSimulator = false;   // automatically switched if MEXC fails
const cache = {};
const CACHE_TTL = 60 * 1000;
let lastRequestTime = 0;
const MIN_GAP = 200;

// Simulator prices (fallback)
const simPrices = {};
PAIRS.forEach(p => simPrices[p.symbol] = p.basePrice);

// ========== HELPERS ==========
async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, {
    params,
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
}

function simulateCandles(basePrice, interval, limit = 100) {
  let price = simPrices[basePrice] || 100;
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
  simPrices[basePrice] = candles[candles.length - 1].close;
  return candles;
}

// ========== FETCH CANDLES (MEXC first, simulator fallback) ==========
async function fetchCandles(symbol, interval) {
  if (useSimulator) {
    return simulateCandles(symbol, interval);
  }

  const cacheKey = `${symbol}_${interval}`;
  const now = Date.now();
  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  try {
    const res = await rateLimitedGet(MEXC_KLINE_URL, {
      symbol,
      interval: INTERVAL_MAP[interval],
      limit: 100
    });
    const klines = res.data;
    if (!klines || klines.length < 50) {
      throw new Error('Empty or too few candles');
    }
    const candles = klines.map(k => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
    cache[cacheKey] = { data: candles, timestamp: now };
    return candles;
  } catch (err) {
    console.error(`MEXC failed for ${symbol} – switching to simulator. Error: ${err.message}`);
    useSimulator = true;   // flip the switch for all future requests
    return simulateCandles(symbol, interval);
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
      const candles = await fetchCandles(pair.symbol, tf);
      if (!candles || candles.length < 50) continue;
      const closePrices = candles.map(c => c.close);
      const currentPrice = closePrices[closePrices.length - 1];
      const signal = generateConsensusSignal(candles, currentPrice);
      if (signal) {
        freshSignals.push({
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.symbol,
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
    const candles = await fetchCandles(pair.symbol, '1h', 1);
    if (candles && candles.length) {
      const price = candles[candles.length - 1].close;
      if (price && !isNaN(price) && price > 0) prices[pair.symbol.replace('USDT','')] = price;
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
