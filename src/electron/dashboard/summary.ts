import type {
  BottleOilDashboardSummary,
  CommercialDashboardSummary,
  DashboardSummary,
  SupervisorDashboardSummary,
} from "../../shared/dashboard.types.js";
import { isStoreKeeperRole, isSupervisorOverviewRole } from "../../shared/roles.js";
import { getDatabase } from "../db/index.js";
import {
  getOpenPostingPeriodForActor,
} from "../financialYears/service.js";
import { parseAmount } from "../sales/money.js";
import { loadStockBalancesAsOf } from "../stock/asOfBalance.js";
import { listStockValidationQueue } from "../stock/validationQueue.js";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const BOTTLE_MODE_SQL = `COALESCE(s.saleProductMode, 'LOOSE') = 'BOTTLE'`;
const QTY_EPS = 0.0001;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function emptyCommercial(asAtIso: string): CommercialDashboardSummary {
  return {
    variant: "commercial",
    hasOpenPeriod: false,
    openMonth: null,
    openYear: null,
    asAtIso,
    revenueByDay: [],
    revenueByCategory: [],
    doVsSalesByMonth: [],
  };
}

function emptySupervisor(asAtIso: string): SupervisorDashboardSummary {
  return {
    variant: "supervisor",
    hasOpenPeriod: false,
    openMonth: null,
    openYear: null,
    asAtIso,
    queueTiles: [],
    revenueByDay: [],
    revenueByProduct: [],
    looseStockOnHand: [],
    bottleStockOnHand: [],
    looseSellableTotalKg: 0,
    bottleSellableTotalUnits: 0,
  };
}

function loadRevenueByProductAllModes(
  fromIso: string,
  toIso: string,
): SupervisorDashboardSummary["revenueByProduct"] {
  const rows = getDatabase()
    .prepare(
      `SELECT p.productId AS productId,
              p.productName AS label,
              COALESCE(SUM(CAST(sl.lineNet AS REAL)), 0) AS amount
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       WHERE s.status = 'VALIDATED'
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?
       GROUP BY p.productId, p.productName
       HAVING COALESCE(SUM(CAST(sl.lineNet AS REAL)), 0) > 0.0001
       ORDER BY amount DESC
       LIMIT 12`,
    )
    .all(fromIso, toIso) as Array<{
    productId: number;
    label: string;
    amount: number;
  }>;

  return rows.map((row) => ({
    productId: Number(row.productId),
    label: String(row.label),
    amount: Number.isFinite(row.amount) ? row.amount : parseAmount(String(row.amount)),
  }));
}

function loadStockOnHandByBottled(isBottled: 0 | 1): {
  rows: SupervisorDashboardSummary["looseStockOnHand"];
  sellableTotal: number;
} {
  const rows = getDatabase()
    .prepare(
      `SELECT p.productName,
              CAST(sb.qty AS REAL) AS qty,
              COALESCE(NULLIF(TRIM(p.uom), ''), ?) AS uom,
              sp.name AS salesPointName,
              COALESCE(l.locationName, '—') AS storageLocationName,
              sb.condition
       FROM StockBalance sb
       JOIN SalesPoint sp ON sp.id = sb.salesPointId
       LEFT JOIN StorageLocation sl ON sl.id = sb.storageLocationId
       LEFT JOIN Location l ON l.id = sl.locationId
       JOIN Product p ON p.productId = sb.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE COALESCE(pc.isBottled, 0) = ?
         AND CAST(sb.qty AS REAL) > 0.0001
       ORDER BY
         CASE WHEN sb.condition = 'SELLABLE' THEN 0 ELSE 1 END,
         CAST(sb.qty AS REAL) DESC,
         p.productName ASC
       LIMIT 40`,
    )
    .all(isBottled === 1 ? "Unit" : "kg", isBottled) as Array<{
    productName: string;
    qty: number;
    uom: string;
    salesPointName: string;
    storageLocationName: string;
    condition: string;
  }>;

  const mapped = rows.map((row) => ({
    productName: String(row.productName),
    qty: Number.isFinite(row.qty) ? row.qty : parseAmount(String(row.qty)),
    uom: String(row.uom || (isBottled === 1 ? "Unit" : "kg")),
    salesPointName: String(row.salesPointName),
    storageLocationName: String(row.storageLocationName),
    condition:
      row.condition === "UNSELLABLE"
        ? ("UNSELLABLE" as const)
        : ("SELLABLE" as const),
  }));

  const sellableTotal = mapped
    .filter((row) => row.condition === "SELLABLE")
    .reduce((sum, row) => sum + row.qty, 0);

  return { rows: mapped, sellableTotal };
}

function getScopedSalesPointId(userId: string): number | null {
  const row = getDatabase()
    .prepare(`SELECT salesPointId, isActive FROM User WHERE id = ?`)
    .get(userId) as { salesPointId: number | null; isActive: number } | undefined;
  if (!row?.isActive) {
    return null;
  }
  return row.salesPointId;
}

function countPendingSales(userId: string): number {
  const scoped = getScopedSalesPointId(userId);
  const scopeSql =
    scoped == null ? "" : " AND s.salesPointId = @scopedSalesPointId";
  const params = { scopedSalesPointId: scoped ?? -1 };
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count FROM Sale s WHERE s.status = 'PENDING'${scopeSql}`,
    )
    .get(params) as { count: number };
  return Number(row?.count ?? 0);
}

function countPendingConsignmentNotes(userId: string): number {
  const scoped = getScopedSalesPointId(userId);
  const scopeSql =
    scoped == null ? "" : " AND s.salesPointId = @scopedSalesPointId";
  const params = { scopedSalesPointId: scoped ?? -1 };
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM VehicleConsignmentNote n
       INNER JOIN Sale s ON s.id = n.saleId
       WHERE n.status = 'PENDING'${scopeSql}`,
    )
    .get(params) as { count: number };
  return Number(row?.count ?? 0);
}

function countPendingStockDocuments(userId: string): number {
  try {
    return listStockValidationQueue(userId).totalPending;
  } catch {
    return 0;
  }
}

function buildSupervisorQueueTiles(userId: string): SupervisorDashboardSummary["queueTiles"] {
  return [
    {
      id: "pendingSales",
      label: "Pending sales",
      count: countPendingSales(userId),
      routeId: "sales-validation",
    },
    {
      id: "pendingStock",
      label: "Pending stock",
      count: countPendingStockDocuments(userId),
      routeId: "stock-validation",
    },
    {
      id: "pendingConsignment",
      label: "Pending consignment",
      count: countPendingConsignmentNotes(userId),
      routeId: "vehicle-consignment-validation",
    },
  ];
}

function getSupervisorDashboardSummary(userId: string): SupervisorDashboardSummary {
  const asAtIso = localTodayIso();
  const period = getOpenPostingPeriodForActor(userId);
  const looseStock = loadStockOnHandByBottled(0);
  const bottleStock = loadStockOnHandByBottled(1);
  const queueTiles = buildSupervisorQueueTiles(userId);

  if (!period) {
    return {
      ...emptySupervisor(asAtIso),
      queueTiles,
      looseStockOnHand: looseStock.rows,
      bottleStockOnHand: bottleStock.rows,
      looseSellableTotalKg: looseStock.sellableTotal,
      bottleSellableTotalUnits: bottleStock.sellableTotal,
    };
  }

  const monthEnd = minIso(period.endDate, asAtIso);

  return {
    variant: "supervisor",
    hasOpenPeriod: true,
    openMonth: {
      year: period.financialYear,
      month: period.calendarMonth,
      startDate: period.startDate,
      endDate: monthEnd,
      label: `${period.monthName} ${period.financialYear}`,
    },
    openYear: period.financialYear,
    asAtIso,
    queueTiles,
    revenueByDay: loadRevenueByDay(period.startDate, monthEnd, false),
    revenueByProduct: loadRevenueByProductAllModes(period.startDate, monthEnd),
    looseStockOnHand: looseStock.rows,
    bottleStockOnHand: bottleStock.rows,
    looseSellableTotalKg: looseStock.sellableTotal,
    bottleSellableTotalUnits: bottleStock.sellableTotal,
  };
}

function emptyBottleOil(asAtIso: string): BottleOilDashboardSummary {
  return {
    variant: "bottleOil",
    hasOpenPeriod: false,
    openMonth: null,
    openYear: null,
    asAtIso,
    revenueByDay: [],
    revenueByProduct: [],
    salesQtyByMonth: [],
    invoiceCounts: {
      pending: 0,
      validatedOpenMonth: 0,
      rejectedOpenMonth: 0,
    },
    stockOnHand: [],
    sellableUnitsTotal: 0,
    pendingReceives: 0,
  };
}

function countPendingReceives(userId: string): number {
  const scoped = getScopedSalesPointId(userId);
  if (scoped == null) {
    return 0;
  }
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM StockTransfer
       WHERE status = 'DISPATCHED'
         AND toSalesPointId = ?`,
    )
    .get(scoped) as { count: number };
  return Number(row?.count ?? 0);
}

function loadRevenueByDay(
  fromIso: string,
  toIso: string,
  bottleOnly: boolean,
): CommercialDashboardSummary["revenueByDay"] {
  const modeClause = bottleOnly ? `AND ${BOTTLE_MODE_SQL}` : "";
  const rows = getDatabase()
    .prepare(
      `SELECT substr(s.dateIssued, 1, 10) AS dateIso,
              COALESCE(SUM(CAST(s.grossAmount AS REAL)), 0) AS amount
       FROM Sale s
       WHERE s.status = 'VALIDATED'
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?
         ${modeClause}
       GROUP BY substr(s.dateIssued, 1, 10)
       ORDER BY dateIso ASC`,
    )
    .all(fromIso, toIso) as Array<{ dateIso: string; amount: number }>;

  return rows.map((row) => ({
    dateIso: row.dateIso,
    amount: Number.isFinite(row.amount) ? row.amount : parseAmount(String(row.amount)),
  }));
}

function loadRevenueByCategory(
  fromIso: string,
  toIso: string,
): CommercialDashboardSummary["revenueByCategory"] {
  const rows = getDatabase()
    .prepare(
      `SELECT p.productCatId AS categoryId,
              COALESCE(pc.productCat, 'Uncategorized') AS label,
              COALESCE(SUM(CAST(sl.lineNet AS REAL)), 0) AS amount
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE s.status = 'VALIDATED'
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?
       GROUP BY p.productCatId, COALESCE(pc.productCat, 'Uncategorized')
       HAVING COALESCE(SUM(CAST(sl.lineNet AS REAL)), 0) > 0.0001
       ORDER BY amount DESC`,
    )
    .all(fromIso, toIso) as Array<{
    categoryId: number | null;
    label: string;
    amount: number;
  }>;

  return rows.map((row) => ({
    categoryId: row.categoryId == null ? null : Number(row.categoryId),
    label: String(row.label),
    amount: Number.isFinite(row.amount) ? row.amount : parseAmount(String(row.amount)),
  }));
}

function loadRevenueByProduct(
  fromIso: string,
  toIso: string,
): BottleOilDashboardSummary["revenueByProduct"] {
  const rows = getDatabase()
    .prepare(
      `SELECT p.productId AS productId,
              p.productName AS label,
              COALESCE(SUM(CAST(sl.lineNet AS REAL)), 0) AS amount
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       WHERE s.status = 'VALIDATED'
         AND ${BOTTLE_MODE_SQL}
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?
       GROUP BY p.productId, p.productName
       HAVING COALESCE(SUM(CAST(sl.lineNet AS REAL)), 0) > 0.0001
       ORDER BY amount DESC
       LIMIT 12`,
    )
    .all(fromIso, toIso) as Array<{
    productId: number;
    label: string;
    amount: number;
  }>;

  return rows.map((row) => ({
    productId: Number(row.productId),
    label: String(row.label),
    amount: Number.isFinite(row.amount) ? row.amount : parseAmount(String(row.amount)),
  }));
}

function loadDoQtyByMonth(
  year: number,
  fromIso: string,
  toIso: string,
): Map<number, number> {
  const rows = getDatabase()
    .prepare(
      `SELECT CAST(strftime('%m', substr(d.dateIssued, 1, 10)) AS INTEGER) AS month,
              COALESCE(SUM(CAST(dd.orderQty AS REAL)), 0) AS qty
       FROM DeliveryOrder d
       INNER JOIN DeliveryOrderDetails dd ON dd.deliveryOrderId = d.id
       WHERE d.status = 'VALIDATED'
         AND substr(d.dateIssued, 1, 10) >= ?
         AND substr(d.dateIssued, 1, 10) <= ?
       GROUP BY month`,
    )
    .all(fromIso, toIso) as Array<{ month: number; qty: number }>;

  const map = new Map<number, number>();
  for (const row of rows) {
    if (row.month >= 1 && row.month <= 12) {
      map.set(row.month, Number.isFinite(row.qty) ? row.qty : 0);
    }
  }
  void year;
  return map;
}

function loadSalesQtyByMonth(fromIso: string, toIso: string): Map<number, number> {
  const rows = getDatabase()
    .prepare(
      `SELECT CAST(strftime('%m', substr(s.dateIssued, 1, 10)) AS INTEGER) AS month,
              COALESCE(SUM(CAST(sl.qtyKg AS REAL)), 0) AS qty
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       WHERE s.status = 'VALIDATED'
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?
       GROUP BY month`,
    )
    .all(fromIso, toIso) as Array<{ month: number; qty: number }>;

  const map = new Map<number, number>();
  for (const row of rows) {
    if (row.month >= 1 && row.month <= 12) {
      map.set(row.month, Number.isFinite(row.qty) ? row.qty : 0);
    }
  }
  return map;
}

function loadBottleSalesQtyByMonth(
  fromIso: string,
  toIso: string,
): Map<number, number> {
  const rows = getDatabase()
    .prepare(
      `SELECT CAST(strftime('%m', substr(s.dateIssued, 1, 10)) AS INTEGER) AS month,
              COALESCE(SUM(CAST(COALESCE(sl.qtyUnits, sl.qtyKg) AS REAL)), 0) AS qty
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       WHERE s.status = 'VALIDATED'
         AND ${BOTTLE_MODE_SQL}
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?
       GROUP BY month`,
    )
    .all(fromIso, toIso) as Array<{ month: number; qty: number }>;

  const map = new Map<number, number>();
  for (const row of rows) {
    if (row.month >= 1 && row.month <= 12) {
      map.set(row.month, Number.isFinite(row.qty) ? row.qty : 0);
    }
  }
  return map;
}

function loadBottleInvoiceCounts(
  fromIso: string,
  toIso: string,
): BottleOilDashboardSummary["invoiceCounts"] {
  const db = getDatabase();
  const pendingRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM Sale s
       WHERE s.status = 'PENDING' AND ${BOTTLE_MODE_SQL}`,
    )
    .get() as { n: number };

  const validatedRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM Sale s
       WHERE s.status = 'VALIDATED'
         AND ${BOTTLE_MODE_SQL}
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?`,
    )
    .get(fromIso, toIso) as { n: number };

  const rejectedRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM Sale s
       WHERE s.status = 'REJECTED'
         AND ${BOTTLE_MODE_SQL}
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?`,
    )
    .get(fromIso, toIso) as { n: number };

  return {
    pending: Number(pendingRow?.n ?? 0),
    validatedOpenMonth: Number(validatedRow?.n ?? 0),
    rejectedOpenMonth: Number(rejectedRow?.n ?? 0),
  };
}

function loadBottledStockOnHand(asAtIso: string): {
  rows: BottleOilDashboardSummary["stockOnHand"];
  sellableUnitsTotal: number;
} {
  const db = getDatabase();
  const asOfRows = loadStockBalancesAsOf(db, asAtIso).filter(
    (row) => row.qty > QTY_EPS,
  );

  if (asOfRows.length === 0) {
    return { rows: [], sellableUnitsTotal: 0 };
  }

  const bottledProducts = db
    .prepare(
      `SELECT p.productId,
              p.productName,
              COALESCE(NULLIF(TRIM(p.uom), ''), 'Unit') AS uom
       FROM Product p
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE COALESCE(pc.isBottled, 0) = 1`,
    )
    .all() as Array<{ productId: number; productName: string; uom: string }>;

  const bottledById = new Map(
    bottledProducts.map((product) => [product.productId, product]),
  );

  const bottledBalances = asOfRows.filter((row) =>
    bottledById.has(row.productId),
  );

  const sellableUnitsTotal = bottledBalances
    .filter((row) => row.condition === "SELLABLE")
    .reduce((sum, row) => sum + row.qty, 0);

  if (bottledBalances.length === 0) {
    return { rows: [], sellableUnitsTotal: 0 };
  }

  const salesPoints = new Map(
    (
      db.prepare(`SELECT id, name FROM SalesPoint`).all() as Array<{
        id: number;
        name: string;
      }>
    ).map((row) => [row.id, row.name]),
  );

  const locations = new Map(
    (
      db
        .prepare(
          `SELECT sl.id, COALESCE(l.locationName, '—') AS name
           FROM StorageLocation sl
           LEFT JOIN Location l ON l.id = sl.locationId`,
        )
        .all() as Array<{ id: number; name: string }>
    ).map((row) => [row.id, row.name]),
  );

  const mapped = bottledBalances
    .map((row) => {
      const product = bottledById.get(row.productId)!;
      return {
        productName: String(product.productName),
        qty: row.qty,
        uom: String(product.uom || "Unit"),
        salesPointName: salesPoints.get(row.salesPointId) ?? "—",
        storageLocationName:
          row.storageLocationId == null
            ? "—"
            : (locations.get(row.storageLocationId) ?? "—"),
        condition:
          row.condition === "UNSELLABLE"
            ? ("UNSELLABLE" as const)
            : ("SELLABLE" as const),
      };
    })
    .sort((a, b) => {
      const conditionRank =
        (a.condition === "SELLABLE" ? 0 : 1) - (b.condition === "SELLABLE" ? 0 : 1);
      if (conditionRank !== 0) {
        return conditionRank;
      }
      if (b.qty !== a.qty) {
        return b.qty - a.qty;
      }
      return a.productName.localeCompare(b.productName);
    })
    .slice(0, 40);

  return { rows: mapped, sellableUnitsTotal };
}

function getCommercialDashboardSummary(userId: string): CommercialDashboardSummary {
  const asAtIso = localTodayIso();
  const period = getOpenPostingPeriodForActor(userId);

  if (!period) {
    return emptyCommercial(asAtIso);
  }

  const monthEnd = minIso(period.endDate, asAtIso);
  const yearStart = `${period.financialYear}-01-01`;
  const yearEnd = minIso(`${period.financialYear}-12-31`, asAtIso);
  const lastMonth =
    asAtIso.slice(0, 4) === String(period.financialYear)
      ? Number.parseInt(asAtIso.slice(5, 7), 10)
      : period.calendarMonth;

  const doByMonth = loadDoQtyByMonth(period.financialYear, yearStart, yearEnd);
  const salesByMonth = loadSalesQtyByMonth(yearStart, yearEnd);
  const doVsSalesByMonth: CommercialDashboardSummary["doVsSalesByMonth"] = [];
  for (let month = 1; month <= lastMonth; month += 1) {
    doVsSalesByMonth.push({
      month,
      label: MONTH_LABELS[month - 1] ?? String(month),
      doQtyKg: doByMonth.get(month) ?? 0,
      salesQtyKg: salesByMonth.get(month) ?? 0,
    });
  }

  return {
    variant: "commercial",
    hasOpenPeriod: true,
    openMonth: {
      year: period.financialYear,
      month: period.calendarMonth,
      startDate: period.startDate,
      endDate: monthEnd,
      label: `${period.monthName} ${period.financialYear}`,
    },
    openYear: period.financialYear,
    asAtIso,
    revenueByDay: loadRevenueByDay(period.startDate, monthEnd, false),
    revenueByCategory: loadRevenueByCategory(period.startDate, monthEnd),
    doVsSalesByMonth,
  };
}

function getBottleOilDashboardSummary(userId: string): BottleOilDashboardSummary {
  const todayIso = localTodayIso();
  const period = getOpenPostingPeriodForActor(userId);
  const asAtIso = period ? minIso(period.endDate, todayIso) : todayIso;
  const stock = loadBottledStockOnHand(asAtIso);
  const pendingReceives = countPendingReceives(userId);

  if (!period) {
    return {
      ...emptyBottleOil(asAtIso),
      stockOnHand: stock.rows,
      sellableUnitsTotal: stock.sellableUnitsTotal,
      invoiceCounts: loadBottleInvoiceCounts("1900-01-01", asAtIso),
      pendingReceives,
    };
  }

  const monthEnd = asAtIso;
  const yearStart = `${period.financialYear}-01-01`;
  const yearEnd = minIso(`${period.financialYear}-12-31`, asAtIso);
  const lastMonth =
    asAtIso.slice(0, 4) === String(period.financialYear)
      ? Number.parseInt(asAtIso.slice(5, 7), 10)
      : period.calendarMonth;

  const qtyByMonth = loadBottleSalesQtyByMonth(yearStart, yearEnd);
  const salesQtyByMonth: BottleOilDashboardSummary["salesQtyByMonth"] = [];
  for (let month = 1; month <= lastMonth; month += 1) {
    salesQtyByMonth.push({
      month,
      label: MONTH_LABELS[month - 1] ?? String(month),
      qtyUnits: qtyByMonth.get(month) ?? 0,
    });
  }

  return {
    variant: "bottleOil",
    hasOpenPeriod: true,
    openMonth: {
      year: period.financialYear,
      month: period.calendarMonth,
      startDate: period.startDate,
      endDate: monthEnd,
      label: `${period.monthName} ${period.financialYear}`,
    },
    openYear: period.financialYear,
    asAtIso,
    revenueByDay: loadRevenueByDay(period.startDate, monthEnd, true),
    revenueByProduct: loadRevenueByProduct(period.startDate, monthEnd),
    salesQtyByMonth,
    invoiceCounts: loadBottleInvoiceCounts(period.startDate, monthEnd),
    stockOnHand: stock.rows,
    sellableUnitsTotal: stock.sellableUnitsTotal,
    pendingReceives,
  };
}

export function getDashboardSummary(
  role?: string | null,
  userId?: string | null,
): DashboardSummary {
  if (role && isStoreKeeperRole(role)) {
    if (!userId) {
      return emptyBottleOil(localTodayIso());
    }
    return getBottleOilDashboardSummary(userId);
  }
  if (role && isSupervisorOverviewRole(role) && userId) {
    return getSupervisorDashboardSummary(userId);
  }
  if (!userId) {
    return emptyCommercial(localTodayIso());
  }
  return getCommercialDashboardSummary(userId);
}
