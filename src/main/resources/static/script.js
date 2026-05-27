/* ─── Network Monitor – script.js ─────────────────────────────────────────── */

const gatewayEl    = document.getElementById("gateway");
const currentIpEl  = document.getElementById("currentIp");
const subnetEl     = document.getElementById("subnet");
const countEl      = document.getElementById("count");
const updatedEl    = document.getElementById("updated");
const tbody        = document.getElementById("tbody");
const scanBtn      = document.getElementById("scanBtn");

const pingModal        = document.getElementById("pingModal");
const closePingModalBtn = document.getElementById("closePingModal");
const pingTitleEl      = document.getElementById("pingTitle");
const pingSubtitleEl   = document.getElementById("pingSubtitle");
const pingIpEl         = document.getElementById("pingIp");
const pingMacEl        = document.getElementById("pingMac");
const pingHostEl       = document.getElementById("pingHost");
const pingAvgEl        = document.getElementById("pingAvg");
const pingLastEl       = document.getElementById("pingLast");
const pingSamplesEl    = document.getElementById("pingSamples");
const chartCanvas      = document.getElementById("pingChart");
const chartTooltip     = document.getElementById("chartTooltip");
const chartCtx         = chartCanvas ? chartCanvas.getContext("2d") : null;

const state = {
    devices:      [],
    scanning:     false,
    pingInterval: null,
    selectedIp:   null,
    pingHistory:  [],
    chartState: {
        points:  [],
        average: null,
        min:     null,
        max:     null,
        padding: null,
    },
    deviceCache: new Map(),
    chartData:   new Map(),
};

/* ─── Утилиты ──────────────────────────────────────────────────────────────── */

function now() {
    return new Date().toLocaleTimeString("ru-RU");
}

function formatMs(ms) {
    if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
    return `${Number(ms).toFixed(1)} ms`;
}

function formatMac(value) {
    if (!value) return "—";
    return String(value).toLowerCase();
}

function formatTimeLabel(date) {
    return new Intl.DateTimeFormat("ru-RU", {
        hour:   "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(date);
}

function calculateAverage(samples) {
    const values = samples
        .map(item => item.ping)
        .filter(value => typeof value === "number" && Number.isFinite(value));

    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/* ─── API-запросы ──────────────────────────────────────────────────────────── */

async function apiFetch(path, options) {
    const response = await fetch(path, options);
    if (!response.ok) throw new Error(`HTTP ${response.status} on ${path}`);
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return text; // plain-string endpoints (gateway, currentIp, subnet)
    }
}

async function fetchGateway()   { return apiFetch("/api/gateway"); }
async function fetchCurrentIp() { return apiFetch("/api/current-ip"); }
async function fetchSubnet()    { return apiFetch("/api/subnet"); }
async function fetchDevices()   { return apiFetch("/api/devices"); }
async function fetchPingStatus(){ return apiFetch("/api/ping-status"); }
async function postScan()       { return apiFetch("/api/scan", { method: "POST" }); }

/* ─── Таблица ──────────────────────────────────────────────────────────────── */

function createStatusBadge(isOnline) {
    const wrapper = document.createElement("div");
    wrapper.className = "status-cell";

    const badge = document.createElement("div");
    badge.className = isOnline
        ? "status-pill status-online"
        : "status-pill status-offline";
    badge.textContent = isOnline ? "ONLINE" : "OFFLINE";

    wrapper.appendChild(badge);
    return wrapper;
}

function createCell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text === null || text === undefined ? "—" : String(text);
    return td;
}

function createIpCell(ip, clickable) {
    const td = document.createElement("td");

    if (clickable) {
        td.className = "ip-cell";
        td.textContent = ip;
        td.addEventListener("click", () => openPingModal(ip));
    } else {
        td.textContent = ip;
    }

    return td;
}

function renderTable() {
    tbody.innerHTML = "";

    state.devices.forEach(device => {
        const tr       = document.createElement("tr");
        const isOnline = device.status === "ONLINE";

        tr.appendChild(createIpCell(device.ipAddress, isOnline));
        tr.appendChild(createCell(formatMac(device.macAddress), "mono"));
        tr.appendChild(createCell(device.deviceType));

        const tdStatus = document.createElement("td");
        tdStatus.appendChild(createStatusBadge(isOnline));
        tr.appendChild(tdStatus);

        tr.appendChild(createCell(isOnline ? formatMs(device.avgPingMs) : "—"));
        tr.appendChild(
            createCell(
                device.packetLossPercent !== null && device.packetLossPercent !== undefined
                    ? `${Number(device.packetLossPercent).toFixed(1)}%`
                    : "—"
            )
        );

        tbody.appendChild(tr);
    });
}

/* ─── Live-ping через /api/ping-status ─────────────────────────────────────── */

function startLivePing() {
    if (state.pingInterval) clearInterval(state.pingInterval);

    state.pingInterval = setInterval(async () => {
        let updates;
        try {
            updates = await fetchPingStatus();
        } catch (err) {
            console.warn("ping-status error:", err);
            return;
        }

        updates.forEach(item => {
            const ip     = item.ip;
            const ms     = (item.avgPingMs !== null && item.avgPingMs !== undefined)
                           ? Number(item.avgPingMs)
                           : null;
            const loss   = (item.packetLossPercent !== null && item.packetLossPercent !== undefined)
                           ? Number(item.packetLossPercent)
                           : null;
            const status = String(item.status);

            // Обновляем кэш устройства
            const cached = state.deviceCache.get(ip);
            if (cached) {
                cached.avgPingMs         = ms;
                cached.packetLossPercent = loss;
                cached.status            = status;
                if (item.macAddress) cached.macAddress = item.macAddress;
            }

            // Добавляем точку в историю графика только если есть реальный пинг
            if (ms !== null && Number.isFinite(ms) && status === "ONLINE") {
                const history = state.chartData.get(ip) || [];
                history.push({ at: new Date(), ping: ms });
                if (history.length > 120) history.shift();
                state.chartData.set(ip, history);
            }
        });

        updatedEl.textContent = `Время последнего обновления: ${now()}`;
        renderTable();

        if (state.selectedIp) {
            updateModal();
        }
    }, 2000);
}

/* ─── Сканирование ─────────────────────────────────────────────────────────── */

async function startScan() {
    if (state.scanning) return;

    state.scanning    = true;
    scanBtn.disabled  = true;
    scanBtn.textContent = "Сканирование...";

    try {
        // 1. Запустить сканирование на беке (блокирует до завершения)
        await postScan();

        // 2. Параллельно получить мета-данные и список устройств
        const [gateway, myIp, subnet, devices] = await Promise.all([
            fetchGateway(),
            fetchCurrentIp(),
            fetchSubnet(),
            fetchDevices(),
        ]);

        state.devices     = devices;
        state.deviceCache = new Map(devices.map(d => [d.ipAddress, d]));
        state.chartData   = new Map();

        // Заполнить начальные точки графика для онлайн-устройств
        devices.forEach(device => {
            if (device.status === "ONLINE" &&
                device.avgPingMs !== null && device.avgPingMs !== undefined) {
                state.chartData.set(device.ipAddress, [
                    { at: new Date(), ping: Number(device.avgPingMs) },
                ]);
            }
        });

        gatewayEl.textContent   = gateway   || "—";
        currentIpEl.textContent = myIp      || "—";
        subnetEl.textContent    = subnet    || "—";
        countEl.textContent     = String(devices.length);
        updatedEl.textContent   = `Время последнего обновления: ${now()}`;

        renderTable();
        startLivePing();

    } catch (err) {
        console.error("Ошибка сканирования:", err);
        updatedEl.textContent = `Ошибка: ${err.message}`;
    } finally {
        state.scanning      = false;
        scanBtn.disabled    = false;
        scanBtn.textContent = "Запустить сканирование";
    }
}

/* ─── Tooltip ──────────────────────────────────────────────────────────────── */

function hideTooltip() {
    if (!chartTooltip) return;
    chartTooltip.classList.add("hidden");
    chartTooltip.style.transform = "translate(-9999px, -9999px)";
}

function showTooltip(sample, x, y) {
    if (!chartTooltip) return;

    if (!sample) {
        hideTooltip();
        return;
    }

    chartTooltip.classList.remove("hidden");
    chartTooltip.textContent = `${formatTimeLabel(sample.time)} · ${sample.ping.toFixed(1)} ms`;
    chartTooltip.style.left = `${x}px`;
    chartTooltip.style.top  = `${y}px`;
}

/* ─── Модальное окно графика ────────────────────────────────────────────────── */

function syncModalHeader() {
    const device      = state.deviceCache.get(state.selectedIp);
    const latestSample = state.pingHistory.length
        ? state.pingHistory[state.pingHistory.length - 1]
        : null;
    const avg = calculateAverage(state.pingHistory);

    pingTitleEl.textContent = state.selectedIp ? `Пинг: ${state.selectedIp}` : "График пинга";
    pingIpEl.textContent    = state.selectedIp || "—";
    pingMacEl.textContent   = formatMac(device?.macAddress);
    pingAvgEl.textContent   = avg === null ? "—" : `${avg.toFixed(1)} ms`;
    pingLastEl.textContent  = latestSample ? `${latestSample.ping.toFixed(1)} ms` : "—";
    pingSamplesEl.textContent = String(state.pingHistory.length);

    pingSubtitleEl.textContent =
        device?.status === "OFFLINE"
            ? "Устройство сейчас не отвечает, но история пинга сохраняется"
            : "История строится по каждому обновлению таблицы пинга";
}

function resizeCanvasToCssSize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;

    if (rect.width === 0 || rect.height === 0) return null;

    const width  = Math.round(rect.width  * dpr);
    const height = Math.round(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
        canvas.width  = width;
        canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { ctx, width: rect.width, height: rect.height };
}

function drawPingChart() {
    if (!chartCanvas || !chartCtx) return;

    const setup = resizeCanvasToCssSize(chartCanvas);
    if (!setup) return;

    const { ctx, width, height } = setup;
    const samples = state.pingHistory.slice();

    ctx.clearRect(0, 0, width, height);

    const pad = { top: 24, right: 18, bottom: 34, left: 54 };
    state.chartState.padding = pad;

    if (!samples.length) {
        ctx.save();
        ctx.fillStyle  = "#6b7280";
        ctx.font       = "14px Arial, sans-serif";
        ctx.textAlign  = "center";
        ctx.fillText("Пока нет измерений — подождите 1–2 секунды.", width / 2, height / 2);
        ctx.restore();

        state.chartState.points  = [];
        state.chartState.average = null;
        state.chartState.min     = null;
        state.chartState.max     = null;
        hideTooltip();
        return;
    }

    const points = samples
        .map((sample, index) => ({ index, time: sample.at, ping: sample.ping }))
        .filter(sample => sample.time instanceof Date);

    const values  = points.map(p => p.ping).filter(v => typeof v === "number" && Number.isFinite(v));
    const average = calculateAverage(samples);

    let minValue = values.length ? Math.min(...values) : 0;
    let maxValue = values.length ? Math.max(...values) : 100;

    if (average !== null) {
        minValue = Math.min(minValue, average);
        maxValue = Math.max(maxValue, average);
    }

    if (minValue === maxValue) { minValue -= 5; maxValue += 5; }

    const minTime  = points[0].time.getTime();
    const maxTime  = points[points.length - 1].time.getTime();
    const timeSpan = Math.max(1, maxTime - minTime);

    const plotLeft   = pad.left;
    const plotTop    = pad.top;
    const plotWidth  = width  - pad.left - pad.right;
    const plotHeight = height - pad.top  - pad.bottom;

    const yScale = value => plotTop + plotHeight - ((value - minValue) / (maxValue - minValue)) * plotHeight;
    const xScale = time  => plotLeft + ((time.getTime() - minTime) / timeSpan) * plotWidth;

    ctx.save();
    ctx.strokeStyle = "#dbe3ee";
    ctx.lineWidth   = 1;

    for (let i = 0; i <= 4; i++) {
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

    ctx.fillStyle     = "#6b7280";
    ctx.font          = "12px Arial, sans-serif";
    ctx.textAlign     = "right";
    ctx.textBaseline  = "middle";
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
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = "round";
    ctx.lineCap     = "round";

    let started = false;
    points.forEach(point => {
        if (typeof point.ping !== "number" || !Number.isFinite(point.ping)) {
            started = false;
            return;
        }

        const x = xScale(point.time);
        const y = yScale(point.ping);

        visiblePoints.push({ index: point.index, x, y, ping: point.ping, time: point.time });

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
    const lastTime  = formatTimeLabel(points[points.length - 1].time);

    ctx.save();
    ctx.fillStyle    = "#6b7280";
    ctx.textAlign    = "left";
    ctx.textBaseline = "top";
    ctx.fillText(firstTime, plotLeft, height - pad.bottom + 10);
    ctx.textAlign = "right";
    ctx.fillText(lastTime, width - pad.right, height - pad.bottom + 10);
    ctx.restore();

    state.chartState.points  = visiblePoints;
    state.chartState.average = average;
    state.chartState.min     = minValue;
    state.chartState.max     = maxValue;

    if (chartTooltip.classList.contains("hidden")) {
        chartTooltip.style.transform = "translate(-9999px, -9999px)";
    }
}

function updateModal() {
    if (!state.selectedIp) return;

    const history    = state.chartData.get(state.selectedIp) || [];
    state.pingHistory = history.slice(-120);

    syncModalHeader();
    drawPingChart();
}

function openPingModal(ip) {
    state.selectedIp  = ip;
    state.pingHistory = state.chartData.get(ip)?.slice(-120) || [];

    pingModal.classList.remove("hidden");
    pingModal.setAttribute("aria-hidden", "false");

    syncModalHeader();
    drawPingChart();
}

function closePingModal() {
    state.selectedIp  = null;
    state.pingHistory = [];
    pingModal.classList.add("hidden");
    pingModal.setAttribute("aria-hidden", "true");
    hideTooltip();
}

function updateTooltipFromMouse(event) {
    if (!state.chartState.points.length) {
        hideTooltip();
        return;
    }

    const rect = chartCanvas.getBoundingClientRect();
    const x    = event.clientX - rect.left;

    let nearest         = null;
    let nearestDistance = Infinity;

    state.chartState.points.forEach(point => {
        const distance = Math.abs(point.x - x);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest         = point;
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

/* ─── Event listeners ──────────────────────────────────────────────────────── */

scanBtn.addEventListener("click", startScan);
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

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !pingModal.classList.contains("hidden")) {
        closePingModal();
    }
});