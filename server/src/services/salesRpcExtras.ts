import { prisma } from "../db/prisma.js";
import { getBalanceQty } from "./stockMovements.js";
import { getCompanySettings } from "./mastersQueries.js";

const FALLBACK_TAX = {
  vatRate: 0.1925,
  salesActual: 0.02,
  salesSimplified: 0.05,
  salesNoTaxpayer: 0.1,
};

function parseRate(value: string | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

function qtyStr(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return String(rounded);
}

async function soldQtyForDoProduct(
  deliveryOrderNo: string,
  productId: number,
): Promise<number> {
  const lines = await prisma.sale_lines.findMany({
    where: {
      product_id: productId,
      sales: {
        delivery_order_no: deliveryOrderNo,
        status: { in: ["VALIDATED", "PENDING"] },
        cancelled_at: null,
      },
    },
    select: { qty_kg: true },
  });
  return lines.reduce(
    (sum, line) => sum + (Number.parseFloat(line.qty_kg) || 0),
    0,
  );
}

export async function getTaxRatesAsOf(asOfDate: string) {
  const asOf = String(asOfDate ?? "").trim().slice(0, 10);
  const rows = await prisma.tax_rate_schedules.findMany({
    where: {
      is_active: true,
      ...(asOf ? { effective_from: { lte: asOf } } : {}),
    },
    orderBy: { effective_from: "desc" },
  });
  const pick = (kind: string) =>
    rows.find((r) => r.rate_kind === kind)?.rate ?? null;
  return {
    vatRate: parseRate(pick("VAT")) || FALLBACK_TAX.vatRate,
    salesActual: parseRate(pick("SALES_ACTUAL")) || FALLBACK_TAX.salesActual,
    salesSimplified:
      parseRate(pick("SALES_SIMPLIFIED")) || FALLBACK_TAX.salesSimplified,
    salesNoTaxpayer:
      parseRate(pick("SALES_NO_TAXPAYER")) || FALLBACK_TAX.salesNoTaxpayer,
  };
}

export async function previewUnitPrice(payload: {
  productId?: number;
  asOfDate?: string;
  customerId?: number | null;
}) {
  const productId = Number(payload.productId);
  const asOf = String(payload.asOfDate ?? "").trim().slice(0, 10);
  if (!Number.isFinite(productId)) {
    return { ok: false as const, error: "Product is required." };
  }
  let customerTypeId: string | null = null;
  if (payload.customerId != null) {
    const customer = await prisma.customers.findUnique({
      where: { id: Number(payload.customerId) },
      select: { customer_type_id: true },
    });
    customerTypeId = customer?.customer_type_id ?? null;
  }
  const schedules = await prisma.product_unit_price_schedules.findMany({
    where: {
      product_id: productId,
      ...(asOf ? { effective_from: { lte: asOf } } : {}),
    },
    orderBy: { effective_from: "desc" },
  });
  const typed = customerTypeId
    ? schedules.find((s) => s.customer_type_id === customerTypeId)
    : null;
  const generic = schedules.find((s) => s.customer_type_id == null);
  const hit = typed ?? generic ?? schedules[0];
  if (!hit) {
    return { ok: false as const, error: "No unit price schedule found." };
  }
  return { ok: true as const, unitPriceExTax: hit.unit_price_ex_tax };
}

export async function listStorageLocationsWithBalance(payload: {
  salesPointId?: number;
  productId?: number;
}) {
  const salesPointId = Number(payload.salesPointId);
  const productId = Number(payload.productId);
  if (!Number.isFinite(salesPointId) || !Number.isFinite(productId)) return [];
  const locations = await prisma.storage_locations.findMany({
    where: { sales_point_id: salesPointId, is_active: true },
    include: { locations: { select: { location_name: true } } },
    orderBy: { id: "asc" },
  });
  const out: Array<{ id: number; name: string; qty: string }> = [];
  for (const loc of locations) {
    const qty = await getBalanceQty(
      prisma,
      salesPointId,
      productId,
      loc.id,
      "SELLABLE",
    );
    out.push({
      id: loc.id,
      name: loc.locations?.location_name ?? `Location #${loc.id}`,
      qty: qtyStr(qty),
    });
  }
  return out;
}

export async function listAvailableDeliveryOrders(payload: {
  salesPointId?: number;
  customerId?: number;
}) {
  const salesPointId = Number(payload.salesPointId);
  const customerId = Number(payload.customerId);
  if (!Number.isFinite(salesPointId) || !Number.isFinite(customerId)) return [];

  const orders = await prisma.delivery_orders.findMany({
    where: {
      sales_point_id: salesPointId,
      customer_id: customerId,
      status: { in: ["VALIDATED", "PARTIALLY_FULFILLED", "PENDING"] },
      cancelled_at: null,
    },
    include: {
      delivery_order_details: true,
    },
    orderBy: { date_issued: "desc" },
    take: 200,
  });

  const customer = await prisma.customers.findUnique({
    where: { id: customerId },
    select: { name: true },
  });
  const productIds = [
    ...new Set(
      orders.flatMap((o) => o.delivery_order_details.map((d) => d.product_id)),
    ),
  ];
  const products = await prisma.products.findMany({
    where: { product_id: { in: productIds } },
    select: { product_id: true, product_name: true },
  });
  const productName = new Map(
    products.map((p) => [p.product_id, p.product_name]),
  );

  const rows: Array<Record<string, unknown>> = [];
  for (const order of orders) {
    for (const detail of order.delivery_order_details) {
      const orderQty = Number(detail.order_qty) || 0;
      const sold = await soldQtyForDoProduct(
        order.delivery_order_no,
        detail.product_id,
      );
      const balance = Math.max(0, orderQty - sold);
      if (balance < 0.000001) continue;
      rows.push({
        deliveryOrderNo: order.delivery_order_no,
        customerName: customer?.name ?? "",
        dateIssued: order.date_issued,
        productId: detail.product_id,
        productName: productName.get(detail.product_id) ?? "",
        balanceKg: qtyStr(balance),
        isCarryForward: order.source_kind === "CARRY_FORWARD",
        sourceDocumentNo: order.order_ref,
      });
    }
  }
  return rows;
}

export async function lookupDeliveryOrder(payload: {
  deliveryOrderNo?: string;
  salesPointId?: number;
  customerId?: number;
}) {
  const deliveryOrderNo = String(payload.deliveryOrderNo ?? "").trim();
  const salesPointId = Number(payload.salesPointId);
  const customerId = Number(payload.customerId);
  if (!deliveryOrderNo || !Number.isFinite(salesPointId)) return null;

  const order = await prisma.delivery_orders.findFirst({
    where: {
      delivery_order_no: deliveryOrderNo,
      sales_point_id: salesPointId,
    },
    include: {
      delivery_order_details: true,
      delivery_order_payment_details: true,
    },
  });
  if (!order) return null;

  const customer =
    order.customer_id != null
      ? await prisma.customers.findUnique({
          where: { id: order.customer_id },
          select: { id: true, name: true },
        })
      : null;

  const productIds = order.delivery_order_details.map((d) => d.product_id);
  const products = await prisma.products.findMany({
    where: { product_id: { in: productIds } },
    select: { product_id: true, product_name: true },
  });
  const productName = new Map(
    products.map((p) => [p.product_id, p.product_name]),
  );

  const perProduct = [];
  for (const d of order.delivery_order_details) {
    const orderQty = Number(d.order_qty) || 0;
    const soldQty = await soldQtyForDoProduct(
      order.delivery_order_no,
      d.product_id,
    );
    const balanceQty = Math.max(0, orderQty - soldQty);
    perProduct.push({
      productId: d.product_id,
      productName: productName.get(d.product_id) ?? "",
      orderQty: qtyStr(orderQty),
      soldQty: qtyStr(soldQty),
      balanceQty: qtyStr(balanceQty),
      unitPrice: d.unit_price ?? "0",
    });
  }

  const balanceKg = qtyStr(
    perProduct.reduce((sum, p) => sum + (Number.parseFloat(p.balanceQty) || 0), 0),
  );

  const paymentMethods = await prisma.payment_method_definitions.findMany();
  const methodById = new Map(paymentMethods.map((m) => [m.id, m]));

  return {
    deliveryOrderNo: order.delivery_order_no,
    dateIssued: order.date_issued,
    customerId: order.customer_id ?? 0,
    customerName: customer?.name ?? "",
    customerMatches:
      Number.isFinite(customerId) && order.customer_id === customerId,
    balanceKg,
    isCarryForward: order.source_kind === "CARRY_FORWARD",
    perProduct,
    payments: order.delivery_order_payment_details.map((p) => ({
      paymentMethodId: p.payment_method_id,
      kind: methodById.get(p.payment_method_id)?.kind ?? "CASH",
      chequeNo: p.cheque_no,
      bank: p.bank,
      traiteNo: null,
      traiteIssuedOn: null,
      traiteMaturityOn: null,
    })),
  };
}

export async function loadSalePrintById(saleId: string) {
  const id = String(saleId ?? "").trim();
  if (!id) return null;
  const sale = await prisma.sales.findUnique({
    where: { id },
    include: {
      sale_lines: { orderBy: { id: "asc" } },
      sale_applied_taxes: true,
      payments: true,
      sales_points: { select: { name: true } },
    },
  });
  if (!sale) return null;

  const [company, customer, user, products, paymentMethods] = await Promise.all([
    getCompanySettings(),
    sale.customer_id != null
      ? prisma.customers.findUnique({ where: { id: sale.customer_id } })
      : Promise.resolve(null),
    prisma.users.findUnique({
      where: { id: sale.created_by_user_id },
      select: { name: true },
    }),
    prisma.products.findMany({
      where: {
        product_id: { in: sale.sale_lines.map((l) => l.product_id) },
      },
      include: { product_cats: { select: { product_cat: true } } },
    }),
    prisma.payment_method_definitions.findMany(),
  ]);

  const productById = new Map(products.map((p) => [p.product_id, p]));
  const methodName = new Map(paymentMethods.map((m) => [m.id, m.name]));

  return {
    companyName: company?.companyName ?? "MPOS",
    department: company?.department ?? null,
    serviceName: sale.commercial_service_name_snapshot,
    companyPhone: sale.issuer_phone_snapshot,
    companyAddress: sale.issuer_address_snapshot,
    logoUrl: company?.logoUrl ?? null,
    signatoryName: "NYAKE VICTORINE Epse MBUA",
    signatoryTitle: "Manager, Palm Oil Sales",
    sale: {
      invoiceNo: sale.invoice_no,
      status: sale.status,
      soldAtIso: sale.sold_at.toISOString(),
      vehicleNumber: sale.vehicle_number ?? "",
      dateIssuedIso: sale.date_issued,
      deliveryOrderNo: sale.delivery_order_no,
      referenceNumber: sale.reference_number,
      customerName: sale.customer_name_snapshot || customer?.name || "",
      customerAddress: customer?.address ?? null,
      customerPhone: customer?.phone ?? null,
      taxpayerId: customer?.taxpayer_id ?? null,
      salespersonName: user?.name ?? null,
      salesPointName: sale.sales_points?.name ?? null,
      saleProductMode: sale.sale_product_mode,
      saleDisposition: sale.sale_disposition,
      netAmount: sale.net_amount,
      vatAmount: sale.vat_amount,
      grossAmount: sale.gross_amount,
      appliedTaxes: sale.sale_applied_taxes.map((t) => ({
        label: t.label_snapshot,
        ratePercent: String((parseRate(t.rate_snapshot) * 100).toFixed(2)),
        amount: t.amount,
      })),
      lines: sale.sale_lines.map((line, index) => {
        const product = productById.get(line.product_id);
        return {
          lineNo: index + 1,
          productCode: product?.product_code ?? null,
          productName: product?.product_name ?? "",
          productCat: product?.product_cats?.product_cat ?? "",
          qty: line.qty_kg,
          unitLabel: product?.uom ?? "Kg",
          unitPrice: line.unit_price_per_kg,
          lineNet: line.line_net,
        };
      }),
      payments: sale.payments.map((p) => ({
        methodName: methodName.get(p.payment_method_id) ?? p.payment_method_id,
        amount: p.amount,
        paymentDate: p.paid_at.toISOString().slice(0, 10),
      })),
    },
  };
}
