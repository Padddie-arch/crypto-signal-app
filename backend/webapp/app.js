const SERVER_URL = 'https://crypto-signal-app-cvxw.onrender.com';

let signals = [];
let memeCoins = [];
let chartInstance = null;

const socket = io(SERVER_URL);
socket.on('new_signals', (data) => {
  const normal = data.filter(s => !s.type);
  const meme = data.filter(s => s.type === 'meme_coin');
  signals = [...normal, ...signals].slice(0, 50);
  memeCoins = meme;
  renderSignals();
  renderMemeCoins();
  // If on history tab, refresh history as new signals are added
  if (document.getElementById('history-section').style.display !== 'none') {
    loadHistory();
  }
});

// ---- Tab switching ----
function switchTab(tabName) {
  document.getElementById('tab-signals').classList.remove('active');
  document.getElementById('tab-history').classList.remove('active');
  document.getElementById('tab-' + tabName).classList.add('active');

  document.getElementById('signals-section').style.display = (tabName === 'signals') ? 'block' : 'none';
  document.getElementById('history-section').style.display = (tabName === 'history') ? 'block' : 'none';

  if (tabName === 'history') loadHistory();
}

// ---- Render live signals ----
function renderSignals() {
  const list = document.getElementById('signalList');
  const sorted = signals.sort((a, b) => b.confidence - a.confidence);
  list.innerHTML = sorted.map(s => {
    const isBuy = s.direction === 'BUY';
    const color = isBuy ? '#00e676' : '#ff5252';
    return `
      <div class="signal-card" onclick="openChart('${s.symbol}')">
        <div class="pair-row">
          <span style="color:${color}; font-weight:bold;">${s.pair} ${s.direction}</span>
          <span class="timeframe">${s.timeframe}</span>
        </div>
        <div>Price: $${s.price?.toFixed(2)}</div>
        <div class="confidence">Confidence: ${s.confidence}% (${s.aligned || 0}/${s.totalStrategies || 5} strategies)</div>
        ${s.rsi ? `<div class="info">RSI: ${s.rsi.toFixed(1)} | MACD: ${s.macd.toFixed(4)}</div>` : ''}
        <div class="info">SL: $${s.stopLoss?.toFixed(2)} | TP: $${s.takeProfit?.toFixed(2)}</div>
        <div class="info">Trailing Stop: ${s.trailingStop ? '$' + s.trailingStop.toFixed(2) : 'N/A'}</div>
      </div>`;
  }).join('');
}

// ---- Load & render history ----
async function loadHistory() {
  try {
    const res = await fetch(`${SERVER_URL}/api/history`);
    const history = await res.json();
    const list = document.getElementById('historyList');
    if (history.length === 0) {
      list.innerHTML = '<div class="info" style="padding:20px;">No past signals yet.</div>';
      return;
    }
    // Show newest first
    const reversed = history.slice().reverse();
    list.innerHTML = reversed.map(s => {
      if (s.type === 'meme_coin') {
        return `<div class="history-card">
                  <div class="pair-row"><span>🐶 ${s.name} (${s.symbol})</span><span class="date">${new Date(s.timestamp).toLocaleString()}</span></div>
                  <div>Price: $${s.price?.toFixed(6)} | Prob: ${s.probability}%</div>
                </div>`;
      }
      const isBuy = s.direction === 'BUY';
      const color = isBuy ? '#00e676' : '#ff5252';
      return `
        <div class="history-card">
          <div class="pair-row">
            <span style="color:${color}; font-weight:bold;">${s.pair} ${s.direction}</span>
            <span class="timeframe">${s.timeframe}</span>
          </div>
          <div>Price: $${s.price?.toFixed(2)} | Confidence: ${s.confidence}%</div>
          <div class="info">SL: $${s.stopLoss?.toFixed(2)} | TP: $${s.takeProfit?.toFixed(2)}</div>
          <div class="date">${new Date(s.timestamp).toLocaleString()}</div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

// ---- Meme coins ----
function renderMemeCoins() {
  const list = document.getElementById('memeList');
  list.innerHTML = memeCoins.map(coin => `
    <div class="meme-item">
      ${coin.name} (${coin.symbol}) - $${coin.price.toFixed(6)} | Prob: ${coin.probability}%
    </div>`).join('');
}

// ---- Chart ----
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
      data: { labels: labels, datasets: [{ label: symbol, data: closes, borderColor: '#00c8ff', backgroundColor: 'rgba(0,200,255,0.1)', tension: 0.4 }] },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#fff' } } },
        scales: { x: { ticks: { color: '#fff' } }, y: { ticks: { color: '#fff' } } }
      }
    });
  } catch (err) {
    console.error(err);
  }
}
document.querySelector('.close').addEventListener('click', () => {
  document.getElementById('chartModal').style.display = 'none';
});

// ---- Auto trade toggle ----
document.getElementById('autoTradeToggle').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  await fetch(`${SERVER_URL}/api/autotrade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
});

// Initial fetch
fetch(`${SERVER_URL}/api/signals`)
  .then(r => r.json())
  .then(data => {
    signals = data.filter(s => !s.type);
    memeCoins = data.filter(s => s.type === 'meme_coin');
    renderSignals();
    renderMemeCoins();
  });
