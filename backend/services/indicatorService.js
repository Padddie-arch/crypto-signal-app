// 11-STRATEGY ENGINE + VWAP + ADX FILTER
// Strategies: RSI, MACD, EMA cross, ADX, Volume, StochRSI, Ichimoku, Bollinger %B, Aroon, Candle Pattern, RSI Divergence

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
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const atrArr = [tr[0]];
  for (let i = 1; i < tr.length; i++) {
    atrArr.push((atrArr[i - 1] * (period - 1) + tr[i]) / period);
  }
  return atrArr[atrArr.length - 1];
}

function stochRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const rsiValues = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  }
  const recent = rsiValues.slice(-period);
  const minRSI = Math.min(...recent);
  const maxRSI = Math.max(...recent);
  if (maxRSI === minRSI) return 50;
  return ((rsiValues[rsiValues.length - 1] - minRSI) / (maxRSI - minRSI)) * 100;
}

function ichimoku(candles) {
  if (candles.length < 52) return { vote: 0 };
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const tenkanPeriod = 9, kijunPeriod = 26;
  const tenkan = (Math.max(...highs.slice(-tenkanPeriod)) + Math.min(...lows.slice(-tenkanPeriod))) / 2;
  const kijun = (Math.max(...highs.slice(-kijunPeriod)) + Math.min(...lows.slice(-kijunPeriod))) / 2;
  let vote = 0;
  if (tenkan > kijun) vote = 1;
  else if (tenkan < kijun) vote = -1;
  return { vote, tenkan, kijun };
}

function bollingerPercentB(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { vote: 0 };
  const ma = closes.slice(-period).reduce((a,b)=>a+b,0)/period;
  const variance = closes.slice(-period).reduce((sum,val)=>sum + (val-ma)**2,0)/period;
  const std = Math.sqrt(variance);
  const upper = ma + stdDev * std;
  const lower = ma - stdDev * std;
  const b = (closes[closes.length-1] - lower) / (upper - lower || 1e-10);
  let vote = 0;
  if (b < 0.2) vote = 1;
  else if (b > 0.8) vote = -1;
  return { vote, bValue: b };
}

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

function candlePattern(candles) {
  if (candles.length < 2) return { vote: 0 };
  const last = candles[candles.length-1], prev = candles[candles.length-2];
  const body = last.close - last.open, prevBody = prev.close - prev.open;
  const totalRange = last.high - last.low;
  let vote = 0, pattern = '';
  if (prevBody < 0 && body > 0 && last.close > prev.open && last.open < prev.close) {
    vote = 1; pattern = 'Bull Engulf';
  } else if (prevBody > 0 && body < 0 && last.close < prev.open && last.open > prev.close) {
    vote = -1; pattern = 'Bear Engulf';
  } else if (body > 0 && last.low < last.open - body * 2 && last.close - last.low > 2*Math.abs(body)) {
    vote = 1; pattern = 'Hammer';
  } else if (body < 0 && last.high > last.open + Math.abs(body) * 2 && last.high - last.close > 2*Math.abs(body)) {
    vote = -1; pattern = 'Shoot Star';
  }
  return { vote, pattern };
}

// RSI Divergence (new)
function rsiDivergence(candles, rsiPeriod = 14) {
  if (candles.length < 20) return { vote: 0 };
  const closes = candles.map(c => c.close);
  // compute RSI array
  const rsiValues = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= rsiPeriod; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / rsiPeriod, avgLoss = losses / rsiPeriod;
  rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  for (let i = rsiPeriod + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (rsiPeriod - 1) + (diff > 0 ? diff : 0)) / rsiPeriod;
    avgLoss = (avgLoss * (rsiPeriod - 1) + (diff < 0 ? -diff : 0)) / rsiPeriod;
    rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1e-10))));
  }
  // Check last 10 candles for divergence
  const priceWindow = closes.slice(-10);
  const rsiWindow = rsiValues.slice(-10);
  let vote = 0;
  // Bullish divergence: price makes lower low, RSI makes higher low
  const priceMinIdx = priceWindow.indexOf(Math.min(...priceWindow));
  const rsiMinIdx = rsiWindow.indexOf(Math.min(...rsiWindow));
  if (priceMinIdx === priceWindow.length - 1 && rsiMinIdx !== priceWindow.length - 1 && rsiWindow[priceWindow.length - 1] > rsiMin) vote = 1;
  // Bearish divergence: price makes higher high, RSI makes lower high
  const priceMaxIdx = priceWindow.indexOf(Math.max(...priceWindow));
  const rsiMaxIdx = rsiWindow.indexOf(Math.max(...rsiWindow));
  if (priceMaxIdx === priceWindow.length - 1 && rsiMaxIdx !== priceWindow.length - 1 && rsiWindow[priceWindow.length - 1] < rsiMax) vote = -1;
  return { vote, divergence: vote !== 0 ? (vote === 1 ? 'bullish' : 'bearish') : '' };
}

function vwap(candles) {
  // Compute cumulative typical price * volume / cumulative volume
  let sumTPV = 0, sumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    sumTPV += tp * c.volume;
    sumVol += c.volume;
  }
  return sumVol > 0 ? sumTPV / sumVol : candles[candles.length-1].close;
}

function generateConsensusSignal(candles, currentPrice, rsi, macdHistogram, volumeSpike, priceVsMa) {
  const closes = candles.map(c => c.close);

  // ----- FILTERS -----
  const currentATR = atr(candles, 14);
  // ADX > 25 strictly
  const { adx: adxVal } = adx(candles, 14);
  if (adxVal <= 25) return null;

  // VWAP filter
  const vwapValue = vwap(candles);
  // Direction not yet known, but we'll reject later based on direction
  // We'll store vwapValue and check after direction is determined.

  // ----- 11 STRATEGIES -----
  let rsiVote = 0;
  if (rsi < 30) rsiVote = 1;
  else if (rsi > 70) rsiVote = -1;

  let macdVote = 0;
  if (macdHistogram > 0) macdVote = 1;
  else if (macdHistogram < 0) macdVote = -1;

  const ema9 = ema(closes, 9), ema21 = ema(closes, 21);
  const crossover = ema9[ema9.length-1] > ema21[ema21.length-1] ? 1 : -1;

  const { plusDI, minusDI } = adx(candles, 14);
  let adxVote = 0;
  if (adxVal > 20) { adxVote = plusDI > minusDI ? 1 : -1; }

  let volumeVote = 0;
  if (volumeSpike) {
    const prevClose = closes[closes.length-2];
    volumeVote = candles[candles.length-1].close > prevClose ? 1 : -1;
  }

  const stochValue = stochRSI(closes, 14);
  let stochVote = 0;
  if (stochValue < 20) stochVote = 1;
  else if (stochValue > 80) stochVote = -1;

  const ichi = ichimoku(candles);
  let ichiVote = ichi.vote || 0;

  const boll = bollingerPercentB(closes, 20, 2);
  let bollVote = boll.vote || 0;

  const aroonResult = aroon(candles, 14);
  let aroonVote = aroonResult.vote || 0;

  const candlePat = candlePattern(candles);
  let candleVote = candlePat.vote || 0;

  const divergence = rsiDivergence(candles, 14);
  let divVote = divergence.vote || 0;

  const votes = [rsiVote, macdVote, crossover, adxVote, volumeVote, stochVote, ichiVote, bollVote, aroonVote, candleVote, divVote];
  const buyVotes = votes.filter(v => v === 1).length;
  const sellVotes = votes.filter(v => v === -1).length;
  const totalNonZero = votes.filter(v => v !== 0).length;
  const maxVotes = Math.max(buyVotes, sellVotes);
  const TOTAL_STRATEGIES = 11;

  if (totalNonZero < 1 || maxVotes / totalNonZero < 0.2) return null;
  const direction = buyVotes > sellVotes ? 'BUY' : 'SELL';

  // VWAP filter: reject if wrong side
  if (direction === 'BUY' && currentPrice <= vwapValue) return null;
  if (direction === 'SELL' && currentPrice >= vwapValue) return null;

  const confidence = Math.round((maxVotes / TOTAL_STRATEGIES) * 100);
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
    vwap: vwapValue,
    divergence: divergence.divergence || '',
    pattern: candlePat.pattern || '',
    trend: 'any',
    timestamp: new Date().toISOString()
  };
}

module.exports = { generateConsensusSignal };
