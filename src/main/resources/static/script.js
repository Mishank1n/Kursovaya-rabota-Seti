const gatewayEl = document.getElementById("gateway");
const currentIpEl = document.getElementById("currentIp");
const subnetEl = document.getElementById("subnet");
const countEl = document.getElementById("count");
const updatedEl = document.getElementById("updated");
const tbody = document.getElementById("tbody");
const scanBtn = document.getElementById("scanBtn");

const pingModal = document.getElementById("pingModal");
const closePingModalBtn = document.getElementById("closePingModal");
const pingTitleEl = document.getElementById("pingTitle");
const pingSubtitleEl = document.getElementById("pingSubtitle");
const pingIpEl = document.getElementById("pingIp");
const pingMacEl = document.getElementById("pingMac");
const pingHostEl = document.getElementById("pingHost");
const pingAvgEl = document.getElementById("pingAvg");
const pingLastEl = document.getElementById("pingLast");
const pingSamplesEl = document.getElementById("pingSamples");
const chartCanvas = document.getElementById("pingChart");
const chartTooltip = document.getElementById("chartTooltip");

const rowCache = new Map();
const deviceCache = new Map();

let selectedIp = null;
let pingHistory = [];
let chartState = {
  points: [],
  average: null,
  min: null,
  max: null,
  padding: null
};

function fmt(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return value;
}

function formatTimeLabel(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatMac(value) {
  if (!value) return "—";
  return String(value).toLowerCase();
}

function createCell(text, className) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = fmt(text);
  return td;
}

function createIpCell(ip) {
  const td = document.createElement("td");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ip-link";
  button.textContent = fmt(ip);
  button.addEventListener("click", () => openPingModal(ip));
  td.appendChild(button);
  return td;
}

function updateRow(tr, device) {
  tr.innerHTML = "";

  const isOnline = device.status === "ONLINE";
  const statusClass = isOnline ? "status-pill status-online" : "status-pill status-offline";

  tr.appendChild(createIpCell(device.ipAddress));
  tr.appendChild(createCell(formatMac(device.macAddress), "mono"));
  tr.appendChild(createCell(device.deviceType));
  tr.appendChild(createCell(device.status, statusClass));
  tr.appendChild(createCell(device.hostName));
  tr.appendChild(createCell(isOnline && device.avgPingMs !== null && device.avgPingMs !== undefined ? `${Number(device.avgPingMs).toFixed(1)} ms` : "—"));
  tr.appendChild(createCell(device.packetLossPercent !== null && device.packetLossPercent !== undefined ? `${Number(device.packetLossPercent).toFixed(1)}%` : "—"));
}

function syncModalHeader() {
  const device = deviceCache.get(selectedIp);
  const latestSample = pingHistory.length ? pingHistory[pingHistory.length - 1] : null;
  const avg = calculateAverage(pingHistory);

  pingTitleEl.textContent = selectedIp ? `Пинг: ${selectedIp}` : "График пинга";
  pingIpEl.textContent = selectedIp || "—";
  pingMacEl.textContent = formatMac(device?.macAddress);
  pingHostEl.textContent = device?.hostName || "—";
  pingAvgEl.textContent = avg === null ? "—" : `${avg.toFixed(1)} ms`;
  pingLastEl.textContent = latestSample && latestSample.ping !== null ? `${latestSample.ping.toFixed(1)} ms` : "—";
  pingSamplesEl.textContent = String(pingHistory.length);
  pingSubtitleEl.textContent = device?.status === "OFFLINE"
    ? "Устройство сейчас не отвечает, но история пинга сохраняется."
    : "История строится по каждому обновлению таблицы пинга.";
}

function calculateAverage(samples) {
  const values = samples
    .map(item => item.ping)
    .filter(value => typeof value === "number" && Number.isFinite(value));

  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pushSample(status) {
  if (!selectedIp || !status || status.ip !== selectedIp) {
    return;
  }

  const pingValue = status.status === "ONLINE" && status.avgPingMs !== null && status.avgPingMs !== undefined
    ? Number(status.avgPingMs)
    : null;

  pingHistory.push({
    at: new Date(),
    ping: Number.isFinite(pingValue) ? pingValue : null
  });

  if (pingHistory.length > 120) {
    pingHistory = pingHistory.slice(-120);
  }

  syncModalHeader();
  drawPingChart();
}

function resizeCanvasToCssSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  if (rect.width === 0 || rect.height === 0) {
    return null;
  }

  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { ctx, width: rect.width, height: rect.height };
}

function drawPingChart() {
  const setup = resizeCanvasToCssSize(chartCanvas);
  if (!setup) {
    return;
  }

  const { ctx, width, height } = setup;
  const samples = pingHistory.slice();
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 24, right: 18, bottom: 34, left: 54 };
  chartState.padding = pad;

  if (!samples.length) {
    ctx.save();
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Пока нет измерений — подождите 1–2 секунды.", width / 2, height / 2);
    ctx.restore();
    chartState.points = [];
    chartState.average = null;
    chartState.min = null;
    chartState.max = null;
    return;
  }

  const points = samples
    .map((sample, index) => ({
      index,
      time: sample.at,
      ping: sample.ping
    }))
    .filter(sample => sample.time instanceof Date);

  const values = points.map(point => point.ping).filter(value => typeof value === "number" && Number.isFinite(value));
  const average = calculateAverage(samples);

  let minValue = values.length ? Math.min(...values) : 0;
  let maxValue = values.length ? Math.max(...values) : 100;

  if (average !== null) {
    minValue = Math.min(minValue, average);
    maxValue = Math.max(maxValue, average);
  }

  if (minValue === maxValue) {
    minValue -= 5;
    maxValue += 5;
  }

  const minTime = points[0].time.getTime();
  const maxTime = points[points.length - 1].time.getTime();
  const timeSpan = Math.max(1, maxTime - minTime);

  const plotLeft = pad.left;
  const plotTop = pad.top;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const yScale = (value) => {
    const ratio = (value - minValue) / (maxValue - minValue);
    return plotTop + plotHeight - ratio * plotHeight;
  };

  const xScale = (time) => {
    const ratio = (time.getTime() - minTime) / timeSpan;
    return plotLeft + ratio * plotWidth;
  };

  ctx.save();
  ctx.strokeStyle = "#dbe3ee";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i += 1) {
    const y = plotTop + (plotHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(plotLeft, plotTop);
  ctx.lineTo(plotLeft, plotTop + plotHeight);
  ctx.lineTo(width - pad.right, plotTop + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#6b7280";
  ctx.font = "12px Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(`${maxValue.toFixed(0)} ms`, plotLeft - 8, plotTop + 4);
  ctx.fillText(`${minValue.toFixed(0)} ms`, plotLeft - 8, plotTop + plotHeight - 4);

  if (average !== null) {
    const avgY = yScale(average);
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "#2563eb";
    ctx.beginPath();
    ctx.moveTo(plotLeft, avgY);
    ctx.lineTo(width - pad.right, avgY);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#2563eb";
    ctx.textAlign = "left";
    ctx.fillText(`Среднее ${average.toFixed(1)} ms`, width - pad.right - 120, avgY - 8);
  }

  const visiblePoints = [];
  ctx.save();
  ctx.strokeStyle = "#1d4ed8";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  let started = false;
  points.forEach(point => {
    if (typeof point.ping !== "number" || !Number.isFinite(point.ping)) {
      started = false;
      return;
    }

    const x = xScale(point.time);
    const y = yScale(point.ping);
    visiblePoints.push({
      index: point.index,
      x,
      y,
      ping: point.ping,
      time: point.time
    });

    if (!started) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      started = true;
      return;
    }

    ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#1d4ed8";
  visiblePoints.forEach(point => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  const firstTime = formatTimeLabel(points[0].time);
  const lastTime = formatTimeLabel(points[points.length - 1].time);
  ctx.save();
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(firstTime, plotLeft, height - pad.bottom + 10);
  ctx.textAlign = "right";
  ctx.fillText(lastTime, width - pad.right, height - pad.bottom + 10);
  ctx.restore();

  chartState.points = visiblePoints;
  chartState.average = average;
  chartState.min = minValue;
  chartState.max = maxValue;

  if (chartTooltip.classList.contains("hidden")) {
    chartTooltip.style.transform = "translate(-9999px, -9999px)";
  }
}

function hideTooltip() {
  chartTooltip.classList.add("hidden");
  chartTooltip.style.transform = "translate(-9999px, -9999px)";
}

function showTooltip(sample, x, y) {
  if (!sample) {
    hideTooltip();
    return;
  }

  chartTooltip.classList.remove("hidden");
  chartTooltip.textContent = `${formatTimeLabel(sample.time)} · ${sample.ping.toFixed(1)} ms`;
  chartTooltip.style.left = `${x}px`;
  chartTooltip.style.top = `${y}px`;
}

function updateTooltipFromMouse(event) {
  if (!chartState.points.length) {
    hideTooltip();
    return;
  }

  const rect = chartCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  let nearest = null;
  let nearestDistance = Infinity;

  chartState.points.forEach(point => {
    const distance = Math.abs(point.x - x);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  });

  if (!nearest || nearestDistance > 24) {
    hideTooltip();
    return;
  }

  showTooltip(
    nearest,
    Math.min(rect.width - 170, Math.max(12, nearest.x + 10)),
    Math.max(12, nearest.y - 38)
  );
}

function openPingModal(ip) {
  selectedIp = ip;
  pingHistory = [];

  const device = deviceCache.get(ip);
  pingTitleEl.textContent = `Пинг: ${ip}`;
  pingSubtitleEl.textContent = "Сбор статистики запущен. Через секунду появятся первые точки.";

  pingModal.classList.remove("hidden");
  pingModal.setAttribute("aria-hidden", "false");
  syncModalHeader();

  drawPingChart();
  loadPingStatus();
}

function closePingModal() {
  selectedIp = null;
  pingHistory = [];
  pingModal.classList.add("hidden");
  pingModal.setAttribute("aria-hidden", "true");
  hideTooltip();
}

function updateRowAndCache(device) {
  const tr = document.createElement("tr");
  tr.dataset.ip = device.ipAddress;
  updateRow(tr, device);
  rowCache.set(device.ipAddress, tr);
  return tr;
}

async function loadFull() {
  try {
    const [devices, gateway, currentIp, subnet] = await Promise.all([
      fetch("/api/devices").then(r => r.json()),
      fetch("/api/gateway").then(r => r.text()),
      fetch("/api/current-ip").then(r => r.text()),
      fetch("/api/subnet").then(r => r.text())
    ]);

    rowCache.clear();
    deviceCache.clear();
    tbody.innerHTML = "";

    devices.forEach(device => {
      deviceCache.set(device.ipAddress, device);
      tbody.appendChild(updateRowAndCache(device));
    });

    gatewayEl.textContent = gateway || "—";
    currentIpEl.textContent = currentIp || "—";
    subnetEl.textContent = subnet || "—";
    countEl.textContent = String(devices.length);
    updatedEl.textContent = `Обновлено: ${new Date().toLocaleTimeString()}`;

    if (selectedIp && deviceCache.has(selectedIp)) {
      syncModalHeader();
      drawPingChart();
    }
  } catch (error) {
    updatedEl.textContent = "Ошибка загрузки данных";
    console.error(error);
  }
}

async function loadPingStatus() {
  try {
    const statuses = await fetch("/api/ping-status").then(r => r.json());

    statuses.forEach(status => {
      const tr = rowCache.get(status.ip);
      if (!tr) {
        return;
      }

      const cells = tr.querySelectorAll("td");
      if (cells.length < 7) {
        return;
      }

      const device = deviceCache.get(status.ip) || {};
      const online = status.status === "ONLINE";

      device.status = status.status;
      device.avgPingMs = status.avgPingMs;
      device.packetLossPercent = status.packetLossPercent;
      device.macAddress = status.macAddress ?? device.macAddress;
      deviceCache.set(status.ip, device);

      cells[1].textContent = formatMac(status.macAddress ?? device.macAddress);
      cells[3].textContent = fmt(status.status);
      cells[3].className = online ? "status-pill status-online" : "status-pill status-offline";
      cells[5].textContent = online && status.avgPingMs !== null && status.avgPingMs !== undefined
        ? `${Number(status.avgPingMs).toFixed(1)} ms`
        : "—";
      cells[6].textContent = status.packetLossPercent !== null && status.packetLossPercent !== undefined
        ? `${Number(status.packetLossPercent).toFixed(1)}%`
        : "—";

      if (selectedIp === status.ip) {
        pushSample(status);
      }
    });

    updatedEl.textContent = `Время последнего обновления: ${new Date().toLocaleTimeString()}`;
    if (selectedIp) {
      syncModalHeader();
    }
  } catch (error) {
    console.error("Ошибка обновления пинга:", error);
  }
}

async function runScan() {
  scanBtn.disabled = true;
  scanBtn.textContent = "Сканирование...";

  try {
    await fetch("/api/scan", { method: "POST" });
    await loadFull();
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = "Запустить сканирование";
  }
}

scanBtn.addEventListener("click", runScan);
closePingModalBtn.addEventListener("click", closePingModal);
pingModal.querySelectorAll("[data-close-modal]").forEach(node => {
  node.addEventListener("click", closePingModal);
});

chartCanvas.addEventListener("mousemove", updateTooltipFromMouse);
chartCanvas.addEventListener("mouseleave", hideTooltip);
window.addEventListener("resize", () => {
  if (!pingModal.classList.contains("hidden")) {
    drawPingChart();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !pingModal.classList.contains("hidden")) {
    closePingModal();
  }
});

loadFull();
setInterval(loadPingStatus, 1000);
setInterval(loadFull, 30000);
