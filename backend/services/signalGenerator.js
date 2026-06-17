const binanceService = require('./binanceService');
const solanaService = require('./solanaService');
const tradeHistory = require('../models/tradeHistory');
const notificationService = require('./notificationService');
const { generateConsensusSignal } = require('./indicatorService');

let latestSignals = [];

async function generateAll() {
  const pairs = [
    { symbol: 'BTCUSDT', name: 'BTC/USD' },
    { symbol: 'ETHUSDT', name: 'ETH/USD' },
    { symbol: 'SOLUSDT', name: 'SOL/USD' },
    { symbol: 'BNBUSDT', name: 'BNB/USD' },
    { symbol: 'XRPUSDT', name: 'XRP/USD' }
  ];

  const timeframes = ['1h', '4h'];   // Only the reliable timeframes
  const freshSignals = [];

  for (const pair of pairs) {
    for (const tf of timeframes) {
      const indicators = await binanceService.getIndicators(pair.symbol, tf);
      if (!indicators) continue;
      const candles = indicators.rawCandles;
      if (!candles || candles.length < 20) continue;

      const consensus = generateConsensusSignal(
        candles,
        indicators.price,
        indicators.rsi,
        indicators.macdHistogram,
        indicators.volumeSpike,
        indicators.priceVsMa
      );

      // The consensus already filters for quality – we just use its confidence (which is ≥66 here)
      if (consensus) {
        const direction = consensus.direction;
        const stopLoss = indicators.price * (direction === 'BUY' ? 0.98 : 1.02);
        const takeProfit = indicators.price * (direction === 'BUY' ? 1.04 : 0.96);
        const signal = {
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.symbol,
          timeframe: tf,
          direction,
          price: indicators.price,
          confidence: consensus.confidence,
          stopLoss,
          takeProfit,
          trailingStop: direction === 'BUY' ? indicators.price * 0.99 : indicators.price * 1.01,
          rsi: indicators.rsi,
          macd: indicators.macdHistogram,
          volumeSpike: indicators.volumeSpike,
          aiTrend: direction === 'BUY' ? 'up' : 'down',
          adx: consensus.adx,
          trendStrength: consensus.trendStrength,
          timestamp: new Date().toISOString()
        };
        freshSignals.push(signal);
        tradeHistory.add(signal);
      }
    }
  }

  // Solana meme coins (kept as before)
  let memeCoins = [];
  try {
    await new Promise(resolve => setTimeout(resolve, 3000));
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
