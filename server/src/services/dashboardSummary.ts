import { prisma } from "../db/prisma.js";
import { getOpenPostingPeriodForActor } from "./financialYearsService.js";
import { loadRpcActor } from "./rpcActor.js";

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

const STORE_KEEPER_ROLE_ID = "STORE_KEEPER";
const JNR_SALES_SUP_ROLE_ID = "JNR_SALES_SUP";
const SENIOR_SALES_SUPERVISOR_ROLE_ID = "SENIOR_SALES_SUPERVISOR";
const QTY_EPS = 0.0001;

type DayRevenue = { dateIso: string; amount: number };
type CategoryRevenue = { categoryId: number | null; label: string; amount: number };
type ProductRevenue = { productId: number; label: string; amount: number };
type DoVsSalesMonth = {
  month: number;
  label: string;
  doQtyKg: number;
  salesQtyKg: number;
};
type SalesQtyMonth = { month: number; label: string; qtyUnits: number };
type OpenMonth = {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  label: string;
};
type StockOnHandRow = {
  productName: string;
  qty: number;
  uom: string;
  salesPointName: string;
  storageLocationName: string;
  condition: "SELLABLE" | "UNSELLABLE";
};
type QueueTile = {
  id: "pendingSales" | "pendingStock" | "pendingConsignment";
  label: string;
  count: number;
  routeId: string;
};

type CommercialDashboardSummary = {
  variant: "commercial";
  hasOpenPeriod: boolean;
  openMonth: OpenMonth | null;
  openYear: number | null;
  asAtIso: string;
  revenueByDay: DayRevenue[];
  revenueByCategory: CategoryRevenue[];
  doVsSalesByMonth: DoVsSalesMonth[];
};

type BottleOilDashboardSummary = {
  variant: "bottleOil";
  hasOpenPeriod: boolean;
  openMonth: OpenMonth | null;
  openYear: number | null;
  asAtIso: string;
  revenueByDay: DayRevenue[];
  revenueByProduct: ProductRevenue[];
  salesQtyByMonth: SalesQtyMonth[];
  invoiceCounts: {
    pending: number;
    validatedOpenMonth: number;
    rejectedOpenMonth: number;
  };
  stockOnHand: StockOnHandRow[];
  sellableUnitsTotal: number;
  pendingReceives: number;
};

type SupervisorDashboardSummary = {
  variant: "supervisor";
  hasOpenPeriod: boolean;
  openMonth: OpenMonth | null;
  openYear: number | null;
  asAtIso: string;
  queueTiles: QueueTile[];
  revenueByDay: DayRevenue[];
  revenueByProduct: ProductRevenue[];
  looseStockOnHand: StockOnHandRow[];
  bottleStockOnHand: StockOnHandRow[];
  looseSellableTotalKg: number;
  bottleSellableTotalUnits: number;
};

export type DashboardSummary =
  | CommercialDashboardSummary
  | BottleOilDashboardSummary
  | SupervisorDashboardSummary;

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

function isStoreKeeperRole(role: string): boolean {
  return role === STORE_KEEPER_ROLE_ID;
}

function isSupervisorOverviewRole(role: string): boolean {
  return (
    role === SENIOR_SALES_SUPERVISOR_ROLE_ID || role === JNR_SALES_SUP_ROLE_ID
  );
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
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

async function loadRevenueByDay(
  fromIso: string,
  toIso: string,
  bottleOnly: boolean,
): Promise<DayRevenue[]> {
  const rows = bottleOnly
    ? await prisma.$queryRaw<Array<{ date_iso: string; amount: unknown }>>`
        SELECT LEFT(s.date_issued, 10) AS date_iso,
               COALESCE(SUM(REPLACE(s.gross_amount, ',', '.')::numeric), 0) AS amount
        FROM sales s
        WHERE s.status = 'VALIDATED'
          AND LEFT(s.date_issued, 10) >= ${fromIso}
          AND LEFT(s.date_issued, 10) <= ${toIso}
          AND COALESCE(s.sale_product_mode, 'LOOSE') = 'BOTTLE'
        GROUP BY LEFT(s.date_issued, 10)
        ORDER BY date_iso ASC
      `
    : await prisma.$queryRaw<Array<{ date_iso: string; amount: unknown }>>`
        SELECT LEFT(s.date_issued, 10) AS date_iso,
               COALESCE(SUM(REPLACE(s.gross_amount, ',', '.')::numeric), 0) AS amount
        FROM sales s
        WHERE s.status = 'VALIDATED'
          AND LEFT(s.date_issued, 10) >= ${fromIso}
          AND LEFT(s.date_issued, 10) <= ${toIso}
        GROUP BY LEFT(s.date_issued, 10)
        ORDER BY date_iso ASC
      `;

  return rows.map((row) => ({
    dateIso: String(row.date_iso),
    amount: num(row.amount),
  }));
}

async function loadRevenueByCategory(
  fromIso: string,
  toIso: string,
): Promise<CategoryRevenue[]> {
  const rows = await prisma.$queryRaw<
    Array<{ category_id: number | null; label: string; amount: unknown }>
  >`
    SELECT p.product_cat_id AS category_id,
           COALESCE(pc.product_cat, 'Uncategorized') AS label,
           COALESCE(SUM(REPLACE(sl.line_net, ',', '.')::numeric), 0) AS amount
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    WHERE s.status = 'VALIDATED'
      AND LEFT(s.date_issued, 10) >= ${fromIso}
      AND LEFT(s.date_issued, 10) <= ${toIso}
    GROUP BY p.product_cat_id, COALESCE(pc.product_cat, 'Uncategorized')
    HAVING COALESCE(SUM(REPLACE(sl.line_net, ',', '.')::numeric), 0) > 0.0001
    ORDER BY amount DESC
  `;

  return rows.map((row) => ({
    categoryId: row.category_id == null ? null : Number(row.category_id),
    label: String(row.label),
    amount: num(row.amount),
  }));
}

async function loadRevenueByProduct(
  fromIso: string,
  toIso: string,
  bottleOnly: boolean,
): Promise<ProductRevenue[]> {
  const rows = bottleOnly
    ? await prisma.$queryRaw<
        Array<{ product_id: number; label: string; amount: unknown }>
      >`
        SELECT p.product_id AS product_id,
               p.product_name AS label,
               COALESCE(SUM(REPLACE(sl.line_net, ',', '.')::numeric), 0) AS amount
        FROM sales s
        INNER JOIN sale_lines sl ON sl.sale_id = s.id
        INNER JOIN products p ON p.product_id = sl.product_id
        WHERE s.status = 'VALIDATED'
          AND COALESCE(s.sale_product_mode, 'LOOSE') = 'BOTTLE'
          AND LEFT(s.date_issued, 10) >= ${fromIso}
          AND LEFT(s.date_issued, 10) <= ${toIso}
        GROUP BY p.product_id, p.product_name
        HAVING COALESCE(SUM(REPLACE(sl.line_net, ',', '.')::numeric), 0) > 0.0001
        ORDER BY amount DESC
        LIMIT 12
      `
    : await prisma.$queryRaw<
        Array<{ product_id: number; label: string; amount: unknown }>
      >`
        SELECT p.product_id AS product_id,
               p.product_name AS label,
               COALESCE(SUM(REPLACE(sl.line_net, ',', '.')::numeric), 0) AS amount
        FROM sales s
        INNER JOIN sale_lines sl ON sl.sale_id = s.id
        INNER JOIN products p ON p.product_id = sl.product_id
        WHERE s.status = 'VALIDATED'
          AND LEFT(s.date_issued, 10) >= ${fromIso}
          AND LEFT(s.date_issued, 10) <= ${toIso}
        GROUP BY p.product_id, p.product_name
        HAVING COALESCE(SUM(REPLACE(sl.line_net, ',', '.')::numeric), 0) > 0.0001
        ORDER BY amount DESC
        LIMIT 12
      `;

  return rows.map((row) => ({
    productId: Number(row.product_id),
    label: String(row.label),
    amount: num(row.amount),
  }));
}

async function loadQtyByMonthMap(
  fromIso: string,
  toIso: string,
  source: "do" | "sales" | "bottleSales",
): Promise<Map<number, number>> {
  const rows =
    source === "do"
      ? await prisma.$queryRaw<Array<{ month: number; qty: unknown }>>`
          SELECT CAST(SUBSTRING(LEFT(d.date_issued, 10), 6, 2) AS INTEGER) AS month,
                 COALESCE(SUM(dd.order_qty::numeric), 0) AS qty
          FROM delivery_orders d
          INNER JOIN delivery_order_details dd ON dd.delivery_order_id = d.id
          WHERE d.status = 'VALIDATED'
            AND LEFT(d.date_issued, 10) >= ${fromIso}
            AND LEFT(d.date_issued, 10) <= ${toIso}
          GROUP BY month
        `
      : source === "sales"
        ? await prisma.$queryRaw<Array<{ month: number; qty: unknown }>>`
            SELECT CAST(SUBSTRING(LEFT(s.date_issued, 10), 6, 2) AS INTEGER) AS month,
                   COALESCE(SUM(REPLACE(sl.qty_kg, ',', '.')::numeric), 0) AS qty
            FROM sales s
            INNER JOIN sale_lines sl ON sl.sale_id = s.id
            WHERE s.status = 'VALIDATED'
              AND LEFT(s.date_issued, 10) >= ${fromIso}
              AND LEFT(s.date_issued, 10) <= ${toIso}
            GROUP BY month
          `
        : await prisma.$queryRaw<Array<{ month: number; qty: unknown }>>`
            SELECT CAST(SUBSTRING(LEFT(s.date_issued, 10), 6, 2) AS INTEGER) AS month,
                   COALESCE(
                     SUM(
                       REPLACE(COALESCE(sl.qty_units, sl.qty_kg), ',', '.')::numeric
                     ),
                     0
                   ) AS qty
            FROM sales s
            INNER JOIN sale_lines sl ON sl.sale_id = s.id
            WHERE s.status = 'VALIDATED'
              AND COALESCE(s.sale_product_mode, 'LOOSE') = 'BOTTLE'
              AND LEFT(s.date_issued, 10) >= ${fromIso}
              AND LEFT(s.date_issued, 10) <= ${toIso}
            GROUP BY month
          `;

  const map = new Map<number, number>();
  for (const row of rows) {
    const month = Number(row.month);
    if (month >= 1 && month <= 12) {
      map.set(month, num(row.qty));
    }
  }
  return map;
}

async function loadBottleInvoiceCounts(
  fromIso: string,
  toIso: string,
): Promise<BottleOilDashboardSummary["invoiceCounts"]> {
  const [pendingRow, validatedRow, rejectedRow] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM sales s
      WHERE s.status = 'PENDING'
        AND COALESCE(s.sale_product_mode, 'LOOSE') = 'BOTTLE'
    `,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM sales s
      WHERE s.status = 'VALIDATED'
        AND COALESCE(s.sale_product_mode, 'LOOSE') = 'BOTTLE'
        AND LEFT(s.date_issued, 10) >= ${fromIso}
        AND LEFT(s.date_issued, 10) <= ${toIso}
    `,
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM sales s
      WHERE s.status = 'REJECTED'
        AND COALESCE(s.sale_product_mode, 'LOOSE') = 'BOTTLE'
        AND LEFT(s.date_issued, 10) >= ${fromIso}
        AND LEFT(s.date_issued, 10) <= ${toIso}
    `,
  ]);

  return {
    pending: num(pendingRow[0]?.n),
    validatedOpenMonth: num(validatedRow[0]?.n),
    rejectedOpenMonth: num(rejectedRow[0]?.n),
  };
}

async function loadStockOnHandByBottled(
  isBottled: boolean,
  asAtIso: string,
): Promise<{ rows: StockOnHandRow[]; sellableTotal: number }> {
  const defaultUom = isBottled ? "Unit" : "kg";
  const rows = await prisma.$queryRaw<
    Array<{
      product_name: string;
      qty: unknown;
      uom: string | null;
      sales_point_name: string;
      storage_location_name: string;
      condition: string;
    }>
  >`
    SELECT
      p.product_name,
      MAX(NULLIF(TRIM(p.uom), '')) AS uom,
      sp.name AS sales_point_name,
      COALESCE(MAX(l.location_name), '—') AS storage_location_name,
      sm.condition,
      SUM(
        CASE sm.kind
          WHEN 'RECEIPT' THEN ABS(REPLACE(sm.qty, ',', '.')::numeric)
          WHEN 'TRANSFER_IN' THEN ABS(REPLACE(sm.qty, ',', '.')::numeric)
          WHEN 'SALE_REVERSAL' THEN ABS(REPLACE(sm.qty, ',', '.')::numeric)
          WHEN 'TRANSFER_OUT' THEN -ABS(REPLACE(sm.qty, ',', '.')::numeric)
          WHEN 'SALE' THEN -ABS(REPLACE(sm.qty, ',', '.')::numeric)
          WHEN 'ADJUSTMENT' THEN REPLACE(sm.qty, ',', '.')::numeric
          ELSE REPLACE(sm.qty, ',', '.')::numeric
        END
      ) AS qty
    FROM stock_movements sm
    INNER JOIN products p ON p.product_id = sm.product_id
    INNER JOIN sales_points sp ON sp.id = sm.sales_point_id
    LEFT JOIN storage_locations sl ON sl.id = sm.storage_location_id
    LEFT JOIN locations l ON l.id = sl.location_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    WHERE COALESCE(pc.is_bottled, false) = ${isBottled}
      AND sm.occurred_at < (${asAtIso}::date + INTERVAL '1 day')
    GROUP BY
      p.product_id,
      p.product_name,
      sp.id,
      sp.name,
      sm.storage_location_id,
      sm.condition
    HAVING SUM(
      CASE sm.kind
        WHEN 'RECEIPT' THEN ABS(REPLACE(sm.qty, ',', '.')::numeric)
        WHEN 'TRANSFER_IN' THEN ABS(REPLACE(sm.qty, ',', '.')::numeric)
        WHEN 'SALE_REVERSAL' THEN ABS(REPLACE(sm.qty, ',', '.')::numeric)
        WHEN 'TRANSFER_OUT' THEN -ABS(REPLACE(sm.qty, ',', '.')::numeric)
        WHEN 'SALE' THEN -ABS(REPLACE(sm.qty, ',', '.')::numeric)
        WHEN 'ADJUSTMENT' THEN REPLACE(sm.qty, ',', '.')::numeric
        ELSE REPLACE(sm.qty, ',', '.')::numeric
      END
    ) > ${QTY_EPS}
    ORDER BY
      CASE WHEN sm.condition = 'SELLABLE' THEN 0 ELSE 1 END,
      qty DESC,
      p.product_name ASC
    LIMIT 40
  `;

  const mapped: StockOnHandRow[] = rows.map((row) => ({
    productName: String(row.product_name),
    qty: num(row.qty),
    uom: String(row.uom || defaultUom),
    salesPointName: String(row.sales_point_name),
    storageLocationName: String(row.storage_location_name),
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

async function countPendingSales(salesPointId: number | null): Promise<number> {
  return prisma.sales.count({
    where: {
      status: "PENDING",
      ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
    },
  });
}

async function countPendingConsignmentNotes(
  salesPointId: number | null,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM vehicle_consignment_notes n
    INNER JOIN sales s ON s.id = n.sale_id
    WHERE n.status = 'PENDING'
      AND (${salesPointId}::int IS NULL OR s.sales_point_id = ${salesPointId})
  `;
  return num(rows[0]?.n);
}

async function countPendingStockDocuments(
  salesPointId: number | null,
): Promise<number> {
  const [receipts, transfers, adjustments] = await Promise.all([
    prisma.stock_receipts.count({
      where: {
        status: "DRAFT",
        ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
      },
    }),
    prisma.stock_transfers.count({
      where: {
        status: "DRAFT",
        ...(salesPointId != null ? { from_sales_point_id: salesPointId } : {}),
      },
    }),
    prisma.stock_adjustments.count({
      where: {
        status: "DRAFT",
        ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
      },
    }),
  ]);
  return receipts + transfers + adjustments;
}

async function countPendingReceives(salesPointId: number | null): Promise<number> {
  if (salesPointId == null) return 0;
  return prisma.stock_transfers.count({
    where: {
      status: "DISPATCHED",
      to_sales_point_id: salesPointId,
    },
  });
}

async function buildSupervisorQueueTiles(
  salesPointId: number | null,
): Promise<QueueTile[]> {
  const [pendingSales, pendingStock, pendingConsignment] = await Promise.all([
    countPendingSales(salesPointId),
    countPendingStockDocuments(salesPointId),
    countPendingConsignmentNotes(salesPointId),
  ]);
  return [
    {
      id: "pendingSales",
      label: "Pending sales",
      count: pendingSales,
      routeId: "sales-validation",
    },
    {
      id: "pendingStock",
      label: "Pending stock",
      count: pendingStock,
      routeId: "stock-validation",
    },
    {
      id: "pendingConsignment",
      label: "Pending consignment",
      count: pendingConsignment,
      routeId: "vehicle-consignment-validation",
    },
  ];
}

async function getCommercialDashboardSummary(
  userId: string,
): Promise<CommercialDashboardSummary> {
  const asAtIso = localTodayIso();
  const period = await getOpenPostingPeriodForActor(userId);
  if (!period) return emptyCommercial(asAtIso);

  const monthEnd = minIso(period.endDate, asAtIso);
  const yearStart = `${period.financialYear}-01-01`;
  const yearEnd = minIso(`${period.financialYear}-12-31`, asAtIso);
  const lastMonth =
    asAtIso.slice(0, 4) === String(period.financialYear)
      ? Number.parseInt(asAtIso.slice(5, 7), 10)
      : period.calendarMonth;

  const [revenueByDay, revenueByCategory, doByMonth, salesByMonth] =
    await Promise.all([
      loadRevenueByDay(period.startDate, monthEnd, false),
      loadRevenueByCategory(period.startDate, monthEnd),
      loadQtyByMonthMap(yearStart, yearEnd, "do"),
      loadQtyByMonthMap(yearStart, yearEnd, "sales"),
    ]);

  const doVsSalesByMonth: DoVsSalesMonth[] = [];
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
    revenueByDay,
    revenueByCategory,
    doVsSalesByMonth,
  };
}

async function getBottleOilDashboardSummary(
  userId: string,
  salesPointId: number | null,
): Promise<BottleOilDashboardSummary> {
  const todayIso = localTodayIso();
  const period = await getOpenPostingPeriodForActor(userId);
  const asAtIso = period ? minIso(period.endDate, todayIso) : todayIso;
  const [stock, pendingReceives] = await Promise.all([
    loadStockOnHandByBottled(true, asAtIso),
    countPendingReceives(salesPointId),
  ]);

  if (!period) {
    return {
      ...emptyBottleOil(asAtIso),
      stockOnHand: stock.rows,
      sellableUnitsTotal: stock.sellableTotal,
      invoiceCounts: await loadBottleInvoiceCounts("1900-01-01", asAtIso),
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

  const [revenueByDay, revenueByProduct, qtyByMonth, invoiceCounts] =
    await Promise.all([
      loadRevenueByDay(period.startDate, monthEnd, true),
      loadRevenueByProduct(period.startDate, monthEnd, true),
      loadQtyByMonthMap(yearStart, yearEnd, "bottleSales"),
      loadBottleInvoiceCounts(period.startDate, monthEnd),
    ]);

  const salesQtyByMonth: SalesQtyMonth[] = [];
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
    revenueByDay,
    revenueByProduct,
    salesQtyByMonth,
    invoiceCounts,
    stockOnHand: stock.rows,
    sellableUnitsTotal: stock.sellableTotal,
    pendingReceives,
  };
}

async function getSupervisorDashboardSummary(
  userId: string,
  salesPointId: number | null,
): Promise<SupervisorDashboardSummary> {
  const asAtIso = localTodayIso();
  const period = await getOpenPostingPeriodForActor(userId);
  const [looseStock, bottleStock, queueTiles] = await Promise.all([
    loadStockOnHandByBottled(false, asAtIso),
    loadStockOnHandByBottled(true, asAtIso),
    buildSupervisorQueueTiles(salesPointId),
  ]);

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
  const [revenueByDay, revenueByProduct] = await Promise.all([
    loadRevenueByDay(period.startDate, monthEnd, false),
    loadRevenueByProduct(period.startDate, monthEnd, false),
  ]);

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
    revenueByDay,
    revenueByProduct,
    looseStockOnHand: looseStock.rows,
    bottleStockOnHand: bottleStock.rows,
    looseSellableTotalKg: looseStock.sellableTotal,
    bottleSellableTotalUnits: bottleStock.sellableTotal,
  };
}

export async function getDashboardSummary(
  userId: string,
): Promise<DashboardSummary> {
  const actor = await loadRpcActor(userId);
  if (isStoreKeeperRole(actor.role)) {
    return getBottleOilDashboardSummary(userId, actor.salesPointId);
  }
  if (isSupervisorOverviewRole(actor.role)) {
    return getSupervisorDashboardSummary(userId, actor.salesPointId);
  }
  return getCommercialDashboardSummary(userId);
}
