import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { allocateDocumentSequence } from "./sequences.js";

export type CreateSaleCommandInput = {
  userId: string;
  invoiceNo?: string;
  customerId?: number | null;
  customerNameOverride?: string;
  salesPointId: number;
  vehicleNumber?: string;
  dateIssued: string;
  referenceNumber?: string;
  deliveryOrderNo?: string;
  saleProductMode?: string;
  saleDisposition?: string;
  financialYear: number;
  financialMonth: number;
  postingCalendarYear?: number;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  vatRateSnapshot?: string;
  taxRegimeId?: string | null;
  customerNameSnapshot: string;
  validateImmediately?: boolean;
  originDeviceId?: string;
  lines: Array<{
    productId: number;
    qtyKg: string;
    unitPricePerKg: string;
    lineNet: string;
    lineVat: string;
    lineGross: string;
    qtyUnits?: string | null;
    unitPricePerUnit?: string | null;
    storageLocationId?: number | null;
  }>;
  payments: Array<{
    paymentMethodId: string;
    amount: string;
    chequeNo?: string | null;
    bank?: string | null;
    traiteNo?: string | null;
    traiteIssuedOn?: string | null;
    traiteMaturityOn?: string | null;
    paidAt?: string | null;
  }>;
};

export type CreateSaleCommandResult =
  | { ok: true; saleId: string; invoiceNo: string }
  | { ok: false; error: string };

/**
 * Server-authoritative sale create: allocate invoice number (unless provided),
 * persist sale + lines + payments in one transaction.
 * Stock deduction / full tax engine can deepen in later passes; uniqueness is enforced here.
 */
export async function createSaleCommand(
  input: CreateSaleCommandInput,
): Promise<CreateSaleCommandResult> {
  if (!input.salesPointId || !Number.isFinite(input.salesPointId)) {
    return { ok: false, error: "Collection point is required." };
  }
  if (!input.dateIssued?.trim()) {
    return { ok: false, error: "Sale date is required." };
  }
  if (!input.lines?.length) {
    return { ok: false, error: "Add at least one line item." };
  }
  if (!input.customerNameSnapshot?.trim()) {
    return { ok: false, error: "Customer name is required." };
  }

  try {
    const saleId = randomUUID();
    let invoiceNo = input.invoiceNo?.trim() || "";

    if (invoiceNo) {
      const existing = await prisma.sales.findUnique({
        where: { invoice_no: invoiceNo },
        select: { id: true },
      });
      if (existing) {
        return { ok: false, error: `Invoice ${invoiceNo} already exists.` };
      }
    } else {
      const allocated = await allocateDocumentSequence({
        salesPointId: input.salesPointId,
        documentKind: "SALES_INVOICE",
        financialYear: input.financialYear,
      });
      invoiceNo = allocated.documentNo;
    }

    const status = input.validateImmediately ? "VALIDATED" : "PENDING";
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.sales.create({
        data: {
          id: saleId,
          invoice_no: invoiceNo,
          sold_at: now,
          customer_id: input.customerId ?? null,
          created_by_user_id: input.userId,
          customer_name_snapshot: input.customerNameSnapshot.trim(),
          tax_regime_id: input.taxRegimeId ?? null,
          vat_rate_snapshot: input.vatRateSnapshot ?? "0",
          net_amount: input.netAmount,
          vat_amount: input.vatAmount,
          gross_amount: input.grossAmount,
          financial_year: input.financialYear,
          financial_month: input.financialMonth,
          reference_number: input.referenceNumber?.trim() || null,
          sales_point_id: input.salesPointId,
          status,
          validated_at: input.validateImmediately ? now : null,
          validated_by_user_id: input.validateImmediately ? input.userId : null,
          vehicle_number: input.vehicleNumber?.trim() || "",
          date_issued: input.dateIssued.trim().slice(0, 10),
          delivery_order_no: input.deliveryOrderNo?.trim() || null,
          posting_calendar_year:
            input.postingCalendarYear ?? input.financialYear,
          sale_product_mode: input.saleProductMode ?? "LOOSE",
          sale_disposition: input.saleDisposition ?? "NORMAL",
          origin_device_id: input.originDeviceId ?? null,
        },
      });

      for (const line of input.lines) {
        await tx.sale_lines.create({
          data: {
            id: randomUUID(),
            sale_id: saleId,
            product_id: line.productId,
            qty_kg: line.qtyKg,
            unit_price_per_kg: line.unitPricePerKg,
            line_net: line.lineNet,
            line_vat: line.lineVat,
            line_gross: line.lineGross,
            qty_units: line.qtyUnits ?? null,
            unit_price_per_unit: line.unitPricePerUnit ?? null,
            storage_location_id: line.storageLocationId ?? null,
          },
        });
      }

      for (const payment of input.payments) {
        if (!payment.paymentMethodId?.trim()) continue;
        await tx.payments.create({
          data: {
            id: randomUUID(),
            sale_id: saleId,
            amount: payment.amount,
            cheque_no: payment.chequeNo ?? null,
            bank: payment.bank ?? null,
            traite_no: payment.traiteNo ?? null,
            traite_issued_on: payment.traiteIssuedOn ?? null,
            traite_maturity_on: payment.traiteMaturityOn ?? null,
            payment_method_id: payment.paymentMethodId,
            paid_at: payment.paidAt ? new Date(payment.paidAt) : now,
          },
        });
      }
    });

    return { ok: true, saleId, invoiceNo };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create sale.";
    if (/unique|duplicate/i.test(message)) {
      return { ok: false, error: "Invoice number already in use." };
    }
    return { ok: false, error: message };
  }
}
