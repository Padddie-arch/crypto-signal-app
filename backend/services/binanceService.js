const axios = require('axios');
const { rsi, macd } = require('technicalindicators');

const TWELVE_DATA_BASE = 'https://api.twelvedata.com/time_series';
const API_KEY = () => process.env.TWELVE_DATA_API_KEY || 'demo';

// Keep the old interface compatible
let binance = { options: function() { return this; } };
const updateKeys = () => {};

async function getIndicators(symbol, interval = '15m', limit = 50) {
  try {
    // Skip pairs that don't exist on Twelve Data
    if (['XAUUSDT', 'XAGUSDT'].includes(symbol)) {
      console.log(`Skipping ${symbol} – not available on Twelve Data`);
      return null;
    }

    // Convert our symbol to Twelve Data format (e.g., BTCUSDT -> BTC/USDT)
    const twelveSymbol = symbol.replace('USDT', '/USDT');

    // Map interval to Twelve Data format
    const intervalMap = {
      '15m': '15min',
      '30m': '30min',
      '1h': '1h',
      '2h': '2h',
      '4h': '4h',
      '1d': '1day'
    };
    const twelveInterval = intervalMap[interval] || '15min';

    const response = await axios.get(TWELVE_DATA_BASE, {
      params: {
        symbol: twelveSymbol,
        interval: twelveInterval,
        outputsize: limit,
        apikey: API_KEY(),
        format: 'JSON'
      }
    });

    const values = response.data.values;
    if (!values || values.length < 20) {
      console.error(`Not enough candles for ${symbol}`);
      return null;
    }

    // Twelve Data returns newest first; reverse to oldest first
    const reversed = values.reverse();
    const closes = reversed.map(c => parseFloat(c.close));
    const volumes = reversed.map(c => parseFloat(c.volume));

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

    // Keep rawCandles compatible (convert to array format)
    const rawCandles = reversed.map(c => [
      c.datetime,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume
    ]);

    return {
      price: currentPrice,
      rsi: lastRsi,
      macd: lastMacd,
      macdSignal: lastSignal,
      macdHistogram,
      volumeSpike,
      ma20,
      priceVsMa: currentPrice > ma20 ? 'above' : 'below',
      rawCandles: rawCandles
    };
  } catch (err) {
    console.error(`Error fetching indicators for ${symbol}:`, err.message);
    return null;
  }
}

async function placeOrder(signal) {
  if (process.env.AUTO_TRADE_ENABLED !== 'true') return null;
  console.log('Auto-trading is disabled without Binance API keys.');
  return null;
}

module.exports = { getIndicators, updateKeys, placeOrder };
