const Binance = require('node-binance-api');
const { rsi, macd } = require('technicalindicators');

// Use Binance.US – it's accessible from Render and doesn't geo-block
let binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,     // not needed for public data, but kept for future auto-trading
  APISECRET: process.env.BINANCE_SECRET_KEY,
  useServerTime: true,
  recvWindow: 60000,
  verbose: false,
  urls: {
    base: 'https://api.binance.us/api/',   // <-- the magic line
    stream: 'wss://stream.binance.us:9443/ws/',
  }
});

const updateKeys = (apiKey, secretKey) => {
  binance = new Binance().options({
    APIKEY: apiKey,
    APISECRET: secretKey,
    useServerTime: true,
    recvWindow: 60000,
    urls: {
      base: 'https://api.binance.us/api/',
      stream: 'wss://stream.binance.us:9443/ws/',
    }
  });
};

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    // Remove unsupported pairs for Binance.US
    if (['XAUUSDT', 'XAGUSDT'].includes(symbol)) {
      console.log(`Skipping ${symbol} – not available on Binance.US`);
      return null;
    }

    const candles = await binance.candlesticks(symbol, interval, { limit });
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
  try {
    const order = await binance.marketBuy(signal.symbol, signal.quantity || 0.001);
    return order;
  } catch (err) {
    console.error('Order error:', err.message);
    return null;
  }
}

module.exports = { getIndicators, updateKeys, placeOrder };
