import { useEffect, useState } from "preact/hooks";
import { Cloud, CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { getAuthenticatedSync } from "../auth/sync.ts";
import { isHttpApiMode } from "../api/httpAppApi.ts";
import type { SyncProgressState } from "../../shared/sync.types.ts";
import "./SyncStatusBadge.css";

export function SyncStatusBadge() {
  const httpMode = isHttpApiMode();
  const [syncState, setSyncState] = useState<SyncProgressState | null>(null);
  const [busy, setBusy] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (httpMode) return;
    let cancelled = false;

    async function loadStatus() {
      try {
        const state = await getAuthenticatedSync().getStatus();
        if (!cancelled) setSyncState(state);
      } catch {
        // Ignored if API not ready
      }
    }

    void loadStatus();
    const interval = setInterval(loadStatus, 10_000);

    const unsubscribe = getAuthenticatedSync().onStatusChanged((state) => {
      if (!cancelled) setSyncState(state);
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [httpMode]);

  if (httpMode) {
    return (
      <div class="sync-badge-container">
        <span class="sync-badge sync-badge--online" title="Thin client — shared Postgres API">
          <Cloud size={14} class="sync-badge-icon" />
          <span class="sync-badge-text">API</span>
        </span>
      </div>
    );
  }

  async function handleSyncNow(e: MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await getAuthenticatedSync().triggerNow();
      if (res.ok) {
        setMessage("Synced successfully");
      } else {
        setMessage(res.message || "Sync failed");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!syncState) return null;

  const isSyncing = syncState.isSyncing || busy;
  const isOnline = syncState.isOnline;
  const pendingCount = syncState.pendingCount;
  const failedCount = syncState.failedCount;

  let badgeClass = "sync-badge--offline";
  let Icon = CloudOff;
  let statusText = "Offline";

  if (isSyncing) {
    badgeClass = "sync-badge--syncing";
    Icon = RefreshCw;
    statusText = "Syncing...";
  } else if (failedCount > 0) {
    badgeClass = "sync-badge--error";
    Icon = AlertTriangle;
    statusText = `${failedCount} error${failedCount > 1 ? "s" : ""}`;
  } else if (isOnline) {
    badgeClass = "sync-badge--online";
    Icon = Cloud;
    statusText =
      pendingCount > 0 ? `${pendingCount} pending` : "Online";
  } else {
    statusText = syncState.syncServerUrl?.trim()
      ? "Server offline"
      : "Offline";
  }

  return (
    <div class="sync-badge-container">
      <button
        type="button"
        class={`sync-badge ${badgeClass}`}
        onClick={() => setPopoverOpen(!popoverOpen)}
        title={`Sync status: ${statusText}. Click for details.`}
      >
        <Icon size={14} class={`sync-badge-icon ${isSyncing ? "is-spinning" : ""}`} />
        <span class="sync-badge-text">{statusText}</span>
      </button>

      {popoverOpen ? (
        <>
          <div class="sync-popover-backdrop" onClick={() => setPopoverOpen(false)} />
          <div class="sync-popover">
            <div class="sync-popover-header">
              <span class="sync-popover-title">PostgreSQL Cloud Sync</span>
              <span class={`sync-popover-status-pill ${badgeClass}`}>{statusText}</span>
            </div>

            <div class="sync-popover-body">
              <div class="sync-popover-row">
                <span class="sync-popover-label">Connection:</span>
                <span class="sync-popover-val">
                  {isOnline
                    ? "Online (Connected)"
                    : syncState.syncServerUrl?.trim()
                      ? "Offline — mutations disabled"
                      : "Offline (no server configured)"}
                </span>
              </div>

              <div class="sync-popover-row">
                <span class="sync-popover-label">Pending Outbox:</span>
                <span class="sync-popover-val">{pendingCount} transactions</span>
              </div>

              <div class="sync-popover-row">
                <span class="sync-popover-label">Last Upload:</span>
                <span class="sync-popover-val">
                  {syncState.lastPushedAt
                    ? new Date(syncState.lastPushedAt).toLocaleTimeString()
                    : "Never"}
                </span>
              </div>

              <div class="sync-popover-row">
                <span class="sync-popover-label">Last Download:</span>
                <span class="sync-popover-val">
                  {syncState.lastPulledAt
                    ? new Date(syncState.lastPulledAt).toLocaleTimeString()
                    : "Never"}
                </span>
              </div>

              {syncState.lastError ? (
                <div class="sync-popover-error">
                  <strong>Error:</strong> {syncState.lastError}
                </div>
              ) : null}

              {message ? (
                <div class="sync-popover-message">{message}</div>
              ) : null}
            </div>

            <div class="sync-popover-actions">
              <button
                type="button"
                class="sync-popover-btn primary"
                disabled={isSyncing || !isOnline}
                onClick={handleSyncNow}
              >
                {isSyncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                type="button"
                class="sync-popover-btn"
                onClick={() => setPopoverOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
