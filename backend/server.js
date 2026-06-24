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
  { symbol: 'BTCUSDT', name: 'BTC/USD' },
  { symbol: 'ETHUSDT', name: 'ETH/USD' },
  { symbol: 'SOLUSDT', name: 'SOL/USD' },
  { symbol: 'BNBUSDT', name: 'BNB/USD' },
  { symbol: 'XRPUSDT', name: 'XRP/USD' },
  { symbol: 'TONUSDT', name: 'TON/USD' },
  { symbol: 'ADAUSDT', name: 'ADA/USD' },
  { symbol: 'DOGEUSDT', name: 'DOGE/USD' },
  { symbol: 'XLMUSDT', name: 'XLM/USD' },
  { symbol: 'LINKUSDT', name: 'LINK/USD' },
  { symbol: 'LTCUSDT', name: 'LTC/USD' },
  { symbol: 'SUIUSDT', name: 'SUI/USD' },
  { symbol: 'POLUSDT', name: 'POL/USD' },
  { symbol: 'NEARUSDT', name: 'NEAR/USD' },
  { symbol: 'UNIUSDT', name: 'UNI/USD' },
  { symbol: 'TAOUSDT', name: 'TAO/USD' },
  { symbol: 'SHIBUSDT', name: 'SHIB/USD' },
  { symbol: 'APTUSDT', name: 'APT/USD' },
  { symbol: 'ZECUSDT', name: 'ZEC/USD' },
  { symbol: 'CAKEUSDT', name: 'CAKE/USD' },
  { symbol: 'AVAXUSDT', name: 'AVAX/USD' },
  { symbol: 'TRXUSDT', name: 'TRX/USD' }
];

const TIMEFRAMES = ['1h', '4h'];
const INTERVAL_MAP = { '1h': '1h', '4h': '4h' };

// Cache & rate limiter
const cache = {};
const CACHE_TTL = 60 * 1000;
let lastRequestTime = 0;
const MIN_GAP = 200;

async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { params, timeout: 10000 });
}

// ========== TECHNICAL INDICATORS (same as before) ==========
function ema(data, period) {
  if (data.length < period) return [data[data.length - 1]];
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k));
  return result;
}

function adx(candles, period = 14) {
  if (candles.length < period + 1) return { adx: 0, plusDI: 0, minusDI: 0 };
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low), closes = candles.map(c => c.close);
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = highs[i] - highs[i - 1], downMove = lows[i - 1] - lows[i];
    const trueRange = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    tr.push(trueRange);
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  function wilderSmooth(arr, period) {
    const smoothed = [arr[0]];
    for (let i = 1; i < arr.length; i++) smoothed.push((smoothed[i - 1] * (period - 1) + arr[i]) / period);
    return smoothed;
  }
  const atr = wilderSmooth(tr, period);
  const smoothedPlus = wilderSmooth(plusDM, period), smoothedMinus = wilderSmooth(minusDM, period);
  const diPlus = smoothedPlus.map((v, i) => (v / atr[i]) * 100);
  const diMinus = smoothedMinus.map((v, i) => (v / atr[i]) * 100);
  const dx = diPlus.map((v, i) => Math.abs(v - diMinus[i]) / (v + diMinus[i]) * 100);
  const adxArr = [dx[0]];
  for (let i = 1; i < dx.length; i++) adxArr.push((adxArr[i - 1] * (period - 1) + dx[i]) / period);
  const last = adxArr.length - 1;
  return { adx: adxArr[last] || 0, plusDI: diPlus[last] || 0, minusDI: diMinus[last] || 0 };
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low), closes = candles.map(c => c.close);
  const tr = [];
  for (let i = 1; i < candles.length; i++) tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  const atrArr = [tr[0]];
  for (let i = 1; i < tr.length; i++) atrArr.push((atrArr[i - 1] * (period - 1) + tr[i]) / period);
  return atrArr[atrArr.length - 1];
}

function stochRSI(closes, period = 14) { /* same as before, abbreviated */ return 50; }
function ichimoku(candles) { return { vote: 0 }; }
function bollingerPercentB(closes, period = 20, stdDev = 2) { return { vote: 0 }; }
function aroon(candles, period = 14) { return { vote: 0 }; }
function candlePattern(candles) { return { vote: 0 }; }
function rsiDivergence(candles, period = 14) { return { vote: 0 }; }
function vwap(candles) { return 0; }

// ========== DATA FETCHING (WITH DEBUG) ==========
async function fetchCandles(symbol, interval) {
  if (!INTERVAL_MAP[interval]) return null;
  const cacheKey = `${symbol}_${interval}`;
  const now = Date.now();
  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) return cache[cacheKey].data;

  try {
    const res = await rateLimitedGet(MEXC_KLINE_URL, { symbol, interval: INTERVAL_MAP[interval], limit: 100 });
    const klines = res.data;
    // ---- DEBUG ----
    if (klines && klines.length > 0) {
      console.log(`DEBUG first candle for ${symbol} ${interval}:`, klines[0]);
    } else {
      console.log(`DEBUG empty or null klines for ${symbol} ${interval}:`, klines);
    }
    if (!klines || klines.length < 50) return null;
    const candles = klines.map(k => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
    // Log the first built candle
    console.log(`DEBUG first built candle close: ${candles[0].close}`);
    cache[cacheKey] = { data: candles, timestamp: now };
    return candles;
  } catch (err) {
    console.error(`MEXC fetch error for ${symbol}:`, err.message);
    return null;
  }
}

// ========== SIGNAL GENERATION (simplified for now) ==========
function generateConsensusSignal(candles, currentPrice, rsi, macdHistogram, volumeSpike, priceVsMa) {
  // Skip if price is invalid
  if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) return null;

  const closes = candles.map(c => c.close);
  const currentATR = atr(candles, 14) || currentPrice * 0.01;
  const { adx: adxVal } = adx(candles, 14);

  // 11 strategies (simplified votes for now, just to get signals flowing)
  // We'll generate random votes for demonstration – replace with real logic later
  let buyVotes = 0, sellVotes = 0;
  const votes = [];
  for (let i = 0; i < 11; i++) {
    const v = Math.random() > 0.5 ? 1 : -1;
    votes.push(v);
    if (v === 1) buyVotes++;
    else sellVotes++;
  }
  const totalActive = 11;
  const maxVotes = Math.max(buyVotes, sellVotes);
  const direction = buyVotes > sellVotes ? 'BUY' : 'SELL';
  const confidence = Math.round((maxVotes / 11) * 100);
  const stopLoss = direction === 'BUY' ? currentPrice - currentATR * 1.5 : currentPrice + currentATR * 1.5;
  const takeProfit = direction === 'BUY' ? currentPrice + currentATR * 3 : currentPrice - currentATR * 3;

  return {
    direction, confidence,
    aligned: maxVotes, totalActive, totalStrategies: 11,
    stopLoss, takeProfit,
    atr: currentATR, adx: adxVal,
    divergence: '', pattern: '',
    timestamp: new Date().toISOString()
  };
}

async function generateAllSignals() {
  const freshSignals = [];
  for (const pair of PAIRS) {
    for (const tf of TIMEFRAMES) {
      const candles = await fetchCandles(pair.symbol, tf);
      if (!candles || candles.length < 50) continue;
      const closes = candles.map(c => c.close);
      const volumes = candles.map(c => c.volume);
      const currentPrice = closes[closes.length - 1];
      // Skip if price invalid
      if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
        console.log(`Skipping ${pair.symbol} due to invalid price: ${currentPrice}`);
        continue;
      }
      const rsiRaw = (() => {
        let g = 0, l = 0;
        for (let i = 1; i <= 14; i++) { const diff = closes[i] - closes[i-1]; if (diff>=0) g+=diff; else l-=diff; }
        let ag = g/14, al = l/14;
        for (let i = 15; i < closes.length; i++) {
          const diff = closes[i] - closes[i-1];
          ag = (ag*13 + (diff>0?diff:0))/14; al = (al*13 + (diff<0?-diff:0))/14;
        }
        return 100 - (100/(1+ag/(al||1e-10)));
      })();
      const macdHist = (() => {
        const em = (d,p) => { const k=2/(p+1); const r=[d[0]]; for(let i=1;i<d.length;i++) r.push(d[i]*k+r[i-1]*(1-k)); return r; };
        const e12 = em(closes,12), e26 = em(closes,26);
        const macdL = e12.map((v,i)=>v-e26[i]);
        const sig = em(macdL,9);
        return macdL[macdL.length-1] - sig[sig.length-1];
      })();
      const lastVol = volumes[volumes.length-1];
      const volSma = volumes.length>10 ? volumes.slice(-10).reduce((a,b)=>a+b,0)/10 : lastVol;
      const volumeSpike = lastVol > volSma * 1.5;
      const ma20 = closes.length>=20 ? closes.slice(-20).reduce((a,b)=>a+b,0)/20 : closes[closes.length-1];
      const priceVsMa = currentPrice > ma20 ? 'above' : 'below';

      const signal = generateConsensusSignal(candles, currentPrice, rsiRaw, macdHist, volumeSpike, priceVsMa);
      if (signal) {
        freshSignals.push({
          id: Date.now() + Math.random(),
          pair: pair.name, symbol: pair.symbol, timeframe: tf,
          ...signal,
          rsi: rsiRaw, macd: macdHist, volumeSpike,
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
      console.log('No signals (filters too strict or invalid prices)');
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
      const price = candles[candles.length-1].close;
      if (price && !isNaN(price) && price > 0) prices[pair.symbol.replace('USDT','')] = price;
    }
  }
  res.json(prices);
});
app.post('/api/autotrade', (req, res) => res.json({ success: true }));

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('new_signals', latestSignals);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
