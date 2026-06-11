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
