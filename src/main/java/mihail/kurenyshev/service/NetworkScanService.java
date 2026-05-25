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

    private final ExecutorService executor = Executors.newFixedThreadPool(
            Math.max(8, Runtime.getRuntime().availableProcessors() * 2)
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

    public boolean isStartupEnabled() {
        return startupEnabled;
    }

    public String getGatewayFromArp() {
        return arpService.getFirstArpIp();
    }

    public String getCurrentIp() {
        return arpService.getCurrentIp();
    }

    public String getSubnet() {
        String gateway = getGatewayFromArp();
        if (gateway != null) {
            return arpService.getSubnetFromIp(gateway);
        }
        String current = getCurrentIp();
        return arpService.getSubnetFromIp(current);
    }

    public List<NetworkDevice> getDevices() {
        return deviceRepository.findAll().stream()
                .sorted(Comparator.comparing(NetworkDevice::getIpAddress))
                .collect(Collectors.toList());
    }

    public ScanRun scanNow() {
        String gateway = getGatewayFromArp();
        String currentIp = getCurrentIp();
        String subnet = getSubnet();

        String baseIp = gateway != null ? gateway : currentIp;
        if (baseIp == null) {
            baseIp = "192.168.1.1";
        }

        String[] parts = baseIp.split("\\.");
        String prefix = parts[0] + "." + parts[1] + "." + parts[2] + ".";

        List<String> targets = new ArrayList<>();
        for (int i = 1; i <= 254; i++) {
            targets.add(prefix + i);
        }

        LocalDateTime startedAt = LocalDateTime.now();
        long started = System.currentTimeMillis();

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

            NetworkDevice device = deviceRepository.findByIpAddress(hit.ip).orElseGet(NetworkDevice::new);
            if (device.getFirstSeenAt() == null) {
                device.setFirstSeenAt(startedAt);
            }

            device.setIpAddress(hit.ip);
            device.setHostName(hit.hostName != null ? hit.hostName : hit.ip);
            device.setStatus(DeviceStatus.ONLINE);
            device.setAvgPingMs(hit.avgPingMs);
            device.setPacketLossPercent(hit.packetLossPercent);
            device.setLastSeenAt(startedAt);
            device.setLastCheckedAt(startedAt);

            if (hit.ip.equals(gateway)) {
                device.setDeviceType(DeviceType.ROUTER);
            } else if (hit.ip.equals(currentIp)) {
                device.setDeviceType(DeviceType.CURRENT_DEVICE);
            } else {
                device.setDeviceType(DeviceType.HOST);
            }

            deviceRepository.save(device);
        }

        for (NetworkDevice device : deviceRepository.findAll()) {
            if (!device.getIpAddress().startsWith(prefix)) {
                continue;
            }
            if (alive.contains(device.getIpAddress())) {
                continue;
            }
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

    @Scheduled(fixedDelayString = "${app.scan.interval-ms:10000}")
    public void scheduledScan() {
        if (enabled) {
            scanNow();
        }
    }

    private ScanHit probe(String ip, String gateway, String currentIp) {
        PingService.PingResult ping = pingService.ping4(ip);
        if (!ping.reachable()) {
            return new ScanHit(ip, false, ping.avgPingMs(), ping.packetLossPercent(), null);
        }

        String host = null;
        try {
            host = java.net.InetAddress.getByName(ip).getHostName();
        } catch (Exception ignored) {
        }

        return new ScanHit(ip, true, ping.avgPingMs(), ping.packetLossPercent(), host);
    }

    private static class ScanHit {
        private final String ip;
        private final boolean reachable;
        private final double avgPingMs;
        private final double packetLossPercent;
        private final String hostName;

        private ScanHit(String ip, boolean reachable, double avgPingMs, double packetLossPercent, String hostName) {
            this.ip = ip;
            this.reachable = reachable;
            this.avgPingMs = avgPingMs;
            this.packetLossPercent = packetLossPercent;
            this.hostName = hostName;
        }
    }
}
