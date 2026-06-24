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
app.use(express.static('webapp'));

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

// ---------- ROUTES ----------

app.get('/api/signals', (req, res) => {
  const signals = signalGenerator.getLatestSignals();
  res.json(signals);
});

app.get('/api/history', (req, res) => {
  const history = tradeHistory.getAll();
  res.json(history);
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

// ---------- TRADE TRACKER (win‑rate stats) ----------

async function checkOpenTrades() {
  const trades = tradeHistory.getAll().filter(
    t => t.status === 'open' && t.type !== 'meme_coin'
  );
  const now = Date.now();
  for (const trade of trades) {
    const signalTime = new Date(trade.timestamp).getTime();
    const timeframeMs = trade.timeframe === '1h' ? 3600000 : 14400000;
    if (now - signalTime < timeframeMs) continue; // wait for next candle

    const indicators = await binanceService.getIndicators(trade.symbol, trade.timeframe, 1);
    if (!indicators) continue;
    const currentPrice = indicators.price;

    if (trade.direction === 'BUY') {
      if (currentPrice <= trade.stopLoss) {
        trade.status = 'closed';
        trade.outcome = 'loss';
      } else if (currentPrice >= trade.takeProfit) {
        trade.status = 'closed';
        trade.outcome = 'win';
      }
    } else {
      if (currentPrice >= trade.stopLoss) {
        trade.status = 'closed';
        trade.outcome = 'loss';
      } else if (currentPrice <= trade.takeProfit) {
        trade.status = 'closed';
        trade.outcome = 'win';
      }
    }
  }
}

function getStats() {
  const trades = tradeHistory.getAll().filter(t => t.outcome);
  const wins = trades.filter(t => t.outcome === 'win').length;
  const total = trades.length;
  return {
    wins,
    total,
    winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : 0
  };
}

app.get('/api/stats', (req, res) => {
  const stats = getStats();
  res.json(stats);
});

// ---------- LIVE PRICES (for ticker) ----------

app.get('/api/prices', async (req, res) => {
  const pairs = [
    'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
    'TONUSDT','ADAUSDT','DOGEUSDT','XLMUSDT','LINKUSDT',
    'LTCUSDT','SUIUSDT','POLUSDT','NEARUSDT','UNIUSDT',
    'TAOUSDT','SHIBUSDT','APTUSDT','ZECUSDT','CAKEUSDT',
    'AVAXUSDT','TRXUSDT'
  ];
  const prices = {};
  for (const sym of pairs) {
    const ind = await binanceService.getIndicators(sym, '1h', 1);
    if (ind) prices[sym.replace('USDT', '')] = ind.price;
  }
  res.json(prices);
});

// ---------- SCHEDULED JOBS ----------

// Generate signals every minute
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

// Check open trades every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    await checkOpenTrades();
  } catch (err) {
    console.error('Trade tracker error:', err);
  }
});

// ---------- START SERVER ----------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
