/* Price Tracker Dashboard
   - Crypto: CoinGecko (no key)
   - Stocks (optional): Finnhub (user provides key)
   - Chart.js for charts
   - Watchlist + Alerts stored in localStorage
*/

const $ = id => document.getElementById(id);

// DOM
const watchlistEl = $('watchlist');
const addAssetBtn = $('addAssetBtn');
const assetInput = $('assetInput');
const assetType = $('assetType');
const finnhubKeyInput = $('finnhubKey');
const refreshIntervalSel = $('refreshInterval');
const timeRangeSel = $('timeRange');

const priceChartCtx = document.getElementById('priceChart').getContext('2d');
const chartTitle = $('chartTitle');
const assetDetails = $('assetDetails');
const assetNameEl = $('assetName');
const assetPriceEl = $('assetPrice');
const assetChangeEl = $('assetChange');
const assetExtraEl = $('assetExtra');
const lastUpdatedEl = $('lastUpdated');

const alertPctInput = $('alertPct');
const alertDirection = $('alertDirection');
const setAlertBtn = $('setAlertBtn');
const alertsList = $('alertsList');

const themeToggle = $('themeToggle');

// State
let watchlist = JSON.parse(localStorage.getItem('watchlist_v1')||'[]'); // array of {type, idOrSymbol, display}
let alerts = JSON.parse(localStorage.getItem('alerts_v1')||'[]'); // array of {watchId, pct, dir}
let chart = null;
let autoTimer = null;
let currentTicker = null; // {type, idOrSymbol, display}
let lastPrices = {}; // map watchId -> lastPrice

// util: save
function saveState(){
  localStorage.setItem('watchlist_v1', JSON.stringify(watchlist));
  localStorage.setItem('alerts_v1', JSON.stringify(alerts));
}

// Theme
if(localStorage.getItem('theme')==='dark') document.body.classList.add('dark');
themeToggle.onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark')?'dark':'light');
};

// Helpers: notifications
async function notify(title, body){
  if("Notification" in window){
    if(Notification.permission === "granted"){
      new Notification(title, {body});
    } else if(Notification.permission !== "denied"){
      const p = await Notification.requestPermission();
      if(p === 'granted') new Notification(title, {body});
    }
  }
}

// Render watchlist
function renderWatchlist(){
  watchlistEl.innerHTML = '';
  if(!watchlist.length){
    watchlistEl.innerHTML = '<li style="color:#6b7280">No assets — add crypto id (eg. bitcoin) or stock symbol (AAPL)</li>';
    return;
  }
  watchlist.forEach((w, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<div>
      <div style="font-weight:600">${w.display}</div>
      <div class="meta">${w.type==='crypto' ? 'crypto (CoinGecko)': 'stock (Finnhub)'}</div>
    </div>
    <div>
      <button data-idx="${idx}" class="view">View</button>
      <button data-idx="${idx}" class="remove">Remove</button>
    </div>`;
    watchlistEl.appendChild(li);
  });
  // attach listeners
  watchlistEl.querySelectorAll('.view').forEach(btn=>{
    btn.onclick = () => {
      const idx = btn.dataset.idx;
      viewAsset(watchlist[idx]);
    };
  });
  watchlistEl.querySelectorAll('.remove').forEach(btn=>{
    btn.onclick = () => {
      const idx = btn.dataset.idx;
      watchlist.splice(idx,1); saveState(); renderWatchlist();
      if(currentTicker && currentTicker.idOrSymbol === watchlist[idx]) { /* noop */ }
    };
  });
}

// Add asset
addAssetBtn.onclick = async () => {
  const val = assetInput.value.trim();
  if(!val) return alert('Enter asset id or symbol');
  const type = assetType.value;
  if(type==='crypto'){
    // coin id expected (CoinGecko). Use as-is
    const display = val;
    const item = { type:'crypto', idOrSymbol: val.toLowerCase(), display };
    watchlist.push(item); saveState(); renderWatchlist();
    assetInput.value='';
    fetchAndUpdateAll();
  } else {
    // stock: symbol (AAPL). We store uppercase
    const display = val.toUpperCase();
    const item = { type:'stock', idOrSymbol: display, display };
    watchlist.push(item); saveState(); renderWatchlist();
    assetInput.value='';
    fetchAndUpdateAll();
  }
};

// Alerts
setAlertBtn.onclick = () => {
  if(!currentTicker) return alert('Select an asset first (click View).');
  const pct = parseFloat(alertPctInput.value);
  if(isNaN(pct) || pct<=0) return alert('Enter a valid % value');
  alerts.push({ watchId: `${currentTicker.type}:${currentTicker.idOrSymbol}`, pct, dir: alertDirection.value });
  saveState(); renderAlerts();
};

function renderAlerts(){
  alertsList.innerHTML = '';
  if(!alerts.length) { alertsList.innerHTML = '<li style="color:#6b7280">No alerts set</li>'; return; }
  alerts.forEach((a, i)=>{
    const li = document.createElement('li');
    li.innerHTML = `<div>${a.watchId} ${a.dir} ${a.pct}%</div><div><button data-i="${i}" class="rm">Remove</button></div>`;
    alertsList.appendChild(li);
  });
  alertsList.querySelectorAll('.rm').forEach(b=>{
    b.onclick = ()=> { alerts.splice(parseInt(b.dataset.i),1); saveState(); renderAlerts(); };
  });
}

// Fetch utilities
async function fetchCoinMarketData(coinId, days=7){
  // CoinGecko market chart
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('CoinGecko error');
  return res.json();
}
async function fetchCoinPrice(coinId){
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url); if(!res.ok) throw new Error('CoinGecko price fail'); return res.json();
}
async function fetchStockCandles(symbol, days=7, finnhubKey=''){
  // Finnhub free: use /stock/candle (requires key)
  if(!finnhubKey) throw new Error('Finnhub key required for stocks');
  const now = Math.floor(Date.now()/1000);
  const from = now - days*24*3600;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=60&from=${from}&to=${now}&token=${encodeURIComponent(finnhubKey)}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Finnhub fetch fail');
  return res.json();
}
async function fetchStockQuote(symbol, finnhubKey=''){
  if(!finnhubKey) throw new Error('Finnhub key required for stocks');
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(finnhubKey)}`;
  const res = await fetch(url); if(!res.ok) throw new Error('Finnhub quote fail'); return res.json();
}

// Populate chart
function showChart(title, labels, dataPoints, label='$ USD'){
  chartTitle.textContent = title;
  if(chart) chart.destroy();
  chart = new Chart(priceChartCtx, {
    type:'line',
    data: {
