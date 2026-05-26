const gatewayEl  = document.getElementById("gateway");
const currentIpEl = document.getElementById("currentIp");
const subnetEl   = document.getElementById("subnet");
const countEl    = document.getElementById("count");
const updatedEl  = document.getElementById("updated");
const tbody      = document.getElementById("tbody");
const scanBtn    = document.getElementById("scanBtn");

// Кэш строк таблицы по IP для точечного обновления без перерисовки
const rowCache = new Map();

function fmt(v) {
    if (v === null || v === undefined || v === "") return "—";
    return v;
}

// ────────────────────────────────────────────
// ПОЛНАЯ ЗАГРУЗКА (список устройств + инфо о сети)
// Запускается реже — при старте и после ручного скана
// ────────────────────────────────────────────
async function loadFull() {
    try {
        const [devices, gateway, currentIp, subnet] = await Promise.all([
            fetch("/api/devices").then(r => r.json()),
            fetch("/api/gateway").then(r => r.text()),
            fetch("/api/current-ip").then(r => r.text()),
            fetch("/api/subnet").then(r => r.text())
        ]);

        // Перестраиваем таблицу полностью
        rowCache.clear();
        tbody.innerHTML = "";

        devices.forEach(d => {
            const tr = document.createElement("tr");
            tr.dataset.ip = d.ipAddress;
            updateRow(tr, d);
            tbody.appendChild(tr);
            rowCache.set(d.ipAddress, tr);
        });

        gatewayEl.textContent   = gateway  || "—";
        currentIpEl.textContent = currentIp || "—";
        subnetEl.textContent    = subnet   || "—";
        countEl.textContent     = devices.length;
        updatedEl.textContent   = `Обновлено: ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        updatedEl.textContent = "Ошибка загрузки данных";
        console.error(e);
    }
}

// ────────────────────────────────────────────
// БЫСТРОЕ ОБНОВЛЕНИЕ ПИНГА (только ip/status/ping)
// Запускается каждую секунду — точечно обновляет ячейки
// ────────────────────────────────────────────
async function loadPingStatus() {
    try {
        const statuses = await fetch("/api/ping-status").then(r => r.json());

        statuses.forEach(s => {
            const tr = rowCache.get(s.ip);
            if (!tr) return; // новое устройство — ждём следующего полного обновления

            // Обновляем только ячейки статуса и пинга
            const cells = tr.querySelectorAll("td");
            if (cells.length < 6) return;

            const statusCell = cells[2];
            const pingCell   = cells[4];
            const lossCell   = cells[5];

            const isOnline = s.status === "ONLINE";
            statusCell.textContent  = fmt(s.status);
            statusCell.className    = isOnline ? "status-online" : "status-offline";
            pingCell.textContent    = isOnline ? `${fmt(s.avgPingMs)} ms` : "—";
            lossCell.textContent    = `${fmt(s.packetLossPercent)}%`;
        });

        updatedEl.textContent = `Время последнего обновления: ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        console.error("Ошибка обновления пинга:", e);
    }
}

function updateRow(tr, d) {
    const isOnline = d.status === "ONLINE";
    tr.innerHTML = `
        <td>${fmt(d.ipAddress)}</td>
        <td>${fmt(d.deviceType)}</td>
        <td class="${isOnline ? "status-online" : "status-offline"}">${fmt(d.status)}</td>
        <td>${fmt(d.hostName)}</td>
        <td>${isOnline ? fmt(d.avgPingMs) + " ms" : "—"}</td>
        <td>${fmt(d.packetLossPercent)}%</td>
    `;
}

// ────────────────────────────────────────────
// РУЧНОЕ СКАНИРОВАНИЕ
// ────────────────────────────────────────────
async function runScan() {
    scanBtn.disabled    = true;
    scanBtn.textContent = "Сканирование...";
    try {
        await fetch("/api/scan", { method: "POST" });
        await loadFull();
    } finally {
        scanBtn.disabled    = false;
        scanBtn.textContent = "Запустить сканирование";
    }
}

scanBtn.addEventListener("click", runScan);

// Старт: полная загрузка, потом быстрый пинг каждую секунду
// и полная перезагрузка устройств каждые 30 секунд
loadFull();
setInterval(loadPingStatus, 1000);   // быстрое обновление пинга
setInterval(loadFull, 30000);        // полное обновление списка устройств