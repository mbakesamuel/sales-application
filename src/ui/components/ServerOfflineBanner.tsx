import { useServerConnectivity } from "../hooks/useServerConnectivity.ts";
import "./ServerOfflineBanner.css";

export function ServerOfflineBanner() {
  const { mutationsBlocked } = useServerConnectivity();

  if (!mutationsBlocked) {
    return null;
  }

  return (
    <div class="server-offline-banner" role="status">
      Server unreachable — saving sales, delivery orders, and stock is disabled
      until the connection is restored.
    </div>
  );
}
