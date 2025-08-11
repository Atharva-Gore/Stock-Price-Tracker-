// === CONFIG ===
// FINNHUB API KEY (you provided)
const FINNHUB_API_KEY = "d2co53pr01qihtcsnltgd2co53pr01qihtcsnlu0";

// === DOM ===
const $ = id => document.getElementById(id);
const watchlistEl = $('watchlist');
const addAssetBtn = $('addAssetBtn');
const assetInput = $('assetInput');
const assetType = $('assetType');
const refreshIntervalSel = $('refreshInterval');
const timeRangeSel = $('timeRange');

const priceChartCtx = document.getElementById('priceChart').getContext('2d');
const chartTitle = $('chartTitle');
const assetDetails = $('assetDetails');
const assetNameEl = $('assetName');
const assetPriceEl = $('assetPrice');
const assetChangeEl = $('assetChange');
const lastUpdatedEl = $('lastUpdated');

const alertPctInput = $('alertPct');
const alertDirection = $('alertDirection');
const setAlertBtn = $('setAlertBtn');
const alertsList = $('alertsList');

const themeToggle = $('themeToggle');
const toastContainer = document.getElementById('toastContainer');

// === STATE ===
let watchlist = JSON.parse(localStorage.getItem('watchlist_v4') || '[]'); // {type:'stock'|'crypto', id:'AAPL'|'bitcoin', display}
let alerts = JSON.parse(localStorage.getItem('alerts_v4') || '[]'); // {watchId,pct,dir}
let lastPrices = {}; // map watchId -> lastPrice
let chart = null;
let currentAsset = null;
let pollTimer = null;

// theme
if(localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
themeToggle.onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};

// tiny beep
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.stop(ctx.currentTime + 0.26);
  } catch (_) {}
}

// toast
function showToast(msg, timeout=4000){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=>el.remove(),400); }, timeout);
}

// persist
function saveState(){
  localStorage.setItem('watchlist_v4', JSON.stringify(watchlist));
  localStorage.setItem('alerts_v4', JSON.stringify(alerts));
}

// notifications
async function notify(title, body){
  showToast(`${title} — ${body}`, 6000);
  beep();
  if("Notification" in window){
    if(Notification.permission === 'granted') new Notification(title, { body });
    else if(Notification.permission !== 'denied'){
      const p = await Notification.requestPermission();
      if(p === 'granted') new Notification(title, { body });
    }
  }
}

// UI: render watchlist
function renderWatchlist(){
  watchlistEl.innerHTML = '';
  if(!watchlist.length){
    watchlistEl.innerHTML = '<li style="color:#6b7280">No assets — add a stock symbol (AAPL) or crypto id (bitcoin)</li>';
    return;
  }
  watchlist.forEach((w, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <div style="font-weight:600">${w.display}</div>
        <div class="meta">${w.type === 'crypto' ? 'crypto (CoinGecko)' : 'stock (Finnhub)'}</div>
      </div>
      <div>
        <button class="view" data-idx="${idx}">View</button>
        <button class="remove" data-idx="${idx}">Remove</button>
      </div>`;
    watchlistEl.appendChild(li);
  });
  // attach
  watchlistEl.querySelectorAll('.view').forEach(b=> b.onclick = ()=> viewAsset(watchlist[parseInt(b.dataset.idx)]) );
  watchlistEl.querySelectorAll('.remove').forEach(b=> b.onclick = ()=>{
    const idx = parseInt(b.dataset.idx);
    const removed = watchlist.splice(idx,1);
    saveState(); renderWatchlist();
    if(currentAsset && `${currentAsset.type}:${currentAsset.id}` === `${removed[0].type}:${removed[0].id}`){
      currentAsset = null; clearChart(); chartTitle.textContent='Select asset to view chart';
    }
  });
}

// add asset
addAssetBtn.onclick = () => {
  const raw = assetInput.value.trim();
  if(!raw) return alert('Enter asset id or symbol');
  const type = assetType.value;
  if(type === 'crypto'){
    const id = raw.toLowerCase();
    if(watchlist.find(w=> w.type==='crypto' && w.id===id)) return alert('Already added');
    watchlist.push({type:'crypto', id, display: raw});
  } else {
    const sym = raw.toUpperCase();
    if(watchlist.find(w=> w.type==='stock' && w.id===sym)) return alert('Already added');
    watchlist.push({type:'stock', id: sym, display: sym});
  }
  assetInput.value='';
  saveState(); renderWatchlist(); fetchAndUpdateAll();
};

// alerts UI
setAlertBtn.onclick = () => {
  if(!currentAsset) return alert('Select an asset first (click View).');
  const pct = parseFloat(alertPctInput.value);
  if(isNaN(pct) || pct<=0) return alert('Enter valid percent');
  const watchId = `${currentAsset.type}:${currentAsset.id}`;
  alerts.push({watchId, pct, dir: alertDirection.value});
  saveState(); renderAlerts();
};

function renderAlerts(){
  alertsList.innerHTML = '';
  if(!alerts.length){ alertsList.innerHTML = '<li style="color:#6b7280">No alerts set</li>'; return; }
  alerts.forEach((a,i)=>{
    const li = document.createElement('li');
    li.innerHTML = `<div>${a.watchId} ${a.dir} ${a.pct}%</div><div><button data-i="${i}" class="rm">Remove</button></div>`;
    alertsList.appendChild(li);
  });
  alertsList.querySelectorAll('.rm').forEach(b=> b.onclick = ()=> { alerts.splice(parseInt(b.dataset.i),1); saveState(); renderAlerts(); });
}

// === Fetch helpers ===
// CoinGecko market chart (historical)
async function fetchCoinMarketData(id, days=7){
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('CoinGecko error');
  return res.json();
}
async function fetchCoinPrice(id){
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('CoinGecko price fail');
  return res.json();
}

// Finnhub stock candles & quote
async function fetchStockCandles(symbol, days=7){
  const now = Math.floor(Date.now()/1000);
  const from = now - days*24*3600;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=60&from=${from}&to=${now}&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Finnhub candles fail');
  return res.json();
}
async function fetchStockQuote(symbol){
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Finnhub quote fail');
  return res.json();
}

// === Chart helpers ===
function clearChart(){
  if(chart) { chart.destroy(); chart = null; }
}
function showChart(title, labels, dataPoints, labelText='USD'){
  chartTitle.textContent = title;
  if(chart) chart.destroy();
  chart = new Chart(priceChartCtx, {
    type:'line',
    data: {
      labels,
      datasets: [{ label: labelText, data: dataPoints, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#2563eb', backgroundColor:'rgba(37,99,235,0.08)', pointRadius:0, tension:0.15 }]
    },
    options: { responsive:true, maintainAspectRatio:false, scales:{ x:{display:true}, y:{beginAtZero:false} }, plugins:{ legend:{display:false} } }
  });
}

// === View asset (load historical then enable realtime append) ===
async function viewAsset(asset){
  currentAsset = asset;
  assetDetails.hidden = true;
  clearChart();
  chartTitle.textContent = 'Loading chart...';
  try {
    if(asset.type === 'crypto'){
      const days = parseInt(timeRangeSel.value);
      const market = await fetchCoinMarketData(asset.id, days);
      const labels = market.prices.map(p=> new Date(p[0]).toLocaleString());
      const points = market.prices.map(p=> p[1]);
      showChart(`${asset.display} (${days}d)`, labels, points, 'USD');
      const priceData = await fetchCoinPrice(asset.id);
      const price = priceData[asset.id]?.usd ?? null;
      const change24 = priceData[asset.id]?.usd_24h_change ?? null;
      updateDetails(asset.display, price, change24);
      lastPrices[`${asset.type}:${asset.id}`] = price;
    } else {
      // stock
      const days = parseInt(timeRangeSel.value);
      const candles = await fetchStockCandles(asset.id, days);
      if(candles.s !== 'ok') throw new Error('Candles unavailable');
      const labels = candles.t.map(t=> new Date(t*1000).toLocaleString());
      const points = candles.c;
      showChart(`${asset.display} (${days}d)`, labels, points, 'USD');
      const quote = await fetchStockQuote(asset.id);
      const price = quote.c;
      const change = quote.dp ?? null;
      updateDetails(asset.display, price, change);
      lastPrices[`${asset.type}:${asset.id}`] = price;
    }
    assetDetails.hidden = false;
    lastUpdatedEl.textContent = new Date().toLocaleString();
  } catch(err){
    console.error(err);
    chartTitle.textContent = 'Error loading chart';
    alert('Error fetching asset data: ' + err.message);
  }
}

function updateDetails(name, price, changePct){
  assetNameEl.textContent = name;
  assetPriceEl.textContent = price !== null && price !== undefined ? `Price: $${(+price).toFixed(6)}` : 'Price: N/A';
  assetChangeEl.textContent = changePct ? `Change: ${(+changePct).toFixed(2)}%` : 'Change: N/A';
}

// fetch latest single (for polling)
async function fetchLatestFor(asset){
  try {
    if(asset.type === 'crypto'){
      const p = await fetchCoinPrice(asset.id);
      const price = p[asset.id]?.usd ?? null;
      lastPrices[`${asset.type}:${asset.id}`] = price;
      return price;
    } else {
      const q = await fetchStockQuote(asset.id);
      const price = q.c;
      lastPrices[`${asset.type}:${asset.id}`] = price;
      return price;
    }
  } catch(e){
    console.warn('latest fetch failed', e);
    return null;
  }
}

// fetch+update all (polling)
async function fetchAndUpdateAll(){
  if(!watchlist.length) return;
  for(const w of watchlist){
    await fetchLatestFor(w);
  }
  evaluateAlerts();
  renderWatchlist();
  // append to chart for current asset
  if(currentAsset && chart){
    const key = `${currentAsset.type}:${currentAsset.id}`;
    const latest = lastPrices[key];
    if(latest != null){
      const nowLabel = new Date().toLocaleTimeString();
      chart.data.labels.push(nowLabel);
      chart.data.datasets[0].data.push(latest);
      if(chart.data.labels.length > 400){
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
      }
      chart.update('none');
      lastUpdatedEl.textContent = new Date().toLocaleString();
    }
  }
}

// alerts evaluation
function evaluateAlerts(){
  alerts.forEach(a=>{
    const baselineKey = `baseline:${a.watchId}`;
    const last = lastPrices[a.watchId];
    if(!last) return;
    let base = parseFloat(localStorage.getItem(baselineKey) || '0');
    if(!base){ localStorage.setItem(baselineKey, last); base = last; }
    const change = ((last - base)/base) * 100;
    if(a.dir === 'above' && change >= a.pct){
      notify(`${a.watchId} up`, `${change.toFixed(2)}% (>= ${a.pct}%)`);
      localStorage.setItem(baselineKey, last);
    } else if(a.dir === 'below' && change <= -Math.abs(a.pct)){
      notify(`${a.watchId} down`, `${change.toFixed(2)}% (<= -${a.pct}%)`);
      localStorage.setItem(baselineKey, last);
    }
  });
}

// Notify wrapper
async function notify(title, body){
  await notifyBrowserAndToast(title, body);
}

async function notifyBrowserAndToast(title, body){
  showToast(`${title} — ${body}`, 6000);
  beep();
  if("Notification" in window){
    if(Notification.permission === 'granted') new Notification(title, { body });
    else if(Notification.permission !== 'denied'){
      const p = await Notification.requestPermission();
      if(p === 'granted') new Notification(title, { body });
    }
  }
}

// start polling
let pollIntervalId = null;
function startPolling(){
  if(pollIntervalId) clearInterval(pollIntervalId);
  const sec = Math.max(5, parseInt(refreshIntervalSel.value));
  pollIntervalId = setInterval(fetchAndUpdateAll, sec*1000);
}

// init
function init(){
  // default watchlist if empty
  if(!watchlist.length){
    watchlist.push({type:'crypto', id:'bitcoin', display:'bitcoin'});
    watchlist.push({type:'stock', id:'AAPL', display:'AAPL'});
    saveState();
  }
  renderWatchlist();
  renderAlerts();
  // auto-load default: choose first stock if exists else first asset
  const firstStock = watchlist.find(w=>w.type==='stock') || watchlist[0];
  viewAsset(firstStock);
  // initial fetch & start polling
  fetchAndUpdateAll();
  startPolling();
}

// wire UI events
refreshIntervalSel.onchange = startPolling;
timeRangeSel.onchange = ()=> { if(currentAsset) viewAsset(currentAsset); };

document.addEventListener('DOMContentLoaded', init);
