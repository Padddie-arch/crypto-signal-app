const axios = require('axios');

// CoinGecko coin IDs
const COIN_IDS = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple'
};

// Rate limiter: ensure at least 2.5s between all CoinGecko calls
let lastRequestTime = 0;
const MIN_GAP = 2500;

async function rateLimitedGet(url, params) {
  const now = Date.now();
  const wait = lastRequestTime + MIN_GAP - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  try {
    const res = await axios.get(url, { params, timeout: 15000 });
    lastRequestTime = Date.now(); // update after response
    return res;
  } catch (err) {
    lastRequestTime = Date.now();
    throw err;
  }
}

// Calculate RSI
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

// Calculate MACD
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

// Compatibility
let binance = { options: () => binance };
const updateKeys = () => {};

async function getIndicators(symbol, interval = '15m', limit = 50) {
  if (!COIN_IDS[symbol]) return null;
  const coinId = COIN_IDS[symbol];

  // Map interval to days parameter for CoinGecko OHLC
  let days;
  switch (interval) {
    case '1d': days = limit; break;
    case '4h': days = Math.ceil(limit * 4 / 24); break;
    case '1h': days = Math.ceil(limit / 24); break;
    case '15m': days = Math.ceil(limit * 0.25 / 24); break;
    default: days = Math.ceil(limit / 24);
  }
  days = Math.max(1, days);

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc`;
    const res = await rateLimitedGet(url, {
      vs_currency: 'usd',
      days: days
    });
    const ohlc = res.data; // array of [timestamp, open, high, low, close]
    if (!ohlc || ohlc.length < 20) return null;

    const closes = ohlc.map(c => c[4]);
    const volumes = ohlc.map(() => 0); // CoinGecko OHLC lacks volume, but we can fake
    const rsi = calcRSI(closes, 14);
    const { macd: macdLine, signal: signalLine, histogram } = calcMACD(closes);
    const currentPrice = closes[closes.length - 1];
    const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : currentPrice;
    const volumeSpike = false; // no real volume

    return {
      price: currentPrice,
      rsi,
      macd: macdLine,
      macdSignal: signalLine,
      macdHistogram: histogram,
      volumeSpike,
      ma20,
      priceVsMa: currentPrice > ma20 ? 'above' : 'below',
      rawCandles: ohlc.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: 0 }))
    };
  } catch (err) {
    console.error(`CoinGecko error for ${symbol}:`, err.message);
    return null;
  }
}

async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading disabled – connect an exchange API to enable.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
