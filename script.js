const apiKey = "d2co53pr01qihtcsnltgd2co53pr01qihtcsnlu0";
const symbolInput = document.getElementById("symbolInput");
const trackBtn = document.getElementById("trackBtn");
const assetName = document.getElementById("assetName");
const currentPrice = document.getElementById("currentPrice");
const priceChange = document.getElementById("priceChange");
const alertSound = document.getElementById("alertSound");
const toast = document.getElementById("toast");

let chart;
let chartData = [];
let labels = [];
let lastPrice = null;

function showToast(message, color = "#22c55e") {
  toast.innerText = message;
  toast.style.background = color;
  toast.style.display = "block";
  setTimeout(() => toast.style.display = "none", 3000);
}

function createChart() {
  const ctx = document.getElementById("priceChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Price",
        data: chartData,
        borderColor: "#3b82f6",
        fill: false
      }]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { display: true },
        y: { display: true }
      }
    }
  });
}

async function fetchPrice(symbol) {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.c) throw new Error("Invalid symbol");

    assetName.textContent = symbol;
    currentPrice.textContent = `Price: $${data.c}`;
    priceChange.textContent = `Change: ${data.d} (${data.dp}%)`;

    const now = new Date().toLocaleTimeString();
    labels.push(now);
    chartData.push(data.c);
    if (labels.length > 20) {
      labels.shift();
      chartData.shift();
    }
    chart.update();

    if (lastPrice !== null && data.c > lastPrice * 1.02) {
      alertSound.play();
      showToast(`🚀 ${symbol} jumped above 2%!`);
    }
    lastPrice = data.c;
  } catch (err) {
    showToast(err.message, "#ef4444");
  }
}

function startTracking(symbol) {
  labels = [];
  chartData = [];
  lastPrice = null;
  if (chart) chart.destroy();
  createChart();
  fetchPrice(symbol);
  setInterval(() => fetchPrice(symbol), 5000);
}

trackBtn.addEventListener("click", () => {
  const symbol = symbolInput.value.trim().toUpperCase();
  if (symbol) startTracking(symbol);
});

// Auto-load default asset
startTracking("AAPL");
