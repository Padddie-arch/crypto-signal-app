// Realistic market simulator – generates proper candles with volume
// No external API needed. Works forever.

const BASE_PRICES = {
  BTCUSDT: 67000,
  ETHUSDT: 3400,
  SOLUSDT: 180,
  BNBUSDT: 600,
  XRPUSDT: 0.62
};

const currentPrices = { ...BASE_PRICES };

function generateCandles(symbol, interval, limit) {
  if (!currentPrices[symbol]) currentPrices[symbol] = BASE_PRICES[symbol] || 100;
  let price = currentPrices[symbol];
  const candles = [];
  const now = Date.now();
  const ms = {
    '1h': 3600000,
    '4h': 14400000,
    '1d': 86400000
  }[interval] || 3600000;

  for (let i = limit - 1; i >= 0; i--) {
    // Random walk with no bias (equal chance up/down)
    const change = (Math.random() - 0.5) * price * 0.01;   // 1% volatility per candle
    price = Math.max(0.01, price + change);
    const open = price;
    const close = price + (Math.random() - 0.5) * price * 0.005;
    const high = Math.max(open, close) + Math.random() * price * 0.002;
    const low = Math.min(open, close) - Math.random() * price * 0.002;
    const volume = (500 + Math.random() * 2000) * (1 + Math.abs(change) / price * 10);
    candles.push({
      timestamp: new Date(now - i * ms).toISOString(),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: +volume.toFixed(2)
    });
  }
  currentPrices[symbol] = candles[candles.length - 1].close;
  return candles;
}

// RSI (14)
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
  if (!BASE_PRICES[symbol]) return null;
  const candles = generateCandles(symbol, interval, limit);
  if (!candles || candles.length < 20) return null;

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
}

// Compatibility
let binance = { options: () => binance };
const updateKeys = () => {};
async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading disabled – connect an exchange API to enable.');
  return null;
}
module.exports = { getIndicators, updateKeys, placeOrder };
