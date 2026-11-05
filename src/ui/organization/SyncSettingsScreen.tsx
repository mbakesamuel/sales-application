import { useCallback, useEffect, useState } from "preact/hooks";
import { Cloud, RefreshCw, CheckCircle, AlertTriangle, Send, UploadCloud } from "lucide-react";
import type {
  SyncOutboxItem,
  SyncProgressState,
  SyncStateConfig,
} from "../../shared/sync.types.ts";
import { formatDisplayDateTime } from "../../shared/formatDisplayDate.ts";
import { getAuthenticatedSync } from "../auth/sync.ts";
import { isHttpApiMode } from "../api/httpAppApi.ts";
import "../company-settings/CompanySettingsScreen.css";
import "./DataBackupScreen.css";
import "./SyncSettingsScreen.css";

interface SyncSettingsScreenProps {
  readOnly?: boolean;
}

export function SyncSettingsScreen({ readOnly = false }: SyncSettingsScreenProps) {
  if (isHttpApiMode()) {
    return (
      <div class="company-settings-screen">
        <h2>Data sync (legacy)</h2>
        <p class="customers-banner customers-banner-warning">
          Thin-client mode is on (<code>VITE_API_BASE_URL</code>). The app talks
          directly to the Hono + Postgres API — device SyncOutbox settings are
          not used. Sign in against the shared server; contested ops live in
          Postgres.
        </p>
      </div>
    );
  }
  const [, setConfig] = useState<SyncStateConfig | null>(null);
  const [status, setStatus] = useState<SyncProgressState | null>(null);
  const [pendingItems, setPendingItems] = useState<SyncOutboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"sync" | "save" | "test" | "backfill" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [serverUrlDraft, setServerUrlDraft] = useState("");
  const [apiTokenDraft, setApiTokenDraft] = useState("");
  const [deviceIdDraft, setDeviceIdDraft] = useState("");
  const [autoSyncDraft, setAutoSyncDraft] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sync = getAuthenticatedSync();
      const [cfg, stat, items] = await Promise.all([
        sync.getConfig(),
        sync.getStatus(),
        sync.getPendingList(50),
      ]);
      setConfig(cfg);
      setStatus(stat);
      setPendingItems(items);

      setServerUrlDraft(cfg.syncServerUrl);
      setApiTokenDraft(cfg.apiToken || "");
      setDeviceIdDraft(cfg.deviceId);
      setAutoSyncDraft(cfg.autoSyncEnabled);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load sync configuration.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();

    // Subscribe to live status changes emitted by the background sync service
    const sync = getAuthenticatedSync();
    const unsubscribe = sync.onStatusChanged((newStatus) => {
      setStatus(newStatus);
      // If pending count changed, refresh the outbox table as well
      sync.getPendingList(50).then(setPendingItems).catch(() => {});
    });

    return () => {
      unsubscribe();
    };
  }, [reload]);

  async function handleSaveConfig(e: Event) {
    e.preventDefault();
    if (readOnly || busy) return;
    setBusy("save");
    setError(null);
    setSuccess(null);
    try {
      const res = await getAuthenticatedSync().saveConfig({
        syncServerUrl: serverUrlDraft.trim(),
        apiToken: apiTokenDraft.trim() || null,
        deviceId: deviceIdDraft.trim(),
        autoSyncEnabled: autoSyncDraft,
      });
      if (res.ok) {
        setSuccess("Sync configuration saved successfully.");
        await reload();
      } else {
        setError(res.error || "Failed to save configuration.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error saving config.");
    } finally {
      setBusy(null);
    }
  }

  async function handleTestConnection() {
    if (busy) return;
    setBusy("test");
    setTestResult(null);
    setError(null);
    try {
      const res = await getAuthenticatedSync().testConnection(serverUrlDraft.trim());
      if (res.ok) {
        setTestResult(
          `Connected successfully (${res.latencyMs}ms). Server version: ${res.serverVersion || "1.0.0"}`,
        );
      } else {
        setError(`Connection failed: ${res.error || "Unknown error"}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection test failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSyncNow() {
    if (busy) return;
    setBusy("sync");
    setError(null);
    setSuccess(null);
    try {
      const res = await getAuthenticatedSync().triggerNow();
      if (res.ok) {
        setSuccess("Sync completed successfully.");
        await reload();
      } else {
        setError(res.message || "Sync encountered errors.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sync error.");
    } finally {
      setBusy(null);
    }
  }

  async function handleBackfillAllData() {
    if (readOnly || busy) return;
    const confirmed = window.confirm(
      "Upload all existing local records to PostgreSQL?\n\n" +
      "This will scan all local customers, sales, delivery orders, stock documents, and booklets, " +
      "bootstrap master reference data, and synchronize any historical records to the central database.\n\n" +
      "This operation is safe and will not create duplicates.",
    );
    if (!confirmed) return;

    setBusy("backfill");
    setError(null);
    setSuccess(null);
    try {
      const res = await getAuthenticatedSync().backfillAllData();
      if (res.ok) {
        setSuccess(res.message || "All records synchronized to PostgreSQL successfully.");
        await reload();
      } else {
        setError(res.message || "Failed to synchronize existing records.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error running full synchronization.");
    } finally {
      setBusy(null);
    }
  }

  const isOnline = Boolean(status?.isOnline);
  const statusKind = (status?.status || "OFFLINE").toLowerCase();

  return (
    <div class="company-settings-screen data-backup-screen sync-settings-screen">
      <header class="company-settings-header">
        <div class="company-settings-heading">
          <Cloud size={22} aria-hidden="true" />
          <div>
            <h2>Data sync</h2>
            <p>Central PostgreSQL synchronization and offline transactional outbox</p>
          </div>
        </div>
        <div class="sync-header-actions">
          {!readOnly ? (
            <button
              type="button"
              class="company-settings-secondary-btn sync-secondary-btn"
              disabled={loading || busy !== null || !isOnline}
              onClick={handleBackfillAllData}
              title={!isOnline ? "Server is offline" : "Upload all historical and un-synced local records to PostgreSQL"}
            >
              <UploadCloud size={13} class={busy === "backfill" ? "is-spinning" : ""} />
              <span>{busy === "backfill" ? "Uploading all…" : "Upload all records"}</span>
            </button>
          ) : null}
          <button
            type="button"
            class="company-settings-primary-btn"
            disabled={loading || busy !== null || !isOnline}
            onClick={handleSyncNow}
            title={!isOnline ? "Server is offline or unreachable" : "Trigger synchronization now"}
          >
            <RefreshCw size={13} class={busy === "sync" ? "is-spinning" : ""} />
            <span>{busy === "sync" ? "Syncing…" : "Sync Now"}</span>
          </button>
        </div>
      </header>

      <div class="sync-settings-body">
        {loading ? <p class="sync-settings-note">Loading sync status and parameters…</p> : null}

        {error ? (
          <div class="sync-settings-alert error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {success ? (
          <div class="sync-settings-alert success" role="status">
            <CheckCircle size={16} aria-hidden="true" />
            <span>{success}</span>
          </div>
        ) : null}

        {testResult ? (
          <div class="sync-settings-alert success" role="status">
            <CheckCircle size={16} aria-hidden="true" />
            <span>{testResult}</span>
          </div>
        ) : null}

        <div class="sync-settings-grid">
          {/* Card 1: Connection & Live Status */}
          <section class="sync-settings-card">
            <h3>
              <span>Live status</span>
              <span class={`sync-badge-pill ${statusKind}`}>
                {status?.status || "UNKNOWN"}
              </span>
            </h3>

            <dl class="sync-settings-dl">
              <dt>Network</dt>
              <dd>
                {isOnline ? (
                  <span class="sync-badge-pill online">Online</span>
                ) : (
                  <span class="sync-badge-pill offline">Offline (Local only)</span>
                )}
              </dd>

              <dt>Pending outbox</dt>
              <dd>
                <strong>{status?.pendingCount ?? 0}</strong> transactions
                {(status?.failedCount ?? 0) > 0 ? (
                  <span class="sync-badge-pill failed">
                    {status?.failedCount} failed
                  </span>
                ) : null}
              </dd>

              <dt>Last upload</dt>
              <dd class="customers-mono-chip">
                {status?.lastPushedAt
                  ? formatDisplayDateTime(status.lastPushedAt)
                  : "Never"}
              </dd>

              <dt>Last download</dt>
              <dd class="customers-mono-chip">
                {status?.lastPulledAt
                  ? formatDisplayDateTime(status.lastPulledAt)
                  : "Never"}
              </dd>

              <dt>Device ID</dt>
              <dd class="customers-mono-chip">{status?.deviceId || "terminal-01"}</dd>
            </dl>

            <div class="sync-card-actions">
              {!readOnly ? (
                <button
                  type="button"
                  class="company-settings-secondary-btn sync-secondary-btn"
                  disabled={loading || busy !== null || !isOnline}
                  onClick={handleBackfillAllData}
                >
                  <UploadCloud size={13} class={busy === "backfill" ? "is-spinning" : ""} />
                  <span>{busy === "backfill" ? "Uploading all…" : "Upload all records"}</span>
                </button>
              ) : null}
              <button
                type="button"
                class="company-settings-primary-btn"
                disabled={loading || busy === "sync" || !isOnline}
                onClick={handleSyncNow}
              >
                <RefreshCw size={13} class={busy === "sync" ? "is-spinning" : ""} />
                <span>{busy === "sync" ? "Syncing…" : "Sync Now"}</span>
              </button>
              <button
                type="button"
                class="company-settings-secondary-btn sync-secondary-btn"
                disabled={loading || busy !== null}
                onClick={handleTestConnection}
              >
                <Send size={13} />
                <span>Test server</span>
              </button>
            </div>
          </section>

          {/* Card 2: Configuration */}
          <section class="sync-settings-card">
            <h3>
              <span>Sync parameters</span>
            </h3>

            <form onSubmit={handleSaveConfig} class="sync-form">
              <label class="company-settings-field">
                <span>Hono Central API URL</span>
                <input
                  type="text"
                  class="company-settings-input"
                  disabled={readOnly || loading}
                  placeholder="http://localhost:3001"
                  value={serverUrlDraft}
                  onInput={(e) => setServerUrlDraft((e.target as HTMLInputElement).value)}
                />
                <span class="company-settings-field-hint">
                  Endpoint of the central Hono.js + PostgreSQL server.
                </span>
              </label>

              <label class="company-settings-field">
                <span>Device API Token</span>
                <input
                  type="password"
                  class="company-settings-input"
                  disabled={readOnly || loading}
                  placeholder="sales-super-secret-key-2026"
                  value={apiTokenDraft}
                  onInput={(e) => setApiTokenDraft((e.target as HTMLInputElement).value)}
                />
                <span class="company-settings-field-hint">
                  Bearer secret matching API_SECRET_KEY or device credential.
                </span>
              </label>

              <label class="company-settings-field">
                <span>Terminal / Device identifier</span>
                <input
                  type="text"
                  class="company-settings-input"
                  disabled={readOnly || loading}
                  value={deviceIdDraft}
                  onInput={(e) => setDeviceIdDraft((e.target as HTMLInputElement).value)}
                />
              </label>

              <label class="doc-booklets-checkbox-label">
                <input
                  type="checkbox"
                  disabled={readOnly || loading}
                  checked={autoSyncDraft}
                  onChange={(e) => setAutoSyncDraft((e.target as HTMLInputElement).checked)}
                />
                <span>Enable automatic background sync every 2 minutes</span>
              </label>

              {!readOnly ? (
                <div class="sync-card-actions">
                  <button
                    type="submit"
                    class="company-settings-primary-btn"
                    disabled={loading || busy === "save"}
                  >
                    <span>{busy === "save" ? "Saving…" : "Save Settings"}</span>
                  </button>
                </div>
              ) : null}
            </form>
          </section>
        </div>

        {/* Card 3: Outbox Queue */}
        <section class="sync-settings-card">
          <h3>
            <span>Offline transaction outbox</span>
            <span class="sync-settings-note">
              {pendingItems.length} queued item{pendingItems.length === 1 ? "" : "s"}
            </span>
          </h3>

          <p class="sync-settings-note">
            Mutations recorded locally while offline or between sync cycles. Uploaded items are marked synced and pruned automatically.
          </p>

          {pendingItems.length === 0 ? (
            <div class="sync-table-empty">
              <CheckCircle size={32} style={{ color: "var(--accent)" }} />
              <div>
                <strong>Outbox is clear</strong>
                <p class="sync-settings-note" style={{ marginTop: "4px" }}>
                  All local sales, delivery orders, and stock movements are synchronized with PostgreSQL.
                </p>
              </div>
            </div>
          ) : (
            <div class="table-data-scroll sync-table-scroll">
              <table class="table-data-grid">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Entity</th>
                    <th>Entity ID</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Retries</th>
                    <th>Created</th>
                    <th>Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingItems.map((item) => {
                    const itemStatus = item.status.toLowerCase();
                    return (
                      <tr key={item.id}>
                        <td class="customers-mono-chip">{item.id}</td>
                        <td>
                          <strong>{item.entityType}</strong>
                        </td>
                        <td class="customers-mono-chip">{item.entityId}</td>
                        <td>
                          <span class="customers-badge customers-badge-sky">{item.action}</span>
                        </td>
                        <td>
                          <span class={`sync-badge-pill ${itemStatus}`}>
                            {item.status}
                          </span>
                        </td>
                        <td>{item.retryCount}</td>
                        <td class="customers-mono-chip">
                          {formatDisplayDateTime(item.createdAt)}
                        </td>
                        <td style={{ color: item.lastError ? "var(--danger)" : "var(--text-muted)" }}>
                          {item.lastError || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
