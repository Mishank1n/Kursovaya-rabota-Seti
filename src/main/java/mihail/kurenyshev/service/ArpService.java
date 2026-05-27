package mihail.kurenyshev.service;

import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class ArpService {

    private static final Pattern IPV4_PATTERN =
            Pattern.compile("\\b(\\d{1,3}(?:\\.\\d{1,3}){3})\\b");
    private static final Pattern MAC_PATTERN =
            Pattern.compile("(?i)\\b([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})\\b");

    public List<String> getArpIpsInOrder() {
        return new ArrayList<>(getArpMacByIp().keySet());
    }

    /**
     * Исторический метод: в проекте его использовали как "gateway".
     * Оставляем совместимость и возвращаем адрес шлюза по умолчанию.
     */
    public String getFirstArpIp() {
        return getGatewayIp();
    }

    public String getGatewayIp() {
        String[] commands = {
                "ip route show default",
                "route -n get default",
                "netstat -rn"
        };

        for (String command : commands) {
            String gateway = readGatewayFromCommand(command);
            if (gateway != null) {
                return gateway;
            }
        }

        String currentIp = getCurrentIp();
        return guessGatewayFromCurrentIp(currentIp);
    }

    public Map<String, String> getArpMacByIp() {
        Map<String, String> entries = new LinkedHashMap<>();

        for (String line : collectArpLines()) {
            String lower = line.toLowerCase(Locale.ROOT);

            if (lower.contains("mdns.mcast.net")
                    || lower.contains("224.0.0.251")
                    || lower.contains("239.255.255.250")) {
                continue;
            }

            if (lower.contains("incomplete") || lower.contains("failed")) {
                continue;
            }

            String ip = extractIpv4(line);
            String mac = extractMac(line);

            if (ip != null && mac != null) {
                entries.put(ip, mac);
            }
        }

        return entries;
    }

    public String getMacForIp(String ip) {
        if (ip == null || ip.isBlank()) {
            return null;
        }
        return getArpMacByIp().get(ip);
    }

    public String getCurrentIp() {
        String interfaceIp = readPrimaryIpFromInterfaces();
        if (interfaceIp != null) {
            return interfaceIp;
        }

        String[] commands = {
                "hostname -I",
                "ipconfig getifaddr en0",
                "ipconfig getifaddr en1",
                "ip -4 addr show scope global",
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
        readCommandLines("ip neigh show", lines);
        readCommandLines("arp -an", lines);
        readCommandLines("arp -a", lines);
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
                    String ip = extractIpv4(line);
                    if (ip != null) {
                        return ip;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private String readPrimaryIpFromInterfaces() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface nic = interfaces.nextElement();
                try {
                    if (!nic.isUp() || nic.isLoopback() || nic.isVirtual()) {
                        continue;
                    }
                } catch (Exception ignored) {
                    continue;
                }

                Enumeration<InetAddress> addresses = nic.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address ipv4
                            && !ipv4.isLoopbackAddress()
                            && !ipv4.isLinkLocalAddress()) {
                        return ipv4.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private String readGatewayFromCommand(String command) {
        try {
            Process process = new ProcessBuilder("sh", "-c", command).start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String gateway = extractGatewayFromLine(line);
                    if (gateway != null) {
                        return gateway;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private String extractGatewayFromLine(String line) {
        if (line == null || line.isBlank()) {
            return null;
        }

        String lower = line.toLowerCase(Locale.ROOT);

        if (lower.contains("gateway:")) {
            String gateway = extractIpAfterToken(line, "gateway:");
            if (gateway != null) {
                return gateway;
            }
        }

        if (lower.contains(" via ")) {
            String gateway = extractIpAfterToken(line, "via");
            if (gateway != null) {
                return gateway;
            }
        }

        if (lower.startsWith("default") || lower.contains("0.0.0.0")) {
            List<String> ips = extractAllIpv4(line);
            for (String ip : ips) {
                if (!"0.0.0.0".equals(ip)) {
                    return ip;
                }
            }
        }

        return null;
    }

    private String extractIpAfterToken(String line, String token) {
        if (line == null) {
            return null;
        }

        int index = line.toLowerCase(Locale.ROOT).indexOf(token.toLowerCase(Locale.ROOT));
        if (index < 0) {
            return null;
        }

        String tail = line.substring(index + token.length());
        return extractIpv4(tail);
    }

    private String extractIpv4(String text) {
        Matcher matcher = IPV4_PATTERN.matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    private List<String> extractAllIpv4(String text) {
        List<String> ips = new ArrayList<>();
        Matcher matcher = IPV4_PATTERN.matcher(text);
        while (matcher.find()) {
            ips.add(matcher.group(1));
        }
        return ips;
    }

    private String extractMac(String line) {
        Matcher matcher = MAC_PATTERN.matcher(line);
        if (matcher.find()) {
            return normalizeMac(matcher.group(1));
        }
        return null;
    }

    private String normalizeMac(String mac) {
        return mac.replace('-', ':').toLowerCase(Locale.ROOT);
    }

    private String guessGatewayFromCurrentIp(String currentIp) {
        if (currentIp == null || !currentIp.contains(".")) {
            return null;
        }

        String[] parts = currentIp.split("\\.");
        if (parts.length < 3) {
            return null;
        }

        return parts[0] + "." + parts[1] + "." + parts[2] + ".1";
    }
}
