import type Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { getDatabase } from "../db/index.js";
import { quoteIdentifier } from "../db/tableMeta.js";
import {
  backfillOutboxAllTransactions,
  cleanupOldSyncedItems,
  collectMasterDataForBootstrap,
  getPendingOutboxBatch,
  getSyncPendingCount,
  getSyncState,
  markOutboxItemFailed,
  markOutboxItemsSynced,
  updateSyncState,
} from "./syncOutbox.js";
import { NetworkMonitor } from "./networkMonitor.js";
import type {
  SyncBackfillResult,
  SyncConnectionStatus,
  SyncProgressState,
  SyncPullDelta,
  SyncPushBatch,
  SyncPushResult,
  SyncStateConfig,
  TestConnectionResult,
} from "../../shared/sync.types.js";

function isIdempotentPushConflict(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) {
    return false;
  }
  return /duplicate key|unique constraint|already exists/i.test(errorMessage);
}

function upsertTableRows(
  db: Database.Database,
  tableName: string,
  pkColumns: string[],
  rows: Record<string, unknown>[],
): number {
  if (!rows || rows.length === 0) return 0;

  const cols = Object.keys(rows[0]);
  const colNames = cols.map(quoteIdentifier).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  const updateCols = cols.filter((c) => !pkColumns.includes(c));
  const updateClause =
    updateCols.length > 0
      ? `UPDATE SET ${updateCols.map((c) => `${quoteIdentifier(c)} = excluded.${quoteIdentifier(c)}`).join(", ")}`
      : `NOTHING`;
  const pkClause = pkColumns.map(quoteIdentifier).join(", ");

  const sql = `
    INSERT INTO ${quoteIdentifier(tableName)} (${colNames})
    VALUES (${placeholders})
    ON CONFLICT (${pkClause}) DO ${updateClause}
  `;

  const stmt = db.prepare(sql);
  let count = 0;
  for (const row of rows) {
    const values = cols.map((c) => {
      const val = row[c];
      if (val === undefined || val === null) return null;
      if (typeof val === "boolean") return val ? 1 : 0;
      if (val instanceof Date) return val.toISOString();
      if (typeof val === "object") return JSON.stringify(val);
      return val;
    });
    stmt.run(...values);
    count++;
  }
  return count;
}

export class SyncService extends EventEmitter {
  private networkMonitor: NetworkMonitor;
  private isSyncing = false;
  private autoSyncInterval: NodeJS.Timeout | null = null;
  private lastError: string | null = null;

  constructor() {
    super();
    this.networkMonitor = new NetworkMonitor();
  }

  public init(): void {
    const db = getDatabase();
    const state = getSyncState(db);
    this.networkMonitor.setServerUrl(state.syncServerUrl);
    this.networkMonitor.startPolling(30_000);

    this.networkMonitor.on("online", () => {
      this.emitStatus();
      if (state.autoSyncEnabled) {
        void this.syncNow();
      }
    });

    this.networkMonitor.on("offline", () => {
      this.emitStatus();
    });

    if (state.autoSyncEnabled) {
      this.startAutoSync();
    }
  }

  public startAutoSync(intervalMs = 120_000): void {
    this.stopAutoSync();
    this.autoSyncInterval = setInterval(() => {
      const db = getDatabase();
      const state = getSyncState(db);
      if (state.autoSyncEnabled && this.networkMonitor.getOnlineStatus()) {
        void this.syncNow();
      }
    }, intervalMs);
  }

  public stopAutoSync(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
  }

  public getStatus(): SyncProgressState {
    const db = getDatabase();
    const state = getSyncState(db);
    const { pendingCount, failedCount } = getSyncPendingCount(db);
    const isOnline = this.networkMonitor.getOnlineStatus();

    let status: SyncConnectionStatus = "OFFLINE";
    if (this.isSyncing) {
      status = "SYNCING";
    } else if (this.lastError && failedCount > 0) {
      status = "ERROR";
    } else if (isOnline) {
      status = "ONLINE";
    }

    return {
      status,
      isOnline,
      isSyncing: this.isSyncing,
      pendingCount,
      failedCount,
      lastPushedAt: state.lastPushedAt,
      lastPulledAt: state.lastPulledAt,
      lastError: this.lastError,
      syncServerUrl: state.syncServerUrl,
      deviceId: state.deviceId,
    };
  }

  public emitStatus(): void {
    this.emit("statusChanged", this.getStatus());
  }

  public async testConnection(
    serverUrl?: string,
  ): Promise<TestConnectionResult> {
    const db = getDatabase();
    const state = getSyncState(db);
    const targetUrl = (serverUrl || state.syncServerUrl).trim();

    const tempMonitor = new NetworkMonitor(targetUrl);
    const result = await tempMonitor.checkHealth(5000);
    return {
      ok: result.ok,
      latencyMs: result.latencyMs,
      serverVersion: result.serverVersion,
      error: result.error,
    };
  }

  public async syncNow(): Promise<{ ok: boolean; message?: string }> {
    if (this.isSyncing) {
      return { ok: false, message: "Sync is already in progress." };
    }

    const db = getDatabase();
    const state = getSyncState(db);

    const health = await this.networkMonitor.checkHealth(4000);
    if (!health.ok) {
      this.lastError = health.error ?? "Cannot reach sync server.";
      this.emitStatus();
      return { ok: false, message: this.lastError };
    }

    this.isSyncing = true;
    this.lastError = null;
    this.emitStatus();

    try {
      // 1. PUSH STEP (push all PENDING + FAILED batches until empty)
      let pushedAny = false;
      while (true) {
        const counts = getSyncPendingCount(db);
        if (counts.pendingCount + counts.failedCount === 0) break;
        await this.pushPendingBatch(db, state);
        pushedAny = true;
        this.emitStatus();
      }

      // 2. PULL STEP
      await this.pullServerDelta(db, state);

      cleanupOldSyncedItems(db, 7);
      this.lastError = null;
      return { ok: true, message: pushedAny ? "Sync completed successfully." : "Everything is up to date." };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      return { ok: false, message: msg };
    } finally {
      this.isSyncing = false;
      this.emitStatus();
    }
  }

  public async backfillAllData(): Promise<SyncBackfillResult> {
    if (this.isSyncing) {
      return {
        ok: false,
        message: "Sync is already in progress.",
        enqueuedCount: 0,
        summary: {},
      };
    }

    const db = getDatabase();
    const state = getSyncState(db);

    const health = await this.networkMonitor.checkHealth(4000);
    if (!health.ok) {
      return {
        ok: false,
        message: `Cannot reach sync server: ${health.error || "Offline"}`,
        enqueuedCount: 0,
        summary: {},
      };
    }

    this.isSyncing = true;
    this.lastError = null;
    this.emitStatus();

    try {
      // 1. Bootstrap master reference data to PostgreSQL first (ensures foreign keys exist)
      let masterSummary: Record<string, number> = {};
      const masterData = collectMasterDataForBootstrap(db);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (state.apiToken) {
        headers.Authorization = `Bearer ${state.apiToken}`;
      }

      const bootstrapRes = await fetch(`${state.syncServerUrl}/api/sync/bootstrap-master`, {
        method: "POST",
        headers,
        body: JSON.stringify(masterData),
        signal: AbortSignal.timeout(60_000),
      });

      if (bootstrapRes.ok) {
        const bData = (await bootstrapRes.json().catch(() => ({}))) as {
          summary?: Record<string, number>;
        };
        masterSummary = bData.summary || {};
      } else {
        const errText = await bootstrapRes.text().catch(() => "");
        console.warn(`Master bootstrap warning (HTTP ${bootstrapRes.status}): ${errText}`);
      }

      // 2. Enqueue all existing transactional data into SyncOutbox
      const { enqueuedCount, summary } = backfillOutboxAllTransactions(db);
      this.emitStatus();

      // 3. Immediately flush all PENDING + FAILED outbox records to PostgreSQL
      while (true) {
        const counts = getSyncPendingCount(db);
        if (counts.pendingCount + counts.failedCount === 0) break;
        await this.pushPendingBatch(db, state);
        this.emitStatus();
      }

      // 4. Run pull to refresh lastPulledAt
      await this.pullServerDelta(db, state);

      cleanupOldSyncedItems(db, 7);
      return {
        ok: true,
        message: `Successfully backfilled and synchronized ${enqueuedCount} records to PostgreSQL.`,
        enqueuedCount,
        summary,
        masterSummary,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      return {
        ok: false,
        message: msg,
        enqueuedCount: 0,
        summary: {},
      };
    } finally {
      this.isSyncing = false;
      this.emitStatus();
    }
  }

  private async pushPendingBatch(
    db: Database.Database,
    state: SyncStateConfig,
  ): Promise<void> {
    const batch = getPendingOutboxBatch(db, 100);
    if (batch.length === 0) {
      return;
    }

    const payloadItems = batch.map((item) => ({
      outboxId: item.id,
      entityType: item.entityType,
      entityId: item.entityId,
      action: item.action,
      payload: JSON.parse(item.payloadJson) as Record<string, unknown>,
      createdAt: item.createdAt,
    }));

    const pushBatch: SyncPushBatch = {
      deviceId: state.deviceId,
      salesPointId: state.salesPointId,
      clientTime: new Date().toISOString(),
      items: payloadItems,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (state.apiToken) {
      headers.Authorization = `Bearer ${state.apiToken}`;
    }

    const response = await fetch(`${state.syncServerUrl}/api/sync/push`, {
      method: "POST",
      headers,
      body: JSON.stringify(pushBatch),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Push failed (HTTP ${response.status}): ${errText}`);
    }

    const result = (await response.json()) as SyncPushResult;

    if (result.committedIds?.length > 0) {
      markOutboxItemsSynced(db, result.committedIds);
    }

    if (result.errors && result.errors.length > 0) {
      const duplicateIds: number[] = [];
      const realErrors: typeof result.errors = [];
      for (const err of result.errors) {
        // Server already has the row (e.g. receipt_no unique). Treat as synced
        // so auto-sync stops retrying and flooding the console.
        if (isIdempotentPushConflict(err.error)) {
          duplicateIds.push(err.outboxId);
        } else {
          markOutboxItemFailed(db, err.outboxId, err.error);
          realErrors.push(err);
        }
      }
      if (duplicateIds.length > 0) {
        markOutboxItemsSynced(db, duplicateIds);
      }
      if (realErrors.length > 0) {
        console.error("Push batch item errors:", realErrors);
        const firstErr =
          realErrors[0]?.error || "Server rejected item in push batch.";
        throw new Error(`Push batch error: ${firstErr}`);
      }
    }

    if (!result.ok) {
      throw new Error("Server rejected push batch.");
    }

    const now = new Date().toISOString();
    updateSyncState(db, { lastPushedAt: now });
  }

  private async pullServerDelta(
    db: Database.Database,
    state: SyncStateConfig,
  ): Promise<void> {
    const url = new URL(`${state.syncServerUrl}/api/sync/pull`);
    if (state.lastPulledAt) {
      url.searchParams.set("since", state.lastPulledAt);
    }
    url.searchParams.set("deviceId", state.deviceId);
    if (state.salesPointId) {
      url.searchParams.set("salesPointId", String(state.salesPointId));
    }

    const headers: Record<string, string> = {};
    if (state.apiToken) {
      headers.Authorization = `Bearer ${state.apiToken}`;
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Pull failed (HTTP ${response.status}): ${errText}`);
    }

    const delta = (await response.json()) as SyncPullDelta;
    if (!delta.serverTime) {
      throw new Error("Invalid pull response from server (missing serverTime).");
    }

    // Apply delta in an atomic SQLite transaction
    const applyTx = db.transaction(() => {
      if (delta.productCategories?.length) {
        upsertTableRows(db, "ProductCat", ["productCatId"], delta.productCategories);
      }
      if (delta.products?.length) {
        upsertTableRows(db, "Product", ["productId"], delta.products);
      }
      if (delta.productUnitPrices?.length) {
        upsertTableRows(db, "ProductUnitPriceSchedule", ["id"], delta.productUnitPrices);
      }
      if (delta.customerTypes?.length) {
        upsertTableRows(db, "CustomerTypeDefinition", ["id"], delta.customerTypes);
      }
      if (delta.customers?.length) {
        upsertTableRows(db, "Customer", ["id"], delta.customers);
      }
      if (delta.taxRegimes?.length) {
        upsertTableRows(db, "TaxRegime", ["id"], delta.taxRegimes);
      }
      if (delta.taxRateSchedules?.length) {
        upsertTableRows(db, "TaxRateSchedule", ["id"], delta.taxRateSchedules);
      }
      if (delta.paymentMethods?.length) {
        upsertTableRows(db, "PaymentMethodDefinition", ["id"], delta.paymentMethods);
      }
      if (delta.salesPoints?.length) {
        upsertTableRows(db, "SalesPoint", ["id"], delta.salesPoints);
      }
      if (delta.locations?.length) {
        upsertTableRows(db, "Location", ["id"], delta.locations);
      }
      if (delta.storageLocations?.length) {
        upsertTableRows(db, "StorageLocation", ["id"], delta.storageLocations);
      }
      if (delta.roles?.length) {
        upsertTableRows(db, "Role", ["id"], delta.roles);
      }
      if (delta.users?.length) {
        upsertTableRows(db, "User", ["id"], delta.users);
      }
      if (delta.roleRoutePermissions?.length) {
        upsertTableRows(db, "RoleRoutePermission", ["role", "routeId"], delta.roleRoutePermissions);
      }
      if (delta.roleActionPermissions?.length) {
        upsertTableRows(db, "RoleActionPermission", ["role", "actionKey"], delta.roleActionPermissions);
      }
      if (delta.companySettings) {
        // Theme is owned by the local admin toggle. Sync must not clobber it
        // with a stale server value (CompanySettings theme is not pushed via outbox).
        const localTheme = db
          .prepare(
            `SELECT uiThemePreset FROM CompanySettings WHERE id = 'default'`,
          )
          .get() as { uiThemePreset?: string } | undefined;
        const incoming: Record<string, unknown> = { ...delta.companySettings };
        if (
          localTheme?.uiThemePreset === "agro" ||
          localTheme?.uiThemePreset === "dark"
        ) {
          incoming.uiThemePreset = localTheme.uiThemePreset;
        }
        upsertTableRows(db, "CompanySettings", ["id"], [incoming]);
      }
      if (delta.documentBooklets?.length) {
        upsertTableRows(db, "DocumentBooklet", ["id"], delta.documentBooklets);
      }

      updateSyncState(db, { lastPulledAt: delta.serverTime });
    });

    applyTx();
  }
}

let syncServiceInstance: SyncService | null = null;

export function getSyncService(): SyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new SyncService();
  }
  return syncServiceInstance;
}
