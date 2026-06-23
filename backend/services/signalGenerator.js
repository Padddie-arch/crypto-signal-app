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

  const timeframes = ['1h', '4h'];
  const freshSignals = [];

  for (const pair of pairs) {
    for (const tf of timeframes) {
      const indicators = await binanceService.getIndicators(pair.symbol, tf);
      if (!indicators) continue;
      const candles = indicators.rawCandles;
      if (!candles || candles.length < 100) continue;

      const consensus = generateConsensusSignal(
        candles,
        indicators.price,
        indicators.rsi,
        indicators.macdHistogram,
        indicators.volumeSpike,
        indicators.priceVsMa
      );

      if (consensus) {
        const signal = {
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.symbol,
          timeframe: tf,
          direction: consensus.direction,
          price: indicators.price,
          confidence: consensus.confidence,
          aligned: consensus.aligned,           // strategies agreeing
          totalActive: consensus.totalActive,   // total active strategies
          stopLoss: consensus.stopLoss,
          takeProfit: consensus.takeProfit,
          trailingStop: null,
          rsi: indicators.rsi,
          macd: indicators.macdHistogram,
          volumeSpike: indicators.volumeSpike,
          aiTrend: consensus.trend,
          adx: consensus.adx,
          trendStrength: consensus.trend,
          timestamp: consensus.timestamp
        };
        freshSignals.push(signal);
        tradeHistory.add(signal);
      }
    }
  }

  // Solana meme coins
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
