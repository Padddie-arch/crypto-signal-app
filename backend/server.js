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
const MEXC_TICKER_URL = 'https://api.mexc.com/api/v3/ticker/price';
const MEXC_KLINE_URL = 'https://api.mexc.com/api/v3/klines';
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || '';   // ⬅️ add your key here
const TWELVE_DATA_URL = 'https://api.twelvedata.com/time_series';

// Crypto pairs (MEXC)
const CRYPTO_PAIRS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','XLMUSDT','LINKUSDT','LTCUSDT',
  'SUIUSDT','POLUSDT','NEARUSDT','UNIUSDT','TAOUSDT',
  'SHIBUSDT','APTUSDT','ZECUSDT','CAKEUSDT','AVAXUSDT','TRXUSDT'
].map(symbol => ({ symbol, name: symbol.replace('USDT', '/USD'), type: 'crypto' }));

// Metals & Forex pairs (Twelve Data only – no simulator)
const OTHER_PAIRS = [
  // Metals (Twelve Data symbols use no slash)
   // Metals (Twelve Data symbols use no slash)
  { symbol: 'XAU/USD', name: 'XAU/USD', tdSymbol: 'XAUUSD', type: 'metal' },
  { symbol: 'XAG/USD', name: 'XAG/USD', tdSymbol: 'XAGUSD', type: 'metal' },
  // Major Forex
  { symbol: 'EUR/USD', name: 'EUR/USD', tdSymbol: 'EUR/USD', type: 'forex' },
  { symbol: 'GBP/USD', name: 'GBP/USD', tdSymbol: 'GBP/USD', type: 'forex' },
  { symbol: 'USD/JPY', name: 'USD/JPY', tdSymbol: 'USD/JPY', type: 'forex' },
  { symbol: 'USD/CHF', name: 'USD/CHF', tdSymbol: 'USD/CHF', type: 'forex' },
  { symbol: 'AUD/USD', name: 'AUD/USD', tdSymbol: 'AUD/USD', type: 'forex' },
  { symbol: 'USD/CAD', name: 'USD/CAD', tdSymbol: 'USD/CAD', type: 'forex' },
  { symbol: 'NZD/USD', name: 'NZD/USD', tdSymbol: 'NZD/USD', type: 'forex' }
];

const ALL_PAIRS = [...CRYPTO_PAIRS, ...OTHER_PAIRS];

const TIMEFRAMES = ['1h', '4h'];
const INTERVAL_MAP = { '1h': '60m', '4h': '4h' };

// ========== RATE LIMITERS ==========
let lastRequestTime = 0;
const MIN_GAP = 200; // MEXC (200ms)

async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, {
    params,
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json'
    }
  });
}

// Twelve Data rate limiter (800 req/day, safe with 8 seconds gap)
let lastTDRequestTime = 0;
const TD_MIN_GAP = 8000; // 8 seconds

async function tdGet(url, params) {
  const now = Date.now();
  const wait = lastTDRequestTime + TD_MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastTDRequestTime = Date.now();
  return axios.get(url, {
    params,
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json'
    }
  });
}

// ========== CACHES ==========
const klineCache = {};
const KLINE_CACHE_TTL = 5 * 60 * 1000;          // 5 minutes for crypto
const TD_KLINE_CACHE_TTL = 15 * 60 * 1000;      // 15 minutes for Twelve Data
const priceCache = {};
const PRICE_CACHE_TTL = 30 * 1000;               // 30 seconds for crypto prices
const TD_PRICE_CACHE_TTL = 2 * 60 * 1000;        // 2 minutes for Twelve Data prices

// ========== LIVE PRICE ==========
async function fetchLivePrice(pair) {
  const cacheKey = `price_${pair.symbol}`;
  const now = Date.now();
  if (priceCache[cacheKey] && (now - priceCache[cacheKey].timestamp) < PRICE_CACHE_TTL) {
    return priceCache[cacheKey].price;
  }

  if (pair.type === 'crypto') {
    // MEXC ticker
    try {
      const res = await rateLimitedGet(MEXC_TICKER_URL, { symbol: pair.symbol });
      const price = parseFloat(res.data?.price);
      if (!price || isNaN(price) || price <= 0) throw new Error('Invalid price');
      priceCache[cacheKey] = { price, timestamp: now };
      return price;
    } catch (err) {
      console.error(`❌ Live price failed for ${pair.symbol}: ${err.message}`);
      return null;
    }
  } else {
    // Metals / Forex: Twelve Data only
    if (!TWELVE_DATA_KEY) {
      console.log(`Skipping ${pair.symbol} – no Twelve Data API key`);
      return null;
    }
    const cacheKey = `tdprice_${pair.tdSymbol}`;
    const now = Date.now();
    if (priceCache[cacheKey] && (now - priceCache[cacheKey].timestamp) < TD_PRICE_CACHE_TTL) {
      return priceCache[cacheKey].price;
    }
    try {
      const res = await tdGet(TWELVE_DATA_URL, {
        symbol: pair.tdSymbol,          // use tdSymbol
        interval: '1min',
        outputsize: 1,
        apikey: TWELVE_DATA_KEY,
        format: 'JSON'
      });
      const values = res.data?.values;
      const price = values ? parseFloat(values[0].close) : null;
      if (price && !isNaN(price) && price > 0) {
        priceCache[cacheKey] = { price, timestamp: now };
        return price;
      }
      throw new Error('Invalid price from Twelve Data');
    } catch (err) {
      console.error(`❌ Live price failed for ${pair.symbol}: ${err.message}`);
      return null;
    }
  }
}

// ========== CANDLES ==========
async function fetchCandles(pair, interval, minCandles = 50) {
  const cacheKey = `kline_${pair.symbol}_${interval}`;
  const now = Date.now();
  if (klineCache[cacheKey] && (now - klineCache[cacheKey].timestamp) < KLINE_CACHE_TTL) {
    return klineCache[cacheKey].data;
  }

  if (pair.type === 'crypto') {
    // MEXC klines
    try {
      const res = await rateLimitedGet(MEXC_KLINE_URL, {
        symbol: pair.symbol,
        interval: INTERVAL_MAP[interval],
        limit: Math.max(100, minCandles)
      });
      const klines = res.data;
      if (!klines || klines.length < minCandles) {
        console.error(`⚠️ Not enough MEXC candles for ${pair.symbol} ${interval}`);
        return null;
      }
      const candles = klines.map(k => ({
        timestamp: k[0],
        open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
        close: parseFloat(k[4]), volume: parseFloat(k[5])
      }));
      candles.reverse();
      klineCache[cacheKey] = { data: candles, timestamp: now };
      return candles;
    } catch (err) {
      console.error(`❌ MEXC kline failed for ${pair.symbol}: ${err.message}`);
      return null;
    }
  } else {
    // Metals / Forex: Twelve Data only
    if (!TWELVE_DATA_KEY) {
      console.log(`Skipping ${pair.symbol} candles – no Twelve Data API key`);
      return null;
    }
    const cacheKey = `tdkline_${pair.tdSymbol}_${interval}`;
    const now = Date.now();
    if (klineCache[cacheKey] && (now - klineCache[cacheKey].timestamp) < TD_KLINE_CACHE_TTL) {
      return klineCache[cacheKey].data;
    }
    try {
      const res = await tdGet(TWELVE_DATA_URL, {
        symbol: pair.tdSymbol,          // use tdSymbol
        interval: interval === '1h' ? '1h' : '4h',
        outputsize: minCandles,
        apikey: TWELVE_DATA_KEY,
        format: 'JSON'
      });
      const values = res.data?.values;
      if (values && values.length >= minCandles) {
        const candles = values.reverse().map(c => ({
          timestamp: c.datetime,
          open: parseFloat(c.open), high: parseFloat(c.high),
          low: parseFloat(c.low), close: parseFloat(c.close),
          volume: parseFloat(c.volume || 0)
        }));
        klineCache[cacheKey] = { data: candles, timestamp: now };
        return candles;
      }
      throw new Error('Not enough candles');
    } catch (err) {
      console.error(`❌ Twelve Data candles failed for ${pair.symbol}: ${err.message}`);
      return null;
    }
  }
}

// ========== TECHNICAL INDICATORS (all 11) ==========
function ema(data, period) {
  if (data.length < period) return [data[data.length - 1]];
  const k = 2 / (period + 1);
  const res = [data[0]];
  for (let i = 1; i < data.length; i++) res.push(data[i] * k + res[i - 1] * (1 - k));
  return res;
}

function rsiArr(closes, period = 14) {
  if (closes.length < period + 1) return Array(closes.length).fill(50);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  const result = [100 - (100 / (1 + avgGain / (avgLoss || 1e-10)))];
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
    result.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  }
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
  const atrSmooth = [tr[0]], plusSmooth = [plusDM[0]], minusSmooth = [minusDM[0]];
  for (let i = 1; i < tr.length; i++) {
    atrSmooth.push((atrSmooth[i - 1] * (period - 1) + tr[i]) / period);
    plusSmooth.push((plusSmooth[i - 1] * (period - 1) + plusDM[i]) / period);
    minusSmooth.push((minusSmooth[i - 1] * (period - 1) + minusDM[i]) / period);
  }
  const diPlus = plusSmooth.map((v, i) => (v / atrSmooth[i]) * 100);
  const diMinus = minusSmooth.map((v, i) => (v / atrSmooth[i]) * 100);
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
  const rsi = rsiArr(closes, period);
  const recent = rsi.slice(-period);
  const min = Math.min(...recent), max = Math.max(...recent);
  if (max === min) return 50;
  return ((rsi[rsi.length - 1] - min) / (max - min)) * 100;
}

function ichimoku(candles) {
  if (candles.length < 52) return { vote: 0 };
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const tenkan = (Math.max(...highs.slice(-9)) + Math.min(...lows.slice(-9))) / 2;
  const kijun = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
  let vote = 0;
  if (tenkan > kijun) vote = 1; else if (tenkan < kijun) vote = -1;
  return { vote };
}

function bollingerPercentB(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { vote: 0 };
  const ma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const variance = closes.slice(-period).reduce((s, v) => s + (v - ma) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = ma + stdDev * std, lower = ma - stdDev * std;
  const b = (closes[closes.length - 1] - lower) / (upper - lower || 1e-10);
  let vote = 0;
  if (b < 0.2) vote = 1; else if (b > 0.8) vote = -1;
  return { vote };
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
  if (aroonUp > aroonDown + 20) vote = 1; else if (aroonDown > aroonUp + 20) vote = -1;
  return { vote };
}

function candlestickPattern(candles) {
  if (candles.length < 2) return { vote: 0, pattern: '' };
  const last = candles[candles.length - 1], prev = candles[candles.length - 2];
  const body = last.close - last.open, prevBody = prev.close - prev.open;
  let vote = 0, pattern = '';
  if (prevBody < 0 && body > 0 && last.close > prev.open && last.open < prev.close) {
    vote = 1; pattern = 'Bull Engulf';
  } else if (prevBody > 0 && body < 0 && last.close < prev.open && last.open > prev.close) {
    vote = -1; pattern = 'Bear Engulf';
  } else if (body > 0 && (last.low < last.open - body * 2) && (last.close - last.low) > 2 * Math.abs(body)) {
    vote = 1; pattern = 'Hammer';
  } else if (body < 0 && (last.high > last.open - body * 2) && (last.high - last.close) > 2 * Math.abs(body)) {
    vote = -1; pattern = 'Shoot Star';
  }
  return { vote, pattern };
}

function rsiDivergence(candles, period = 14) {
  if (candles.length < 20) return { vote: 0, divergence: '' };
  const closes = candles.map(c => c.close);
  const rsi = rsiArr(closes, period);
  const pw = closes.slice(-10), rw = rsi.slice(-10);
  let vote = 0, divergence = '';
  const priceMinIdx = pw.indexOf(Math.min(...pw));
  const rsiMinIdx = rw.indexOf(Math.min(...rw));
  if (priceMinIdx === pw.length - 1 && rsiMinIdx !== pw.length - 1 && rw[priceMinIdx] > Math.min(...rw)) {
    vote = 1; divergence = 'bullish';
  }
  const priceMaxIdx = pw.indexOf(Math.max(...pw));
  const rsiMaxIdx = rw.indexOf(Math.max(...rw));
  if (priceMaxIdx === pw.length - 1 && rsiMaxIdx !== pw.length - 1 && rw[priceMaxIdx] < Math.max(...rw)) {
    vote = -1; divergence = 'bearish';
  }
  return { vote, divergence };
}

function vwap(candles) {
  let sumTPV = 0, sumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    sumTPV += tp * (c.volume || 1);
    sumVol += (c.volume || 1);
  }
  return sumVol > 0 ? sumTPV / sumVol : candles[candles.length - 1].close;
}

// ========== SIGNAL GENERATION ==========
function generateSignal(pair, candles, interval, livePrice) {
  const closes = candles.map(c => c.close);
  const currentPrice = livePrice;
  if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) return null;

  const rsiVals = rsiArr(closes, 14);
  const lastRSI = rsiVals[rsiVals.length - 1];
  const macdRes = (() => {
    const e12 = ema(closes, 12), e26 = ema(closes, 26);
    const macdL = e12.map((v, i) => v - e26[i]);
    const sig = ema(macdL, 9);
    return { hist: (macdL[macdL.length - 1] || 0) - (sig[sig.length - 1] || 0) };
  })();
  const adxRes = adx(candles, 14);
  const stoch = stochRSI(closes, 14);
  const ichi = ichimoku(candles);
  const boll = bollingerPercentB(closes, 20, 2);
  const aroonRes = aroon(candles, 14);
  const candlePat = candlestickPattern(candles);
  const div = rsiDivergence(candles, 14);
  const vwapVal = vwap(candles);
  const currentATR = atr(candles, 14) || currentPrice * 0.01;
  const volumeSpike = (() => {
    const vols = candles.map(c => c.volume);
    const lastVol = vols[vols.length - 1];
    const sma = vols.length > 10 ? vols.slice(-10).reduce((a, b) => a + b, 0) / 10 : lastVol;
    return lastVol > sma * 1.5;
  })();

  // 11 votes
  let rsiVote = 0, macdVote = 0, emaVote = 0, adxVote = 0, volVote = 0, stochVote = 0,
      ichiVote = 0, bollVote = 0, aroonVote = 0, candleVote = 0, divVote = 0;

  if (lastRSI < 30) rsiVote = 1; else if (lastRSI > 70) rsiVote = -1;
  if (macdRes.hist > 0) macdVote = 1; else if (macdRes.hist < 0) macdVote = -1;
  const ema9 = ema(closes, 9), ema21 = ema(closes, 21);
  emaVote = ema9[ema9.length - 1] > ema21[ema21.length - 1] ? 1 : -1;
  if (adxRes.adx > 25) adxVote = adxRes.plusDI > adxRes.minusDI ? 1 : -1;
  if (volumeSpike) { volVote = currentPrice > closes[closes.length - 2] ? 1 : -1; }
  if (stoch < 20) stochVote = 1; else if (stoch > 80) stochVote = -1;
  ichiVote = ichi.vote || 0;
  bollVote = boll.vote || 0;
  aroonVote = aroonRes.vote || 0;
  candleVote = candlePat.vote || 0;
  divVote = div.vote || 0;

  const votes = [rsiVote, macdVote, emaVote, adxVote, volVote, stochVote, ichiVote, bollVote, aroonVote, candleVote, divVote];
  const buyVotes = votes.filter(v => v === 1).length;
  const sellVotes = votes.filter(v => v === -1).length;
  const totalActive = votes.filter(v => v !== 0).length;
  if (totalActive < 3) return null;

  const aligned = Math.max(buyVotes, sellVotes);
  const confidence = Math.round((aligned / 11) * 100);
  const direction = buyVotes > sellVotes ? 'BUY' : 'SELL';

  if (adxRes.adx <= 25) return null;
  if (direction === 'BUY' && currentPrice <= vwapVal) return null;
  if (direction === 'SELL' && currentPrice >= vwapVal) return null;

  const stopLoss = direction === 'BUY' ? currentPrice - currentATR * 1.5 : currentPrice + currentATR * 1.5;
  const takeProfit = direction === 'BUY' ? currentPrice + currentATR * 3 : currentPrice - currentATR * 3;
  const trailingStop = direction === 'BUY' ? currentPrice - currentATR * 1.0 : currentPrice + currentATR * 1.0;

  return {
    direction, confidence, aligned, totalActive, totalStrategies: 11,
    price: currentPrice, stopLoss, takeProfit, trailingStop,
    rsi: lastRSI, macd: macdRes.hist, volumeSpike,
    adx: adxRes.adx, vwap: vwapVal,
    divergence: div.divergence || '', pattern: candlePat.pattern || '',
    timestamp: new Date().toISOString()
  };
}

// ========== PUSH NOTIFICATIONS ==========
async function sendPushNotifications(signals) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return;

  const highAlign = signals.filter(s => s.aligned >= 8);
  if (highAlign.length === 0) return;

  const top = highAlign.slice(0, 3).map(s => `${s.pair} ${s.direction} (${s.aligned}/11)`).join(', ');
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: appId,
      included_segments: ['All'],
      contents: { en: `🔥 ${highAlign.length} strong signal(s): ${top}` },
      headings: { en: 'High‑Confidence Alert' }
    }, {
      headers: { Authorization: `Basic ${apiKey}` }
    });
    console.log('✅ Push notification sent');
  } catch (err) {
    console.error('❌ Push notification failed:', err.response?.data || err.message);
  }
}

// ========== MAIN GENERATION ==========
async function generateAllSignals() {
  const freshSignals = [];
  for (const pair of ALL_PAIRS) {
    const livePrice = await fetchLivePrice(pair);
    if (!livePrice) continue;
    for (const tf of TIMEFRAMES) {
      const candles = await fetchCandles(pair, tf);
      if (!candles || candles.length < 50) continue;
      const signal = generateSignal(pair, candles, tf, livePrice);
      if (signal) {
        signal.id = Date.now() + Math.random();
        signal.pair = pair.name;
        signal.symbol = pair.symbol;
        signal.timeframe = tf;
        signal.status = 'open';
        signal.outcome = null;
        freshSignals.push(signal);
      }
    }
  }
  console.log(`📊 Signals generated: ${freshSignals.length}`);
  return freshSignals;
}

let latestSignals = [];
let signalHistory = [];
const MAX_HISTORY = 500;

async function tick() {
  console.log('Generating signals with live prices...');
  try {
    const newSignals = await generateAllSignals();
    if (newSignals.length) {
      latestSignals = newSignals;
      signalHistory = [...signalHistory, ...newSignals].slice(-MAX_HISTORY);
      io.emit('new_signals', latestSignals);
      sendPushNotifications(newSignals);
      console.log(`${newSignals.length} signals emitted`);
    } else {
      console.log('No signals – filters too strict.');
    }
  } catch (err) {
    console.error('Signal generation error:', err);
  }
}

setTimeout(tick, 10000);
setInterval(tick, 5 * 60 * 1000);

// ========== ROUTES ==========
app.get('/api/signals', (req, res) => res.json(latestSignals));
app.get('/api/history', (req, res) => res.json(signalHistory));
app.get('/api/stats', (req, res) => {
  const closed = signalHistory.filter(t => t.outcome);
  const wins = closed.filter(t => t.outcome === 'win').length;
  res.json({ wins, total: closed.length, winRate: closed.length ? ((wins / closed.length) * 100).toFixed(1) : 0 });
});
app.get('/api/prices', async (req, res) => {
  const prices = {};
  for (const pair of ALL_PAIRS) {
    const livePrice = await fetchLivePrice(pair);
    if (livePrice !== null) {
      const key = pair.symbol.replace('/', '');
      prices[key] = livePrice;
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
