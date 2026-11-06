import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getOpenPostingPeriod } from "./financialYearsService.js";
import { allocateDocumentSequence } from "./sequences.js";
import { getTaxRatesAsOf } from "./salesRpcExtras.js";

const DO_RETAIL_WHOLESALE_THRESHOLD_KG = 3000;

function isIndustryCustomerType(
  code: string | null | undefined,
  name: string | null | undefined,
): boolean {
  return `${code ?? ""} ${name ?? ""}`.toUpperCase().includes("INDUSTR");
}

function classifyDoPricingKind(input: {
  isIndustryCustomer: boolean;
  orderQtyKg: number;
}): "INDUSTRY" | "WHOLESALE" | "RETAIL" {
  if (input.isIndustryCustomer) return "INDUSTRY";
  if (input.orderQtyKg >= DO_RETAIL_WHOLESALE_THRESHOLD_KG) return "WHOLESALE";
  return "RETAIL";
}

function retailQuantityBlockedOnDoMessage(): string {
  return (
    `Delivery orders are for Industry and Wholesale only ` +
    `(Wholesale requires at least ${DO_RETAIL_WHOLESALE_THRESHOLD_KG} kg). ` +
    `Use a Retail sale invoice for quantities below ${DO_RETAIL_WHOLESALE_THRESHOLD_KG} kg.`
  );
}

export type DeliveryOrderLineInput = {
  productId: number;
  orderQty: number;
  orderUnit?: string | null;
  unitPrice?: string | null;
  amount?: string | null;
};

export type DeliveryOrderPaymentInput = {
  paymentMethodId: string;
  paymentDate: string;
  chequeNo?: string | null;
  bank?: string | null;
  cashReceiptNo?: string | null;
  receiptDate?: string | null;
  traiteNo?: string | null;
  traiteIssuedOn?: string | null;
  traiteMaturityOn?: string | null;
};

export type CreateDeliveryOrderCommandInput = {
  userId: string;
  deliveryOrderNo?: string;
  dateIssued: string;
  customerId?: number | null;
  orderRef?: string | null;
  salesPointId: number;
  financialYear?: number;
  financialMonth?: number;
  postingCalendarYear?: number;
  sourceKind?: string;
  originDeviceId?: string;
  lines: DeliveryOrderLineInput[];
  payments?: DeliveryOrderPaymentInput[];
};

export type UpdateDeliveryOrderCommandInput = CreateDeliveryOrderCommandInput & {
  id: string;
};

export type DeliveryOrderCommandResult =
  | { ok: true; deliveryOrderId: string; deliveryOrderNo: string }
  | { ok: false; error: string };

type PricedLine = {
  productId: number;
  orderQty: number;
  orderUnit: string | null;
  unitPrice: string;
  pricingCustomerTypeId: string | null;
  lineSubtotalExTax: string;
  vatRate: string;
  vatAmount: string;
  otherTaxLabel: string | null;
  otherTaxAmount: string;
  amount: string;
};

const MAX_ALLOCATE_RETRIES = 5;

function isUniqueConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code === "P2002") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /unique|duplicate/i.test(message);
}

function parseMoney(value: string | number | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

async function resolvePostingPeriod(input: {
  financialYear?: number;
  financialMonth?: number;
}): Promise<
  | { ok: true; financialYear: number; financialMonth: number }
  | { ok: false; error: string }
> {
  const yearOk = Number.isFinite(input.financialYear);
  const monthOk = Number.isFinite(input.financialMonth);
  if (yearOk && monthOk) {
    return {
      ok: true,
      financialYear: Number(input.financialYear),
      financialMonth: Number(input.financialMonth),
    };
  }

  const period = await getOpenPostingPeriod();
  if (!period) {
    return {
      ok: false,
      error: "No open posting period. Open a financial month first.",
    };
  }

  return {
    ok: true,
    financialYear: yearOk ? Number(input.financialYear) : period.financialYear,
    financialMonth: monthOk
      ? Number(input.financialMonth)
      : period.calendarMonth,
  };
}

function validateLines(
  lines: DeliveryOrderLineInput[] | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!lines?.length) {
    return { ok: false, error: "Add at least one line." };
  }
  for (const line of lines) {
    if (!Number.isFinite(line.productId) || line.productId <= 0) {
      return { ok: false, error: "Each line needs a product." };
    }
    if (!Number.isFinite(line.orderQty) || line.orderQty <= 0) {
      return { ok: false, error: "Each line quantity must be greater than zero." };
    }
  }
  return { ok: true };
}

async function findCustomerTypeIdByKind(
  kind: "INDUSTRY" | "WHOLESALE" | "RETAIL",
): Promise<string | null> {
  const needle =
    kind === "INDUSTRY"
      ? "INDUSTR"
      : kind === "WHOLESALE"
        ? "WHOLESALE"
        : "RETAIL";
  const rows = await prisma.customer_type_definitions.findMany({
    where: { is_active: true },
    orderBy: { sort_order: "asc" },
  });
  const hit = rows.find((row) =>
    `${row.code} ${row.name}`.toUpperCase().includes(needle),
  );
  return hit?.id ?? null;
}

async function resolveUnitPriceExTax(input: {
  productId: number;
  pricingCustomerTypeId: string | null;
  asOfDate: string;
  fallbackUnitPrice?: string | null;
}): Promise<
  | { ok: true; unitPriceExTax: string; pricingCustomerTypeId: string | null }
  | { ok: false; error: string }
> {
  const asOf = input.asOfDate.slice(0, 10);
  const schedules = await prisma.product_unit_price_schedules.findMany({
    where: {
      product_id: input.productId,
      ...(asOf ? { effective_from: { lte: asOf } } : {}),
    },
    orderBy: { effective_from: "desc" },
  });

  const typed = input.pricingCustomerTypeId
    ? schedules.find((s) => s.customer_type_id === input.pricingCustomerTypeId)
    : null;
  const generic = schedules.find((s) => s.customer_type_id == null);
  const hit = typed ?? generic ?? null;
  if (hit) {
    return {
      ok: true,
      unitPriceExTax: hit.unit_price_ex_tax,
      pricingCustomerTypeId: hit.customer_type_id,
    };
  }

  const fallback = parseMoney(input.fallbackUnitPrice);
  if (fallback > 0) {
    return {
      ok: true,
      unitPriceExTax: roundMoney2(fallback),
      pricingCustomerTypeId: input.pricingCustomerTypeId,
    };
  }

  return { ok: false, error: "No unit price schedule found." };
}

async function preparePricedLines(input: {
  customerId?: number | null;
  dateIssued: string;
  lines: DeliveryOrderLineInput[];
}): Promise<{ ok: true; lines: PricedLine[] } | { ok: false; error: string }> {
  const dateIssued = input.dateIssued.trim().slice(0, 10);
  if (!input.customerId || !Number.isFinite(input.customerId)) {
    return { ok: false, error: "Select a customer." };
  }

  const customer = await prisma.customers.findUnique({
    where: { id: Number(input.customerId) },
    include: {
      tax_regimes: { select: { kind: true } },
      customer_type_definitions: {
        select: {
          id: true,
          code: true,
          name: true,
          exempt_from_sales_tax: true,
        },
      },
    },
  });
  if (!customer) {
    return { ok: false, error: "Customer not found." };
  }

  const rates = await getTaxRatesAsOf(dateIssued);
  const vatApplies =
    String(customer.residency ?? "LOCAL").toUpperCase() === "LOCAL";
  const vatRate = vatApplies ? rates.vatRate : 0;
  const hasTaxpayer = String(customer.taxpayer_id ?? "").trim().length > 0;
  const regime = String(customer.tax_regimes?.kind ?? "SIMPLIFIED").toUpperCase();
  const salesTaxRate = customer.customer_type_definitions?.exempt_from_sales_tax
    ? 0
    : !hasTaxpayer
      ? rates.salesNoTaxpayer
      : regime === "REAL"
        ? rates.salesActual
        : rates.salesSimplified;
  const otherTaxLabel =
    salesTaxRate > 0
      ? `Sales tax (${(salesTaxRate * 100).toFixed(2)}%)`
      : null;

  const customerType = customer.customer_type_definitions;
  const isIndustry = isIndustryCustomerType(
    customerType?.code,
    customerType?.name,
  );
  const blockRetailQuantity = true;

  const priced: PricedLine[] = [];
  for (const line of input.lines) {
    const product = await prisma.products.findUnique({
      where: { product_id: line.productId },
      include: { product_cats: { select: { is_bottled: true } } },
    });
    if (!product) {
      return { ok: false, error: "Product not found." };
    }
    if (product.exclude_from_delivery_orders) {
      return {
        ok: false,
        error: `${product.product_name} is excluded from delivery orders.`,
      };
    }
    if (product.product_cats?.is_bottled) {
      return {
        ok: false,
        error: `${product.product_name} is bottled. Delivery orders are for loose products only.`,
      };
    }

    const pricingKind = classifyDoPricingKind({
      isIndustryCustomer: isIndustry,
      orderQtyKg: line.orderQty,
    });
    if (blockRetailQuantity && !isIndustry && pricingKind === "RETAIL") {
      return { ok: false, error: retailQuantityBlockedOnDoMessage() };
    }

    const pricingCustomerTypeId = await findCustomerTypeIdByKind(pricingKind);
    const resolved = await resolveUnitPriceExTax({
      productId: line.productId,
      pricingCustomerTypeId,
      asOfDate: dateIssued,
      fallbackUnitPrice: line.unitPrice,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        error: `${product.product_name}: ${resolved.error}`,
      };
    }

    const unit = parseMoney(resolved.unitPriceExTax);
    if (unit <= 0) {
      return {
        ok: false,
        error: `${product.product_name}: unit price must be greater than zero.`,
      };
    }

    const lineNet = line.orderQty * unit;
    const vatAmount = lineNet * vatRate;
    const otherTaxAmount = lineNet * salesTaxRate;
    const amount = lineNet + vatAmount + otherTaxAmount;

    priced.push({
      productId: line.productId,
      orderQty: line.orderQty,
      orderUnit: line.orderUnit?.trim() || "kg",
      unitPrice: roundMoney2(unit),
      pricingCustomerTypeId: resolved.pricingCustomerTypeId,
      lineSubtotalExTax: roundMoney2(lineNet),
      vatRate: String(vatRate),
      vatAmount: roundMoney2(vatAmount),
      otherTaxLabel,
      otherTaxAmount: roundMoney2(otherTaxAmount),
      amount: roundMoney2(amount),
    });
  }

  return { ok: true, lines: priced };
}

async function replaceLinesAndPayments(
  tx: Prisma.TransactionClient,
  deliveryOrderId: string,
  lines: PricedLine[],
  payments: DeliveryOrderPaymentInput[] | undefined,
) {
  await tx.delivery_order_details.deleteMany({
    where: { delivery_order_id: deliveryOrderId },
  });
  await tx.delivery_order_payment_details.deleteMany({
    where: { delivery_order_id: deliveryOrderId },
  });

  for (const line of lines) {
    await tx.delivery_order_details.create({
      data: {
        delivery_order_id: deliveryOrderId,
        product_id: line.productId,
        order_qty: line.orderQty,
        order_unit: line.orderUnit,
        unit_price: line.unitPrice,
        pricing_customer_type_id: line.pricingCustomerTypeId,
        line_subtotal_ex_tax: line.lineSubtotalExTax,
        vat_rate: line.vatRate,
        vat_amount: line.vatAmount,
        other_tax_label: line.otherTaxLabel,
        other_tax_amount: line.otherTaxAmount,
        amount: line.amount,
      },
    });
  }

  for (const payment of payments ?? []) {
    if (!payment.paymentMethodId?.trim()) continue;
    await tx.delivery_order_payment_details.create({
      data: {
        delivery_order_id: deliveryOrderId,
        payment_method_id: payment.paymentMethodId.trim(),
        payment_date: String(payment.paymentDate ?? "").slice(0, 10),
        cheque_no: payment.chequeNo ?? null,
        bank: payment.bank ?? null,
        cash_receipt_no: payment.cashReceiptNo ?? null,
        receipt_date: payment.receiptDate
          ? String(payment.receiptDate).slice(0, 10)
          : null,
        traite_no: payment.traiteNo ?? null,
        traite_issued_on: payment.traiteIssuedOn
          ? String(payment.traiteIssuedOn).slice(0, 10)
          : null,
        traite_maturity_on: payment.traiteMaturityOn
          ? String(payment.traiteMaturityOn).slice(0, 10)
          : null,
      },
    });
  }
}

export async function createDeliveryOrderCommand(
  input: CreateDeliveryOrderCommandInput,
): Promise<DeliveryOrderCommandResult> {
  if (!input.salesPointId || !Number.isFinite(input.salesPointId)) {
    return { ok: false, error: "Collection point is required." };
  }
  if (!input.dateIssued?.trim()) {
    return { ok: false, error: "Date issued is required." };
  }
  const linesCheck = validateLines(input.lines);
  if (!linesCheck.ok) return linesCheck;

  const priced = await preparePricedLines({
    customerId: input.customerId,
    dateIssued: input.dateIssued,
    lines: input.lines,
  });
  if (!priced.ok) return priced;

  const period = await resolvePostingPeriod(input);
  if (!period.ok) return period;

  const providedNo = input.deliveryOrderNo?.trim() || "";
  if (providedNo) {
    const existing = await prisma.delivery_orders.findUnique({
      where: { delivery_order_no: providedNo },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        error: `Delivery order ${providedNo} already exists.`,
      };
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ALLOCATE_RETRIES; attempt++) {
    try {
      const deliveryOrderId = randomUUID();
      let deliveryOrderNo = providedNo;

      if (!deliveryOrderNo) {
        const allocated = await allocateDocumentSequence({
          salesPointId: input.salesPointId,
          documentKind: "DELIVERY_ORDER",
          financialYear: period.financialYear,
        });
        deliveryOrderNo = allocated.documentNo;
      }

      await prisma.$transaction(async (tx) => {
        await tx.delivery_orders.create({
          data: {
            id: deliveryOrderId,
            delivery_order_no: deliveryOrderNo,
            date_issued: input.dateIssued.trim().slice(0, 10),
            customer_id: input.customerId ?? null,
            order_ref: input.orderRef ?? null,
            sales_point_id: input.salesPointId,
            financial_year: period.financialYear,
            financial_month: period.financialMonth,
            created_by_user_id: input.userId,
            status: "PENDING",
            posting_calendar_year:
              input.postingCalendarYear ?? period.financialYear,
            source_kind: input.sourceKind ?? "NORMAL",
            origin_device_id: input.originDeviceId ?? null,
          },
        });

        await replaceLinesAndPayments(
          tx,
          deliveryOrderId,
          priced.lines,
          input.payments,
        );
      });

      return { ok: true, deliveryOrderId, deliveryOrderNo };
    } catch (err) {
      lastError = err;
      if (!providedNo && isUniqueConflict(err)) {
        continue;
      }
      break;
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : "Failed to create delivery order.";
  if (isUniqueConflict(lastError)) {
    return {
      ok: false,
      error: providedNo
        ? "Delivery order number already in use."
        : "Could not allocate a unique delivery order number. Try again.",
    };
  }
  return { ok: false, error: message };
}

export async function updateDeliveryOrderCommand(
  input: UpdateDeliveryOrderCommandInput,
): Promise<DeliveryOrderCommandResult> {
  const id = String(input.id ?? "").trim();
  if (!id) {
    return { ok: false, error: "Delivery order id is required." };
  }
  if (!input.salesPointId || !Number.isFinite(input.salesPointId)) {
    return { ok: false, error: "Collection point is required." };
  }
  if (!input.dateIssued?.trim()) {
    return { ok: false, error: "Date issued is required." };
  }
  const linesCheck = validateLines(input.lines);
  if (!linesCheck.ok) return linesCheck;

  const existing = await prisma.delivery_orders.findUnique({
    where: { id },
    select: { id: true, status: true, delivery_order_no: true },
  });
  if (!existing) {
    return { ok: false, error: "Delivery order not found." };
  }
  if (existing.status === "VALIDATED") {
    return { ok: false, error: "Validated delivery orders cannot be edited." };
  }
  if (existing.status !== "PENDING") {
    return {
      ok: false,
      error: `Cannot edit a delivery order in status ${existing.status}.`,
    };
  }

  const priced = await preparePricedLines({
    customerId: input.customerId,
    dateIssued: input.dateIssued,
    lines: input.lines,
  });
  if (!priced.ok) return priced;

  const period = await resolvePostingPeriod(input);
  if (!period.ok) return period;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.delivery_orders.update({
        where: { id },
        data: {
          date_issued: input.dateIssued.trim().slice(0, 10),
          customer_id: input.customerId ?? null,
          order_ref: input.orderRef ?? null,
          sales_point_id: input.salesPointId,
          financial_year: period.financialYear,
          financial_month: period.financialMonth,
          posting_calendar_year:
            input.postingCalendarYear ?? period.financialYear,
        },
      });

      await replaceLinesAndPayments(tx, id, priced.lines, input.payments);
    });

    return {
      ok: true,
      deliveryOrderId: existing.id,
      deliveryOrderNo: existing.delivery_order_no,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update delivery order.";
    return { ok: false, error: message };
  }
}
