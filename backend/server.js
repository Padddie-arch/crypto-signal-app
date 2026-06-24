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
const MIN_GAP = 200; // MEXC allows 50 req/5s, 200ms gap is safe

async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { params, timeout: 10000 });
}

// ========== TECHNICAL INDICATORS ==========
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

function stochRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const rsiValues = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  }
  const recent = rsiValues.slice(-period);
  const minRSI = Math.min(...recent), maxRSI = Math.max(...recent);
  if (maxRSI === minRSI) return 50;
  return ((rsiValues[rsiValues.length - 1] - minRSI) / (maxRSI - minRSI)) * 100;
}

function ichimoku(candles) {
  if (candles.length < 52) return { vote: 0 };
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const tenkan = (Math.max(...highs.slice(-9)) + Math.min(...lows.slice(-9))) / 2;
  const kijun = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
  let vote = 0;
  if (tenkan > kijun) vote = 1;
  else if (tenkan < kijun) vote = -1;
  return { vote, tenkan, kijun };
}

function bollingerPercentB(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { vote: 0 };
  const ma = closes.slice(-period).reduce((a,b)=>a+b,0)/period;
  const variance = closes.slice(-period).reduce((sum,val)=>sum + (val-ma)**2,0)/period;
  const std = Math.sqrt(variance);
  const upper = ma + stdDev * std, lower = ma - stdDev * std;
  const b = (closes[closes.length-1] - lower) / (upper - lower || 1e-10);
  let vote = 0;
  if (b < 0.2) vote = 1;
  else if (b > 0.8) vote = -1;
  return { vote, bValue: b };
}

function aroon(candles, period = 14) {
  if (candles.length < period) return { vote: 0 };
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const lastHigh = Math.max(...highs.slice(-period)), lastLow = Math.min(...lows.slice(-period));
  const daysSinceHigh = highs.slice(-period).reverse().findIndex(h => h === lastHigh);
  const daysSinceLow = lows.slice(-period).reverse().findIndex(l => l === lastLow);
  const aroonUp = ((period - daysSinceHigh) / period) * 100;
  const aroonDown = ((period - daysSinceLow) / period) * 100;
  let vote = 0;
  if (aroonUp > aroonDown + 20) vote = 1;
  else if (aroonDown > aroonUp + 20) vote = -1;
  return { vote, aroonUp, aroonDown };
}

function candlePattern(candles) {
  if (candles.length < 2) return { vote: 0 };
  const last = candles[candles.length-1], prev = candles[candles.length-2];
  const body = last.close - last.open, prevBody = prev.close - prev.open;
  const totalRange = last.high - last.low;
  let vote = 0, pattern = '';
  if (prevBody < 0 && body > 0 && last.close > prev.open && last.open < prev.close) {
    vote = 1; pattern = 'Bull Engulf';
  } else if (prevBody > 0 && body < 0 && last.close < prev.open && last.open > prev.close) {
    vote = -1; pattern = 'Bear Engulf';
  } else if (body > 0 && last.low < last.open - body * 2 && last.close - last.low > 2*Math.abs(body)) {
    vote = 1; pattern = 'Hammer';
  } else if (body < 0 && last.high > last.open + Math.abs(body) * 2 && last.high - last.close > 2*Math.abs(body)) {
    vote = -1; pattern = 'Shoot Star';
  }
  return { vote, pattern };
}

function rsiDivergence(candles, period = 14) {
  if (candles.length < 20) return { vote: 0 };
  const closes = candles.map(c => c.close);
  // RSI array
  const rsiValues = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  }
  const priceWindow = closes.slice(-10), rsiWindow = rsiValues.slice(-10);
  let vote = 0;
  // Bullish divergence
  const priceMinIdx = priceWindow.indexOf(Math.min(...priceWindow));
  const rsiMinIdx = rsiWindow.indexOf(Math.min(...rsiWindow));
  if (priceMinIdx === priceWindow.length - 1 && rsiMinIdx !== priceWindow.length - 1) vote = 1;
  // Bearish divergence
  const priceMaxIdx = priceWindow.indexOf(Math.max(...priceWindow));
  const rsiMaxIdx = rsiWindow.indexOf(Math.max(...rsiWindow));
  if (priceMaxIdx === priceWindow.length - 1 && rsiMaxIdx !== priceWindow.length - 1) vote = -1;
  return { vote, divergence: vote !== 0 ? (vote === 1 ? 'bullish' : 'bearish') : '' };
}

function vwap(candles) {
  let sumTPV = 0, sumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    sumTPV += tp * c.volume;
    sumVol += c.volume;
  }
  return sumVol > 0 ? sumTPV / sumVol : candles[candles.length-1].close;
}

// ========== DATA FETCHING ==========
async function fetchCandles(symbol, interval) {
  if (!INTERVAL_MAP[interval]) return null;
  const cacheKey = `${symbol}_${interval}`;
  const now = Date.now();
  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) return cache[cacheKey].data;

  try {
    const res = await rateLimitedGet(MEXC_KLINE_URL, { symbol, interval: INTERVAL_MAP[interval], limit: 100 });
    const klines = res.data;
    if (!klines || klines.length < 50) return null;
    const candles = klines.map(k => ({
      timestamp: k[0],
      open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
      close: parseFloat(k[4]), volume: parseFloat(k[5])
    }));
    cache[cacheKey] = { data: candles, timestamp: now };
    return candles;
  } catch (err) {
    console.error(`MEXC fetch error for ${symbol}:`, err.message);
    return null;
  }
}

// ========== SIGNAL GENERATION ==========
function generateConsensusSignal(candles, currentPrice, rsi, macdHistogram, volumeSpike, priceVsMa) {
  const closes = candles.map(c => c.close);
  const currentATR = atr(candles, 14);
  const { adx: adxVal } = adx(candles, 14);
  const vwapValue = vwap(candles);

  // 11 strategies
  let rsiVote = 0, macdVote = 0, emaVote = 0, adxVote = 0, volVote = 0, stochVote = 0,
      ichiVote = 0, bollVote = 0, aroonVote = 0, candleVote = 0, divVote = 0;

  if (rsi < 30) rsiVote = 1; else if (rsi > 70) rsiVote = -1;
  if (macdHistogram > 0) macdVote = 1; else if (macdHistogram < 0) macdVote = -1;
  const ema9 = ema(closes, 9), ema21 = ema(closes, 21);
  emaVote = ema9[ema9.length-1] > ema21[ema21.length-1] ? 1 : -1;
  const { plusDI, minusDI } = adx(candles, 14);
  if (adxVal > 20) adxVote = plusDI > minusDI ? 1 : -1;
  if (volumeSpike) {
    const prevClose = closes[closes.length-2];
    volVote = candles[candles.length-1].close > prevClose ? 1 : -1;
  }
  const stoch = stochRSI(closes, 14);
  if (stoch < 20) stochVote = 1; else if (stoch > 80) stochVote = -1;
  const ichi = ichimoku(candles); ichiVote = ichi.vote || 0;
  const boll = bollingerPercentB(closes, 20, 2); bollVote = boll.vote || 0;
  const aroonRes = aroon(candles, 14); aroonVote = aroonRes.vote || 0;
  const pat = candlePattern(candles); candleVote = pat.vote || 0;
  const div = rsiDivergence(candles, 14); divVote = div.vote || 0;

  const votes = [rsiVote, macdVote, emaVote, adxVote, volVote, stochVote, ichiVote, bollVote, aroonVote, candleVote, divVote];
  const buyVotes = votes.filter(v => v === 1).length;
  const sellVotes = votes.filter(v => v === -1).length;
  const totalActive = votes.filter(v => v !== 0).length;
  const maxVotes = Math.max(buyVotes, sellVotes);
  if (totalActive === 0 || maxVotes / totalActive < 0.2) return null;

  const direction = buyVotes > sellVotes ? 'BUY' : 'SELL';
  // Loosened filters for now
  // if (adxVal <= 15) return null;
  // if (direction === 'BUY' && currentPrice <= vwapValue) return null;
  // if (direction === 'SELL' && currentPrice >= vwapValue) return null;

  const confidence = Math.round((maxVotes / 11) * 100);
  const stopLoss = direction === 'BUY' ? currentPrice - currentATR * 1.5 : currentPrice + currentATR * 1.5;
  const takeProfit = direction === 'BUY' ? currentPrice + currentATR * 3 : currentPrice - currentATR * 3;

  return {
    direction, confidence,
    aligned: maxVotes, totalActive, totalStrategies: 11,
    stopLoss, takeProfit, atr: currentATR, adx: adxVal, vwap: vwapValue,
    divergence: div.divergence || '', pattern: pat.pattern || '',
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
      const currentPrice = closes[closes.length-1];
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
        const hist = macdL[macdL.length-1] - sig[sig.length-1];
        return hist;
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

// ========== MAIN LOOP ==========
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
      console.log('No signals generated (filters too strict or API issues)');
    }
  } catch (err) {
    console.error('Signal generation error:', err);
  }
}

// First generation after 5 seconds (let server start), then every 60 seconds
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
    if (candles && candles.length) prices[pair.symbol.replace('USDT','')] = candles[candles.length-1].close;
  }
  res.json(prices);
});
app.post('/api/autotrade', (req, res) => res.json({ success: true }));

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('new_signals', latestSignals);
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
