import type {
  CarryForwardBatchResult,
  CarryForwardCommitmentPendingRow,
  CarryForwardCommitmentRow,
  CarryForwardDeleteResult,
  CarryForwardFormOptions,
  CarryForwardMutationResult,
  DeleteCarryForwardInput,
  UpsertCarryForwardBatchInput,
  UpsertCarryForwardInput,
} from "../../shared/carryForward.types.js";
import {
  assertRouteRead,
  assertRouteWrite,
  carryForwardRequiresValidation,
} from "../auth/permissions/service.js";
import { getDatabase } from "../db/index.js";
import { listActiveSalesPoints, requireActiveSalesPoint } from "../salesPoints/active.js";
import { getOpenPostingPeriodForActor } from "../financialYears/service.js";
import { resolveDoLineUnitPrice } from "../pricing/doPricingCustomerType.js";
import { loadTaxRatesAsOf } from "../tax/resolveRates.js";
import {
  formatTaxLabelWithPercent,
  normalizeTaxRateDecimal,
  resolveCustomerTaxProfile,
  SALES_TAX_LABEL,
} from "../../shared/taxRules.js";
import { parseAmount } from "../sales/money.js";
import { validateBookletSerial } from "../../shared/bookletSerial.js";

const ROUTE_ID = "carry-forward-commitments";

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function roundMoney2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function getSoldQtyForDoProduct(deliveryOrderNo: string, productId: number): number {
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(CAST(sl.qtyKg AS REAL)), 0) AS soldQty
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       WHERE s.deliveryOrderNo = ?
         AND sl.productId = ?
         AND s.status IN ('PENDING', 'VALIDATED')`,
    )
    .get(deliveryOrderNo, productId) as { soldQty: number };

  return Number(row.soldQty) || 0;
}

function assertWrite(userId: string): { ok: true } | { ok: false; error: string } {
  const role = getDatabase()
    .prepare(`SELECT role FROM User WHERE id = ?`)
    .get(userId) as { role: string } | undefined;

  if (!role) {
    return { ok: false, error: "User not found." };
  }

  try {
    assertRouteWrite(role.role, ROUTE_ID);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  return { ok: true };
}

function assertRead(userId: string): void {
  const role = getDatabase()
    .prepare(`SELECT role FROM User WHERE id = ? AND isActive = 1`)
    .get(userId) as { role: string } | undefined;

  if (!role) {
    throw new Error("User not found.");
  }

  assertRouteRead(role.role, ROUTE_ID);
}

export function getCarryForwardFormOptions(): CarryForwardFormOptions {
  const db = getDatabase();
  return {
    customers: db
      .prepare(
        `SELECT id, name FROM Customer
         WHERE COALESCE(isPosPlaceholder, 0) = 0
         ORDER BY name ASC`,
      )
      .all() as Array<{ id: number; name: string }>,
    products: db
      .prepare(
        `SELECT p.productId, p.productName
         FROM Product p
         INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
         WHERE COALESCE(pc.isBottled, 0) = 0
           AND COALESCE(p.excludeFromDeliveryOrders, 0) = 0
         ORDER BY p.productName ASC`,
      )
      .all() as Array<{ productId: number; productName: string }>,
    salesPoints: listActiveSalesPoints(db),
  };
}

export function listCarryForwardCommitments(): CarryForwardCommitmentRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT dd.id AS detailId, d.id AS deliveryOrderId, d.deliveryOrderNo,
              d.customerId, c.name AS customerName,
              d.salesPointId, sp.name AS salesPointName,
              dd.productId, p.productName, dd.orderQty,
              d.dateIssued, d.orderRef AS notes, d.sourceDocumentNo
       FROM DeliveryOrder d
       INNER JOIN DeliveryOrderDetails dd ON dd.deliveryOrderId = d.id
       INNER JOIN Customer c ON c.id = d.customerId
       INNER JOIN SalesPoint sp ON sp.id = d.salesPointId
       INNER JOIN Product p ON p.productId = dd.productId
       WHERE d.sourceKind = 'CARRY_FORWARD' AND d.status = 'VALIDATED'
       ORDER BY c.name ASC, sp.name ASC, p.productName ASC, d.deliveryOrderNo ASC`,
    )
    .all() as Array<{
    detailId: number;
    deliveryOrderId: number;
    deliveryOrderNo: string;
    customerId: number;
    customerName: string;
    salesPointId: number;
    salesPointName: string;
    productId: number;
    productName: string;
    orderQty: number;
    dateIssued: string;
    notes: string | null;
    sourceDocumentNo: string | null;
  }>;

  return rows.map((row) => {
    const soldQty = getSoldQtyForDoProduct(row.deliveryOrderNo, row.productId);
    const outstandingQty = Math.max(row.orderQty - soldQty, 0);
    return {
      detailId: row.detailId,
      deliveryOrderId: row.deliveryOrderId,
      deliveryOrderNo: row.deliveryOrderNo,
      customerId: row.customerId,
      customerName: row.customerName,
      salesPointId: row.salesPointId,
      salesPointName: row.salesPointName,
      productId: row.productId,
      productName: row.productName,
      orderQty: row.orderQty,
      soldQty,
      outstandingQty,
      dateIssued: String(row.dateIssued).slice(0, 10),
      notes: row.notes,
      sourceDocumentNo: row.sourceDocumentNo?.trim() || null,
    };
  });
}

export function listCarryForwardCommitmentsPending(
  userId: string,
): CarryForwardCommitmentPendingRow[] {
  assertRead(userId);

  const rows = getDatabase()
    .prepare(
      `SELECT dd.id AS detailId, d.id AS deliveryOrderId, d.deliveryOrderNo,
              d.customerId, c.name AS customerName,
              d.salesPointId, sp.name AS salesPointName,
              dd.productId, p.productName, dd.orderQty,
              d.dateIssued, d.sourceDocumentNo
       FROM DeliveryOrder d
       INNER JOIN DeliveryOrderDetails dd ON dd.deliveryOrderId = d.id
       INNER JOIN Customer c ON c.id = d.customerId
       INNER JOIN SalesPoint sp ON sp.id = d.salesPointId
       INNER JOIN Product p ON p.productId = dd.productId
       WHERE d.sourceKind = 'CARRY_FORWARD'
         AND d.status = 'PENDING'
         AND d.createdByUserId = ?
       ORDER BY d.dateIssued DESC, d.deliveryOrderNo DESC,
                c.name ASC, p.productName ASC`,
    )
    .all(userId) as Array<{
    detailId: number;
    deliveryOrderId: number;
    deliveryOrderNo: string;
    customerId: number;
    customerName: string;
    salesPointId: number;
    salesPointName: string;
    productId: number;
    productName: string;
    orderQty: number;
    dateIssued: string;
    sourceDocumentNo: string | null;
  }>;

  return rows.map((row) => {
    const soldQty = getSoldQtyForDoProduct(row.deliveryOrderNo, row.productId);
    const outstandingQty = Math.max(row.orderQty - soldQty, 0);
    return {
      detailId: row.detailId,
      deliveryOrderId: row.deliveryOrderId,
      deliveryOrderNo: row.deliveryOrderNo,
      customerId: row.customerId,
      customerName: row.customerName,
      salesPointId: row.salesPointId,
      salesPointName: row.salesPointName,
      productId: row.productId,
      productName: row.productName,
      orderQty: row.orderQty,
      outstandingQty,
      dateIssued: String(row.dateIssued).slice(0, 10),
      sourceDocumentNo: row.sourceDocumentNo?.trim() || null,
    };
  });
}

function getCustomerTaxInfo(customerId: number): {
  customerTypeId: string | null;
  residency: string;
  taxpayerId: string | null;
  taxRegimeKind: string | null;
  salesTaxExempt: boolean;
} | null {
  const row = getDatabase()
    .prepare(
      `SELECT c.customerTypeId, c.residency, c.taxpayerId, tr.kind AS taxRegimeKind,
              COALESCE(ct.exemptFromSalesTax, 0) AS exemptFromSalesTax
       FROM Customer c
       LEFT JOIN TaxRegime tr ON tr.id = c.taxRegimeId
       LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
       WHERE c.id = ?`,
    )
    .get(customerId) as
    | {
        customerTypeId: string | null;
        residency: string;
        taxpayerId: string | null;
        taxRegimeKind: string | null;
        exemptFromSalesTax: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    customerTypeId: row.customerTypeId,
    residency: row.residency,
    taxpayerId: row.taxpayerId,
    taxRegimeKind: row.taxRegimeKind,
    salesTaxExempt: row.exemptFromSalesTax === 1,
  };
}

function buildLineAmounts(
  customerId: number,
  productId: number,
  orderQty: number,
  dateIssued: string,
): {
  orderUnit: string | null;
  unitPrice: string;
  pricingCustomerTypeId: string | null;
  lineSubtotalExTax: string;
  vatRate: string;
  vatAmount: string;
  otherTaxLabel: string | null;
  otherTaxAmount: string;
  amount: string;
} {
  const taxInfo = getCustomerTaxInfo(customerId);
  const rates = loadTaxRatesAsOf(dateIssued);
  const profile = resolveCustomerTaxProfile({
    residency: taxInfo?.residency ?? "LOCAL",
    taxpayerId: taxInfo?.taxpayerId ?? null,
    taxRegimeKind: taxInfo?.taxRegimeKind ?? null,
    salesTaxExempt: taxInfo?.salesTaxExempt ?? false,
    rates,
  });
  const vatRate = profile.vatApplies
    ? String(normalizeTaxRateDecimal(rates.vatRate))
    : "0";
  const otherRate = profile.salesTaxRate;
  const priceResult = resolveDoLineUnitPrice({
    productId,
    customerTypeId: taxInfo?.customerTypeId ?? null,
    orderQtyKg: orderQty,
    asOfDate: dateIssued,
    // Carry-forward preserves remaining balance; allow legacy sub-threshold lines.
    blockRetailQuantity: false,
  });
  const unitPrice =
    priceResult.ok ? priceResult.unitPriceExTax : "0";
  const pricingCustomerTypeId = priceResult.ok
    ? priceResult.pricingCustomerTypeId
    : null;
  const unit = parseAmount(unitPrice);
  const lineSubtotal = unit * orderQty;
  const vatAmount = lineSubtotal * parseAmount(vatRate);
  const otherTaxAmount = lineSubtotal * otherRate;
  const amount = lineSubtotal + vatAmount + otherTaxAmount;

  const product = getDatabase()
    .prepare(`SELECT uom FROM Product WHERE productId = ?`)
    .get(productId) as { uom: string | null } | undefined;

  return {
    orderUnit: product?.uom ?? null,
    unitPrice: roundMoney2(unit),
    pricingCustomerTypeId,
    lineSubtotalExTax: roundMoney2(lineSubtotal),
    vatRate,
    vatAmount: roundMoney2(vatAmount),
    otherTaxLabel:
      otherRate > 0
        ? formatTaxLabelWithPercent(SALES_TAX_LABEL, otherRate)
        : null,
    otherTaxAmount: roundMoney2(otherTaxAmount),
    amount: roundMoney2(amount),
  };
}

function assertSourceDocumentAvailable(
  sourceDocumentNo: string,
  excludeDeliveryOrderId: number | null,
): { ok: true } | { ok: false; error: string } {
  const db = getDatabase();
  // Original DO # is also the working deliveryOrderNo — block any existing DO
  // with that number, and any other CF that already claimed it as source.
  const byNumber = db
    .prepare(
      `SELECT id, deliveryOrderNo, sourceKind, sourceDocumentNo FROM DeliveryOrder
       WHERE status IN ('PENDING', 'VALIDATED')
         AND (
           deliveryOrderNo = ?
           OR (sourceKind = 'CARRY_FORWARD' AND sourceDocumentNo = ?)
         )
         AND (? IS NULL OR id != ?)
       LIMIT 1`,
    )
    .get(
      sourceDocumentNo,
      sourceDocumentNo,
      excludeDeliveryOrderId,
      excludeDeliveryOrderId,
    ) as
    | {
        id: number;
        deliveryOrderNo: string;
        sourceKind: string | null;
        sourceDocumentNo: string | null;
      }
    | undefined;

  if (byNumber) {
    if (byNumber.deliveryOrderNo === sourceDocumentNo) {
      return {
        ok: false,
        error: `DO # ${sourceDocumentNo} already exists.`,
      };
    }
    return {
      ok: false,
      error: `Original DO # ${sourceDocumentNo} is already registered on ${byNumber.deliveryOrderNo}.`,
    };
  }
  return { ok: true };
}

export function upsertCarryForwardCommitment(
  input: UpsertCarryForwardInput,
): CarryForwardMutationResult {
  const permission = assertWrite(input.userId);
  if (!permission.ok) {
    return permission;
  }

  const outstandingQty = Math.round(Number(input.outstandingQty));
  if (!Number.isFinite(outstandingQty) || outstandingQty < 0) {
    return { ok: false, error: "Outstanding quantity must be zero or a positive whole number." };
  }

  if (!Number.isFinite(input.customerId) || !Number.isFinite(input.salesPointId)) {
    return { ok: false, error: "Customer and collection point are required." };
  }

  if (!Number.isFinite(input.productId)) {
    return { ok: false, error: "Product is required." };
  }

  const detailId =
    input.detailId != null && Number.isFinite(input.detailId)
      ? Number(input.detailId)
      : null;

  let sourceDocumentNo: string | null = null;
  if (outstandingQty > 0) {
    const serial = validateBookletSerial(input.sourceDocumentNo);
    if (!serial.ok) {
      return {
        ok: false,
        error: `Original DO #: ${serial.error}`,
      };
    }
    sourceDocumentNo = serial.serial;
  } else if (input.sourceDocumentNo?.trim()) {
    const serial = validateBookletSerial(input.sourceDocumentNo);
    if (!serial.ok) {
      return {
        ok: false,
        error: `Original DO #: ${serial.error}`,
      };
    }
    sourceDocumentNo = serial.serial;
  }

  const db = getDatabase();
  const customer = db
    .prepare(`SELECT id FROM Customer WHERE id = ?`)
    .get(input.customerId) as { id: number } | undefined;
  if (!customer) {
    return { ok: false, error: "Customer not found." };
  }

  const salesPointCheck = requireActiveSalesPoint(db, input.salesPointId);
  if (!salesPointCheck.ok) {
    return { ok: false, error: salesPointCheck.error };
  }

  const product = db
    .prepare(
      `SELECT p.productId, p.productName,
              COALESCE(pc.isBottled, 0) AS isBottled,
              COALESCE(p.excludeFromDeliveryOrders, 0) AS excludeFromDeliveryOrders
       FROM Product p
       INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE p.productId = ?`,
    )
    .get(input.productId) as
    | {
        productId: number;
        productName: string;
        isBottled: number;
        excludeFromDeliveryOrders: number;
      }
    | undefined;
  if (!product) {
    return { ok: false, error: "Product not found." };
  }
  if (product.isBottled === 1) {
    return {
      ok: false,
      error: `${product.productName} is bottled. Carry-forward commitments are for loose products only.`,
    };
  }
  if (product.excludeFromDeliveryOrders === 1) {
    return {
      ok: false,
      error: `${product.productName} is excluded from delivery orders.`,
    };
  }

  const openPeriod = getOpenPostingPeriodForActor(input.userId);
  if (!openPeriod) {
    return {
      ok: false,
      error: "Open a financial month before posting carry-forward commitments.",
    };
  }

  // Prefer today when it falls in the open month; otherwise stamp on month end.
  const today = todayIsoDate();
  const dateIssued =
    today >= openPeriod.startDate && today <= openPeriod.endDate
      ? today
      : openPeriod.endDate;
  const postingPeriod = openPeriod;

  const notes = input.notes?.trim() || "Carry-forward commitment";
  const requiresValidation = carryForwardRequiresValidation(input.userId);

  try {
    const result = db.transaction(() => {
      const markOrderPending = (orderId: number) => {
        if (!requiresValidation) {
          return;
        }
        db.prepare(
          `UPDATE DeliveryOrder
           SET status = 'PENDING', validatedAt = NULL, validatedByUserId = NULL
           WHERE id = ?`,
        ).run(orderId);
      };

      let order: { id: number; deliveryOrderNo: string; status: string } | undefined;
      let existingLine: { id: number; orderQty: number } | undefined;

      if (detailId != null) {
        const existing = db
          .prepare(
            `SELECT dd.id AS detailId, dd.productId, dd.orderQty,
                    d.id AS deliveryOrderId, d.deliveryOrderNo, d.status,
                    d.sourceKind, d.customerId, d.salesPointId
             FROM DeliveryOrderDetails dd
             INNER JOIN DeliveryOrder d ON d.id = dd.deliveryOrderId
             WHERE dd.id = ?`,
          )
          .get(detailId) as
          | {
              detailId: number;
              productId: number;
              orderQty: number;
              deliveryOrderId: number;
              deliveryOrderNo: string;
              status: string;
              sourceKind: string;
              customerId: number;
              salesPointId: number;
            }
          | undefined;

        if (!existing || existing.sourceKind !== "CARRY_FORWARD") {
          return { ok: false as const, error: "Carry-forward line not found." };
        }
        if (existing.productId !== input.productId) {
          return {
            ok: false as const,
            error: "Product does not match the selected carry-forward line.",
          };
        }
        if (existing.salesPointId !== input.salesPointId) {
          return {
            ok: false as const,
            error: "Collection point does not match the selected carry-forward line.",
          };
        }
        if (existing.customerId !== input.customerId) {
          return {
            ok: false as const,
            error: "Customer does not match the selected carry-forward line.",
          };
        }

        order = {
          id: existing.deliveryOrderId,
          deliveryOrderNo: existing.deliveryOrderNo,
          status: existing.status,
        };
        existingLine = { id: existing.detailId, orderQty: existing.orderQty };
      }

      if (sourceDocumentNo) {
        const available = assertSourceDocumentAvailable(
          sourceDocumentNo,
          order?.id ?? null,
        );
        if (!available.ok) {
          return available;
        }
      }

      if (!order) {
        if (outstandingQty === 0) {
          return {
            ok: false as const,
            error: "Nothing to save for zero outstanding.",
          };
        }
        if (!sourceDocumentNo) {
          return {
            ok: false as const,
            error: "Original DO # is required.",
          };
        }

        // Keep the paper/original DO # as the working delivery order number.
        const deliveryOrderNo = sourceDocumentNo;
        const stamp = nowIso();
        if (requiresValidation) {
          const insert = db
            .prepare(
              `INSERT INTO DeliveryOrder (
                deliveryOrderNo, dateIssued, customerId, orderRef, salesPointId,
                financialYear, financialMonth, postingCalendarYear, createdByUserId,
                status, sourceKind, sourceDocumentNo
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'CARRY_FORWARD', ?)`,
            )
            .run(
              deliveryOrderNo,
              dateIssued,
              input.customerId,
              notes,
              input.salesPointId,
              postingPeriod.financialYear,
              postingPeriod.calendarMonth,
              postingPeriod.financialYear,
              input.userId,
              sourceDocumentNo,
            );
          order = {
            id: Number(insert.lastInsertRowid),
            deliveryOrderNo,
            status: "PENDING",
          };
        } else {
          const insert = db
            .prepare(
              `INSERT INTO DeliveryOrder (
                deliveryOrderNo, dateIssued, customerId, orderRef, salesPointId,
                financialYear, financialMonth, postingCalendarYear, createdByUserId,
                status, validatedAt, validatedByUserId, sourceKind, sourceDocumentNo
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALIDATED', ?, ?, 'CARRY_FORWARD', ?)`,
            )
            .run(
              deliveryOrderNo,
              dateIssued,
              input.customerId,
              notes,
              input.salesPointId,
              postingPeriod.financialYear,
              postingPeriod.calendarMonth,
              postingPeriod.financialYear,
              input.userId,
              stamp,
              input.userId,
              sourceDocumentNo,
            );
          order = {
            id: Number(insert.lastInsertRowid),
            deliveryOrderNo,
            status: "VALIDATED",
          };
        }
      } else {
        db.prepare(
          `UPDATE DeliveryOrder
           SET orderRef = ?,
               sourceDocumentNo = COALESCE(?, sourceDocumentNo)
           WHERE id = ?`,
        ).run(notes, sourceDocumentNo, order.id);
      }

      const soldQty = getSoldQtyForDoProduct(order.deliveryOrderNo, input.productId);
      const orderQty = soldQty + outstandingQty;

      if (outstandingQty === 0 && soldQty === 0 && existingLine) {
        db.prepare(`DELETE FROM DeliveryOrderDetails WHERE id = ?`).run(existingLine.id);
        const remaining = db
          .prepare(
            `SELECT COUNT(*) AS count FROM DeliveryOrderDetails WHERE deliveryOrderId = ?`,
          )
          .get(order.id) as { count: number };
        if (remaining.count === 0) {
          db.prepare(
            `DELETE FROM DeliveryOrderPaymentDetails WHERE deliveryOrderId = ?`,
          ).run(order.id);
          db.prepare(`DELETE FROM DeliveryOrder WHERE id = ?`).run(order.id);
        }
        return {
          ok: true as const,
          deliveryOrderNo: order.deliveryOrderNo,
          detailId: existingLine.id,
          pendingValidation: requiresValidation,
        };
      }

      if (outstandingQty === 0 && soldQty === 0 && !existingLine) {
        return { ok: false as const, error: "Nothing to save for zero outstanding." };
      }

      if (outstandingQty > 0 && !sourceDocumentNo) {
        const current = db
          .prepare(`SELECT sourceDocumentNo FROM DeliveryOrder WHERE id = ?`)
          .get(order.id) as { sourceDocumentNo: string | null } | undefined;
        if (!current?.sourceDocumentNo?.trim()) {
          return {
            ok: false as const,
            error: "Original DO # is required.",
          };
        }
      }

      const amounts = buildLineAmounts(
        input.customerId,
        input.productId,
        orderQty,
        dateIssued,
      );

      if (existingLine) {
        db.prepare(
          `UPDATE DeliveryOrderDetails
           SET orderQty = ?, orderUnit = ?, unitPrice = ?, pricingCustomerTypeId = ?,
               lineSubtotalExTax = ?,
               vatRate = ?, vatAmount = ?, otherTaxLabel = ?, otherTaxAmount = ?, amount = ?
           WHERE id = ?`,
        ).run(
          orderQty,
          amounts.orderUnit,
          amounts.unitPrice,
          amounts.pricingCustomerTypeId,
          amounts.lineSubtotalExTax,
          amounts.vatRate,
          amounts.vatAmount,
          amounts.otherTaxLabel,
          amounts.otherTaxAmount,
          amounts.amount,
          existingLine.id,
        );
        markOrderPending(order.id);
        return {
          ok: true as const,
          deliveryOrderNo: order.deliveryOrderNo,
          detailId: existingLine.id,
          pendingValidation: requiresValidation,
        };
      }

      const insertLine = db
        .prepare(
          `INSERT INTO DeliveryOrderDetails (
            deliveryOrderId, productId, orderQty, orderUnit, unitPrice,
            pricingCustomerTypeId,
            lineSubtotalExTax, vatRate, vatAmount, otherTaxLabel, otherTaxAmount, amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          order.id,
          input.productId,
          orderQty,
          amounts.orderUnit,
          amounts.unitPrice,
          amounts.pricingCustomerTypeId,
          amounts.lineSubtotalExTax,
          amounts.vatRate,
          amounts.vatAmount,
          amounts.otherTaxLabel,
          amounts.otherTaxAmount,
          amounts.amount,
        );

      markOrderPending(order.id);
      return {
        ok: true as const,
        deliveryOrderNo: order.deliveryOrderNo,
        detailId: Number(insertLine.lastInsertRowid),
        pendingValidation: requiresValidation,
      };
    })();

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save carry-forward commitment.";
    if (/UNIQUE|constraint/i.test(message)) {
      return {
        ok: false,
        error: "Original DO # is already registered on another carry-forward commitment.",
      };
    }
    return { ok: false, error: message };
  }
}

export function deleteCarryForwardCommitment(
  input: DeleteCarryForwardInput,
): CarryForwardDeleteResult {
  const permission = assertWrite(input.userId);
  if (!permission.ok) {
    return permission;
  }

  const db = getDatabase();
  const line = db
    .prepare(
      `SELECT dd.id, dd.productId, d.id AS deliveryOrderId, d.deliveryOrderNo, d.sourceKind
       FROM DeliveryOrderDetails dd
       INNER JOIN DeliveryOrder d ON d.id = dd.deliveryOrderId
       WHERE dd.id = ?`,
    )
    .get(input.detailId) as
    | {
        id: number;
        productId: number;
        deliveryOrderId: number;
        deliveryOrderNo: string;
        sourceKind: string;
      }
    | undefined;

  if (!line || line.sourceKind !== "CARRY_FORWARD") {
    return { ok: false, error: "Carry-forward line not found." };
  }

  const soldQty = getSoldQtyForDoProduct(line.deliveryOrderNo, line.productId);
  if (soldQty > 0) {
    return {
      ok: false,
      error: `Cannot delete: ${Math.round(soldQty)} kg already sold against ${line.deliveryOrderNo}. Set outstanding to 0 instead.`,
    };
  }

  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM DeliveryOrderDetails WHERE id = ?`).run(line.id);
      const remaining = db
        .prepare(
          `SELECT COUNT(*) AS count FROM DeliveryOrderDetails WHERE deliveryOrderId = ?`,
        )
        .get(line.deliveryOrderId) as { count: number };
      if (remaining.count === 0) {
        db.prepare(`DELETE FROM DeliveryOrderPaymentDetails WHERE deliveryOrderId = ?`).run(
          line.deliveryOrderId,
        );
        db.prepare(`DELETE FROM DeliveryOrder WHERE id = ?`).run(line.deliveryOrderId);
      }
    })();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not delete carry-forward commitment.",
    };
  }
}

export function upsertCarryForwardBatch(
  input: UpsertCarryForwardBatchInput,
): CarryForwardBatchResult {
  const permission = assertWrite(input.userId);
  if (!permission.ok) {
    return permission;
  }

  if (!Number.isFinite(input.salesPointId) || !Number.isFinite(input.productId)) {
    return { ok: false, error: "Collection point and product are required." };
  }

  const prepared: Array<{
    customerId: number;
    outstandingQty: number;
    sourceDocumentNo: string;
    detailId: number | null;
  }> = [];
  const seenSourceNos = new Set<string>();

  for (const line of input.lines) {
    if (line == null || !Number.isFinite(line.customerId)) {
      continue;
    }
    if (
      line.outstandingQty === null ||
      line.outstandingQty === undefined ||
      Number.isNaN(Number(line.outstandingQty))
    ) {
      continue;
    }
    const outstandingQty = Math.round(Number(line.outstandingQty));
    if (!Number.isFinite(outstandingQty) || outstandingQty < 0) {
      return {
        ok: false,
        error: "Outstanding quantity must be zero or a positive whole number.",
      };
    }

    const detailId =
      line.detailId != null && Number.isFinite(line.detailId)
        ? Number(line.detailId)
        : null;

    if (outstandingQty === 0 && detailId == null) {
      continue;
    }

    let sourceDocumentNo = "";
    if (outstandingQty > 0 || String(line.sourceDocumentNo ?? "").trim()) {
      const serial = validateBookletSerial(line.sourceDocumentNo);
      if (!serial.ok) {
        return { ok: false, error: `Original DO #: ${serial.error}` };
      }
      sourceDocumentNo = serial.serial;
      if (seenSourceNos.has(sourceDocumentNo)) {
        return {
          ok: false,
          error: `Original DO # ${sourceDocumentNo} is duplicated in this batch.`,
        };
      }
      seenSourceNos.add(sourceDocumentNo);
    } else if (outstandingQty > 0) {
      return { ok: false, error: "Original DO # is required for each line." };
    }

    prepared.push({
      customerId: line.customerId,
      outstandingQty,
      sourceDocumentNo,
      detailId,
    });
  }

  if (prepared.length === 0) {
    return { ok: false, error: "Enter at least one outstanding quantity." };
  }

  const db = getDatabase();
  try {
    const saved = db.transaction(() => {
      let count = 0;
      for (const line of prepared) {
        const result = upsertCarryForwardCommitment({
          userId: input.userId,
          customerId: line.customerId,
          salesPointId: input.salesPointId,
          productId: input.productId,
          outstandingQty: line.outstandingQty,
          sourceDocumentNo: line.sourceDocumentNo || null,
          detailId: line.detailId,
          notes: input.notes,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        count += 1;
      }
      return count;
    })();

    return { ok: true, saved, pendingValidation: carryForwardRequiresValidation(input.userId) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not save carry-forward batch.",
    };
  }
}
