import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { getOpenPostingPeriodForActor } from "./financialYearsService.js";
import {
  assertRouteWrite,
  canPerformAction,
  loadRpcActor,
} from "./rpcActor.js";
import { allocateDocumentSequence } from "./sequences.js";
import { getTaxRatesAsOf } from "./salesRpcExtras.js";

const ROUTE_ID = "delivery-order-transfer";
const MAX_ALLOCATE_RETRIES = 5;

export type TransferDeliveryOrderBalanceInput = {
  userId: string;
  fromDeliveryOrderId?: number | string;
  fromDeliveryOrderNo?: string;
  toSalesPointId: number;
  lines: Array<{ productId: number; qtyKg: number }>;
  notes?: string;
};

export type TransferDeliveryOrderBalanceResult =
  | {
      ok: true;
      transferId: string;
      fromDeliveryOrderId: string;
      fromDeliveryOrderNo: string;
      toDeliveryOrderId: string;
      toDeliveryOrderNo: string;
      toSalesPointName: string;
      lines: Array<{ productId: number; productName: string; qtyKg: number }>;
    }
  | { ok: false; error: string };

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function roundMoney2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function parseMoney(value: string | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatTaxLabelWithPercent(baseLabel: string, rateDecimal: number): string {
  const percent = (rateDecimal * 100).toFixed(2);
  return `${baseLabel} (${percent}%)`;
}

function resolveVatApplies(residency: string | null | undefined): boolean {
  return String(residency ?? "LOCAL").toUpperCase() === "LOCAL";
}

async function liftedQtyForDoProduct(
  deliveryOrderNo: string,
  productId: number,
): Promise<number> {
  const lines = await prisma.sale_lines.findMany({
    where: {
      product_id: productId,
      sales: {
        delivery_order_no: deliveryOrderNo,
        status: { in: ["PENDING", "VALIDATED"] },
        cancelled_at: null,
      },
    },
    select: { qty_kg: true },
  });
  return lines.reduce(
    (sum, line) => sum + (Number.parseFloat(String(line.qty_kg ?? "0")) || 0),
    0,
  );
}

function isUniqueConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "P2002";
}

export async function transferDeliveryOrderBalanceCommand(
  input: TransferDeliveryOrderBalanceInput,
): Promise<TransferDeliveryOrderBalanceResult> {
  if (!input?.userId) {
    return { ok: false, error: "Login required." };
  }

  try {
    const actor = await loadRpcActor(input.userId);
    assertRouteWrite(actor, ROUTE_ID);
    if (!canPerformAction(actor, "transfer_delivery_order_balance")) {
      return {
        ok: false,
        error: "You do not have permission to transfer delivery order balances.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const toSalesPointId = Number(input.toSalesPointId);
  if (!Number.isFinite(toSalesPointId)) {
    return { ok: false, error: "Destination collection point is required." };
  }

  const destination = await prisma.sales_points.findFirst({
    where: { id: toSalesPointId, is_active: true },
    select: { id: true, name: true },
  });
  if (!destination) {
    return {
      ok: false,
      error: "Cannot transfer to an inactive or missing collection point.",
    };
  }

  const fromId =
    input.fromDeliveryOrderId != null &&
    String(input.fromDeliveryOrderId).trim() !== ""
      ? String(input.fromDeliveryOrderId).trim()
      : null;
  const fromNo = String(input.fromDeliveryOrderNo ?? "").trim();

  if (!fromId && !fromNo) {
    return { ok: false, error: "Source delivery order is required." };
  }

  const source = fromId
    ? await prisma.delivery_orders.findUnique({
        where: { id: fromId },
        include: {
          delivery_order_details: { orderBy: { id: "asc" } },
        },
      })
    : await prisma.delivery_orders.findUnique({
        where: { delivery_order_no: fromNo },
        include: {
          delivery_order_details: { orderBy: { id: "asc" } },
        },
      });

  if (!source) {
    return { ok: false, error: "Source delivery order not found." };
  }

  if (source.status !== "VALIDATED" && source.status !== "PARTIALLY_FULFILLED") {
    return {
      ok: false,
      error: "Only validated delivery orders can transfer remaining balance.",
    };
  }

  if (source.sales_point_id === toSalesPointId) {
    return {
      ok: false,
      error: "Destination collection point must be different from the source.",
    };
  }

  if (source.customer_id == null) {
    return { ok: false, error: "Source delivery order has no customer." };
  }

  const requested = new Map<number, number>();
  for (const line of input.lines ?? []) {
    const productId = Number(line.productId);
    const qtyKg = Math.round(Number(line.qtyKg));
    if (!Number.isFinite(productId) || productId <= 0) {
      return { ok: false, error: "Each transfer line needs a product." };
    }
    if (!Number.isFinite(qtyKg) || qtyKg <= 0) {
      continue;
    }
    requested.set(productId, (requested.get(productId) ?? 0) + qtyKg);
  }

  if (requested.size === 0) {
    return {
      ok: false,
      error: "Enter at least one product quantity to transfer.",
    };
  }

  const openPeriod = await getOpenPostingPeriodForActor(input.userId);
  if (!openPeriod) {
    return {
      ok: false,
      error: "Open a financial month before transferring delivery order balance.",
    };
  }

  const today = todayIsoDate();
  const dateIssued =
    today >= openPeriod.startDate && today <= openPeriod.endDate
      ? today
      : openPeriod.endDate;

  const customer = await prisma.customers.findUnique({
    where: { id: source.customer_id },
    include: {
      tax_regimes: { select: { kind: true } },
      customer_type_definitions: {
        select: { exempt_from_sales_tax: true },
      },
    },
  });
  if (!customer) {
    return { ok: false, error: "Customer not found." };
  }

  const rates = await getTaxRatesAsOf(dateIssued);
  const vatApplies = resolveVatApplies(customer.residency);
  const vatRate = vatApplies ? rates.vatRate : 0;
  const hasTaxpayer = String(customer.taxpayer_id ?? "").trim().length > 0;
  const regime = String(customer.tax_regimes?.kind ?? "SIMPLIFIED").toUpperCase();
  const salesTaxExempt =
    customer.customer_type_definitions?.exempt_from_sales_tax === true;
  const otherRate = salesTaxExempt
    ? 0
    : !hasTaxpayer
      ? rates.salesNoTaxpayer
      : regime === "REAL"
        ? rates.salesActual
        : rates.salesSimplified;
  const otherTaxLabel =
    otherRate > 0
      ? formatTaxLabelWithPercent("Sales tax", otherRate)
      : null;

  const notes = input.notes?.trim() || null;
  const orderRef = `Transferred from ${source.delivery_order_no}`;
  const year = openPeriod.financialYear;
  const prefix = `DT-${year}-`;

  type PreparedLine = {
    detailId: bigint;
    productId: number;
    productName: string;
    qtyKg: number;
    orderUnit: string | null;
    unitPrice: string;
    pricingCustomerTypeId: string | null;
    lineSubtotalExTax: string;
    vatRate: string;
    vatAmount: string;
    otherTaxLabel: string | null;
    otherTaxAmount: string;
    amount: string;
    nextOrderQty: number;
  };

  const prepared: PreparedLine[] = [];
  for (const [productId, qtyKg] of requested) {
    const detail = source.delivery_order_details.find(
      (row) => row.product_id === productId,
    );
    if (!detail) {
      return {
        ok: false,
        error: "Product is not on the source delivery order.",
      };
    }

    const product = await prisma.products.findUnique({
      where: { product_id: productId },
      select: { product_name: true },
    });
    const productName = product?.product_name ?? `Product ${productId}`;
    const orderQty = Number(detail.order_qty) || 0;
    const liftedQty = await liftedQtyForDoProduct(
      source.delivery_order_no,
      productId,
    );
    const remaining = Math.max(orderQty - liftedQty, 0);
    if (qtyKg > remaining) {
      return {
        ok: false,
        error: `${productName}: transfer qty (${qtyKg}) exceeds remaining (${remaining}).`,
      };
    }

    const nextOrderQty = orderQty - qtyKg;
    if (nextOrderQty < liftedQty) {
      return {
        ok: false,
        error: `${productName}: cannot reduce below lifted quantity.`,
      };
    }

    const unit = parseMoney(detail.unit_price);
    const lineSubtotal = unit * qtyKg;
    const vatAmount = lineSubtotal * vatRate;
    const otherTaxAmount = lineSubtotal * otherRate;
    const amount = lineSubtotal + vatAmount + otherTaxAmount;

    prepared.push({
      detailId: detail.id,
      productId,
      productName,
      qtyKg,
      orderUnit: detail.order_unit,
      unitPrice: roundMoney2(unit),
      pricingCustomerTypeId: detail.pricing_customer_type_id,
      lineSubtotalExTax: roundMoney2(lineSubtotal),
      vatRate: String(vatRate),
      vatAmount: roundMoney2(vatAmount),
      otherTaxLabel,
      otherTaxAmount: roundMoney2(otherTaxAmount),
      amount: roundMoney2(amount),
      nextOrderQty,
    });
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ALLOCATE_RETRIES; attempt++) {
    try {
      const allocated = await allocateDocumentSequence({
        salesPointId: toSalesPointId,
        documentKind: "DELIVERY_ORDER",
        financialYear: year,
        prefix,
      });
      const toDeliveryOrderId = randomUUID();
      const transferId = randomUUID();
      const stamp = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.delivery_orders.create({
          data: {
            id: toDeliveryOrderId,
            delivery_order_no: allocated.documentNo,
            date_issued: dateIssued,
            customer_id: source.customer_id,
            order_ref: orderRef,
            sales_point_id: toSalesPointId,
            financial_year: openPeriod.financialYear,
            financial_month: openPeriod.calendarMonth,
            posting_calendar_year: openPeriod.financialYear,
            created_by_user_id: input.userId,
            status: "VALIDATED",
            validated_at: stamp,
            validated_by_user_id: input.userId,
            source_kind: "TRANSFER",
            transferred_from_delivery_order_id: source.id,
            destination_pending: false,
          },
        });

        for (const line of prepared) {
          await tx.delivery_order_details.update({
            where: { id: line.detailId },
            data: { order_qty: line.nextOrderQty },
          });
          await tx.delivery_order_details.create({
            data: {
              delivery_order_id: toDeliveryOrderId,
              product_id: line.productId,
              order_qty: line.qtyKg,
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

        if (source.destination_pending) {
          const nextByProduct = new Map(
            prepared.map((line) => [line.productId, line.nextOrderQty]),
          );
          let remainingTotal = 0;
          for (const detail of source.delivery_order_details) {
            const nextQty =
              nextByProduct.get(detail.product_id) ??
              (Number(detail.order_qty) || 0);
            const lifted = await liftedQtyForDoProduct(
              source.delivery_order_no,
              detail.product_id,
            );
            remainingTotal += Math.max(nextQty - lifted, 0);
          }
          if (remainingTotal <= 0) {
            await tx.delivery_orders.update({
              where: { id: source.id },
              data: { destination_pending: false },
            });
          }
        }

        await tx.delivery_order_transfers.create({
          data: {
            id: transferId,
            from_delivery_order_id: source.id,
            to_delivery_order_id: toDeliveryOrderId,
            from_sales_point_id: source.sales_point_id,
            to_sales_point_id: toSalesPointId,
            transferred_at: stamp,
            transferred_by_user_id: input.userId,
            notes,
            delivery_order_transfer_lines: {
              create: prepared.map((line) => ({
                product_id: line.productId,
                qty_kg: line.qtyKg,
              })),
            },
          },
        });
      });

      return {
        ok: true,
        transferId,
        fromDeliveryOrderId: source.id,
        fromDeliveryOrderNo: source.delivery_order_no,
        toDeliveryOrderId,
        toDeliveryOrderNo: allocated.documentNo,
        toSalesPointName: destination.name,
        lines: prepared.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          qtyKg: line.qtyKg,
        })),
      };
    } catch (err) {
      lastError = err;
      if (isUniqueConflict(err)) {
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    error:
      lastError instanceof Error
        ? lastError.message
        : "Could not transfer delivery order balance.",
  };
}
