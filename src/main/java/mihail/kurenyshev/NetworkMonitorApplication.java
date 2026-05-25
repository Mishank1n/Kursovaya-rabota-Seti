package mihail.kurenyshev;

import mihail.kurenyshev.service.NetworkScanService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class NetworkMonitorApplication {

    public static void main(String[] args) {
        SpringApplication.run(NetworkMonitorApplication.class, args);
    }

    @Bean
    CommandLineRunner init(NetworkScanService scanService) {
        return args -> {
            if (scanService.isStartupEnabled()) {
                scanService.scanNow();
            }
        };
    }
}
