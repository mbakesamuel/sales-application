import type {
  StockProductFilter,
  StockValidateManyResult,
  StockValidationDocKind,
  StockValidationItem,
  StockValidationQueuePage,
  StockValidationQueueRow,
} from "../../shared/stock.types.js";
import { isIntraSalesPointTransfer } from "../../shared/stockTransferMode.js";
import {
  assertAction,
  assertRouteRead,
  assertRouteWrite,
  canAccessRoute,
} from "../auth/permissions/service.js";
import { getDatabase } from "../db/index.js";
import { formatQty } from "./decimal.js";
import {
  BOTTLED_STOCK_ROUTE_ID,
  STOCK_MODULE_ROUTE_ID,
} from "../../shared/stockModule.js";
import {
  dispatchTransfer,
  postAdjustment,
  postInternalTransfer,
  postReceipt,
} from "./service.js";

const QUEUE_LIMIT = 200;

function getActor(userId: string): {
  id: string;
  role: string;
  salesPointId: number | null;
  isActive: number;
} {
  const row = getDatabase()
    .prepare(`SELECT id, role, salesPointId, isActive FROM User WHERE id = ?`)
    .get(userId) as
    | { id: string; role: string; salesPointId: number | null; isActive: number }
    | undefined;

  if (!row?.isActive) {
    throw new Error("Login required.");
  }

  return row;
}

function documentProductFilter(
  db: ReturnType<typeof getDatabase>,
  lineTable: string,
  fkColumn: string,
  documentId: string,
): StockProductFilter {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(COALESCE(pc.isBottled, 0)), 0) AS isBottled
       FROM ${lineTable} line
       INNER JOIN Product p ON p.productId = line.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE line.${fkColumn} = ?`,
    )
    .get(documentId) as { isBottled: number } | undefined;
  return row && row.isBottled === 1 ? "bottled" : "bulk";
}

function canSeeProductFilter(role: string, filter: StockProductFilter): boolean {
  if (filter === "bottled") {
    return canAccessRoute(role, BOTTLED_STOCK_ROUTE_ID);
  }
  return canAccessRoute(role, STOCK_MODULE_ROUTE_ID);
}

export function listStockValidationQueue(userId: string): StockValidationQueuePage {
  const actor = getActor(userId);
  assertRouteRead(actor.role, "stock-validation");

  const db = getDatabase();
  const scoped = actor.salesPointId;

  type RawRow = {
    kind: StockValidationDocKind;
    id: string;
    documentNo: string;
    fromSalesPointId: number;
    toSalesPointId: number | null;
    fromSalesPointName: string;
    toSalesPointName: string | null;
    documentDateIso: string;
    createdByName: string;
    lineCount: number;
    totalQty: number;
  };

  const receiptScope =
    scoped == null ? "" : " AND r.salesPointId = @scopedSalesPointId";
  const transferScope =
    scoped == null ? "" : " AND t.fromSalesPointId = @scopedSalesPointId";
  const adjustmentScope =
    scoped == null ? "" : " AND a.salesPointId = @scopedSalesPointId";

  const params = { scopedSalesPointId: scoped ?? -1 };

  const receipts = db
    .prepare(
      `SELECT 'RECEIPT' AS kind, r.id, r.receiptNo AS documentNo,
              r.salesPointId AS fromSalesPointId, NULL AS toSalesPointId,
              sp.name AS fromSalesPointName, NULL AS toSalesPointName,
              substr(r.receivedAt, 1, 10) AS documentDateIso,
              COALESCE(u.name, '—') AS createdByName,
              COUNT(rl.id) AS lineCount,
              COALESCE(SUM(CAST(rl.qty AS REAL)), 0) AS totalQty
       FROM StockReceipt r
       INNER JOIN SalesPoint sp ON sp.id = r.salesPointId
       LEFT JOIN User u ON u.id = r.createdByUserId
       LEFT JOIN StockReceiptLine rl ON rl.receiptId = r.id
       WHERE r.status = 'DRAFT'${receiptScope}
       GROUP BY r.id
       ORDER BY r.receivedAt ASC, r.receiptNo ASC`,
    )
    .all(params) as RawRow[];

  const transfers = db
    .prepare(
      `SELECT 'TRANSFER' AS kind, t.id, t.transferNo AS documentNo,
              t.fromSalesPointId, t.toSalesPointId,
              fsp.name AS fromSalesPointName, tsp.name AS toSalesPointName,
              substr(t.dispatchedAt, 1, 10) AS documentDateIso,
              COALESCE(u.name, '—') AS createdByName,
              COUNT(tl.id) AS lineCount,
              COALESCE(SUM(CAST(tl.qty AS REAL)), 0) AS totalQty
       FROM StockTransfer t
       INNER JOIN SalesPoint fsp ON fsp.id = t.fromSalesPointId
       INNER JOIN SalesPoint tsp ON tsp.id = t.toSalesPointId
       LEFT JOIN User u ON u.id = t.createdByUserId
       LEFT JOIN StockTransferLine tl ON tl.transferId = t.id
       WHERE t.status = 'DRAFT'${transferScope}
       GROUP BY t.id
       ORDER BY t.dispatchedAt ASC, t.transferNo ASC`,
    )
    .all(params) as RawRow[];

  const adjustments = db
    .prepare(
      `SELECT 'ADJUSTMENT' AS kind, a.id, a.adjustmentNo AS documentNo,
              a.salesPointId AS fromSalesPointId, NULL AS toSalesPointId,
              sp.name AS fromSalesPointName, NULL AS toSalesPointName,
              substr(a.occurredAt, 1, 10) AS documentDateIso,
              COALESCE(u.name, '—') AS createdByName,
              COUNT(al.id) AS lineCount,
              COALESCE(SUM(ABS(CAST(al.deltaQty AS REAL))), 0) AS totalQty
       FROM StockAdjustment a
       INNER JOIN SalesPoint sp ON sp.id = a.salesPointId
       LEFT JOIN User u ON u.id = a.createdByUserId
       LEFT JOIN StockAdjustmentLine al ON al.adjustmentId = a.id
       WHERE a.status = 'DRAFT'
         AND COALESCE(a.sourceKind, 'NORMAL') IN ('NORMAL', 'CARRY_FORWARD')${adjustmentScope}
       GROUP BY a.id
       ORDER BY a.occurredAt ASC, a.adjustmentNo ASC`,
    )
    .all(params) as RawRow[];

  const lineFk: Record<
    StockValidationDocKind,
    { table: string; column: string }
  > = {
    RECEIPT: { table: "StockReceiptLine", column: "receiptId" },
    TRANSFER: { table: "StockTransferLine", column: "transferId" },
    ADJUSTMENT: { table: "StockAdjustmentLine", column: "adjustmentId" },
  };

  const combined: StockValidationQueueRow[] = [];
  for (const raw of [...receipts, ...transfers, ...adjustments]) {
    const fk = lineFk[raw.kind];
    const productFilter = documentProductFilter(db, fk.table, fk.column, raw.id);
    if (!canSeeProductFilter(actor.role, productFilter)) {
      continue;
    }

    const transferMode =
      raw.kind === "TRANSFER"
        ? isIntraSalesPointTransfer(
            raw.fromSalesPointId,
            raw.toSalesPointId ?? raw.fromSalesPointId,
          )
          ? "INTRA_SALES_POINT"
          : "INTER_SALES_POINT"
        : null;

    combined.push({
      kind: raw.kind,
      id: raw.id,
      documentNo: raw.documentNo,
      productFilter,
      transferMode,
      fromSalesPointName: raw.fromSalesPointName,
      toSalesPointName: raw.toSalesPointName,
      documentDateIso: raw.documentDateIso,
      createdByName: raw.createdByName,
      lineCount: Number(raw.lineCount) || 0,
      totalQty: formatQty(Number(raw.totalQty) || 0),
    });
  }

  combined.sort((a, b) => {
    const byDate = a.documentDateIso.localeCompare(b.documentDateIso);
    if (byDate !== 0) return byDate;
    return a.documentNo.localeCompare(b.documentNo);
  });

  const rows = combined.slice(0, QUEUE_LIMIT);
  return {
    totalPending: combined.length,
    rows,
  };
}

function resolveProductFilterForDoc(
  kind: StockValidationDocKind,
  id: string,
): StockProductFilter {
  const db = getDatabase();
  const fk =
    kind === "RECEIPT"
      ? { table: "StockReceiptLine", column: "receiptId" }
      : kind === "TRANSFER"
        ? { table: "StockTransferLine", column: "transferId" }
        : { table: "StockAdjustmentLine", column: "adjustmentId" };
  return documentProductFilter(db, fk.table, fk.column, id);
}

export async function validateStockDocuments(
  userId: string,
  items: StockValidationItem[],
): Promise<StockValidateManyResult> {
  const actor = getActor(userId);
  assertRouteWrite(actor.role, "stock-validation");
  assertAction(actor.role, "validate_stock_documents");

  const unique = new Map<string, StockValidationItem>();
  for (const item of items) {
    if (!item?.id || !item.kind) continue;
    unique.set(`${item.kind}:${item.id}`, item);
  }
  if (unique.size === 0) {
    return { ok: false, error: "Select at least one stock document." };
  }

  let validated = 0;
  const errors: Array<{
    kind: StockValidationDocKind;
    id: string;
    error: string;
  }> = [];

  for (const item of unique.values()) {
    const productFilter = resolveProductFilterForDoc(item.kind, item.id);
    let result: { ok: true } | { ok: false; error: string };

    if (item.kind === "RECEIPT") {
      result = await postReceipt(userId, item.id, productFilter);
    } else if (item.kind === "ADJUSTMENT") {
      result = await postAdjustment(userId, item.id, productFilter);
    } else {
      const transfer = getDatabase()
        .prepare(
          `SELECT fromSalesPointId, toSalesPointId FROM StockTransfer WHERE id = ?`,
        )
        .get(item.id) as
        | { fromSalesPointId: number; toSalesPointId: number }
        | undefined;
      if (!transfer) {
        errors.push({ kind: item.kind, id: item.id, error: "Transfer not found." });
        continue;
      }
      if (
        isIntraSalesPointTransfer(
          transfer.fromSalesPointId,
          transfer.toSalesPointId,
        )
      ) {
        result = await postInternalTransfer(userId, item.id, productFilter);
      } else {
        result = dispatchTransfer(userId, item.id, productFilter);
      }
    }

    if (result.ok) {
      validated += 1;
    } else {
      errors.push({ kind: item.kind, id: item.id, error: result.error });
    }
  }

  return { ok: true, validated, errors };
}
