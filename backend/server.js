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

const tradeTracker = require('./services/tradeTracker');
// ... (existing code)

// Check open trades every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  await tradeTracker.checkOpenTrades();
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  const stats = tradeTracker.getStats();
  res.json(stats);
});

// Live prices (simple endpoint)
app.get('/api/prices', async (req, res) => {
  const prices = {};
  // use cached data or fetch fresh
  const pairs = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','TONUSDT','ADAUSDT','DOGEUSDT','XLMUSDT','LINKUSDT','LTCUSDT','SUIUSDT','POLUSDT','NEARUSDT','UNIUSDT','TAOUSDT','SHIBUSDT','APTUSDT','ZECUSDT','CAKEUSDT','AVAXUSDT','TRXUSDT'];
  for (const sym of pairs) {
    const ind = await binanceService.getIndicators(sym, '1h', 1);
    if (ind) prices[sym.replace('USDT','')] = ind.price;
  }
  res.json(prices);
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
