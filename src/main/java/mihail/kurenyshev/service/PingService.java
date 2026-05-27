package mihail.kurenyshev.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class PingService {

    @Value("${app.scan.timeout-ms:1000}")
    private int timeoutMs;

    private static final Pattern LOSS_PATTERN = Pattern.compile("(\\d+(?:\\.\\d+)?)% packet loss");
    private static final Pattern RTT_PATTERN  = Pattern.compile("= [0-9.]+/([0-9.]+)/");


    public PingResult ping1(String ipAddress) {
        return runPing("ping -c 1 -W 1 " + ipAddress);
    }
    public PingResult ping4(String ipAddress) {
        return runPing("ping -c 4 -W 1 " + ipAddress);
    }

    private PingResult runPing(String command) {
        double loss = 100.0;
        double avg  = 0.0;

        try {
            Process process = new ProcessBuilder("sh", "-c", command).start();
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                Matcher lossMatcher = LOSS_PATTERN.matcher(line);
                if (lossMatcher.find()) {
                    loss = Double.parseDouble(lossMatcher.group(1));
                }
                Matcher rttMatcher = RTT_PATTERN.matcher(line);
                if (rttMatcher.find()) {
                    avg = Double.parseDouble(rttMatcher.group(1));
                }
            }
            process.waitFor();
        } catch (Exception ignored) {
        }

        return new PingResult(loss == 0.0, avg, loss);
    }

    public record PingResult(boolean reachable, double avgPingMs, double packetLossPercent) {}
}