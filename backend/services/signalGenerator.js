const binanceService = require('./binanceService');
const solanaService = require('./solanaService');
const tradeHistory = require('../models/tradeHistory');
const notificationService = require('./notificationService');
const { generateConsensusSignal } = require('./indicatorService');

let latestSignals = [];

async function generateAll() {
  const pairs = [
    'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
    'TONUSDT','ADAUSDT','DOGEUSDT','XLMUSDT','LINKUSDT',
    'LTCUSDT','SUIUSDT','POLUSDT','NEARUSDT','UNIUSDT',
    'TAOUSDT','SHIBUSDT','APTUSDT','ZECUSDT','CAKEUSDT',
    'AVAXUSDT','TRXUSDT'
  ].map(s => ({ symbol: s, name: s.replace('USDT', '/USD') }));

  const timeframes = ['1h', '4h'];
  const freshSignals = [];
  const signalsByPair = {};  // for confluence

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

      if (consensus) {
        const signal = {
          id: Date.now() + Math.random(),
          pair: pair.name,
          symbol: pair.symbol,
          timeframe: tf,
          direction: consensus.direction,
          price: indicators.price,
          confidence: consensus.confidence,
          aligned: consensus.aligned,
          totalActive: consensus.totalActive,
          totalStrategies: consensus.totalStrategies,
          stopLoss: consensus.stopLoss,
          takeProfit: consensus.takeProfit,
          trailingStop: null,
          rsi: indicators.rsi,
          macd: indicators.macdHistogram,
          volumeSpike: indicators.volumeSpike,
          adx: consensus.adx,
          vwap: consensus.vwap,
          divergence: consensus.divergence,
          pattern: consensus.pattern,
          timestamp: consensus.timestamp,
          status: 'open',        // for win-rate tracker
          outcome: null
        };
        if (!signalsByPair[pair.symbol]) signalsByPair[pair.symbol] = {};
        signalsByPair[pair.symbol][tf] = signal;
      }
    }
  }

  // Multi‑timeframe confluence: require both 1h and 4h exist and have same direction
  for (const symbol of Object.keys(signalsByPair)) {
    const pairSignals = signalsByPair[symbol];
    if (pairSignals['1h'] && pairSignals['4h'] &&
        pairSignals['1h'].direction === pairSignals['4h'].direction) {
      freshSignals.push(pairSignals['1h']);
      freshSignals.push(pairSignals['4h']);   // keep both for history
      tradeHistory.add(pairSignals['1h']);
      tradeHistory.add(pairSignals['4h']);
    }
  }

  // Solana meme coins (unchanged)
  let memeCoins = [];
  try {
    await new Promise(resolve => setTimeout(resolve, 3000));
    memeCoins = await solanaService.findNewSolanaMemeCoins();
  } catch (err) { console.log('Solana meme coins skipped:', err.message); }
  memeCoins.forEach(coin => {
    freshSignals.push({
      id: Date.now() + Math.random(),
      type: 'meme_coin',
      name: coin.name,
      symbol: coin.symbol,
      price: coin.price,
      confidence: coin.probability,
      probability: coin.probability,
      timestamp: new Date().toISOString()
    });
  });

  latestSignals = freshSignals;
  return freshSignals;
}

function getLatestSignals() { return latestSignals; }

module.exports = { generateAll, getLatestSignals };
