const SERVER_URL = 'https://crypto-signal-app-cvxw.onrender.com';
let signals = [], memeCoins = [], chartInstance = null;
let theme = localStorage.getItem('theme') || 'dark';

// Theme toggle
function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.body.className = theme;
  localStorage.setItem('theme', theme);
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

// Sound alert function
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
  if (document.getElementById('history-section').style.display !== 'none') loadHistory();
  if (document.getElementById('stats-section').style.display !== 'none') loadStats();
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

// Render signals with 6 decimals & news
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
    const newsLine = s.newsHeadlines && s.newsHeadlines.length > 0
      ? '<div class="info">📰 News: ' + s.newsHeadlines[0].substring(0, 60) + '...</div>' : '';
    return '<div class="signal-card" onclick="openChart(\'' + s.symbol + '\')">' +
      '<div class="pair-row">' +
        '<span style="color:' + color + '; font-weight:bold;">' + s.pair + ' ' + s.direction + '</span>' +
        '<span class="timeframe">' + s.timeframe + '</span>' +
      '</div>' +
      '<div>Price: $' + price + '</div>' +
      '<div class="confidence">Confidence: ' + s.confidence + '% (' + (s.aligned || 0) + '/' + (s.totalStrategies || 12) + ')</div>' +
      (s.pattern ? '<div class="info">Pattern: ' + s.pattern + '</div>' : '') +
      (s.divergence ? '<div class="info">Divergence: ' + s.divergence + '</div>' : '') +
      '<div class="info">RSI: ' + (s.rsi ? s.rsi.toFixed(1) : 'N/A') + ' | MACD: ' + (s.macd ? Number(s.macd).toFixed(4) : 'N/A') + '</div>' +
      '<div class="info">SL: $' + sl + ' | TP: $' + tp + '</div>' +
      '<div class="info">Trailing Stop: ' + trail + '</div>' +
      newsLine +
    '</div>';
  }).join('');
}

// Load history
async function loadHistory() {
  try {
    const res = await fetch(SERVER_URL + '/api/history');
    const history = await res.json();
    const list = document.getElementById('historyList');
    if (!history.length) { list.innerHTML='<div class="info">No past signals.</div>'; return; }
    list.innerHTML = history.reverse().map(s => {
      if (s.type === 'meme_coin') {
        return '<div class="history-card">' +
          '<div class="pair-row"><span>🐶 ' + s.name + ' (' + s.symbol + ')</span><span class="date">' + new Date(s.timestamp).toLocaleString() + '</span></div>' +
          '<div>Price: $' + (s.price ? Number(s.price).toFixed(6) : '0') + ' | Prob: ' + s.probability + '%</div>' +
        '</div>';
      }
      const isBuy = s.direction === 'BUY';
      const color = isBuy ? '#00e676' : '#ff5252';
      const price = (s.price || 0).toFixed(6);
      const sl = (s.stopLoss || 0).toFixed(6);
      const tp = (s.takeProfit || 0).toFixed(6);
      const newsLine = s.newsHeadlines && s.newsHeadlines.length > 0
        ? '<div class="info">📰 News: ' + s.newsHeadlines[0].substring(0, 60) + '...</div>' : '';
      return '<div class="history-card">' +
        '<div class="pair-row">' +
          '<span style="color:' + color + '; font-weight:bold;">' + s.pair + ' ' + s.direction + '</span>' +
          '<span class="timeframe">' + s.timeframe + '</span>' +
        '</div>' +
        '<div>Price: $' + price + ' | Confidence: ' + s.confidence + '%</div>' +
        (s.pattern ? '<div class="info">Pattern: ' + s.pattern + '</div>' : '') +
        '<div class="info">SL: $' + sl + ' | TP: $' + tp + '</div>' +
        '<div class="date">' + new Date(s.timestamp).toLocaleString() + '</div>' +
        (s.outcome ? '<div class="info">Outcome: ' + (s.outcome === 'win' ? '✅ Win' : '❌ Loss') + '</div>' : '') +
        newsLine +
      '</div>';
    }).join('');
  } catch(e) {}
}

// Load stats (now with win/loss sub‑tabs)
async function loadStats() {
  // Fetch both stats and full history
  try {
    const [statsRes, historyRes] = await Promise.all([
      fetch(SERVER_URL + '/api/stats'),
      fetch(SERVER_URL + '/api/history')
    ]);
    const stats = await statsRes.json();
    const history = await historyRes.json();

    // Build summary
    const summaryHtml =
      '<p>Total closed trades: ' + stats.total + '</p>' +
      '<p>Wins: ' + stats.wins + '</p>' +
      '<p>Win rate: ' + stats.winRate + '%</p>';

    // Filter closed trades with outcome
    const closed = history.filter(t => t.outcome);
    const wins = closed.filter(t => t.outcome === 'win');
    const losses = closed.filter(t => t.outcome === 'loss');

    // Generate cards for wins and losses
    const cardsHtml = (items, outcomeLabel) => {
      if (items.length === 0) return '<div class="info">No trades yet.</div>';
      return items.reverse().map(s => {
        const isBuy = s.direction === 'BUY';
        const color = isBuy ? '#00e676' : '#ff5252';
        const price = (s.price || 0).toFixed(6);
        const sl = (s.stopLoss || 0).toFixed(6);
        const tp = (s.takeProfit || 0).toFixed(6);
        return '<div class="history-card">' +
          '<div class="pair-row">' +
            '<span style="color:' + color + '; font-weight:bold;">' + s.pair + ' ' + s.direction + '</span>' +
            '<span class="timeframe">' + s.timeframe + '</span>' +
          '</div>' +
          '<div>Price: $' + price + ' | Confidence: ' + s.confidence + '%</div>' +
          '<div class="info">SL: $' + sl + ' | TP: $' + tp + '</div>' +
          '<div class="date">' + new Date(s.timestamp).toLocaleString() + '</div>' +
          '<div class="info">Outcome: ' + outcomeLabel + '</div>' +
        '</div>';
      }).join('');
    };

    const winsHtml = '<h3>✅ Wins (' + wins.length + ')</h3>' + cardsHtml(wins, '✅ Win');
    const lossesHtml = '<h3>❌ Losses (' + losses.length + ')</h3>' + cardsHtml(losses, '❌ Loss');

    document.getElementById('statsContent').innerHTML =
      summaryHtml +
      '<div class="stats-subtabs">' +
        '<button class="subtab active" onclick="switchSubTab(\'wins\')">Wins</button>' +
        '<button class="subtab" onclick="switchSubTab(\'losses\')">Losses</button>' +
      '</div>' +
      '<div id="wins-section">' + winsHtml + '</div>' +
      '<div id="losses-section" style="display:none;">' + lossesHtml + '</div>';

    // Attach sub‑tab handlers
    window._winsHtml = winsHtml;
    window._lossesHtml = lossesHtml;

  } catch(e) {}
}

// Sub‑tab switching inside Stats
function switchSubTab(name) {
  document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
  document.querySelector(`.subtab:nth-${name === 'wins' ? '1' : '2'}`).classList.add('active');
  document.getElementById('wins-section').style.display = name === 'wins' ? 'block' : 'none';
  document.getElementById('losses-section').style.display = name === 'losses' ? 'block' : 'none';
}

// Meme coins
function renderMemeCoins() {
  document.getElementById('memeList').innerHTML = memeCoins.map(c =>
    '<div class="meme-item">' + c.name + ' (' + c.symbol + ') - $' + c.price.toFixed(6) + ' | Prob: ' + c.probability + '%</div>'
  ).join('');
}

// Chart (unchanged)
async function openChart(symbol) {
  document.getElementById('chartModal').style.display = 'block';
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=' + symbol + '&interval=1h&limit=20');
    const data = await res.json();
    const closes = data.map(c => parseFloat(c[4]));
    const labels = data.map((_, i) => i.toString());
    const ctx = document.getElementById('priceChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: [{ label: symbol, data: closes, borderColor: '#00c8ff', backgroundColor: 'rgba(0,200,255,0.1)', tension: 0.4 }] },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#fff' } } },
        scales: { x: { ticks: { color: '#fff' } }, y: { ticks: { color: '#fff' } } }
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
