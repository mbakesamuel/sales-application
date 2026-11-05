import { useEffect, useState } from "preact/hooks";
import { getAuthenticatedSync } from "../auth/sync.ts";
import { isHttpApiMode } from "../api/httpAppApi.ts";
import type { SyncProgressState } from "../../shared/sync.types.ts";

export type ServerConnectivity = {
  /** True when a sync/command server URL is configured. */
  commandApiConfigured: boolean;
  isOnline: boolean;
  /** Mutations should be blocked when the command API is configured but offline. */
  mutationsBlocked: boolean;
  status: SyncProgressState | null;
};

/**
 * Tracks sync/command-server reachability for online-only mutation gates.
 * In HTTP thin-client mode the shared API is always the source of truth.
 */
export function useServerConnectivity(): ServerConnectivity {
  const httpMode = isHttpApiMode();
  const [status, setStatus] = useState<SyncProgressState | null>(null);

  useEffect(() => {
    if (httpMode) {
      setStatus({
        status: "ONLINE",
        isOnline: true,
        isSyncing: false,
        pendingCount: 0,
        failedCount: 0,
        lastPushedAt: null,
        lastPulledAt: null,
        lastError: null,
        syncServerUrl: "",
        deviceId: "thin-client",
      });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const next = await getAuthenticatedSync().getStatus();
        if (!cancelled) setStatus(next);
      } catch {
        // API may not be ready during bootstrap.
      }
    }

    void load();
    const interval = setInterval(load, 10_000);
    const unsubscribe = getAuthenticatedSync().onStatusChanged((next) => {
      if (!cancelled) setStatus(next);
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [httpMode]);

  if (httpMode) {
    return {
      commandApiConfigured: true,
      isOnline: true,
      mutationsBlocked: false,
      status,
    };
  }

  const commandApiConfigured = Boolean(status?.syncServerUrl?.trim());
  const isOnline = Boolean(status?.isOnline);
  const mutationsBlocked = commandApiConfigured && !isOnline;

  return {
    commandApiConfigured,
    isOnline,
    mutationsBlocked,
    status,
  };
}
