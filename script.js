/* Upgraded Price Tracker:
   - multi-asset watchlist persisted in localStorage
   - real-time chart updates by polling the APIs at chosen interval
   - CoinGecko for crypto (no key), Finnhub optional (requires key)
   - alerts stored, baseline logic, and browser notifications
*/

const $ = id => document.getElementById(id);

// DOM refs
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
const lastUpdatedEl = $('lastUpdated');

const alertPctInput = $('alertPct');
const alertDirection = $('alertDirection');
const setAlertBtn = $('setAlertBtn');
const alertsList = $('alertsList');

const themeToggle = $('themeToggle');

// state
let watchlist = JSON.parse(localStorage.getItem('watchlist_v2') || '[]'); // {type, id, display}
let alerts = JSON.parse(localStorage.getItem('alerts_v2') || '[]'); // {watchId, pct, dir}
let lastPrices = {}; // watchId -> lastPrice
let chart = null;
let currentAsset = null;
let pollTimer = null;

// theme
if(localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
themeToggle.onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};

// utility
function saveState() {
  localStorage.setItem('watchlist_v2', JSON.stringify(watchlist));
  localStorage.setItem('alerts_v2', JSON.stringify(alerts));
}

// notification helper
async function notify(title, message) {
  if(!("Notification" in window)) return;
  if(Notification.permission === "granted") new Notification(title, { body: message });
  else if(Notification.permission !== "denied") {
    const p = await Notification.requestPermission();
    if(p === "granted") new Notification(title, { body: message });
  }
}

// render watchlist
function renderWatchlist() {
  watchlistEl.innerHTML = '';
  if(!watchlist.length) {
    watchlistEl.innerHTML = '<li style="color:#6b7280">No assets — add crypto id (eg. bitcoin) or stock symbol (AAPL)</li>';
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
      </div>
    `;
    watchlistEl.appendChild(li);
  });

  watchlistEl.querySelectorAll('.view').forEach(b => {
    b.onclick = () => {
      const idx = parseInt(b.dataset.idx);
      viewAsset(watchlist[idx]);
    };
  });
  watchlistEl.querySelectorAll('.remove').forEach(b => {
    b.onclick = () => {
      const idx = parseInt(b.dataset.idx);
      const removed = watchlist.splice(idx,1);
      saveState(); renderWatchlist();
      // if the removed asset was current, clear chart
      if(currentAsset && `${currentAsset.type}:${currentAsset.id}` === `${removed[0].type}:${removed[0].id}`) {
        currentAsset = null; clearChart();
        chartTitle.textContent = "Select asset to view chart";
      }
    };
  });
}

// add asset
addAssetBtn.onclick = () => {
  const raw = assetInput.value.trim();
  if(!raw) return alert('Enter asset id or symbol');
  const type = assetType.value;
  if(type === 'crypto') {
    const id = raw.toLowerCase();
    const display = raw;
    // avoid duplicates
    if(watchlist.find(w => w.type==='crypto' && w.id === id)) return alert('Already in watchlist');
    watchlist.push({ type:'crypto', id, display });
  } else {
    const symbol = raw.toUpperCase();
    if(watchlist.find(w => w.type==='stock' && w.id === symbol)) return alert('Already in watchlist');
    watchlist.push({ type:'stock', id: symbol, display: symbol });
  }
  assetInput.value = '';
  saveState(); renderWatchlist(); fetchAndUpdateAll();
};

// alerts
setAlertBtn.onclick = () => {
  if(!currentAsset) return alert('Select an asset (View) first');
  const pct = parseFloat(alertPctInput.value);
  if(isNaN(pct) || pct <= 0) return alert('Enter valid percent');
  const watchId = `${currentAsset.type}:${currentAsset.id}`;
  alerts.push({ watchId, pct, dir: alertDirection.value });
  saveState(); renderAlerts();
};

function renderAlerts() {
  alertsList.innerHTML = '';
  if(!alerts.length) { alertsList.innerHTML = '<li style="color:#6b7280">No alerts set</li>'; return; }
  alerts.forEach((a,i) => {
    const li = document.createElement('li');
    li.innerHTML = `<div>${a.watchId} ${a.dir} ${a.pct}%</div><div><button data-i="${i}" class="rm">Remove</button></div>`;
    alertsList.appendChild(li);
  });
  alertsList.querySelectorAll('.rm').forEach(b => {
    b.onclick = () => { alerts.splice(parseInt(b.dataset.i),1); saveState(); renderAlerts(); };
  });
}

// fetch helpers
async function fetchCoinMarketData(id, days=7) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('CoinGecko failed');
  return res.json();
}
async function fetchCoinPrice(id) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('CoinGecko price fail');
  return res.json();
}
async function fetchStockCandles(symbol, days=7, key='') {
  if(!key) throw new Error('Finnhub key required for stocks');
  const now = Math.floor(Date.now()/1000);
  const from = now - days*24*3600;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=60&from=${from}&to=${now}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Finnhub fail');
  return res.json();
}
async function fetchStockQuote(symbol, key='') {
  if(!key) throw new Error('Finnhub key required for stocks');
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Finnhub quote fail');
  return res.json();
}

// chart helpers
function clearChart() {
  if(chart) { chart.destroy(); chart = null; }
  chartTitle.textContent = 'Select asset to view chart';
}
function showChart(title, labels, data, labelText='USD') {
  chartTitle.textContent = title;
  if(chart) chart.destroy();
  chart = new Chart(priceChartCtx, {
    type: 'line',
    data: { labels, datasets: [{ label: labelText, data, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', pointRadius:0, tension:0.15 }] },
    options: { responsive:true, maintainAspectRatio:false, scales:{ x:{display:true}, y:{beginAtZero:false} }, plugins:{ legend:{display:false} } }
  });
}

// view asset (load historical then enable realtime append)
async function viewAsset(asset) {
  currentAsset = asset;
  assetDetails.hidden = true;
  clearChart();
  chartTitle.textContent = 'Loading chart...';
  try {
    if(asset.type === 'crypto') {
      const days = parseInt(timeRangeSel.value);
      const market = await fetchCoinMarketData(asset.id, days);
      const labels = market.prices.map(p => new Date(p[0]).toLocaleString());
      const points = market.prices.map(p => p[1]);
      showChart(`${asset.display} (${days}d)`, labels, points, 'USD');
      // set last price
      const priceData = await fetchCoinPrice(asset.id);
      const price = priceData[asset.id]?.usd ?? null;
      const change24 = priceData[asset.id]?.usd_24h_change ?? null;
      updateDetails(asset.display, price, change24);
      lastPrices[`${asset.type}:${asset.id}`] = price;
    } else {
      const key = finnhubKeyInput.value.trim();
      if(!key) { alert('Provide Finnhub API key for stocks'); chartTitle.textContent='Provide Finnhub key'; return; }
      const days = parseInt(timeRangeSel.value);
      const candles = await fetchStockCandles(asset.id, days, key);
      if(candles.s !== 'ok') throw new Error('Candles unavailable');
      const labels = candles.t.map(t => new Date(t*1000).toLocaleString());
      const points = candles.c;
      showChart(`${asset.display} (${days}d)`, labels, points, 'USD');
      const q = await fetchStockQuote(asset.id, key);
      const price = q.c;
      const change24 = q.dp ?? null;
      updateDetails(asset.display, price, change24);
      lastPrices[`${asset.type}:${asset.id}`] = price;
    }
    assetDetails.hidden = false;
    lastUpdatedEl.textContent = new Date().toLocaleString();
  } catch(err) {
    console.error(err);
    chartTitle.textContent = 'Error loading chart';
    alert('Error: ' + err.message);
  }
}

// update details panel
function updateDetails(name, price, changePct) {
  assetNameEl.textContent = name;
  if(price !== null && price !== undefined) {
    assetPriceEl.textContent = `Price: $${(+price).toFixed(6)}`;
  } else assetPriceEl.textContent = 'Price: N/A';
  assetChangeEl.textContent = changePct ? `Change: ${(+changePct).toFixed(2)}%` : 'Change: N/A';
}

// fetch latest single (used to append to chart)
async function fetchLatestFor(asset) {
  try {
    if(asset.type === 'crypto') {
      const p = await fetchCoinPrice(asset.id);
      const price = p[asset.id]?.usd ?? null;
      lastPrices[`${asset.type}:${asset.id}`] = price;
      return price;
    } else {
      const key = finnhubKeyInput.value.trim();
      if(!key) return null;
      const q = await fetchStockQuote(asset.id, key);
      lastPrices[`${asset.type}:${asset.id}`] = q.c;
      return q.c;
    }
  } catch(e) {
    console.warn('latest fetch failed', e);
    return null;
  }
}

// fetch+update all (for watchlist/background polling)
async function fetchAndUpdateAll() {
  if(!watchlist.length) return;
  for(const w of watchlist) {
    const price = await fetchLatestFor(w);
    // check alerts
  }
  evaluateAlerts();
  renderWatchlist();
  // if a chart is shown for current asset, append the latest
  if(currentAsset && chart) {
    const key = `${currentAsset.type}:${currentAsset.id}`;
    const latest = lastPrices[key];
    if(latest != null) {
      // append point
      const nowLabel = new Date().toLocaleTimeString();
      chart.data.labels.push(nowLabel);
      chart.data.datasets[0].data.push(latest);
      // keep chart length reasonable (slice to last 500)
      if(chart.data.labels.length > 500) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
      }
      chart.update('none');
      lastUpdatedEl.textContent = new Date().toLocaleString();
    }
  }
}

// alerts evaluation
function evaluateAlerts() {
  alerts.forEach(a => {
    const baselineKey = `baseline:${a.watchId}`;
    const last = lastPrices[a.watchId];
    if(!last) return;
    let base = parseFloat(localStorage.getItem(baselineKey) || '0');
    if(!base) { localStorage.setItem(baselineKey, last); base = last; }
    const change = ((last - base) / base) * 100;
    if(a.dir === 'above' && change >= a.pct) {
      notify('Price Alert', `${a.watchId} is ${change.toFixed(2)}% above baseline.`);
      localStorage.setItem(baselineKey, last);
    } else if(a.dir === 'below' && change <= -Math.abs(a.pct)) {
      notify('Price Alert', `${a.watchId} is ${change.toFixed(2)}% below baseline.`);
      localStorage.setItem(baselineKey, last);
    }
  });
}

// start/stop polling based on UI
function startPolling() {
  if(pollTimer) clearInterval(pollTimer);
  const sec = Math.max(5, parseInt(refreshIntervalSel.value));
  pollTimer = setInterval(fetchAndUpdateAll, sec*1000);
}

// init on load
function init() {
  renderWatchlist();
  renderAlerts();
  // quick populate if empty (nice demo)
  if(!watchlist.length) {
    // add bitcoin as default
    watchlist.push({
