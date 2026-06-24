const binanceService = require('./binanceService');
const tradeHistory = require('../models/tradeHistory');

async function checkOpenTrades() {
  const trades = tradeHistory.getAll().filter(t => t.status === 'open' && t.type !== 'meme_coin');
  const now = Date.now();
  for (const trade of trades) {
    // Only check if at least 1 candle after signal (use timeframe in milliseconds)
    const signalTime = new Date(trade.timestamp).getTime();
    const timeframeMs = trade.timeframe === '1h' ? 3600000 : 14400000; // 1h or 4h
    if (now - signalTime < timeframeMs) continue; // wait for next candle

    // Fetch latest candle for the same pair/timeframe
    const indicators = await binanceService.getIndicators(trade.symbol, trade.timeframe, 1);
    if (!indicators) continue;
    const currentPrice = indicators.price;

    // Check if stop loss or take profit hit
    if (trade.direction === 'BUY') {
      if (currentPrice <= trade.stopLoss) {
        trade.status = 'closed';
        trade.outcome = 'loss';
      } else if (currentPrice >= trade.takeProfit) {
        trade.status = 'closed';
        trade.outcome = 'win';
      }
    } else { // SELL
      if (currentPrice >= trade.stopLoss) {
        trade.status = 'closed';
        trade.outcome = 'loss';
      } else if (currentPrice <= trade.takeProfit) {
        trade.status = 'closed';
        trade.outcome = 'win';
      }
    }
  }
}

function getStats() {
  const trades = tradeHistory.getAll().filter(t => t.outcome);
  const wins = trades.filter(t => t.outcome === 'win').length;
  const total = trades.length;
  return { wins, total, winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : 0 };
}

module.exports = { checkOpenTrades, getStats };
