/** Thin-client sync stubs — no SQLite outbox; API is always the source of truth. */

export function thinClientSyncStatus() {
  const now = new Date().toISOString();
  return {
    status: "ONLINE" as const,
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    failedCount: 0,
    lastPushedAt: now,
    lastPulledAt: now,
    lastError: null,
    syncServerUrl: "http://localhost (thin client)",
    deviceId: "thin-client",
  };
}

export function thinClientSyncConfig() {
  return {
    id: "default",
    syncServerUrl: "",
    apiToken: null,
    salesPointId: null,
    deviceId: "thin-client",
    lastPulledAt: null,
    lastPushedAt: null,
    autoSyncEnabled: false,
  };
}
