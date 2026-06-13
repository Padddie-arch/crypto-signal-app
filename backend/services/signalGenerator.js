const binanceService = require('./binanceService');
const solanaService = require('./solanaService');
const tradeHistory = require('../models/tradeHistory');
const notificationService = require('./notificationService');

let latestSignals = [];

// Simple AI prediction based on linear regression over last N prices
function predictTrend(prices) {
  const n = prices.length;
  if (n < 5) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope; // positive slope = uptrend
}

// Calculate confidence score (0-100)
function confidenceScore(rsi, macdHistogram, volumeSpike, trendSlope, priceVsMa) {
  let score = 50;
  if (rsi < 30) score += 15; // oversold
  else if (rsi < 40) score += 10;
  else if (rsi > 70) score -= 15; // overbought
  else if (rsi > 60) score -= 5;
  if (macdHistogram > 0) score += 10; else score -= 10;
  if (volumeSpike) score += 10;
  if (trendSlope > 0) score += 10; else score -= 5;
  if (priceVsMa === 'above') score += 5; else score -= 5;
  return Math.max(0, Math.min(100, score));
}

// Generate signals for all pairs
async function generateAll() {
  const pairs = [
    { symbol: 'BTCUSDT', name: 'BTC/USD' },
    { symbol: 'ETHUSDT', name: 'ETH/USD' },
    { symbol: 'SOLUSDT', name: 'SOL/USD' },
    { symbol: 'BNBUSDT', name: 'BNB/USD' },
    { symbol: 'XRPUSDT', name: 'XRP/USD' },
    { symbol: 'XAUUSDT', name: 'XAU/USD' },
    { symbol: 'XAGUSDT', name: 'XAG/USD' }
  ];
  const timeframes = ['15m', '30m', '1h', '2h', '4h', '1d'];
  const freshSignals = [];

  for (const pair of pairs) {
    for (const tf of timeframes) {
      const indicators = await binanceService.getIndicators(pair.symbol, tf);
      if (!indicators) continue;

      // ‼️ THIS IS THE ONLY LINE THAT CHANGED ‼️
      // Use the new candle objects: each candle has a .close property
      const closePrices = indicators.rawCandles.slice(-20).map(c => c.close);
      const trendSlope = predictTrend(closePrices);

      const conf = confidenceScore(
        indicators.rsi,
        indicators.macdHistogram,
        indicators.volumeSpike,
        trendSlope,
        indicators.priceVsMa
      );
      // Only high confidence trades (>=70) go through
      if (conf >= 70) {
        const direction = trendSlope > 0 ? 'BUY' : 'SELL';
        const stopLoss = indicators.price * (direction === 'BUY' ? 0.98 : 1.02);
        const takeProfit = indicators.price * (direction === 'BUY' ? 1.04 : 0.96);
        const signal = {
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.symbol,
          timeframe: tf,
          direction,
          price: indicators.price,
          confidence: conf,
          stopLoss,
          takeProfit,
          trailingStop: direction === 'BUY' ? indicators.price * 0.99 : indicators.price * 1.01,
          rsi: indicators.rsi,
          macd: indicators.macdHistogram,
          volumeSpike: indicators.volumeSpike,
          aiTrend: trendSlope > 0 ? 'up' : 'down',
          timestamp: new Date().toISOString()
        };
        freshSignals.push(signal);
        tradeHistory.add(signal);
      }
    }
  }

  // Also find new Solana meme coin alerts
  let memeCoins = [];
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    memeCoins = await solanaService.findNewSolanaMemeCoins();
  } catch (err) {
    console.log('Solana meme coins skipped:', err.message);
  }
  if (memeCoins.length > 0) {
    memeCoins.forEach(coin => {
      const signal = {
        id: Date.now() + Math.random(),
        type: 'meme_coin',
        name: coin.name,
        symbol: coin.symbol,
        price: coin.price,
        confidence: coin.probability,
        probability: coin.probability,
        volume24h: coin.volume24h,
        priceChange24h: coin.priceChange24h,
        timestamp: new Date().toISOString()
      };
      freshSignals.push(signal);
    });
  }

  latestSignals = freshSignals;
  return freshSignals;
}

function getLatestSignals() {
  return latestSignals;
}

module.exports = { generateAll, getLatestSignals };
