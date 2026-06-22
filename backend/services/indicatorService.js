// Professional‑grade consensus engine – strict, high‑accuracy version
// Requires ALL 5 strategies to agree, plus trend & volatility filters.

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

function generateConsensusSignal(candles, currentPrice, rsi, macdHistogram, volumeSpike, priceVsMa) {
  const closes = candles.map(c => c.close);
  const lastCandle = candles[candles.length - 1];

  // --- FILTER 1: Volatility (ATR must be > 1% of price) ---
  const currentATR = atr(candles, 14);
  if (currentATR / currentPrice < 0.01) return null;   // dead market

  // --- FILTER 2: Trend (200 EMA) ---
  const ema200 = ema(closes, 200);
  const ema200Now = ema200[ema200.length - 1];
  const trend = currentPrice > ema200Now ? 'up' : 'down';
  // We only allow trades in the trend direction
  // Direction will be determined later by consensus, but we also require that the consensus direction matches the trend.

  // --- 5 STRATEGIES ---
  // 1. RSI
  let rsiVote = 0;
  if (rsi < 30) rsiVote = 1;
  else if (rsi > 70) rsiVote = -1;

  // 2. MACD histogram
  let macdVote = 0;
  if (macdHistogram > 0) macdVote = 1;
  else if (macdHistogram < 0) macdVote = -1;

  // 3. EMA crossover (9/21)
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const crossover = ema9[ema9.length - 1] > ema21[ema21.length - 1] ? 1 : -1;
  let emaVote = crossover;

  // 4. ADX + DI
  const { adx: adxVal, plusDI, minusDI } = adx(candles, 14);
  let adxVote = 0;
  if (adxVal > 20) {
    adxVote = plusDI > minusDI ? 1 : -1;
  }

  // 5. Volume spike
  let volumeVote = 0;
  if (volumeSpike) {
    const prevClose = closes[closes.length - 2];
    volumeVote = lastCandle.close > prevClose ? 1 : -1;
  }

  // Collect votes
  const votes = [rsiVote, macdVote, emaVote, adxVote, volumeVote];
  const buyVotes = votes.filter(v => v === 1).length;
  const sellVotes = votes.filter(v => v === -1).length;
  const totalNonZero = votes.filter(v => v !== 0).length;

  // --- REQUIRE ALL 5 STRATEGIES ACTIVE & ALL AGREE ---
  if (totalNonZero < 5) return null;          // All must be active
  if (buyVotes !== 5 && sellVotes !== 5) return null;   // Not unanimous

  const direction = buyVotes === 5 ? 'BUY' : 'SELL';

  // --- FILTER 3: Trade must be in the direction of the 200 EMA trend ---
  if ((direction === 'BUY' && trend !== 'up') || (direction === 'SELL' && trend !== 'down')) return null;

  // --- FILTER 4: Last candle must agree (momentum) ---
  if (direction === 'BUY' && lastCandle.close <= lastCandle.open) return null;
  if (direction === 'SELL' && lastCandle.close >= lastCandle.open) return null;

  // ATR‑based stop loss and take profit
  const stopLoss = direction === 'BUY' ? currentPrice - currentATR * 1.5 : currentPrice + currentATR * 1.5;
  const takeProfit = direction === 'BUY' ? currentPrice + currentATR * 3 : currentPrice - currentATR * 3;

  // Confidence is always 100 when we reach this point
  return {
    direction,
    confidence: 100,          // only the strongest
    stopLoss,
    takeProfit,
    atr: currentATR,
    adx: adxVal,
    trend,
    timestamp: new Date().toISOString()
  };
}

module.exports = { generateConsensusSignal };
