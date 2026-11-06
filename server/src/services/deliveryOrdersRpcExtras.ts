import { prisma } from "../db/prisma.js";
import { getBalanceQty } from "./stockMovements.js";
import { previewUnitPrice, getTaxRatesAsOf } from "./salesRpcExtras.js";
import { getCompanySettings } from "./mastersQueries.js";
import { getOpenPostingPeriod } from "./financialYearsService.js";
import { getReportSignatory } from "./reportCompany.js";

function qtyStr(n: number): string {
  return String(Math.round(n * 1_000_000) / 1_000_000);
}

function resolveVatApplies(residency: string | null | undefined): boolean {
  return String(residency ?? "LOCAL").toUpperCase() === "LOCAL";
}

function formatTaxLabelWithPercent(baseLabel: string, rateDecimal: number): string {
  const percent = (rateDecimal * 100).toFixed(2);
  return `${baseLabel} (${percent}%)`;
}

function buildDoTaxPreview(input: {
  residency: string | null | undefined;
  taxRegimeKind: string | null | undefined;
  taxpayerId: string | null | undefined;
  salesTaxExempt?: boolean | null;
  rates: {
    vatRate: number;
    salesActual: number;
    salesSimplified: number;
    salesNoTaxpayer: number;
  };
}) {
  const vatApplies = resolveVatApplies(input.residency);
  const vatRate = vatApplies ? input.rates.vatRate : 0;
  const hasTaxpayer = String(input.taxpayerId ?? "").trim().length > 0;
  const regime = String(input.taxRegimeKind ?? "SIMPLIFIED").toUpperCase();
  const salesTaxRate = input.salesTaxExempt
    ? 0
    : !hasTaxpayer
      ? input.rates.salesNoTaxpayer
      : regime === "REAL"
        ? input.rates.salesActual
        : input.rates.salesSimplified;

  return {
    vatRate: String(vatRate),
    vatPercentLabel: (vatRate * 100).toFixed(2),
    vatLabel: vatRate > 0 ? formatTaxLabelWithPercent("VAT", vatRate) : null,
    otherRate: String(salesTaxRate),
    otherPercentLabel: (salesTaxRate * 100).toFixed(2),
    otherLabel:
      salesTaxRate > 0
        ? formatTaxLabelWithPercent("Sales tax", salesTaxRate)
        : null,
  };
}

async function mapOrder(orderId: string) {
  const order = await prisma.delivery_orders.findUnique({
    where: { id: orderId },
    include: {
      delivery_order_details: true,
      delivery_order_payment_details: true,
      sales_points: { select: { name: true } },
    },
  });
  if (!order) return null;

  const [customer, createdBy, validatedBy, products] = await Promise.all([
    order.customer_id != null
      ? prisma.customers.findUnique({
          where: { id: order.customer_id },
          include: {
            tax_regimes: { select: { kind: true } },
            customer_type_definitions: {
              select: { exempt_from_sales_tax: true },
            },
          },
        })
      : Promise.resolve(null),
    order.created_by_user_id
      ? prisma.users.findUnique({
          where: { id: order.created_by_user_id },
          select: { name: true },
        })
      : Promise.resolve(null),
    order.validated_by_user_id
      ? prisma.users.findUnique({
          where: { id: order.validated_by_user_id },
          select: { name: true },
        })
      : Promise.resolve(null),
    prisma.products.findMany({
      where: {
        product_id: {
          in: order.delivery_order_details.map((d) => d.product_id),
        },
      },
    }),
  ]);

  const productName = new Map(
    products.map((p) => [p.product_id, p.product_name]),
  );

  return {
    id: order.id,
    deliveryOrderNo: order.delivery_order_no,
    dateIssued: order.date_issued,
    status: order.status,
    customerId: order.customer_id,
    customerName: customer?.name ?? null,
    vatApplies: resolveVatApplies(customer?.residency),
    salesPointId: order.sales_point_id,
    salesPointName: order.sales_points?.name ?? null,
    orderRef: order.order_ref,
    createdByName: createdBy?.name ?? null,
    validatedByName: validatedBy?.name ?? null,
    validatedAtIso: order.validated_at
      ? order.validated_at.toISOString()
      : null,
    lines: order.delivery_order_details.map((d) => ({
      id: String(d.id),
      productId: d.product_id,
      productName: productName.get(d.product_id) ?? "",
      orderQty: String(d.order_qty),
      orderUnit: d.order_unit || "kg",
      unitPrice: d.unit_price ?? "0",
      lineSubtotalExTax: d.line_subtotal_ex_tax ?? "0",
      vatAmount: d.vat_amount ?? "0",
      otherTaxAmount: d.other_tax_amount ?? "0",
      amount: d.amount ?? "0",
    })),
    payments: order.delivery_order_payment_details.map((p) => ({
      paymentMethodId: p.payment_method_id,
      paymentDate: p.payment_date,
      chequeNo: p.cheque_no ?? "",
      bank: p.bank ?? "",
      cashReceiptNo: p.cash_receipt_no ?? "",
      receiptDate: p.receipt_date ?? "",
      traiteNo: p.traite_no ?? "",
      traiteIssuedOn: p.traite_issued_on ?? "",
      traiteMaturityOn: p.traite_maturity_on ?? "",
    })),
  };
}

export async function loadByNo(deliveryOrderNo: string) {
  const no = String(deliveryOrderNo ?? "").trim();
  if (!no) return null;
  const order = await prisma.delivery_orders.findFirst({
    where: { delivery_order_no: no },
  });
  if (!order) return null;
  return mapOrder(order.id);
}

function sumMoney(values: Array<string | number | null | undefined>): string {
  let total = 0;
  for (const value of values) {
    const n = Number.parseFloat(String(value ?? "0").replace(",", "."));
    if (Number.isFinite(n)) total += n;
  }
  return String(Math.round(total * 100) / 100);
}

function paymentDetail(row: {
  kind: string;
  cheque_no: string | null;
  bank: string | null;
  cash_receipt_no: string | null;
  traite_no: string | null;
  traite_issued_on: string | null;
  traite_maturity_on: string | null;
}): string | null {
  if (row.kind === "TRAITE") {
    const parts: string[] = [];
    if (row.traite_no?.trim()) parts.push(`Trait ${row.traite_no.trim()}`);
    if (row.traite_issued_on?.trim()) {
      parts.push(`issued ${row.traite_issued_on.trim().slice(0, 10)}`);
    }
    if (row.traite_maturity_on?.trim()) {
      parts.push(`matures ${row.traite_maturity_on.trim().slice(0, 10)}`);
    }
    if (row.bank?.trim()) parts.push(row.bank.trim());
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (row.kind === "CHEQUE") {
    const parts = [row.cheque_no, row.bank].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (row.kind === "BANK_TRANSFER") {
    return row.bank?.trim() || null;
  }
  if (row.cash_receipt_no) {
    return `Receipt ${row.cash_receipt_no}`;
  }
  return null;
}

export async function loadPrintById(orderId: string) {
  const id = String(orderId ?? "").trim();
  if (!id) return null;

  const order = await prisma.delivery_orders.findUnique({
    where: { id },
    include: {
      delivery_order_details: { orderBy: { id: "asc" } },
      delivery_order_payment_details: { orderBy: { id: "asc" } },
      sales_points: { select: { name: true } },
    },
  });
  if (!order) return null;

  const [customer, createdBy, validatedBy, company, signatory, products, methods] =
    await Promise.all([
      order.customer_id != null
        ? prisma.customers.findUnique({ where: { id: order.customer_id } })
        : Promise.resolve(null),
      order.created_by_user_id
        ? prisma.users.findUnique({
            where: { id: order.created_by_user_id },
            select: { name: true },
          })
        : Promise.resolve(null),
      order.validated_by_user_id
        ? prisma.users.findUnique({
            where: { id: order.validated_by_user_id },
            select: { name: true },
          })
        : Promise.resolve(null),
      getCompanySettings(),
      getReportSignatory(order.date_issued),
      order.delivery_order_details.length > 0
        ? prisma.products.findMany({
            where: {
              product_id: {
                in: order.delivery_order_details.map((d) => d.product_id),
              },
            },
            select: { product_id: true, product_name: true },
          })
        : Promise.resolve([]),
      order.delivery_order_payment_details.length > 0
        ? prisma.payment_method_definitions.findMany({
            where: {
              id: {
                in: order.delivery_order_payment_details.map(
                  (p) => p.payment_method_id,
                ),
              },
            },
          })
        : Promise.resolve([]),
    ]);

  const productName = new Map(
    products.map((p) => [p.product_id, p.product_name]),
  );
  const methodById = new Map(methods.map((m) => [m.id, m]));

  const lines = order.delivery_order_details.map((d, index) => ({
    lineNo: index + 1,
    productName: productName.get(d.product_id) ?? "",
    orderQty: String(d.order_qty ?? 0),
    orderUnit: d.order_unit?.trim() || "kg",
    unitPrice: String(d.unit_price ?? "0"),
    lineSubtotalExTax: String(d.line_subtotal_ex_tax ?? "0"),
    vatAmount: String(d.vat_amount ?? "0"),
    otherTaxAmount: String(d.other_tax_amount ?? "0"),
    amount: String(d.amount ?? "0"),
    vatRate: d.vat_rate,
    otherTaxLabel: d.other_tax_label,
  }));

  const subtotalExTax = sumMoney(lines.map((l) => l.lineSubtotalExTax));
  const vatAmount = sumMoney(lines.map((l) => l.vatAmount));
  const otherTaxAmount = sumMoney(lines.map((l) => l.otherTaxAmount));
  const grandTotal = sumMoney(lines.map((l) => l.amount));
  // Fall back to qty × unit when line amounts were never persisted.
  const computedNet = sumMoney(
    order.delivery_order_details.map((d) => {
      const qty = Number(d.order_qty) || 0;
      const unit = Number.parseFloat(String(d.unit_price ?? "0")) || 0;
      return qty * unit;
    }),
  );
  const net = Number.parseFloat(subtotalExTax) > 0 ? subtotalExTax : computedNet;
  const gross =
    Number.parseFloat(grandTotal) > 0
      ? grandTotal
      : sumMoney([net, vatAmount, otherTaxAmount]);

  const vatRate =
    lines.map((l) => l.vatRate).find((rate) => Boolean(rate?.trim())) ?? null;
  let otherTaxLabel =
    lines
      .map((l) => l.otherTaxLabel)
      .find((label) => Boolean(label?.trim())) ?? null;
  if (Number.parseFloat(otherTaxAmount) > 0) {
    const base = otherTaxLabel?.trim() || "Sales tax";
    if (!base.includes("%")) {
      otherTaxLabel = `${base}`;
    }
  }

  return {
    companyName: company?.companyName ?? "MPOS",
    department: company?.department ?? null,
    serviceName: order.commercial_service_name_snapshot,
    companyPhone: order.issuer_phone_snapshot,
    companyAddress: order.issuer_address_snapshot,
    signatoryName: signatory.name,
    signatoryTitle: signatory.title,
    order: {
      deliveryOrderNo: order.delivery_order_no,
      status: order.status,
      dateIssuedIso: order.date_issued.slice(0, 10),
      orderRef: order.order_ref,
      salesPointName: order.sales_points?.name ?? "",
      customerName: customer?.name ?? "",
      customerAddress: customer?.address ?? null,
      customerPhone: customer?.phone ?? null,
      taxpayerId: customer?.taxpayer_id ?? null,
      createdByName: createdBy?.name ?? null,
      validatedByName: validatedBy?.name ?? null,
      subtotalExTax: net,
      vatAmount,
      vatRate,
      otherTaxAmount,
      otherTaxLabel,
      grandTotal: gross,
      lines: lines.map(({ vatRate: _v, otherTaxLabel: _o, ...line }) => line),
      payments: order.delivery_order_payment_details.map((p) => {
        const method = methodById.get(p.payment_method_id);
        return {
          methodName: method?.name ?? "Payment",
          paymentDate: p.payment_date,
          detail: paymentDetail({
            kind: method?.kind ?? "",
            cheque_no: p.cheque_no,
            bank: p.bank,
            cash_receipt_no: p.cash_receipt_no,
            traite_no: p.traite_no,
            traite_issued_on: p.traite_issued_on,
            traite_maturity_on: p.traite_maturity_on,
          }),
        };
      }),
    },
  };
}

function normalizeSourceKind(
  value: string | null | undefined,
): "NORMAL" | "CARRY_FORWARD" | "TRANSFER" {
  if (value === "CARRY_FORWARD") return "CARRY_FORWARD";
  if (value === "TRANSFER") return "TRANSFER";
  return "NORMAL";
}

export async function trackByNo(deliveryOrderNo: string) {
  const no = String(deliveryOrderNo ?? "").trim();
  if (!no) return null;

  const order = await prisma.delivery_orders.findFirst({
    where: { delivery_order_no: no },
    include: {
      sales_points: { select: { name: true } },
      delivery_order_details: { orderBy: { id: "asc" } },
      delivery_orders: {
        select: { delivery_order_no: true },
      },
    },
  });
  if (!order) return null;

  const [customer, productRows, saleRows, transferRows, company, signatory] =
    await Promise.all([
      order.customer_id != null
        ? prisma.customers.findUnique({
            where: { id: order.customer_id },
            select: { name: true },
          })
        : Promise.resolve(null),
      order.delivery_order_details.length > 0
        ? prisma.products.findMany({
            where: {
              product_id: {
                in: order.delivery_order_details.map((d) => d.product_id),
              },
            },
            select: { product_id: true, product_name: true },
          })
        : Promise.resolve([]),
      prisma.sales.findMany({
        where: {
          delivery_order_no: order.delivery_order_no,
          status: { in: ["PENDING", "VALIDATED"] },
        },
        orderBy: [{ date_issued: "desc" }, { invoice_no: "desc" }],
        include: {
          sale_lines: { orderBy: { id: "asc" } },
        },
      }),
      prisma.delivery_order_transfers.findMany({
        where: { from_delivery_order_id: order.id },
        orderBy: [{ transferred_at: "desc" }, { id: "desc" }],
        include: {
          delivery_orders_delivery_order_transfers_to_delivery_order_idTodelivery_orders:
            { select: { delivery_order_no: true } },
          sales_points_delivery_order_transfers_to_sales_point_idTosales_points:
            { select: { name: true } },
          delivery_order_transfer_lines: { orderBy: { id: "asc" } },
        },
      }),
      getCompanySettings(),
      getReportSignatory(order.date_issued),
    ]);

  const productName = new Map(
    productRows.map((p) => [p.product_id, p.product_name]),
  );

  const liftedByProduct = new Map<number, number>();
  for (const sale of saleRows) {
    for (const line of sale.sale_lines) {
      const qty =
        Number.parseFloat(String(line.qty_kg ?? "0").replace(",", ".")) || 0;
      liftedByProduct.set(
        line.product_id,
        (liftedByProduct.get(line.product_id) ?? 0) + qty,
      );
    }
  }

  let orderedTotal = 0;
  let liftedTotal = 0;
  const products = order.delivery_order_details
    .slice()
    .sort((a, b) => {
      const nameA = productName.get(a.product_id) ?? "";
      const nameB = productName.get(b.product_id) ?? "";
      return nameA.localeCompare(nameB) || Number(a.id) - Number(b.id);
    })
    .map((detail) => {
      const orderQty = Number(detail.order_qty) || 0;
      const liftedQty = liftedByProduct.get(detail.product_id) ?? 0;
      const remainingQty = Math.max(orderQty - liftedQty, 0);
      const liftedPercent =
        orderQty > 0 ? Math.round((liftedQty / orderQty) * 1000) / 10 : 0;
      orderedTotal += orderQty;
      liftedTotal += liftedQty;
      return {
        productId: detail.product_id,
        productName: productName.get(detail.product_id) ?? "",
        orderQty: qtyStr(orderQty),
        liftedQty: qtyStr(liftedQty),
        remainingQty: qtyStr(remainingQty),
        liftedPercent: String(liftedPercent),
      };
    });

  const remainingTotal = Math.max(orderedTotal - liftedTotal, 0);

  const liftProductIds = [
    ...new Set(saleRows.flatMap((s) => s.sale_lines.map((l) => l.product_id))),
  ];
  const liftProducts =
    liftProductIds.length > 0
      ? await prisma.products.findMany({
          where: { product_id: { in: liftProductIds } },
          select: { product_id: true, product_name: true },
        })
      : [];
  const liftProductName = new Map(
    liftProducts.map((p) => [p.product_id, p.product_name]),
  );

  const lifts = saleRows.map((sale) => ({
    saleId: sale.id,
    invoiceNo: sale.invoice_no,
    dateIssued: String(sale.date_issued).slice(0, 10),
    status: sale.status,
    customerName: sale.customer_name_snapshot,
    lines: sale.sale_lines
      .slice()
      .sort((a, b) => {
        const nameA = liftProductName.get(a.product_id) ?? "";
        const nameB = liftProductName.get(b.product_id) ?? "";
        return nameA.localeCompare(nameB);
      })
      .map((line) => ({
        productId: line.product_id,
        productName: liftProductName.get(line.product_id) ?? "",
        qtyKg: qtyStr(
          Number.parseFloat(String(line.qty_kg ?? "0").replace(",", ".")) || 0,
        ),
        unitPricePerKg: String(line.unit_price_per_kg ?? "0"),
        lineNet: String(line.line_net ?? "0"),
      })),
  }));

  const transferProductIds = [
    ...new Set(
      transferRows.flatMap((t) =>
        t.delivery_order_transfer_lines.map((l) => l.product_id),
      ),
    ),
  ];
  const transferProducts =
    transferProductIds.length > 0
      ? await prisma.products.findMany({
          where: { product_id: { in: transferProductIds } },
          select: { product_id: true, product_name: true },
        })
      : [];
  const transferProductName = new Map(
    transferProducts.map((p) => [p.product_id, p.product_name]),
  );

  const transfersOut = transferRows.map((transfer) => ({
    transferId: transfer.id,
    toDeliveryOrderNo:
      transfer
        .delivery_orders_delivery_order_transfers_to_delivery_order_idTodelivery_orders
        .delivery_order_no,
    toSalesPointName:
      transfer
        .sales_points_delivery_order_transfers_to_sales_point_idTosales_points
        .name,
    transferredAt: transfer.transferred_at.toISOString().slice(0, 19),
    lines: transfer.delivery_order_transfer_lines
      .slice()
      .sort((a, b) => {
        const nameA = transferProductName.get(a.product_id) ?? "";
        const nameB = transferProductName.get(b.product_id) ?? "";
        return nameA.localeCompare(nameB);
      })
      .map((line) => ({
        productId: line.product_id,
        productName: transferProductName.get(line.product_id) ?? "",
        qtyKg: qtyStr(Number(line.qty_kg) || 0),
      })),
  }));

  return {
    companyName: company?.companyName ?? "MPOS",
    department: company?.department ?? null,
    serviceName: order.commercial_service_name_snapshot ?? null,
    signatoryName: signatory.name,
    signatoryTitle: signatory.title,
    order: {
      id: order.id,
      deliveryOrderNo: order.delivery_order_no,
      status: order.status,
      sourceKind: normalizeSourceKind(order.source_kind),
      dateIssued: String(order.date_issued).slice(0, 10),
      orderRef: order.order_ref,
      customerId: order.customer_id,
      customerName: customer?.name ?? "",
      salesPointId: order.sales_point_id,
      salesPointName: order.sales_points?.name ?? "",
      transferredFromDeliveryOrderNo:
        order.delivery_orders?.delivery_order_no ?? null,
    },
    totals: {
      orderedKg: qtyStr(orderedTotal),
      liftedKg: qtyStr(liftedTotal),
      remainingKg: qtyStr(remainingTotal),
    },
    products,
    lifts,
    transfersOut,
  };
}

export async function listPending(ctx: {
  salesPointId: number | null;
}) {
  const rows = await prisma.delivery_orders.findMany({
    where: {
      status: "PENDING",
      cancelled_at: null,
      ...(ctx.salesPointId != null ? { sales_point_id: ctx.salesPointId } : {}),
    },
    orderBy: { date_issued: "asc" },
    take: 200,
    include: {
      sales_points: { select: { name: true } },
      delivery_order_details: { select: { amount: true } },
    },
  });
  const customers = await prisma.customers.findMany({
    where: {
      id: {
        in: rows
          .map((r) => r.customer_id)
          .filter((id): id is number => id != null),
      },
    },
  });
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  return rows.map((r) => {
    const total = r.delivery_order_details.reduce(
      (sum, line) => sum + (Number.parseFloat(line.amount ?? "0") || 0),
      0,
    );
    return {
      id: r.id,
      deliveryOrderNo: r.delivery_order_no,
      dateIssued: r.date_issued,
      customerName:
        r.customer_id != null ? customerName.get(r.customer_id) ?? "" : "",
      salesPointName: r.sales_points?.name ?? null,
      status: r.status,
      totalLabel: `${Math.round(total).toLocaleString()} XAF`,
    };
  });
}

function formatProductSummary(lines: Array<{ productName: string }>): string {
  if (lines.length === 0) return "";
  if (lines.length === 1) return lines[0].productName;
  return `${lines[0].productName} +${lines.length - 1} more`;
}

function localTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function resolveListDateRange(period: string): Promise<{
  fromIso: string | null;
  toIso: string | null;
  periodLabel: string;
}> {
  if (period === "all") {
    return { fromIso: null, toIso: null, periodLabel: "All time" };
  }

  const open = await getOpenPostingPeriod();
  if (!open) {
    throw new Error("Open a financial month before listing documents.");
  }

  const today = localTodayIso();
  const asAtIso = today < open.endDate ? today : open.endDate;

  if (period === "year") {
    const yearStart = `${open.financialYear}-01-01`;
    const yearEnd = `${open.financialYear}-12-31`;
    const toIso = asAtIso < yearEnd ? asAtIso : yearEnd;
    return {
      fromIso: yearStart,
      toIso,
      periodLabel: `FY ${open.financialYear} (through ${toIso})`,
    };
  }

  return {
    fromIso: open.startDate,
    toIso: asAtIso,
    periodLabel: `${open.monthName} ${open.financialYear}`,
  };
}

export async function listOrders(
  filters: Record<string, unknown> | undefined,
  ctx: { salesPointId: number | null },
) {
  const q = String(filters?.q ?? "").trim();
  const periodRaw = String(filters?.period ?? "month");
  const period =
    periodRaw === "year" || periodRaw === "all" ? periodRaw : "month";

  const filterSp =
    filters?.salesPointId != null ? Number(filters.salesPointId) : null;
  const salesPointId =
    ctx.salesPointId != null
      ? ctx.salesPointId
      : filterSp != null && Number.isFinite(filterSp)
        ? filterSp
        : null;

  const { fromIso, toIso, periodLabel } = await resolveListDateRange(period);

  const rows = await prisma.delivery_orders.findMany({
    where: {
      ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
      ...(q
        ? {
            OR: [
              { delivery_order_no: { contains: q, mode: "insensitive" } },
              { order_ref: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(fromIso && toIso
        ? { date_issued: { gte: fromIso, lte: toIso } }
        : {}),
    },
    orderBy: [{ date_issued: "desc" }, { delivery_order_no: "desc" }],
    take: 300,
    include: {
      sales_points: { select: { name: true } },
      delivery_order_details: {
        orderBy: { id: "asc" },
      },
    },
  });

  const customers = await prisma.customers.findMany({
    where: {
      id: {
        in: rows
          .map((r) => r.customer_id)
          .filter((id): id is number => id != null),
      },
    },
  });
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

  const productIds = [
    ...new Set(
      rows.flatMap((r) => r.delivery_order_details.map((d) => d.product_id)),
    ),
  ];
  const products =
    productIds.length > 0
      ? await prisma.products.findMany({
          where: { product_id: { in: productIds } },
          select: { product_id: true, product_name: true },
        })
      : [];
  const productName = new Map(
    products.map((p) => [p.product_id, p.product_name]),
  );

  let totalQty = 0;
  let totalAmount = 0;
  const listRows = rows.map((r) => {
    const details = r.delivery_order_details.map((d) => ({
      orderQty: d.order_qty,
      amount: Number.parseFloat(d.amount ?? "0") || 0,
      productName: productName.get(d.product_id) ?? "",
    }));
    const rowQty = details.reduce((sum, d) => sum + d.orderQty, 0);
    const rowAmount = details.reduce((sum, d) => sum + d.amount, 0);
    totalQty += rowQty;
    totalAmount += rowAmount;
    return {
      id: r.id,
      deliveryOrderNo: r.delivery_order_no,
      dateIssuedIso: r.date_issued.slice(0, 10),
      salesPointName: r.sales_points?.name ?? "",
      customerName:
        r.customer_id != null ? customerName.get(r.customer_id) ?? "" : "",
      productSummary: formatProductSummary(details),
      status: r.status,
      totalQtyLabel: rowQty.toLocaleString(),
      totalAmountXaf:
        rowAmount > 0
          ? `${Math.round(rowAmount).toLocaleString()} XAF`
          : "",
    };
  });

  return {
    rows: listRows,
    totals: {
      count: listRows.length,
      totalQtyLabel: totalQty.toLocaleString(),
      totalAmountXaf:
        totalAmount > 0
          ? `${Math.round(totalAmount).toLocaleString()} XAF`
          : "",
    },
    periodLabel,
  };
}

export async function deleteOrder(payload: { orderId?: string }) {
  const id = String(payload.orderId ?? "").trim();
  if (!id) return { ok: false as const, error: "Order id required." };
  const existing = await prisma.delivery_orders.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, error: "Delivery order not found." };
  if (existing.status === "VALIDATED") {
    return {
      ok: false as const,
      error: "Validated delivery orders cannot be deleted.",
    };
  }
  await prisma.delivery_orders.delete({ where: { id } });
  return { ok: true as const };
}

export async function cancelValidated(
  payload: { orderId?: string; reason?: string },
  userId: string,
) {
  const id = String(payload.orderId ?? "").trim();
  if (!id) return { ok: false as const, error: "Order id required." };
  const existing = await prisma.delivery_orders.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, error: "Delivery order not found." };
  if (existing.status !== "VALIDATED") {
    return {
      ok: false as const,
      error: `Cannot cancel a delivery order in status ${existing.status}.`,
    };
  }
  await prisma.delivery_orders.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelled_at: new Date(),
      cancelled_by_user_id: userId,
      cancel_reason: String(payload.reason ?? "").trim() || null,
    },
  });
  return { ok: true as const };
}

export async function validateMany(
  payload: { orderIds?: string[] },
  userId: string,
) {
  const ids = payload.orderIds ?? [];
  const errors: Array<{ id: string; error: string }> = [];
  let validated = 0;
  for (const id of ids) {
    const existing = await prisma.delivery_orders.findUnique({ where: { id } });
    if (!existing) {
      errors.push({ id, error: "Not found." });
      continue;
    }
    if (existing.status === "VALIDATED") {
      validated += 1;
      continue;
    }
    if (existing.status !== "PENDING") {
      errors.push({ id, error: `Status ${existing.status}` });
      continue;
    }
    await prisma.delivery_orders.update({
      where: { id },
      data: {
        status: "VALIDATED",
        validated_at: new Date(),
        validated_by_user_id: userId,
      },
    });
    validated += 1;
  }
  return { ok: errors.length === 0, validated, errors };
}

export async function previewTaxes(payload: {
  customerId?: number | string;
  dateIssued?: string;
  asOfDate?: string;
}) {
  const customerId = Number(payload.customerId);
  if (!Number.isFinite(customerId)) {
    return { ok: false as const, error: "Customer is required." };
  }
  const asOf = String(payload.dateIssued ?? payload.asOfDate ?? "")
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return { ok: false as const, error: "Date issued must be YYYY-MM-DD." };
  }

  const customer = await prisma.customers.findUnique({
    where: { id: customerId },
    include: {
      tax_regimes: { select: { kind: true } },
      customer_type_definitions: { select: { exempt_from_sales_tax: true } },
    },
  });
  if (!customer) {
    return { ok: false as const, error: "Customer not found." };
  }

  const rates = await getTaxRatesAsOf(asOf);
  return {
    ok: true as const,
    preview: buildDoTaxPreview({
      residency: customer.residency,
      taxRegimeKind: customer.tax_regimes?.kind,
      taxpayerId: customer.taxpayer_id,
      salesTaxExempt: customer.customer_type_definitions?.exempt_from_sales_tax,
      rates,
    }),
  };
}

export async function previewUnitPriceDo(payload: Record<string, unknown>) {
  return previewUnitPrice({
    productId: Number(payload.productId),
    asOfDate: String(payload.dateIssued ?? payload.asOfDate ?? ""),
    customerId:
      payload.customerId == null ? null : Number(payload.customerId),
  });
}

export async function previewStockOnHand(payload: {
  salesPointId?: number;
  productId?: number;
  storageLocationId?: number | null;
}) {
  const salesPointId = Number(payload.salesPointId);
  const productId = Number(payload.productId);
  if (!Number.isFinite(salesPointId) || !Number.isFinite(productId)) {
    return { ok: false as const, error: "Sales point and product required." };
  }
  const storageLocationId =
    payload.storageLocationId == null
      ? null
      : Number(payload.storageLocationId);
  const onHand = await getBalanceQty(
    prisma,
    salesPointId,
    productId,
    Number.isFinite(storageLocationId as number)
      ? (storageLocationId as number)
      : null,
    "SELLABLE",
  );
  return { ok: true as const, onHand: qtyStr(onHand) };
}

export async function transferBalance(_input: unknown) {
  return {
    ok: false as const,
    error: "DO balance transfer is not yet available on the shared API.",
  };
}
