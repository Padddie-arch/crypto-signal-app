const axios = require('axios');
const { rsi, macd } = require('technicalindicators');

// Binance.US base URL (works from anywhere)
const BINANCE_US_BASE = 'https://api.binance.us/api/v3/klines';

// Fallback Binance.com (may be geo-blocked, but we try it if US fails)
const BINANCE_COM_BASE = 'https://api.binance.com/api/v3/klines';

// Binance API wrapper (compatible with old code)
let binance = {
  options: function() { return this; }
};
const updateKeys = () => {}; // not needed for public data

// Fetch candles using direct axios call
async function getCandles(symbol, interval, limit) {
  // Convert interval to Binance format (same as before)
  const intervalMap = {
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '1d': '1d'
  };
  const binInterval = intervalMap[interval] || '15m';

  // Try Binance.US first
  try {
    const response = await axios.get(BINANCE_US_BASE, {
      params: {
        symbol: symbol,
        interval: binInterval,
        limit: limit
      },
      timeout: 10000
    });
    return response.data;
  } catch (err) {
    // If US fails, try global Binance
    console.log(`Binance.US failed for ${symbol}, trying Binance.com...`);
    const response = await axios.get(BINANCE_COM_BASE, {
      params: {
        symbol: symbol,
        interval: binInterval,
        limit: limit
      },
      timeout: 10000
    });
    return response.data;
  }
}

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    // Skip unsupported pairs
    if (['XAUUSDT', 'XAGUSDT'].includes(symbol)) {
      console.log(`Skipping ${symbol} – not available on Binance`);
      return null;
    }

    const candles = await getCandles(symbol, interval, limit);
    if (!candles || candles.length < 20) {
      console.error(`Not enough candles for ${symbol}`);
      return null;
    }

    // candles is an array of arrays: [openTime, open, high, low, close, volume, ...]
    const closes = candles.map(c => parseFloat(c[4]));
    const volumes = candles.map(c => parseFloat(c[5]));

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

    const volSma = volumes.length > 10 ? volumes.slice(-10).reduce((a,b)=>a+b,0)/10 : volumes[volumes.length-1];
    const lastVolume = volumes[volumes.length-1];
    const volumeSpike = lastVolume > volSma * 1.5;

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
      rawCandles: candles
    };
  } catch (err) {
    console.error(`Error fetching indicators for ${symbol}:`, err.message);
    return null;
  }
}

async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading is disabled – Binance.US API keys not configured.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
