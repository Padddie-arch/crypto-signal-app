const axios = require('axios');
const { rsi, macd } = require('technicalindicators');

// CoinCap asset IDs mapping (our symbol -> CoinCap baseId)
const SYMBOL_MAP = {
  'BTCUSDT': { baseId: 'bitcoin', quoteId: 'tether' },
  'ETHUSDT': { baseId: 'ethereum', quoteId: 'tether' },
  'SOLUSDT': { baseId: 'solana', quoteId: 'tether' },
  'BNBUSDT': { baseId: 'binance-coin', quoteId: 'tether' },
  'XRPUSDT': { baseId: 'xrp', quoteId: 'tether' },
  'XAUUSDT': { baseId: 'xau', quoteId: 'tether' },
  'XAGUSDT': { baseId: 'xag', quoteId: 'tether' }
};

// CoinCap interval mapping
const INTERVAL_MAP = {
  '15m': 'm15',
  '30m': 'm30',
  '1h':  'h1',
  '2h':  'h2',
  '4h':  'h4',
  '1d':  'd1'
};

// Binance compatible interface
let binance = {
  options: function(opts) { return this; }
};
const updateKeys = () => {}; // not needed for CoinCap

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    const mapping = SYMBOL_MAP[symbol];
    if (!mapping) {
      console.error(`No CoinCap mapping for ${symbol}`);
      return null;
    }
    const capInterval = INTERVAL_MAP[interval] || 'm15';

    // CoinCap candles endpoint
    const url = `https://api.coincap.io/v2/candles`;
    const response = await axios.get(url, {
      params: {
        exchange: 'binance',
        interval: capInterval,
        baseId: mapping.baseId,
        quoteId: mapping.quoteId,
        limit: limit
      },
      headers: { 'User-Agent': 'crypto-signal-app' }
    });

    const candles = response.data.data;
    if (!candles || candles.length < 20) return null;

    // CoinCap returns: { open, high, low, close, volume, period }
    const closes = candles.map(c => parseFloat(c.close));
    const volumes = candles.map(c => parseFloat(c.volume));

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

    const volSma = volumes.length > 10
      ? volumes.slice(-10).reduce((a,b)=>a+b,0)/10
      : volumes[volumes.length-1];
    const lastVolume = volumes[volumes.length-1];
    const volumeSpike = lastVolume > volSma * 1.5;

    const ma20 = closes.length >= 20
      ? closes.slice(-20).reduce((a,b)=>a+b,0)/20
      : closes[closes.length-1];
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
      rawCandles: candles   // we keep the raw candles for AI prediction
    };
  } catch (err) {
    console.error(`Error fetching indicators for ${symbol}:`, err.message);
    return null;
  }
}

// Place a real order – we keep this stub, but it won't work without Binance keys.
async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading is only available with Binance API keys.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
