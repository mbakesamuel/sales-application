/**
 * Ports src/electron/reports/otherProductSalesDeliveriesReport.ts
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
} from "../reportCompany.js";
import {
  isLooseLpoReportProduct,
  parseQty,
  reportScopedSalesPointId,
} from "./reportShared.js";
import { resolveOpenPeriodReportContext } from "./openPeriodReportContext.js";

const ROUTE_ID = "other-product-sales-deliveries-report";

type Metrics = {
  paymentsKg: number;
  paymentsValue: number;
  deliveriesKg: number;
  deliveriesValue: number;
};

function emptyMetrics(): Metrics {
  return {
    paymentsKg: 0,
    paymentsValue: 0,
    deliveriesKg: 0,
    deliveriesValue: 0,
  };
}

function addDeliveries(target: Metrics, qtyKg: number, lineNet: number): void {
  target.deliveriesKg += qtyKg;
  target.deliveriesValue += lineNet;
}

function sumMetrics(rows: Metrics[]): Metrics {
  const total = emptyMetrics();
  for (const row of rows) {
    total.paymentsKg += row.paymentsKg;
    total.paymentsValue += row.paymentsValue;
    total.deliveriesKg += row.deliveriesKg;
    total.deliveriesValue += row.deliveriesValue;
  }
  return total;
}

function withRoundedKg(metrics: Metrics): Metrics {
  return {
    ...metrics,
    paymentsKg: Math.round(metrics.paymentsKg),
    deliveriesKg: Math.round(metrics.deliveriesKg),
  };
}

export async function getOtherProductSalesDeliveriesReport(
  userId?: string | null,
) {
  const { asAtIso, period } = await resolveOpenPeriodReportContext(userId);
  const [settings, comments, scopedSalesPointId] = await Promise.all([
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
    reportScopedSalesPointId(userId),
  ]);
  const monthStartIso = period.startDate;
  const monthLabel = `${period.monthName} ${period.financialYear}`.toUpperCase();

  const rows = await prisma.$queryRaw<
    Array<{
      sales_point_id: number | null;
      sales_point_name: string | null;
      product_id: number;
      product_name: string;
      product_code: string | null;
      is_bottled: boolean | null;
      qty_kg: string;
      line_net: string;
    }>
  >`
    SELECT s.sales_point_id,
           COALESCE(sp.name, 'Unassigned') AS sales_point_name,
           sl.product_id, p.product_name, p.product_code,
           COALESCE(pc.is_bottled, false) AS is_bottled,
           sl.qty_kg, sl.line_net
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    LEFT JOIN sales_points sp ON sp.id = s.sales_point_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${monthStartIso}
      AND s.date_issued <= ${asAtIso}
      AND (${scopedSalesPointId}::int IS NULL OR s.sales_point_id = ${scopedSalesPointId})
  `;

  const lines = rows
    .map((row) => ({
      salesPointId: row.sales_point_id == null ? null : Number(row.sales_point_id),
      salesPointName: String(row.sales_point_name ?? "Unassigned"),
      productId: row.product_id,
      productName: String(row.product_name),
      productCode: row.product_code,
      isBottled: row.is_bottled ? 1 : 0,
      qtyKg: parseQty(row.qty_kg),
      lineNet: parseQty(row.line_net),
    }))
    .filter(
      (line) =>
        line.isBottled !== 1 &&
        !isLooseLpoReportProduct({
          productCode: line.productCode,
          productName: line.productName,
          isBottled: line.isBottled,
        }),
    );

  type ProductAgg = {
    productId: number;
    productName: string;
    metrics: Metrics;
  };
  type SpAgg = {
    salesPointId: number | null;
    salesPointName: string;
    products: Map<number, ProductAgg>;
  };

  const bySalesPoint = new Map<string, SpAgg>();
  for (const line of lines) {
    const spKey =
      line.salesPointId == null ? "none" : String(line.salesPointId);
    let sp = bySalesPoint.get(spKey);
    if (!sp) {
      sp = {
        salesPointId: line.salesPointId,
        salesPointName: line.salesPointName,
        products: new Map(),
      };
      bySalesPoint.set(spKey, sp);
    }
    let product = sp.products.get(line.productId);
    if (!product) {
      product = {
        productId: line.productId,
        productName: line.productName,
        metrics: emptyMetrics(),
      };
      sp.products.set(line.productId, product);
    }
    addDeliveries(product.metrics, line.qtyKg, line.lineNet);
  }

  const sections = [...bySalesPoint.values()]
    .map((sp) => {
      const productRows = [...sp.products.values()]
        .map((product) => ({
          id: `sp-${sp.salesPointId ?? "none"}-p-${product.productId}`,
          kind: "product" as const,
          salesPointLabel: sp.salesPointName.toUpperCase(),
          productLabel: product.productName.toUpperCase(),
          productId: product.productId,
          ...withRoundedKg(product.metrics),
        }))
        .sort((a, b) => a.productLabel.localeCompare(b.productLabel));

      const subtotalMetrics = withRoundedKg(sumMetrics(productRows));
      return {
        salesPointId: sp.salesPointId,
        salesPointName: sp.salesPointName,
        productRows,
        subtotal: {
          id: `sp-${sp.salesPointId ?? "none"}-subtotal`,
          kind: "subtotal" as const,
          salesPointLabel: "SUBTOTAL",
          productLabel: "",
          productId: null,
          ...subtotalMetrics,
        },
      };
    })
    .filter((section) => section.productRows.length > 0)
    .sort((a, b) =>
      a.salesPointName
        .toUpperCase()
        .localeCompare(b.salesPointName.toUpperCase()),
    );

  return {
    settings,
    asAtIso,
    monthStartIso,
    monthName: period.monthName,
    financialYear: period.financialYear,
    reportTitle: `OTHER PRODUCT SALES AND DELIVERIES FOR ${monthLabel}`,
    generatedAtIso: nowIso(),
    sections,
    grandTotal: {
      id: "grand-total",
      kind: "grandTotal" as const,
      salesPointLabel: "GRAND TOTAL",
      productLabel: "",
      productId: null,
      ...withRoundedKg(sumMetrics(sections.map((section) => section.subtotal))),
    },
    comments,
  };
}
