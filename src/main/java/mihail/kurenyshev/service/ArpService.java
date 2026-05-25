package mihail.kurenyshev.service;

import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class ArpService {

    private static final Pattern IPV4_PATTERN = Pattern.compile("(\\d{1,3}(?:\\.\\d{1,3}){3})");

    public List<String> getArpIpsInOrder() {
        List<String> ips = new ArrayList<>();
        try {
            Process process = new ProcessBuilder("sh", "-c", "arp -a").start();
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                String lower = line.toLowerCase();
                if (lower.contains("mdns.mcast.net") || lower.contains("224.0.0.251") || lower.contains("239.255.255.250")) {
                    continue;
                }
                if (lower.contains("incomplete")) {
                    continue;
                }
                Matcher matcher = IPV4_PATTERN.matcher(line);
                while (matcher.find()) {
                    String ip = matcher.group(1);
                    if (!ip.endsWith(".255") && !ip.startsWith("224.") && !ip.startsWith("239.")) {
                        if (!ips.contains(ip)) {
                            ips.add(ip);
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return ips;
    }

    public String getFirstArpIp() {
        List<String> ips = getArpIpsInOrder();
        return ips.isEmpty() ? null : ips.get(0);
    }

    public String getCurrentIp() {
        try {
            Process process = new ProcessBuilder("sh", "-c", "ipconfig getifaddr en0").start();
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line = reader.readLine();
            if (line != null && !line.isBlank()) {
                return line.trim();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    public String getSubnetFromIp(String ip) {
        if (ip == null || !ip.contains(".")) {
            return "192.168.1.0/24";
        }
        String[] parts = ip.split("\\.");
        return parts[0] + "." + parts[1] + "." + parts[2] + ".0/24";
    }
}
