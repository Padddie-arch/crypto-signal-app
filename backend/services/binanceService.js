const { rsi, macd } = require('technicalindicators');

// Base prices for the simulated pairs
const BASE_PRICES = {
  'BTCUSDT': 67000,
  'ETHUSDT': 3400,
  'SOLUSDT': 180,
  'BNBUSDT': 600,
  'XRPUSDT': 0.62
};

// Store ongoing price for each pair (random walk)
const currentPrices = { ...BASE_PRICES };

// Compatibility (unchanged interfaces)
let binance = { options: function() { return this; } };
const updateKeys = () => {};

function generateCandles(symbol, interval, limit) {
  if (!currentPrices[symbol]) currentPrices[symbol] = BASE_PRICES[symbol] || 100;
  let price = currentPrices[symbol];
  const candles = [];
  const now = Date.now();
  const intervalMs = {
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000
  }[interval] || 15 * 60 * 1000;

  for (let i = limit - 1; i >= 0; i--) {
    // Random walk: ~0.5% per candle, slightly bullish
    const change = (Math.random() - 0.48) * price * 0.005;
    price += change;
    if (price <= 0) price = 0.01;
    const open = price;
    const close = price + (Math.random() - 0.5) * price * 0.003;
    const high = Math.max(open, close) + Math.random() * price * 0.002;
    const low = Math.min(open, close) - Math.random() * price * 0.002;
    const volume = (1000 + Math.random() * 5000) * (1 + Math.abs(change) / price * 10);

    candles.push({
      timestamp: new Date(now - i * intervalMs).toISOString(),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Number(volume.toFixed(2))
    });
  }
  currentPrices[symbol] = candles[candles.length - 1].close;
  return candles;
}

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    if (!BASE_PRICES[symbol]) return null; // skip XAU, XAG

    const candles = generateCandles(symbol, interval, limit);
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
      rawCandles: candles   // array of objects { timestamp, open, high, low, close, volume }
    };
  } catch (err) {
    console.error(`Simulator error for ${symbol}:`, err.message);
    return null;
  }
}

async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading disabled (simulator mode).');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
