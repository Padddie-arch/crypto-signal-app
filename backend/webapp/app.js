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
document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// Scroll to top button visibility
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
      html += `${sym}: $${price.toFixed(2)}  |  `;
    }
    document.getElementById('tickerContent').textContent = html.slice(0, -3) || 'Waiting for prices...';
  } catch(e) {
    // Fallback to static text if server not ready
    document.getElementById('tickerContent').textContent = 'Prices loading... will update soon';
  }
}
setInterval(updateTicker, 60000);
updateTicker();

// Sound alert function
function playAlert() {
  document.getElementById('alertSound').play().catch(() => {});
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
  // Sound on 7/11+ signal
  const strong = normal.filter(s => (s.aligned||0) >= 7 && (s.totalStrategies||10) >= 11);
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

// Render signals (now with compact design and confluence note)
function renderSignals() {
  const list = document.getElementById('signalList');
  const sorted = signals.sort((a,b) => b.confidence - a.confidence);
  list.innerHTML = sorted.map(s => {
    const isBuy = s.direction === 'BUY';
    const color = isBuy ? '#00e676' : '#ff5252';
    // Confluence note: if both 1h and 4h exist, but we already filtered in backend, so just show direction
    return '<div class="signal-card" onclick="openChart(\''+s.symbol+'\')">'+
      '<div class="pair-row"><span style="color:'+color+'; font-weight:bold;">'+s.pair+' '+s.direction+'</span><span class="timeframe">'+s.timeframe+'</span></div>'+
      '<div>Price: $'+(s.price?.toFixed(2)||'0.00')+'</div>'+
      '<div class="confidence">Confidence: '+s.confidence+'% ('+ (s.aligned||0)+'/'+(s.totalStrategies||11)+')</div>'+
      (s.divergence ? '<div class="info">Divergence: '+s.divergence+'</div>' : '')+
      (s.pattern ? '<div class="info">Pattern: '+s.pattern+'</div>' : '')+
      '<div class="info">SL: $'+(s.stopLoss?.toFixed(2)||'0.00')+' | TP: $'+(s.takeProfit?.toFixed(2)||'0.00')+'</div>'+
    '</div>';
  }).join('');
}

// Load history (unchanged except show status if closed)
async function loadHistory() {
  try {
    const res = await fetch(SERVER_URL+'/api/history');
    const history = await res.json();
    const list = document.getElementById('historyList');
    if (!history.length) { list.innerHTML='<div class="info">No past signals.</div>'; return; }
    list.innerHTML = history.reverse().map(s => {
      if (s.type==='meme_coin') return '<div class="history-card"><div class="pair-row"><span>🐶 '+s.name+' ('+s.symbol+')</span><span class="date">'+new Date(s.timestamp).toLocaleString()+'</span></div><div>Price: $'+(s.price?.toFixed(6)||'0')+'</div></div>';
      const isBuy = s.direction==='BUY'; const color = isBuy?'#00e676':'#ff5252';
      return '<div class="history-card"><div class="pair-row"><span style="color:'+color+'; font-weight:bold;">'+s.pair+' '+s.direction+'</span><span class="timeframe">'+s.timeframe+'</span></div>'+
        '<div>Price: $'+(s.price?.toFixed(2)||'0')+' | Confidence: '+s.confidence+'%</div>'+
        (s.outcome ? '<div class="info">Outcome: '+(s.outcome==='win'?'✅ Win':'❌ Loss')+'</div>' : '')+
        '<div class="date">'+new Date(s.timestamp).toLocaleString()+'</div></div>';
    }).join('');
  } catch(e){}
}

// Load stats
async function loadStats() {
  try {
    const res = await fetch(SERVER_URL+'/api/stats');
    const stats = await res.json();
    document.getElementById('statsContent').innerHTML = '<p>Total closed trades: '+stats.total+'</p><p>Wins: '+stats.wins+'</p><p>Win rate: '+stats.winRate+'%</p>';
  } catch(e) {}
}

// Meme coins
function renderMemeCoins() {
  document.getElementById('memeList').innerHTML = memeCoins.map(c =>
    '<div class="meme-item">'+c.name+' ('+c.symbol+') - $'+c.price.toFixed(6)+' | Prob: '+c.probability+'%</div>').join('');
}

// Chart (unchanged)
async function openChart(symbol) {
  document.getElementById('chartModal').style.display='block';
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol='+symbol+'&interval=1h&limit=20');
    const data = await res.json();
    const closes = data.map(c=>parseFloat(c[4]));
    const labels = data.map((_,i)=>i.toString());
    const ctx = document.getElementById('priceChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type:'line', data:{labels, datasets:[{label:symbol,data:closes,borderColor:'#00c8ff',backgroundColor:'rgba(0,200,255,0.1)',tension:0.4}]},
      options:{responsive:true, plugins:{legend:{labels:{color:'#fff'}}}, scales:{x:{ticks:{color:'#fff'}}, y:{ticks:{color:'#fff'}}}}
    });
  } catch(e){}
}
document.querySelector('.close').addEventListener('click',()=>{document.getElementById('chartModal').style.display='none';});

// Auto trade toggle
document.getElementById('autoTradeToggle').addEventListener('change', async (e)=>{
  await fetch(SERVER_URL+'/api/autotrade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:e.target.checked})});
});

// Initial fetch
fetch(SERVER_URL+'/api/signals').then(r=>r.json()).then(data=>{
  signals = data.filter(s=>!s.type);
  memeCoins = data.filter(s=>s.type==='meme_coin');
  renderSignals();
  renderMemeCoins();
});
