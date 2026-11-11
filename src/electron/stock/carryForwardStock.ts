import { randomUUID } from "node:crypto";
import type {
  CarryForwardStockBatchResult,
  CarryForwardStockFormOptions,
  CarryForwardStockOnHandRow,
  CarryForwardStockPendingRow,
  CarryForwardStockRow,
  UpsertCarryForwardStockBatchInput,
} from "../../shared/carryForwardStock.types.js";
import {
  assertRouteRead,
  assertRouteWrite,
  carryForwardRequiresValidation,
} from "../auth/permissions/service.js";
import { getDatabase } from "../db/index.js";
import { listActiveSalesPoints, requireActiveSalesPoint } from "../salesPoints/active.js";
import {
  getOpenPostingPeriodForActor,
  assertDateInOpenMonthForActor,
} from "../financialYears/service.js";
import { formatQty, parseQty } from "./decimal.js";
import { applyMovement } from "./post.js";
import {
  productOmitsStorageLocationById,
  loadStockIntakeOilGrouping,
} from "./productStorage.js";
import { isStockPoolProduct } from "../../shared/stockIntakeGroups.js";
import { allocateAdjustmentNo } from "./sequences.js";

const ROUTE_ID = "carry-forward-stock";
const QTY_EPS = 0.000001;

function nowIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function noonUtcIsoDate(isoDate: string): string {
  return `${isoDate.slice(0, 10)}T12:00:00.000Z`;
}

function assertWrite(userId: string): { ok: true } | { ok: false; error: string } {
  const role = getDatabase()
    .prepare(`SELECT role FROM User WHERE id = ?`)
    .get(userId) as { role: string } | undefined;

  if (!role) {
    return { ok: false, error: "User not found." };
  }

  try {
    assertRouteWrite(role.role, ROUTE_ID);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  return { ok: true };
}

function assertRead(userId: string): void {
  const role = getDatabase()
    .prepare(`SELECT role FROM User WHERE id = ? AND isActive = 1`)
    .get(userId) as { role: string } | undefined;

  if (!role) {
    throw new Error("User not found.");
  }

  assertRouteRead(role.role, ROUTE_ID);
}

function getSellableQty(
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
): number {
  const row = (
    storageLocationId == null
      ? getDatabase().prepare(
          `SELECT qty FROM StockBalance
           WHERE salesPointId = ? AND productId = ? AND storageLocationId IS NULL
             AND condition = 'SELLABLE'`,
        )
      : getDatabase().prepare(
          `SELECT qty FROM StockBalance
           WHERE salesPointId = ? AND productId = ? AND storageLocationId = ?
             AND condition = 'SELLABLE'`,
        )
  ).get(
    ...(storageLocationId == null
      ? [salesPointId, productId]
      : [salesPointId, productId, storageLocationId]),
  ) as { qty: string } | undefined;
  return row ? parseQty(row.qty) : 0;
}

const NULL_LOC_MATCH = `(
  (l2.storageLocationId IS NULL AND l.storageLocationId IS NULL)
  OR l2.storageLocationId = l.storageLocationId
)`;

export function getCarryForwardStockFormOptions(): CarryForwardStockFormOptions {
  const db = getDatabase();
  return {
    stockIntakeOilGrouping: loadStockIntakeOilGrouping(db),
    products: db
      .prepare(
        `SELECT p.productId, p.productName, COALESCE(p.uom, 'Kg') AS uom,
                COALESCE(pc.isBottled, 0) AS isBottled,
                COALESCE(pc.productCode, '') AS productCode,
                p.stockIntakeGroup,
                p.stockPoolProductId,
                COALESCE(p.excludeFromSales, 0) AS excludeFromSales,
                COALESCE(p.omitsStorageLocation, 0) AS omitsStorageLocation
         FROM Product p
         LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
         ORDER BY p.productName ASC`,
      )
      .all()
      .map((row) => {
        const r = row as {
          productId: number;
          productName: string;
          uom: string;
          isBottled: number;
          productCode: string;
          stockIntakeGroup: string | null;
          stockPoolProductId: number | null;
          excludeFromSales: number;
          omitsStorageLocation: number;
        };
        const stockIntakeGroup =
          r.stockIntakeGroup === "PALM_OIL" ||
          r.stockIntakeGroup === "SLUDGE_OIL" ||
          r.stockIntakeGroup === "PALM_KERNEL"
            ? r.stockIntakeGroup
            : null;
        const excludeFromSales = Number(r.excludeFromSales ?? 0) !== 0;
        return {
          productId: r.productId,
          productName: r.productName,
          uom: r.uom,
          isBottled: r.isBottled === 1,
          productCatCode: r.productCode,
          omitsStorageLocation: Number(r.omitsStorageLocation ?? 0) !== 0,
          stockIntakeGroup,
          stockPoolProductId: r.stockPoolProductId ?? null,
          excludeFromSales,
          isStockPool: isStockPoolProduct({
            excludeFromSales,
            stockPoolProductId: r.stockPoolProductId ?? null,
            stockIntakeGroup,
          }),
        };
      }),
    salesPoints: listActiveSalesPoints(db),
    storageLocations: db
      .prepare(
        `SELECT sl.id, sl.salesPointId, l.locationName AS name,
                COALESCE(sl.isDefault, 0) AS isDefault
         FROM StorageLocation sl
         JOIN Location l ON l.id = sl.locationId
         WHERE EXISTS (
           SELECT 1 FROM SalesPoint sp
           WHERE sp.id = sl.salesPointId AND COALESCE(sp.isActive, 1) = 1
         )
         ORDER BY sl.salesPointId ASC, COALESCE(sl.isDefault, 0) DESC, l.locationName ASC`,
      )
      .all()
      .map((row) => {
        const r = row as {
          id: number;
          salesPointId: number;
          name: string;
          isDefault: number;
        };
        return {
          id: r.id,
          salesPointId: r.salesPointId,
          name: r.name,
          isDefault: r.isDefault === 1,
        };
      }),
  };
}

export function listCarryForwardStock(): CarryForwardStockRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT DISTINCT
         a.salesPointId, sp.name AS salesPointName,
         l.storageLocationId,
         COALESCE(loc.locationName, '—') AS storageLocationName,
         l.productId, p.productName, COALESCE(p.uom, 'Kg') AS uom,
         (
           SELECT a2.adjustmentNo
           FROM StockAdjustment a2
           INNER JOIN StockAdjustmentLine l2 ON l2.adjustmentId = a2.id
           WHERE a2.sourceKind = 'CARRY_FORWARD'
             AND a2.status = 'POSTED'
             AND a2.salesPointId = a.salesPointId
             AND ${NULL_LOC_MATCH}
             AND l2.productId = l.productId
           ORDER BY a2.occurredAt DESC, a2.postedAt DESC
           LIMIT 1
         ) AS lastAdjustmentNo,
         (
           SELECT substr(a2.occurredAt, 1, 10)
           FROM StockAdjustment a2
           INNER JOIN StockAdjustmentLine l2 ON l2.adjustmentId = a2.id
           WHERE a2.sourceKind = 'CARRY_FORWARD'
             AND a2.status = 'POSTED'
             AND a2.salesPointId = a.salesPointId
             AND ${NULL_LOC_MATCH}
             AND l2.productId = l.productId
           ORDER BY a2.occurredAt DESC, a2.postedAt DESC
           LIMIT 1
         ) AS lastOccurredAt
       FROM StockAdjustment a
       INNER JOIN StockAdjustmentLine l ON l.adjustmentId = a.id
       INNER JOIN SalesPoint sp ON sp.id = a.salesPointId
       LEFT JOIN StorageLocation sl ON sl.id = l.storageLocationId
       LEFT JOIN Location loc ON loc.id = sl.locationId
       INNER JOIN Product p ON p.productId = l.productId
       WHERE a.sourceKind = 'CARRY_FORWARD' AND a.status = 'POSTED'
       ORDER BY sp.name ASC, p.productName ASC, COALESCE(loc.locationName, '') ASC`,
    )
    .all() as Array<{
    salesPointId: number;
    salesPointName: string;
    storageLocationId: number | null;
    storageLocationName: string;
    productId: number;
    productName: string;
    uom: string;
    lastAdjustmentNo: string | null;
    lastOccurredAt: string | null;
  }>;

  return rows.map((row) => ({
    salesPointId: row.salesPointId,
    salesPointName: row.salesPointName,
    storageLocationId: row.storageLocationId,
    storageLocationName: row.storageLocationName,
    productId: row.productId,
    productName: row.productName,
    uom: row.uom,
    currentQty: getSellableQty(
      row.salesPointId,
      row.productId,
      row.storageLocationId,
    ),
    lastAdjustmentNo: row.lastAdjustmentNo,
    lastOccurredAt: row.lastOccurredAt,
  }));
}

export function listCarryForwardStockPending(
  userId: string,
): CarryForwardStockPendingRow[] {
  assertRead(userId);

  const rows = getDatabase()
    .prepare(
      `SELECT a.id AS adjustmentId, a.adjustmentNo,
              substr(a.occurredAt, 1, 10) AS occurredAt,
              a.createdAt AS submittedAt,
              a.salesPointId, sp.name AS salesPointName,
              l.productId, p.productName, COALESCE(p.uom, 'Kg') AS uom,
              l.storageLocationId,
              COALESCE(loc.locationName, '—') AS storageLocationName,
              l.deltaQty
       FROM StockAdjustment a
       INNER JOIN StockAdjustmentLine l ON l.adjustmentId = a.id
       INNER JOIN SalesPoint sp ON sp.id = a.salesPointId
       LEFT JOIN StorageLocation sl ON sl.id = l.storageLocationId
       LEFT JOIN Location loc ON loc.id = sl.locationId
       INNER JOIN Product p ON p.productId = l.productId
       WHERE a.status = 'DRAFT'
         AND a.sourceKind = 'CARRY_FORWARD'
         AND a.createdByUserId = ?
       ORDER BY a.occurredAt DESC, a.adjustmentNo DESC,
                p.productName ASC, COALESCE(loc.locationName, '') ASC`,
    )
    .all(userId) as Array<{
    adjustmentId: string;
    adjustmentNo: string;
    occurredAt: string;
    submittedAt: string | null;
    salesPointId: number;
    salesPointName: string;
    productId: number;
    productName: string;
    uom: string;
    storageLocationId: number | null;
    storageLocationName: string;
    deltaQty: string;
  }>;

  return rows.map((row) => {
    const currentQty = getSellableQty(
      row.salesPointId,
      row.productId,
      row.storageLocationId,
    );
    const deltaQty = parseQty(row.deltaQty);
    return {
      adjustmentId: row.adjustmentId,
      adjustmentNo: row.adjustmentNo,
      occurredAt: row.occurredAt,
      salesPointId: row.salesPointId,
      salesPointName: row.salesPointName,
      productId: row.productId,
      productName: row.productName,
      uom: row.uom,
      storageLocationId: row.storageLocationId,
      storageLocationName: row.storageLocationName,
      currentQty,
      proposedQty: currentQty + deltaQty,
      submittedAt: row.submittedAt,
    };
  });
}

export function listCarryForwardStockOnHand(
  salesPointId: number,
  productId: number,
): CarryForwardStockOnHandRow[] {
  if (!Number.isFinite(salesPointId) || !Number.isFinite(productId)) {
    return [];
  }
  const rows = getDatabase()
    .prepare(
      `SELECT storageLocationId, qty
       FROM StockBalance
       WHERE salesPointId = ? AND productId = ? AND condition = 'SELLABLE'`,
    )
    .all(salesPointId, productId) as Array<{ storageLocationId: number | null; qty: string }>;

  return rows.map((row) => ({
    storageLocationId: row.storageLocationId,
    qty: parseQty(row.qty),
  }));
}

export function upsertCarryForwardStockBatch(
  input: UpsertCarryForwardStockBatchInput,
): CarryForwardStockBatchResult {
  const write = assertWrite(input.userId);
  if (!write.ok) {
    return write;
  }

  const period = getOpenPostingPeriodForActor(input.userId);
  if (!period) {
    return { ok: false, error: "Open a financial month before posting carry-forward stock." };
  }

  let occurredDate: string;
  try {
    assertDateInOpenMonthForActor(String(input.occurredAt ?? ""), input.userId);
    occurredDate = String(input.occurredAt).trim().slice(0, 10);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid occurrence date.",
    };
  }

  const salesPointId = Number(input.salesPointId);
  if (!Number.isFinite(salesPointId)) {
    return { ok: false, error: "Collection point is required." };
  }

  const db = getDatabase();
  const spCheck = requireActiveSalesPoint(db, salesPointId);
  if (!spCheck.ok) {
    return { ok: false, error: spCheck.error };
  }

  const locationCheck = db.prepare(
    `SELECT id FROM StorageLocation WHERE id = ? AND salesPointId = ?`,
  );
  const productCheck = db.prepare(`SELECT productId FROM Product WHERE productId = ?`);

  const seen = new Set<string>();
  const deltas: Array<{
    productId: number;
    storageLocationId: number | null;
    deltaQty: number;
  }> = [];

  for (const line of input.lines) {
    const productId = Number(line.productId);
    const onHandQty = Number(line.onHandQty);
    if (!Number.isFinite(productId) || !Number.isFinite(onHandQty) || onHandQty < 0) {
      continue;
    }

    const product = productCheck.get(productId) as { productId: number } | undefined;
    if (!product) {
      return { ok: false, error: "Product not found." };
    }

    const omitsStorage = productOmitsStorageLocationById(db, productId);
    let storageLocationId: number | null;

    if (omitsStorage) {
      const rawLoc = line.storageLocationId;
      if (rawLoc != null && Number.isFinite(Number(rawLoc))) {
        return {
          ok: false,
          error: "Palm Kernel / Cake products do not use storage locations.",
        };
      }
      storageLocationId = null;
    } else {
      storageLocationId = Number(line.storageLocationId);
      if (!Number.isFinite(storageLocationId)) {
        continue;
      }

      const location = locationCheck.get(storageLocationId, salesPointId) as
        | { id: number }
        | undefined;
      if (!location) {
        return {
          ok: false,
          error: "Storage location does not belong to the collection point.",
        };
      }
    }

    const pairKey =
      storageLocationId == null
        ? `null:${productId}`
        : `${storageLocationId}:${productId}`;
    if (seen.has(pairKey)) {
      return {
        ok: false,
        error:
          storageLocationId == null
            ? "Duplicate product in the same batch."
            : "Duplicate location and product in the same batch.",
      };
    }
    seen.add(pairKey);

    const current = getSellableQty(salesPointId, productId, storageLocationId);
    const delta = onHandQty - current;
    if (Math.abs(delta) <= QTY_EPS) {
      continue;
    }
    deltas.push({ productId, storageLocationId, deltaQty: delta });
  }

  if (deltas.length === 0) {
    return { ok: true, saved: 0, adjustmentNo: null };
  }

  const occurredAt = noonUtcIsoDate(occurredDate);
  const reason = (input.notes ?? "").trim() || "Carry-forward stock";
  const requiresValidation = carryForwardRequiresValidation(input.userId);

  try {
    const result = db.transaction(() => {
      const id = randomUUID();
      const adjustmentNo = allocateAdjustmentNo(db, occurredAt);
      db.prepare(
        `INSERT INTO StockAdjustment (
          id, adjustmentNo, salesPointId, occurredAt, reason, status, sourceKind, createdByUserId
        ) VALUES (?, ?, ?, ?, ?, 'DRAFT', 'CARRY_FORWARD', ?)`,
      ).run(id, adjustmentNo, salesPointId, occurredAt, reason, input.userId);

      const insertLine = db.prepare(
        `INSERT INTO StockAdjustmentLine (
          id, adjustmentId, productId, deltaQty, storageLocationId, fromCondition, toCondition
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      );
      for (const line of deltas) {
        insertLine.run(
          randomUUID(),
          id,
          line.productId,
          formatQty(line.deltaQty),
          line.storageLocationId,
        );
      }

      if (requiresValidation) {
        return { adjustmentNo, pendingValidation: true as const };
      }

      for (const line of deltas) {
        applyMovement(db, {
          salesPointId,
          productId: line.productId,
          storageLocationId: line.storageLocationId,
          qty: formatQty(line.deltaQty),
          kind: "ADJUSTMENT",
          occurredAt,
          userId: input.userId,
          sourceKind: "ADJUSTMENT",
          sourceId: id,
          condition: "SELLABLE",
          notes: "Carry-forward stock",
        });
      }

      db.prepare(
        `UPDATE StockAdjustment
         SET status = 'POSTED', postedByUserId = ?, postedAt = ?, updatedAt = ?
         WHERE id = ?`,
      ).run(input.userId, nowIso(), nowIso(), id);

      return { adjustmentNo, pendingValidation: false as const };
    })();

    return {
      ok: true,
      saved: deltas.length,
      adjustmentNo: result.adjustmentNo,
      pendingValidation: result.pendingValidation,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to post carry-forward stock.",
    };
  }
}
