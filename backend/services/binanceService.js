// No external indicator libraries – just math
const BASE_PRICES = {
  BTCUSDT: 67000,
  ETHUSDT: 3400,
  SOLUSDT: 180,
  BNBUSDT: 600,
  XRPUSDT: 0.62
};
const currentPrices = { ...BASE_PRICES };

// Simple moving average
function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// RSI (14)
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const deltas = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  const gains = deltas.map(d => (d > 0 ? d : 0));
  const losses = deltas.map(d => (d < 0 ? -d : 0));
  const avgGain = sma(gains, period) || 0;
  const avgLoss = sma(losses, period) || 1e-10;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// MACD (12, 26, 9)
function calcMACD(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = ema(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signal[i]);
  return { macd: macdLine[macdLine.length - 1] || 0, signal: signal[signal.length - 1] || 0, histogram: histogram[histogram.length - 1] || 0 };
}

function ema(data, period) {
  const k = 2 / (period + 1);
  const emaArr = [data[0]];
  for (let i = 1; i < data.length; i++) {
    emaArr.push(data[i] * k + emaArr[i - 1] * (1 - k));
  }
  return emaArr;
}

function generateCandles(symbol, interval, limit) {
  if (!currentPrices[symbol]) currentPrices[symbol] = BASE_PRICES[symbol] || 100;
  let price = currentPrices[symbol];
  const candles = [];
  const now = Date.now();
  const ms = { '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '1d': 86400000 }[interval] || 900000;
  for (let i = limit - 1; i >= 0; i--) {
    const change = (Math.random() - 0.48) * price * 0.005;
    price = Math.max(0.01, price + change);
    const open = price;
    const close = price + (Math.random() - 0.5) * price * 0.003;
    const high = Math.max(open, close) + Math.random() * price * 0.002;
    const low = Math.min(open, close) - Math.random() * price * 0.002;
    const volume = (1000 + Math.random() * 5000) * (1 + Math.abs(change) / price * 10);
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

async function getIndicators(symbol, interval = '15m', limit = 50) {
  if (!BASE_PRICES[symbol]) return null;
  const candles = generateCandles(symbol, interval, limit);
  if (!candles || candles.length < 20) return null;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const lastRsi = calcRSI(closes, 14);
  const { macd: macdLine, signal: signalLine, histogram: macdHist } = calcMACD(closes);
  const lastVolume = volumes[volumes.length - 1];
  const volSma = volumes.length > 10 ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10 : lastVolume;
  const volumeSpike = lastVolume > volSma * 1.5;
  const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : closes[closes.length - 1];
  const currentPrice = closes[closes.length - 1];

  return {
    price: currentPrice,
    rsi: lastRsi,
    macd: macdLine,
    macdSignal: signalLine,
    macdHistogram: macdHist,
    volumeSpike,
    ma20,
    priceVsMa: currentPrice > ma20 ? 'above' : 'below',
    rawCandles: candles
  };
}

// Keep compatibility
let binance = { options: () => binance };
const updateKeys = () => {};
async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading disabled (simulator mode).');
  return null;
}
module.exports = { getIndicators, updateKeys, placeOrder };
