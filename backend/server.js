require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');
const rssParser = new Parser();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('webapp'));

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// ========== CONFIGURATION ==========
const MEXC_TICKER_URL = 'https://api.mexc.com/api/v3/ticker/price';
const MEXC_KLINE_URL = 'https://api.mexc.com/api/v3/klines';

const RSS_FEEDS = [
  'https://cryptopanic.com/news/rss/',
  'https://www.coindesk.com/arc/outboundfeeds/rss/'
];

const PAIRS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','XLMUSDT','LINKUSDT','LTCUSDT',
  'SUIUSDT','POLUSDT','NEARUSDT','UNIUSDT','TAOUSDT',
  'SHIBUSDT','APTUSDT','ZECUSDT','CAKEUSDT','AVAXUSDT','TRXUSDT'
].map(symbol => ({ symbol, name: symbol.replace('USDT', '/USD') }));

const TIMEFRAMES = ['1h', '4h', '5m', '15m'];
const INTERVAL_MAP = { '1h': '60m', '4h': '4h', '5m': '5m', '15m': '15m' };

// ========== RATE LIMITER ==========
let lastRequestTime = 0;
const MIN_GAP = 400;

async function mexcGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { params, timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
}

// ========== CACHES ==========
const klineCache = {};
const KLINE_CACHE_TTL = 10 * 60 * 1000;
const priceCache = {};
const PRICE_CACHE_TTL = 30 * 1000;
let newsCache = { headlines: [], timestamp: 0 };
const NEWS_CACHE_TTL = 15 * 60 * 1000;
const cooldown = {};

// ========== LIVE PRICE ==========
async function fetchLivePrice(symbol) {
  const cacheKey = `price_${symbol}`;
  const now = Date.now();
  if (priceCache[cacheKey] && (now - priceCache[cacheKey].timestamp) < PRICE_CACHE_TTL) return priceCache[cacheKey].price;
  try {
    const res = await mexcGet(MEXC_TICKER_URL, { symbol });
    const price = parseFloat(res.data?.price);
    if (!price || isNaN(price) || price <= 0) throw new Error('Invalid price');
    priceCache[cacheKey] = { price, timestamp: now };
    return price;
  } catch (err) {
    console.error(`❌ Live price failed for ${symbol}: ${err.message}`);
    return null;
  }
}

// ========== CANDLES ==========
async function fetchCandles(symbol, interval, minCandlesParam) {
  const isShort = (interval === '5m' || interval === '15m');
  const minCandles = minCandlesParam !== undefined ? minCandlesParam : (isShort ? 30 : 50);
  const cacheKey = `kline_${symbol}_${interval}`;
  const now = Date.now();
  if (klineCache[cacheKey] && (now - klineCache[cacheKey].timestamp) < KLINE_CACHE_TTL) return klineCache[cacheKey].data;
  try {
    const res = await mexcGet(MEXC_KLINE_URL, { symbol, interval: INTERVAL_MAP[interval], limit: Math.max(100, minCandles) });
    const klines = res.data;
    if (!klines || klines.length < minCandles) {
      console.error(`⚠️ Not enough candles for ${symbol} ${interval}`);
      return null;
    }
    const candles = klines.map(k => ({
      timestamp: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5])
    }));
    candles.reverse();
    klineCache[cacheKey] = { data: candles, timestamp: now };
    return candles;
  } catch (err) {
    console.error(`❌ Kline failed for ${symbol} ${interval}: ${err.message}`);
    return null;
  }
}

// ========== RSS NEWS FETCHER ==========
const coinAliases = {
  BTC: ['BTC', 'Bitcoin', 'XBT'],
  ETH: ['ETH', 'Ethereum'],
  SOL: ['SOL', 'Solana'],
  BNB: ['BNB', 'Binance Coin'],
  XRP: ['XRP', 'Ripple'],
  ADA: ['ADA', 'Cardano'],
  DOGE: ['DOGE', 'Dogecoin'],
  XLM: ['XLM', 'Stellar'],
  LINK: ['LINK', 'Chainlink'],
  LTC: ['LTC', 'Litecoin'],
  SUI: ['SUI'],
  POL: ['POL', 'Polygon'],
  NEAR: ['NEAR'],
  UNI: ['UNI', 'Uniswap'],
  TAO: ['TAO', 'Bittensor'],
  SHIB: ['SHIB', 'Shiba Inu'],
  APT: ['APT', 'Aptos'],
  ZEC: ['ZEC', 'Zcash'],
  CAKE: ['CAKE', 'PancakeSwap'],
  AVAX: ['AVAX', 'Avalanche'],
  TRX: ['TRX', 'TRON']
};
const positiveWords = ['surge','rally','bull','buy','gain','rise','high','green','up','record','jump'];
const negativeWords = ['crash','drop','bear','sell','loss','fall','low','red','down','plunge','decline'];

function getSentimentStrength(headlines) {
  let pos = 0, neg = 0;
  headlines.forEach(h => {
    const lower = h.toLowerCase();
    pos += positiveWords.filter(w => lower.includes(w)).length;
    neg += negativeWords.filter(w => lower.includes(w)).length;
  });
  return { sentiment: pos > neg ? 1 : neg > pos ? -1 : 0, strength: Math.abs(pos - neg) };
}

async function fetchAllNews() {
  const now = Date.now();
  if (newsCache.headlines.length && (now - newsCache.timestamp) < NEWS_CACHE_TTL) return newsCache.headlines;
  let allHeadlines = [];
  for (const feed of RSS_FEEDS) {
    try {
      const feedData = await rssParser.parseURL(feed);
      const titles = feedData.items.map(i => i.title);
      allHeadlines = allHeadlines.concat(titles);
    } catch (err) {
      console.error(`RSS feed ${feed} failed: ${err.message}`);
    }
  }
  newsCache = { headlines: allHeadlines, timestamp: now };
  return allHeadlines;
}

async function fetchNewsSentiment(coinSymbol) {
  const base = coinSymbol.replace('USDT', '');
  const aliases = coinAliases[base] || [base];
  const allHeadlines = await fetchAllNews();
  const relevant = allHeadlines.filter(h => aliases.some(a => h.toLowerCase().includes(a.toLowerCase())));
  if (relevant.length === 0) return { sentiment: 0, headlines: [], strength: 0 };
  const { sentiment, strength } = getSentimentStrength(relevant);
  return { sentiment, headlines: relevant.slice(0, 5), strength };
}

// ========== TECHNICAL INDICATORS ==========
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
  if (candles.length < period + 1) return { adx: 0, plusDI: 0, minusDI: 0, adxPrev: 0 };
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
  return { adx: adxArr[last] || 0, adxPrev: adxArr[last - 1] || 0, plusDI: diPlus[last] || 0, minusDI: diMinus[last] || 0 };
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
  if (closes.length < period) return { vote: 0, bValue: 0.5 };
  const ma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const variance = closes.slice(-period).reduce((s, v) => s + (v - ma) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = ma + stdDev * std, lower = ma - stdDev * std;
  const b = (closes[closes.length - 1] - lower) / (upper - lower || 1e-10);
  let vote = 0;
  if (b < 0.2) vote = 1; else if (b > 0.8) vote = -1;
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

// ========== DYNAMIC STOP LOSS ==========
function dynamicStopLoss(candles, direction, currentPrice, currentATR) {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const recentHigh = Math.max(...highs.slice(-21, -1));
  const recentLow = Math.min(...lows.slice(-21, -1));
  if (direction === 'BUY') {
    const structureStop = recentLow - currentATR * 0.5;
    const atrStop = currentPrice - currentATR * 1.0;
    return Math.max(structureStop, atrStop);
  } else {
    const structureStop = recentHigh + currentATR * 0.5;
    const atrStop = currentPrice + currentATR * 1.0;
    return Math.min(structureStop, atrStop);
  }
}

// ========== SIGNAL GENERATION ==========
async function generateSignal(pair, candles, interval, livePrice) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const currentPrice = livePrice;
  if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) return null;

  const currentATR = atr(candles, 14);
  const is4h = (interval === '4h');
  const is1h = (interval === '1h');
  const isShortTF = (interval === '5m' || interval === '15m');

  const atrThreshold = isShortTF ? 0.003 : 0.005;
  if (currentATR / currentPrice < atrThreshold) return null;

  const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const lastVolume = volumes[volumes.length - 1];
  if (lastVolume < avgVolume20) return null;
  if (is4h || is1h) {
    const prevVolume = volumes[volumes.length - 2];
    if (lastVolume <= prevVolume) return null;
  }

  const news = await fetchNewsSentiment(pair.symbol);
  const newsVote = (news.headlines.length >= 3 && news.strength >= 2) ? news.sentiment : 0;

  let baseADX;
  if (interval === '4h') baseADX = 22;
  else if (interval === '1h') baseADX = 18;
  else if (interval === '15m') baseADX = 12;
  else if (interval === '5m') baseADX = 10;

  const baseMinActive = is4h ? 4 : (is1h ? 3 : 2);

  const rsiOversold = isShortTF ? 20 : 25;
  const rsiOverbought = isShortTF ? 80 : 75;
  const stochOversold = isShortTF ? 10 : 15;
  const stochOverbought = isShortTF ? 90 : 85;
  const bollOversold = isShortTF ? 0.1 : 0.15;
  const bollOverbought = isShortTF ? 0.9 : 0.85;

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

  let rsiVote = 0, macdVote = 0, emaVote = 0, adxVote = 0, volVote = 0, stochVote = 0,
      ichiVote = 0, bollVote = 0, aroonVote = 0, candleVote = 0, divVote = 0;

  if (lastRSI < rsiOversold) rsiVote = 1; else if (lastRSI > rsiOverbought) rsiVote = -1;
  if (macdRes.hist > 0) macdVote = 1; else if (macdRes.hist < 0) macdVote = -1;
  const ema9 = ema(closes, 9), ema21 = ema(closes, 21);
  emaVote = ema9[ema9.length - 1] > ema21[ema21.length - 1] ? 1 : -1;
  if (adxRes.adx > baseADX) adxVote = adxRes.plusDI > adxRes.minusDI ? 1 : -1;
  const volumeSpike = lastVolume > avgVolume20 * 1.5;
  if (volumeSpike && closes.length > 1) volVote = currentPrice > closes[closes.length - 2] ? 1 : -1;
  if (stoch < stochOversold) stochVote = 1; else if (stoch > stochOverbought) stochVote = -1;
  ichiVote = ichi.vote || 0;
  if (boll.bValue < bollOversold) bollVote = 1; else if (boll.bValue > bollOverbought) bollVote = -1;
  aroonVote = aroonRes.vote || 0;
  candleVote = candlePat.vote || 0;
  divVote = div.vote || 0;

  const TOTAL_STRATEGIES = 12;
  const votes = [rsiVote, macdVote, emaVote, adxVote, volVote, stochVote, ichiVote, bollVote, aroonVote, candleVote, divVote, newsVote];
  const buyVotes = votes.filter(v => v === 1).length;
  const sellVotes = votes.filter(v => v === -1).length;
  const totalActive = votes.filter(v => v !== 0).length;
  if (totalActive < baseMinActive) return null;

  const aligned = Math.max(buyVotes, sellVotes);
  const confidence = Math.round((aligned / TOTAL_STRATEGIES) * 100);
  const direction = buyVotes > sellVotes ? 'BUY' : 'SELL';

  const ema50 = ema(closes, 50);
  const recentEma50 = ema50.slice(-5);
  const slope50 = recentEma50[4] - recentEma50[0];
  const trendDir = slope50 > 0 ? 'up' : slope50 < 0 ? 'down' : 'flat';
  if (direction === 'BUY' && trendDir === 'down') return null;
  if (direction === 'SELL' && trendDir === 'up') return null;
  if (is4h && trendDir === 'flat') return null;

  if (direction === 'BUY' && currentPrice <= vwapVal) return null;
  if (direction === 'SELL' && currentPrice >= vwapVal) return null;

  if (!isShortTF) {
    const lastCandle = candles[candles.length - 1];
    if (direction === 'BUY' && lastCandle.close <= lastCandle.open) return null;
    if (direction === 'SELL' && lastCandle.close >= lastCandle.open) return null;
  }

  const cooldownKey = `${pair.symbol}_${interval}`;
  const lastFire = cooldown[cooldownKey] || 0;
  const candleMs = interval === '1h' ? 3600000 : interval === '4h' ? 14400000 : interval === '15m' ? 900000 : 300000;
  if (Date.now() - lastFire < candleMs) return null;
  cooldown[cooldownKey] = Date.now();

  const stopLoss = dynamicStopLoss(candles, direction, currentPrice, currentATR);
  const takeProfit = direction === 'BUY' ? currentPrice + currentATR * 3.0 : currentPrice - currentATR * 3.0;
  const trailingStop = direction === 'BUY' ? currentPrice - currentATR * 1.0 : currentPrice + currentATR * 1.0;
  const dcaPrice = direction === 'BUY' ? currentPrice - currentATR * 1.0 : currentPrice + currentATR * 1.0;
  const priceChange5 = closes.length >= 6 ? ((currentPrice - closes[closes.length - 6]) / closes[closes.length - 6] * 100).toFixed(2) : '0.00';

  return {
    direction, confidence, aligned, totalActive, totalStrategies: TOTAL_STRATEGIES,
    price: currentPrice, stopLoss, takeProfit, trailingStop,
    dcaPrice,
    rsi: lastRSI, macd: macdRes.hist, volumeSpike,
    adx: adxRes.adx, vwap: vwapVal,
    divergence: div.divergence || '', pattern: candlePat.pattern || '',
    newsHeadlines: news.headlines,
    trendDir,
    priceChange5,
    timestamp: new Date().toISOString()
  };
}

// ========== TRADE OUTCOME TRACKER ==========
async function updateTradeOutcomes() {
  const now = Date.now();
  for (const signal of signalHistory) {
    if (signal.status !== 'open' || signal.type === 'meme_coin') continue;
    const signalTime = new Date(signal.timestamp).getTime();
    const timeframeMs = (signal.timeframe === '1h') ? 3600000 : (signal.timeframe === '4h') ? 14400000 : (signal.timeframe === '15m') ? 900000 : 300000;
    if (now - signalTime < timeframeMs) continue;

    const livePrice = await fetchLivePrice(signal.symbol);
    if (!livePrice) continue;

    if (signal.direction === 'BUY') {
      if (livePrice <= signal.stopLoss) { signal.status = 'closed'; signal.outcome = 'loss'; }
      else if (livePrice >= signal.takeProfit) { signal.status = 'closed'; signal.outcome = 'win'; }
    } else {
      if (livePrice >= signal.stopLoss) { signal.status = 'closed'; signal.outcome = 'loss'; }
      else if (livePrice <= signal.takeProfit) { signal.status = 'closed'; signal.outcome = 'win'; }
    }
  }
}

// ========== EMAIL NOTIFICATIONS (Brevo) ==========
async function sendEmailNotifications(signals) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return;

  const highConf = signals.filter(s => (s.timeframe === '1h' || s.timeframe === '4h') && s.aligned >= 3);
  if (highConf.length === 0) return;

  const top = highConf.slice(0, 3).map(s => `${s.pair} ${s.direction} (${s.aligned}/12)`).join(', ');
  const html = `<h3>New 1h/4h Signals</h3><p>${top}</p><p>Check your app for details.</p>`;

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Crypto Signals', email: process.env.ALERT_EMAIL },
      to: [{ email: process.env.ALERT_EMAIL }],
      subject: `🔔 ${highConf.length} new signal(s)`,
      htmlContent: html
    }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });
    console.log('✅ Email sent via Brevo');
  } catch (err) {
    console.error('❌ Email failed:', err.response?.data || err.message);
  }
}

// ========== PUSH NOTIFICATIONS (lowered threshold for testing) ==========
async function sendPushNotifications(signals) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return;

  const highConf = signals.filter(s => (s.timeframe === '1h' || s.timeframe === '4h') && s.aligned >= 3);
  if (highConf.length === 0) return;

  const top = highConf.slice(0, 3).map(s => `${s.pair} ${s.direction} (${s.aligned}/12)`).join(', ');
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: appId,
      included_segments: ['All'],
      contents: { en: `🔔 ${highConf.length} signal(s): ${top}` },
      headings: { en: 'New 1h/4h Signal' }
    }, { headers: { Authorization: `Basic ${apiKey}` } });
    console.log('✅ Push notification sent');
  } catch (err) { console.error('❌ Push failed:', err.response?.data || err.message); }
}

// ========== MAIN GENERATION ==========
async function generateAllSignals() {
  const freshSignals = [];
  for (const pair of PAIRS) {
    const livePrice = await fetchLivePrice(pair.symbol);
    if (!livePrice) continue;
    for (const tf of TIMEFRAMES) {
      const candles = await fetchCandles(pair.symbol, tf);
      if (!candles || candles.length < (tf === '5m' || tf === '15m' ? 30 : 50)) continue;
      const signal = await generateSignal(pair, candles, tf, livePrice);
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
  console.log(`🔍 Signals generated (${freshSignals.length}):`);
  freshSignals.forEach(s => console.log(`   ${s.symbol} ${s.timeframe} ${s.direction} align=${s.aligned}/${s.totalStrategies}`));
  return freshSignals;
}

let latestSignals = [];
let signalHistory = [];
const MAX_HISTORY = 500;

async function tick() {
  console.log('Updating trade outcomes...');
  await updateTradeOutcomes();
  console.log('Generating signals...');
  try {
    const newSignals = await generateAllSignals();
    if (newSignals.length) {
      latestSignals = newSignals;
      signalHistory = [...signalHistory, ...newSignals].slice(-MAX_HISTORY);
      io.emit('new_signals', latestSignals);
      sendPushNotifications(newSignals);
      sendEmailNotifications(newSignals);
      console.log(`${newSignals.length} signals emitted`);
    } else {
      console.log('No signals – filters too strict.');
    }
  } catch (err) {
    console.error('Signal generation error:', err);
  }
}

setTimeout(tick, 10000);
setInterval(tick, 10 * 60 * 1000);

// TEMPORARY – test email (remove after testing)
app.get('/api/test-email', async (req, res) => {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    const alertEmail = process.env.ALERT_EMAIL;

    if (!apiKey || !alertEmail) {
      return res.json({ error: 'Missing BREVO_API_KEY or ALERT_EMAIL in environment variables' });
    }

    // Send a test email
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Crypto Signals', email: alertEmail },
      to: [{ email: alertEmail }],
      subject: 'Test email from Crypto Signals',
      htmlContent: '<p>If you receive this, Brevo is working correctly!</p>'
    }, {
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }
    });

    res.json({ success: true, message: 'Test email sent. Check your inbox.' });
  } catch (err) {
    console.error('Test email failed:', err.response?.data || err.message);
    res.json({ error: err.response?.data || err.message });
  }
});

// ========== ROUTES ==========
app.get('/api/signals', (req, res) => res.json(latestSignals));
app.get('/api/history', (req, res) => res.json(signalHistory));
app.get('/api/stats', (req, res) => {
  const closed = signalHistory.filter(t => t.outcome);
  const wins = closed.filter(t => t.outcome === 'win').length;
  res.json({ wins, total: closed.length, winRate: closed.length ? ((wins / closed.length) * 100).toFixed(1) : 0 });
});
app.get('/api/stats/1h4h', (req, res) => {
  const closed = signalHistory.filter(t => t.outcome && (t.timeframe === '1h' || t.timeframe === '4h'));
  const wins = closed.filter(t => t.outcome === 'win').length;
  res.json({ wins, total: closed.length, winRate: closed.length ? ((wins / closed.length) * 100).toFixed(1) : 0 });
});
app.get('/api/stats/alignment', (req, res) => {
  const closed = signalHistory.filter(t => t.outcome && (t.timeframe === '1h' || t.timeframe === '4h'));
  const alignmentMap = {};
  for (const s of closed) {
    const key = `${s.aligned}/${s.totalStrategies || 12}`;
    if (!alignmentMap[key]) alignmentMap[key] = { total: 0, wins: 0 };
    alignmentMap[key].total++;
    if (s.outcome === 'win') alignmentMap[key].wins++;
  }
  const result = {};
  for (const [key, val] of Object.entries(alignmentMap)) {
    result[key] = { total: val.total, wins: val.wins, winRate: ((val.wins / val.total) * 100).toFixed(1) };
  }
  res.json(result);
});
app.get('/api/stats/pairs', (req, res) => {
  const closed = signalHistory.filter(t => t.outcome && (t.timeframe === '1h' || t.timeframe === '4h'));
  const pairMap = {};
  for (const s of closed) {
    const pair = s.pair;
    if (!pairMap[pair]) pairMap[pair] = { total: 0, wins: 0 };
    pairMap[pair].total++;
    if (s.outcome === 'win') pairMap[pair].wins++;
  }
  const result = {};
  for (const [pair, val] of Object.entries(pairMap)) {
    result[pair] = { total: val.total, wins: val.wins, winRate: ((val.wins / val.total) * 100).toFixed(1) };
  }
  res.json(result);
});
app.get('/api/prices', async (req, res) => {
  const prices = {};
  for (const pair of PAIRS) {
    const livePrice = await fetchLivePrice(pair.symbol);
    if (livePrice !== null) prices[pair.symbol.replace('USDT', '')] = livePrice;
  }
  res.json(prices);
});
app.post('/api/autotrade', (req, res) => res.json({ success: true }));

io.on('connection', (socket) => { socket.emit('new_signals', latestSignals); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
