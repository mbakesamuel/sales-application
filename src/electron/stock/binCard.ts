import type {
  BinCardConditionFilter,
  BinCardLine,
  BinCardQuery,
  BinCardReport,
  StockCondition,
  StockMovementKind,
} from "../../shared/stock.types.js";
import { canAccessRoute } from "../auth/permissions/service.js";
import { getDatabase } from "../db/index.js";
import { loadReportCompanySettings } from "../reports/companySettings.js";
import { formatQty, parseQty } from "./decimal.js";
import { signedDeltaForKind } from "./post.js";

const SOFT_ROW_LIMIT = 5000;

const KIND_LABELS: Record<StockMovementKind, string> = {
  RECEIPT: "Receipt",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  SALE: "Sale",
  SALE_REVERSAL: "Sale reversal",
  ADJUSTMENT: "Adjustment",
};

interface ActorRow {
  id: string;
  role: string;
  salesPointId: number | null;
  isActive: number;
}

interface MovementRaw {
  id: string;
  occurredAt: string;
  createdAt: string;
  salesPointId: number;
  salesPointName: string;
  storageLocationId: number;
  storageLocationName: string;
  kind: StockMovementKind;
  condition: StockCondition;
  qty: string;
  sourceKind: string;
  sourceId: string;
  notes: string | null;
}

function getActor(userId: string): ActorRow {
  const row = getDatabase()
    .prepare(
      `SELECT id, role, salesPointId, isActive FROM User WHERE id = ?`,
    )
    .get(userId) as ActorRow | undefined;
  if (!row?.isActive) {
    throw new Error("Login required.");
  }
  return row;
}

function uomForBottled(isBottled: boolean, uom: string | null): string {
  if (uom?.trim()) {
    return uom.trim();
  }
  return isBottled ? "Unit" : "Kg";
}

function normalizeIsoDate(value: string, label: string): string {
  const iso = String(value ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`Invalid ${label} date.`);
  }
  return iso;
}

function resolveConditionFilter(
  value: BinCardConditionFilter | undefined,
): BinCardConditionFilter {
  if (value === "UNSELLABLE" || value === "ALL") {
    return value;
  }
  return "SELLABLE";
}

function buildFilterSql(args: {
  productId: number;
  salesPointId: number | null;
  storageLocationId: number | null;
  condition: BinCardConditionFilter;
  dateOp: "<" | "between";
  fromIso: string;
  toIso?: string;
}): { sql: string; params: Array<string | number> } {
  const clauses = ["sm.productId = ?"];
  const params: Array<string | number> = [args.productId];

  if (args.salesPointId != null) {
    clauses.push("sm.salesPointId = ?");
    params.push(args.salesPointId);
  }
  if (args.storageLocationId != null) {
    clauses.push("sm.storageLocationId = ?");
    params.push(args.storageLocationId);
  }
  if (args.condition !== "ALL") {
    clauses.push("sm.condition = ?");
    params.push(args.condition);
  }

  if (args.dateOp === "<") {
    clauses.push("substr(sm.occurredAt, 1, 10) < ?");
    params.push(args.fromIso);
  } else {
    clauses.push("substr(sm.occurredAt, 1, 10) >= ?");
    clauses.push("substr(sm.occurredAt, 1, 10) <= ?");
    params.push(args.fromIso, args.toIso ?? args.fromIso);
  }

  return { sql: clauses.join(" AND "), params };
}

function resolveDocumentMeta(
  rows: MovementRaw[],
): {
  docNoByKey: Map<string, string>;
  carryForwardByKey: Map<string, boolean>;
} {
  const db = getDatabase();
  const docNoByKey = new Map<string, string>();
  const carryForwardByKey = new Map<string, boolean>();

  for (const row of rows) {
    const key = `${row.sourceKind}:${row.sourceId}`;
    if (docNoByKey.has(key)) {
      continue;
    }
    if (row.sourceKind === "RECEIPT") {
      const receipt = db
        .prepare(`SELECT receiptNo FROM StockReceipt WHERE id = ?`)
        .get(row.sourceId) as { receiptNo: string } | undefined;
      if (receipt) docNoByKey.set(key, receipt.receiptNo);
    } else if (row.sourceKind === "TRANSFER") {
      const transfer = db
        .prepare(`SELECT transferNo FROM StockTransfer WHERE id = ?`)
        .get(row.sourceId) as { transferNo: string } | undefined;
      if (transfer) docNoByKey.set(key, transfer.transferNo);
    } else if (row.sourceKind === "SALE") {
      const sale = db
        .prepare(`SELECT invoiceNo FROM Sale WHERE id = ?`)
        .get(row.sourceId) as { invoiceNo: string } | undefined;
      if (sale) docNoByKey.set(key, sale.invoiceNo);
    } else if (row.sourceKind === "ADJUSTMENT") {
      const adjustment = db
        .prepare(
          `SELECT adjustmentNo, COALESCE(sourceKind, 'NORMAL') AS sourceKind
           FROM StockAdjustment WHERE id = ?`,
        )
        .get(row.sourceId) as
        | { adjustmentNo: string; sourceKind: string }
        | undefined;
      if (adjustment) {
        docNoByKey.set(key, adjustment.adjustmentNo);
        carryForwardByKey.set(
          key,
          adjustment.sourceKind === "CARRY_FORWARD",
        );
      }
    }
  }

  return { docNoByKey, carryForwardByKey };
}

function loadOpeningBalance(args: {
  productId: number;
  salesPointId: number | null;
  storageLocationId: number | null;
  condition: BinCardConditionFilter;
  fromIso: string;
}): number {
  const filter = buildFilterSql({
    ...args,
    dateOp: "<",
  });
  const rows = getDatabase()
    .prepare(
      `SELECT sm.kind, sm.qty
       FROM StockMovement sm
       WHERE ${filter.sql}`,
    )
    .all(...filter.params) as Array<{ kind: StockMovementKind; qty: string }>;

  let total = 0;
  for (const row of rows) {
    total += signedDeltaForKind(row.kind, row.qty);
  }
  return total;
}

function loadPeriodMovements(args: {
  productId: number;
  salesPointId: number | null;
  storageLocationId: number | null;
  condition: BinCardConditionFilter;
  fromIso: string;
  toIso: string;
}): MovementRaw[] {
  const filter = buildFilterSql({
    ...args,
    dateOp: "between",
  });
  return getDatabase()
    .prepare(
      `SELECT sm.id, sm.occurredAt, sm.createdAt, sm.salesPointId, sp.name AS salesPointName,
              sm.storageLocationId, l.locationName AS storageLocationName,
              sm.kind, sm.condition, sm.qty, sm.sourceKind, sm.sourceId, sm.notes
       FROM StockMovement sm
       JOIN SalesPoint sp ON sp.id = sm.salesPointId
       JOIN StorageLocation sl ON sl.id = sm.storageLocationId
       JOIN Location l ON l.id = sl.locationId
       WHERE ${filter.sql}
       ORDER BY sm.occurredAt ASC, sm.createdAt ASC, sm.id ASC`,
    )
    .all(...filter.params)
    .map((row) => ({
      id: String((row as { id: string }).id),
      occurredAt: String((row as { occurredAt: string }).occurredAt),
      createdAt: String((row as { createdAt: string }).createdAt),
      salesPointId: (row as { salesPointId: number }).salesPointId,
      salesPointName: String((row as { salesPointName: string }).salesPointName),
      storageLocationId: (row as { storageLocationId: number }).storageLocationId,
      storageLocationName: String(
        (row as { storageLocationName: string }).storageLocationName,
      ),
      kind: (row as { kind: StockMovementKind }).kind,
      condition: (row as { condition: StockCondition }).condition,
      qty: String((row as { qty: string }).qty),
      sourceKind: String((row as { sourceKind: string }).sourceKind),
      sourceId: String((row as { sourceId: string }).sourceId),
      notes: (row as { notes: string | null }).notes
        ? String((row as { notes: string }).notes)
        : null,
    }));
}

function buildParticulars(
  kind: StockMovementKind,
  notes: string | null,
  isCarryForward: boolean,
): string {
  const kindLabel = isCarryForward
    ? "Opening / carry-forward"
    : KIND_LABELS[kind] ?? kind;
  if (notes?.trim()) {
    return `${kindLabel} — ${notes.trim()}`;
  }
  return kindLabel;
}

export function getBinCard(userId: string, query: BinCardQuery): BinCardReport {
  const actor = getActor(userId);

  // Bin card is bottled products only.
  if (
    !canAccessRoute(actor.role, "stock-bin-card") &&
    !canAccessRoute(actor.role, "bottled-stock")
  ) {
    throw new Error("You do not have permission to view the bin card.");
  }

  const productId = Number(query.productId);
  if (!Number.isFinite(productId) || productId <= 0) {
    throw new Error("Select a product.");
  }

  const fromIso = normalizeIsoDate(query.fromIso, "from");
  const toIso = normalizeIsoDate(query.toIso, "to");
  if (fromIso > toIso) {
    throw new Error("From date must be on or before To date.");
  }

  let salesPointId =
    query.salesPointId == null ? null : Number(query.salesPointId);
  if (salesPointId != null && !Number.isFinite(salesPointId)) {
    salesPointId = null;
  }
  if (actor.salesPointId != null) {
    salesPointId = actor.salesPointId;
  }

  let storageLocationId =
    query.storageLocationId == null ? null : Number(query.storageLocationId);
  if (storageLocationId != null && !Number.isFinite(storageLocationId)) {
    storageLocationId = null;
  }

  const condition = resolveConditionFilter(query.condition);
  const db = getDatabase();

  const product = db
    .prepare(
      `SELECT p.productId, p.productName, p.uom, COALESCE(pc.isBottled, 0) AS isBottled
       FROM Product p
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE p.productId = ?`,
    )
    .get(productId) as
    | {
        productId: number;
        productName: string;
        uom: string | null;
        isBottled: number;
      }
    | undefined;
  if (!product) {
    throw new Error("Product not found.");
  }

  if (product.isBottled !== 1) {
    throw new Error(
      `"${product.productName}" is not a bottled product. Bin card is for bottled products only.`,
    );
  }

  let salesPointLabel = "All collection points";
  if (salesPointId != null) {
    const sp = db
      .prepare(`SELECT name FROM SalesPoint WHERE id = ?`)
      .get(salesPointId) as { name: string } | undefined;
    if (!sp) {
      throw new Error("Collection point not found.");
    }
    salesPointLabel = sp.name;
  }

  let storageLocationLabel = "All locations";
  if (storageLocationId != null) {
    const location = db
      .prepare(
        `SELECT l.locationName AS name, sl.salesPointId
         FROM StorageLocation sl
         JOIN Location l ON l.id = sl.locationId
         WHERE sl.id = ?`,
      )
      .get(storageLocationId) as
      | { name: string; salesPointId: number }
      | undefined;
    if (!location) {
      throw new Error("Storage location not found.");
    }
    if (salesPointId != null && location.salesPointId !== salesPointId) {
      throw new Error("Storage location does not belong to the selected collection point.");
    }
    storageLocationLabel = location.name;
  }

  let openingBalance = loadOpeningBalance({
    productId,
    salesPointId,
    storageLocationId,
    condition,
    fromIso,
  });

  const rawMovements = loadPeriodMovements({
    productId,
    salesPointId,
    storageLocationId,
    condition,
    fromIso,
    toIso,
  });
  // Resolve CF on the full period set before truncating so go-live carry-forward
  // can fold into Opening even when the soft row limit would otherwise drop it.
  const { docNoByKey, carryForwardByKey } = resolveDocumentMeta(rawMovements);

  const ledgerMovements: MovementRaw[] = [];
  for (const row of rawMovements) {
    const key = `${row.sourceKind}:${row.sourceId}`;
    if (carryForwardByKey.get(key) === true) {
      openingBalance += signedDeltaForKind(row.kind, row.qty);
      continue;
    }
    ledgerMovements.push(row);
  }

  const truncated = ledgerMovements.length > SOFT_ROW_LIMIT;
  const periodRows = truncated
    ? ledgerMovements.slice(0, SOFT_ROW_LIMIT)
    : ledgerMovements;

  let running = openingBalance;
  const lines: BinCardLine[] = periodRows.map((row) => {
    const signed = signedDeltaForKind(row.kind, row.qty);
    const qtyIn = signed > 0 ? signed : 0;
    const qtyOut = signed < 0 ? Math.abs(signed) : 0;
    running += signed;
    const key = `${row.sourceKind}:${row.sourceId}`;
    const documentNo = docNoByKey.get(key) ?? null;
    const kindLabel = KIND_LABELS[row.kind] ?? row.kind;

    return {
      id: row.id,
      occurredAtIso: row.occurredAt.slice(0, 10),
      reference: documentNo ?? kindLabel,
      particulars: buildParticulars(row.kind, row.notes, false),
      kind: row.kind,
      condition: row.condition,
      salesPointName: row.salesPointName,
      storageLocationName: row.storageLocationName,
      qtyIn: parseQty(formatQty(qtyIn)),
      qtyOut: parseQty(formatQty(qtyOut)),
      balance: parseQty(formatQty(running)),
      documentNo,
      notes: row.notes,
      isCarryForward: false,
    };
  });

  const settings = loadReportCompanySettings(userId, toIso);
  const isBottled = product.isBottled === 1;

  return {
    productId: product.productId,
    productName: product.productName,
    uom: uomForBottled(isBottled, product.uom),
    isBottled,
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
