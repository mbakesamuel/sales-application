import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { loadReportCompanySettings } from "./reportCompany.js";
import {
  assertAction,
  assertRouteWrite,
  canAccessRoute,
  canPerformAction,
  canWriteRoute,
  loadRpcActor,
  routeAccess,
  type RpcActor,
} from "./rpcActor.js";
import {
  postAdjustmentCommand,
  postReceiptCommand,
  postTransferCommand,
} from "./stockCommands.js";
import {
  applyMovement,
  signedDeltaForKind,
  type StockCondition,
  type StockMovementKind,
} from "./stockMovements.js";
import {
  applyIntakeOilGrouping as applyIntakeOilGroupingImpl,
  getIntakeOilGroupingStatus as getIntakeOilGroupingStatusImpl,
} from "./stockIntakeGrouping.js";

/**
 * Thin-client stock RPC extras (bootstrap, as-of balances, bin card, review /
 * print loaders, cancel / dispatch, validation, receive queue) against Postgres.
 *
 * Ports src/electron/stock/{service,binCard,receiveQueue,validationQueue,
 * receiptPrint,transferPrint}.ts. Types are redeclared locally because the
 * server tsconfig has rootDir ./src and cannot import from the Electron project.
 *
 * Schema note: there is no StockBalance table (balances are derived from
 * stock_movements). Intake grouping uses company_settings.stock_intake_oil_grouping
 * and products.stock_intake_group / stock_pool_product_id.
 */

// ---------------------------------------------------------------------------
// Types (mirrors src/shared/stock.types.ts)
// ---------------------------------------------------------------------------

export type StockDocStatus =
  | "DRAFT"
  | "POSTED"
  | "DISPATCHED"
  | "RECEIVED"
  | "CANCELLED";
export type StockProductFilter = "bulk" | "bottled" | "all";
export type StockGenericResult = { ok: true } | { ok: false; error: string };
type TransferMode = "INTER_SALES_POINT" | "INTRA_SALES_POINT";

export interface SalesPointOption {
  id: number;
  name: string;
  attachedToMill: boolean;
}

export interface StorageLocationOption {
  id: number;
  salesPointId: number;
  name: string;
  isDefault: boolean;
  isSalesTank: boolean;
  allowsMultiProduct: boolean;
}

export interface ProductOption {
  productId: number;
  productName: string;
  uom: string;
  isBottled: boolean;
  isLoosePalmOil: boolean;
  omitsStorageLocation: boolean;
  stockIntakeGroup?: "PALM_OIL" | "SLUDGE_OIL" | "PALM_KERNEL" | null;
  stockPoolProductId?: number | null;
  excludeFromSales?: boolean;
  isStockPool?: boolean;
}

export interface StockBalanceRow {
  salesPointId: number;
  salesPointName: string;
  storageLocationId: number | null;
  storageLocationName: string;
  productId: number;
  productName: string;
  uom: string;
  condition: StockCondition;
  qty: string;
}

export interface StockMovementRow {
  id: string;
  occurredAtIso: string;
  salesPointId: number;
  salesPointName: string;
  storageLocationId: number | null;
  storageLocationName: string;
  productId: number;
  productName: string;
  uom: string;
  kind: StockMovementKind;
  condition: StockCondition;
  qty: string;
  signedQty: string;
  sourceKind: string;
  sourceId: string;
  documentNo: string | null;
  userId: string;
  userName: string;
  notes: string | null;
  createdAtIso: string;
  isCarryForward?: boolean;
}

export interface ReceiptListRow {
  id: string;
  receiptNo: string;
  salesPointId: number;
  salesPointName: string;
  receivedAtIso: string;
  supplierLabel: string;
  consignmentNoteNo: string | null;
  status: StockDocStatus;
  totalQty: string;
  lineCount: number;
  createdByName: string;
  postedByName: string | null;
  postedAtIso: string | null;
  createdAtIso: string;
}

export interface ReceiptDetail extends ReceiptListRow {
  notes: string | null;
  consignedBy: string | null;
  consDesign: string | null;
  consDate: string | null;
  receiveBy: string | null;
  receiveByDesign: string | null;
  receiveDate: string | null;
  lines: Array<{
    id: string;
    productId: number;
    productName: string;
    uom: string;
    qty: string;
    storageLocationId: number | null;
    storageLocationName: string;
  }>;
}

export interface TransferConsignmentFields {
  consignedBy: string | null;
  consDesign: string | null;
  consDate: string | null;
  receiveBy: string | null;
  receiveByDesign: string | null;
  receiveDate: string | null;
}

export interface TransferListRow {
  id: string;
  transferNo: string;
  transferMode: TransferMode;
  locationSummary: string | null;
  productSummary: string | null;
  fromSalesPointId: number;
  fromSalesPointName: string;
  toSalesPointId: number;
  toSalesPointName: string;
  dispatchedAtIso: string | null;
  receivedAtIso: string | null;
  status: StockDocStatus;
  totalQty: string;
  lineCount: number;
  createdByName: string;
  dispatchedByName: string | null;
  receivedByName: string | null;
  createdAtIso: string;
}

export interface TransferDetail extends TransferListRow, TransferConsignmentFields {
  notes: string | null;
  lines: Array<{
    id: string;
    productId: number;
    productName: string;
    uom: string;
    qty: string;
    fromStorageLocationId: number;
    fromStorageLocationName: string;
    toStorageLocationId: number | null;
    toStorageLocationName: string | null;
  }>;
}

export interface AdjustmentListRow {
  id: string;
  adjustmentNo: string;
  salesPointId: number;
  salesPointName: string;
  occurredAtIso: string;
  reason: string;
  status: StockDocStatus;
  sourceKind: "NORMAL" | "CARRY_FORWARD";
  lineCount: number;
  createdByName: string;
  postedByName: string | null;
  postedAtIso: string | null;
  createdAtIso: string;
}

export interface AdjustmentDetail extends AdjustmentListRow {
  lines: Array<{
    id: string;
    productId: number;
    productName: string;
    uom: string;
    deltaQty: string;
    storageLocationId: number;
    storageLocationName: string;
    fromCondition: StockCondition | null;
    toCondition: StockCondition | null;
  }>;
}

export interface StockBootstrap {
  productFilter: StockProductFilter;
  canManageReceipts: boolean;
  canInitiateTransfers: boolean;
  canDispatchTransfers: boolean;
  canReceiveTransfers: boolean;
  canCancelTransfers: boolean;
  canPostAdjustments: boolean;
  canReclassifyStock: boolean;
  canCancelDocuments: boolean;
  canDraftReceipts: boolean;
  canDraftTransfers: boolean;
  canDraftAdjustments: boolean;
  canDirectPostReceipts: boolean;
  canDirectPostTransfers: boolean;
  scopedSalesPointId: number | null;
  botaSalesPointId: number | null;
  salesPoints: SalesPointOption[];
  storageLocations: StorageLocationOption[];
  products: ProductOption[];
  receiptProducts: ProductOption[];
  autoGenerateReceiptNo: boolean;
  autoGenerateTransferNo: boolean;
  transferReceiveUsesDocumentDate: boolean;
  loosePalmOilAllowInterSalesPointTransfer: boolean;
  stockIntakeOilGrouping: boolean;
  onHand: StockBalanceRow[];
  movements: StockMovementRow[];
  receipts: ReceiptListRow[];
  transfers: TransferListRow[];
  adjustments: AdjustmentListRow[];
}

export type ReceiptReviewResult =
  | { ok: true; detail: ReceiptDetail }
  | { ok: false; error: string };
export type TransferReviewResult =
  | { ok: true; detail: TransferDetail }
  | { ok: false; error: string };
export type AdjustmentReviewResult =
  | { ok: true; detail: AdjustmentDetail }
  | { ok: false; error: string };

export interface ReceiptPrintPayload {
  companyName: string;
  department: string | null;
  serviceName: string | null;
  signatoryName: string | null;
  signatoryTitle: string;
  receipt: ReceiptDetail;
}

export interface TransferPrintPayload {
  companyName: string;
  department: string | null;
  serviceName: string | null;
  signatoryName: string | null;
  signatoryTitle: string;
  transfer: TransferDetail;
}

export type BinCardConditionFilter = StockCondition | "ALL";

export interface BinCardQuery {
  productId: number;
  salesPointId?: number | null;
  storageLocationId?: number | null;
  condition?: BinCardConditionFilter;
  fromIso: string;
  toIso: string;
  productFilter?: StockProductFilter | null;
}

export interface BinCardLine {
  id: string;
  occurredAtIso: string;
  reference: string;
  particulars: string;
  kind: StockMovementKind;
  condition: StockCondition;
  salesPointName: string;
  storageLocationName: string;
  qtyIn: number;
  qtyOut: number;
  balance: number;
  documentNo: string | null;
  notes: string | null;
  isCarryForward: boolean;
}

export interface BinCardReport {
  productId: number;
  productName: string;
  uom: string;
  isBottled: boolean;
  salesPointId: number | null;
  salesPointLabel: string;
  storageLocationId: number | null;
  storageLocationLabel: string;
  condition: BinCardConditionFilter;
  fromIso: string;
  toIso: string;
  openingBalance: number;
  closingBalance: number;
  lines: BinCardLine[];
  truncated: boolean;
  companyName: string;
  department: string | null;
  serviceName: string | null;
}

export type StockValidationDocKind = "RECEIPT" | "TRANSFER" | "ADJUSTMENT";

export interface StockValidationItem {
  kind: StockValidationDocKind;
  id: string;
}

export interface StockValidationQueueRow {
  kind: StockValidationDocKind;
  id: string;
  documentNo: string;
  productFilter: StockProductFilter;
  transferMode: "INTER_SALES_POINT" | "INTRA_SALES_POINT" | null;
  fromSalesPointName: string;
  toSalesPointName: string | null;
  documentDateIso: string;
  createdByName: string;
  lineCount: number;
  totalQty: string;
}

export interface StockValidationQueuePage {
  totalPending: number;
  rows: StockValidationQueueRow[];
}

export type StockValidateManyResult =
  | {
      ok: true;
      validated: number;
      errors: Array<{ kind: StockValidationDocKind; id: string; error: string }>;
    }
  | { ok: false; error: string };

export interface StockReceiveQueueRow {
  id: string;
  transferNo: string;
  fromSalesPointId: number;
  fromSalesPointName: string;
  toSalesPointId: number;
  toSalesPointName: string;
  dispatchedAtIso: string | null;
  totalQty: string;
  lineCount: number;
  createdByName: string;
  dispatchedByName: string | null;
}

export interface StockReceiveQueuePage {
  rows: StockReceiveQueueRow[];
  storageLocations: StorageLocationOption[];
  transferReceiveUsesDocumentDate: boolean;
  scopedSalesPointId: number | null;
}

export interface StockIntakeOilGroupingStatus {
  enabled: boolean;
  poolTotalQty: number;
}

export type ApplyStockIntakeOilGroupingResult =
  | { ok: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Constants & small helpers
// ---------------------------------------------------------------------------

const STOCK_MODULE_ROUTE_ID = "stock";
const BOTTLED_STOCK_ROUTE_ID = "bottled-stock";
const QTY_EPS = 0.000001;
const LIST_LIMIT = 100;
const MOVEMENT_LIMIT = 200;
const QUEUE_LIMIT = 200;
const BIN_CARD_ROW_LIMIT = 5000;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

const KIND_LABELS: Record<StockMovementKind, string> = {
  RECEIPT: "Receipt",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  SALE: "Sale",
  SALE_REVERSAL: "Sale reversal",
  ADJUSTMENT: "Adjustment",
};

function parseQty(value: string | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function sumQty(values: string[]): string {
  return formatQty(values.reduce((acc, v) => acc + parseQty(v), 0));
}

function uomFor(isBottled: boolean, uom: string | null | undefined): string {
  if (uom?.trim()) return uom.trim();
  return isBottled ? "Unit" : "Kg";
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayStart(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function nextDayStart(iso: string): Date {
  return new Date(dayStart(iso).getTime() + 86_400_000);
}

function normalizeIsoDate(value: unknown, label: string): string {
  const iso = String(value ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(dayStart(iso).getTime())) {
    throw new Error(`Invalid ${label} date.`);
  }
  return iso;
}

function describeError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function normalizeFilter(value: unknown): StockProductFilter {
  if (value === "all") return "all";
  return value === "bottled" ? "bottled" : "bulk";
}

function resolveTransferMode(from: number, to: number): TransferMode {
  return from === to ? "INTRA_SALES_POINT" : "INTER_SALES_POINT";
}

/** Port of resolveStockProductFilterFromAccess (src/shared/stockModule.ts). */
function resolveProductFilter(
  actor: RpcActor,
  requested?: StockProductFilter | null,
): StockProductFilter {
  const bulk = routeAccess(actor, STOCK_MODULE_ROUTE_ID);
  const bottled = routeAccess(actor, BOTTLED_STOCK_ROUTE_ID);
  const normalized =
    requested === undefined || requested === null
      ? null
      : normalizeFilter(requested);
  const hasBulk = bulk !== "none";
  const hasBottled = bottled !== "none";

  if (hasBottled && bulk !== "write") return "bottled";
  if (normalized === "bottled" && hasBottled) return "bottled";
  if (hasBulk) return "bulk";
  return hasBottled ? "bottled" : "bulk";
}

function assertSalesPointScope(actor: RpcActor, salesPointId: number): void {
  if (actor.salesPointId != null && actor.salesPointId !== salesPointId) {
    throw new Error("You can only work within your assigned collection point.");
  }
}

/** Bulk docs need Stock write; bottled docs need Bottle Stock write. */
function assertStockModuleWrite(actor: RpcActor, filter: StockProductFilter): void {
  if (filter === "bottled") {
    assertRouteWrite(actor, BOTTLED_STOCK_ROUTE_ID);
    return;
  }
  assertRouteWrite(actor, STOCK_MODULE_ROUTE_ID);
}

// ---------------------------------------------------------------------------
// Catalog (products / locations / sales points / users)
// ---------------------------------------------------------------------------

type ProductInfo = {
  productId: number;
  productName: string;
  productCode: string | null;
  uom: string;
  isBottled: boolean;
  omitsStorageLocation: boolean;
  stockIntakeGroup: "PALM_OIL" | "SLUDGE_OIL" | "PALM_KERNEL" | null;
  stockPoolProductId: number | null;
  excludeFromSales: boolean;
};

type LocationInfo = {
  id: number;
  salesPointId: number;
  name: string;
  isDefault: boolean;
  isSalesTank: boolean;
};

type SalesPointInfo = {
  id: number;
  name: string;
  isActive: boolean;
  attachedToMill: boolean;
};

type Catalog = {
  products: Map<number, ProductInfo>;
  locations: Map<number, LocationInfo>;
  salesPoints: Map<number, SalesPointInfo>;
};

async function loadCatalog(): Promise<Catalog> {
  const [products, locations, salesPoints] = await Promise.all([
    prisma.products.findMany({
      include: { product_cats: { select: { is_bottled: true } } },
    }),
    prisma.storage_locations.findMany({
      include: { locations: { select: { location_name: true } } },
    }),
    prisma.sales_points.findMany(),
  ]);

  const productMap = new Map<number, ProductInfo>();
  for (const p of products) {
    const stockIntakeGroup =
      p.stock_intake_group === "PALM_OIL" ||
      p.stock_intake_group === "SLUDGE_OIL" ||
      p.stock_intake_group === "PALM_KERNEL"
        ? p.stock_intake_group
        : null;
    productMap.set(p.product_id, {
      productId: p.product_id,
      productName: p.product_name,
      productCode: p.product_code,
      uom: uomFor(p.product_cats?.is_bottled ?? false, p.uom),
      isBottled: p.product_cats?.is_bottled ?? false,
      omitsStorageLocation: Boolean(p.omits_storage_location),
      stockIntakeGroup,
      stockPoolProductId: p.stock_pool_product_id ?? null,
      excludeFromSales: Boolean(p.exclude_from_sales),
    });
  }

  return {
    products: productMap,
    locations: new Map(
      locations.map((l) => [
        l.id,
        {
          id: l.id,
          salesPointId: l.sales_point_id,
          name: l.locations.location_name,
          isDefault: l.is_default,
          isSalesTank: l.is_sales_tank,
        },
      ]),
    ),
    salesPoints: new Map(
      salesPoints.map((sp) => [
        sp.id,
        {
          id: sp.id,
          name: sp.name,
          isActive: sp.is_active,
          attachedToMill: sp.attached_to_mill,
        },
      ]),
    ),
  };
}

async function loadUserNames(
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.users.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

function productName(cat: Catalog, id: number): string {
  return cat.products.get(id)?.productName ?? `Product ${id}`;
}

function productUom(cat: Catalog, id: number): string {
  const p = cat.products.get(id);
  return p ? p.uom : uomFor(false, null);
}

function salesPointName(cat: Catalog, id: number): string {
  return cat.salesPoints.get(id)?.name ?? `Collection point ${id}`;
}

function locationName(cat: Catalog, id: number | null): string {
  if (id == null) return "—";
  return cat.locations.get(id)?.name ?? `Location ${id}`;
}

function matchesFilter(
  cat: Catalog,
  productId: number,
  filter: StockProductFilter,
): boolean {
  if (filter === "all") return true;
  const isBottled = cat.products.get(productId)?.isBottled ?? false;
  return filter === "bottled" ? isBottled : !isBottled;
}

/** Product ids matching a UI filter, or null when the filter is "all". */
function productIdsForFilter(cat: Catalog, filter: StockProductFilter): number[] | null {
  if (filter === "all") return null;
  return [...cat.products.values()]
    .filter((p) => (filter === "bottled" ? p.isBottled : !p.isBottled))
    .map((p) => p.productId);
}

function isLooseLpoProduct(p: ProductInfo): boolean {
  if (p.isBottled) return false;
  if ((p.productCode ?? "").trim().toUpperCase() === "LPO") return true;
  return p.productName.trim().toLowerCase() === "loose palm oil";
}

function mapProductOption(p: ProductInfo): ProductOption {
  const excludeFromSales = p.excludeFromSales;
  const stockPoolProductId = p.stockPoolProductId;
  const stockIntakeGroup = p.stockIntakeGroup;
  return {
    productId: p.productId,
    productName: p.productName,
    uom: p.uom,
    isBottled: p.isBottled,
    isLoosePalmOil: isLooseLpoProduct(p),
    omitsStorageLocation: p.omitsStorageLocation,
    stockIntakeGroup,
    stockPoolProductId,
    excludeFromSales,
    isStockPool:
      Boolean(excludeFromSales) &&
      stockPoolProductId == null &&
      stockIntakeGroup != null,
  };
}

function mapLocationOption(l: LocationInfo): StorageLocationOption {
  return {
    id: l.id,
    salesPointId: l.salesPointId,
    name: l.name,
    isDefault: l.isDefault,
    isSalesTank: l.isSalesTank,
    allowsMultiProduct: false,
  };
}

// ---------------------------------------------------------------------------
// Balances (derived from stock_movements; there is no StockBalance table)
// ---------------------------------------------------------------------------

type Balance = {
  salesPointId: number;
  productId: number;
  storageLocationId: number | null;
  condition: StockCondition;
  qty: number;
};

function balanceKey(
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
  condition: StockCondition,
): string {
  return `${salesPointId}:${productId}:${storageLocationId ?? "null"}:${condition}`;
}

async function aggregateBalances(opts: {
  beforeExclusive?: Date;
  salesPointId?: number | null;
}): Promise<Balance[]> {
  const rows = await prisma.stock_movements.findMany({
    where: {
      ...(opts.beforeExclusive ? { occurred_at: { lt: opts.beforeExclusive } } : {}),
      ...(opts.salesPointId != null ? { sales_point_id: opts.salesPointId } : {}),
    },
    select: {
      sales_point_id: true,
      product_id: true,
      storage_location_id: true,
      condition: true,
      kind: true,
      qty: true,
    },
  });

  const totals = new Map<string, Balance>();
  for (const row of rows) {
    const condition: StockCondition =
      row.condition === "UNSELLABLE" ? "UNSELLABLE" : "SELLABLE";
    const key = balanceKey(
      row.sales_point_id,
      row.product_id,
      row.storage_location_id,
      condition,
    );
    const signed = signedDeltaForKind(row.kind as StockMovementKind, row.qty);
    const existing = totals.get(key);
    if (existing) {
      existing.qty += signed;
    } else {
      totals.set(key, {
        salesPointId: row.sales_point_id,
        productId: row.product_id,
        storageLocationId: row.storage_location_id,
        condition,
        qty: signed,
      });
    }
  }
  return [...totals.values()].filter((b) => Math.abs(b.qty) > QTY_EPS);
}

function toBalanceRow(b: Balance, cat: Catalog, qty = b.qty): StockBalanceRow {
  return {
    salesPointId: b.salesPointId,
    salesPointName: salesPointName(cat, b.salesPointId),
    storageLocationId: b.storageLocationId,
    storageLocationName: locationName(cat, b.storageLocationId),
    productId: b.productId,
    productName: productName(cat, b.productId),
    uom: productUom(cat, b.productId),
    condition: b.condition,
    qty: formatQty(qty),
  };
}

function sortBalanceRows(rows: StockBalanceRow[]): StockBalanceRow[] {
  return rows.sort((a, b) => {
    const bySp = a.salesPointName.localeCompare(b.salesPointName);
    if (bySp !== 0) return bySp;
    const byLoc = a.storageLocationName.localeCompare(b.storageLocationName);
    if (byLoc !== 0) return byLoc;
    return a.productName.localeCompare(b.productName);
  });
}

// ---------------------------------------------------------------------------
// Document record types & mappers
// ---------------------------------------------------------------------------

type ReceiptRecord = Prisma.stock_receiptsGetPayload<{
  include: { stock_receipt_lines: true };
}>;
type TransferRecord = Prisma.stock_transfersGetPayload<{
  include: { stock_transfer_lines: true };
}>;
type AdjustmentRecord = Prisma.stock_adjustmentsGetPayload<{
  include: { stock_adjustment_lines: true };
}>;

function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function receiptListRow(
  r: ReceiptRecord,
  lines: ReceiptRecord["stock_receipt_lines"],
  cat: Catalog,
  names: Map<string, string>,
): ReceiptListRow {
  return {
    id: r.id,
    receiptNo: r.receipt_no,
    salesPointId: r.sales_point_id,
    salesPointName: salesPointName(cat, r.sales_point_id),
    receivedAtIso: utcDay(r.received_at),
    supplierLabel: r.supplier_label,
    consignmentNoteNo: r.consignment_note_no ?? null,
    status: r.status as StockDocStatus,
    totalQty: sumQty(lines.map((l) => l.qty)),
    lineCount: lines.length,
    createdByName: names.get(r.created_by_user_id) ?? "—",
    postedByName: r.posted_by_user_id ? (names.get(r.posted_by_user_id) ?? null) : null,
    postedAtIso: r.posted_at ? r.posted_at.toISOString() : null,
    createdAtIso: r.created_at.toISOString(),
  };
}

function receiptDetailRow(
  r: ReceiptRecord,
  cat: Catalog,
  names: Map<string, string>,
): ReceiptDetail {
  const lines = byId(r.stock_receipt_lines);
  return {
    ...receiptListRow(r, lines, cat, names),
    notes: r.notes ?? null,
    consignedBy: r.consigned_by ?? null,
    consDesign: r.cons_design ?? null,
    consDate: r.cons_date ?? null,
    receiveBy: r.receive_by ?? null,
    receiveByDesign: r.receive_by_design ?? null,
    receiveDate: r.receive_date ?? null,
    lines: lines.map((l) => ({
      id: l.id,
      productId: l.product_id,
      productName: productName(cat, l.product_id),
      uom: productUom(cat, l.product_id),
      qty: l.qty,
      storageLocationId: l.storage_location_id,
      storageLocationName: locationName(cat, l.storage_location_id),
    })),
  };
}

function transferLocationSummary(
  t: TransferRecord,
  mode: TransferMode,
  cat: Catalog,
): string | null {
  if (mode !== "INTRA_SALES_POINT") return null;
  const first = byId(t.stock_transfer_lines)[0];
  if (!first || first.from_storage_location_id == null) return null;
  const from = locationName(cat, first.from_storage_location_id);
  if (first.to_storage_location_id == null) return from;
  return `${from} → ${locationName(cat, first.to_storage_location_id)}`;
}

function transferListRow(
  t: TransferRecord,
  lines: TransferRecord["stock_transfer_lines"],
  cat: Catalog,
  names: Map<string, string>,
): TransferListRow {
  const mode = resolveTransferMode(t.from_sales_point_id, t.to_sales_point_id);
  const productNames = [
    ...new Set(
      lines.map((l) => productName(cat, l.product_id).trim()).filter((n) => n.length > 0),
    ),
  ];
  return {
    id: t.id,
    transferNo: t.transfer_no,
    transferMode: mode,
    locationSummary: transferLocationSummary(t, mode, cat),
    productSummary: productNames.length > 0 ? productNames.join(", ") : null,
    fromSalesPointId: t.from_sales_point_id,
    fromSalesPointName: salesPointName(cat, t.from_sales_point_id),
    toSalesPointId: t.to_sales_point_id,
    toSalesPointName: salesPointName(cat, t.to_sales_point_id),
    dispatchedAtIso: t.dispatched_at ? utcDay(t.dispatched_at) : null,
    receivedAtIso: t.received_at ? utcDay(t.received_at) : null,
    status: t.status as StockDocStatus,
    totalQty: sumQty(lines.map((l) => l.qty)),
    lineCount: lines.length,
    createdByName: names.get(t.created_by_user_id) ?? "—",
    // Dispatch / intra-post both stamp posted_by_user_id.
    dispatchedByName: t.posted_by_user_id ? (names.get(t.posted_by_user_id) ?? null) : null,
    receivedByName: t.received_by_user_id ? (names.get(t.received_by_user_id) ?? null) : null,
    createdAtIso: t.created_at.toISOString(),
  };
}

function consignmentFields(t: TransferRecord): TransferConsignmentFields {
  const day = (v: string | null) => (v ? v.slice(0, 10) : null);
  return {
    consignedBy: t.consigned_by || null,
    consDesign: t.cons_design || null,
    consDate: day(t.cons_date),
    receiveBy: t.receive_by || null,
    receiveByDesign: t.receive_by_design || null,
    receiveDate: day(t.receive_date),
  };
}

function transferDetailRow(
  t: TransferRecord,
  cat: Catalog,
  names: Map<string, string>,
): TransferDetail {
  const lines = byId(t.stock_transfer_lines);
  return {
    ...transferListRow(t, lines, cat, names),
    notes: t.notes ?? null,
    ...consignmentFields(t),
    lines: lines.map((l) => ({
      id: l.id,
      productId: l.product_id,
      productName: productName(cat, l.product_id),
      uom: productUom(cat, l.product_id),
      qty: l.qty,
      fromStorageLocationId: l.from_storage_location_id ?? 0,
      fromStorageLocationName: locationName(cat, l.from_storage_location_id),
      toStorageLocationId: l.to_storage_location_id,
      toStorageLocationName:
        l.to_storage_location_id == null
          ? null
          : locationName(cat, l.to_storage_location_id),
    })),
  };
}

function adjustmentListRow(
  a: AdjustmentRecord,
  cat: Catalog,
  names: Map<string, string>,
): AdjustmentListRow {
  return {
    id: a.id,
    adjustmentNo: a.adjustment_no,
    salesPointId: a.sales_point_id,
    salesPointName: salesPointName(cat, a.sales_point_id),
    occurredAtIso: utcDay(a.occurred_at),
    reason: a.reason,
    status: a.status as StockDocStatus,
    sourceKind: a.source_kind === "CARRY_FORWARD" ? "CARRY_FORWARD" : "NORMAL",
    lineCount: a.stock_adjustment_lines.length,
    createdByName: names.get(a.created_by_user_id) ?? "—",
    postedByName: a.posted_by_user_id ? (names.get(a.posted_by_user_id) ?? null) : null,
    postedAtIso: a.posted_at ? a.posted_at.toISOString() : null,
    createdAtIso: a.created_at.toISOString(),
  };
}

function adjustmentDetailRow(
  a: AdjustmentRecord,
  cat: Catalog,
  names: Map<string, string>,
): AdjustmentDetail {
  return {
    ...adjustmentListRow(a, cat, names),
    lines: byId(a.stock_adjustment_lines).map((l) => ({
      id: l.id,
      productId: l.product_id,
      productName: productName(cat, l.product_id),
      uom: productUom(cat, l.product_id),
      deltaQty: l.delta_qty,
      storageLocationId: l.storage_location_id ?? 0,
      storageLocationName: locationName(cat, l.storage_location_id),
      fromCondition: (l.from_condition as StockCondition | null) ?? null,
      toCondition: (l.to_condition as StockCondition | null) ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Lists for bootstrap
// ---------------------------------------------------------------------------

async function loadReceiptList(
  scoped: number | null,
  filter: StockProductFilter,
  cat: Catalog,
): Promise<ReceiptListRow[]> {
  // Bulk screen owns all receipts; only the bottled view narrows by product.
  const filterByProduct = filter === "bottled";
  const ids = filterByProduct ? productIdsForFilter(cat, "bottled") : null;
  const rows = await prisma.stock_receipts.findMany({
    where: {
      ...(scoped != null ? { sales_point_id: scoped } : {}),
      ...(ids ? { stock_receipt_lines: { some: { product_id: { in: ids } } } } : {}),
    },
    include: { stock_receipt_lines: true },
    orderBy: [{ received_at: "desc" }, { created_at: "desc" }],
    take: LIST_LIMIT,
  });
  const names = await loadUserNames(
    rows.flatMap((r) => [r.created_by_user_id, r.posted_by_user_id]),
  );
  return rows.map((r) =>
    receiptListRow(
      r,
      filterByProduct
        ? r.stock_receipt_lines.filter((l) => matchesFilter(cat, l.product_id, "bottled"))
        : r.stock_receipt_lines,
      cat,
      names,
    ),
  );
}

async function loadTransferList(
  scoped: number | null,
  filter: StockProductFilter,
  cat: Catalog,
): Promise<TransferListRow[]> {
  const ids = productIdsForFilter(cat, filter);
  const rows = await prisma.stock_transfers.findMany({
    where: {
      ...(scoped != null
        ? { OR: [{ from_sales_point_id: scoped }, { to_sales_point_id: scoped }] }
        : {}),
      ...(ids ? { stock_transfer_lines: { some: { product_id: { in: ids } } } } : {}),
    },
    include: { stock_transfer_lines: true },
    orderBy: { created_at: "desc" },
    take: LIST_LIMIT,
  });
  const names = await loadUserNames(
    rows.flatMap((t) => [t.created_by_user_id, t.posted_by_user_id, t.received_by_user_id]),
  );
  return rows.map((t) =>
    transferListRow(
      t,
      ids ? t.stock_transfer_lines.filter((l) => matchesFilter(cat, l.product_id, filter)) : t.stock_transfer_lines,
      cat,
      names,
    ),
  );
}

async function loadAdjustmentList(
  scoped: number | null,
  filter: StockProductFilter,
  cat: Catalog,
): Promise<AdjustmentListRow[]> {
  const ids = productIdsForFilter(cat, filter);
  const rows = await prisma.stock_adjustments.findMany({
    where: {
      ...(scoped != null ? { sales_point_id: scoped } : {}),
      ...(ids ? { stock_adjustment_lines: { some: { product_id: { in: ids } } } } : {}),
    },
    include: { stock_adjustment_lines: true },
    orderBy: [{ occurred_at: "desc" }, { created_at: "desc" }],
    take: LIST_LIMIT,
  });
  const names = await loadUserNames(
    rows.flatMap((a) => [a.created_by_user_id, a.posted_by_user_id]),
  );
  return rows.map((a) => adjustmentListRow(a, cat, names));
}

/** Resolves a document number for each distinct movement source. */
async function resolveMovementDocuments(
  rows: Array<{ source_kind: string; source_id: string }>,
): Promise<{
  docNoByKey: Map<string, string>;
  carryForwardByKey: Map<string, boolean>;
}> {
  const idsByKind = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = idsByKind.get(row.source_kind) ?? new Set<string>();
    set.add(row.source_id);
    idsByKind.set(row.source_kind, set);
  }
  const ids = (kind: string) => [...(idsByKind.get(kind) ?? [])];

  const [receipts, transfers, sales, adjustments] = await Promise.all([
    ids("RECEIPT").length
      ? prisma.stock_receipts.findMany({
          where: { id: { in: ids("RECEIPT") } },
          select: { id: true, receipt_no: true },
        })
      : [],
    ids("TRANSFER").length
      ? prisma.stock_transfers.findMany({
          where: { id: { in: ids("TRANSFER") } },
          select: { id: true, transfer_no: true },
        })
      : [],
    ids("SALE").length
      ? prisma.sales.findMany({
          where: { id: { in: ids("SALE") } },
          select: { id: true, invoice_no: true },
        })
      : [],
    ids("ADJUSTMENT").length
      ? prisma.stock_adjustments.findMany({
          where: { id: { in: ids("ADJUSTMENT") } },
          select: { id: true, adjustment_no: true, source_kind: true },
        })
      : [],
  ]);

  const docNoByKey = new Map<string, string>();
  const carryForwardByKey = new Map<string, boolean>();
  for (const r of receipts) docNoByKey.set(`RECEIPT:${r.id}`, r.receipt_no);
  for (const t of transfers) docNoByKey.set(`TRANSFER:${t.id}`, t.transfer_no);
  for (const s of sales) docNoByKey.set(`SALE:${s.id}`, s.invoice_no);
  for (const a of adjustments) {
    docNoByKey.set(`ADJUSTMENT:${a.id}`, a.adjustment_no);
    carryForwardByKey.set(`ADJUSTMENT:${a.id}`, a.source_kind === "CARRY_FORWARD");
  }
  return { docNoByKey, carryForwardByKey };
}

async function loadMovementList(
  scoped: number | null,
  filter: StockProductFilter,
  cat: Catalog,
): Promise<StockMovementRow[]> {
  const ids = productIdsForFilter(cat, filter);
  const rows = await prisma.stock_movements.findMany({
    where: {
      ...(scoped != null ? { sales_point_id: scoped } : {}),
      ...(ids ? { product_id: { in: ids } } : {}),
    },
    orderBy: [{ occurred_at: "desc" }, { created_at: "desc" }],
    take: MOVEMENT_LIMIT,
  });
  const [{ docNoByKey, carryForwardByKey }, names] = await Promise.all([
    resolveMovementDocuments(rows),
    loadUserNames(rows.map((r) => r.user_id)),
  ]);

  return rows.map((row) => {
    const key = `${row.source_kind}:${row.source_id}`;
    const kind = row.kind as StockMovementKind;
    return {
      id: row.id,
      occurredAtIso: row.occurred_at.toISOString(),
      salesPointId: row.sales_point_id,
      salesPointName: salesPointName(cat, row.sales_point_id),
      storageLocationId: row.storage_location_id,
      storageLocationName: locationName(cat, row.storage_location_id),
      productId: row.product_id,
      productName: productName(cat, row.product_id),
      uom: productUom(cat, row.product_id),
      kind,
      condition: row.condition === "UNSELLABLE" ? "UNSELLABLE" : "SELLABLE",
      qty: row.qty,
      signedQty: formatQty(signedDeltaForKind(kind, row.qty)),
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      documentNo: docNoByKey.get(key) ?? null,
      userId: row.user_id,
      userName: names.get(row.user_id) ?? "—",
      notes: row.notes ?? null,
      createdAtIso: row.created_at.toISOString(),
      isCarryForward: carryForwardByKey.get(key) === true,
    };
  });
}

// ---------------------------------------------------------------------------
// stock.getBootstrap
// ---------------------------------------------------------------------------

export async function getBootstrap(
  userId: string,
  productFilterInput?: StockProductFilter | null,
): Promise<StockBootstrap> {
  const actor = await loadRpcActor(userId);
  const productFilter = resolveProductFilter(actor, productFilterInput);
  const scoped = actor.salesPointId;

  if (productFilter === "bottled") {
    if (
      !canAccessRoute(actor, BOTTLED_STOCK_ROUTE_ID) &&
      !canAccessRoute(actor, "stock-bin-card")
    ) {
      throw new Error("You do not have permission to view bottled stock.");
    }
  } else if (!canAccessRoute(actor, STOCK_MODULE_ROUTE_ID)) {
    throw new Error("You do not have permission to view stock.");
  }

  const moduleWrite =
    productFilter === "bottled"
      ? canWriteRoute(actor, BOTTLED_STOCK_ROUTE_ID)
      : canWriteRoute(actor, STOCK_MODULE_ROUTE_ID);
  const can = (key: string) => moduleWrite && canPerformAction(actor, key);

  const canDraftReceipts = can("draft_stock_receipts");
  const canPostReceipts = can("post_stock_receipts");
  const canDraftTransfers = can("draft_stock_transfers");
  const canPostTransfers = can("post_stock_transfers");
  // Bottle stock is received via Reception (consignment note) at Bota — not transfers.
  const canReceiveTransfers = false;
  const canDraftAdjustments = can("draft_stock_adjustments");
  const canPostAdjustments = can("post_stock_adjustments");

  const cat = await loadCatalog();
  const onHandIds = productIdsForFilter(cat, productFilter);

  const [balances, movements, receipts, transfers, adjustments, company] =
    await Promise.all([
      aggregateBalances({ salesPointId: scoped }),
      productFilter === "bottled"
        ? Promise.resolve([] as StockMovementRow[])
        : loadMovementList(scoped, productFilter, cat),
      loadReceiptList(scoped, productFilter, cat),
      loadTransferList(scoped, productFilter, cat),
      loadAdjustmentList(scoped, productFilter, cat),
      prisma.company_settings.findFirst({
        where: { id: "default" },
        select: {
          stock_intake_oil_grouping: true,
          stock_transfer_receive_uses_document_date: true,
          loose_palm_oil_allow_inter_sales_point_transfer: true,
        },
      }),
    ]);

  const onHand = sortBalanceRows(
    balances
      .filter((b) => !onHandIds || onHandIds.includes(b.productId))
      .map((b) => toBalanceRow(b, cat)),
  );

  const byName = (a: { productName: string }, b: { productName: string }) =>
    a.productName.localeCompare(b.productName);
  const allProducts = [...cat.products.values()].map(mapProductOption).sort(byName);

  const storageLocations = [...cat.locations.values()]
    .filter((l) => cat.salesPoints.get(l.salesPointId)?.isActive !== false)
    .sort(
      (a, b) => a.salesPointId - b.salesPointId || a.name.localeCompare(b.name),
    )
    .map(mapLocationOption);

  const salesPoints = [...cat.salesPoints.values()]
    .filter((sp) => sp.isActive)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((sp) => ({ id: sp.id, name: sp.name, attachedToMill: sp.attachedToMill }));

  const botaSalesPointId =
    salesPoints.find((sp) => sp.name.toUpperCase().includes("BOTA"))?.id ?? null;

  return {
    productFilter,
    canManageReceipts: canPostReceipts,
    canInitiateTransfers: canDraftTransfers || canPostTransfers,
    canDispatchTransfers: canPostTransfers,
    canReceiveTransfers,
    canCancelTransfers: canPostTransfers,
    canPostAdjustments,
    canReclassifyStock: canPostAdjustments,
    canCancelDocuments: canPostReceipts || canPostTransfers || canPostAdjustments,
    canDraftReceipts,
    canDraftTransfers,
    canDraftAdjustments,
    canDirectPostReceipts: can("direct_post_stock_receipts"),
    canDirectPostTransfers: can("direct_post_stock_transfers"),
    scopedSalesPointId: scoped,
    botaSalesPointId,
    salesPoints,
    storageLocations,
    products: allProducts.filter((p) => matchesFilter(cat, p.productId, productFilter)),
    receiptProducts: allProducts.filter((p) =>
      matchesFilter(cat, p.productId, productFilter),
    ),
    // Server auto-allocates numbers whenever the client omits them.
    autoGenerateReceiptNo: true,
    autoGenerateTransferNo: true,
    transferReceiveUsesDocumentDate: Boolean(
      company?.stock_transfer_receive_uses_document_date,
    ),
    loosePalmOilAllowInterSalesPointTransfer: Boolean(
      company?.loose_palm_oil_allow_inter_sales_point_transfer,
    ),
    stockIntakeOilGrouping: Boolean(company?.stock_intake_oil_grouping),
    onHand,
    movements,
    receipts,
    transfers,
    adjustments,
  };
}

// ---------------------------------------------------------------------------
// stock.listOnHandAsOf
// ---------------------------------------------------------------------------

export async function listOnHandAsOf(
  userId: string,
  input?: {
    asOfDate?: string;
    salesPointId?: number | null;
    productFilter?: StockProductFilter | null;
  } | null,
): Promise<StockBalanceRow[]> {
  const actor = await loadRpcActor(userId);
  const productFilter = normalizeFilter(input?.productFilter);

  if (productFilter === "bottled") {
    if (
      !canAccessRoute(actor, STOCK_MODULE_ROUTE_ID) &&
      !canAccessRoute(actor, BOTTLED_STOCK_ROUTE_ID)
    ) {
      throw new Error("Not allowed to view stock balances.");
    }
  } else if (
    !canAccessRoute(actor, STOCK_MODULE_ROUTE_ID) &&
    !canAccessRoute(actor, "stock-transfers") &&
    !canAccessRoute(actor, "stock-balance") &&
    !canAccessRoute(actor, BOTTLED_STOCK_ROUTE_ID)
  ) {
    throw new Error("Not allowed to view stock balances.");
  }

  const asOf = String(input?.asOfDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(dayStart(asOf).getTime())) {
    throw new Error("Invalid as-of date.");
  }

  const requested =
    input?.salesPointId != null && Number.isFinite(Number(input.salesPointId))
      ? Number(input.salesPointId)
      : null;
  if (requested != null) assertSalesPointScope(actor, requested);
  const filterSalesPointId = requested ?? actor.salesPointId;

  const cat = await loadCatalog();
  const [asOfBalances, liveBalances] = await Promise.all([
    aggregateBalances({
      beforeExclusive: nextDayStart(asOf),
      salesPointId: filterSalesPointId,
    }),
    aggregateBalances({ salesPointId: filterSalesPointId }),
  ]);
  const live = new Map(
    liveBalances.map((b) => [
      balanceKey(b.salesPointId, b.productId, b.storageLocationId, b.condition),
      b.qty,
    ]),
  );

  const out: StockBalanceRow[] = [];
  for (const bal of asOfBalances) {
    if (!matchesFilter(cat, bal.productId, productFilter)) continue;
    let qty = bal.qty;
    // Never offer more than current on-hand for sellable rows (backdated as-of
    // can exceed live after later outs).
    if (bal.condition === "SELLABLE") {
      const liveQty =
        live.get(
          balanceKey(bal.salesPointId, bal.productId, bal.storageLocationId, bal.condition),
        ) ?? 0;
      qty = Math.min(qty, Math.max(0, liveQty));
      if (Math.abs(qty) <= QTY_EPS) continue;
    }
    out.push(toBalanceRow(bal, cat, qty));
  }
  return sortBalanceRows(out);
}

// ---------------------------------------------------------------------------
// stock.getBinCard
// ---------------------------------------------------------------------------

function buildParticulars(
  kind: StockMovementKind,
  notes: string | null,
  isCarryForward: boolean,
): string {
  const label = isCarryForward ? "Opening / carry-forward" : (KIND_LABELS[kind] ?? kind);
  return notes?.trim() ? `${label} — ${notes.trim()}` : label;
}

export async function getBinCard(
  userId: string,
  query: BinCardQuery,
): Promise<BinCardReport> {
  const actor = await loadRpcActor(userId);
  if (
    !canAccessRoute(actor, "stock-bin-card") &&
    !canAccessRoute(actor, BOTTLED_STOCK_ROUTE_ID)
  ) {
    throw new Error("You do not have permission to view the bin card.");
  }

  const productId = Number(query?.productId);
  if (!Number.isFinite(productId) || productId <= 0) {
    throw new Error("Select a product.");
  }
  const fromIso = normalizeIsoDate(query.fromIso, "from");
  const toIso = normalizeIsoDate(query.toIso, "to");
  if (fromIso > toIso) {
    throw new Error("From date must be on or before To date.");
  }

  let salesPointId =
    query.salesPointId == null || !Number.isFinite(Number(query.salesPointId))
      ? null
      : Number(query.salesPointId);
  if (actor.salesPointId != null) salesPointId = actor.salesPointId;

  const storageLocationId =
    query.storageLocationId == null || !Number.isFinite(Number(query.storageLocationId))
      ? null
      : Number(query.storageLocationId);
  const condition: BinCardConditionFilter =
    query.condition === "UNSELLABLE" || query.condition === "ALL"
      ? query.condition
      : "SELLABLE";

  const cat = await loadCatalog();
  const product = cat.products.get(productId);
  if (!product) throw new Error("Product not found.");
  if (!product.isBottled) {
    throw new Error(
      `"${product.productName}" is not a bottled product. Bin card is for bottled products only.`,
    );
  }

  let salesPointLabel = "All collection points";
  if (salesPointId != null) {
    const sp = cat.salesPoints.get(salesPointId);
    if (!sp) throw new Error("Collection point not found.");
    salesPointLabel = sp.name;
  }

  let storageLocationLabel = "All locations";
  if (storageLocationId != null) {
    const loc = cat.locations.get(storageLocationId);
    if (!loc) throw new Error("Storage location not found.");
    if (salesPointId != null && loc.salesPointId !== salesPointId) {
      throw new Error("Storage location does not belong to the selected collection point.");
    }
    storageLocationLabel = loc.name;
  }

  const baseWhere: Prisma.stock_movementsWhereInput = {
    product_id: productId,
    ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
    ...(storageLocationId != null ? { storage_location_id: storageLocationId } : {}),
    ...(condition !== "ALL" ? { condition } : {}),
  };

  const [openingRows, periodRows] = await Promise.all([
    prisma.stock_movements.findMany({
      where: { ...baseWhere, occurred_at: { lt: dayStart(fromIso) } },
      select: { kind: true, qty: true },
    }),
    // Full period set (no take) so in-period CARRY_FORWARD can fold into Opening
    // before the soft row limit is applied to ledger lines.
    prisma.stock_movements.findMany({
      where: {
        ...baseWhere,
        occurred_at: { gte: dayStart(fromIso), lt: nextDayStart(toIso) },
      },
      orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }, { id: "asc" }],
    }),
  ]);

  let openingBalance = 0;
  for (const row of openingRows) {
    openingBalance += signedDeltaForKind(row.kind as StockMovementKind, row.qty);
  }

  const { docNoByKey, carryForwardByKey } =
    await resolveMovementDocuments(periodRows);

  const ledgerRows = [];
  for (const row of periodRows) {
    const key = `${row.source_kind}:${row.source_id}`;
    if (carryForwardByKey.get(key) === true) {
      openingBalance += signedDeltaForKind(row.kind as StockMovementKind, row.qty);
      continue;
    }
    ledgerRows.push(row);
  }

  const truncated = ledgerRows.length > BIN_CARD_ROW_LIMIT;
  const rows = truncated ? ledgerRows.slice(0, BIN_CARD_ROW_LIMIT) : ledgerRows;

  let running = openingBalance;
  const lines: BinCardLine[] = rows.map((row) => {
    const kind = row.kind as StockMovementKind;
    const signed = signedDeltaForKind(kind, row.qty);
    running += signed;
    const key = `${row.source_kind}:${row.source_id}`;
    const documentNo = docNoByKey.get(key) ?? null;
    const kindLabel = KIND_LABELS[kind] ?? kind;
    return {
      id: row.id,
      occurredAtIso: utcDay(row.occurred_at),
      reference: documentNo ?? kindLabel,
      particulars: buildParticulars(kind, row.notes ?? null, false),
      kind,
      condition: row.condition === "UNSELLABLE" ? "UNSELLABLE" : "SELLABLE",
      salesPointName: salesPointName(cat, row.sales_point_id),
      storageLocationName: locationName(cat, row.storage_location_id),
      qtyIn: parseQty(formatQty(signed > 0 ? signed : 0)),
      qtyOut: parseQty(formatQty(signed < 0 ? Math.abs(signed) : 0)),
      balance: parseQty(formatQty(running)),
      documentNo,
      notes: row.notes ?? null,
      isCarryForward: false,
    };
  });

  const settings = await loadReportCompanySettings(userId, toIso);

  return {
    productId: product.productId,
    productName: product.productName,
    uom: product.uom,
    isBottled: true,
    salesPointId,
    salesPointLabel,
    storageLocationId,
    storageLocationLabel,
    condition,
    fromIso,
    toIso,
    openingBalance: parseQty(formatQty(openingBalance)),
    closingBalance: parseQty(formatQty(running)),
    lines,
    truncated,
    companyName: settings.companyName,
    department: settings.department ?? null,
    serviceName: settings.serviceName ?? null,
  };
}

// ---------------------------------------------------------------------------
// Detail loaders, find-by-number, review, print
// ---------------------------------------------------------------------------

async function loadReceiptDetailFor(
  actor: RpcActor,
  id: string,
): Promise<ReceiptDetail | null> {
  const r = await prisma.stock_receipts.findUnique({
    where: { id },
    include: { stock_receipt_lines: true },
  });
  if (!r) return null;
  if (actor.salesPointId != null && r.sales_point_id !== actor.salesPointId) return null;
  const [cat, names] = await Promise.all([
    loadCatalog(),
    loadUserNames([r.created_by_user_id, r.posted_by_user_id]),
  ]);
  return receiptDetailRow(r, cat, names);
}

async function loadTransferDetailFor(
  actor: RpcActor,
  id: string,
): Promise<TransferDetail | null> {
  const t = await prisma.stock_transfers.findUnique({
    where: { id },
    include: { stock_transfer_lines: true },
  });
  if (!t) return null;
  if (
    actor.salesPointId != null &&
    t.from_sales_point_id !== actor.salesPointId &&
    t.to_sales_point_id !== actor.salesPointId
  ) {
    return null;
  }
  const [cat, names] = await Promise.all([
    loadCatalog(),
    loadUserNames([t.created_by_user_id, t.posted_by_user_id, t.received_by_user_id]),
  ]);
  return transferDetailRow(t, cat, names);
}

async function loadAdjustmentDetailFor(
  actor: RpcActor,
  id: string,
): Promise<AdjustmentDetail | null> {
  const a = await prisma.stock_adjustments.findUnique({
    where: { id },
    include: { stock_adjustment_lines: true },
  });
  if (!a) return null;
  if (actor.salesPointId != null && a.sales_point_id !== actor.salesPointId) return null;
  const [cat, names] = await Promise.all([
    loadCatalog(),
    loadUserNames([a.created_by_user_id, a.posted_by_user_id]),
  ]);
  return adjustmentDetailRow(a, cat, names);
}

function canViewDocs(actor: RpcActor, ...routes: string[]): boolean {
  return [STOCK_MODULE_ROUTE_ID, BOTTLED_STOCK_ROUTE_ID, ...routes].some((r) =>
    canAccessRoute(actor, r),
  );
}

export async function findReceiptByNumber(
  userId: string,
  receiptNo: string,
): Promise<ReceiptReviewResult> {
  try {
    const actor = await loadRpcActor(userId);
    if (!canViewDocs(actor, "stock-receipts")) {
      throw new Error("You do not have permission to view receipts.");
    }
    const trimmed = String(receiptNo ?? "").trim().toUpperCase();
    if (!trimmed) return { ok: false, error: "Enter a receipt number." };
    const row = await prisma.stock_receipts.findUnique({
      where: { receipt_no: trimmed },
      select: { id: true },
    });
    if (!row) return { ok: false, error: `Receipt "${trimmed}" not found.` };
    const detail = await loadReceiptDetailFor(actor, row.id);
    if (!detail) {
      return {
        ok: false,
        error: `Receipt "${trimmed}" is not visible to your collection point.`,
      };
    }
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not load receipt.") };
  }
}

export async function findReceiptByConsignmentNoteNo(
  userId: string,
  consignmentNoteNo: string,
): Promise<ReceiptReviewResult> {
  try {
    const actor = await loadRpcActor(userId);
    if (!canViewDocs(actor, "stock-receipts")) {
      throw new Error("You do not have permission to view receipts.");
    }
    const trimmed = String(consignmentNoteNo ?? "").trim();
    if (!trimmed) return { ok: false, error: "Enter a consignment number." };
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM stock_receipts
      WHERE consignment_note_no IS NOT NULL
        AND lower(btrim(consignment_note_no)) = lower(btrim(${trimmed}))
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return { ok: false, error: `Consignment # "${trimmed}" not found.` };
    }
    const detail = await loadReceiptDetailFor(actor, row.id);
    if (!detail) {
      return {
        ok: false,
        error: `Consignment # "${trimmed}" is not visible to your collection point.`,
      };
    }
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not load receipt.") };
  }
}

export async function loadReceiptForReview(
  userId: string,
  receiptId: string,
): Promise<ReceiptReviewResult> {
  try {
    const actor = await loadRpcActor(userId);
    const detail = await loadReceiptDetailFor(actor, String(receiptId ?? ""));
    if (!detail) return { ok: false, error: "Receipt not found." };
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not load receipt.") };
  }
}

export async function findTransferByNumber(
  userId: string,
  transferNo: string,
): Promise<TransferReviewResult> {
  try {
    const actor = await loadRpcActor(userId);
    if (!canViewDocs(actor, "stock-transfers")) {
      throw new Error("You do not have permission to view transfers.");
    }
    const trimmed = String(transferNo ?? "").trim().toUpperCase();
    if (!trimmed) return { ok: false, error: "Enter a transfer number." };
    const row = await prisma.stock_transfers.findUnique({
      where: { transfer_no: trimmed },
      select: { id: true },
    });
    if (!row) return { ok: false, error: `Transfer "${trimmed}" not found.` };
    const detail = await loadTransferDetailFor(actor, row.id);
    if (!detail) {
      return {
        ok: false,
        error: `Transfer "${trimmed}" is not visible to your collection point.`,
      };
    }
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not load transfer.") };
  }
}

export async function loadTransferForReview(
  userId: string,
  transferId: string,
): Promise<TransferReviewResult> {
  try {
    const actor = await loadRpcActor(userId);
    const detail = await loadTransferDetailFor(actor, String(transferId ?? ""));
    if (!detail) return { ok: false, error: "Transfer not found." };
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not load transfer.") };
  }
}

export async function findAdjustmentByNumber(
  userId: string,
  adjustmentNo: string,
): Promise<AdjustmentReviewResult> {
  try {
    const actor = await loadRpcActor(userId);
    if (!canViewDocs(actor, "stock-adjustments")) {
      throw new Error("You do not have permission to view adjustments.");
    }
    const trimmed = String(adjustmentNo ?? "").trim().toUpperCase();
    if (!trimmed) return { ok: false, error: "Enter an adjustment number." };
    const row = await prisma.stock_adjustments.findUnique({
      where: { adjustment_no: trimmed },
      select: { id: true },
    });
    if (!row) return { ok: false, error: `Adjustment "${trimmed}" not found.` };
    const detail = await loadAdjustmentDetailFor(actor, row.id);
    if (!detail) {
      return {
        ok: false,
        error: `Adjustment "${trimmed}" is not visible to your collection point.`,
      };
    }
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not load adjustment.") };
  }
}

export async function loadAdjustmentForReview(
  userId: string,
  adjustmentId: string,
): Promise<AdjustmentReviewResult> {
  try {
    const actor = await loadRpcActor(userId);
    const detail = await loadAdjustmentDetailFor(actor, String(adjustmentId ?? ""));
    if (!detail) return { ok: false, error: "Adjustment not found." };
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not load adjustment.") };
  }
}

export async function loadReceiptPrintById(
  userId: string,
  receiptId: string,
): Promise<ReceiptPrintPayload | null> {
  const actor = await loadRpcActor(userId);
  const receipt = await loadReceiptDetailFor(actor, String(receiptId ?? ""));
  if (!receipt) return null;
  const settings = await loadReportCompanySettings(userId, receipt.receivedAtIso);
  return {
    companyName: settings.companyName,
    department: settings.department,
    serviceName: settings.serviceName,
    signatoryName: settings.signatoryName,
    signatoryTitle: settings.signatoryTitle,
    receipt,
  };
}

export async function loadTransferPrintById(
  userId: string,
  transferId: string,
): Promise<TransferPrintPayload | null> {
  const actor = await loadRpcActor(userId);
  const transfer = await loadTransferDetailFor(actor, String(transferId ?? ""));
  if (!transfer) return null;
  const asAtIso =
    transfer.dispatchedAtIso ??
    transfer.receivedAtIso ??
    transfer.createdAtIso.slice(0, 10);
  const settings = await loadReportCompanySettings(userId, asAtIso);
  return {
    companyName: settings.companyName,
    department: settings.department,
    serviceName: settings.serviceName,
    signatoryName: settings.signatoryName,
    signatoryTitle: settings.signatoryTitle,
    transfer,
  };
}

// ---------------------------------------------------------------------------
// Cancel / dispatch
// ---------------------------------------------------------------------------

/** Writes an ADJUSTMENT movement negating every movement recorded for a source. */
async function reverseMovementsBySource(
  tx: Prisma.TransactionClient,
  input: { sourceKind: string; sourceId: string; userId: string; notes: string },
): Promise<void> {
  const rows = await tx.stock_movements.findMany({
    where: { source_kind: input.sourceKind, source_id: input.sourceId },
    orderBy: { created_at: "asc" },
  });
  const occurredAt = new Date();
  for (const row of rows) {
    const signed = signedDeltaForKind(row.kind as StockMovementKind, row.qty);
    if (Math.abs(signed) < QTY_EPS) continue;
    await applyMovement(tx, {
      salesPointId: row.sales_point_id,
      productId: row.product_id,
      storageLocationId: row.storage_location_id,
      condition: row.condition === "UNSELLABLE" ? "UNSELLABLE" : "SELLABLE",
      qty: formatQty(-signed),
      kind: "ADJUSTMENT",
      occurredAt,
      userId: input.userId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      notes: input.notes,
    });
  }
}

async function cancelStockDocument(
  userId: string,
  kind: StockValidationDocKind,
  documentId: string,
  productFilterInput?: StockProductFilter | null,
): Promise<StockGenericResult> {
  try {
    const actor = await loadRpcActor(userId);
    const filter = normalizeFilter(productFilterInput);
    const draftAction = {
      RECEIPT: "draft_stock_receipts",
      TRANSFER: "draft_stock_transfers",
      ADJUSTMENT: "draft_stock_adjustments",
    }[kind];
    const postAction = {
      RECEIPT: "post_stock_receipts",
      TRANSFER: "post_stock_transfers",
      ADJUSTMENT: "post_stock_adjustments",
    }[kind];

    if (kind === "RECEIPT") {
      assertRouteWrite(actor, STOCK_MODULE_ROUTE_ID);
    } else {
      assertStockModuleWrite(actor, filter);
    }

    await prisma.$transaction(async (tx) => {
      if (kind === "RECEIPT") {
        const existing = await tx.stock_receipts.findUnique({ where: { id: documentId } });
        if (!existing) throw new Error("Receipt not found.");
        assertSalesPointScope(actor, existing.sales_point_id);
        if (existing.status === "CANCELLED") return;
        if (existing.status === "DRAFT") {
          assertAction(actor, draftAction);
          await tx.stock_receipt_lines.deleteMany({ where: { receipt_id: documentId } });
          await tx.stock_receipts.delete({ where: { id: documentId } });
          return;
        }
        assertAction(actor, postAction);
        await reverseMovementsBySource(tx, {
          sourceKind: "RECEIPT",
          sourceId: documentId,
          userId,
          notes: `Cancellation of receipt ${existing.receipt_no}`,
        });
        await tx.stock_receipts.update({
          where: { id: documentId },
          data: { status: "CANCELLED", updated_at: new Date() },
        });
        return;
      }

      if (kind === "TRANSFER") {
        const existing = await tx.stock_transfers.findUnique({ where: { id: documentId } });
        if (!existing) throw new Error("Transfer not found.");
        assertSalesPointScope(actor, existing.from_sales_point_id);
        if (existing.status === "CANCELLED") return;
        if (existing.status === "DRAFT") {
          assertAction(actor, draftAction);
          await tx.stock_transfer_lines.deleteMany({ where: { transfer_id: documentId } });
          await tx.stock_transfers.delete({ where: { id: documentId } });
          return;
        }
        assertAction(actor, postAction);
        await reverseMovementsBySource(tx, {
          sourceKind: "TRANSFER",
          sourceId: documentId,
          userId,
          notes: `Cancellation of transfer ${existing.transfer_no}`,
        });
        await tx.stock_transfers.update({
          where: { id: documentId },
          data: { status: "CANCELLED", updated_at: new Date() },
        });
        return;
      }

      const existing = await tx.stock_adjustments.findUnique({ where: { id: documentId } });
      if (!existing) throw new Error("Adjustment not found.");
      assertSalesPointScope(actor, existing.sales_point_id);
      if (existing.status === "CANCELLED") return;
      if (existing.status === "DRAFT") {
        assertAction(actor, draftAction);
        await tx.stock_adjustment_lines.deleteMany({ where: { adjustment_id: documentId } });
        await tx.stock_adjustments.delete({ where: { id: documentId } });
        return;
      }
      assertAction(actor, postAction);
      await reverseMovementsBySource(tx, {
        sourceKind: "ADJUSTMENT",
        sourceId: documentId,
        userId,
        notes: `Cancellation of adjustment ${existing.adjustment_no}`,
      });
      await tx.stock_adjustments.update({
        where: { id: documentId },
        data: { status: "CANCELLED", updated_at: new Date() },
      });
    }, TX_OPTIONS);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not cancel document.") };
  }
}

export function cancelReceipt(
  userId: string,
  receiptId: string,
  productFilter?: StockProductFilter | null,
): Promise<StockGenericResult> {
  return cancelStockDocument(userId, "RECEIPT", String(receiptId ?? ""), productFilter);
}

export function cancelTransfer(
  userId: string,
  transferId: string,
  productFilter?: StockProductFilter | null,
): Promise<StockGenericResult> {
  return cancelStockDocument(userId, "TRANSFER", String(transferId ?? ""), productFilter);
}

export function cancelAdjustment(
  userId: string,
  adjustmentId: string,
  productFilter?: StockProductFilter | null,
): Promise<StockGenericResult> {
  return cancelStockDocument(
    userId,
    "ADJUSTMENT",
    String(adjustmentId ?? ""),
    productFilter,
  );
}

/** DRAFT inter-site transfer -> DISPATCHED (TRANSFER_OUT at source). */
async function dispatchTransferTx(
  tx: Prisma.TransactionClient,
  actor: RpcActor,
  transferId: string,
): Promise<void> {
  const existing = await tx.stock_transfers.findUnique({
    where: { id: transferId },
    include: { stock_transfer_lines: true },
  });
  if (!existing) throw new Error("Transfer not found.");
  assertSalesPointScope(actor, existing.from_sales_point_id);
  if (existing.from_sales_point_id === existing.to_sales_point_id) {
    throw new Error("Use Post for location moves within a collection point.");
  }
  if (existing.status === "DISPATCHED" || existing.status === "RECEIVED") return;
  if (existing.status !== "DRAFT") {
    throw new Error(`Cannot dispatch a transfer in status ${existing.status}.`);
  }
  if (existing.stock_transfer_lines.length === 0) {
    throw new Error("Add at least one line before dispatching.");
  }

  const now = new Date();
  const occurredAt = existing.dispatched_at ?? now;
  for (const line of byId(existing.stock_transfer_lines)) {
    if (line.from_storage_location_id == null) {
      throw new Error("Each line needs a source storage location.");
    }
    await applyMovement(tx, {
      salesPointId: existing.from_sales_point_id,
      productId: line.product_id,
      storageLocationId: line.from_storage_location_id,
      qty: line.qty,
      kind: "TRANSFER_OUT",
      occurredAt,
      userId: actor.id,
      sourceKind: "TRANSFER",
      sourceId: existing.id,
    });
  }

  await tx.stock_transfers.update({
    where: { id: existing.id },
    data: {
      status: "DISPATCHED",
      posted_by_user_id: actor.id,
      posted_at: now,
      updated_at: now,
    },
  });
}

export async function dispatchTransfer(
  userId: string,
  transferId: string,
  productFilterInput?: StockProductFilter | null,
): Promise<StockGenericResult> {
  try {
    const actor = await loadRpcActor(userId);
    assertStockModuleWrite(actor, normalizeFilter(productFilterInput));
    assertAction(actor, "post_stock_transfers");
    await prisma.$transaction(
      (tx) => dispatchTransferTx(tx, actor, String(transferId ?? "")),
      TX_OPTIONS,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not dispatch transfer.") };
  }
}

// ---------------------------------------------------------------------------
// Validation (bulk post) & receive queue
// ---------------------------------------------------------------------------

const VALIDATION_QUEUE_LIMIT = 200;

function documentProductFilter(
  cat: Catalog,
  productIds: number[],
): StockProductFilter {
  const anyBottled = productIds.some(
    (id) => cat.products.get(id)?.isBottled === true,
  );
  return anyBottled ? "bottled" : "bulk";
}

function canSeeProductFilter(
  actor: RpcActor,
  filter: StockProductFilter,
): boolean {
  if (filter === "bottled") {
    return canAccessRoute(actor, BOTTLED_STOCK_ROUTE_ID);
  }
  return canAccessRoute(actor, STOCK_MODULE_ROUTE_ID);
}

export async function listValidationQueue(
  userId: string,
): Promise<StockValidationQueuePage> {
  const actor = await loadRpcActor(userId);
  if (
    !canAccessRoute(actor, "stock-validation") &&
    !canAccessRoute(actor, STOCK_MODULE_ROUTE_ID) &&
    !canAccessRoute(actor, BOTTLED_STOCK_ROUTE_ID)
  ) {
    throw new Error("You do not have permission to view the stock validation queue.");
  }

  const scoped = actor.salesPointId;
  const [cat, receipts, transfers, adjustments] = await Promise.all([
    loadCatalog(),
    prisma.stock_receipts.findMany({
      where: {
        status: "DRAFT",
        ...(scoped != null ? { sales_point_id: scoped } : {}),
      },
      include: {
        stock_receipt_lines: { select: { product_id: true, qty: true } },
      },
      orderBy: [{ received_at: "asc" }, { receipt_no: "asc" }],
      take: VALIDATION_QUEUE_LIMIT,
    }),
    prisma.stock_transfers.findMany({
      where: {
        status: "DRAFT",
        ...(scoped != null ? { from_sales_point_id: scoped } : {}),
      },
      include: {
        stock_transfer_lines: { select: { product_id: true, qty: true } },
      },
      orderBy: [{ dispatched_at: "asc" }, { transfer_no: "asc" }],
      take: VALIDATION_QUEUE_LIMIT,
    }),
    prisma.stock_adjustments.findMany({
      where: {
        status: "DRAFT",
        source_kind: { in: ["NORMAL", "CARRY_FORWARD"] },
        ...(scoped != null ? { sales_point_id: scoped } : {}),
      },
      include: {
        stock_adjustment_lines: {
          select: { product_id: true, delta_qty: true },
        },
      },
      orderBy: [{ occurred_at: "asc" }, { adjustment_no: "asc" }],
      take: VALIDATION_QUEUE_LIMIT,
    }),
  ]);

  const userNames = await loadUserNames([
    ...receipts.map((r) => r.created_by_user_id),
    ...transfers.map((t) => t.created_by_user_id),
    ...adjustments.map((a) => a.created_by_user_id),
  ]);

  const combined: StockValidationQueueRow[] = [];

  for (const receipt of receipts) {
    const productIds = receipt.stock_receipt_lines.map((l) => l.product_id);
    const productFilter = documentProductFilter(cat, productIds);
    if (!canSeeProductFilter(actor, productFilter)) continue;
    const totalQty = receipt.stock_receipt_lines.reduce(
      (sum, line) => sum + parseQty(line.qty),
      0,
    );
    combined.push({
      kind: "RECEIPT",
      id: receipt.id,
      documentNo: receipt.receipt_no,
      productFilter,
      transferMode: null,
      fromSalesPointName: salesPointName(cat, receipt.sales_point_id),
      toSalesPointName: null,
      documentDateIso: receipt.received_at.toISOString().slice(0, 10),
      createdByName: userNames.get(receipt.created_by_user_id) ?? "—",
      lineCount: receipt.stock_receipt_lines.length,
      totalQty: formatQty(totalQty),
    });
  }

  for (const transfer of transfers) {
    const productIds = transfer.stock_transfer_lines.map((l) => l.product_id);
    const productFilter = documentProductFilter(cat, productIds);
    if (!canSeeProductFilter(actor, productFilter)) continue;
    const totalQty = transfer.stock_transfer_lines.reduce(
      (sum, line) => sum + parseQty(line.qty),
      0,
    );
    const intra =
      transfer.from_sales_point_id === transfer.to_sales_point_id;
    combined.push({
      kind: "TRANSFER",
      id: transfer.id,
      documentNo: transfer.transfer_no,
      productFilter,
      transferMode: intra ? "INTRA_SALES_POINT" : "INTER_SALES_POINT",
      fromSalesPointName: salesPointName(cat, transfer.from_sales_point_id),
      toSalesPointName: salesPointName(cat, transfer.to_sales_point_id),
      documentDateIso: (transfer.dispatched_at ?? transfer.created_at)
        .toISOString()
        .slice(0, 10),
      createdByName: userNames.get(transfer.created_by_user_id) ?? "—",
      lineCount: transfer.stock_transfer_lines.length,
      totalQty: formatQty(totalQty),
    });
  }

  for (const adjustment of adjustments) {
    const productIds = adjustment.stock_adjustment_lines.map(
      (l) => l.product_id,
    );
    const productFilter = documentProductFilter(cat, productIds);
    if (!canSeeProductFilter(actor, productFilter)) continue;
    const totalQty = adjustment.stock_adjustment_lines.reduce(
      (sum, line) => sum + Math.abs(parseQty(line.delta_qty)),
      0,
    );
    combined.push({
      kind: "ADJUSTMENT",
      id: adjustment.id,
      documentNo: adjustment.adjustment_no,
      productFilter,
      transferMode: null,
      fromSalesPointName: salesPointName(cat, adjustment.sales_point_id),
      toSalesPointName: null,
      documentDateIso: adjustment.occurred_at.toISOString().slice(0, 10),
      createdByName: userNames.get(adjustment.created_by_user_id) ?? "—",
      lineCount: adjustment.stock_adjustment_lines.length,
      totalQty: formatQty(totalQty),
    });
  }

  combined.sort((a, b) => {
    const byDate = a.documentDateIso.localeCompare(b.documentDateIso);
    if (byDate !== 0) return byDate;
    return a.documentNo.localeCompare(b.documentNo);
  });

  const rows = combined.slice(0, VALIDATION_QUEUE_LIMIT);
  return {
    totalPending: combined.length,
    rows,
  };
}

export async function validateMany(
  userId: string,
  items: StockValidationItem[],
): Promise<StockValidateManyResult> {
  try {
    const actor = await loadRpcActor(userId);
    assertRouteWrite(actor, "stock-validation");
    assertAction(actor, "validate_stock_documents");

    const unique = new Map<string, StockValidationItem>();
    for (const item of Array.isArray(items) ? items : []) {
      if (!item?.id || !item.kind) continue;
      unique.set(`${item.kind}:${item.id}`, { kind: item.kind, id: String(item.id) });
    }
    if (unique.size === 0) {
      return { ok: false, error: "Select at least one stock document." };
    }

    let validated = 0;
    const errors: Array<{ kind: StockValidationDocKind; id: string; error: string }> = [];

    for (const item of unique.values()) {
      let result: StockGenericResult;
      try {
        if (item.kind === "RECEIPT") {
          assertAction(actor, "post_stock_receipts");
          const doc = await prisma.stock_receipts.findUnique({
            where: { id: item.id },
            select: { sales_point_id: true },
          });
          if (!doc) throw new Error("Receipt not found.");
          assertSalesPointScope(actor, doc.sales_point_id);
          result = await postReceiptCommand({ receiptId: item.id, userId });
        } else if (item.kind === "ADJUSTMENT") {
          assertAction(actor, "post_stock_adjustments");
          const doc = await prisma.stock_adjustments.findUnique({
            where: { id: item.id },
            select: { sales_point_id: true },
          });
          if (!doc) throw new Error("Adjustment not found.");
          assertSalesPointScope(actor, doc.sales_point_id);
          result = await postAdjustmentCommand({ adjustmentId: item.id, userId });
        } else if (item.kind === "TRANSFER") {
          assertAction(actor, "post_stock_transfers");
          const doc = await prisma.stock_transfers.findUnique({
            where: { id: item.id },
            select: { from_sales_point_id: true, to_sales_point_id: true },
          });
          if (!doc) throw new Error("Transfer not found.");
          assertSalesPointScope(actor, doc.from_sales_point_id);
          if (doc.from_sales_point_id === doc.to_sales_point_id) {
            result = await postTransferCommand({ transferId: item.id, userId });
          } else {
            await prisma.$transaction(
              (tx) => dispatchTransferTx(tx, actor, item.id),
              TX_OPTIONS,
            );
            result = { ok: true };
          }
        } else {
          result = { ok: false, error: "Unknown document kind." };
        }
      } catch (err) {
        result = { ok: false, error: describeError(err, "Could not validate document.") };
      }

      if (result.ok) {
        validated += 1;
      } else {
        errors.push({ kind: item.kind, id: item.id, error: result.error });
      }
    }
    return { ok: true, validated, errors };
  } catch (err) {
    return { ok: false, error: describeError(err, "Could not validate documents.") };
  }
}

export async function listReceiveQueue(userId: string): Promise<StockReceiveQueuePage> {
  const actor = await loadRpcActor(userId);
  assertAction(actor, "receive_stock_transfers");

  const scoped = actor.salesPointId;
  if (scoped == null && actor.role !== "ADMIN") {
    throw new Error(
      "Your user must be assigned to a collection point to receive transfers.",
    );
  }

  const cat = await loadCatalog();
  const bottledIds = productIdsForFilter(cat, "bottled") ?? [];

  const candidates = await prisma.stock_transfers.findMany({
    where: {
      status: "DISPATCHED",
      ...(scoped != null ? { to_sales_point_id: scoped } : {}),
      stock_transfer_lines: { some: { product_id: { in: bottledIds } } },
    },
    include: { stock_transfer_lines: true },
    orderBy: [{ dispatched_at: "desc" }, { created_at: "desc" }],
    take: QUEUE_LIMIT * 2,
  });
  // Inter-site only (column-to-column comparison is not expressible in Prisma where).
  const transfers = candidates
    .filter((t) => t.from_sales_point_id !== t.to_sales_point_id)
    .slice(0, QUEUE_LIMIT);

  const names = await loadUserNames(
    transfers.flatMap((t) => [t.created_by_user_id, t.posted_by_user_id]),
  );

  const rows: StockReceiveQueueRow[] = transfers.map((t) => ({
    id: t.id,
    transferNo: t.transfer_no,
    fromSalesPointId: t.from_sales_point_id,
    fromSalesPointName: salesPointName(cat, t.from_sales_point_id),
    toSalesPointId: t.to_sales_point_id,
    toSalesPointName: salesPointName(cat, t.to_sales_point_id),
    dispatchedAtIso: t.dispatched_at ? t.dispatched_at.toISOString() : null,
    totalQty: sumQty(t.stock_transfer_lines.map((l) => l.qty)),
    lineCount: t.stock_transfer_lines.length,
    createdByName: names.get(t.created_by_user_id) ?? "—",
    dispatchedByName: t.posted_by_user_id ? (names.get(t.posted_by_user_id) ?? null) : null,
  }));

  const storageLocations = [...cat.locations.values()]
    .sort((a, b) => a.salesPointId - b.salesPointId || a.name.localeCompare(b.name))
    .map(mapLocationOption);

  return {
    rows,
    storageLocations,
    transferReceiveUsesDocumentDate: false,
    scopedSalesPointId: scoped,
  };
}

// ---------------------------------------------------------------------------
// Intake oil grouping
// ---------------------------------------------------------------------------

export async function getIntakeOilGroupingStatus(): Promise<StockIntakeOilGroupingStatus> {
  return getIntakeOilGroupingStatusImpl();
}

export async function applyIntakeOilGrouping(
  userId: string,
  enabled: boolean,
): Promise<ApplyStockIntakeOilGroupingResult> {
  const actor = await loadRpcActor(userId);
  assertRouteWrite(actor, "company-settings");
  return applyIntakeOilGroupingImpl(userId, enabled);
}
