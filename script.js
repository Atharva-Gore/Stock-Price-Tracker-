const apiKey = "d2co53pr01qihtcsnltgd2co53pr01qihtcsnlu0";
let chart;
let lastPrice = null;

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, 3000);
}

async function fetchPrice(asset) {
  let price = null;
  let name = asset.toUpperCase();

  if (/^[a-zA-Z]+$/.test(asset) && asset.length <= 5) {
    // Stock (Finnhub)
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${asset}&token=${apiKey}`);
    const data = await res.json();
    price = data.c; // Current price
  } else {
    // Crypto (CoinGecko)
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${asset}&vs_currencies=usd`);
    const data = await res.json();
    price = data[asset]?.usd;
  }

  return { name, price };
}

function updateChart(price) {
  const time = new Date().toLocaleTimeString();
  chart.data.labels.push(time);
  chart.data.datasets[0].data.push(price);

  if (chart.data.labels.length > 20) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }

  chart.update();
}

function playAlert() {
  document.getElementById("alertSound").play();
}

async function loadAsset() {
  const asset = document.getElementById("assetInput").value.trim().toLowerCase() || "bitcoin";
  const { name, price } = await fetchPrice(asset);

  if (!price) {
    alert("Asset not found!");
    return;
  }

  document.getElementById("assetName").textContent = name;
  document.getElementById("price").textContent = `Price: $${price}`;

  if (lastPrice && price !== lastPrice) {
    playAlert();
    showToast(`Price changed! New: $${price}`);
  }
  lastPrice = price;

  updateChart(price);
}

// Initialize chart
function initChart() {
  const ctx = document.getElementById("priceChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Price USD",
        data: [],
        borderColor: "#3b82f6",
        fill: false
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { display: true },
        y: { display: true }
      }
    }
  });
}

// Auto-load default asset
window.onload = () => {
  initChart();
  loadAsset();
  setInterval(loadAsset, 5000); // Update every 5s
};
