/**
 * Ports src/electron/reports/weeklyDeliveriesReport.ts
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
} from "../reportCompany.js";
import {
  detectBottledPack,
  isLooseLpoReportProduct,
  loadProducts,
  loadSalesPointsForUser,
  PALM_OIL_KG_PER_LITRE,
  parseQty,
  reportScopedSalesPointId,
  sum,
  type ProductRow,
  type SalesPointRow,
} from "./reportShared.js";
import {
  buildWeekChoices,
  formatWeekLabel,
  maxIso,
  minIso,
  mondayOf,
  parseLocalIso,
  resolveSelectedWeek,
  toIsoDate,
} from "./weekChoices.js";
import { resolveOpenPeriodReportContext } from "./openPeriodReportContext.js";

const LOOSE_CATEGORY_ROWS = [
  { id: "industries", label: "INDUSTRIES" },
  { id: "wholesales", label: "WHOLESALES" },
  { id: "retail", label: "RETAIL" },
  { id: "ration", label: "CDC WORKERS (RATION)" },
] as const;

const BOTTLED_DELIVERY_COLUMNS = [
  { id: "carton15", label: "1X15L CTN", litresPerUnit: 15 },
  { id: "carton5", label: "3X5L CTN", litresPerUnit: 15 },
  { id: "jug20", label: "1X20L JUG", litresPerUnit: 20 },
] as const;

type SaleLineRecord = {
  salesPointId: number | null;
  saleDisposition: string | null;
  customerTypeCode: string;
  customerTypeName: string;
  productId: number;
  productName: string;
  productCode: string | null;
  isBottled: number;
  qtyKg: number;
  qtyUnits: number | null;
};

function resolveLooseCategoryId(
  saleDisposition: string | null,
  customerTypeCode: string,
  customerTypeName: string,
): (typeof LOOSE_CATEGORY_ROWS)[number]["id"] {
  if (saleDisposition === "RATION") return "ration";
  if (saleDisposition === "RETAIL") return "retail";
  const text = `${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("WHOLESALE")) return "wholesales";
  if (text.includes("RETAIL")) return "retail";
  if (text.includes("INDUSTR")) return "industries";
  return "ration";
}

function saleLineIsLooseLpo(line: SaleLineRecord): boolean {
  return isLooseLpoReportProduct({
    productCode: line.productCode,
    productName: line.productName,
    isBottled: line.isBottled,
  });
}

function buildLooseSection(
  salesPoints: SalesPointRow[],
  saleLines: SaleLineRecord[],
  hideZero: boolean,
) {
  const salesPointNames = salesPoints.map((sp) => sp.name.toUpperCase());
  const looseLines = saleLines.filter(
    (line) => line.isBottled !== 1 && saleLineIsLooseLpo(line),
  );

  const dataRows = LOOSE_CATEGORY_ROWS.map((category) => {
    const quantities = salesPoints.map((salesPoint) =>
      sum(
        looseLines
          .filter((line) => {
            if (line.salesPointId !== salesPoint.id) return false;
            return (
              resolveLooseCategoryId(
                line.saleDisposition,
                line.customerTypeCode,
                line.customerTypeName,
              ) === category.id
            );
          })
          .map((line) => line.qtyKg),
      ),
    );
    return {
      label: category.label,
      quantities,
      rowTotal: sum(quantities),
      kind: "data" as const,
    };
  }).filter((row) => !hideZero || Math.abs(row.rowTotal) > 0.0001);

  const columnTotals = salesPoints.map((_, salesPointIndex) =>
    sum(dataRows.map((row) => row.quantities[salesPointIndex] ?? 0)),
  );

  return {
    title: "1) LOOSE PALM OIL",
    salesPointNames,
    rows: [
      ...dataRows,
      {
        label: "TOTAL",
        quantities: columnTotals,
        rowTotal: sum(columnTotals),
        kind: "total" as const,
      },
    ],
  };
}

function buildBottledSection(
  salesPoints: SalesPointRow[],
  saleLines: SaleLineRecord[],
  products: ProductRow[],
  hideZero: boolean,
) {
  const salesPointNames = salesPoints.map((sp) => sp.name.toUpperCase());
  const bottledProducts = products.filter((product) => product.isBottled === 1);
  const productPackById = new Map(
    bottledProducts.map((product) => [
      product.productId,
      detectBottledPack(product).id,
    ]),
  );
  const bottledLines = saleLines.filter((line) => line.isBottled === 1);

  const dataRows = BOTTLED_DELIVERY_COLUMNS.map((column) => {
    const quantities = salesPoints.map((salesPoint) =>
      sum(
        bottledLines
          .filter(
            (line) =>
              line.salesPointId === salesPoint.id &&
              productPackById.get(line.productId) === column.id,
          )
          .map(
            (line) =>
              (line.qtyUnits ?? line.qtyKg) *
              column.litresPerUnit *
              PALM_OIL_KG_PER_LITRE,
          ),
      ),
    );
    return {
      label: column.label,
      quantities,
      rowTotal: sum(quantities),
      kind: "data" as const,
    };
  }).filter((row) => !hideZero || Math.abs(row.rowTotal) > 0.0001);

  const columnTotals = salesPoints.map((_, salesPointIndex) =>
    sum(dataRows.map((row) => row.quantities[salesPointIndex] ?? 0)),
  );

  return {
    title: "2) BOTTLED PALM OIL",
    salesPointNames,
    rows:
      dataRows.length === 0
        ? []
        : [
            ...dataRows,
            {
              label: "TOTAL",
              quantities: columnTotals,
              rowTotal: sum(columnTotals),
              kind: "total" as const,
            },
          ],
  };
}

function buildMiscSection(
  salesPoints: SalesPointRow[],
  saleLines: SaleLineRecord[],
  products: ProductRow[],
  hideZero: boolean,
) {
  const salesPointNames = salesPoints.map((sp) => sp.name.toUpperCase());
  const miscProducts = products.filter(
    (product) =>
      product.isBottled !== 1 &&
      !isLooseLpoReportProduct({
        productCode: product.productCode,
        productName: product.productName,
        isBottled: product.isBottled,
      }),
  );
  const miscLines = saleLines.filter(
    (line) => line.isBottled !== 1 && !saleLineIsLooseLpo(line),
  );

  const dataRows = miscProducts
    .map((product) => {
      const quantities = salesPoints.map((salesPoint) =>
        sum(
          miscLines
            .filter(
              (line) =>
                line.productId === product.productId &&
                line.salesPointId === salesPoint.id,
            )
            .map((line) => line.qtyKg),
        ),
      );
      return {
        label: product.productName.toUpperCase(),
        quantities,
        rowTotal: sum(quantities),
        kind: "data" as const,
      };
    })
    .filter((row) => !hideZero || Math.abs(row.rowTotal) > 0.0001)
    .sort((left, right) => left.label.localeCompare(right.label));

  const columnTotals = salesPoints.map((_, salesPointIndex) =>
    sum(dataRows.map((row) => row.quantities[salesPointIndex] ?? 0)),
  );

  return {
    title: "3) OTHER PRODUCTS / PKO",
    salesPointNames,
    rows:
      dataRows.length === 0
        ? []
        : [
            ...dataRows,
            {
              label: "TOTAL",
              quantities: columnTotals,
              rowTotal: sum(columnTotals),
              kind: "total" as const,
            },
          ],
  };
}

export async function getWeeklyDeliveriesReport(
  userId?: string | null,
  weekMondayIso?: string | null,
  hideZeroArg?: boolean | null,
) {
  const { asAtIso, period } = await resolveOpenPeriodReportContext(userId);
  const hideZero = hideZeroArg ?? true;
  const [settings, salesPoints, scopedSalesPointId, products] =
    await Promise.all([
      loadReportCompanySettings(userId, asAtIso),
      loadSalesPointsForUser(userId),
      reportScopedSalesPointId(userId),
      loadProducts(),
    ]);

  const weekChoices = buildWeekChoices(
    period.startDate,
    period.endDate,
    asAtIso,
  );
  const selected =
    resolveSelectedWeek(weekChoices, asAtIso, weekMondayIso) ??
    (() => {
      const monday = mondayOf(parseLocalIso(asAtIso));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const weekFromIso = maxIso(toIsoDate(monday), period.startDate);
      const weekToIso = minIso(toIsoDate(sunday), asAtIso);
      return {
        weekMondayIso: toIsoDate(monday),
        weekFromIso,
        weekToIso,
        label: formatWeekLabel(weekFromIso, weekToIso),
      };
    })();

  const raw = await prisma.$queryRaw<
    Array<{
      sales_point_id: number | null;
      sale_disposition: string | null;
      customer_type_code: string | null;
      customer_type_name: string | null;
      product_id: number;
      product_name: string;
      product_code: string | null;
      is_bottled: boolean | null;
      qty_kg: string;
      qty_units: string | null;
    }>
  >`
    SELECT s.sales_point_id, s.sale_disposition,
           COALESCE(pct.code, ct.code, '') AS customer_type_code,
           COALESCE(pct.name, ct.name, '') AS customer_type_name,
           sl.product_id, p.product_name, p.product_code,
           COALESCE(pc.is_bottled, false) AS is_bottled,
           sl.qty_kg, sl.qty_units
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN customer_type_definitions ct ON ct.id = c.customer_type_id
    LEFT JOIN delivery_orders d
      ON d.delivery_order_no = s.delivery_order_no
     AND d.status = 'VALIDATED'
    LEFT JOIN delivery_order_details dd
      ON dd.delivery_order_id = d.id
     AND dd.product_id = sl.product_id
    LEFT JOIN customer_type_definitions pct ON pct.id = dd.pricing_customer_type_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${selected.weekFromIso}
      AND s.date_issued <= ${selected.weekToIso}
      AND (${scopedSalesPointId}::int IS NULL OR s.sales_point_id = ${scopedSalesPointId})
  `;

  const saleLines: SaleLineRecord[] = raw.map((row) => ({
    salesPointId: row.sales_point_id,
    saleDisposition: row.sale_disposition,
    customerTypeCode: String(row.customer_type_code ?? ""),
    customerTypeName: String(row.customer_type_name ?? ""),
    productId: row.product_id,
    productName: String(row.product_name),
    productCode: row.product_code,
    isBottled: row.is_bottled ? 1 : 0,
    qtyKg: parseQty(row.qty_kg),
    qtyUnits: row.qty_units ? parseQty(row.qty_units) : null,
  }));

  return {
    settings,
    asAtIso,
    weekMondayIso: selected.weekMondayIso,
    weekFromIso: selected.weekFromIso,
    weekToIso: selected.weekToIso,
    weekChoices,
    generatedAtIso: nowIso(),
    looseSection: buildLooseSection(salesPoints, saleLines, hideZero),
    bottledSection: buildBottledSection(
      salesPoints,
      saleLines,
      products,
      hideZero,
    ),
    miscSection: buildMiscSection(salesPoints, saleLines, products, hideZero),
    comments: await loadReportComments("sales-delivery-report"),
  };
}
