const SERVER_URL = 'https://crypto-signal-app-cvxw.onrender.com';   // your real Render URL
let signals = [], memeCoins = [], chartInstance = null;
let theme = localStorage.getItem('theme') || 'dark';

// Theme toggle (icon: moon/sun)
function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.body.className = theme;
  localStorage.setItem('theme', theme);
  const icon = document.querySelector('#themeToggle i');
  if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}
document.body.className = theme;
document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

// Scroll to top button
window.addEventListener('scroll', () => {
  document.getElementById('scrollToTop').style.display = window.scrollY > 200 ? 'block' : 'none';
});

// Ticker update
async function updateTicker() {
  try {
    const res = await fetch(SERVER_URL + '/api/prices');
    if (!res.ok) throw new Error('Bad response');
    const prices = await res.json();
    let html = '';
    for (const [sym, price] of Object.entries(prices)) {
      html += `${sym}: $${Number(price).toFixed(6)}  |  `;
    }
    document.getElementById('tickerContent').textContent = html.slice(0, -3) || 'Waiting for prices...';
  } catch(e) {
    document.getElementById('tickerContent').textContent = 'Prices loading... will update soon';
  }
}
setInterval(updateTicker, 60000);
updateTicker();

// Sound alert
function playAlert() {
  document.getElementById('alertSound')?.play().catch(() => {});
}

// Socket connection
const socket = io(SERVER_URL);
socket.on('new_signals', (data) => {
  const normal = data.filter(s => !s.type);
  const meme = data.filter(s => s.type === 'meme_coin');
  signals = [...normal, ...signals].slice(0, 50);
  memeCoins = meme;
  renderSignals();
  renderMemeCoins();
  const strong = normal.filter(s => (s.aligned || 0) >= 8 && (s.totalStrategies || 12) >= 12);
  if (strong.length > 0) playAlert();
});

// Tab switching
function switchTab(tab) {
  ['signals','history','stats'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t===tab);
    document.getElementById(`${t}-section`).style.display = t===tab ? 'block' : 'none';
  });
  if (tab==='history') loadHistory();
  if (tab==='stats') loadStats();
}

// ---------- AI INSIGHT (independent, isolated) ----------
function generateAIInsight(signal) {
  const direction = signal.direction === 'BUY' ? 'long' : 'short';
  const rsi = signal.rsi || 50;
  const macd = signal.macd || 0;
  const price = signal.price || 0;
  const sl = signal.stopLoss || price;
  const tp = signal.takeProfit || price;
  const volumeSpike = signal.volumeSpike;
  const trend = signal.trendDir || 'flat';
  const priceChange5 = parseFloat(signal.priceChange5) || 0;
  const news = signal.newsHeadlines || [];
  const divergence = signal.divergence || '';
  const pattern = signal.pattern || '';

  let insight = '';
  if (trend === 'up') insight += 'Trend is upward. ';
  else if (trend === 'down') insight += 'Trend is downward. ';
  else insight += 'Market is sideways. ';

  if (priceChange5 > 2) insight += `Price surged ${priceChange5}% in last 5 candles. `;
  else if (priceChange5 < -2) insight += `Price dropped ${priceChange5}% recently. `;
  else insight += `Price moved ${priceChange5}% over last 5 periods. `;

  if (rsi > 70) insight += `RSI is overbought (${rsi.toFixed(1)}). `;
  else if (rsi < 30) insight += `RSI is oversold (${rsi.toFixed(1)}). `;
  else insight += `RSI is neutral (${rsi.toFixed(1)}). `;

  if (macd > 0) insight += 'MACD is positive. ';
  else insight += 'MACD is negative. ';

  insight += volumeSpike ? 'Volume spike detected. ' : 'Volume is normal. ';

  if (pattern) insight += `Pattern: ${pattern}. `;
  if (divergence) insight += `Divergence: ${divergence}. `;

  if (news.length > 0) {
    const newsText = news.join(' ').toLowerCase();
    const posWords = ['surge','rally','bull','buy','gain','rise','high','green','up','record','jump'];
    const negWords = ['crash','drop','bear','sell','loss','fall','low','red','down','plunge','decline'];
    let pos = 0, neg = 0;
    posWords.forEach(w => { if (newsText.includes(w)) pos++; });
    negWords.forEach(w => { if (newsText.includes(w)) neg++; });
    if (pos > neg) insight += 'News sentiment is positive. ';
    else if (neg > pos) insight += 'News sentiment is negative. ';
    else insight += 'News is mixed. ';
  }

  const risk = Math.abs(price - sl);
  const reward = Math.abs(tp - price);
  const rr = (reward / risk).toFixed(2);
  if (rr >= 2) insight += `Risk:Reward is ${rr}:1 (excellent). `;
  else if (rr >= 1.5) insight += `Risk:Reward is ${rr}:1 (acceptable). `;
  else insight += `Risk:Reward is ${rr}:1 (caution). `;

  let verdict = '';
  if (trend === 'up' && direction === 'long' && rsi < 70 && macd > 0 && priceChange5 > 0)
    verdict = 'Trade aligns with trend and momentum.';
  else if (trend === 'down' && direction === 'short' && rsi > 30 && macd < 0 && priceChange5 < 0)
    verdict = 'Trade aligns with trend and momentum.';
  else if (trend === 'flat')
    verdict = 'Sideways market - proceed with caution.';
  else if ((direction === 'long' && trend === 'down') || (direction === 'short' && trend === 'up'))
    verdict = 'Trade goes against the trend. Higher risk.';
  else
    verdict = 'Mixed signals. Wait for clearer conditions.';

  return { insight, verdict };
}

function toggleAIInsight(signalId, button) {
  const div = document.getElementById(`ai-insight-${signalId}`);
  if (div.style.display === 'none' || div.style.display === '') {
    const signal = signals.find(s => s.id == signalId);
    if (signal) {
      const { insight, verdict } = generateAIInsight(signal);
      div.innerHTML = `<p style="color:#ccc;">${insight}</p><p style="font-weight:bold; margin-top:8px; color:#fff;">${verdict}</p>`;
    } else {
      div.innerHTML = 'Signal data not available.';
    }
    div.style.display = 'block';
    button.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Insight';
  } else {
    div.style.display = 'none';
    button.innerHTML = '<i class="fas fa-robot"></i> AI Insight';
  }
}

// ---------- RENDER SIGNALS ----------
function renderSignals() {
  const list = document.getElementById('signalList');
  const sorted = signals.sort((a,b) => b.confidence - a.confidence);
  list.innerHTML = sorted.map(s => {
    const isBuy = s.direction === 'BUY';
    const color = isBuy ? '#00e676' : '#ff5252';
    const price = (s.price || 0).toFixed(6);
    const sl = (s.stopLoss || 0).toFixed(6);
    const tp = (s.takeProfit || 0).toFixed(6);
    const trail = s.trailingStop ? '$' + Number(s.trailingStop).toFixed(6) : 'N/A';
    const dca = s.dcaPrice ? `<div class="info">DCA Level: $${Number(s.dcaPrice).toFixed(6)}</div>` : '';
    const newsLine = s.newsHeadlines && s.newsHeadlines.length > 0
      ? '<div class="info"><i class="fas fa-newspaper"></i> ' + s.newsHeadlines[0].substring(0, 60) + '...</div>' : '';

    const aligned = s.aligned || 0;
    let advisory = '';
    if (aligned >= 8) advisory = '<div style="background:#00e67633; color:#00e676; padding:4px 8px; border-radius:4px; font-weight:bold; margin-top:5px;"><i class="fas fa-check-circle"></i> Strong Signal – High Confidence</div>';
    else if (aligned >= 6) advisory = '<div style="background:#ffaa0033; color:#ffaa00; padding:4px 8px; border-radius:4px; font-weight:bold; margin-top:5px;"><i class="fas fa-balance-scale"></i> Moderate Signal – Consider Entry</div>';
    else if (aligned >= 4) advisory = '<div style="background:#ff525233; color:#ff5252; padding:4px 8px; border-radius:4px; font-weight:bold; margin-top:5px;"><i class="fas fa-exclamation-triangle"></i> Weak Signal – Caution</div>';
    else advisory = '<div style="background:#88888833; color:#888; padding:4px 8px; border-radius:4px; font-weight:bold; margin-top:5px;"><i class="fas fa-times-circle"></i> Not Recommended</div>';

    return `<div class="signal-card">
      <div class="pair-row" onclick="openChart('${s.symbol}')" style="cursor:pointer;">
        <span style="color:${color}; font-weight:bold;">${s.pair} ${s.direction}</span>
        <span class="timeframe">${s.timeframe}</span>
      </div>
      <div onclick="openChart('${s.symbol}')" style="cursor:pointer;">Price: $${price}</div>
      <div class="confidence">Confidence: ${s.confidence}% (${aligned}/${s.totalStrategies || 12})</div>
      ${s.pattern ? '<div class="info">Pattern: ' + s.pattern + '</div>' : ''}
      ${s.divergence ? '<div class="info">Divergence: ' + s.divergence + '</div>' : ''}
      <div class="info">RSI: ${s.rsi ? s.rsi.toFixed(1) : 'N/A'} | MACD: ${s.macd ? Number(s.macd).toFixed(4) : 'N/A'}</div>
      <div class="info">SL: $${sl} | TP: $${tp}</div>
      <div class="info">Trailing Stop: ${trail}</div>
      ${dca}
      ${newsLine}
      ${advisory}
      <button onclick="toggleAIInsight('${s.id}', this)" style="margin-top:8px; padding:6px 12px; background:#4fc3f7; color:#000; border:none; border-radius:4px; font-weight:bold; cursor:pointer;"><i class="fas fa-robot"></i> AI Insight</button>
      <div id="ai-insight-${s.id}" style="display:none; margin-top:8px; padding:10px; background:#1e2a3a; border-radius:6px; color:#ccc; font-size:0.9em;"></div>
    </div>`;
  }).join('');
}

// ---------- HISTORY ----------
async function loadHistory() {
  try {
    const res = await fetch(SERVER_URL + '/api/history');
    const history = await res.json();
    const list = document.getElementById('historyList');
    if (!history.length) { list.innerHTML = '<div class="info">No past signals yet.</div>'; return; }
    list.innerHTML = history.reverse().map(s => {
      if (s.type === 'meme_coin') {
        return `<div class="history-card">
          <div class="pair-row"><span><i class="fas fa-dog"></i> ${s.name} (${s.symbol})</span><span class="date">${new Date(s.timestamp).toLocaleString()}</span></div>
          <div>Price: $${s.price ? Number(s.price).toFixed(6) : '0'} | Prob: ${s.probability}%</div>
        </div>`;
      }
      const isBuy = s.direction === 'BUY';
      const color = isBuy ? '#00e676' : '#ff5252';
      const price = (s.price || 0).toFixed(6);
      const sl = (s.stopLoss || 0).toFixed(6);
      const tp = (s.takeProfit || 0).toFixed(6);
      const outcome = s.outcome ? (s.outcome === 'win' ? '<i class="fas fa-check"></i> Win' : '<i class="fas fa-times"></i> Loss') : '';
      return `<div class="history-card">
        <div class="pair-row">
          <span style="color:${color}; font-weight:bold;">${s.pair} ${s.direction}</span>
          <span class="timeframe">${s.timeframe}</span>
        </div>
        <div>Price: $${price} | Confidence: ${s.confidence}%</div>
        <div class="info">SL: $${sl} | TP: $${tp}</div>
        <div class="date">${new Date(s.timestamp).toLocaleString()}</div>
        ${outcome ? `<div class="info">Outcome: ${outcome}</div>` : ''}
      </div>`;
    }).join('');
  } catch(e) { console.error('History error:', e); }
}

// ---------- STATS ----------
async function loadStats() {
  try {
    const [statsRes, historyRes] = await Promise.all([
      fetch(SERVER_URL + '/api/stats'),
      fetch(SERVER_URL + '/api/history')
    ]);
    const stats = await statsRes.json();
    const history = await historyRes.json();

    const summaryHtml = `
      <p>Total closed trades: ${stats.total}</p>
      <p>Wins: ${stats.wins}</p>
      <p>Win rate: ${stats.winRate}%</p>
    `;

    const closed = history.filter(t => t.outcome);
    const wins = closed.filter(t => t.outcome === 'win');
    const losses = closed.filter(t => t.outcome === 'loss');

    const cardsHtml = (items, outcomeLabel) => {
      if (items.length === 0) return '<div class="info">No trades yet.</div>';
      return items.reverse().map(s => {
        const isBuy = s.direction === 'BUY';
        const color = isBuy ? '#00e676' : '#ff5252';
        const price = (s.price || 0).toFixed(6);
        const sl = (s.stopLoss || 0).toFixed(6);
        const tp = (s.takeProfit || 0).toFixed(6);
        return `<div class="history-card">
          <div class="pair-row">
            <span style="color:${color}; font-weight:bold;">${s.pair} ${s.direction}</span>
            <span class="timeframe">${s.timeframe}</span>
          </div>
          <div>Price: $${price} | Confidence: ${s.confidence}%</div>
          <div class="info">SL: $${sl} | TP: $${tp}</div>
          <div class="date">${new Date(s.timestamp).toLocaleString()}</div>
          <div class="info">Outcome: ${outcomeLabel}</div>
        </div>`;
      }).join('');
    };

    const winsHtml = '<h3><i class="fas fa-trophy"></i> Wins (' + wins.length + ')</h3>' + cardsHtml(wins, '<i class="fas fa-check"></i> Win');
    const lossesHtml = '<h3><i class="fas fa-skull"></i> Losses (' + losses.length + ')</h3>' + cardsHtml(losses, '<i class="fas fa-times"></i> Loss');

    document.getElementById('statsContent').innerHTML = `
      ${summaryHtml}
      <div class="stats-subtabs">
        <button class="subtab active" onclick="switchSubTab('wins')">Wins</button>
        <button class="subtab" onclick="switchSubTab('losses')">Losses</button>
      </div>
      <div id="wins-section">${winsHtml}</div>
      <div id="losses-section" style="display:none;">${lossesHtml}</div>
    `;

    window.switchSubTab = function(name) {
      document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
      if (name === 'wins') {
        document.querySelector('.subtab:nth-child(1)').classList.add('active');
      } else {
        document.querySelector('.subtab:nth-child(2)').classList.add('active');
      }
      document.getElementById('wins-section').style.display = name === 'wins' ? 'block' : 'none';
      document.getElementById('losses-section').style.display = name === 'losses' ? 'block' : 'none';
    };
  } catch(e) { console.error('Stats error:', e); }
}

// Meme coins
function renderMemeCoins() {
  document.getElementById('memeList').innerHTML = memeCoins.map(c =>
    `<div class="meme-item">${c.name} (${c.symbol}) - $${c.price.toFixed(6)} | Prob: ${c.probability}%</div>`
  ).join('');
}

// Chart (unchanged)
async function openChart(symbol) {
  document.getElementById('chartModal').style.display = 'block';
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=20`);
    const data = await res.json();
    const closes = data.map(c => parseFloat(c[4]));
    const labels = data.map((_, i) => i.toString());
    const ctx = document.getElementById('priceChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label: symbol, data: closes, borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', tension: 0.4 }] },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#b0c4de' } } },
        scales: { x: { ticks: { color: '#b0c4de' } }, y: { ticks: { color: '#b0c4de' } } }
      }
    });
  } catch(err) { console.error(err); }
}
document.querySelector('.close')?.addEventListener('click', () => {
  document.getElementById('chartModal').style.display = 'none';
});

// Auto trade toggle
document.getElementById('autoTradeToggle')?.addEventListener('change', async (e) => {
  await fetch(SERVER_URL + '/api/autotrade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: e.target.checked })
  });
});

// Initial fetch
fetch(SERVER_URL + '/api/signals')
  .then(r => r.json())
  .then(data => {
    signals = data.filter(s => !s.type);
    memeCoins = data.filter(s => s.type === 'meme_coin');
    renderSignals();
    renderMemeCoins();
  });
