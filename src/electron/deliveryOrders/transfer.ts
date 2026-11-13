import type {
  TransferDeliveryOrderBalanceInput,
  TransferDeliveryOrderBalanceResult,
} from "../../shared/deliveryOrders.types.js";
import {
  formatTaxLabelWithPercent,
  normalizeTaxRateDecimal,
  resolveCustomerTaxProfile,
  SALES_TAX_LABEL,
} from "../../shared/taxRules.js";
import {
  assertRouteWrite,
  canPerformAction,
} from "../auth/permissions/service.js";
import { getDatabase } from "../db/index.js";
import { requireActiveSalesPoint } from "../salesPoints/active.js";
import { getOpenPostingPeriodForActor } from "../financialYears/service.js";
import { parseAmount } from "../sales/money.js";
import { loadTaxRatesAsOf } from "../tax/resolveRates.js";
import { allocateTransferDeliveryOrderNo } from "./doNo.js";

const ROUTE_ID = "delivery-order-transfer";

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function roundMoney2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function getLiftedQtyForDoProduct(
  deliveryOrderNo: string,
  productId: number,
): number {
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(CAST(sl.qtyKg AS REAL)), 0) AS liftedQty
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       WHERE s.deliveryOrderNo = ?
         AND sl.productId = ?
         AND s.status IN ('PENDING', 'VALIDATED')`,
    )
    .get(deliveryOrderNo, productId) as { liftedQty: number };

  return Number(row.liftedQty) || 0;
}

function getCustomerTaxInfo(customerId: number): {
  residency: string;
  taxpayerId: string | null;
  taxRegimeKind: string | null;
  salesTaxExempt: boolean;
} | null {
  const row = getDatabase()
    .prepare(
      `SELECT c.residency, c.taxpayerId, tr.kind AS taxRegimeKind,
              COALESCE(ct.exemptFromSalesTax, 0) AS exemptFromSalesTax
       FROM Customer c
       LEFT JOIN TaxRegime tr ON tr.id = c.taxRegimeId
       LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
       WHERE c.id = ?`,
    )
    .get(customerId) as
    | {
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
    residency: row.residency,
    taxpayerId: row.taxpayerId,
    taxRegimeKind: row.taxRegimeKind,
    salesTaxExempt: row.exemptFromSalesTax === 1,
  };
}

export function transferDeliveryOrderBalance(
  input: TransferDeliveryOrderBalanceInput,
): TransferDeliveryOrderBalanceResult {
  if (!input?.userId) {
    return { ok: false, error: "Login required." };
  }

  const db = getDatabase();
  const user = db
    .prepare(`SELECT role FROM User WHERE id = ?`)
    .get(input.userId) as { role: string } | undefined;

  if (!user) {
    return { ok: false, error: "User not found." };
  }

  try {
    assertRouteWrite(user.role, ROUTE_ID);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  if (!canPerformAction(user.role, "transfer_delivery_order_balance")) {
    return {
      ok: false,
      error: "You do not have permission to transfer delivery order balances.",
    };
  }

  const toSalesPointId = Number(input.toSalesPointId);
  if (!Number.isFinite(toSalesPointId)) {
    return { ok: false, error: "Destination collection point is required." };
  }

  const destinationCheck = requireActiveSalesPoint(db, toSalesPointId, {
    inactiveError:
      "Cannot transfer to an inactive collection point.",
  });
  if (!destinationCheck.ok) {
    return { ok: false, error: destinationCheck.error };
  }
  const destination = {
    id: destinationCheck.id,
    name: destinationCheck.name,
  };

  const sourceKey =
    typeof input.fromDeliveryOrderId === "number" &&
    Number.isFinite(input.fromDeliveryOrderId)
      ? { kind: "id" as const, value: input.fromDeliveryOrderId }
      : {
          kind: "no" as const,
          value: String(input.fromDeliveryOrderNo ?? "").trim(),
        };

  if (sourceKey.kind === "no" && !sourceKey.value) {
    return { ok: false, error: "Source delivery order is required." };
  }

  const source = (
    sourceKey.kind === "id"
      ? db
          .prepare(
            `SELECT id, deliveryOrderNo, status, customerId, salesPointId,
                    COALESCE(sourceKind, 'NORMAL') AS sourceKind,
                    COALESCE(destinationPending, 0) AS destinationPending
             FROM DeliveryOrder WHERE id = ?`,
          )
          .get(sourceKey.value)
      : db
          .prepare(
            `SELECT id, deliveryOrderNo, status, customerId, salesPointId,
                    COALESCE(sourceKind, 'NORMAL') AS sourceKind,
                    COALESCE(destinationPending, 0) AS destinationPending
             FROM DeliveryOrder WHERE deliveryOrderNo = ?`,
          )
          .get(sourceKey.value)
  ) as
    | {
        id: number;
        deliveryOrderNo: string;
        status: string;
        customerId: number;
        salesPointId: number;
        sourceKind: string;
        destinationPending: number;
      }
    | undefined;

  if (!source) {
    return { ok: false, error: "Source delivery order not found." };
  }

  if (source.status !== "VALIDATED") {
    return {
      ok: false,
      error: "Only validated delivery orders can transfer remaining balance.",
    };
  }

  if (source.salesPointId === toSalesPointId) {
    return {
      ok: false,
      error: "Destination collection point must be different from the source.",
    };
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

  const openPeriod = getOpenPostingPeriodForActor(input.userId);
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

  const taxInfo = getCustomerTaxInfo(source.customerId);
  if (!taxInfo) {
    return { ok: false, error: "Customer not found." };
  }

  const rates = loadTaxRatesAsOf(dateIssued);
  const profile = resolveCustomerTaxProfile({
    residency: taxInfo.residency,
    taxpayerId: taxInfo.taxpayerId,
    taxRegimeKind: taxInfo.taxRegimeKind,
    salesTaxExempt: taxInfo.salesTaxExempt,
    rates,
  });
  const vatRate = profile.vatApplies
    ? normalizeTaxRateDecimal(rates.vatRate)
    : 0;
  const otherRate = profile.salesTaxRate;
  const otherTaxLabel =
    otherRate > 0
      ? formatTaxLabelWithPercent(SALES_TAX_LABEL, otherRate)
      : null;

  const notes = input.notes?.trim() || null;
  const orderRef = `Transferred from ${source.deliveryOrderNo}`;

  try {
    const result = db.transaction(() => {
      const prepared: Array<{
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
        detailId: number;
        currentOrderQty: number;
      }> = [];

      for (const [productId, qtyKg] of requested) {
        const detail = db
          .prepare(
            `SELECT dd.id, dd.orderQty, dd.orderUnit, dd.unitPrice,
                    dd.pricingCustomerTypeId, p.productName
             FROM DeliveryOrderDetails dd
             INNER JOIN Product p ON p.productId = dd.productId
             WHERE dd.deliveryOrderId = ? AND dd.productId = ?
             ORDER BY dd.id ASC
             LIMIT 1`,
          )
          .get(source.id, productId) as
          | {
              id: number;
              orderQty: number;
              orderUnit: string | null;
              unitPrice: string | null;
              pricingCustomerTypeId: string | null;
              productName: string;
            }
          | undefined;

        if (!detail) {
          throw new Error(`Product is not on the source delivery order.`);
        }

        const orderQty = Number(detail.orderQty) || 0;
        const liftedQty = getLiftedQtyForDoProduct(
          source.deliveryOrderNo,
          productId,
        );
        const remaining = Math.max(orderQty - liftedQty, 0);
        if (qtyKg > remaining) {
          throw new Error(
            `${detail.productName}: transfer qty (${qtyKg}) exceeds remaining (${remaining}).`,
          );
        }

        const nextOrderQty = orderQty - qtyKg;
        if (nextOrderQty < liftedQty) {
          throw new Error(
            `${detail.productName}: cannot reduce below lifted quantity.`,
          );
        }

        const unit = parseAmount(String(detail.unitPrice ?? "0"));
        const lineSubtotal = unit * qtyKg;
        const vatAmount = lineSubtotal * vatRate;
        const otherTaxAmount = lineSubtotal * otherRate;
        const amount = lineSubtotal + vatAmount + otherTaxAmount;

        prepared.push({
          productId,
          productName: detail.productName,
          qtyKg,
          orderUnit: detail.orderUnit,
          unitPrice: roundMoney2(unit),
          pricingCustomerTypeId: detail.pricingCustomerTypeId,
          lineSubtotalExTax: roundMoney2(lineSubtotal),
          vatRate: String(normalizeTaxRateDecimal(vatRate)),
          vatAmount: roundMoney2(vatAmount),
          otherTaxLabel,
          otherTaxAmount: roundMoney2(otherTaxAmount),
          amount: roundMoney2(amount),
          detailId: detail.id,
          currentOrderQty: orderQty,
        });
      }

      const stamp = nowIso();
      const deliveryOrderNo = allocateTransferDeliveryOrderNo(db);
      const insertOrder = db
        .prepare(
          `INSERT INTO DeliveryOrder (
            deliveryOrderNo, dateIssued, customerId, orderRef, salesPointId,
            financialYear, financialMonth, postingCalendarYear, createdByUserId,
            status, validatedAt, validatedByUserId, sourceKind,
            transferredFromDeliveryOrderId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALIDATED', ?, ?, 'TRANSFER', ?)`,
        )
        .run(
          deliveryOrderNo,
          dateIssued,
          source.customerId,
          orderRef,
          toSalesPointId,
          openPeriod.financialYear,
          openPeriod.calendarMonth,
          openPeriod.financialYear,
          input.userId,
          stamp,
          input.userId,
          source.id,
        );

      const toDeliveryOrderId = Number(insertOrder.lastInsertRowid);

      const insertLine = db.prepare(
        `INSERT INTO DeliveryOrderDetails (
          deliveryOrderId, productId, orderQty, orderUnit, unitPrice,
          pricingCustomerTypeId,
          lineSubtotalExTax, vatRate, vatAmount, otherTaxLabel, otherTaxAmount, amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const updateSource = db.prepare(
        `UPDATE DeliveryOrderDetails SET orderQty = ? WHERE id = ?`,
      );

      for (const line of prepared) {
        updateSource.run(line.currentOrderQty - line.qtyKg, line.detailId);
        insertLine.run(
          toDeliveryOrderId,
          line.productId,
          line.qtyKg,
          line.orderUnit,
          line.unitPrice,
          line.pricingCustomerTypeId,
          line.lineSubtotalExTax,
          line.vatRate,
          line.vatAmount,
          line.otherTaxLabel,
          line.otherTaxAmount,
          line.amount,
        );
      }

      // Directed child is always fulfillment-ready (not destination-pending).
      // Clear the holding flag when no transferable remaining qty is left.
      if (source.destinationPending === 1) {
        const remainingRows = db
          .prepare(
            `SELECT dd.productId, dd.orderQty
             FROM DeliveryOrderDetails dd
             WHERE dd.deliveryOrderId = ?`,
          )
          .all(source.id) as Array<{ productId: number; orderQty: number }>;
        let remainingTotal = 0;
        for (const row of remainingRows) {
          const lifted = getLiftedQtyForDoProduct(
            source.deliveryOrderNo,
            row.productId,
          );
          remainingTotal += Math.max((Number(row.orderQty) || 0) - lifted, 0);
        }
        if (remainingTotal <= 0) {
          db.prepare(
            `UPDATE DeliveryOrder SET destinationPending = 0 WHERE id = ?`,
          ).run(source.id);
        }
      }

      const transferInsert = db
        .prepare(
          `INSERT INTO DeliveryOrderTransfer (
            fromDeliveryOrderId, toDeliveryOrderId, fromSalesPointId, toSalesPointId,
            transferredAt, transferredByUserId, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          source.id,
          toDeliveryOrderId,
          source.salesPointId,
          toSalesPointId,
          stamp,
          input.userId,
          notes,
        );

      const transferId = Number(transferInsert.lastInsertRowid);
      const insertTransferLine = db.prepare(
        `INSERT INTO DeliveryOrderTransferLine (transferId, productId, qtyKg)
         VALUES (?, ?, ?)`,
      );
      for (const line of prepared) {
        insertTransferLine.run(transferId, line.productId, line.qtyKg);
      }

      return {
        transferId,
        fromDeliveryOrderId: source.id,
        fromDeliveryOrderNo: source.deliveryOrderNo,
        toDeliveryOrderId,
        toDeliveryOrderNo: deliveryOrderNo,
        toSalesPointName: destination.name,
        lines: prepared.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          qtyKg: line.qtyKg,
        })),
      };
    })();

    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not transfer delivery order balance.",
    };
  }
}
