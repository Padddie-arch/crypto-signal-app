require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('webapp'));

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// ---------- SIMPLE IN-MEMORY SIGNAL GENERATOR ----------
const pairs = [
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

const lastPrices = {};
pairs.forEach(p => lastPrices[p.symbol] = p.basePrice);

function generateSignals() {
  const freshSignals = [];
  const timeframes = ['1h', '4h'];
  for (const pair of pairs) {
    for (const tf of timeframes) {
      // Random walk price change
      const change = (Math.random() - 0.5) * lastPrices[pair.symbol] * 0.005;
      lastPrices[pair.symbol] = Math.max(0.000001, lastPrices[pair.symbol] + change);
      const price = lastPrices[pair.symbol];
      const direction = Math.random() > 0.5 ? 'BUY' : 'SELL';
      const atrVal = price * 0.01;
      const stopLoss = direction === 'BUY' ? price - atrVal * 1.5 : price + atrVal * 1.5;
      const takeProfit = direction === 'BUY' ? price + atrVal * 3 : price - atrVal * 3;
      const aligned = Math.floor(Math.random() * 11) + 1; // 1..11
      const totalActive = Math.max(aligned, Math.floor(Math.random() * 11) + 1);
      const confidence = Math.round((aligned / 11) * 100);
      freshSignals.push({
        id: Date.now() + Math.random(),
        pair: pair.name,
        symbol: pair.symbol,
        timeframe: tf,
        direction,
        price,
        confidence,
        aligned,
        totalActive,
        totalStrategies: 11,
        stopLoss,
        takeProfit,
        trailingStop: null,
        rsi: (Math.random() * 100).toFixed(1),
        macd: (Math.random() * 10 - 5).toFixed(4),
        volumeSpike: Math.random() > 0.7,
        adx: 25 + Math.random() * 30,
        vwap: price * (0.99 + Math.random() * 0.02),
        divergence: '',
        pattern: '',
        timestamp: new Date().toISOString(),
        status: 'open',
        outcome: null
      });
    }
  }
  return freshSignals;
}

let latestSignals = [];
let signalHistory = [];
const MAX_HISTORY = 200;

// Generate immediately and then every 60 seconds
setInterval(() => {
  latestSignals = generateSignals();
  // Push to history
  signalHistory = [...signalHistory, ...latestSignals].slice(-MAX_HISTORY);
  io.emit('new_signals', latestSignals);
  console.log(`Generated ${latestSignals.length} signals`);
}, 60000);
// First generation right away
latestSignals = generateSignals();
signalHistory = [...latestSignals];

// ---------- ROUTES ----------

app.get('/api/signals', (req, res) => res.json(latestSignals));
app.get('/api/history', (req, res) => res.json(signalHistory));
app.get('/api/stats', (req, res) => {
  const closed = signalHistory.filter(t => t.outcome);
  const wins = closed.filter(t => t.outcome === 'win').length;
  res.json({ wins, total: closed.length, winRate: closed.length ? ((wins/closed.length)*100).toFixed(1) : 0 });
});
app.get('/api/prices', (req, res) => {
  const prices = {};
  pairs.forEach(p => prices[p.symbol.replace('USDT','')] = lastPrices[p.symbol]);
  res.json(prices);
});

app.post('/api/autotrade', (req, res) => {
  console.log('Auto-trade toggle:', req.body.enabled);
  res.json({ success: true });
});

// ---------- SOCKET ----------
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('new_signals', latestSignals);
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
