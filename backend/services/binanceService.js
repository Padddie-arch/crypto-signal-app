const axios = require('axios');

// MEXC public kline endpoint – no auth, no geo‑block
const MEXC_KLINE_URL = 'https://api.mexc.com/api/v3/klines';

const PAIRS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT'
];

// Interval mapping (our interval -> MEXC interval string)
const INTERVAL_MAP = {
  '1h': '1h',
  '4h': '4h',
  '1d': '1d'
};

// Rate limiter: MEXC allows 20 requests per 2 seconds – we use 500ms to be safe
let lastRequestTime = 0;
const MIN_GAP = 500;

async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { params, timeout: 10000 });
}

// RSI
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

// MACD
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

async function getIndicators(symbol, interval = '1h', limit = 50) {
  if (!PAIRS.includes(symbol)) return null;
  const mexcInterval = INTERVAL_MAP[interval] || '1h';

  try {
    const res = await rateLimitedGet(MEXC_KLINE_URL, {
      symbol: symbol,
      interval: mexcInterval,
      limit: limit
    });

    const klines = res.data;  // array of arrays: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, ...]
    if (!klines || klines.length < 20) {
      console.error(`Not enough candles for ${symbol}`);
      return null;
    }

    // Build candle objects (oldest first)
    const candles = klines.map(k => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const rsi = calcRSI(closes, 14);
    const macdObj = calcMACD(closes);
    const lastVolume = volumes[volumes.length - 1];
    const volSma = volumes.length > 10 ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10 : lastVolume;
    const volumeSpike = lastVolume > volSma * 1.5;
    const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : closes[closes.length - 1];
    const currentPrice = closes[closes.length - 1];

    return {
      price: currentPrice,
      rsi,
      macd: macdObj.macd,
      macdSignal: macdObj.signal,
      macdHistogram: macdObj.histogram,
      volumeSpike,
      ma20,
      priceVsMa: currentPrice > ma20 ? 'above' : 'below',
      rawCandles: candles   // objects with { timestamp, open, high, low, close, volume }
    };
  } catch (err) {
    console.error(`MEXC error for ${symbol}:`, err.message);
    return null;
  }
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
