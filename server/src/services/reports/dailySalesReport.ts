/**
 * Daily sales / Sales Summary report (detail by product for one day).
 * Ports src/electron/reports/dailySalesReport.ts.
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
} from "../reportCompany.js";
import {
  loadSalesPointsForUser,
  reportScopedSalesPointId,
  resolveReportSalesPointId,
} from "./reportShared.js";
import {
  DAILY_SALES_SUMMARY_ROWS,
  lineQuantity,
  loadRawSaleLinesForRange,
  resolveDailyCustomerCategory,
  type DailyCustomerCategory,
} from "./dailySalesShared.js";

function normalizeReportDate(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

async function loadDoOrderQty(
  deliveryOrderNo: string,
  productId: number,
): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ order_qty: number }>>`
    SELECT dd.order_qty
    FROM delivery_orders d
    INNER JOIN delivery_order_details dd ON dd.delivery_order_id = d.id
    WHERE d.delivery_order_no = ${deliveryOrderNo}
      AND dd.product_id = ${productId}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return Number(rows[0].order_qty) || 0;
}

async function buildDoBalanceLookup(
  reportDateIso: string,
  pairs: Array<{ deliveryOrderNo: string; productId: number }>,
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (pairs.length === 0) {
    return result;
  }

  for (const pair of pairs) {
    const key = `${pair.deliveryOrderNo}|${pair.productId}`;
    const orderQty = await loadDoOrderQty(pair.deliveryOrderNo, pair.productId);
    if (orderQty == null) {
      continue;
    }

    const saleRows = await prisma.$queryRaw<
      Array<{
        sale_id: string;
        sold_at: Date;
        created_at: Date;
        sold_qty: number;
      }>
    >`
      SELECT s.id AS sale_id,
             s.sold_at,
             s.created_at,
             COALESCE(SUM(CAST(sl.qty_kg AS DOUBLE PRECISION)), 0) AS sold_qty
      FROM sales s
      INNER JOIN sale_lines sl ON sl.sale_id = s.id
      WHERE s.status = 'VALIDATED'
        AND s.delivery_order_no = ${pair.deliveryOrderNo}
        AND sl.product_id = ${pair.productId}
        AND s.date_issued <= ${reportDateIso}
      GROUP BY s.id, s.sold_at, s.created_at
      ORDER BY s.sold_at ASC, s.created_at ASC, s.id ASC
    `;

    const cumulativeBySale = new Map<string, number>();
    let running = 0;
    for (const saleRow of saleRows) {
      running += Number(saleRow.sold_qty) || 0;
      cumulativeBySale.set(
        String(saleRow.sale_id),
        Math.max(0, orderQty - running),
      );
    }

    result.set(key, cumulativeBySale);
  }

  return result;
}

function resolveDoBalance(
  lookup: Map<string, Map<string, number>>,
  deliveryOrderNo: string | null,
  productId: number,
  saleId: string,
): number | null {
  if (!deliveryOrderNo) {
    return null;
  }

  const cumulativeBySale = lookup.get(`${deliveryOrderNo}|${productId}`);
  if (!cumulativeBySale) {
    return null;
  }

  return cumulativeBySale.get(saleId) ?? null;
}

export async function getDailySalesReport(
  userId: string,
  reportDateIso: string,
  salesPointId?: number | null,
) {
  const normalizedDate = normalizeReportDate(reportDateIso);
  if (!normalizedDate) {
    throw new Error("Invalid report date.");
  }

  const [
    scopedSalesPointId,
    selectedSalesPointId,
    salesPointOptions,
    settings,
    comments,
  ] = await Promise.all([
    reportScopedSalesPointId(userId),
    resolveReportSalesPointId(userId, salesPointId),
    loadSalesPointsForUser(userId),
    loadReportCompanySettings(userId, normalizedDate),
    loadReportComments("daily-sales-report"),
  ]);

  const salesPointLabel =
    selectedSalesPointId == null
      ? "ALL SALES POINTS"
      : (salesPointOptions.find((point) => point.id === selectedSalesPointId)
          ?.name ?? "UNKNOWN SALES POINT");

  const rawLines = await loadRawSaleLinesForRange(
    normalizedDate,
    normalizedDate,
    selectedSalesPointId,
    null,
  );

  const doPairs = Array.from(
    new Map(
      rawLines
        .filter((line) => line.deliveryOrderNo)
        .map((line) => [
          `${line.deliveryOrderNo}|${line.productId}`,
          {
            deliveryOrderNo: line.deliveryOrderNo as string,
            productId: line.productId,
          },
        ]),
    ).values(),
  );
  const doBalanceLookup = await buildDoBalanceLookup(normalizedDate, doPairs);

  const summaryTotals = new Map<DailyCustomerCategory, number>(
    DAILY_SALES_SUMMARY_ROWS.map((row) => [row.id, 0]),
  );

  const sectionsByProduct = new Map<
    number,
    {
      productName: string;
      rows: Array<{
        sn: number;
        customerName: string;
        deliveryOrderNo: string | null;
        dateIssuedIso: string;
        vehicleNumber: string | null;
        quantity: number;
        quantityLabel: "kg" | "unit";
        doBalance: number | null;
      }>;
    }
  >();

  for (const line of rawLines) {
    const quantity = lineQuantity(line);
    const category = resolveDailyCustomerCategory(
      line.saleDisposition,
      line.customerTypeCode,
      line.customerTypeName,
    );
    summaryTotals.set(category, (summaryTotals.get(category) ?? 0) + quantity);

    const doBalance = resolveDoBalance(
      doBalanceLookup,
      line.deliveryOrderNo,
      line.productId,
      line.saleId,
    );

    const section = sectionsByProduct.get(line.productId) ?? {
      productName: line.productName,
      rows: [],
    };

    section.rows.push({
      sn: section.rows.length + 1,
      customerName: line.customerName,
      deliveryOrderNo: line.deliveryOrderNo,
      dateIssuedIso: line.dateIssued.slice(0, 10),
      vehicleNumber:
        line.vehicleNumber && line.vehicleNumber !== "BPO-OUTBOUND"
          ? line.vehicleNumber
          : null,
      quantity,
      quantityLabel: line.isBottled === 1 ? "unit" : "kg",
      doBalance,
    });
    sectionsByProduct.set(line.productId, section);
  }

  const sections = Array.from(sectionsByProduct.values())
    .sort((left, right) => left.productName.localeCompare(right.productName))
    .map((section) => ({
      productName: section.productName,
      rows: section.rows,
      subtotalQuantity: section.rows.reduce(
        (total, row) => total + row.quantity,
        0,
      ),
      subtotalDoBalance: section.rows.reduce(
        (total, row) => total + (row.doBalance ?? 0),
        0,
      ),
    }));

  const grandTotalQuantity = sections.reduce(
    (total, section) => total + section.subtotalQuantity,
    0,
  );
  const grandTotalDoBalance = sections.reduce(
    (total, section) => total + section.subtotalDoBalance,
    0,
  );

  const summaryRows = DAILY_SALES_SUMMARY_ROWS.map((row) => ({
    id: row.id,
    label: row.label,
    quantity: summaryTotals.get(row.id) ?? 0,
  }));
  const summaryGrandTotal = summaryRows.reduce(
    (total, row) => total + row.quantity,
    0,
  );

  return {
    settings,
    reportDateIso: normalizedDate,
    selectedSalesPointId,
    scopedSalesPointId,
    salesPointLabel,
    generatedAtIso: nowIso(),
    sections,
    grandTotalQuantity,
    grandTotalDoBalance,
    summaryRows,
    summaryGrandTotal,
    salesPointOptions,
    comments,
  };
}
