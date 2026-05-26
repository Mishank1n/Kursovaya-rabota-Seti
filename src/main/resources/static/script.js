const gatewayEl = document.getElementById("gateway");
const currentIpEl = document.getElementById("currentIp");
const subnetEl = document.getElementById("subnet");
const countEl = document.getElementById("count");
const updatedEl = document.getElementById("updated");
const tbody = document.getElementById("tbody");
const scanBtn = document.getElementById("scanBtn");

function fmt(v) {
    if (v === null || v === undefined || v === "") return "—";
    return v;
}

async function load() {
    try {
        const [devices, gateway, currentIp, subnet] = await Promise.all([
            fetch("/api/devices").then(r => r.json()),
            fetch("/api/gateway").then(r => r.text()),
            fetch("/api/current-ip").then(r => r.text()),
            fetch("/api/subnet").then(r => r.text())
        ]);

        tbody.innerHTML = "";

        devices.forEach(d => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${fmt(d.ipAddress)}</td>
                <td>${fmt(d.deviceType)}</td>
                <td class="${d.status === 'ONLINE' ? 'status-online' : 'status-offline'}">${fmt(d.status)}</td>
                <td>${fmt(d.hostName)}</td>
                <td>${fmt(d.avgPingMs)} ms</td>
                <td>${fmt(d.packetLossPercent)}%</td>
            `;
            tbody.appendChild(tr);
        });

        gatewayEl.textContent = gateway || "—";
        currentIpEl.textContent = currentIp || "—";
        subnetEl.textContent = subnet || "—";
        countEl.textContent = devices.length;
        updatedEl.textContent = `Обновлено: ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        updatedEl.textContent = "Ошибка загрузки данных";
        console.error(e);
    }
}

async function runScan() {
    scanBtn.disabled = true;
    scanBtn.textContent = "Сканирование...";
    try {
        await fetch("/api/scan", { method: "POST" });
        await load();
    } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = "Запустить сканирование";
    }
}

scanBtn.addEventListener("click", runScan);

load();
setInterval(load, 1000);
