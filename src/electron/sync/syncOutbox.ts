import type Database from "better-sqlite3";
import type {
  SyncEntityType,
  SyncOutboxAction,
  SyncOutboxItem,
  SyncStateConfig,
} from "../../shared/sync.types.js";

/** Contested ops owned by the command API — never queue when a server URL is set. */
const COMMAND_API_OWNED_ENTITIES = new Set([
  "Sale",
  "DeliveryOrder",
  "StockReceipt",
  "StockTransfer",
  "StockAdjustment",
]);

export function enqueueOutboxItem(
  db: Database.Database,
  entityType: SyncEntityType | string,
  entityId: string,
  action: SyncOutboxAction,
  payload: Record<string, unknown>,
): number {
  // Online-only: sales / DO / stock writes go through the command API — do not queue.
  if (COMMAND_API_OWNED_ENTITIES.has(String(entityType))) {
    try {
      const state = getSyncState(db);
      if (state.syncServerUrl?.trim()) {
        return 0;
      }
    } catch {
      // If sync state is unavailable, fall through to enqueue.
    }
  }

  const payloadJson = JSON.stringify(payload);
  const result = db
    .prepare(
      `INSERT INTO SyncOutbox (entityType, entityId, action, payloadJson, status, createdAt)
       VALUES (?, ?, ?, ?, 'PENDING', datetime('now'))`,
    )
    .run(entityType, entityId, action, payloadJson);

  return Number(result.lastInsertRowid);
}

export function getPendingOutboxBatch(
  db: Database.Database,
  limit = 50,
): SyncOutboxItem[] {
  const rows = db
    .prepare(
      `SELECT id, entityType, entityId, action, payloadJson, status, retryCount, lastError, createdAt, syncedAt
       FROM SyncOutbox
       WHERE status IN ('PENDING', 'FAILED')
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number;
    entityType: string;
    entityId: string;
    action: string;
    payloadJson: string;
    status: string;
    retryCount: number;
    lastError: string | null;
    createdAt: string;
    syncedAt: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action as SyncOutboxAction,
    payloadJson: r.payloadJson,
    status: r.status as SyncOutboxItem["status"],
    retryCount: r.retryCount,
    lastError: r.lastError,
    createdAt: r.createdAt,
    syncedAt: r.syncedAt,
  }));
}

export function markOutboxItemsSynced(
  db: Database.Database,
  itemIds: number[],
): void {
  if (itemIds.length === 0) return;
  const placeholders = itemIds.map(() => "?").join(",");
  db.prepare(
    `UPDATE SyncOutbox
     SET status = 'SYNCED', syncedAt = datetime('now'), lastError = NULL
     WHERE id IN (${placeholders})`,
  ).run(...itemIds);
}

export function markOutboxItemFailed(
  db: Database.Database,
  itemId: number,
  errorMessage: string,
): void {
  db.prepare(
    `UPDATE SyncOutbox
     SET status = 'FAILED', retryCount = retryCount + 1, lastError = ?
     WHERE id = ?`,
  ).run(errorMessage, itemId);
}

export function cleanupOldSyncedItems(
  db: Database.Database,
  daysOld = 7,
): void {
  db.prepare(
    `DELETE FROM SyncOutbox
     WHERE status = 'SYNCED' AND syncedAt < datetime('now', '-' || ? || ' days')`,
  ).run(daysOld);
}

/** Entity types cleared by operational wipe — remove so they are not re-pushed. */
const OPERATIONAL_OUTBOX_ENTITY_TYPES = [
  "Sale",
  "DeliveryOrder",
  "StockReceipt",
  "StockTransfer",
  "StockAdjustment",
  "Payment",
] as const;

export function pruneOperationalOutboxItems(db: Database.Database): number {
  const placeholders = OPERATIONAL_OUTBOX_ENTITY_TYPES.map(() => "?").join(
    ",",
  );
  const result = db
    .prepare(
      `DELETE FROM SyncOutbox
       WHERE entityType IN (${placeholders})`,
    )
    .run(...OPERATIONAL_OUTBOX_ENTITY_TYPES);
  return result.changes;
}

export function getSyncState(db: Database.Database): SyncStateConfig {
  const row = db
    .prepare(
      `SELECT id, syncServerUrl, apiToken, salesPointId, deviceId, lastPulledAt, lastPushedAt, autoSyncEnabled
       FROM SyncState
       WHERE id = 'default'
       LIMIT 1`,
    )
    .get() as
    | {
        id: string;
        syncServerUrl: string;
        apiToken: string | null;
        salesPointId: number | null;
        deviceId: string;
        lastPulledAt: string | null;
        lastPushedAt: string | null;
        autoSyncEnabled: number;
      }
    | undefined;

  if (!row) {
    return {
      id: "default",
      syncServerUrl: "http://localhost:3001",
      apiToken: null,
      salesPointId: null,
      deviceId: "term-default",
      lastPulledAt: null,
      lastPushedAt: null,
      autoSyncEnabled: true,
    };
  }

  return {
    id: row.id,
    syncServerUrl: row.syncServerUrl,
    apiToken: row.apiToken,
    salesPointId: row.salesPointId,
    deviceId: row.deviceId,
    lastPulledAt: row.lastPulledAt,
    lastPushedAt: row.lastPushedAt,
    autoSyncEnabled: row.autoSyncEnabled === 1,
  };
}

export function updateSyncState(
  db: Database.Database,
  update: Partial<SyncStateConfig>,
): void {
  const current = getSyncState(db);
  const next = { ...current, ...update };

  db.prepare(
    `INSERT INTO SyncState (id, syncServerUrl, apiToken, salesPointId, deviceId, lastPulledAt, lastPushedAt, autoSyncEnabled, updatedAt)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       syncServerUrl = excluded.syncServerUrl,
       apiToken = excluded.apiToken,
       salesPointId = excluded.salesPointId,
       deviceId = excluded.deviceId,
       lastPulledAt = excluded.lastPulledAt,
       lastPushedAt = excluded.lastPushedAt,
       autoSyncEnabled = excluded.autoSyncEnabled,
       updatedAt = datetime('now')`,
  ).run(
    next.syncServerUrl,
    next.apiToken,
    next.salesPointId,
    next.deviceId,
    next.lastPulledAt,
    next.lastPushedAt,
    next.autoSyncEnabled ? 1 : 0,
  );
}

export function getSyncPendingCount(db: Database.Database): {
  pendingCount: number;
  failedCount: number;
} {
  const row = db
    .prepare(
      `SELECT
         COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pendingCount,
         COUNT(CASE WHEN status = 'FAILED' THEN 1 END) AS failedCount
       FROM SyncOutbox`,
    )
    .get() as { pendingCount: number; failedCount: number } | undefined;

  return {
    pendingCount: row?.pendingCount ?? 0,
    failedCount: row?.failedCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

export function serializeSaleForSync(
  db: Database.Database,
  saleId: string,
): Record<string, unknown> | null {
  const sale = db.prepare(`SELECT * FROM Sale WHERE id = ?`).get(saleId) as
    | Record<string, unknown>
    | undefined;
  if (!sale) return null;

  const lines = db
    .prepare(`SELECT * FROM SaleLine WHERE saleId = ? ORDER BY id ASC`)
    .all(saleId) as Record<string, unknown>[];

  const taxes = db
    .prepare(`SELECT * FROM SaleAppliedTax WHERE saleId = ? ORDER BY id ASC`)
    .all(saleId) as Record<string, unknown>[];

  const payments = db
    .prepare(`SELECT * FROM Payment WHERE saleId = ? ORDER BY id ASC`)
    .all(saleId) as Record<string, unknown>[];

  return {
    ...sale,
    lines,
    taxes,
    payments,
  };
}

export function serializeDeliveryOrderForSync(
  db: Database.Database,
  deliveryOrderId: number,
): Record<string, unknown> | null {
  const order = db
    .prepare(`SELECT * FROM DeliveryOrder WHERE id = ?`)
    .get(deliveryOrderId) as Record<string, unknown> | undefined;
  if (!order) return null;

  const details = db
    .prepare(
      `SELECT * FROM DeliveryOrderDetails WHERE deliveryOrderId = ? ORDER BY id ASC`,
    )
    .all(deliveryOrderId) as Record<string, unknown>[];

  const paymentDetails = db
    .prepare(
      `SELECT * FROM DeliveryOrderPaymentDetails WHERE deliveryOrderId = ? ORDER BY id ASC`,
    )
    .all(deliveryOrderId) as Record<string, unknown>[];

  return {
    ...order,
    details,
    paymentDetails,
  };
}

export function serializeStockReceiptForSync(
  db: Database.Database,
  receiptId: string,
): Record<string, unknown> | null {
  const receipt = db
    .prepare(`SELECT * FROM StockReceipt WHERE id = ?`)
    .get(receiptId) as Record<string, unknown> | undefined;
  if (!receipt) return null;

  const lines = db
    .prepare(`SELECT * FROM StockReceiptLine WHERE receiptId = ? ORDER BY id ASC`)
    .all(receiptId) as Record<string, unknown>[];

  const movements = db
    .prepare(
      `SELECT * FROM StockMovement WHERE sourceKind = 'RECEIPT' AND sourceId = ?`,
    )
    .all(receiptId) as Record<string, unknown>[];

  return {
    ...receipt,
    lines,
    movements,
  };
}

export function serializeStockTransferForSync(
  db: Database.Database,
  transferId: string,
): Record<string, unknown> | null {
  const transfer = db
    .prepare(`SELECT * FROM StockTransfer WHERE id = ?`)
    .get(transferId) as Record<string, unknown> | undefined;
  if (!transfer) return null;

  const lines = db
    .prepare(`SELECT * FROM StockTransferLine WHERE transferId = ? ORDER BY id ASC`)
    .all(transferId) as Record<string, unknown>[];

  const movements = db
    .prepare(
      `SELECT * FROM StockMovement WHERE sourceKind = 'TRANSFER' AND sourceId = ?`,
    )
    .all(transferId) as Record<string, unknown>[];

  return {
    ...transfer,
    lines,
    movements,
  };
}

export function serializeStockAdjustmentForSync(
  db: Database.Database,
  adjustmentId: string,
): Record<string, unknown> | null {
  const adjustment = db
    .prepare(`SELECT * FROM StockAdjustment WHERE id = ?`)
    .get(adjustmentId) as Record<string, unknown> | undefined;
  if (!adjustment) return null;

  const lines = db
    .prepare(
      `SELECT * FROM StockAdjustmentLine WHERE adjustmentId = ? ORDER BY id ASC`,
    )
    .all(adjustmentId) as Record<string, unknown>[];

  const movements = db
    .prepare(
      `SELECT * FROM StockMovement WHERE sourceKind = 'ADJUSTMENT' AND sourceId = ?`,
    )
    .all(adjustmentId) as Record<string, unknown>[];

  return {
    ...adjustment,
    lines,
    movements,
  };
}

export function serializeCustomerForSync(
  db: Database.Database,
  customerId: number,
): Record<string, unknown> | null {
  const customer = db
    .prepare(`SELECT * FROM Customer WHERE id = ?`)
    .get(customerId) as Record<string, unknown> | undefined;
  return customer ?? null;
}

// ---------------------------------------------------------------------------
// Initial Sync / Backfill Helpers
// ---------------------------------------------------------------------------

export function collectMasterDataForBootstrap(
  db: Database.Database,
): Record<string, unknown[]> {
  const getRows = (table: string): Record<string, unknown>[] => {
    try {
      const has = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table);
      if (!has) return [];
      return db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
    } catch {
      return [];
    }
  };

  return {
    companySettings: getRows("CompanySettings"),
    roles: getRows("Role"),
    salesPoints: getRows("SalesPoint"),
    locations: getRows("Location"),
    storageLocations: getRows("StorageLocation"),
    commercialServices: getRows("CommercialService"),
    productCats: getRows("ProductCat"),
    customerTypeDefinitions: getRows("CustomerTypeDefinition"),
    products: getRows("Product"),
    productUnitPriceSchedules: getRows("ProductUnitPriceSchedule"),
    taxRegimes: getRows("TaxRegime"),
    taxRateSchedules: getRows("TaxRateSchedule"),
    paymentMethodDefinitions: getRows("PaymentMethodDefinition"),
    users: getRows("User"),
    roleRoutePermissions: getRows("RoleRoutePermission"),
    roleActionPermissions: getRows("RoleActionPermission"),
  };
}

export function backfillOutboxAllTransactions(db: Database.Database): {
  enqueuedCount: number;
  summary: Record<string, number>;
} {
  const summary: Record<string, number> = {
    Customer: 0,
    DocumentBooklet: 0,
    StockReceipt: 0,
    StockTransfer: 0,
    StockAdjustment: 0,
    DeliveryOrder: 0,
    Sale: 0,
  };

  const checkPendingStmt = db.prepare(
    `SELECT id FROM SyncOutbox WHERE entityType = ? AND entityId = ? AND status = 'PENDING' LIMIT 1`,
  );
  const updatePendingStmt = db.prepare(
    `UPDATE SyncOutbox SET payloadJson = ?, retryCount = 0, lastError = NULL WHERE id = ?`,
  );
  const insertOutboxStmt = db.prepare(
    `INSERT INTO SyncOutbox (entityType, entityId, action, payloadJson, status, createdAt)
     VALUES (?, ?, 'UPSERT', ?, 'PENDING', datetime('now'))`,
  );

  const enqueueOrUpdate = (
    entityType: string,
    entityId: string,
    payload: Record<string, unknown> | null,
  ): boolean => {
    if (!payload) return false;
    const strEntityId = String(entityId);
    const payloadJson = JSON.stringify(payload);
    const pendingRow = checkPendingStmt.get(entityType, strEntityId) as
      | { id: number }
      | undefined;
    if (pendingRow) {
      updatePendingStmt.run(payloadJson, pendingRow.id);
    } else {
      insertOutboxStmt.run(entityType, strEntityId, payloadJson);
    }
    return true;
  };

  db.transaction(() => {
    // 1. Customers
    try {
      const customers = db
        .prepare(`SELECT id FROM Customer ORDER BY id ASC`)
        .all() as Array<{ id: number }>;
      for (const c of customers) {
        const payload = serializeCustomerForSync(db, c.id);
        if (enqueueOrUpdate("Customer", String(c.id), payload)) {
          summary.Customer++;
        }
      }
    } catch (e) {
      console.warn("Backfill Customer skipped:", e);
    }

    // 2. DocumentBooklet
    try {
      const booklets = db
        .prepare(`SELECT * FROM DocumentBooklet ORDER BY id ASC`)
        .all() as Array<Record<string, unknown>>;
      for (const b of booklets) {
        if (enqueueOrUpdate("DocumentBooklet", String(b.id), b)) {
          summary.DocumentBooklet++;
        }
      }
    } catch (e) {
      console.warn("Backfill DocumentBooklet skipped:", e);
    }

    // 3. StockReceipt
    try {
      const receipts = db
        .prepare(`SELECT id FROM StockReceipt ORDER BY id ASC`)
        .all() as Array<{ id: string }>;
      for (const r of receipts) {
        const payload = serializeStockReceiptForSync(db, r.id);
        if (enqueueOrUpdate("StockReceipt", r.id, payload)) {
          summary.StockReceipt++;
        }
      }
    } catch (e) {
      console.warn("Backfill StockReceipt skipped:", e);
    }

    // 4. StockTransfer
    try {
      const transfers = db
        .prepare(`SELECT id FROM StockTransfer ORDER BY id ASC`)
        .all() as Array<{ id: string }>;
      for (const t of transfers) {
        const payload = serializeStockTransferForSync(db, t.id);
        if (enqueueOrUpdate("StockTransfer", t.id, payload)) {
          summary.StockTransfer++;
        }
      }
    } catch (e) {
      console.warn("Backfill StockTransfer skipped:", e);
    }

    // 5. StockAdjustment
    try {
      const adjustments = db
        .prepare(`SELECT id FROM StockAdjustment ORDER BY id ASC`)
        .all() as Array<{ id: string }>;
      for (const a of adjustments) {
        const payload = serializeStockAdjustmentForSync(db, a.id);
        if (enqueueOrUpdate("StockAdjustment", a.id, payload)) {
          summary.StockAdjustment++;
        }
      }
    } catch (e) {
      console.warn("Backfill StockAdjustment skipped:", e);
    }

    // 6. DeliveryOrder
    try {
      const orders = db
        .prepare(`SELECT id FROM DeliveryOrder ORDER BY id ASC`)
        .all() as Array<{ id: number }>;
      for (const o of orders) {
        const payload = serializeDeliveryOrderForSync(db, o.id);
        if (enqueueOrUpdate("DeliveryOrder", String(o.id), payload)) {
          summary.DeliveryOrder++;
        }
      }
    } catch (e) {
      console.warn("Backfill DeliveryOrder skipped:", e);
    }

    // 7. Sale
    try {
      const sales = db
        .prepare(`SELECT id FROM Sale ORDER BY id ASC`)
        .all() as Array<{ id: string }>;
      for (const s of sales) {
        const payload = serializeSaleForSync(db, s.id);
        if (enqueueOrUpdate("Sale", s.id, payload)) {
          summary.Sale++;
        }
      }
    } catch (e) {
      console.warn("Backfill Sale skipped:", e);
    }
  })();

  const enqueuedCount = Object.values(summary).reduce((a, b) => a + b, 0);
  return { enqueuedCount, summary };
}
