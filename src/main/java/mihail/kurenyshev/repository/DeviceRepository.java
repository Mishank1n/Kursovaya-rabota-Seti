package mihail.kurenyshev.repository;


import mihail.kurenyshev.entity.NetworkDevice;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DeviceRepository extends JpaRepository<NetworkDevice, Long> {
    Optional<NetworkDevice> findByIpAddress(String ipAddress);
}
