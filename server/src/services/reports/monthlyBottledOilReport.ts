import { prisma } from "../../db/prisma.js";
import { getOpenPostingPeriodForActor } from "../financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
import {
  detectBottledPack,
  parseQty,
  reportScopedSalesPointId,
} from "./reportShared.js";

const ROUTE_ID = "monthly-bottled-oil-report";

const PACK_COLUMNS = [
  { id: "jug20", label: "1x20L" },
  { id: "carton5", label: "3x5L" },
  { id: "carton15", label: "1x15L" },
] as const;

function emptyTotals() {
  return { qty20L: 0, qty3x5L: 0, qty15L: 0, amount: 0 };
}

export async function getMonthlyBottledOilReport(userId: string) {
  const asAtIso = await resolveReportAsAt(undefined, userId);
  const period = await getOpenPostingPeriodForActor(userId);
  if (!period) {
    throw new Error("No open posting period. Open a financial month first.");
  }

  const [settings, comments, scopedSalesPointId] = await Promise.all([
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
    reportScopedSalesPointId(userId),
  ]);

  const monthStartIso = period.startDate;
  const sales = await prisma.sales.findMany({
    where: {
      status: "VALIDATED",
      sale_product_mode: "BOTTLE",
      sale_disposition: { in: ["RATION", "PUBLIC_RELATION"] },
      date_issued: { gte: monthStartIso, lte: asAtIso },
      ...(scopedSalesPointId != null
        ? { sales_point_id: scopedSalesPointId }
        : {}),
    },
    include: {
      sale_lines: true,
      vehicle_consignment_notes: {
        include: {
          consignment_details: { select: { receiver_name: true } },
        },
      },
    },
    orderBy: [{ date_issued: "asc" }, { invoice_no: "asc" }],
  });

  const productIds = [
    ...new Set(
      sales.flatMap((sale) => sale.sale_lines.map((line) => line.product_id)),
    ),
  ];
  const products =
    productIds.length > 0
      ? await prisma.products.findMany({
          where: { product_id: { in: productIds } },
          select: {
            product_id: true,
            product_name: true,
            product_code: true,
          },
        })
      : [];
  const productById = new Map(
    products.map((p) => [
      p.product_id,
      { productName: p.product_name, productCode: p.product_code },
    ]),
  );

  const customerIds = [
    ...new Set(
      sales
        .map((sale) => sale.customer_id)
        .filter((id): id is number => id != null),
    ),
  ];
  const customers =
    customerIds.length > 0
      ? await prisma.customers.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, address: true },
        })
      : [];
  const addressByCustomer = new Map(
    customers.map((c) => [c.id, c.address ?? ""]),
  );

  const rows = [];
  const totals = emptyTotals();

  for (const sale of sales) {
    let qty20L = 0;
    let qty3x5L = 0;
    let qty15L = 0;
    for (const line of sale.sale_lines) {
      const product = productById.get(line.product_id);
      if (!product) continue;
      const packId = detectBottledPack(product).id;
      const qty = parseQty(line.qty_units);
      if (packId === "jug20") qty20L += qty;
      else if (packId === "carton5") qty3x5L += qty;
      else if (packId === "carton15") qty15L += qty;
    }

    const amount = Math.round(parseQty(sale.gross_amount));
    rows.push({
      saleId: sale.id,
      dateIssued: String(sale.date_issued).slice(0, 10),
      customerName: sale.customer_name_snapshot,
      address:
        sale.customer_id != null
          ? (addressByCustomer.get(sale.customer_id) ?? "")
          : "",
      qty20L: Math.round(qty20L),
      qty3x5L: Math.round(qty3x5L),
      qty15L: Math.round(qty15L),
      receivedBy:
        sale.vehicle_consignment_notes?.consignment_details?.receiver_name ??
        "",
      amount,
      vehConsignmentNo:
        sale.vehicle_consignment_notes?.consignment_note_no ?? "",
    });

    totals.qty20L += Math.round(qty20L);
    totals.qty3x5L += Math.round(qty3x5L);
    totals.qty15L += Math.round(qty15L);
    totals.amount += amount;
  }

  return {
    settings,
    asAtIso,
    monthStartIso,
    monthName: period.monthName,
    financialYear: period.financialYear,
    reportTitle: "BOTTLED OIL MONTHLY REPORT",
    generatedAtIso: nowIso(),
    packColumns: [...PACK_COLUMNS],
    rows,
    totals,
    comments,
  };
}
