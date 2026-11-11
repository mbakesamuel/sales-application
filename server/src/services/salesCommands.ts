import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { assertDateInOpenMonth } from "./financialYearsService.js";
import { allocateDocumentSequence } from "./sequences.js";
import { getTaxRatesAsOf } from "./salesRpcExtras.js";
import { applyMovement } from "./stockMovements.js";
import { resolveStockProductId } from "./stockIntakeGrouping.js";
import { resolveSaleLineStorageLocationId } from "./saleStorageLocation.js";
import { assertSaleLinesStockAsOf } from "./saleStockAssert.js";
import {
  assertAction,
  assertRouteWrite,
  loadRpcActor,
} from "./rpcActor.js";
import { getCompanySettings } from "./mastersQueries.js";

const SALES_ROUTE_ID = "sales";
const BOTTLE_OIL_SALES_ROUTE_ID = "bottle-oil-sales";

function saleRouteIdForMode(saleProductMode: string): string {
  return String(saleProductMode).toUpperCase() === "BOTTLE"
    ? BOTTLE_OIL_SALES_ROUTE_ID
    : SALES_ROUTE_ID;
}

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
  financialYear?: number;
  financialMonth?: number;
  postingCalendarYear?: number;
  /** Optional when UI sends customerId / override; required for command-API remote payload. */
  netAmount?: string;
  vatAmount?: string;
  grossAmount?: string;
  vatRateSnapshot?: string;
  taxRegimeId?: string | null;
  customerNameSnapshot?: string;
  validateImmediately?: boolean;
  originDeviceId?: string;
  lines: Array<{
    productId: number;
    qtyKg: string;
    unitPricePerKg: string;
    lineNet?: string;
    lineVat?: string;
    lineGross?: string;
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

function parseMoney(value: string | number | null | undefined): number {
  const n = Number.parseFloat(
    String(value ?? "")
      .replace(/[\s,\u00a0]/g, "")
      .replace(",", "."),
  );
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function formatTaxRateSnapshot(rate: number): string {
  return String(Math.round(rate * 1_000_000) / 1_000_000);
}

/**
 * Server-authoritative sale create: resolve customer snapshot + totals when the
 * thin-client UI omits them, allocate invoice number, persist sale + lines +
 * payments, and deduct stock when validating immediately.
 */
export async function createSaleCommand(
  input: CreateSaleCommandInput,
): Promise<CreateSaleCommandResult> {
  if (!input.userId?.trim()) {
    return { ok: false, error: "Login required." };
  }
  if (!input.salesPointId || !Number.isFinite(Number(input.salesPointId))) {
    return { ok: false, error: "Collection point is required." };
  }
  if (!input.dateIssued?.trim()) {
    return { ok: false, error: "Sale date is required." };
  }
  if (!input.lines?.length) {
    return { ok: false, error: "Add at least one line item." };
  }

  const salesPointId = Number(input.salesPointId);
  const isBottleMode = String(input.saleProductMode ?? "LOOSE").toUpperCase() === "BOTTLE";
  const saleDisposition = String(input.saleDisposition ?? "NORMAL").toUpperCase();
  const isSpecialDisposition =
    saleDisposition === "RATION" || saleDisposition === "PUBLIC_RELATION";

  // Head office (null): central open month. Sales-point user: their own open month.
  let postingScope: number | null = null;
  try {
    const actor = await loadRpcActor(input.userId);
    postingScope = actor.salesPointId == null ? null : actor.salesPointId;
    assertRouteWrite(actor, saleRouteIdForMode(input.saleProductMode ?? "LOOSE"));
    if (input.validateImmediately) {
      assertAction(
        actor,
        "direct_validate_sales",
        "You do not have permission to validate sales directly.",
      );
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Permission denied.",
    };
  }

  const registeredCustomerId =
    input.customerId != null && Number.isFinite(Number(input.customerId))
      ? Number(input.customerId)
      : null;
  const nameOverride = input.customerNameOverride?.trim() || "";
  const snapshotProvided = input.customerNameSnapshot?.trim() || "";

  let customerId: number | null = registeredCustomerId;
  let customerNameSnapshot = snapshotProvided;
  let taxRegimeId: string | null = input.taxRegimeId ?? null;
  let vatApplies = false;
  let vatRate = 0;
  let salesTaxRate = 0;

  if (registeredCustomerId != null) {
    const customer = await prisma.customers.findUnique({
      where: { id: registeredCustomerId },
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
    customerId = customer.id;
    if (!customerNameSnapshot) {
      customerNameSnapshot = customer.name;
    }
    taxRegimeId = customer.tax_regime_id;

    const rates = await getTaxRatesAsOf(input.dateIssued);
    const residency = String(customer.residency ?? "LOCAL").toUpperCase();
    vatApplies = residency === "LOCAL";
    vatRate = vatApplies ? rates.vatRate : 0;
    const hasTaxpayer = String(customer.taxpayer_id ?? "").trim().length > 0;
    const regime = String(customer.tax_regimes?.kind ?? "SIMPLIFIED").toUpperCase();
    salesTaxRate = customer.customer_type_definitions?.exempt_from_sales_tax
      ? 0
      : !hasTaxpayer
        ? rates.salesNoTaxpayer
        : regime === "REAL"
          ? rates.salesActual
          : rates.salesSimplified;
  } else if (nameOverride) {
    customerNameSnapshot = nameOverride;
    customerId = null;
    taxRegimeId = null;
  } else if (!customerNameSnapshot) {
    return {
      ok: false,
      error: "Select a customer or enter the customer name on the invoice.",
    };
  }

  if (isBottleMode || isSpecialDisposition || registeredCustomerId == null) {
    vatApplies = false;
    vatRate = 0;
    salesTaxRate = 0;
  }

  const activeLines = input.lines.filter((line) => {
    if (!Number.isFinite(line.productId)) return false;
    if (isBottleMode) {
      return parseMoney(line.qtyUnits ?? line.qtyKg) > 0;
    }
    return parseMoney(line.qtyKg) > 0;
  });
  if (activeLines.length === 0) {
    return { ok: false, error: "Add at least one line item." };
  }

  let netTotal = 0;
  let vatTotal = 0;
  let salesTaxTotal = 0;
  const computedLines = activeLines.map((line) => {
    if (
      line.lineNet != null &&
      line.lineVat != null &&
      line.lineGross != null &&
      String(line.lineNet).trim() !== ""
    ) {
      const lineNet = parseMoney(line.lineNet);
      const lineVat = parseMoney(line.lineVat);
      const lineGross = parseMoney(line.lineGross);
      netTotal += lineNet;
      vatTotal += lineVat;
      return {
        productId: line.productId,
        qtyKg: String(line.qtyKg),
        unitPricePerKg: String(line.unitPricePerKg),
        lineNet: roundMoney(lineNet),
        lineVat: roundMoney(lineVat),
        lineGross: roundMoney(lineGross),
        qtyUnits: line.qtyUnits ?? null,
        unitPricePerUnit: line.unitPricePerUnit ?? null,
        storageLocationId: line.storageLocationId ?? null,
      };
    }

    if (isBottleMode) {
      const qty = parseMoney(line.qtyUnits ?? line.qtyKg);
      const unitPrice = parseMoney(line.unitPricePerUnit ?? line.unitPricePerKg);
      const lineGross = qty * unitPrice;
      netTotal += lineGross;
      return {
        productId: line.productId,
        qtyKg: roundMoney(qty),
        unitPricePerKg: roundMoney(unitPrice),
        lineNet: roundMoney(lineGross),
        lineVat: "0",
        lineGross: roundMoney(lineGross),
        qtyUnits: roundMoney(qty),
        unitPricePerUnit: roundMoney(unitPrice),
        storageLocationId: line.storageLocationId ?? null,
      };
    }

    const qty = parseMoney(line.qtyKg);
    const unitPrice = parseMoney(line.unitPricePerKg);
    const lineNet = qty * unitPrice;
    const lineVat = vatApplies ? lineNet * vatRate : 0;
    const lineSalesTax = lineNet * salesTaxRate;
    const lineGross = lineNet + lineVat + lineSalesTax;
    netTotal += lineNet;
    vatTotal += lineVat;
    salesTaxTotal += lineSalesTax;
    return {
      productId: line.productId,
      qtyKg: String(line.qtyKg),
      unitPricePerKg: String(line.unitPricePerKg),
      lineNet: roundMoney(lineNet),
      lineVat: roundMoney(lineVat),
      lineGross: roundMoney(lineGross),
      qtyUnits: line.qtyUnits ?? null,
      unitPricePerUnit: line.unitPricePerUnit ?? null,
      storageLocationId: line.storageLocationId ?? null,
    };
  });

  const invoiceNet = Math.round(
    input.netAmount != null && String(input.netAmount).trim() !== ""
      ? parseMoney(input.netAmount)
      : netTotal,
  );
  const invoiceVat = Math.round(
    input.vatAmount != null && String(input.vatAmount).trim() !== ""
      ? parseMoney(input.vatAmount)
      : isBottleMode
        ? 0
        : invoiceNet * (vatApplies ? vatRate : 0),
  );
  const invoiceSalesTax = isBottleMode
    ? 0
    : input.grossAmount != null &&
        String(input.grossAmount).trim() !== "" &&
        input.netAmount != null &&
        input.vatAmount != null
      ? Math.round(
          parseMoney(input.grossAmount) -
            parseMoney(input.netAmount) -
            parseMoney(input.vatAmount),
        )
      : Math.round(invoiceNet * salesTaxRate);
  const invoiceGross = Math.round(
    input.grossAmount != null && String(input.grossAmount).trim() !== ""
      ? parseMoney(input.grossAmount)
      : isBottleMode
        ? invoiceNet
        : invoiceNet + invoiceVat + invoiceSalesTax,
  );

  const paidTotal = Math.round(
    (input.payments ?? []).reduce(
      (sum, payment) => sum + parseMoney(payment.amount),
      0,
    ),
  );
  if (paidTotal !== invoiceGross) {
    return {
      ok: false,
      error: "Paid amount must equal invoice total (no credit sales).",
    };
  }

  try {
    await assertSaleLinesStockAsOf(prisma, {
      salesPointId,
      dateIssued: input.dateIssued.trim().slice(0, 10),
      isBottleMode,
      lines: computedLines.map((line) => ({
        productId: line.productId,
        qtyKg: String(line.qtyKg),
        qtyUnits: line.qtyUnits ?? null,
        storageLocationId: line.storageLocationId ?? null,
      })),
    });
  } catch (stockError) {
    return {
      ok: false,
      error:
        stockError instanceof Error
          ? stockError.message
          : "Could not verify stock.",
    };
  }

  let financialYear: number;
  let financialMonth: number;
  try {
    const period = await assertDateInOpenMonth(
      input.dateIssued.trim().slice(0, 10),
      postingScope,
    );
    financialYear = period.financialYear;
    financialMonth = period.calendarMonth;
  } catch (periodError) {
    return {
      ok: false,
      error:
        periodError instanceof Error
          ? periodError.message
          : "No open posting period. Open a financial month first.",
    };
  }

  try {
    const saleId = randomUUID();
    let invoiceNo = input.invoiceNo?.trim() || "";
    const company = await getCompanySettings();
    const autoGenerateInvoiceNo = company?.autoGenerateSalesInvoiceNo === true;

    if (invoiceNo) {
      const existing = await prisma.sales.findUnique({
        where: { invoice_no: invoiceNo },
        select: { id: true },
      });
      if (existing) {
        return { ok: false, error: `Invoice ${invoiceNo} already exists.` };
      }
    } else if (autoGenerateInvoiceNo) {
      const allocated = await allocateDocumentSequence({
        salesPointId,
        documentKind: "SALES_INVOICE",
        financialYear,
      });
      invoiceNo = allocated.documentNo;
    } else {
      return { ok: false, error: "Invoice number is required." };
    }

    const validateImmediately = Boolean(input.validateImmediately);
    const status = validateImmediately ? "VALIDATED" : "PENDING";
    const now = new Date();
    const dateIssued = input.dateIssued.trim().slice(0, 10);
    // Match Electron: sold_at is the posting/sale date, not wall-clock create time.
    const soldAt = new Date(`${dateIssued}T12:00:00.000Z`);
    const vatRateSnapshot =
      input.vatRateSnapshot?.trim() || formatTaxRateSnapshot(vatRate);

    await prisma.$transaction(async (tx) => {
      await tx.sales.create({
        data: {
          id: saleId,
          invoice_no: invoiceNo,
          sold_at: soldAt,
          customer_id: customerId,
          created_by_user_id: input.userId,
          customer_name_snapshot: customerNameSnapshot,
          tax_regime_id: taxRegimeId,
          vat_rate_snapshot: vatRateSnapshot,
          net_amount: roundMoney(invoiceNet),
          vat_amount: roundMoney(invoiceVat),
          gross_amount: roundMoney(invoiceGross),
          financial_year: financialYear,
          financial_month: financialMonth,
          reference_number: input.referenceNumber?.trim() || null,
          sales_point_id: salesPointId,
          status,
          validated_at: validateImmediately ? now : null,
          validated_by_user_id: validateImmediately ? input.userId : null,
          vehicle_number: input.vehicleNumber?.trim() || "",
          date_issued: dateIssued,
          delivery_order_no: input.deliveryOrderNo?.trim() || null,
          posting_calendar_year: input.postingCalendarYear ?? financialYear,
          sale_product_mode: input.saleProductMode ?? "LOOSE",
          sale_disposition: input.saleDisposition ?? "NORMAL",
          origin_device_id: input.originDeviceId ?? null,
        },
      });

      const resolvedLines: Array<
        (typeof computedLines)[number] & { storageLocationId: number | null }
      > = [];
      for (const line of computedLines) {
        const storageLocationId = isBottleMode
          ? await resolveSaleLineStorageLocationId(tx, {
              salesPointId,
              preferredLocationId: line.storageLocationId,
              isBottleMode: true,
            })
          : (line.storageLocationId ?? null);
        resolvedLines.push({ ...line, storageLocationId });
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
            qty_units: line.qtyUnits,
            unit_price_per_unit: line.unitPricePerUnit,
            storage_location_id: storageLocationId,
          },
        });
      }

      for (const payment of input.payments ?? []) {
        if (!payment.paymentMethodId?.trim()) continue;
        if (parseMoney(payment.amount) <= 0) continue;
        await tx.payments.create({
          data: {
            id: randomUUID(),
            sale_id: saleId,
            amount: roundMoney(parseMoney(payment.amount)),
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

      // Print / reports read taxes from sale_applied_taxes (not from gross alone).
      if (vatApplies && invoiceVat > 0) {
        await tx.sale_applied_taxes.create({
          data: {
            id: randomUUID(),
            sale_id: saleId,
            code_snapshot: "VAT",
            label_snapshot: "VAT",
            rate_snapshot: vatRateSnapshot,
            amount: roundMoney(invoiceVat),
          },
        });
      }
      if (invoiceSalesTax > 0) {
        await tx.sale_applied_taxes.create({
          data: {
            id: randomUUID(),
            sale_id: saleId,
            code_snapshot: "SALES_TAX",
            label_snapshot: "Sales tax",
            rate_snapshot: formatTaxRateSnapshot(salesTaxRate),
            amount: roundMoney(invoiceSalesTax),
          },
        });
      }

      if (validateImmediately) {
        const occurredAt = new Date(`${dateIssued}T12:00:00.000Z`);
        for (const line of resolvedLines) {
          const qty = isBottleMode
            ? String(line.qtyUnits ?? line.qtyKg)
            : String(line.qtyKg);
          if (parseMoney(qty) <= 0) continue;
          const productId = await resolveStockProductId(tx, line.productId);
          await applyMovement(tx, {
            salesPointId,
            productId,
            storageLocationId: line.storageLocationId,
            qty,
            kind: "SALE",
            occurredAt,
            userId: input.userId,
            sourceKind: "SALE",
            sourceId: saleId,
          });
        }
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
