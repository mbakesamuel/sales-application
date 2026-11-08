import { isLooseLpoReportProduct } from "../../shared/looseLpoProduct.js";
import type {
  WeeklyDeliveriesBottledSection,
  WeeklyDeliveriesLooseRow,
  WeeklyDeliveriesLooseSection,
  WeeklyDeliveriesMiscSection,
  WeeklyDeliveriesReport,
  WeeklyDeliveriesWeekChoice,
} from "../../shared/reports.types.js";
import { loadReportCompanySettings, loadReportComments } from "./companySettings.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  loadProducts,
  loadSalesPointsForUser,
  nowIso,
  reportScopedSalesPointId,
  salesPointFilterSql,
  parseQty,
  sum,
  type ProductRow,
  type SalesPointRow,
} from "./shared.js";
import { getDatabase } from "../db/index.js";
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

const MISC_SECTION_TITLE = "3) OTHER PRODUCTS / PKO";

interface SaleLineRecord {
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
}

function resolveLooseCategoryId(
  saleDisposition: string | null,
  customerTypeCode: string,
  customerTypeName: string,
): (typeof LOOSE_CATEGORY_ROWS)[number]["id"] {
  if (saleDisposition === "RATION") {
    return "ration";
  }
  if (saleDisposition === "RETAIL") {
    return "retail";
  }

  const text = `${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("WHOLESALE")) {
    return "wholesales";
  }
  if (text.includes("RETAIL")) {
    return "retail";
  }
  if (text.includes("INDUSTR")) {
    return "industries";
  }
  return "ration";
}

function loadSaleLines(
  weekFromIso: string,
  weekToIso: string,
  salesPointId?: number | null,
): SaleLineRecord[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.salesPointId, s.saleDisposition,
              COALESCE(pct.code, ct.code) AS customerTypeCode,
              COALESCE(pct.name, ct.name) AS customerTypeName,
              sl.productId, p.productName, p.productCode,
              COALESCE(pc.isBottled, 0) AS isBottled, sl.qtyKg, sl.qtyUnits
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       LEFT JOIN Customer c ON c.id = s.customerId
       LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
       LEFT JOIN DeliveryOrder d
         ON d.deliveryOrderNo = s.deliveryOrderNo
        AND d.status = 'VALIDATED'
       LEFT JOIN DeliveryOrderDetails dd
         ON dd.deliveryOrderId = d.id
        AND dd.productId = sl.productId
       LEFT JOIN CustomerTypeDefinition pct ON pct.id = dd.pricingCustomerTypeId
       WHERE s.status = 'VALIDATED'
         AND s.dateIssued >= ?
         AND s.dateIssued <= ?${sp.clause}`,
    )
    .all(weekFromIso, weekToIso, ...sp.params)
    .map((row) => ({
      salesPointId: (row as { salesPointId: number | null }).salesPointId,
      saleDisposition: (row as { saleDisposition: string | null }).saleDisposition,
      customerTypeCode: String((row as { customerTypeCode: string | null }).customerTypeCode ?? ""),
      customerTypeName: String((row as { customerTypeName: string | null }).customerTypeName ?? ""),
      productId: (row as { productId: number }).productId,
      productName: String((row as { productName: string }).productName),
      productCode: (row as { productCode: string | null }).productCode,
      isBottled: (row as { isBottled: number }).isBottled,
      qtyKg: parseQty((row as { qtyKg: string }).qtyKg),
      qtyUnits: (row as { qtyUnits: string | null }).qtyUnits
        ? parseQty((row as { qtyUnits: string }).qtyUnits)
        : null,
    }));
}

function looseLineKg(line: SaleLineRecord): number {
  return line.qtyKg;
}

function bottledLineUnits(line: SaleLineRecord): number {
  return line.qtyUnits ?? line.qtyKg;
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
): WeeklyDeliveriesLooseSection {
  const salesPointNames = salesPoints.map((salesPoint) => salesPoint.name.toUpperCase());
  const looseLines = saleLines.filter(
    (line) => line.isBottled !== 1 && saleLineIsLooseLpo(line),
  );

  const dataRows: WeeklyDeliveriesLooseRow[] = LOOSE_CATEGORY_ROWS.map((category) => {
    const quantities = salesPoints.map((salesPoint) =>
      sum(
        looseLines
          .filter((line) => {
            if (line.salesPointId !== salesPoint.id) {
              return false;
            }
            return (
              resolveLooseCategoryId(
                line.saleDisposition,
                line.customerTypeCode,
                line.customerTypeName,
              ) === category.id
            );
          })
          .map((line) => looseLineKg(line)),
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

  const rows: WeeklyDeliveriesLooseRow[] = [
    ...dataRows,
    {
      label: "TOTAL",
      quantities: columnTotals,
      rowTotal: sum(columnTotals),
      kind: "total",
    },
  ];

  return {
    title: "1) LOOSE PALM OIL",
    salesPointNames,
    rows,
  };
}

function bottledLineKg(line: SaleLineRecord, litresPerUnit: number): number {
  return bottledLineUnits(line) * litresPerUnit * PALM_OIL_KG_PER_LITRE;
}

function buildBottledSection(
  salesPoints: SalesPointRow[],
  saleLines: SaleLineRecord[],
  products: ProductRow[],
  hideZero: boolean,
): WeeklyDeliveriesBottledSection {
  const salesPointNames = salesPoints.map((salesPoint) => salesPoint.name.toUpperCase());
  const bottledProducts = products.filter((product) => product.isBottled === 1);
  const productPackById = new Map(
    bottledProducts.map((product) => [product.productId, detectBottledPack(product).id]),
  );
  const bottledLines = saleLines.filter((line) => line.isBottled === 1);

  const dataRows: WeeklyDeliveriesLooseRow[] = BOTTLED_DELIVERY_COLUMNS.map((column) => {
    const quantities = salesPoints.map((salesPoint) =>
      sum(
        bottledLines
          .filter(
            (line) =>
              line.salesPointId === salesPoint.id &&
              productPackById.get(line.productId) === column.id,
          )
          .map((line) => bottledLineKg(line, column.litresPerUnit)),
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

  const rows: WeeklyDeliveriesLooseRow[] =
    dataRows.length === 0
      ? []
      : [
          ...dataRows,
          {
            label: "TOTAL",
            quantities: columnTotals,
            rowTotal: sum(columnTotals),
            kind: "total",
          },
        ];

  return {
    title: "2) BOTTLED PALM OIL",
    salesPointNames,
    rows,
  };
}

function buildMiscSection(
  salesPoints: SalesPointRow[],
  saleLines: SaleLineRecord[],
  products: ProductRow[],
  hideZero: boolean,
): WeeklyDeliveriesMiscSection {
  const salesPointNames = salesPoints.map((salesPoint) => salesPoint.name.toUpperCase());
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

  const dataRows: WeeklyDeliveriesLooseRow[] = miscProducts
    .map((product) => {
      const quantities = salesPoints.map((salesPoint) =>
        sum(
          miscLines
            .filter(
              (line) =>
                line.productId === product.productId &&
                line.salesPointId === salesPoint.id,
            )
            .map((line) => looseLineKg(line)),
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

  const rows: WeeklyDeliveriesLooseRow[] =
    dataRows.length === 0
      ? []
      : [
          ...dataRows,
          {
            label: "TOTAL",
            quantities: columnTotals,
            rowTotal: sum(columnTotals),
            kind: "total",
          },
        ];

  return {
    title: MISC_SECTION_TITLE,
    salesPointNames,
    rows,
  };
}

export function getWeeklyDeliveriesReport(
  userId?: string | null,
  weekMondayIso?: string | null,
  hideZeroArg?: boolean | null,
): WeeklyDeliveriesReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const settings = loadReportCompanySettings(userId, asAtIso);
  const hideZero = hideZeroArg ?? true;
  const salesPoints = loadSalesPointsForUser(userId);
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const products = loadProducts();

  const weekChoices = buildWeekChoices(period.startDate, period.endDate, asAtIso);
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
      } satisfies WeeklyDeliveriesWeekChoice;
    })();

  const saleLines = loadSaleLines(
    selected.weekFromIso,
    selected.weekToIso,
    scopedSalesPointId,
  );

  return {
    settings,
    asAtIso,
    weekMondayIso: selected.weekMondayIso,
    weekFromIso: selected.weekFromIso,
    weekToIso: selected.weekToIso,
    weekChoices,
    generatedAtIso: nowIso(),
    looseSection: buildLooseSection(salesPoints, saleLines, hideZero),
    bottledSection: buildBottledSection(salesPoints, saleLines, products, hideZero),
    miscSection: buildMiscSection(salesPoints, saleLines, products, hideZero),
    comments: loadReportComments("sales-delivery-report"),
  };
}
