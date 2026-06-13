const axios = require('axios');
const { rsi, macd } = require('technicalindicators');

// Yahoo Finance crypto symbols (pair -> Yahoo symbol)
const SYMBOL_MAP = {
  'BTCUSDT': 'BTC-USD',
  'ETHUSDT': 'ETH-USD',
  'SOLUSDT': 'SOL-USD',
  'BNBUSDT': 'BNB-USD',
  'XRPUSDT': 'XRP-USD'
  // Gold/Silver not available via Yahoo crypto
};

// Interval mapping for Yahoo v8 API (uses 'range' and 'interval')
const INTERVAL_CONFIG = {
  '15m': { range: '1d', interval: '15m' },
  '30m': { range: '5d', interval: '30m' },
  '1h':  { range: '5d', interval: '1h' },
  '2h':  { range: '10d', interval: '1h' },  // Use 1h candles and we'll combine 2 later
  '4h':  { range: '60d', interval: '1h' },  // Use 1h candles and combine 4
  '1d':  { range: '3mo', interval: '1d' }
};

// Keep old interface compatibility
let binance = { options: function() { return this; } };
const updateKeys = () => {};

// Helper to get milliseconds for an interval string
function intervalMs(interval) {
  const map = { '1m': 60000, '15m': 900000, '30m': 1800000, '1h': 3600000, '1d': 86400000 };
  return map[interval] || 900000;
}

// Aggregate smaller candles into larger ones
function aggregateCandles(candles, factor) {
  const result = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    result.push({
      date: chunk[0].date,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + c.volume, 0)
    });
  }
  return result;
}

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    const yahooSymbol = SYMBOL_MAP[symbol];
    if (!yahooSymbol) {
      // Skip unsupported (XAU, XAG)
      console.log(`Skipping ${symbol} – not available on Yahoo Finance`);
      return null;
    }

    let config = INTERVAL_CONFIG[interval] || INTERVAL_CONFIG['15m'];
    let range = config.range;
    let fetchInterval = config.interval;

    // Yahoo v8 chart API
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`;
    const response = await axios.get(url, {
      params: {
        range: range,
        interval: fetchInterval,
        includePrePost: false
      },
      timeout: 15000
    });

    const result = response.data?.chart?.result?.[0];
    if (!result) {
      console.error(`No data from Yahoo for ${symbol}`);
      return null;
    }

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    // Build candle objects
    let candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] === null) continue; // skip null entries
      candles.push({
        date: new Date(timestamps[i] * 1000),
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume[i] || 0
      });
    }

    if (candles.length < 20) {
      console.error(`Not enough candles for ${symbol}`);
      return null;
    }

    // For 2h and 4h, aggregate from 1h candles
    if (interval === '2h') {
      candles = aggregateCandles(candles, 2);
    } else if (interval === '4h') {
      candles = aggregateCandles(candles, 4);
    }

    // Take the last 'limit' candles
    candles = candles.slice(-limit);
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

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
  console.log('Auto-trading is not connected to an exchange yet.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
