import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  AdjustmentDetail,
  AdjustmentListRow,
  AdjustmentReviewResult,
  ReceiptDetail,
  ReceiptListRow,
  ReceiptReviewResult,
  ReceiveTransferInput,
  SaveAdjustmentInput,
  SaveReceiptInput,
  SaveTransferInput,
  StockBootstrap,
  StockGenericResult,
  StockMovementKind,
  StockMovementRow,
  StockMutationResult,
  TransferDetail,
  TransferConsignmentFields,
  TransferListRow,
  TransferReviewResult,
  StockBalanceRow,
} from "../../shared/stock.types.js";
import {
  isIntraSalesPointTransfer,
  resolveTransferMode,
  type TransferMode,
} from "../../shared/stockTransferMode.js";
import {
  assertAction,
  assertRouteWrite,
  canAccessRoute,
  canPerformAction,
  canWriteRoute,
  getRouteAccess,
} from "../auth/permissions/service.js";
import { getDatabase } from "../db/index.js";
import {
  requireActiveSalesPoint,
} from "../salesPoints/active.js";
import { absQty, formatQty, isNonZeroQty, isPositiveQty, parseQty, sumQty } from "./decimal.js";
import { isInsufficientStockError } from "./errors.js";
import {
  getLiveSellableBalance,
  loadStockBalancesAsOf,
} from "./asOfBalance.js";
import {
  applyMovement,
  assertStorageLocationForSalesPoint,
  assertTransferLinesAvailableAtSource,
  movementSignedDelta,
  reverseMovementsBySource,
} from "./post.js";
import {
  enqueueOutboxItem,
  serializeStockReceiptForSync,
  serializeStockTransferForSync,
  serializeStockAdjustmentForSync,
} from "../sync/syncOutbox.js";
import { isCommandApiEnabled } from "../api/client.js";
import {
  requireCommandApiOnline,
  requireCommandApiOnlineCached,
} from "../api/onlineOnly.js";
import {
  createStockAdjustmentRemote,
  createStockReceiptRemote,
  createStockTransferRemote,
  postStockAdjustmentRemote,
  postStockReceiptRemote,
  postStockTransferRemote,
  receiveStockTransferRemote,
} from "../api/stockRemote.js";
import {
  assertMovementLocationRules,
  assertProductsAllowStorageLocation,
  assertInterTransferProductsAllowed,
  assertNoBottledTransferProducts,
  loadLoosePalmOilAllowInterSalesPointTransfer,
  loadStockIntakeOilGrouping,
  storageLocationProductSql,
} from "./productStorage.js";
import {
  allocateAdjustmentNo,
  allocateReceiptNo,
  allocateTransferNo,
} from "./sequences.js";
import { assertDateInOpenMonthForActor } from "../financialYears/service.js";
import {
  loadStockDocumentNumberSettings,
  loadStockTransferReceiveUsesDocumentDate,
  normalizeStockDocumentNumber,
} from "./documentNumberSettings.js";
import {
  isStockPoolProduct,
  type StockIntakeGroup,
} from "../../shared/stockIntakeGroups.js";
import { isLooseLpoProduct } from "../../shared/looseLpoProduct.js";
import {
  consolidateIntakePoolBalances,
  getIntakePoolTotalQty,
  splitIntakePoolBalancesToLandingProducts,
} from "./stockIntakeBalance.js";
import {
  BOTTLED_STOCK_ROUTE_ID,
  STOCK_MODULE_ROUTE_ID,
  inferDocumentProductFilter,
  isAllProductFilter,
  normalizeStockProductFilter,
  resolveStockProductFilterFromSnapshot,
  type DocumentStockProductFilter,
  type StockProductFilter,
} from "../../shared/stockModule.js";
import { loadRolePermissionsSnapshot } from "../auth/permissions/service.js";

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function normalizeIsoDateInput(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return new Date().toISOString().slice(0, 10);
}

function noonUtcIsoDate(isoDate: string): string {
  return `${isoDate}T12:00:00`;
}

/**
 * Resolve transfer receive posting timestamp.
 * When App setting is on: require YYYY-MM-DD, open-month check, noon UTC.
 * When off: clock time; optional paperwork receiveDate unchanged by caller.
 */
function resolveTransferReceiveOccurredAt(
  receiveDateRaw: string | null | undefined,
  userId: string,
): { receivedAt: string; receiveDate: string | null } {
  const usesDocumentDate = loadStockTransferReceiveUsesDocumentDate();
  if (!usesDocumentDate) {
    return {
      receivedAt: nowIso(),
      receiveDate: normalizeOptionalTransferDate(receiveDateRaw),
    };
  }

  const trimmed = receiveDateRaw?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Receive date is required.");
  }
  assertDateInOpenMonthForActor(trimmed, userId);
  return {
    receivedAt: noonUtcIsoDate(trimmed),
    receiveDate: trimmed,
  };
}

function utcIsoDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function describeError(error: unknown, fallback: string): string {
  if (isInsufficientStockError(error)) {
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

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

function scopedSalesPointIdForActor(actor: { salesPointId: number | null }): number | null {
  return actor.salesPointId ?? null;
}

function assertSalesPointScope(
  actor: { salesPointId: number | null },
  salesPointId: number,
): void {
  if (actor.salesPointId != null && actor.salesPointId !== salesPointId) {
    throw new Error("You can only work within your assigned collection point.");
  }
}

function assertTransferInitiateSalesPointScope(
  actor: { salesPointId: number | null },
  salesPointId: number,
): void {
  // Scope follows User.salesPointId. Leave collection point empty on the user
  // for company-wide operators; manage draft/post/receive in Role permissions.
  assertSalesPointScope(actor, salesPointId);
}

function assertCanPostOrReceiveStockTransfer(actor: { role: string }): void {
  if (!canPerformAction(actor.role, "receive_stock_transfers")) {
    throw new Error("You do not have permission to receive stock transfers.");
  }
}

function uomForBottled(isBottled: boolean, uom: string | null): string {
  if (uom?.trim()) {
    return uom.trim();
  }
  return isBottled ? "Unit" : "Kg";
}

function resolveStockProductFilterForRole(
  role: string,
  requested?: StockProductFilter | null,
): StockProductFilter {
  return resolveStockProductFilterFromSnapshot(
    loadRolePermissionsSnapshot(role),
    requested,
  );
}

/** Bulk docs need Stock write; bottled docs need Bottle Stock write. */
function assertStockModuleWrite(
  role: string,
  productFilter: StockProductFilter,
  _bulkRouteId: string,
): void {
  if (productFilter === "bottled") {
    assertRouteWrite(role, BOTTLED_STOCK_ROUTE_ID);
    return;
  }
  assertRouteWrite(role, STOCK_MODULE_ROUTE_ID);
}

function bottledFlagForFilter(productFilter: DocumentStockProductFilter): number {
  return productFilter === "bottled" ? 1 : 0;
}

function uiFilterUsesBottledConstraint(productFilter: StockProductFilter): boolean {
  return !isAllProductFilter(productFilter);
}

function productFilterSql(aliasPc = "pc"): string {
  return `COALESCE(${aliasPc}.isBottled, 0) = ?`;
}

function uiBottledFilterParts(
  productFilter: StockProductFilter,
  aliasPc = "pc",
): { clause: string; params: number[] } {
  if (isAllProductFilter(productFilter)) {
    return { clause: "1=1", params: [] };
  }
  return {
    clause: productFilterSql(aliasPc),
    params: [productFilter === "bottled" ? 1 : 0],
  };
}

function documentFilterForLines(
  db: import("better-sqlite3").Database,
  uiFilter: StockProductFilter,
  productIds: number[],
): DocumentStockProductFilter {
  if (productIds.length === 0) {
    return uiFilter === "bottled" ? "bottled" : "bulk";
  }
  return resolveDocumentFilterForMutation(db, uiFilter, productIds);
}

function productIsBottledFlagsForIds(
  db: import("better-sqlite3").Database,
  productIds: number[],
): number[] {
  const stmt = db.prepare(
    `SELECT COALESCE(pc.isBottled, 0) AS isBottled
     FROM Product p
     LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
     WHERE p.productId = ?`,
  );
  return productIds.map((productId) => {
    const row = stmt.get(productId) as { isBottled: number } | undefined;
    if (!row) {
      throw new Error(`Product ${productId} was not found.`);
    }
    return row.isBottled;
  });
}

function resolveDocumentFilterForMutation(
  db: import("better-sqlite3").Database,
  uiFilter: StockProductFilter,
  productIds: number[],
): DocumentStockProductFilter {
  if (uiFilter === "bulk" || uiFilter === "bottled") {
    return uiFilter;
  }
  return inferDocumentProductFilter(productIsBottledFlagsForIds(db, productIds));
}

function resolveMutationProductFilter(
  db: import("better-sqlite3").Database,
  uiFilterInput: StockProductFilter | null | undefined,
  productIds: number[],
): DocumentStockProductFilter {
  const uiFilter = normalizeStockProductFilter(uiFilterInput);
  return resolveDocumentFilterForMutation(db, uiFilter, productIds);
}

/** Validates receipt lines: bottled filter + per-line location rules (null for PKCP/PKP). */
function assertReceiptProductLines(
  db: import("better-sqlite3").Database,
  lines: Array<{ productId: number; storageLocationId: number | null }>,
  productFilter: DocumentStockProductFilter,
): void {
  assertProductsMatchBottledFilter(
    db,
    lines.map((line) => line.productId),
    productFilter,
  );
  for (const line of lines) {
    assertMovementLocationRules(db, line.productId, line.storageLocationId);
  }
}

/** Validates adjustment lines: bottled filter + per-line location rules (null for PKCP/PKP). */
function assertAdjustmentProductLines(
  db: import("better-sqlite3").Database,
  lines: Array<{ productId: number; storageLocationId: number | null }>,
  productFilter: DocumentStockProductFilter,
): void {
  assertProductsMatchBottledFilter(
    db,
    lines.map((line) => line.productId),
    productFilter,
  );
  for (const line of lines) {
    assertMovementLocationRules(db, line.productId, line.storageLocationId);
  }
}

function assertProductsMatchBottledFilter(
  db: import("better-sqlite3").Database,
  productIds: number[],
  productFilter: DocumentStockProductFilter,
): void {
  const expected = bottledFlagForFilter(productFilter);
  const stmt = db.prepare(
    `SELECT p.productId, p.productName, COALESCE(pc.isBottled, 0) AS isBottled
     FROM Product p
     LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
     WHERE p.productId = ?`,
  );
  for (const productId of productIds) {
    const row = stmt.get(productId) as
      | { productId: number; productName: string; isBottled: number }
      | undefined;
    if (!row) {
      throw new Error(`Product ${productId} was not found.`);
    }
    if (row.isBottled !== expected) {
      throw new Error(
        productFilter === "bottled"
          ? `"${row.productName}" is not a bottled product.`
          : `"${row.productName}" is a bottled product. Enable Bottled products on this document.`,
      );
    }
  }
}

function assertProductsMatchStockFilter(
  db: import("better-sqlite3").Database,
  productIds: number[],
  productFilter: DocumentStockProductFilter,
): void {
  assertProductsAllowStorageLocation(db, productIds);
  assertProductsMatchBottledFilter(db, productIds, productFilter);
}

function resolveWriteCaps(role: string, productFilter: StockProductFilter) {
  const moduleWrite =
    productFilter === "bottled"
      ? canWriteRoute(role, BOTTLED_STOCK_ROUTE_ID)
      : canWriteRoute(role, STOCK_MODULE_ROUTE_ID);
  return {
    canWriteReceipts: moduleWrite,
    canWriteTransfers: moduleWrite,
    canWriteAdjustments: moduleWrite,
  };
}

function resolveReceiptNoForCreate(
  db: import("better-sqlite3").Database,
  receivedAt: string,
  manualNo: string | null | undefined,
): string {
  const settings = loadStockDocumentNumberSettings();
  if (settings.autoGenerateReceiptNo) {
    return allocateReceiptNo(db, receivedAt);
  }
  const receiptNo = normalizeStockDocumentNumber(manualNo);
  if (!receiptNo) {
    throw new Error("Receipt number is required.");
  }
  const existing = db
    .prepare(`SELECT id FROM StockReceipt WHERE receiptNo = ?`)
    .get(receiptNo) as { id: string } | undefined;
  if (existing) {
    throw new Error(`Receipt number ${receiptNo} is already in use.`);
  }
  return receiptNo;
}

function resolveTransferNoForCreate(
  db: import("better-sqlite3").Database,
  dispatchedAt: string,
  manualNo: string | null | undefined,
): string {
  const settings = loadStockDocumentNumberSettings();
  if (settings.autoGenerateTransferNo) {
    return allocateTransferNo(db, dispatchedAt);
  }
  const transferNo = normalizeStockDocumentNumber(manualNo);
  if (!transferNo) {
    throw new Error("Transfer number is required.");
  }
  const existing = db
    .prepare(`SELECT id FROM StockTransfer WHERE transferNo = ?`)
    .get(transferNo) as { id: string } | undefined;
  if (existing) {
    throw new Error(`Transfer number ${transferNo} is already in use.`);
  }
  return transferNo;
}

export function getStockBootstrap(
  userId: string,
  productFilterInput?: StockProductFilter | null,
): StockBootstrap {
  const actor = getActor(userId);
  const role = actor.role;
  const productFilter = resolveStockProductFilterForRole(role, productFilterInput);
  const db = getDatabase();
  const scopedSalesPointId = scopedSalesPointIdForActor(actor);

  if (productFilter === "bottled") {
    if (
      !canAccessRoute(role, BOTTLED_STOCK_ROUTE_ID) &&
      !canAccessRoute(role, "stock-bin-card")
    ) {
      throw new Error("You do not have permission to view bottled stock.");
    }
  } else if (!canAccessRoute(role, STOCK_MODULE_ROUTE_ID)) {
    throw new Error("You do not have permission to view stock.");
  }

  const caps = resolveWriteCaps(role, productFilter);
  const canDraftReceipts =
    caps.canWriteReceipts && canPerformAction(role, "draft_stock_receipts");
  const canPostReceipts =
    caps.canWriteReceipts && canPerformAction(role, "post_stock_receipts");
  const canDraftTransfers =
    caps.canWriteTransfers && canPerformAction(role, "draft_stock_transfers");
  const canPostTransfers =
    caps.canWriteTransfers && canPerformAction(role, "post_stock_transfers");
  // Bottle stock is received via Reception (consignment note) at Bota — not transfers.
  const canReceiveTransfers = false;
  const canInitiateTransfers = canDraftTransfers || canPostTransfers;
  const canDispatchTransfers = canPostTransfers;
  const canCancelTransfers = canPostTransfers;
  const canDraftAdjustments =
    caps.canWriteAdjustments && canPerformAction(role, "draft_stock_adjustments");
  const canPostAdjustments =
    caps.canWriteAdjustments && canPerformAction(role, "post_stock_adjustments");

  const canDirectPostReceipts =
    caps.canWriteReceipts && canPerformAction(role, "direct_post_stock_receipts");
  const canDirectPostTransfers =
    caps.canWriteTransfers &&
    canPerformAction(role, "direct_post_stock_transfers");

  const salesPoints = db
    .prepare(
      `SELECT id, name, COALESCE(attachedToMill, 0) AS attachedToMill
       FROM SalesPoint
       WHERE COALESCE(isActive, 1) = 1
       ORDER BY name ASC`,
    )
    .all()
    .map((row) => ({
      id: (row as { id: number }).id,
      name: (row as { name: string }).name,
      attachedToMill: (row as { attachedToMill: number }).attachedToMill === 1,
    }));

  const storageLocations = db
    .prepare(
      `SELECT sl.id, sl.salesPointId, l.locationName AS name, sl.isDefault,
              COALESCE(sl.isSalesTank, 0) AS isSalesTank,
              COALESCE(sl.allowsMultiProduct, 0) AS allowsMultiProduct
       FROM StorageLocation sl
       JOIN Location l ON l.id = sl.locationId
       WHERE sl.salesPointId IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM SalesPoint sp
           WHERE sp.id = sl.salesPointId AND COALESCE(sp.isActive, 1) = 1
         )
       ORDER BY sl.salesPointId ASC, l.locationName ASC`,
    )
    .all()
    .map((row) => ({
      id: (row as { id: number }).id,
      salesPointId: (row as { salesPointId: number }).salesPointId,
      name: (row as { name: string }).name,
      isDefault: (row as { isDefault: number }).isDefault === 1,
      isSalesTank: (row as { isSalesTank: number }).isSalesTank === 1,
      allowsMultiProduct: (row as { allowsMultiProduct: number }).allowsMultiProduct === 1,
    }));

  const productFilterParts = uiBottledFilterParts(productFilter);
  function mapProductRow(row: {
    productId: number;
    productName: string;
    uom: string | null;
    isBottled: number;
    productCode: string | null;
    stockIntakeGroup?: string | null;
    stockPoolProductId?: number | null;
    excludeFromSales?: number | null;
    omitsStorageLocation?: number | null;
  }): StockBootstrap["products"][number] {
    const isBottled = row.isBottled === 1;
    const stockIntakeGroup: StockIntakeGroup | null =
      row.stockIntakeGroup === "PALM_OIL" ||
      row.stockIntakeGroup === "SLUDGE_OIL" ||
      row.stockIntakeGroup === "PALM_KERNEL"
        ? row.stockIntakeGroup
        : null;
    const excludeFromSales = Number(row.excludeFromSales ?? 0) !== 0;
    return {
      productId: row.productId,
      productName: row.productName,
      isBottled,
      isLoosePalmOil: isLooseLpoProduct({
        productCode: row.productCode,
        productName: row.productName,
        isBottled,
      }),
      omitsStorageLocation: Number(row.omitsStorageLocation ?? 0) !== 0,
      uom: uomForBottled(isBottled, row.uom),
      stockIntakeGroup,
      stockPoolProductId: row.stockPoolProductId ?? null,
      excludeFromSales,
      isStockPool: isStockPoolProduct({
        excludeFromSales,
        stockPoolProductId: row.stockPoolProductId ?? null,
        stockIntakeGroup,
      }),
    };
  }

  const productSelectSql = `SELECT p.productId, p.productName, p.productCode, p.uom,
              COALESCE(pc.isBottled, 0) AS isBottled,
              p.stockIntakeGroup,
              p.stockPoolProductId,
              COALESCE(p.excludeFromSales, 0) AS excludeFromSales,
              COALESCE(p.omitsStorageLocation, 0) AS omitsStorageLocation`;

  const products = db
    .prepare(
      `${productSelectSql}
       FROM Product p
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE ${productFilterParts.clause}
         AND ${storageLocationProductSql("p")}
       ORDER BY p.productName ASC`,
    )
    .all(...productFilterParts.params)
    .map((row) => mapProductRow(row as Parameters<typeof mapProductRow>[0]));

  // Receipt picker follows the module filter (main Stock = loose;
  // Bottle Stock Reception = bottled at Bota).
  const receiptProducts = db
    .prepare(
      `${productSelectSql}
       FROM Product p
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE ${productFilterParts.clause}
       ORDER BY p.productName ASC`,
    )
    .all(...productFilterParts.params)
    .map((row) => mapProductRow(row as Parameters<typeof mapProductRow>[0]));

  const documentNumberSettings = loadStockDocumentNumberSettings();
  const botaSalesPointId =
    salesPoints.find((sp) => sp.name.toUpperCase().includes("BOTA"))?.id ?? null;

  return {
    productFilter,
    canManageReceipts: canPostReceipts,
    canInitiateTransfers,
    canDispatchTransfers,
    canReceiveTransfers,
    canCancelTransfers,
    canPostAdjustments,
    canReclassifyStock: canPostAdjustments,
    canCancelDocuments:
      canPostReceipts || canCancelTransfers || canPostAdjustments,
    canDraftReceipts,
    canDraftTransfers,
    canDraftAdjustments,
    canDirectPostReceipts,
    canDirectPostTransfers,
    scopedSalesPointId,
    botaSalesPointId,
    salesPoints,
    storageLocations,
    products,
    receiptProducts,
    autoGenerateReceiptNo: documentNumberSettings.autoGenerateReceiptNo,
    autoGenerateTransferNo: documentNumberSettings.autoGenerateTransferNo,
    transferReceiveUsesDocumentDate: loadStockTransferReceiveUsesDocumentDate(),
    loosePalmOilAllowInterSalesPointTransfer:
      loadLoosePalmOilAllowInterSalesPointTransfer(),
    stockIntakeOilGrouping: loadStockIntakeOilGrouping(),
    onHand: loadOnHand(scopedSalesPointId, productFilter),
    movements:
      productFilter === "bottled"
        ? []
        : loadMovements(scopedSalesPointId, productFilter),
    receipts: loadReceipts(scopedSalesPointId, productFilter),
    transfers: loadTransfers(scopedSalesPointId, productFilter),
    adjustments: loadAdjustments(scopedSalesPointId, productFilter),
  };
}

export function getStockIntakeOilGroupingStatus(): {
  enabled: boolean;
  poolTotalQty: number;
} {
  const db = getDatabase();
  return {
    enabled: loadStockIntakeOilGrouping(db),
    poolTotalQty: getIntakePoolTotalQty(db),
  };
}

export function applyStockIntakeOilGrouping(
  userId: string,
  enabled: boolean,
): { ok: true } | { ok: false; error: string } {
  try {
    const db = getDatabase();
    const current = loadStockIntakeOilGrouping(db);
    if (current === enabled) {
      db.prepare(
        `UPDATE CompanySettings
         SET stockIntakeOilGrouping = ?, updatedAt = datetime('now')
         WHERE id = 'default'`,
      ).run(enabled ? 1 : 0);
      return { ok: true };
    }

    const tx = db.transaction(() => {
      if (enabled) {
        consolidateIntakePoolBalances(db, userId);
      } else {
        splitIntakePoolBalancesToLandingProducts(db, userId);
      }

      db.prepare(
        `UPDATE CompanySettings
         SET stockIntakeOilGrouping = ?, updatedAt = datetime('now')
         WHERE id = 'default'`,
      ).run(enabled ? 1 : 0);
    });
    tx();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not update stock intake setting.",
    };
  }
}

function loadOnHand(
  scopedSalesPointId: number | null,
  productFilter: StockProductFilter,
) {
  const db = getDatabase();
  const filterParts = uiBottledFilterParts(productFilter);
  const rows = scopedSalesPointId
    ? (db
        .prepare(
          `SELECT sb.salesPointId, sp.name AS salesPointName, sb.storageLocationId,
                  COALESCE(l.locationName, '—') AS storageLocationName, sb.productId, p.productName,
                  p.uom, COALESCE(pc.isBottled, 0) AS isBottled, sb.condition, sb.qty
           FROM StockBalance sb
           JOIN SalesPoint sp ON sp.id = sb.salesPointId
           LEFT JOIN StorageLocation sl ON sl.id = sb.storageLocationId
           LEFT JOIN Location l ON l.id = sl.locationId
           JOIN Product p ON p.productId = sb.productId
           LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
           WHERE sb.salesPointId = ?
             AND ${filterParts.clause}
           ORDER BY sp.name ASC, COALESCE(l.locationName, '') ASC, p.productName ASC`,
        )
        .all(scopedSalesPointId, ...filterParts.params) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT sb.salesPointId, sp.name AS salesPointName, sb.storageLocationId,
                  COALESCE(l.locationName, '—') AS storageLocationName, sb.productId, p.productName,
                  p.uom, COALESCE(pc.isBottled, 0) AS isBottled, sb.condition, sb.qty
           FROM StockBalance sb
           JOIN SalesPoint sp ON sp.id = sb.salesPointId
           LEFT JOIN StorageLocation sl ON sl.id = sb.storageLocationId
           LEFT JOIN Location l ON l.id = sl.locationId
           JOIN Product p ON p.productId = sb.productId
           LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
           WHERE ${filterParts.clause}
           ORDER BY sp.name ASC, COALESCE(l.locationName, '') ASC, p.productName ASC`,
        )
        .all(...filterParts.params) as Array<Record<string, unknown>>);

  return rows.map((row) => ({
    salesPointId: row.salesPointId as number,
    salesPointName: row.salesPointName as string,
    storageLocationId: (row.storageLocationId as number | null) ?? null,
    storageLocationName: row.storageLocationName as string,
    productId: row.productId as number,
    productName: row.productName as string,
    uom: uomForBottled((row.isBottled as number) === 1, row.uom as string | null),
    condition: row.condition as "SELLABLE" | "UNSELLABLE",
    qty: String(row.qty),
  }));
}

/**
 * Reconstruct sellable/unsellable balances from movements through asOfDate (inclusive).
 * Used by transfer drafting so available qty matches the dispatch date.
 */
export function listOnHandAsOf(
  userId: string,
  input: {
    asOfDate: string;
    salesPointId?: number | null;
    productFilter?: StockProductFilter | null;
  },
): StockBalanceRow[] {
  const actor = getActor(userId);
  const productFilter = normalizeStockProductFilter(input.productFilter);
  if (productFilter === "bottled") {
    if (
      !canAccessRoute(actor.role, STOCK_MODULE_ROUTE_ID) &&
      !canAccessRoute(actor.role, BOTTLED_STOCK_ROUTE_ID)
    ) {
      throw new Error("Not allowed to view stock balances.");
    }
  } else if (
    !canAccessRoute(actor.role, STOCK_MODULE_ROUTE_ID) &&
    !canAccessRoute(actor.role, "stock-transfers") &&
    !canAccessRoute(actor.role, "stock-balance") &&
    !canAccessRoute(actor.role, BOTTLED_STOCK_ROUTE_ID)
  ) {
    throw new Error("Not allowed to view stock balances.");
  }

  const asOf = String(input.asOfDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("Invalid as-of date.");
  }

  const scoped = scopedSalesPointIdForActor(actor);
  const requested =
    input.salesPointId != null && Number.isFinite(Number(input.salesPointId))
      ? Number(input.salesPointId)
      : null;
  if (requested != null) {
    assertTransferInitiateSalesPointScope(actor, requested);
  }
  const filterSalesPointId = requested ?? scoped;
  const filterByBottled = uiFilterUsesBottledConstraint(productFilter);
  const bottledFlag = productFilter === "bottled" ? 1 : 0;

  const db = getDatabase();
  const balances = loadStockBalancesAsOf(db, asOf).filter((row) => {
    if (filterSalesPointId != null && row.salesPointId !== filterSalesPointId) {
      return false;
    }
    return true;
  });
  if (balances.length === 0) {
    return [];
  }

  const salesPointStmt = db.prepare(`SELECT name FROM SalesPoint WHERE id = ?`);
  const locationStmt = db.prepare(
    `SELECT l.locationName AS name
     FROM StorageLocation sl
     JOIN Location l ON l.id = sl.locationId
     WHERE sl.id = ?`,
  );
  const productStmt = db.prepare(
    `SELECT p.productName, p.uom, COALESCE(pc.isBottled, 0) AS isBottled
     FROM Product p
     LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
     WHERE p.productId = ?`,
  );

  const out: StockBalanceRow[] = [];
  for (const bal of balances) {
    const product = productStmt.get(bal.productId) as
      | { productName: string; uom: string | null; isBottled: number }
      | undefined;
    if (filterByBottled && (product?.isBottled ?? 0) !== bottledFlag) {
      continue;
    }
    // Transfer form uses this list: never offer more than current on-hand for
    // sellable rows (backdated as-of can exceed live after later outs).
    let qty = bal.qty;
    if (bal.condition === "SELLABLE") {
      const live = getLiveSellableBalance(
        db,
        bal.salesPointId,
        bal.productId,
        bal.storageLocationId,
      );
      qty = Math.min(qty, Math.max(0, live));
      if (Math.abs(qty) <= 0.000001) {
        continue;
      }
    }
    const sp = salesPointStmt.get(bal.salesPointId) as { name: string } | undefined;
    const loc =
      bal.storageLocationId == null
        ? null
        : (locationStmt.get(bal.storageLocationId) as { name: string } | undefined);
    out.push({
      salesPointId: bal.salesPointId,
      salesPointName: sp?.name ?? `Collection point ${bal.salesPointId}`,
      storageLocationId: bal.storageLocationId,
      storageLocationName:
        bal.storageLocationId == null
          ? "—"
          : (loc?.name ?? `Location ${bal.storageLocationId}`),
      productId: bal.productId,
      productName: product?.productName ?? `Product ${bal.productId}`,
      uom: uomForBottled((product?.isBottled ?? 0) === 1, product?.uom ?? null),
      condition: bal.condition,
      qty: formatQty(qty),
    });
  }

  out.sort((a, b) => {
    const bySp = a.salesPointName.localeCompare(b.salesPointName);
    if (bySp !== 0) return bySp;
    const byLoc = a.storageLocationName.localeCompare(b.storageLocationName);
    if (byLoc !== 0) return byLoc;
    return a.productName.localeCompare(b.productName);
  });
  return out;
}

function loadMovements(
  scopedSalesPointId: number | null,
  productFilter: StockProductFilter,
): StockMovementRow[] {
  const db = getDatabase();
  const filterParts = uiBottledFilterParts(productFilter);
  const rows = scopedSalesPointId
    ? (db
        .prepare(
          `SELECT sm.id, sm.occurredAt, sm.salesPointId, sp.name AS salesPointName,
                  sm.storageLocationId, COALESCE(l.locationName, '—') AS storageLocationName,
                  sm.productId, p.productName, p.uom, COALESCE(pc.isBottled, 0) AS isBottled,
                  sm.kind, sm.condition, sm.qty, sm.sourceKind, sm.sourceId,
                  sm.userId, u.name AS userName, sm.notes, sm.createdAt
           FROM StockMovement sm
           JOIN SalesPoint sp ON sp.id = sm.salesPointId
           LEFT JOIN StorageLocation sl ON sl.id = sm.storageLocationId
           LEFT JOIN Location l ON l.id = sl.locationId
           JOIN Product p ON p.productId = sm.productId
           LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
           JOIN User u ON u.id = sm.userId
           WHERE sm.salesPointId = ?
             AND ${filterParts.clause}
           ORDER BY sm.occurredAt DESC, sm.createdAt DESC
           LIMIT 200`,
        )
        .all(scopedSalesPointId, ...filterParts.params) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT sm.id, sm.occurredAt, sm.salesPointId, sp.name AS salesPointName,
                  sm.storageLocationId, COALESCE(l.locationName, '—') AS storageLocationName,
                  sm.productId, p.productName, p.uom, COALESCE(pc.isBottled, 0) AS isBottled,
                  sm.kind, sm.condition, sm.qty, sm.sourceKind, sm.sourceId,
                  sm.userId, u.name AS userName, sm.notes, sm.createdAt
           FROM StockMovement sm
           JOIN SalesPoint sp ON sp.id = sm.salesPointId
           LEFT JOIN StorageLocation sl ON sl.id = sm.storageLocationId
           LEFT JOIN Location l ON l.id = sl.locationId
           JOIN Product p ON p.productId = sm.productId
           LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
           JOIN User u ON u.id = sm.userId
           WHERE ${filterParts.clause}
           ORDER BY sm.occurredAt DESC, sm.createdAt DESC
           LIMIT 200`,
        )
        .all(...filterParts.params) as Array<Record<string, unknown>>);

  const docNoByKey = new Map<string, string>();
  const carryForwardByKey = new Map<string, boolean>();
  for (const row of rows) {
    const key = `${row.sourceKind}:${row.sourceId}`;
    if (docNoByKey.has(key)) {
      continue;
    }
    const sourceKind = String(row.sourceKind);
    const sourceId = String(row.sourceId);
    if (sourceKind === "RECEIPT") {
      const receipt = db
        .prepare(`SELECT receiptNo FROM StockReceipt WHERE id = ?`)
        .get(sourceId) as { receiptNo: string } | undefined;
      if (receipt) docNoByKey.set(key, receipt.receiptNo);
    } else if (sourceKind === "TRANSFER") {
      const transfer = db
        .prepare(`SELECT transferNo FROM StockTransfer WHERE id = ?`)
        .get(sourceId) as { transferNo: string } | undefined;
      if (transfer) docNoByKey.set(key, transfer.transferNo);
    } else if (sourceKind === "SALE") {
      const sale = db
        .prepare(`SELECT invoiceNo FROM Sale WHERE id = ?`)
        .get(sourceId) as { invoiceNo: string } | undefined;
      if (sale) docNoByKey.set(key, sale.invoiceNo);
    } else if (sourceKind === "ADJUSTMENT") {
      const adjustment = db
        .prepare(
          `SELECT adjustmentNo, COALESCE(sourceKind, 'NORMAL') AS sourceKind
           FROM StockAdjustment WHERE id = ?`,
        )
        .get(sourceId) as { adjustmentNo: string; sourceKind: string } | undefined;
      if (adjustment) {
        docNoByKey.set(key, adjustment.adjustmentNo);
        carryForwardByKey.set(key, adjustment.sourceKind === "CARRY_FORWARD");
      }
    }
  }

  return rows.map((row) => ({
    id: String(row.id),
    occurredAtIso: String(row.occurredAt),
    salesPointId: row.salesPointId as number,
    salesPointName: row.salesPointName as string,
    storageLocationId: (row.storageLocationId as number | null) ?? null,
    storageLocationName: row.storageLocationName as string,
    productId: row.productId as number,
    productName: row.productName as string,
    uom: uomForBottled((row.isBottled as number) === 1, row.uom as string | null),
    kind: row.kind as StockMovementKind,
    condition: row.condition as "SELLABLE" | "UNSELLABLE",
    qty: String(row.qty),
    signedQty: movementSignedDelta(row.kind as StockMovementKind, String(row.qty)),
    sourceKind: String(row.sourceKind),
    sourceId: String(row.sourceId),
    documentNo: docNoByKey.get(`${row.sourceKind}:${row.sourceId}`) ?? null,
    userId: String(row.userId),
    userName: row.userName as string,
    notes: row.notes ? String(row.notes) : null,
    createdAtIso: String(row.createdAt),
    isCarryForward:
      carryForwardByKey.get(`${row.sourceKind}:${row.sourceId}`) === true,
  }));
}

function loadReceipts(
  scopedSalesPointId: number | null,
  productFilter: StockProductFilter,
): ReceiptListRow[] {
  const db = getDatabase();
  // Stock (bulk) screen owns all receipts (bottled + other). Bottled variant has no receipts tab.
  const filterByProduct = productFilter === "bottled";
  const bottledFlag = 1;
  const productExists = `EXISTS (
    SELECT 1 FROM StockReceiptLine rl
    JOIN Product rp ON rp.productId = rl.productId
    LEFT JOIN ProductCat rpc ON rpc.productCatId = rp.productCatId
    WHERE rl.receiptId = r.id AND COALESCE(rpc.isBottled, 0) = ?
  )`;

  const rows = (() => {
    if (scopedSalesPointId) {
      if (filterByProduct) {
        return db
          .prepare(
            `SELECT r.id, r.receiptNo, r.salesPointId, sp.name AS salesPointName,
                    r.receivedAt, r.supplierLabel, r.consignmentNoteNo, r.status,
                    r.postedAt, r.createdAt,
                    cu.name AS createdByName, pu.name AS postedByName
             FROM StockReceipt r
             JOIN SalesPoint sp ON sp.id = r.salesPointId
             JOIN User cu ON cu.id = r.createdByUserId
             LEFT JOIN User pu ON pu.id = r.postedByUserId
             WHERE r.salesPointId = ?
               AND ${productExists}
             ORDER BY r.receivedAt DESC, r.createdAt DESC
             LIMIT 100`,
          )
          .all(scopedSalesPointId, bottledFlag) as Array<Record<string, unknown>>;
      }
      return db
        .prepare(
          `SELECT r.id, r.receiptNo, r.salesPointId, sp.name AS salesPointName,
                  r.receivedAt, r.supplierLabel, r.consignmentNoteNo, r.status,
                  r.postedAt, r.createdAt,
                  cu.name AS createdByName, pu.name AS postedByName
           FROM StockReceipt r
           JOIN SalesPoint sp ON sp.id = r.salesPointId
           JOIN User cu ON cu.id = r.createdByUserId
           LEFT JOIN User pu ON pu.id = r.postedByUserId
           WHERE r.salesPointId = ?
           ORDER BY r.receivedAt DESC, r.createdAt DESC
           LIMIT 100`,
        )
        .all(scopedSalesPointId) as Array<Record<string, unknown>>;
    }
    if (filterByProduct) {
      return db
        .prepare(
          `SELECT r.id, r.receiptNo, r.salesPointId, sp.name AS salesPointName,
                  r.receivedAt, r.supplierLabel, r.consignmentNoteNo, r.status,
                  r.postedAt, r.createdAt,
                  cu.name AS createdByName, pu.name AS postedByName
           FROM StockReceipt r
           JOIN SalesPoint sp ON sp.id = r.salesPointId
           JOIN User cu ON cu.id = r.createdByUserId
           LEFT JOIN User pu ON pu.id = r.postedByUserId
           WHERE ${productExists}
           ORDER BY r.receivedAt DESC, r.createdAt DESC
           LIMIT 100`,
        )
        .all(bottledFlag) as Array<Record<string, unknown>>;
    }
    return db
      .prepare(
        `SELECT r.id, r.receiptNo, r.salesPointId, sp.name AS salesPointName,
                r.receivedAt, r.supplierLabel, r.consignmentNoteNo, r.status,
                r.postedAt, r.createdAt,
                cu.name AS createdByName, pu.name AS postedByName
         FROM StockReceipt r
         JOIN SalesPoint sp ON sp.id = r.salesPointId
         JOIN User cu ON cu.id = r.createdByUserId
         LEFT JOIN User pu ON pu.id = r.postedByUserId
         ORDER BY r.receivedAt DESC, r.createdAt DESC
         LIMIT 100`,
      )
      .all() as Array<Record<string, unknown>>;
  })();

  return rows.map((row) => {
    const lines = filterByProduct
      ? (db
          .prepare(
            `SELECT rl.qty
             FROM StockReceiptLine rl
             JOIN Product p ON p.productId = rl.productId
             LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
             WHERE rl.receiptId = ?
               AND ${productFilterSql("pc")}`,
          )
          .all(String(row.id), bottledFlag) as Array<{ qty: string }>)
      : (db
          .prepare(`SELECT qty FROM StockReceiptLine WHERE receiptId = ?`)
          .all(String(row.id)) as Array<{ qty: string }>);
    return {
      id: String(row.id),
      receiptNo: String(row.receiptNo),
      salesPointId: row.salesPointId as number,
      salesPointName: row.salesPointName as string,
      receivedAtIso: String(row.receivedAt).slice(0, 10),
      supplierLabel: String(row.supplierLabel),
      consignmentNoteNo: row.consignmentNoteNo
        ? String(row.consignmentNoteNo)
        : null,
      status: row.status as ReceiptListRow["status"],
      totalQty: sumQty(lines.map((line) => line.qty)),
      lineCount: lines.length,
      createdByName: row.createdByName as string,
      postedByName: (row.postedByName as string | null) ?? null,
      postedAtIso: row.postedAt ? String(row.postedAt) : null,
      createdAtIso: String(row.createdAt),
    };
  });
}

function transferLocationSummary(
  db: ReturnType<typeof getDatabase>,
  transferId: string,
  transferMode: TransferMode,
): string | null {
  if (transferMode !== "INTRA_SALES_POINT") {
    return null;
  }

  const line = db
    .prepare(
      `SELECT fl.locationName AS fromName, tl.locationName AS toName
       FROM StockTransferLine l
       JOIN StorageLocation fsl ON fsl.id = l.fromStorageLocationId
       JOIN Location fl ON fl.id = fsl.locationId
       LEFT JOIN StorageLocation tsl ON tsl.id = l.toStorageLocationId
       LEFT JOIN Location tl ON tl.id = tsl.locationId
       WHERE l.transferId = ?
       ORDER BY l.id ASC
       LIMIT 1`,
    )
    .get(transferId) as { fromName: string; toName: string | null } | undefined;

  if (!line) {
    return null;
  }
  if (!line.toName) {
    return line.fromName;
  }
  return `${line.fromName} → ${line.toName}`;
}

function normalizeOptionalTransferText(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalTransferDate(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 10);
}

function mapTransferConsignmentFields(
  row: Record<string, unknown>,
): TransferConsignmentFields {
  return {
    consignedBy: row.consignedBy ? String(row.consignedBy) : null,
    consDesign: row.consDesign ? String(row.consDesign) : null,
    consDate: row.consDate ? String(row.consDate).slice(0, 10) : null,
    receiveBy: row.receiveBy ? String(row.receiveBy) : null,
    receiveByDesign: row.receiveByDesign ? String(row.receiveByDesign) : null,
    receiveDate: row.receiveDate ? String(row.receiveDate).slice(0, 10) : null,
  };
}

function loadTransfers(
  scopedSalesPointId: number | null,
  productFilter: StockProductFilter,
): TransferListRow[] {
  const db = getDatabase();
  const filterByProduct = uiFilterUsesBottledConstraint(productFilter);
  const bottledFlag = productFilter === "bottled" ? 1 : 0;
  const productExists = `EXISTS (
    SELECT 1 FROM StockTransferLine tl
    JOIN Product tp ON tp.productId = tl.productId
    LEFT JOIN ProductCat tpc ON tpc.productCatId = tp.productCatId
    WHERE tl.transferId = t.id AND COALESCE(tpc.isBottled, 0) = ?
  )`;

  const rows = (() => {
    if (scopedSalesPointId) {
      if (filterByProduct) {
        return db
          .prepare(
            `SELECT t.id, t.transferNo, t.fromSalesPointId, fsp.name AS fromSalesPointName,
                    t.toSalesPointId, tsp.name AS toSalesPointName, t.dispatchedAt, t.receivedAt,
                    t.status, t.createdAt, cu.name AS createdByName, du.name AS dispatchedByName,
                    ru.name AS receivedByName
             FROM StockTransfer t
             JOIN SalesPoint fsp ON fsp.id = t.fromSalesPointId
             JOIN SalesPoint tsp ON tsp.id = t.toSalesPointId
             JOIN User cu ON cu.id = t.createdByUserId
             LEFT JOIN User du ON du.id = t.dispatchedByUserId
             LEFT JOIN User ru ON ru.id = t.receivedByUserId
             WHERE (t.fromSalesPointId = ? OR t.toSalesPointId = ?)
               AND ${productExists}
             ORDER BY t.createdAt DESC
             LIMIT 100`,
          )
          .all(scopedSalesPointId, scopedSalesPointId, bottledFlag) as Array<
          Record<string, unknown>
        >;
      }
      return db
        .prepare(
          `SELECT t.id, t.transferNo, t.fromSalesPointId, fsp.name AS fromSalesPointName,
                  t.toSalesPointId, tsp.name AS toSalesPointName, t.dispatchedAt, t.receivedAt,
                  t.status, t.createdAt, cu.name AS createdByName, du.name AS dispatchedByName,
                  ru.name AS receivedByName
           FROM StockTransfer t
           JOIN SalesPoint fsp ON fsp.id = t.fromSalesPointId
           JOIN SalesPoint tsp ON tsp.id = t.toSalesPointId
           JOIN User cu ON cu.id = t.createdByUserId
           LEFT JOIN User du ON du.id = t.dispatchedByUserId
           LEFT JOIN User ru ON ru.id = t.receivedByUserId
           WHERE (t.fromSalesPointId = ? OR t.toSalesPointId = ?)
           ORDER BY t.createdAt DESC
           LIMIT 100`,
        )
        .all(scopedSalesPointId, scopedSalesPointId) as Array<Record<string, unknown>>;
    }
    if (filterByProduct) {
      return db
        .prepare(
          `SELECT t.id, t.transferNo, t.fromSalesPointId, fsp.name AS fromSalesPointName,
                  t.toSalesPointId, tsp.name AS toSalesPointName, t.dispatchedAt, t.receivedAt,
                  t.status, t.createdAt, cu.name AS createdByName, du.name AS dispatchedByName,
                  ru.name AS receivedByName
           FROM StockTransfer t
           JOIN SalesPoint fsp ON fsp.id = t.fromSalesPointId
           JOIN SalesPoint tsp ON tsp.id = t.toSalesPointId
           JOIN User cu ON cu.id = t.createdByUserId
           LEFT JOIN User du ON du.id = t.dispatchedByUserId
           LEFT JOIN User ru ON ru.id = t.receivedByUserId
           WHERE ${productExists}
           ORDER BY t.createdAt DESC
           LIMIT 100`,
        )
        .all(bottledFlag) as Array<Record<string, unknown>>;
    }
    return db
      .prepare(
        `SELECT t.id, t.transferNo, t.fromSalesPointId, fsp.name AS fromSalesPointName,
                t.toSalesPointId, tsp.name AS toSalesPointName, t.dispatchedAt, t.receivedAt,
                t.status, t.createdAt, cu.name AS createdByName, du.name AS dispatchedByName,
                ru.name AS receivedByName
         FROM StockTransfer t
         JOIN SalesPoint fsp ON fsp.id = t.fromSalesPointId
         JOIN SalesPoint tsp ON tsp.id = t.toSalesPointId
         JOIN User cu ON cu.id = t.createdByUserId
         LEFT JOIN User du ON du.id = t.dispatchedByUserId
         LEFT JOIN User ru ON ru.id = t.receivedByUserId
         ORDER BY t.createdAt DESC
         LIMIT 100`,
      )
      .all() as Array<Record<string, unknown>>;
  })();

  return rows.map((row) => {
    const lines = filterByProduct
      ? (db
          .prepare(
            `SELECT tl.qty, p.productName
             FROM StockTransferLine tl
             JOIN Product p ON p.productId = tl.productId
             LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
             WHERE tl.transferId = ?
               AND ${productFilterSql("pc")}`,
          )
          .all(String(row.id), bottledFlag) as Array<{ qty: string; productName: string }>)
      : (db
          .prepare(
            `SELECT tl.qty, p.productName
             FROM StockTransferLine tl
             JOIN Product p ON p.productId = tl.productId
             WHERE tl.transferId = ?`,
          )
          .all(String(row.id)) as Array<{ qty: string; productName: string }>);
    const fromSalesPointId = row.fromSalesPointId as number;
    const toSalesPointId = row.toSalesPointId as number;
    const transferMode = resolveTransferMode(fromSalesPointId, toSalesPointId);
    const transferId = String(row.id);
    const productNames = [
      ...new Set(
        lines
          .map((line) => String(line.productName ?? "").trim())
          .filter((name) => name.length > 0),
      ),
    ];
    return {
      id: transferId,
      transferNo: String(row.transferNo),
      transferMode,
      locationSummary: transferLocationSummary(db, transferId, transferMode),
      productSummary: productNames.length > 0 ? productNames.join(", ") : null,
      fromSalesPointId,
      fromSalesPointName: row.fromSalesPointName as string,
      toSalesPointId,
      toSalesPointName: row.toSalesPointName as string,
      dispatchedAtIso: row.dispatchedAt ? String(row.dispatchedAt).slice(0, 10) : null,
      receivedAtIso: row.receivedAt ? String(row.receivedAt).slice(0, 10) : null,
      status: row.status as TransferListRow["status"],
      totalQty: sumQty(lines.map((line) => line.qty)),
      lineCount: lines.length,
      createdByName: row.createdByName as string,
      dispatchedByName: (row.dispatchedByName as string | null) ?? null,
      receivedByName: (row.receivedByName as string | null) ?? null,
      createdAtIso: String(row.createdAt),
    };
  });
}

function loadAdjustments(
  scopedSalesPointId: number | null,
  productFilter: StockProductFilter,
): AdjustmentListRow[] {
  const db = getDatabase();
  const filterByProduct = uiFilterUsesBottledConstraint(productFilter);
  const bottledFlag = productFilter === "bottled" ? 1 : 0;
  const productExists = `EXISTS (
    SELECT 1 FROM StockAdjustmentLine al
    JOIN Product ap ON ap.productId = al.productId
    LEFT JOIN ProductCat apc ON apc.productCatId = ap.productCatId
    WHERE al.adjustmentId = a.id AND COALESCE(apc.isBottled, 0) = ?
  )`;
  const rows = (() => {
    if (scopedSalesPointId) {
      if (filterByProduct) {
        return db
          .prepare(
            `SELECT a.id, a.adjustmentNo, a.salesPointId, sp.name AS salesPointName,
                    a.occurredAt, a.reason, a.status, COALESCE(a.sourceKind, 'NORMAL') AS sourceKind,
                    a.postedAt, a.createdAt,
                    cu.name AS createdByName, pu.name AS postedByName
             FROM StockAdjustment a
             JOIN SalesPoint sp ON sp.id = a.salesPointId
             JOIN User cu ON cu.id = a.createdByUserId
             LEFT JOIN User pu ON pu.id = a.postedByUserId
             WHERE a.salesPointId = ?
               AND ${productExists}
             ORDER BY a.occurredAt DESC, a.createdAt DESC
             LIMIT 100`,
          )
          .all(scopedSalesPointId, bottledFlag) as Array<Record<string, unknown>>;
      }
      return db
        .prepare(
          `SELECT a.id, a.adjustmentNo, a.salesPointId, sp.name AS salesPointName,
                  a.occurredAt, a.reason, a.status, COALESCE(a.sourceKind, 'NORMAL') AS sourceKind,
                  a.postedAt, a.createdAt,
                  cu.name AS createdByName, pu.name AS postedByName
           FROM StockAdjustment a
           JOIN SalesPoint sp ON sp.id = a.salesPointId
           JOIN User cu ON cu.id = a.createdByUserId
           LEFT JOIN User pu ON pu.id = a.postedByUserId
           WHERE a.salesPointId = ?
           ORDER BY a.occurredAt DESC, a.createdAt DESC
           LIMIT 100`,
        )
        .all(scopedSalesPointId) as Array<Record<string, unknown>>;
    }
    if (filterByProduct) {
      return db
        .prepare(
          `SELECT a.id, a.adjustmentNo, a.salesPointId, sp.name AS salesPointName,
                  a.occurredAt, a.reason, a.status, COALESCE(a.sourceKind, 'NORMAL') AS sourceKind,
                  a.postedAt, a.createdAt,
                  cu.name AS createdByName, pu.name AS postedByName
           FROM StockAdjustment a
           JOIN SalesPoint sp ON sp.id = a.salesPointId
           JOIN User cu ON cu.id = a.createdByUserId
           LEFT JOIN User pu ON pu.id = a.postedByUserId
           WHERE ${productExists}
           ORDER BY a.occurredAt DESC, a.createdAt DESC
           LIMIT 100`,
        )
        .all(bottledFlag) as Array<Record<string, unknown>>;
    }
    return db
      .prepare(
        `SELECT a.id, a.adjustmentNo, a.salesPointId, sp.name AS salesPointName,
                a.occurredAt, a.reason, a.status, COALESCE(a.sourceKind, 'NORMAL') AS sourceKind,
                a.postedAt, a.createdAt,
                cu.name AS createdByName, pu.name AS postedByName
         FROM StockAdjustment a
         JOIN SalesPoint sp ON sp.id = a.salesPointId
         JOIN User cu ON cu.id = a.createdByUserId
         LEFT JOIN User pu ON pu.id = a.postedByUserId
         ORDER BY a.occurredAt DESC, a.createdAt DESC
         LIMIT 100`,
      )
      .all() as Array<Record<string, unknown>>;
  })();

  return rows.map((row) => {
    const lineCount = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM StockAdjustmentLine WHERE adjustmentId = ?`)
        .get(String(row.id)) as { count: number }
    ).count;
    return {
      id: String(row.id),
      adjustmentNo: String(row.adjustmentNo),
      salesPointId: row.salesPointId as number,
      salesPointName: row.salesPointName as string,
      occurredAtIso: String(row.occurredAt).slice(0, 10),
      reason: String(row.reason),
      status: row.status as AdjustmentListRow["status"],
      sourceKind:
        String(row.sourceKind) === "CARRY_FORWARD" ? "CARRY_FORWARD" : "NORMAL",
      lineCount,
      createdByName: row.createdByName as string,
      postedByName: (row.postedByName as string | null) ?? null,
      postedAtIso: row.postedAt ? String(row.postedAt) : null,
      createdAtIso: String(row.createdAt),
    };
  });
}

export function loadReceiptDetail(id: string, userId: string): ReceiptDetail | null {
  const actor = getActor(userId);
  const scopedSalesPointId = scopedSalesPointIdForActor(actor);
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT r.id, r.receiptNo, r.salesPointId, sp.name AS salesPointName,
              r.receivedAt, r.supplierLabel, r.status, r.notes, r.postedAt, r.createdAt,
              r.consignmentNoteNo, r.consignedBy, r.consDesign, r.consDate,
              r.receiveBy, r.receiveByDesign, r.receiveDate,
              cu.name AS createdByName, pu.name AS postedByName
       FROM StockReceipt r
       JOIN SalesPoint sp ON sp.id = r.salesPointId
       JOIN User cu ON cu.id = r.createdByUserId
       LEFT JOIN User pu ON pu.id = r.postedByUserId
       WHERE r.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }
  if (scopedSalesPointId != null && row.salesPointId !== scopedSalesPointId) {
    return null;
  }

  const lines = db
    .prepare(
      `SELECT l.id, l.productId, p.productName, p.uom, COALESCE(pc.isBottled, 0) AS isBottled,
              l.qty, l.storageLocationId, loc.locationName AS storageLocationName
       FROM StockReceiptLine l
       JOIN Product p ON p.productId = l.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       LEFT JOIN StorageLocation sl ON sl.id = l.storageLocationId
       LEFT JOIN Location loc ON loc.id = sl.locationId
       WHERE l.receiptId = ?
       ORDER BY l.id ASC`,
    )
    .all(id) as Array<Record<string, unknown>>;

  return {
    id: String(row.id),
    receiptNo: String(row.receiptNo),
    salesPointId: row.salesPointId as number,
    salesPointName: row.salesPointName as string,
    receivedAtIso: String(row.receivedAt).slice(0, 10),
    supplierLabel: String(row.supplierLabel),
    consignmentNoteNo: row.consignmentNoteNo
      ? String(row.consignmentNoteNo)
      : null,
    status: row.status as ReceiptDetail["status"],
    totalQty: sumQty(lines.map((line) => String(line.qty))),
    lineCount: lines.length,
    createdByName: row.createdByName as string,
    postedByName: (row.postedByName as string | null) ?? null,
    postedAtIso: row.postedAt ? String(row.postedAt) : null,
    createdAtIso: String(row.createdAt),
    notes: row.notes ? String(row.notes) : null,
    consignedBy: row.consignedBy ? String(row.consignedBy) : null,
    consDesign: row.consDesign ? String(row.consDesign) : null,
    consDate: row.consDate ? String(row.consDate) : null,
    receiveBy: row.receiveBy ? String(row.receiveBy) : null,
    receiveByDesign: row.receiveByDesign ? String(row.receiveByDesign) : null,
    receiveDate: row.receiveDate ? String(row.receiveDate) : null,
    lines: lines.map((line) => ({
      id: String(line.id),
      productId: line.productId as number,
      productName: line.productName as string,
      uom: uomForBottled((line.isBottled as number) === 1, line.uom as string | null),
      qty: String(line.qty),
      storageLocationId: (line.storageLocationId as number | null) ?? null,
      storageLocationName:
        line.storageLocationId == null
          ? "—"
          : String(line.storageLocationName ?? "—"),
    })),
  };
}

export function loadTransferDetail(id: string, userId: string): TransferDetail | null {
  const actor = getActor(userId);
  const scopedSalesPointId = scopedSalesPointIdForActor(actor);
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT t.id, t.transferNo, t.fromSalesPointId, fsp.name AS fromSalesPointName,
              t.toSalesPointId, tsp.name AS toSalesPointName, t.dispatchedAt, t.receivedAt,
              t.status, t.notes, t.consignedBy, t.consDesign, t.consDate,
              t.receiveBy, t.receiveByDesign, t.receiveDate,
              t.createdAt, cu.name AS createdByName,
              du.name AS dispatchedByName, ru.name AS receivedByName
       FROM StockTransfer t
       JOIN SalesPoint fsp ON fsp.id = t.fromSalesPointId
       JOIN SalesPoint tsp ON tsp.id = t.toSalesPointId
       JOIN User cu ON cu.id = t.createdByUserId
       LEFT JOIN User du ON du.id = t.dispatchedByUserId
       LEFT JOIN User ru ON ru.id = t.receivedByUserId
       WHERE t.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }
  if (
    scopedSalesPointId != null &&
    row.fromSalesPointId !== scopedSalesPointId &&
    row.toSalesPointId !== scopedSalesPointId
  ) {
    return null;
  }

  const lines = db
    .prepare(
      `SELECT l.id, l.productId, p.productName, p.uom, COALESCE(pc.isBottled, 0) AS isBottled,
              l.qty, l.fromStorageLocationId, fl.locationName AS fromStorageLocationName,
              l.toStorageLocationId, tl.locationName AS toStorageLocationName
       FROM StockTransferLine l
       JOIN Product p ON p.productId = l.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       JOIN StorageLocation fsl ON fsl.id = l.fromStorageLocationId
       JOIN Location fl ON fl.id = fsl.locationId
       LEFT JOIN StorageLocation tsl ON tsl.id = l.toStorageLocationId
       LEFT JOIN Location tl ON tl.id = tsl.locationId
       WHERE l.transferId = ?
       ORDER BY l.id ASC`,
    )
    .all(id) as Array<Record<string, unknown>>;

  const fromSalesPointId = row.fromSalesPointId as number;
  const toSalesPointId = row.toSalesPointId as number;
  const transferMode = resolveTransferMode(fromSalesPointId, toSalesPointId);
  const productNames = [
    ...new Set(
      lines
        .map((line) => String(line.productName ?? "").trim())
        .filter((name) => name.length > 0),
    ),
  ];

  return {
    id: String(row.id),
    transferNo: String(row.transferNo),
    transferMode,
    locationSummary: transferLocationSummary(db, id, transferMode),
    productSummary: productNames.length > 0 ? productNames.join(", ") : null,
    fromSalesPointId,
    fromSalesPointName: row.fromSalesPointName as string,
    toSalesPointId,
    toSalesPointName: row.toSalesPointName as string,
    dispatchedAtIso: row.dispatchedAt ? String(row.dispatchedAt).slice(0, 10) : null,
    receivedAtIso: row.receivedAt ? String(row.receivedAt).slice(0, 10) : null,
    status: row.status as TransferDetail["status"],
    totalQty: sumQty(lines.map((line) => String(line.qty))),
    lineCount: lines.length,
    createdByName: row.createdByName as string,
    dispatchedByName: (row.dispatchedByName as string | null) ?? null,
    receivedByName: (row.receivedByName as string | null) ?? null,
    createdAtIso: String(row.createdAt),
    notes: row.notes ? String(row.notes) : null,
    ...mapTransferConsignmentFields(row),
    lines: lines.map((line) => ({
      id: String(line.id),
      productId: line.productId as number,
      productName: line.productName as string,
      uom: uomForBottled((line.isBottled as number) === 1, line.uom as string | null),
      qty: String(line.qty),
      fromStorageLocationId: line.fromStorageLocationId as number,
      fromStorageLocationName: line.fromStorageLocationName as string,
      toStorageLocationId: (line.toStorageLocationId as number | null) ?? null,
      toStorageLocationName: (line.toStorageLocationName as string | null) ?? null,
    })),
  };
}

function finalizeReceiptPost(
  db: Database.Database,
  userId: string,
  receiptId: string,
  uiProductFilter: StockProductFilter,
): void {
  const existing = db
    .prepare(`SELECT * FROM StockReceipt WHERE id = ?`)
    .get(receiptId) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new Error("Receipt not found.");
  }
  if (existing.status === "POSTED") {
    return;
  }
  if (existing.status !== "DRAFT") {
    throw new Error(`Cannot post a receipt in status ${String(existing.status)}.`);
  }

  const lines = db
    .prepare(`SELECT * FROM StockReceiptLine WHERE receiptId = ?`)
    .all(receiptId) as Array<Record<string, unknown>>;
  if (lines.length === 0) {
    throw new Error("Add at least one line before posting.");
  }
  assertReceiptProductLines(
    db,
    lines.map((line) => ({
      productId: line.productId as number,
      storageLocationId: (line.storageLocationId as number | null) ?? null,
    })),
    documentFilterForLines(
      db,
      uiProductFilter,
      lines.map((line) => line.productId as number),
    ),
  );

  for (const line of lines) {
    const storageLocationId = (line.storageLocationId as number | null) ?? null;
    if (storageLocationId != null) {
      assertStorageLocationForSalesPoint(
        db,
        existing.salesPointId as number,
        storageLocationId,
        "receipt",
      );
    }
    applyMovement(db, {
      salesPointId: existing.salesPointId as number,
      productId: line.productId as number,
      storageLocationId,
      qty: String(line.qty),
      kind: "RECEIPT",
      occurredAt: String(existing.receivedAt),
      userId,
      sourceKind: "RECEIPT",
      sourceId: receiptId,
    });
  }

  db.prepare(
    `UPDATE StockReceipt
     SET status = 'POSTED', postedByUserId = ?, postedAt = datetime('now'), updatedAt = datetime('now')
     WHERE id = ?`,
  ).run(userId, receiptId);
}

function finalizeInternalTransferPost(
  db: Database.Database,
  userId: string,
  transferId: string,
  uiProductFilter: StockProductFilter,
): void {
  const existing = db
    .prepare(`SELECT * FROM StockTransfer WHERE id = ?`)
    .get(transferId) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new Error("Transfer not found.");
  }

  const fromSalesPointId = existing.fromSalesPointId as number;
  const toSalesPointId = existing.toSalesPointId as number;
  if (!isIntraSalesPointTransfer(fromSalesPointId, toSalesPointId)) {
    throw new Error("Only location moves within a collection point can be posted.");
  }

  if (existing.status === "POSTED") {
    return;
  }
  if (existing.status !== "DRAFT") {
    throw new Error(`Cannot post a transfer in status ${String(existing.status)}.`);
  }

  const lines = db
    .prepare(`SELECT * FROM StockTransferLine WHERE transferId = ?`)
    .all(transferId) as Array<Record<string, unknown>>;
  if (lines.length === 0) {
    throw new Error("Add at least one line before posting.");
  }
  assertProductsMatchStockFilter(
    db,
    lines.map((line) => line.productId as number),
    documentFilterForLines(
      db,
      uiProductFilter,
      lines.map((line) => line.productId as number),
    ),
  );

  for (const line of lines) {
    if (line.toStorageLocationId == null) {
      throw new Error("Each line needs a destination storage location.");
    }
  }

  const postedAt = existing.dispatchedAt ? String(existing.dispatchedAt) : nowIso();
  assertTransferLinesAvailableAtSource(
    db,
    fromSalesPointId,
    lines.map((line) => ({
      productId: line.productId as number,
      qty: String(line.qty),
      fromStorageLocationId: line.fromStorageLocationId as number,
    })),
    postedAt,
  );
  for (const line of lines) {
    applyMovement(db, {
      salesPointId: fromSalesPointId,
      productId: line.productId as number,
      storageLocationId: line.fromStorageLocationId as number,
      qty: String(line.qty),
      kind: "TRANSFER_OUT",
      occurredAt: postedAt,
      userId,
      sourceKind: "TRANSFER",
      sourceId: transferId,
    });
    applyMovement(db, {
      salesPointId: fromSalesPointId,
      productId: line.productId as number,
      storageLocationId: line.toStorageLocationId as number,
      qty: String(line.qty),
      kind: "TRANSFER_IN",
      occurredAt: postedAt,
      userId,
      sourceKind: "TRANSFER",
      sourceId: transferId,
    });
  }

  db.prepare(
    `UPDATE StockTransfer
     SET status = 'POSTED', dispatchedAt = ?, receivedAt = ?,
         dispatchedByUserId = ?, receivedByUserId = ?, updatedAt = datetime('now')
     WHERE id = ?`,
  ).run(postedAt, postedAt, userId, userId, transferId);
}

function finalizeTransferDispatch(
  db: Database.Database,
  userId: string,
  transferId: string,
  uiProductFilter: StockProductFilter,
): void {
  const existing = db
    .prepare(`SELECT * FROM StockTransfer WHERE id = ?`)
    .get(transferId) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new Error("Transfer not found.");
  }
  if (
    isIntraSalesPointTransfer(
      existing.fromSalesPointId as number,
      existing.toSalesPointId as number,
    )
  ) {
    throw new Error("Use Post for location moves within a collection point.");
  }
  if (existing.status === "DISPATCHED" || existing.status === "RECEIVED") {
    return;
  }
  if (existing.status !== "DRAFT") {
    throw new Error(`Cannot dispatch a transfer in status ${String(existing.status)}.`);
  }

  const lines = db
    .prepare(`SELECT * FROM StockTransferLine WHERE transferId = ?`)
    .all(transferId) as Array<Record<string, unknown>>;
  if (lines.length === 0) {
    throw new Error("Add at least one line before dispatching.");
  }
  assertProductsMatchStockFilter(
    db,
    lines.map((line) => line.productId as number),
    documentFilterForLines(
      db,
      uiProductFilter,
      lines.map((line) => line.productId as number),
    ),
  );
  assertInterTransferProductsAllowed(
    db,
    lines.map((line) => line.productId as number),
  );

  const dispatchedAt = existing.dispatchedAt
    ? String(existing.dispatchedAt)
    : nowIso();
  assertTransferLinesAvailableAtSource(
    db,
    existing.fromSalesPointId as number,
    lines.map((line) => ({
      productId: line.productId as number,
      qty: String(line.qty),
      fromStorageLocationId: line.fromStorageLocationId as number,
    })),
    dispatchedAt,
  );
  for (const line of lines) {
    applyMovement(db, {
      salesPointId: existing.fromSalesPointId as number,
      productId: line.productId as number,
      storageLocationId: line.fromStorageLocationId as number,
      qty: String(line.qty),
      kind: "TRANSFER_OUT",
      occurredAt: dispatchedAt,
      userId,
      sourceKind: "TRANSFER",
      sourceId: transferId,
    });
  }

  db.prepare(
    `UPDATE StockTransfer
     SET status = 'DISPATCHED', dispatchedAt = ?, dispatchedByUserId = ?, updatedAt = datetime('now')
     WHERE id = ?`,
  ).run(dispatchedAt, userId, transferId);
}

function finalizeTransferReceiveFromStoredLines(
  db: Database.Database,
  userId: string,
  transferId: string,
  uiProductFilter: StockProductFilter,
): void {
  const existing = db
    .prepare(`SELECT * FROM StockTransfer WHERE id = ?`)
    .get(transferId) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new Error("Transfer not found.");
  }
  if (
    isIntraSalesPointTransfer(
      existing.fromSalesPointId as number,
      existing.toSalesPointId as number,
    )
  ) {
    throw new Error("Use Post for location moves within a collection point.");
  }
  if (existing.status === "RECEIVED") {
    return;
  }
  if (existing.status !== "DISPATCHED") {
    throw new Error("Only dispatched transfers can be received.");
  }

  const toSalesPointId = existing.toSalesPointId as number;
  const lines = db
    .prepare(`SELECT * FROM StockTransferLine WHERE transferId = ?`)
    .all(transferId) as Array<Record<string, unknown>>;
  if (lines.length === 0) {
    throw new Error("Add at least one line before receiving.");
  }
  assertProductsMatchStockFilter(
    db,
    lines.map((line) => line.productId as number),
    documentFilterForLines(
      db,
      uiProductFilter,
      lines.map((line) => line.productId as number),
    ),
  );

  for (const line of lines) {
    if (line.toStorageLocationId == null) {
      throw new Error("Assign a receive location for every line.");
    }
    assertStorageLocationForSalesPoint(
      db,
      toSalesPointId,
      line.toStorageLocationId as number,
    );
  }

  const { receivedAt, receiveDate } = resolveTransferReceiveOccurredAt(
    existing.receiveDate != null ? String(existing.receiveDate) : null,
    userId,
  );
  for (const line of lines) {
    applyMovement(db, {
      salesPointId: toSalesPointId,
      productId: line.productId as number,
      storageLocationId: line.toStorageLocationId as number,
      qty: String(line.qty),
      kind: "TRANSFER_IN",
      occurredAt: receivedAt,
      userId,
      sourceKind: "TRANSFER",
      sourceId: transferId,
    });
  }

  db.prepare(
    `UPDATE StockTransfer
     SET status = 'RECEIVED', receivedAt = ?, receivedByUserId = ?,
         receiveDate = COALESCE(?, receiveDate),
         updatedAt = datetime('now')
     WHERE id = ?`,
  ).run(receivedAt, userId, receiveDate, transferId);
}

export async function saveReceipt(
  input: SaveReceiptInput,
): Promise<StockMutationResult> {
  try {
    const online = input.id
      ? requireCommandApiOnlineCached()
      : await requireCommandApiOnline();
    if (!online.ok) {
      return online;
    }
    const actor = getActor(input.userId);
    const uiProductFilter = normalizeStockProductFilter(input.productFilter);
    const postImmediately = Boolean(input.postImmediately);
    assertStockModuleWrite(actor.role, uiProductFilter, "stock-receipts");
    if (postImmediately) {
      if (input.id) {
        return {
          ok: false,
          error: "Direct post is only available when creating a new receipt.",
        };
      }
      assertAction(actor.role, "direct_post_stock_receipts");
    } else {
      assertAction(actor.role, "draft_stock_receipts");
    }
    assertSalesPointScope(actor, input.salesPointId);

    const spCheck = requireActiveSalesPoint(getDatabase(), input.salesPointId);
    if (!spCheck.ok) {
      return { ok: false, error: spCheck.error };
    }

    if (!input.supplierLabel.trim()) {
      return { ok: false, error: "Supplier label is required." };
    }
    if (input.lines.length === 0) {
      return { ok: false, error: "Add at least one line." };
    }

    const db = getDatabase();

    const receivedAtDate = normalizeIsoDateInput(input.receivedAt);
    assertDateInOpenMonthForActor(receivedAtDate, input.userId);
    const receivedAt = noonUtcIsoDate(receivedAtDate);
    const lines = input.lines.map((line) => {
      if (!isPositiveQty(line.qty)) {
        throw new Error("Each line quantity must be greater than zero.");
      }
      return line;
    });
    const mutationFilter = resolveMutationProductFilter(
      db,
      uiProductFilter,
      lines.map((line) => line.productId),
    );
    const consignmentNoteNo = normalizeOptionalTransferText(
      input.consignmentNoteNo,
    );
    const consignedBy = normalizeOptionalTransferText(input.consignedBy);
    const consDesign = normalizeOptionalTransferText(input.consDesign);
    const consDate = normalizeOptionalTransferDate(input.consDate);
    const receiveBy = normalizeOptionalTransferText(input.receiveBy);
    const receiveByDesign = normalizeOptionalTransferText(
      input.receiveByDesign,
    );
    const receiveDate = normalizeOptionalTransferDate(input.receiveDate);
    if (mutationFilter === "bottled") {
      const botaRow = db
        .prepare(
          `SELECT id FROM SalesPoint
           WHERE COALESCE(isActive, 1) = 1
             AND UPPER(name) LIKE '%BOTA%'
           ORDER BY name ASC
           LIMIT 1`,
        )
        .get() as { id: number } | undefined;
      if (!botaRow || input.salesPointId !== botaRow.id) {
        return {
          ok: false,
          error: "Bottle Oil receipts must be posted at Bota.",
        };
      }
      if (!consignmentNoteNo) {
        return {
          ok: false,
          error: "Consignment # is required for Bottle Oil receipts.",
        };
      }
      if (!consignedBy) {
        return {
          ok: false,
          error: "Consigned by is required for Bottle Oil receipts.",
        };
      }
      if (!receiveBy) {
        return {
          ok: false,
          error: "Received by is required for Bottle Oil receipts.",
        };
      }
      const duplicateConsignment = db
        .prepare(
          `SELECT id, receiptNo FROM StockReceipt
           WHERE consignmentNoteNo IS NOT NULL
             AND lower(trim(consignmentNoteNo)) = lower(?)
             AND (? IS NULL OR id != ?)
           LIMIT 1`,
        )
        .get(consignmentNoteNo, input.id ?? null, input.id ?? null) as
        | { id: string; receiptNo: string }
        | undefined;
      if (duplicateConsignment) {
        return {
          ok: false,
          error: `Consignment # "${consignmentNoteNo}" is already used on receipt ${duplicateConsignment.receiptNo}.`,
        };
      }
    } else {
      const millAttached = db
        .prepare(
          `SELECT COALESCE(attachedToMill, 0) AS attachedToMill
           FROM SalesPoint WHERE id = ?`,
        )
        .get(input.salesPointId) as { attachedToMill: number } | undefined;
      if (!millAttached || millAttached.attachedToMill !== 1) {
        return {
          ok: false,
          error:
            "Collection point must be attached to a mill for stock receipts.",
        };
      }
    }
    assertReceiptProductLines(
      db,
      lines.map((line) => ({
        productId: line.productId,
        storageLocationId: line.storageLocationId ?? null,
      })),
      mutationFilter,
    );

    const tx = db.transaction(() => {
      for (const line of lines) {
        if (line.storageLocationId != null) {
          assertStorageLocationForSalesPoint(
            db,
            input.salesPointId,
            line.storageLocationId,
            "receipt",
          );
        }
      }

      if (input.id) {
        const existing = db
          .prepare(`SELECT id, status, salesPointId FROM StockReceipt WHERE id = ?`)
          .get(input.id) as { id: string; status: string; salesPointId: number } | undefined;
        if (!existing) {
          throw new Error("Receipt not found.");
        }
        assertSalesPointScope(actor, existing.salesPointId);
        if (existing.status !== "DRAFT") {
          throw new Error("Only draft receipts can be edited.");
        }

        db.prepare(`DELETE FROM StockReceiptLine WHERE receiptId = ?`).run(input.id);
        db.prepare(
          `UPDATE StockReceipt
           SET salesPointId = ?, receivedAt = ?, supplierLabel = ?, notes = ?,
               consignmentNoteNo = ?, consignedBy = ?, consDesign = ?, consDate = ?,
               receiveBy = ?, receiveByDesign = ?, receiveDate = ?,
               updatedAt = datetime('now')
           WHERE id = ?`,
        ).run(
          input.salesPointId,
          receivedAt,
          input.supplierLabel.trim(),
          input.notes?.trim() || null,
          consignmentNoteNo,
          consignedBy,
          consDesign,
          consDate,
          receiveBy,
          receiveByDesign,
          receiveDate,
          input.id,
        );

        const insertLine = db.prepare(
          `INSERT INTO StockReceiptLine (id, receiptId, productId, qty, storageLocationId)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const line of lines) {
          insertLine.run(
            randomUUID(),
            input.id,
            line.productId,
            formatQty(parseQty(line.qty)),
            line.storageLocationId,
          );
        }

        const updated = db
          .prepare(`SELECT id, receiptNo FROM StockReceipt WHERE id = ?`)
          .get(input.id) as { id: string; receiptNo: string };
        return updated;
      }

      throw new Error("INTERNAL_CREATE_OUTSIDE_TX");
    });

    if (input.id) {
      const result = tx();
      return {
        ok: true,
        id: result.id,
        documentNo: result.receiptNo,
        posted: false,
      };
    }

    let id: string = randomUUID();
    let receiptNo = "";
    let posted = postImmediately;

    if (isCommandApiEnabled()) {
      const remote = await createStockReceiptRemote({
        ...input,
        id: null,
        receiptNo: input.receiptNo?.trim() || null,
        lines,
      });
      if (!remote.ok) {
        return remote;
      }
      id = remote.id;
      receiptNo = remote.documentNo;
      posted = Boolean(remote.posted);
    } else {
      receiptNo = resolveReceiptNoForCreate(db, receivedAt, input.receiptNo);
    }

    const createTx = db.transaction(() => {
      for (const line of lines) {
        if (line.storageLocationId != null) {
          assertStorageLocationForSalesPoint(
            db,
            input.salesPointId,
            line.storageLocationId,
            "receipt",
          );
        }
      }

      db.prepare(
        `INSERT INTO StockReceipt (
          id, receiptNo, salesPointId, receivedAt, supplierLabel, status, notes,
          consignmentNoteNo, consignedBy, consDesign, consDate,
          receiveBy, receiveByDesign, receiveDate, createdByUserId
        ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        receiptNo,
        input.salesPointId,
        receivedAt,
        input.supplierLabel.trim(),
        input.notes?.trim() || null,
        consignmentNoteNo,
        consignedBy,
        consDesign,
        consDate,
        receiveBy,
        receiveByDesign,
        receiveDate,
        input.userId,
      );

      const insertLine = db.prepare(
        `INSERT INTO StockReceiptLine (id, receiptId, productId, qty, storageLocationId)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const line of lines) {
        insertLine.run(
          randomUUID(),
          id,
          line.productId,
          formatQty(parseQty(line.qty)),
          line.storageLocationId,
        );
      }

      if (posted) {
        finalizeReceiptPost(db, input.userId, id, uiProductFilter);
      }

      const payload = serializeStockReceiptForSync(db, id);
      if (payload) {
        enqueueOutboxItem(db, "StockReceipt", id, "UPSERT", payload);
      }

      return { id, receiptNo };
    });

    const result = createTx();
    return {
      ok: true,
      id: result.id,
      documentNo: result.receiptNo,
      posted,
    };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not save receipt.") };
  }
}

export async function postReceipt(
  userId: string,
  receiptId: string,
  productFilterInput?: StockProductFilter | null,
): Promise<StockGenericResult> {
  try {
    const online = await requireCommandApiOnline();
    if (!online.ok) {
      return online;
    }
    if (isCommandApiEnabled()) {
      const remote = await postStockReceiptRemote(receiptId, userId);
      if (!remote.ok) {
        return remote;
      }
    }
    const actor = getActor(userId);
    const productFilter = normalizeStockProductFilter(productFilterInput);
    assertStockModuleWrite(actor.role, productFilter, "stock-receipts");
    assertAction(actor.role, "post_stock_receipts");
    const db = getDatabase();

    const existing = db
      .prepare(`SELECT salesPointId FROM StockReceipt WHERE id = ?`)
      .get(receiptId) as { salesPointId: number } | undefined;
    if (!existing) {
      return { ok: false, error: "Receipt not found." };
    }
    assertSalesPointScope(actor, existing.salesPointId);

    const tx = db.transaction(() => {
      finalizeReceiptPost(db, userId, receiptId, productFilter);

      const payload = serializeStockReceiptForSync(db, receiptId);
      if (payload) {
        enqueueOutboxItem(db, "StockReceipt", receiptId, "UPDATE", payload);
      }
    });

    tx();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not post receipt.") };
  }
}

export function cancelReceipt(
  userId: string,
  receiptId: string,
  productFilter?: StockProductFilter | null,
): StockGenericResult {
  return cancelStockDocument(userId, "RECEIPT", receiptId, productFilter);
}

export async function saveTransfer(
  input: SaveTransferInput,
): Promise<StockMutationResult> {
  try {
    const online = input.id
      ? requireCommandApiOnlineCached()
      : await requireCommandApiOnline();
    if (!online.ok) {
      return online;
    }
    const actor = getActor(input.userId);
    const uiProductFilter = normalizeStockProductFilter(input.productFilter);
    const postImmediately = Boolean(input.postImmediately);
    assertStockModuleWrite(actor.role, uiProductFilter, "stock-transfers");
    if (postImmediately) {
      if (input.id) {
        return {
          ok: false,
          error: "Direct post is only available when creating a new transfer.",
        };
      }
      assertAction(actor.role, "direct_post_stock_transfers");
    } else {
      assertAction(actor.role, "draft_stock_transfers");
    }
    assertTransferInitiateSalesPointScope(actor, input.fromSalesPointId);

    const fromCheck = requireActiveSalesPoint(
      getDatabase(),
      input.fromSalesPointId,
    );
    if (!fromCheck.ok) {
      return { ok: false, error: fromCheck.error };
    }
    const toCheck = requireActiveSalesPoint(getDatabase(), input.toSalesPointId);
    if (!toCheck.ok) {
      return { ok: false, error: toCheck.error };
    }

    const isIntra = isIntraSalesPointTransfer(
      input.fromSalesPointId,
      input.toSalesPointId,
    );
    if (!isIntra && input.fromSalesPointId === input.toSalesPointId) {
      return { ok: false, error: "Source and destination must differ." };
    }
    if (postImmediately && !isIntra) {
      assertTransferInitiateSalesPointScope(actor, input.toSalesPointId);
    }
    if (input.lines.length === 0) {
      return { ok: false, error: "Add at least one line." };
    }

    const db = getDatabase();
    const dispatchedAtDate = normalizeIsoDateInput(input.dispatchedAt);
    assertDateInOpenMonthForActor(dispatchedAtDate, input.userId);
    const dispatchedAt = noonUtcIsoDate(dispatchedAtDate);
    const consignedBy = normalizeOptionalTransferText(input.consignedBy);
    const consDesign = normalizeOptionalTransferText(input.consDesign);
    const consDate = normalizeOptionalTransferDate(input.consDate);
    const receiveBy = normalizeOptionalTransferText(input.receiveBy);
    const receiveByDesign = normalizeOptionalTransferText(input.receiveByDesign);
    const receiveDate = normalizeOptionalTransferDate(input.receiveDate);
    const lines = input.lines.map((line) => {
      if (!isPositiveQty(line.qty)) {
        throw new Error("Each line quantity must be greater than zero.");
      }
      if (isIntra) {
        if (line.toStorageLocationId == null) {
          throw new Error("Each line needs a destination storage location.");
        }
        if (line.fromStorageLocationId === line.toStorageLocationId) {
          throw new Error("Source and destination locations must differ on each line.");
        }
      } else if (postImmediately) {
        if (line.toStorageLocationId == null) {
          throw new Error("Each line needs a destination storage location.");
        }
      }
      return line;
    });
    assertNoBottledTransferProducts(
      db,
      lines.map((line) => line.productId),
    );
    assertProductsMatchStockFilter(
      db,
      lines.map((line) => line.productId),
      resolveMutationProductFilter(
        db,
        uiProductFilter,
        lines.map((line) => line.productId),
      ),
    );
    if (!isIntra) {
      assertInterTransferProductsAllowed(
        db,
        lines.map((line) => line.productId),
      );
    }

    let remoteId: string | null = null;
    let remoteNo: string | null = null;
    let posted = postImmediately;

    if (!input.id && isCommandApiEnabled()) {
      const remote = await createStockTransferRemote({
        ...input,
        id: null,
        transferNo: input.transferNo?.trim() || null,
        lines,
      });
      if (!remote.ok) {
        return remote;
      }
      remoteId = remote.id;
      remoteNo = remote.documentNo;
      posted = Boolean(remote.posted);
    }

    const tx = db.transaction(() => {
      for (const line of lines) {
        assertStorageLocationForSalesPoint(
          db,
          input.fromSalesPointId,
          line.fromStorageLocationId,
        );
        if (isIntra && line.toStorageLocationId != null) {
          assertStorageLocationForSalesPoint(
            db,
            input.fromSalesPointId,
            line.toStorageLocationId,
          );
        }
        if (postImmediately && !isIntra && line.toStorageLocationId != null) {
          assertStorageLocationForSalesPoint(
            db,
            input.toSalesPointId,
            line.toStorageLocationId,
          );
        }
      }
      assertTransferLinesAvailableAtSource(
        db,
        input.fromSalesPointId,
        lines,
        dispatchedAtDate,
      );

      const insertLine =
        isIntra || postImmediately
          ? db.prepare(
              `INSERT INTO StockTransferLine (
              id, transferId, productId, qty, fromStorageLocationId, toStorageLocationId
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
          : db.prepare(
              `INSERT INTO StockTransferLine (id, transferId, productId, qty, fromStorageLocationId)
             VALUES (?, ?, ?, ?, ?)`,
            );

      if (input.id) {
        const existing = db
          .prepare(`SELECT id, status, fromSalesPointId FROM StockTransfer WHERE id = ?`)
          .get(input.id) as { id: string; status: string; fromSalesPointId: number } | undefined;
        if (!existing) {
          throw new Error("Transfer not found.");
        }
        assertTransferInitiateSalesPointScope(actor, existing.fromSalesPointId);
        if (existing.status !== "DRAFT") {
          throw new Error("Only draft transfers can be edited.");
        }

        db.prepare(`DELETE FROM StockTransferLine WHERE transferId = ?`).run(input.id);
        db.prepare(
          `UPDATE StockTransfer
           SET fromSalesPointId = ?, toSalesPointId = ?, dispatchedAt = ?, notes = ?,
               consignedBy = ?, consDesign = ?, consDate = ?,
               receiveBy = ?, receiveByDesign = ?, receiveDate = ?,
               updatedAt = datetime('now')
           WHERE id = ?`,
        ).run(
          input.fromSalesPointId,
          input.toSalesPointId,
          dispatchedAt,
          input.notes?.trim() || null,
          consignedBy,
          consDesign,
          consDate,
          receiveBy,
          receiveByDesign,
          receiveDate,
          input.id,
        );

        for (const line of lines) {
          if (isIntra || postImmediately) {
            insertLine.run(
              randomUUID(),
              input.id,
              line.productId,
              formatQty(parseQty(line.qty)),
              line.fromStorageLocationId,
              line.toStorageLocationId!,
            );
          } else {
            insertLine.run(
              randomUUID(),
              input.id,
              line.productId,
              formatQty(parseQty(line.qty)),
              line.fromStorageLocationId,
            );
          }
        }

        const updated = db
          .prepare(`SELECT id, transferNo FROM StockTransfer WHERE id = ?`)
          .get(input.id) as { id: string; transferNo: string };
        return updated;
      }

      const id = remoteId ?? randomUUID();
      const transferNo =
        remoteNo ?? resolveTransferNoForCreate(db, dispatchedAt, input.transferNo);
      db.prepare(
        `INSERT INTO StockTransfer (
          id, transferNo, fromSalesPointId, toSalesPointId, dispatchedAt, status, notes,
          consignedBy, consDesign, consDate, receiveBy, receiveByDesign, receiveDate,
          createdByUserId
        ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        transferNo,
        input.fromSalesPointId,
        input.toSalesPointId,
        dispatchedAt,
        input.notes?.trim() || null,
        consignedBy,
        consDesign,
        consDate,
        receiveBy,
        receiveByDesign,
        receiveDate,
        input.userId,
      );

      for (const line of lines) {
        if (isIntra || postImmediately) {
          insertLine.run(
            randomUUID(),
            id,
            line.productId,
            formatQty(parseQty(line.qty)),
            line.fromStorageLocationId,
            line.toStorageLocationId!,
          );
        } else {
          insertLine.run(
            randomUUID(),
            id,
            line.productId,
            formatQty(parseQty(line.qty)),
            line.fromStorageLocationId,
          );
        }
      }

      if (posted) {
        if (isIntra) {
          finalizeInternalTransferPost(db, input.userId, id, uiProductFilter);
        } else {
          finalizeTransferDispatch(db, input.userId, id, uiProductFilter);
          finalizeTransferReceiveFromStoredLines(db, input.userId, id, uiProductFilter);
        }
      }

      const payload = serializeStockTransferForSync(db, id);
      if (payload) {
        enqueueOutboxItem(db, "StockTransfer", id, "UPSERT", payload);
      }

      return { id, transferNo };
    });

    const result = tx();
    return {
      ok: true,
      id: result.id,
      documentNo: result.transferNo,
      posted,
    };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not save transfer.") };
  }
}

export async function postInternalTransfer(
  userId: string,
  transferId: string,
  productFilterInput?: StockProductFilter | null,
): Promise<StockGenericResult> {
  try {
    const online = await requireCommandApiOnline();
    if (!online.ok) {
      return online;
    }
    if (isCommandApiEnabled()) {
      const remote = await postStockTransferRemote(transferId, userId);
      if (!remote.ok) {
        return remote;
      }
    }
    const actor = getActor(userId);
    const productFilter = normalizeStockProductFilter(productFilterInput);
    assertStockModuleWrite(actor.role, productFilter, "stock-transfers");
    assertAction(actor.role, "post_stock_transfers");
    const db = getDatabase();

    const existing = db
      .prepare(`SELECT fromSalesPointId FROM StockTransfer WHERE id = ?`)
      .get(transferId) as { fromSalesPointId: number } | undefined;
    if (!existing) {
      return { ok: false, error: "Transfer not found." };
    }
    assertTransferInitiateSalesPointScope(actor, existing.fromSalesPointId);

    const tx = db.transaction(() => {
      finalizeInternalTransferPost(db, userId, transferId, productFilter);

      const payload = serializeStockTransferForSync(db, transferId);
      if (payload) {
        enqueueOutboxItem(db, "StockTransfer", transferId, "UPDATE", payload);
      }
    });

    tx();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not post location move.") };
  }
}

export function dispatchTransfer(
  userId: string,
  transferId: string,
  productFilterInput?: StockProductFilter | null,
): StockGenericResult {
  try {
    const actor = getActor(userId);
    const productFilter = normalizeStockProductFilter(productFilterInput);
    assertStockModuleWrite(actor.role, productFilter, "stock-transfers");
    assertAction(actor.role, "post_stock_transfers");
    const db = getDatabase();

    const existing = db
      .prepare(`SELECT fromSalesPointId FROM StockTransfer WHERE id = ?`)
      .get(transferId) as { fromSalesPointId: number } | undefined;
    if (!existing) {
      return { ok: false, error: "Transfer not found." };
    }
    assertTransferInitiateSalesPointScope(actor, existing.fromSalesPointId);

    const tx = db.transaction(() => {
      finalizeTransferDispatch(db, userId, transferId, productFilter);

      const payload = serializeStockTransferForSync(db, transferId);
      if (payload) {
        enqueueOutboxItem(db, "StockTransfer", transferId, "UPDATE", payload);
      }
    });

    tx();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not dispatch transfer.") };
  }
}

export async function receiveTransfer(
  input: ReceiveTransferInput,
): Promise<StockGenericResult> {
  try {
    const online = await requireCommandApiOnline();
    if (!online.ok) {
      return online;
    }
    if (isCommandApiEnabled()) {
      const remote = await receiveStockTransferRemote(input);
      if (!remote.ok) {
        return remote;
      }
    }
    const actor = getActor(input.userId);
    const uiProductFilter = normalizeStockProductFilter(input.productFilter);
    if (uiProductFilter !== "bottled") {
      throw new Error(
        "Incoming transfers can only be received from Bottled Stock.",
      );
    }
    assertStockModuleWrite(actor.role, uiProductFilter, "stock-transfers");
    assertCanPostOrReceiveStockTransfer(actor);
    const db = getDatabase();

    const tx = db.transaction(() => {
      const existing = db
        .prepare(`SELECT * FROM StockTransfer WHERE id = ?`)
        .get(input.transferId) as Record<string, unknown> | undefined;
      if (!existing) {
        throw new Error("Transfer not found.");
      }
      if (
        isIntraSalesPointTransfer(
          existing.fromSalesPointId as number,
          existing.toSalesPointId as number,
        )
      ) {
        throw new Error("Use Post for location moves within a collection point.");
      }
      assertSalesPointScope(actor, existing.toSalesPointId as number);
      if (existing.status === "RECEIVED") {
        return;
      }
      if (existing.status !== "DISPATCHED") {
        throw new Error("Only dispatched transfers can be received.");
      }

      const lines = db
        .prepare(`SELECT * FROM StockTransferLine WHERE transferId = ?`)
        .all(input.transferId) as Array<Record<string, unknown>>;
      if (input.lines.length !== lines.length) {
        throw new Error("Assign a receive location for every line.");
      }
      assertProductsMatchStockFilter(
        db,
        lines.map((line) => line.productId as number),
        documentFilterForLines(
          db,
          uiProductFilter,
          lines.map((line) => line.productId as number),
        ),
      );

      const lineById = new Map(lines.map((line) => [String(line.id), line]));
      for (const receiveLine of input.lines) {
        if (!lineById.has(receiveLine.lineId)) {
          throw new Error("One or more lines do not belong to this transfer.");
        }
        assertStorageLocationForSalesPoint(
          db,
          existing.toSalesPointId as number,
          receiveLine.toStorageLocationId,
        );
      }

      const receiveBy = normalizeOptionalTransferText(input.receiveBy);
      const receiveByDesign = normalizeOptionalTransferText(input.receiveByDesign);
      const { receivedAt, receiveDate } = resolveTransferReceiveOccurredAt(
        input.receiveDate,
        input.userId,
      );
      for (const receiveLine of input.lines) {
        const line = lineById.get(receiveLine.lineId)!;
        db.prepare(
          `UPDATE StockTransferLine SET toStorageLocationId = ? WHERE id = ?`,
        ).run(receiveLine.toStorageLocationId, receiveLine.lineId);
        applyMovement(db, {
          salesPointId: existing.toSalesPointId as number,
          productId: line.productId as number,
          storageLocationId: receiveLine.toStorageLocationId,
          qty: String(line.qty),
          kind: "TRANSFER_IN",
          occurredAt: receivedAt,
          userId: input.userId,
          sourceKind: "TRANSFER",
          sourceId: input.transferId,
        });
      }

      db.prepare(
        `UPDATE StockTransfer
         SET status = 'RECEIVED', receivedAt = ?, receivedByUserId = ?,
             receiveBy = ?, receiveByDesign = ?, receiveDate = ?,
             updatedAt = datetime('now')
         WHERE id = ?`,
      ).run(
        receivedAt,
        input.userId,
        receiveBy,
        receiveByDesign,
        receiveDate,
        input.transferId,
      );

      const payload = serializeStockTransferForSync(db, input.transferId);
      if (payload) {
        enqueueOutboxItem(db, "StockTransfer", input.transferId, "UPDATE", payload);
      }
    });

    tx();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not receive transfer.") };
  }
}

export function cancelTransfer(
  userId: string,
  transferId: string,
  productFilter?: StockProductFilter | null,
): StockGenericResult {
  return cancelStockDocument(userId, "TRANSFER", transferId, productFilter);
}

export async function saveAdjustment(
  input: SaveAdjustmentInput,
): Promise<StockMutationResult> {
  try {
    const online = input.id
      ? requireCommandApiOnlineCached()
      : await requireCommandApiOnline();
    if (!online.ok) {
      return online;
    }
    const actor = getActor(input.userId);
    const uiProductFilter = normalizeStockProductFilter(input.productFilter);
    assertStockModuleWrite(actor.role, uiProductFilter, "stock-adjustments");
    assertAction(actor.role, "draft_stock_adjustments");
    assertSalesPointScope(actor, input.salesPointId);

    const adjSpCheck = requireActiveSalesPoint(
      getDatabase(),
      input.salesPointId,
    );
    if (!adjSpCheck.ok) {
      return { ok: false, error: adjSpCheck.error };
    }

    if (!input.reason.trim()) {
      return { ok: false, error: "Reason is required." };
    }
    if (input.lines.length === 0) {
      return { ok: false, error: "Add at least one adjustment line." };
    }

    const db = getDatabase();
    const occurredAtDate = normalizeIsoDateInput(input.occurredAt);
    assertDateInOpenMonthForActor(occurredAtDate, input.userId);
    const occurredAt = noonUtcIsoDate(occurredAtDate);
    const lines = input.lines.map((line) => {
      if (!isNonZeroQty(line.deltaQty)) {
        throw new Error("Each adjustment line must be non-zero.");
      }
      if (
        (line.fromCondition && !line.toCondition) ||
        (!line.fromCondition && line.toCondition)
      ) {
        throw new Error("Reclassification lines must specify both fromCondition and toCondition.");
      }
      if (line.fromCondition && line.toCondition && line.fromCondition === line.toCondition) {
        throw new Error("Reclassification must change between sellable and unsellable.");
      }
      if (line.fromCondition && line.toCondition && !isPositiveQty(line.deltaQty)) {
        throw new Error("Reclassification quantity must be greater than zero.");
      }
      return line;
    });
    assertAdjustmentProductLines(
      db,
      lines,
      resolveMutationProductFilter(
        db,
        uiProductFilter,
        lines.map((line) => line.productId),
      ),
    );

    let remoteId: string | null = null;
    let remoteNo: string | null = null;

    if (!input.id && isCommandApiEnabled()) {
      const remote = await createStockAdjustmentRemote({
        ...input,
        id: null,
        lines,
      });
      if (!remote.ok) {
        return remote;
      }
      remoteId = remote.id;
      remoteNo = remote.documentNo;
    }

    const tx = db.transaction(() => {
      for (const line of lines) {
        if (line.storageLocationId != null) {
          assertStorageLocationForSalesPoint(
            db,
            input.salesPointId,
            line.storageLocationId,
          );
        }
      }

      if (input.id) {
        const existing = db
          .prepare(`SELECT id, status, salesPointId FROM StockAdjustment WHERE id = ?`)
          .get(input.id) as { id: string; status: string; salesPointId: number } | undefined;
        if (!existing) {
          throw new Error("Adjustment not found.");
        }
        assertSalesPointScope(actor, existing.salesPointId);
        if (existing.status !== "DRAFT") {
          throw new Error("Only draft adjustments can be edited.");
        }

        db.prepare(`DELETE FROM StockAdjustmentLine WHERE adjustmentId = ?`).run(input.id);
        db.prepare(
          `UPDATE StockAdjustment
           SET salesPointId = ?, occurredAt = ?, reason = ?, updatedAt = datetime('now')
           WHERE id = ?`,
        ).run(input.salesPointId, occurredAt, input.reason.trim(), input.id);

        const insertLine = db.prepare(
          `INSERT INTO StockAdjustmentLine (
            id, adjustmentId, productId, deltaQty, storageLocationId, fromCondition, toCondition
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const line of lines) {
          insertLine.run(
            randomUUID(),
            input.id,
            line.productId,
            formatQty(parseQty(line.deltaQty)),
            line.storageLocationId,
            line.fromCondition ?? null,
            line.toCondition ?? null,
          );
        }

        const updated = db
          .prepare(`SELECT id, adjustmentNo FROM StockAdjustment WHERE id = ?`)
          .get(input.id) as { id: string; adjustmentNo: string };

        const payload = serializeStockAdjustmentForSync(db, input.id);
        if (payload) {
          enqueueOutboxItem(db, "StockAdjustment", input.id, "UPSERT", payload);
        }

        return updated;
      }

      const id = remoteId ?? randomUUID();
      const adjustmentNo = remoteNo ?? allocateAdjustmentNo(db, occurredAt);
      db.prepare(
        `INSERT INTO StockAdjustment (
          id, adjustmentNo, salesPointId, occurredAt, reason, status, createdByUserId
        ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)`,
      ).run(id, adjustmentNo, input.salesPointId, occurredAt, input.reason.trim(), input.userId);

      const insertLine = db.prepare(
        `INSERT INTO StockAdjustmentLine (
          id, adjustmentId, productId, deltaQty, storageLocationId, fromCondition, toCondition
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const line of lines) {
        insertLine.run(
          randomUUID(),
          id,
          line.productId,
          formatQty(parseQty(line.deltaQty)),
          line.storageLocationId,
          line.fromCondition ?? null,
          line.toCondition ?? null,
        );
      }

      const payload = serializeStockAdjustmentForSync(db, id);
      if (payload) {
        enqueueOutboxItem(db, "StockAdjustment", id, "UPSERT", payload);
      }

      return { id, adjustmentNo };
    });

    const result = tx();
    return { ok: true, id: result.id, documentNo: result.adjustmentNo };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not save adjustment.") };
  }
}

export async function postAdjustment(
  userId: string,
  adjustmentId: string,
  productFilterInput?: StockProductFilter | null,
): Promise<StockGenericResult> {
  try {
    const online = await requireCommandApiOnline();
    if (!online.ok) {
      return online;
    }
    if (isCommandApiEnabled()) {
      const remote = await postStockAdjustmentRemote(adjustmentId, userId);
      if (!remote.ok) {
        return remote;
      }
    }
    const actor = getActor(userId);
    const productFilter = normalizeStockProductFilter(productFilterInput);
    assertStockModuleWrite(actor.role, productFilter, "stock-adjustments");
    assertAction(actor.role, "post_stock_adjustments");
    const db = getDatabase();

    const tx = db.transaction(() => {
      const existing = db
        .prepare(`SELECT * FROM StockAdjustment WHERE id = ?`)
        .get(adjustmentId) as Record<string, unknown> | undefined;
      if (!existing) {
        throw new Error("Adjustment not found.");
      }
      assertSalesPointScope(actor, existing.salesPointId as number);
      if (existing.status === "POSTED") {
        return;
      }
      if (existing.status !== "DRAFT") {
        throw new Error(`Cannot post an adjustment in status ${String(existing.status)}.`);
      }

      const lines = db
        .prepare(`SELECT * FROM StockAdjustmentLine WHERE adjustmentId = ?`)
        .all(adjustmentId) as Array<Record<string, unknown>>;
      if (lines.length === 0) {
        throw new Error("Add at least one line before posting.");
      }
      assertAdjustmentProductLines(
        db,
        lines.map((line) => ({
          productId: line.productId as number,
          storageLocationId: (line.storageLocationId as number | null) ?? null,
        })),
        documentFilterForLines(
          db,
          productFilter,
          lines.map((line) => line.productId as number),
        ),
      );

      const isCarryForward = String(existing.sourceKind ?? "NORMAL") === "CARRY_FORWARD";
      const adjustmentNotes = isCarryForward ? "Carry-forward stock" : undefined;

      for (const line of lines) {
        if (line.fromCondition && line.toCondition) {
          const qty = absQty(String(line.deltaQty));
          applyMovement(db, {
            salesPointId: existing.salesPointId as number,
            productId: line.productId as number,
            storageLocationId: line.storageLocationId as number,
            condition: line.fromCondition as "SELLABLE" | "UNSELLABLE",
            qty: formatQty(-parseQty(qty)),
            kind: "ADJUSTMENT",
            occurredAt: String(existing.occurredAt),
            userId,
            sourceKind: "ADJUSTMENT",
            sourceId: adjustmentId,
            notes: `Reclassify ${String(line.fromCondition)} -> ${String(line.toCondition)}`,
          });
          applyMovement(db, {
            salesPointId: existing.salesPointId as number,
            productId: line.productId as number,
            storageLocationId: line.storageLocationId as number,
            condition: line.toCondition as "SELLABLE" | "UNSELLABLE",
            qty,
            kind: "ADJUSTMENT",
            occurredAt: String(existing.occurredAt),
            userId,
            sourceKind: "ADJUSTMENT",
            sourceId: adjustmentId,
            notes: `Reclassify ${String(line.fromCondition)} -> ${String(line.toCondition)}`,
          });
        } else {
          applyMovement(db, {
            salesPointId: existing.salesPointId as number,
            productId: line.productId as number,
            storageLocationId: line.storageLocationId as number,
            qty: String(line.deltaQty),
            kind: "ADJUSTMENT",
            occurredAt: String(existing.occurredAt),
            userId,
            sourceKind: "ADJUSTMENT",
            sourceId: adjustmentId,
            ...(adjustmentNotes ? { notes: adjustmentNotes } : {}),
          });
        }
      }

      db.prepare(
        `UPDATE StockAdjustment
         SET status = 'POSTED', postedByUserId = ?, postedAt = datetime('now'), updatedAt = datetime('now')
         WHERE id = ?`,
      ).run(userId, adjustmentId);

      const payload = serializeStockAdjustmentForSync(db, adjustmentId);
      if (payload) {
        enqueueOutboxItem(db, "StockAdjustment", adjustmentId, "UPDATE", payload);
      }
    });

    tx();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not post adjustment.") };
  }
}

export function cancelAdjustment(
  userId: string,
  adjustmentId: string,
  productFilter?: StockProductFilter | null,
): StockGenericResult {
  return cancelStockDocument(userId, "ADJUSTMENT", adjustmentId, productFilter);
}

function cancelStockDocument(
  userId: string,
  kind: "RECEIPT" | "TRANSFER" | "ADJUSTMENT",
  documentId: string,
  productFilterInput?: StockProductFilter | null,
): StockGenericResult {
  try {
    const actor = getActor(userId);
    const productFilter = normalizeStockProductFilter(productFilterInput);
    const routeId =
      kind === "RECEIPT"
        ? "stock-receipts"
        : kind === "TRANSFER"
          ? "stock-transfers"
          : "stock-adjustments";
    const draftAction =
      kind === "RECEIPT"
        ? "draft_stock_receipts"
        : kind === "TRANSFER"
          ? "draft_stock_transfers"
          : "draft_stock_adjustments";
    const postAction =
      kind === "RECEIPT"
        ? "post_stock_receipts"
        : kind === "TRANSFER"
          ? "post_stock_transfers"
          : "post_stock_adjustments";
    assertStockModuleWrite(actor.role, productFilter, routeId);
    const db = getDatabase();

    const tx = db.transaction(() => {
      if (kind === "RECEIPT") {
        const existing = db
          .prepare(`SELECT id, status, salesPointId FROM StockReceipt WHERE id = ?`)
          .get(documentId) as { id: string; status: string; salesPointId: number } | undefined;
        if (!existing) {
          throw new Error("Receipt not found.");
        }
        assertSalesPointScope(actor, existing.salesPointId);
        const productRows = db
          .prepare(`SELECT productId FROM StockReceiptLine WHERE receiptId = ?`)
          .all(documentId) as Array<{ productId: number }>;
        const lineProductIds = productRows.map((row) => row.productId);
        if (lineProductIds.length > 0) {
          assertProductsMatchBottledFilter(
            db,
            lineProductIds,
            documentFilterForLines(db, productFilter, lineProductIds),
          );
        }
        if (existing.status === "DRAFT") {
          assertAction(actor.role, draftAction);
          db.prepare(`DELETE FROM StockReceipt WHERE id = ?`).run(documentId);
          enqueueOutboxItem(db, "StockReceipt", documentId, "DELETE", { id: documentId });
          return;
        }
        if (existing.status === "CANCELLED") {
          return;
        }
        assertAction(actor.role, postAction);
        reverseMovementsBySource(db, {
          sourceKind: "RECEIPT",
          sourceId: documentId,
          userId,
          occurredAt: nowIso(),
          notes: `Cancellation of receipt ${documentId}`,
        });
        db.prepare(`UPDATE StockReceipt SET status = 'CANCELLED', updatedAt = datetime('now') WHERE id = ?`).run(
          documentId,
        );
        const payload = serializeStockReceiptForSync(db, documentId);
        if (payload) {
          enqueueOutboxItem(db, "StockReceipt", documentId, "UPDATE", payload);
        }
        return;
      }

      if (kind === "TRANSFER") {
        const existing = db
          .prepare(`SELECT id, status, fromSalesPointId FROM StockTransfer WHERE id = ?`)
          .get(documentId) as { id: string; status: string; fromSalesPointId: number } | undefined;
        if (!existing) {
          throw new Error("Transfer not found.");
        }
        assertTransferInitiateSalesPointScope(actor, existing.fromSalesPointId);
        const productRows = db
          .prepare(`SELECT productId FROM StockTransferLine WHERE transferId = ?`)
          .all(documentId) as Array<{ productId: number }>;
        const lineProductIds = productRows.map((row) => row.productId);
        assertProductsMatchStockFilter(
          db,
          lineProductIds,
          documentFilterForLines(db, productFilter, lineProductIds),
        );
        if (existing.status === "DRAFT") {
          assertAction(actor.role, draftAction);
          db.prepare(`DELETE FROM StockTransfer WHERE id = ?`).run(documentId);
          enqueueOutboxItem(db, "StockTransfer", documentId, "DELETE", { id: documentId });
          return;
        }
        if (existing.status === "CANCELLED") {
          return;
        }
        assertAction(actor.role, postAction);
        reverseMovementsBySource(db, {
          sourceKind: "TRANSFER",
          sourceId: documentId,
          userId,
          occurredAt: nowIso(),
          notes: `Cancellation of transfer ${documentId}`,
        });
        db.prepare(`UPDATE StockTransfer SET status = 'CANCELLED', updatedAt = datetime('now') WHERE id = ?`).run(
          documentId,
        );
        const payload = serializeStockTransferForSync(db, documentId);
        if (payload) {
          enqueueOutboxItem(db, "StockTransfer", documentId, "UPDATE", payload);
        }
        return;
      }

      const existing = db
        .prepare(`SELECT id, status, salesPointId FROM StockAdjustment WHERE id = ?`)
        .get(documentId) as { id: string; status: string; salesPointId: number } | undefined;
      if (!existing) {
        throw new Error("Adjustment not found.");
      }
      assertSalesPointScope(actor, existing.salesPointId);
      const productRows = db
        .prepare(`SELECT productId FROM StockAdjustmentLine WHERE adjustmentId = ?`)
        .all(documentId) as Array<{ productId: number }>;
      const adjustmentProductIds = productRows.map((row) => row.productId);
      if (adjustmentProductIds.length > 0) {
        assertProductsMatchBottledFilter(
          db,
          adjustmentProductIds,
          documentFilterForLines(db, productFilter, adjustmentProductIds),
        );
      }
      if (existing.status === "DRAFT") {
        assertAction(actor.role, draftAction);
        db.prepare(`DELETE FROM StockAdjustment WHERE id = ?`).run(documentId);
        enqueueOutboxItem(db, "StockAdjustment", documentId, "DELETE", { id: documentId });
        return;
      }
      if (existing.status === "CANCELLED") {
        return;
      }
      assertAction(actor.role, postAction);
      reverseMovementsBySource(db, {
        sourceKind: "ADJUSTMENT",
        sourceId: documentId,
        userId,
        occurredAt: nowIso(),
        notes: `Cancellation of adjustment ${documentId}`,
      });
      db.prepare(`UPDATE StockAdjustment SET status = 'CANCELLED', updatedAt = datetime('now') WHERE id = ?`).run(
        documentId,
      );
      const payload = serializeStockAdjustmentForSync(db, documentId);
      if (payload) {
        enqueueOutboxItem(db, "StockAdjustment", documentId, "UPDATE", payload);
      }
    });

    tx();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not cancel document.") };
  }
}

export function findReceiptByNumber(userId: string, receiptNo: string): ReceiptReviewResult {
  try {
    const actor = getActor(userId);
    if (
      !canAccessRoute(actor.role, STOCK_MODULE_ROUTE_ID) &&
      !canAccessRoute(actor.role, "stock-receipts") &&
      !canAccessRoute(actor.role, BOTTLED_STOCK_ROUTE_ID)
    ) {
      throw new Error("You do not have permission to view receipts.");
    }
    const trimmed = String(receiptNo ?? "").trim().toUpperCase();
    if (!trimmed) {
      return { ok: false, error: "Enter a receipt number." };
    }
    const row = getDatabase()
      .prepare(`SELECT id FROM StockReceipt WHERE receiptNo = ?`)
      .get(trimmed) as { id: string } | undefined;
    if (!row) {
      return { ok: false, error: `Receipt "${trimmed}" not found.` };
    }
    const detail = loadReceiptDetail(row.id, userId);
    if (!detail) {
      return { ok: false, error: `Receipt "${trimmed}" is not visible to your collection point.` };
    }
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not load receipt.") };
  }
}

export function findReceiptByConsignmentNoteNo(
  userId: string,
  consignmentNoteNo: string,
): ReceiptReviewResult {
  try {
    const actor = getActor(userId);
    if (
      !canAccessRoute(actor.role, STOCK_MODULE_ROUTE_ID) &&
      !canAccessRoute(actor.role, "stock-receipts") &&
      !canAccessRoute(actor.role, BOTTLED_STOCK_ROUTE_ID)
    ) {
      throw new Error("You do not have permission to view receipts.");
    }
    const trimmed = String(consignmentNoteNo ?? "").trim();
    if (!trimmed) {
      return { ok: false, error: "Enter a consignment number." };
    }
    const row = getDatabase()
      .prepare(
        `SELECT id FROM StockReceipt
         WHERE consignmentNoteNo IS NOT NULL
           AND lower(trim(consignmentNoteNo)) = lower(?)
         LIMIT 1`,
      )
      .get(trimmed) as { id: string } | undefined;
    if (!row) {
      return { ok: false, error: `Consignment # "${trimmed}" not found.` };
    }
    const detail = loadReceiptDetail(row.id, userId);
    if (!detail) {
      return {
        ok: false,
        error: `Consignment # "${trimmed}" is not visible to your collection point.`,
      };
    }
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not load receipt.") };
  }
}

export function findTransferByNumber(userId: string, transferNo: string): TransferReviewResult {
  try {
    const actor = getActor(userId);
    if (
      !canAccessRoute(actor.role, STOCK_MODULE_ROUTE_ID) &&
      !canAccessRoute(actor.role, "stock-transfers") &&
      !canAccessRoute(actor.role, BOTTLED_STOCK_ROUTE_ID)
    ) {
      throw new Error("You do not have permission to view transfers.");
    }
    const trimmed = String(transferNo ?? "").trim().toUpperCase();
    if (!trimmed) {
      return { ok: false, error: "Enter a transfer number." };
    }
    const row = getDatabase()
      .prepare(`SELECT id FROM StockTransfer WHERE transferNo = ?`)
      .get(trimmed) as { id: string } | undefined;
    if (!row) {
      return { ok: false, error: `Transfer "${trimmed}" not found.` };
    }
    const detail = loadTransferDetail(row.id, userId);
    if (!detail) {
      return { ok: false, error: `Transfer "${trimmed}" is not visible to your collection point.` };
    }
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not load transfer.") };
  }
}

export function loadReceiptForReview(userId: string, receiptId: string): ReceiptReviewResult {
  try {
    const detail = loadReceiptDetail(receiptId, userId);
    if (!detail) {
      return { ok: false, error: "Receipt not found." };
    }
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not load receipt.") };
  }
}

export function loadTransferForReview(userId: string, transferId: string): TransferReviewResult {
  try {
    const detail = loadTransferDetail(transferId, userId);
    if (!detail) {
      return { ok: false, error: "Transfer not found." };
    }
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not load transfer.") };
  }
}

export function loadAdjustmentDetail(id: string, userId: string): AdjustmentDetail | null {
  const actor = getActor(userId);
  const scopedSalesPointId = scopedSalesPointIdForActor(actor);
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT a.id, a.adjustmentNo, a.salesPointId, sp.name AS salesPointName,
              a.occurredAt, a.reason, a.status, COALESCE(a.sourceKind, 'NORMAL') AS sourceKind,
              a.postedAt, a.createdAt,
              cu.name AS createdByName, pu.name AS postedByName
       FROM StockAdjustment a
       JOIN SalesPoint sp ON sp.id = a.salesPointId
       JOIN User cu ON cu.id = a.createdByUserId
       LEFT JOIN User pu ON pu.id = a.postedByUserId
       WHERE a.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }
  if (scopedSalesPointId != null && row.salesPointId !== scopedSalesPointId) {
    return null;
  }

  const lines = db
    .prepare(
      `SELECT l.id, l.productId, p.productName, p.uom, COALESCE(pc.isBottled, 0) AS isBottled,
              l.deltaQty, l.storageLocationId, loc.locationName AS storageLocationName,
              l.fromCondition, l.toCondition
       FROM StockAdjustmentLine l
       JOIN Product p ON p.productId = l.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       JOIN StorageLocation sl ON sl.id = l.storageLocationId
       JOIN Location loc ON loc.id = sl.locationId
       WHERE l.adjustmentId = ?
       ORDER BY l.id ASC`,
    )
    .all(id) as Array<Record<string, unknown>>;

  return {
    id: String(row.id),
    adjustmentNo: String(row.adjustmentNo),
    salesPointId: row.salesPointId as number,
    salesPointName: row.salesPointName as string,
    occurredAtIso: String(row.occurredAt).slice(0, 10),
    reason: String(row.reason),
    status: row.status as AdjustmentDetail["status"],
    sourceKind:
      String(row.sourceKind) === "CARRY_FORWARD" ? "CARRY_FORWARD" : "NORMAL",
    lineCount: lines.length,
    createdByName: row.createdByName as string,
    postedByName: (row.postedByName as string | null) ?? null,
    postedAtIso: row.postedAt ? String(row.postedAt) : null,
    createdAtIso: String(row.createdAt),
    lines: lines.map((line) => ({
      id: String(line.id),
      productId: line.productId as number,
      productName: line.productName as string,
      uom: uomForBottled((line.isBottled as number) === 1, line.uom as string | null),
      deltaQty: String(line.deltaQty),
      storageLocationId: line.storageLocationId as number,
      storageLocationName: line.storageLocationName as string,
      fromCondition: (line.fromCondition as AdjustmentDetail["lines"][number]["fromCondition"]) ?? null,
      toCondition: (line.toCondition as AdjustmentDetail["lines"][number]["toCondition"]) ?? null,
    })),
  };
}

export function findAdjustmentByNumber(
  userId: string,
  adjustmentNo: string,
): AdjustmentReviewResult {
  try {
    const actor = getActor(userId);
    if (
      !canAccessRoute(actor.role, STOCK_MODULE_ROUTE_ID) &&
      !canAccessRoute(actor.role, "stock-adjustments") &&
      !canAccessRoute(actor.role, BOTTLED_STOCK_ROUTE_ID)
    ) {
      throw new Error("You do not have permission to view adjustments.");
    }
    const trimmed = String(adjustmentNo ?? "").trim().toUpperCase();
    if (!trimmed) {
      return { ok: false, error: "Enter an adjustment number." };
    }
    const row = getDatabase()
      .prepare(`SELECT id FROM StockAdjustment WHERE adjustmentNo = ?`)
      .get(trimmed) as { id: string } | undefined;
    if (!row) {
      return { ok: false, error: `Adjustment "${trimmed}" not found.` };
    }
    const detail = loadAdjustmentDetail(row.id, userId);
    if (!detail) {
      return {
        ok: false,
        error: `Adjustment "${trimmed}" is not visible to your collection point.`,
      };
    }
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not load adjustment.") };
  }
}

export function loadAdjustmentForReview(
  userId: string,
  adjustmentId: string,
): AdjustmentReviewResult {
  try {
    const detail = loadAdjustmentDetail(adjustmentId, userId);
    if (!detail) {
      return { ok: false, error: "Adjustment not found." };
    }
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, error: describeError(error, "Could not load adjustment.") };
  }
}

export { utcIsoDateToday };
