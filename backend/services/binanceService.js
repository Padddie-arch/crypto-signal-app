const axios = require('axios');
const { rsi, macd } = require('technicalindicators');

// CoinGecko coin IDs for our pairs
const COIN_IDS = {
  'BTCUSDT': 'bitcoin',
  'ETHUSDT': 'ethereum',
  'SOLUSDT': 'solana',
  'BNBUSDT': 'binancecoin',
  'XRPUSDT': 'ripple'
  // XAU, XAG not available
};

// Rate limiter: CoinGecko free allows ~30 req/min, we'll be safe with 1.5 sec between calls
let lastRequestTime = 0;
const MIN_INTERVAL = 1500; // 1.5 seconds

async function rateLimitedGet(url, params) {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL - timeSinceLast));
  }
  lastRequestTime = Date.now();
  return axios.get(url, { params });
}

// Keep old interface
let binance = { options: function() { return this; } };
const updateKeys = () => {};

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    if (['XAUUSDT', 'XAGUSDT'].includes(symbol)) {
      console.log(`Skipping ${symbol} – not available on CoinGecko`);
      return null;
    }

    const coinId = COIN_IDS[symbol];
    if (!coinId) return null;

    // Map interval to CoinGecko's 'days' parameter for OHLC
    // CoinGecko OHLC gives 1 candle per interval; we request 'limit' candles
    let days;
    switch (interval) {
      case '1d': days = limit; break;
      case '4h': days = Math.ceil(limit * 4 / 24); break;
      case '2h': days = Math.ceil(limit * 2 / 24); break;
      case '1h': days = Math.ceil(limit / 24); break;
      case '30m': days = Math.ceil(limit * 0.5 / 24); break;
      case '15m': days = Math.ceil(limit * 0.25 / 24); break;
      default: days = Math.ceil(limit / 24);
    }
    // Ensure at least 1 day
    days = Math.max(1, days);

    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc`;
    const response = await rateLimitedGet(url, {
      vs_currency: 'usd',
      days: days
    });

    const ohlcData = response.data; // array of [timestamp, open, high, low, close]
    if (!ohlcData || ohlcData.length < 20) {
      console.error(`Not enough OHLC data for ${symbol}`);
      return null;
    }

    // Take the last 'limit' candles
    const candles = ohlcData.slice(-limit);
    const closes = candles.map(c => c[4]);
    const volumes = candles.map(() => 0); // CoinGecko OHLC doesn't include volume; we'll fake a constant
    // Actually, CoinGecko OHLC doesn't give volume, so volumeSpike will be false. That's okay.

    const rsiArray = rsi({ values: closes, period: 14 });
    const lastRsi = rsiArray[rsiArray.length - 1] || 50;

    const macdResult = macd({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const macdLine = macdResult.MACD;
    const signalLine = macdResult.signal;
    const lastMacd = macdLine[macdLine.length - 1] || 0;
    const lastSignal = signalLine[signalLine.length - 1] || 0;
    const macdHistogram = lastMacd - lastSignal;

    // Volume: since we don't have real volume, we'll set volumeSpike to false
    // but we still need volume array for compatibility
    const volSma = 1;
    const lastVolume = 1;
    const volumeSpike = false;

    const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a,b)=>a+b,0)/20 : closes[closes.length-1];
    const currentPrice = closes[closes.length-1];

    return {
      price: currentPrice,
      rsi: lastRsi,
      macd: lastMacd,
      macdSignal: lastSignal,
      macdHistogram,
      volumeSpike,
      ma20,
      priceVsMa: currentPrice > ma20 ? 'above' : 'below',
      rawCandles: candles   // array of [timestamp, o, h, l, c]
    };
  } catch (err) {
    console.error(`Error fetching indicators for ${symbol}:`, err.message);
    return null;
  }
}

async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading is not yet connected to an exchange.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
