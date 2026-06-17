const axios = require('axios');

const BYBIT_KLINE_URL = 'https://api.bybit.com/v5/market/kline';

const PAIRS = {
  BTCUSDT: 'BTCUSDT',
  ETHUSDT: 'ETHUSDT',
  SOLUSDT: 'SOLUSDT',
  BNBUSDT: 'BNBUSDT',
  XRPUSDT: 'XRPUSDT'
};

const INTERVAL_MAP = {
  '1h': '60',
  '4h': '240',
  '1d': 'D'
};

// Bybit allows 50 req/5 sec — we use a 200ms gap to be safe
let lastRequestTime = 0;
const MIN_GAP = 200;

async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { params, timeout: 10000 });
}

async function getIndicators(symbol, interval = '1h', limit = 50) {
  if (!PAIRS[symbol]) return null;
  const bybitInterval = INTERVAL_MAP[interval] || '60';

  try {
    const res = await rateLimitedGet(BYBIT_KLINE_URL, {
      category: 'spot',
      symbol: symbol,
      interval: bybitInterval,
      limit: limit
    });

    if (res.data.retCode !== 0) {
      console.error(`Bybit error for ${symbol}: ${res.data.retMsg}`);
      return null;
    }

    const klines = res.data.result.list;  // newest first
    if (!klines || klines.length < 20) return null;

    // Reverse to oldest first, then build candle objects
    const candles = klines.reverse().map(k => ({
      timestamp: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    // RSI (14)
    const rsi = calcRSI(closes, 14);

    // MACD
    const macdObj = calcMACD(closes);
    const macdLine = macdObj.macd;
    const signalLine = macdObj.signal;
    const histogram = macdObj.histogram;

    // Volume spike check
    const volSma = volumes.length > 10 ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10 : volumes[volumes.length - 1];
    const lastVolume = volumes[volumes.length - 1];
    const volumeSpike = lastVolume > volSma * 1.5;

    // MA20
    const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : closes[closes.length - 1];
    const currentPrice = closes[closes.length - 1];

    return {
      price: currentPrice,
      rsi,
      macd: macdLine,
      macdSignal: signalLine,
      macdHistogram: histogram,
      volumeSpike,
      ma20,
      priceVsMa: currentPrice > ma20 ? 'above' : 'below',
      rawCandles: candles   // array of objects { timestamp, open, high, low, close, volume }
    };
  } catch (err) {
    console.error(`Bybit error for ${symbol}:`, err.message);
    return null;
  }
}

// RSI calculation
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  const rs = avgGain / (avgLoss || 1e-10);
  return 100 - (100 / (1 + rs));
}

// MACD calculation
function calcMACD(closes) {
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k));
    return result;
  };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = ema(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signal[i]);
  return {
    macd: macdLine[macdLine.length - 1] || 0,
    signal: signal[signal.length - 1] || 0,
    histogram: histogram[histogram.length - 1] || 0
  };
}

// Compatibility stubs
let binance = { options: () => binance };
const updateKeys = () => {};
async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading disabled – connect an exchange API to enable.');
  return null;
}
module.exports = { getIndicators, updateKeys, placeOrder };
