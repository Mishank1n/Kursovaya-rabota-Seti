package mihail.kurenyshev.service;

import mihail.kurenyshev.entity.DeviceStatus;
import mihail.kurenyshev.entity.DeviceType;
import mihail.kurenyshev.entity.NetworkDevice;
import mihail.kurenyshev.entity.ScanRun;
import mihail.kurenyshev.repository.DeviceRepository;
import mihail.kurenyshev.repository.ScanRunRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Collectors;

@Service
public class NetworkScanService {

    private final ArpService arpService;
    private final PingService pingService;
    private final DeviceRepository deviceRepository;
    private final ScanRunRepository scanRunRepository;

    @Value("${app.scan.enabled:true}")
    private boolean enabled;

    @Value("${app.scan.on-startup:true}")
    private boolean startupEnabled;

    // Пул потоков для параллельного пинга
    private final ExecutorService executor = Executors.newFixedThreadPool(
            Math.max(32, Runtime.getRuntime().availableProcessors() * 4)
    );

    public NetworkScanService(
            ArpService arpService,
            PingService pingService,
            DeviceRepository deviceRepository,
            ScanRunRepository scanRunRepository) {
        this.arpService = arpService;
        this.pingService = pingService;
        this.deviceRepository = deviceRepository;
        this.scanRunRepository = scanRunRepository;
    }

    public boolean isStartupEnabled() { return startupEnabled; }
    public String getGatewayFromArp()  { return arpService.getFirstArpIp(); }
    public String getCurrentIp()        { return arpService.getCurrentIp(); }

    public String getSubnet() {
        String gateway = getGatewayFromArp();
        return arpService.getSubnetFromIp(gateway != null ? gateway : getCurrentIp());
    }

    public List<NetworkDevice> getDevices() {
        return deviceRepository.findAll().stream()
                .sorted(Comparator.comparing(NetworkDevice::getIpAddress))
                .collect(Collectors.toList());
    }

    /**
     * Лёгкий срез для быстрого UI-обновления пинга.
     * Возвращает только ip, status, avgPingMs, packetLossPercent.
     */
    public List<Map<String, Object>> getPingStatus() {
        return deviceRepository.findAll().stream()
                .map(d -> {
                    Map<String, Object> m = new HashMap<>();
                    m.put("ip", d.getIpAddress());
                    m.put("status", d.getStatus());
                    m.put("avgPingMs", d.getAvgPingMs());
                    m.put("packetLossPercent", d.getPacketLossPercent());
                    return m;
                })
                .collect(Collectors.toList());
    }

    // ─────────────────────────────────────────────
    // ПОЛНОЕ СКАНИРОВАНИЕ (обнаружение новых устройств)
    // ─────────────────────────────────────────────

    public ScanRun scanNow() {
        String gateway   = getGatewayFromArp();
        String currentIp = getCurrentIp();
        String subnet    = getSubnet();

        String baseIp = gateway != null ? gateway : currentIp;
        if (baseIp == null) baseIp = "192.168.1.1";

        String[] parts = baseIp.split("\\.");
        String prefix = parts[0] + "." + parts[1] + "." + parts[2] + ".";

        List<String> targets = new ArrayList<>();
        for (int i = 1; i <= 254; i++) targets.add(prefix + i);

        LocalDateTime startedAt = LocalDateTime.now();
        long started = System.currentTimeMillis();

        // Параллельный опрос всех IP одновременно (ping -c 1)
        List<CompletableFuture<ScanHit>> futures = targets.stream()
                .map(ip -> CompletableFuture.supplyAsync(() -> probe(ip, gateway, currentIp), executor))
                .toList();

        List<ScanHit> hits = futures.stream().map(CompletableFuture::join).toList();

        Set<String> alive = new HashSet<>();
        int onlineCount = 0;

        for (ScanHit hit : hits) {
            if (!hit.reachable) continue;
            alive.add(hit.ip);
            onlineCount++;
            saveOrUpdateDevice(hit, gateway, currentIp, startedAt);
        }

        // Отмечаем офлайн тех, кого не увидели
        for (NetworkDevice device : deviceRepository.findAll()) {
            if (!device.getIpAddress().startsWith(prefix)) continue;
            if (alive.contains(device.getIpAddress())) continue;
            device.setStatus(DeviceStatus.OFFLINE);
            device.setAvgPingMs(null);
            device.setPacketLossPercent(100.0);
            device.setLastCheckedAt(startedAt);
            deviceRepository.save(device);
        }

        ScanRun run = new ScanRun();
        run.setGatewayIp(gateway);
        run.setSubnet(subnet);
        run.setProbedCount(targets.size());
        run.setOnlineCount(onlineCount);
        run.setStartedAt(startedAt);
        run.setFinishedAt(LocalDateTime.now());
        run.setDurationMs(System.currentTimeMillis() - started);
        scanRunRepository.save(run);

        return run;
    }

    /** Полное сканирование по расписанию (реже — только обнаружение) */
    @Scheduled(fixedDelayString = "${app.scan.interval-ms:30000}")
    public void scheduledScan() {
        if (enabled) scanNow();
    }

    // ─────────────────────────────────────────────
    // БЫСТРОЕ ОБНОВЛЕНИЕ ПИНГА (только онлайн-устройства)
    // ─────────────────────────────────────────────

    /**
     * Быстрый пинг всех известных онлайн-устройств параллельно.
     * Запускается каждые 2 секунды — намного чаще полного скана.
     */
    @Scheduled(fixedDelayString = "${app.ping.interval-ms:2000}")
    public void scheduledPingRefresh() {
        if (!enabled) return;

        List<NetworkDevice> onlineDevices = deviceRepository.findAll().stream()
                .filter(d -> d.getStatus() == DeviceStatus.ONLINE)
                .collect(Collectors.toList());

        if (onlineDevices.isEmpty()) return;

        LocalDateTime now = LocalDateTime.now();

        // Все устройства пингуем параллельно одновременно
        List<CompletableFuture<Void>> futures = onlineDevices.stream()
                .map(device -> CompletableFuture.runAsync(() -> {
                    PingService.PingResult result = pingService.ping1(device.getIpAddress());
                    device.setAvgPingMs(result.reachable() ? result.avgPingMs() : null);
                    device.setPacketLossPercent(result.packetLossPercent());
                    device.setStatus(result.reachable() ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE);
                    device.setLastCheckedAt(now);
                    if (result.reachable()) device.setLastSeenAt(now);
                    deviceRepository.save(device);
                }, executor))
                .toList();

        // Ждём завершения всех параллельных пингов
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
    }

    // ─────────────────────────────────────────────
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ─────────────────────────────────────────────

    private ScanHit probe(String ip, String gateway, String currentIp) {
        // Быстрая проверка: 1 пакет
        PingService.PingResult ping = pingService.ping1(ip);
        if (!ping.reachable()) {
            return new ScanHit(ip, false, ping.avgPingMs(), ping.packetLossPercent(), null);
        }

        String host = null;
        try {
            host = java.net.InetAddress.getByName(ip).getHostName();
        } catch (Exception ignored) {}

        return new ScanHit(ip, true, ping.avgPingMs(), ping.packetLossPercent(), host);
    }

    private void saveOrUpdateDevice(ScanHit hit, String gateway, String currentIp, LocalDateTime timestamp) {
        NetworkDevice device = deviceRepository.findByIpAddress(hit.ip).orElseGet(NetworkDevice::new);
        if (device.getFirstSeenAt() == null) device.setFirstSeenAt(timestamp);

        device.setIpAddress(hit.ip);
        device.setHostName(hit.hostName != null ? hit.hostName : hit.ip);
        device.setStatus(DeviceStatus.ONLINE);
        device.setAvgPingMs(hit.avgPingMs);
        device.setPacketLossPercent(hit.packetLossPercent);
        device.setLastSeenAt(timestamp);
        device.setLastCheckedAt(timestamp);

        if (hit.ip.equals(gateway)) device.setDeviceType(DeviceType.ROUTER);
        else if (hit.ip.equals(currentIp)) device.setDeviceType(DeviceType.CURRENT_DEVICE);
        else device.setDeviceType(DeviceType.HOST);

        deviceRepository.save(device);
    }

    private static class ScanHit {
        final String ip;
        final boolean reachable;
        final double avgPingMs;
        final double packetLossPercent;
        final String hostName;

        ScanHit(String ip, boolean reachable, double avgPingMs, double packetLossPercent, String hostName) {
            this.ip = ip;
            this.reachable = reachable;
            this.avgPingMs = avgPingMs;
            this.packetLossPercent = packetLossPercent;
            this.hostName = hostName;
        }
    }
}