package mihail.kurenyshev.controller;


import mihail.kurenyshev.entity.NetworkDevice;
import mihail.kurenyshev.entity.ScanRun;
import mihail.kurenyshev.service.NetworkScanService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
@CrossOrigin
public class ApiController {

    private final NetworkScanService scanService;

    public ApiController(NetworkScanService scanService) {
        this.scanService = scanService;
    }

    @GetMapping("/devices")
    public List<NetworkDevice> devices() {
        return scanService.getDevices();
    }

    @GetMapping("/gateway")
    public String gateway() {
        return scanService.getGatewayFromArp();
    }

    @GetMapping("/current-ip")
    public String currentIp() {
        return scanService.getCurrentIp();
    }

    @GetMapping("/subnet")
    public String subnet() {
        return scanService.getSubnet();
    }

    @PostMapping("/scan")
    public ScanRun scanNow() {
        return scanService.scanNow();
    }
}
