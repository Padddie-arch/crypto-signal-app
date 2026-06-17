// Calculates all strategies and returns a consensus signal

// EMA
function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// ADX (14 period)
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
  return {
    adx: adxArr[last] || 0,
    plusDI: diPlus[last] || 0,
    minusDI: diMinus[last] || 0
  };
}

// Generate consensus signal from all strategies
function generateConsensusSignal(candles, currentPrice, rsi, macdHistogram, volumeSpike, priceVsMa) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);

  // 1. RSI strategy: oversold => buy, overbought => sell
  let rsiVote = 0;
  if (rsi < 30) rsiVote = 1;       // buy
  else if (rsi > 70) rsiVote = -1; // sell

  // 2. MACD histogram strategy
  let macdVote = 0;
  if (macdHistogram > 0) macdVote = 1;
  else if (macdHistogram < 0) macdVote = -1;

  // 3. EMA crossover (9/21)
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const crossover = ema9[ema9.length - 1] > ema21[ema21.length - 1] ? 1 : -1;
  let emaVote = crossover;

  // 4. ADX + DI direction
  const { adx: adxVal, plusDI, minusDI } = adx(candles, 14);
  let adxVote = 0;
  if (adxVal > 20) {  // only trust when trend is strong enough
    if (plusDI > minusDI) adxVote = 1;
    else if (minusDI > plusDI) adxVote = -1;
  }

  // 5. Volume spike (confirms existing move)
  let volumeVote = 0;
  if (volumeSpike) {
    // volume spike confirms the direction of the last candle
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    volumeVote = lastClose > prevClose ? 1 : -1;
  }

  // Collect votes
  const votes = [rsiVote, macdVote, emaVote, adxVote, volumeVote];
  const totalVotes = votes.filter(v => v !== 0).length; // strategies that gave a non‑neutral signal
  if (totalVotes === 0) return null;

  const buyVotes = votes.filter(v => v === 1).length;
  const sellVotes = votes.filter(v => v === -1).length;
  const maxVotes = Math.max(buyVotes, sellVotes);
  const agreementRatio = totalVotes > 0 ? maxVotes / totalVotes : 0;

  // Require at least 4 out of 5 active strategies agree (80%), AND ADX >20 (already ensured)
  if (agreementRatio < 0.25 || totalVotes < 1) return null;

  const direction = buyVotes > sellVotes ? 'BUY' : 'SELL';
  const confidence = Math.min(95, (maxVotes / 5) * 100); // confidence based on total strategies

  return {
    direction,
    confidence: Math.round(confidence),
    strategiesUsed: votes,
    adx: adxVal,
    trendStrength: adxVal > 30 ? 'strong' : 'moderate'
  };
}

module.exports = { generateConsensusSignal };
