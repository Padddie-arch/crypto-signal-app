const yahooFinance = require('yahoo-finance2').default;
const { rsi, macd } = require('technicalindicators');

// Yahoo Finance symbol mapping (our pair -> Yahoo symbol)
const SYMBOL_MAP = {
  'BTCUSDT': 'BTC-USD',
  'ETHUSDT': 'ETH-USD',
  'SOLUSDT': 'SOL-USD',
  'BNBUSDT': 'BNB-USD',
  'XRPUSDT': 'XRP-USD',
  // Gold and silver not available on Yahoo Finance crypto, skip
  'XAUUSDT': null,
  'XAGUSDT': null
};

// Interval mapping (our interval -> Yahoo Finance interval)
const INTERVAL_MAP = {
  '15m': '15m',
  '30m': '30m',
  '1h':  '1h',
  '2h':  '2h',
  '4h':  '1h',   // Yahoo doesn't have 4h, use 1h and we'll aggregate later (or just accept lower resolution)
  '1d':  '1d'
};

// Keep old interface compatibility
let binance = { options: function() { return this; } };
const updateKeys = () => {};

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    const yahooSymbol = SYMBOL_MAP[symbol];
    if (!yahooSymbol) {
      console.log(`Skipping ${symbol} – not available on Yahoo Finance`);
      return null;
    }

    const yahooInterval = INTERVAL_MAP[interval] || '15m';
    // For 4h we'll fetch 1h candles and later combine 4 of them (simple approach)
    const fetchInterval = interval === '4h' ? '1h' : yahooInterval;
    const fetchLimit = interval === '4h' ? limit * 4 : limit;

    const queryOptions = {
      period1: new Date(Date.now() - fetchLimit * getIntervalMs(fetchInterval) * 2), // enough back
      interval: fetchInterval,
      return: 'array'
    };

    const result = await yahooFinance.chart(yahooSymbol, queryOptions);
    let candles = result.quotes.filter(q => q.open !== null).map(q => ({
      date: q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume
    }));

    if (candles.length < 20) {
      console.error(`Not enough candles for ${symbol}`);
      return null;
    }

    // If we needed 4h, aggregate 4x1h candles into one 4h candle
    if (interval === '4h') {
      candles = aggregateCandles(candles, 4);
    }

    // Take last 'limit' candles
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
      rawCandles: candles   // objects with { date, open, high, low, close, volume }
    };
  } catch (err) {
    console.error(`Error fetching indicators for ${symbol}:`, err.message);
    return null;
  }
}

function getIntervalMs(interval) {
  const map = { '1m': 60000, '15m': 900000, '30m': 1800000, '1h': 3600000, '1d': 86400000 };
  return map[interval] || 900000;
}

function aggregateCandles(candles, factor) {
  const aggregated = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    const open = chunk[0].open;
    const close = chunk[chunk.length - 1].close;
    const high = Math.max(...chunk.map(c => c.high));
    const low = Math.min(...chunk.map(c => c.low));
    const volume = chunk.reduce((sum, c) => sum + c.volume, 0);
    aggregated.push({ date: chunk[0].date, open, high, low, close, volume });
  }
  return aggregated;
}

async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading is not connected to an exchange.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
