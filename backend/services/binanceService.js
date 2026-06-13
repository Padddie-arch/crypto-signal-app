const axios = require('axios');
const { rsi, macd } = require('technicalindicators');

// Kraken public OHLC endpoint
const KRAKEN_OHLC_URL = 'https://api.kraken.com/0/public/OHLC';

// Kraken pair names (our symbol -> Kraken pair)
const PAIR_MAP = {
  'BTCUSDT': 'XBTUSDT',
  'ETHUSDT': 'ETHUSDT',
  'SOLUSDT': 'SOLUSDT',
  'BNBUSDT': 'BNBUSDT',
  'XRPUSDT': 'XRPUSDT'
};

// Interval mapping (our interval -> Kraken interval in minutes)
const INTERVAL_MAP = {
  '15m': 15,
  '30m': 30,
  '1h':  60,
  '2h':  120,
  '4h':  240,
  '1d':  1440
};

// Compatibility
let binance = { options: function() { return this; } };
const updateKeys = () => {};

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    if (!PAIR_MAP[symbol]) {
      console.log(`Skipping ${symbol} – not available on Kraken`);
      return null;
    }

    const pair = PAIR_MAP[symbol];
    const minutes = INTERVAL_MAP[interval] || 15;
    const since = Math.floor(Date.now() / 1000) - (limit * minutes * 60 * 2); // enough back

    const response = await axios.get(KRAKEN_OHLC_URL, {
      params: { pair: pair, interval: minutes, since: since },
      timeout: 10000
    });

    if (response.data.error.length > 0) {
      console.error(`Kraken error for ${symbol}: ${response.data.error}`);
      return null;
    }

    const ohlcData = response.data.result[pair];
    if (!ohlcData || ohlcData.length < 20) {
      console.error(`Not enough OHLC data for ${symbol}`);
      return null;
    }

    // Kraken returns: [time, open, high, low, close, vwap, volume, count]
    const candles = ohlcData.map(c => ({
      timestamp: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[6])   // volume in base asset
    }));

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
  console.log('Auto-trading is not connected to an exchange.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
