const ccxt = require('ccxt');
const { rsi, macd } = require('technicalindicators');

// Create a Binance exchange instance (public data only, no API keys)
const exchange = new ccxt.binance({
  enableRateLimit: true,
  options: {
    defaultType: 'spot',
    // Force IPv4 – often required on Render
    family: 4
  }
});

// Keep compatibility with the old interface
let binance = {
  options: function() { return this; }
};
const updateKeys = () => {};

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    // Skip pairs that Binance doesn't have
    if (['XAUUSDT', 'XAGUSDT'].includes(symbol)) {
      console.log(`Skipping ${symbol} – not available on Binance`);
      return null;
    }

    // fetchOHLCV returns array of [timestamp, open, high, low, close, volume]
    const ohlcv = await exchange.fetchOHLCV(symbol, interval, undefined, limit);
    if (!ohlcv || ohlcv.length < 20) {
      console.error(`Not enough candles for ${symbol}`);
      return null;
    }

    const closes = ohlcv.map(c => c[4]);
    const volumes = ohlcv.map(c => c[5]);

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
      rawCandles: ohlcv   // shape compatible with the rest of the code
    };
  } catch (err) {
    console.error(`Error fetching indicators for ${symbol}:`, err.message);
    return null;
  }
}

async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading is not supported without verified Binance API keys.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
