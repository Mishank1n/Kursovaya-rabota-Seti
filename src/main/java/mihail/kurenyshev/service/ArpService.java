package mihail.kurenyshev.service;

import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class ArpService {

    private static final Pattern IPV4_PATTERN = Pattern.compile("\b(\\d{1,3}(?:\\.\\d{1,3}){3})\b");
    private static final Pattern MAC_PATTERN = Pattern.compile("(?i)\b([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})\b");

    public List<String> getArpIpsInOrder() {
        return new ArrayList<>(getArpMacByIp().keySet());
    }

    public String getFirstArpIp() {
        List<String> ips = getArpIpsInOrder();
        return ips.isEmpty() ? null : ips.get(0);
    }

    public Map<String, String> getArpMacByIp() {
        Map<String, String> entries = new LinkedHashMap<>();

        for (String line : collectArpLines()) {
            String lower = line.toLowerCase();
            if (lower.contains("mdns.mcast.net") || lower.contains("224.0.0.251") || lower.contains("239.255.255.250")) {
                continue;
            }
            if (lower.contains("incomplete") || lower.contains("failed")) {
                continue;
            }

            String ip = extractFirst(Ipv4OrNull(line), line);
            String mac = extractMac(line);

            if (ip != null && mac != null) {
                entries.put(ip, mac);
            }
        }

        return entries;
    }

    public String getCurrentIp() {
        String[] commands = {
                "ipconfig getifaddr en0",
                "hostname -I | awk '{print $1}'",
                "hostname -i"
        };

        for (String command : commands) {
            String ip = readFirstIp(command);
            if (ip != null) {
                return ip;
            }
        }

        return null;
    }

    public String getSubnetFromIp(String ip) {
        if (ip == null || !ip.contains(".")) {
            return "192.168.1.0/24";
        }

        String[] parts = ip.split("\\.");
        if (parts.length < 3) {
            return "192.168.1.0/24";
        }

        return parts[0] + "." + parts[1] + "." + parts[2] + ".0/24";
    }

    private List<String> collectArpLines() {
        List<String> lines = new ArrayList<>();
        readCommandLines("arp -a", lines);
        if (lines.isEmpty()) {
            readCommandLines("ip neigh show", lines);
        }
        return lines;
    }

    private void readCommandLines(String command, List<String> lines) {
        try {
            Process process = new ProcessBuilder("sh", "-c", command).start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (!line.isBlank()) {
                        lines.add(line);
                    }
                }
            }
        } catch (Exception ignored) {
            // На части систем одна из команд может отсутствовать.
        }
    }

    private String readFirstIp(String command) {
        try {
            Process process = new ProcessBuilder("sh", "-c", command).start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String ip = Ipv4OrNull(line);
                    if (ip != null) {
                        return ip;
                    }
                    if (!line.isBlank()) {
                        return line.trim();
                    }
                }
            }
        } catch (Exception ignored) {
        }

        return null;
    }

    private String Ipv4OrNull(String text) {
        Matcher matcher = IPV4_PATTERN.matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    private String extractFirst(String value, String fallbackLine) {
        if (value != null && !value.isBlank()) {
            return value;
        }
        return Ipv4OrNull(fallbackLine);
    }

    private String extractMac(String line) {
        Matcher matcher = MAC_PATTERN.matcher(line);
        if (matcher.find()) {
            return normalizeMac(matcher.group(1));
        }
        return null;
    }

    private String normalizeMac(String mac) {
        return mac.replace('-', ':').toLowerCase();
    }
}
