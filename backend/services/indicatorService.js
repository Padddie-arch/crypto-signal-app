// 10-STRATEGY CONSENSUS ENGINE
// Original 5: RSI, MACD, EMA Crossover, ADX, Volume Spike
// New 5: StochRSI, Ichimoku, Bollinger %B, Aroon, Candlestick Pattern

function ema(data, period) {
  if (data.length < period) return [data[data.length - 1]];
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function adx(candles, period = 14) {
  if (candles.length < period + 1) return { adx: 0, plusDI: 0, minusDI: 0 };
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    const trueRange = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    tr.push(trueRange);
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  function wilderSmooth(arr, period) {
    const smoothed = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
      smoothed.push((smoothed[i - 1] * (period - 1) + arr[i]) / period);
    }
    return smoothed;
  }
  const atr = wilderSmooth(tr, period);
  const smoothedPlus = wilderSmooth(plusDM, period);
  const smoothedMinus = wilderSmooth(minusDM, period);
  const diPlus = smoothedPlus.map((v, i) => (v / atr[i]) * 100);
  const diMinus = smoothedMinus.map((v, i) => (v / atr[i]) * 100);
  const dx = diPlus.map((v, i) => Math.abs(v - diMinus[i]) / (v + diMinus[i]) * 100);
  const adxArr = [dx[0]];
  for (let i = 1; i < dx.length; i++) {
    adxArr.push((adxArr[i - 1] * (period - 1) + dx[i]) / period);
  }
  const last = adxArr.length - 1;
  return { adx: adxArr[last] || 0, plusDI: diPlus[last] || 0, minusDI: diMinus[last] || 0 };
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const trueRange = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    tr.push(trueRange);
  }
  const atrArr = [tr[0]];
  for (let i = 1; i < tr.length; i++) {
    atrArr.push((atrArr[i - 1] * (period - 1) + tr[i]) / period);
  }
  return atrArr[atrArr.length - 1];
}

// StochRSI (14, 3)
function stochRSI(closes, period = 14, smoothK = 3) {
  if (closes.length < period + 1) return 50;
  // Compute RSI values
  const rsiValues = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  }
  // Stochastic of RSI: use last `period` RSIs
  const recentRSI = rsiValues.slice(-period);
  const minRSI = Math.min(...recentRSI);
  const maxRSI = Math.max(...recentRSI);
  if (maxRSI - minRSI === 0) return 50;
  const rawK = ((rsiValues[rsiValues.length - 1] - minRSI) / (maxRSI - minRSI)) * 100;
  // Smooth K with EMA of rawK (optional, here we just return rawK)
  return rawK;   // 0-100, where <20 oversold, >80 overbought
}

// Ichimoku (Tenkan-sen 9, Kijun-sen 26)
function ichimoku(candles) {
  if (candles.length < 52) return { vote: 0 };  // need enough data
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  const tenkanPeriod = 9, kijunPeriod = 26;
  const tenkan = (highs.slice(-tenkanPeriod).reduce((a,b)=>Math.max(a,b)) + lows.slice(-tenkanPeriod).reduce((a,b)=>Math.min(a,b))) / 2;
  const kijun = (highs.slice(-kijunPeriod).reduce((a,b)=>Math.max(a,b)) + lows.slice(-kijunPeriod).reduce((a,b)=>Math.min(a,b))) / 2;
  const currentPrice = closes[closes.length - 1];
  const cloudTop = Math.max(tenkan, kijun);
  const cloudBottom = Math.min(tenkan, kijun);

  let vote = 0;
  // Tenkan/Kijun cross (Tenkan above Kijun = bullish)
  if (tenkan > kijun) vote = 1;
  else if (tenkan < kijun) vote = -1;

  // Additionally, price above cloud reinforces; below reverses
  // We'll keep it simple: use cross direction
  return { vote, tenkan, kijun, cloudTop, cloudBottom };
}

// Bollinger %B (20,2)
function bollingerPercentB(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { vote: 0, bValue: 0.5 };
  const ma = closes.slice(-period).reduce((a,b)=>a+b,0)/period;
  const variance = closes.slice(-period).reduce((sum, val) => sum + (val - ma) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = ma + stdDev * std;
  const lower = ma - stdDev * std;
  const currentPrice = closes[closes.length - 1];
  const b = (currentPrice - lower) / (upper - lower || 1e-10);
  let vote = 0;
  if (b < 0.2) vote = 1;   // oversold
  else if (b > 0.8) vote = -1; // overbought
  return { vote, bValue: b };
}

// Aroon (14)
function aroon(candles, period = 14) {
  if (candles.length < period) return { vote: 0 };
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const lastHigh = Math.max(...highs.slice(-period));
  const lastLow = Math.min(...lows.slice(-period));
  const daysSinceHigh = highs.slice(-period).reverse().findIndex(h => h === lastHigh);
  const daysSinceLow = lows.slice(-period).reverse().findIndex(l => l === lastLow);
  const aroonUp = ((period - daysSinceHigh) / period) * 100;
  const aroonDown = ((period - daysSinceLow) / period) * 100;
  let vote = 0;
  if (aroonUp > aroonDown + 20) vote = 1;
  else if (aroonDown > aroonUp + 20) vote = -1;
  return { vote, aroonUp, aroonDown };
}

// Candlestick patterns (last two candles)
function candlePattern(candles) {
  if (candles.length < 2) return { vote: 0, pattern: '' };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = last.close - last.open;
  const prevBody = prev.close - prev.open;
  const totalRange = last.high - last.low;
  const prevRange = prev.high - prev.low;

  let vote = 0, pattern = '';

  // Engulfing (bullish engulfing)
  if (prevBody < 0 && body > 0 && last.close > prev.open && last.open < prev.close && totalRange > prevRange) {
    vote = 1; pattern = 'Bull Engulf';
  }
  // Bearish engulfing
  else if (prevBody > 0 && body < 0 && last.close < prev.open && last.open > prev.close && totalRange > prevRange) {
    vote = -1; pattern = 'Bear Engulf';
  }
  // Hammer (long lower wick, small body at top)
  else if (body > 0 && (last.low < last.open - body * 2) && (last.close - last.low > 2 * Math.abs(body)) && totalRange > 0) {
    vote = 1; pattern = 'Hammer';
  }
  // Shooting star (long upper wick, small body at bottom)
  else if (body < 0 && (last.high > last.open + Math.abs(body) * 2) && (last.high - last.close > 2 * Math.abs(body)) && totalRange > 0) {
    vote = -1; pattern = 'Shoot Star';
  }
  // Doji (tiny body)
  else if (Math.abs(body) < totalRange * 0.1 && totalRange > 0) {
    pattern = 'Doji'; // neutral, no vote
  }

  return { vote, pattern };
}

function generateConsensusSignal(candles, currentPrice, rsi, macdHistogram, volumeSpike, priceVsMa) {
  const closes = candles.map(c => c.close);

  // --- ORIGINAL 5 STRATEGIES ---
  // 1. RSI
  let rsiVote = 0;
  if (rsi < 30) rsiVote = 1;
  else if (rsi > 70) rsiVote = -1;

  // 2. MACD
  let macdVote = 0;
  if (macdHistogram > 0) macdVote = 1;
  else if (macdHistogram < 0) macdVote = -1;

  // 3. EMA crossover
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const crossover = ema9[ema9.length - 1] > ema21[ema21.length - 1] ? 1 : -1;
  let emaVote = crossover;

  // 4. ADX
  const { adx: adxVal, plusDI, minusDI } = adx(candles, 14);
  let adxVote = 0;
  if (adxVal > 20) {
    adxVote = plusDI > minusDI ? 1 : -1;
  }

  // 5. Volume spike
  let volumeVote = 0;
  if (volumeSpike) {
    const prevClose = closes[closes.length - 2];
    volumeVote = candles[candles.length - 1].close > prevClose ? 1 : -1;
  }

  // --- NEW 5 STRATEGIES ---
  // 6. StochRSI
  const stochValue = stochRSI(closes, 14, 3);
  let stochVote = 0;
  if (stochValue < 20) stochVote = 1;
  else if (stochValue > 80) stochVote = -1;

  // 7. Ichimoku
  const ichi = ichimoku(candles);
  let ichiVote = ichi.vote || 0;

  // 8. Bollinger %B
  const boll = bollingerPercentB(closes, 20, 2);
  let bollVote = boll.vote || 0;

  // 9. Aroon
  const aroonResult = aroon(candles, 14);
  let aroonVote = aroonResult.vote || 0;

  // 10. Candlestick pattern
  const candlePatternResult = candlePattern(candles);
  let candleVote = candlePatternResult.vote || 0;

  const votes = [rsiVote, macdVote, emaVote, adxVote, volumeVote, stochVote, ichiVote, bollVote, aroonVote, candleVote];
  const buyVotes = votes.filter(v => v === 1).length;
  const sellVotes = votes.filter(v => v === -1).length;
  const totalNonZero = votes.filter(v => v !== 0).length;
  const maxVotes = Math.max(buyVotes, sellVotes);
  const TOTAL_STRATEGIES = 10;

  // Keep the same permissive filter (at least 1 active and any agreement)
  if (totalNonZero < 1) return null;
  if (maxVotes / totalNonZero < 0.2) return null;

  const direction = buyVotes > sellVotes ? 'BUY' : 'SELL';
  const confidence = Math.round((maxVotes / TOTAL_STRATEGIES) * 100);

  const currentATR = atr(candles, 14) || 0.01;
  const stopLoss = direction === 'BUY' ? currentPrice - currentATR * 1.5 : currentPrice + currentATR * 1.5;
  const takeProfit = direction === 'BUY' ? currentPrice + currentATR * 3 : currentPrice - currentATR * 3;

  return {
    direction,
    confidence,
    aligned: maxVotes,
    totalActive: totalNonZero,
    totalStrategies: TOTAL_STRATEGIES,
    stopLoss,
    takeProfit,
    atr: currentATR,
    adx: adxVal,
    trend: 'any',
    pattern: candlePatternResult.pattern || '',
    timestamp: new Date().toISOString()
  };
}

module.exports = { generateConsensusSignal };
