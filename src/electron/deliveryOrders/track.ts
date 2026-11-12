import type { DeliveryOrderTrackPayload } from "../../shared/deliveryOrders.types.js";
import { loadReportSignatory } from "../reports/companySettings.js";
import { getDatabase } from "../db/index.js";
import { parseAmount, trimQty } from "../sales/money.js";

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

function normalizeSourceKind(
  value: string,
): DeliveryOrderTrackPayload["order"]["sourceKind"] {
  if (value === "CARRY_FORWARD") {
    return "CARRY_FORWARD";
  }
  if (value === "TRANSFER") {
    return "TRANSFER";
  }
  return "NORMAL";
}

export function trackDeliveryOrderByNo(
  rawNo: string,
): DeliveryOrderTrackPayload | null {
  const deliveryOrderNo = rawNo.trim();
  if (!deliveryOrderNo) {
    return null;
  }

  const db = getDatabase();
  const order = db
    .prepare(
      `SELECT d.id, d.deliveryOrderNo, d.status, d.dateIssued, d.orderRef,
              d.customerId, d.salesPointId,
              COALESCE(d.sourceKind, 'NORMAL') AS sourceKind,
              COALESCE(d.destinationPending, 0) AS destinationPending,
              d.transferredFromDeliveryOrderId,
              d.commercialServiceNameSnapshot,
              c.name AS customerName,
              sp.name AS salesPointName
       FROM DeliveryOrder d
       INNER JOIN Customer c ON c.id = d.customerId
       INNER JOIN SalesPoint sp ON sp.id = d.salesPointId
       WHERE d.deliveryOrderNo = ?`,
    )
    .get(deliveryOrderNo) as
    | {
        id: number;
        deliveryOrderNo: string;
        status: string;
        dateIssued: string;
        orderRef: string | null;
        customerId: number;
        salesPointId: number;
        sourceKind: string;
        destinationPending: number;
        transferredFromDeliveryOrderId: number | null;
        commercialServiceNameSnapshot: string | null;
        customerName: string;
        salesPointName: string;
      }
    | undefined;

  if (!order) {
    return null;
  }

  let transferredFromDeliveryOrderNo: string | null = null;
  if (order.transferredFromDeliveryOrderId != null) {
    const source = db
      .prepare(`SELECT deliveryOrderNo FROM DeliveryOrder WHERE id = ?`)
      .get(order.transferredFromDeliveryOrderId) as
      | { deliveryOrderNo: string }
      | undefined;
    transferredFromDeliveryOrderNo = source?.deliveryOrderNo ?? null;
  }

  const detailRows = db
    .prepare(
      `SELECT dd.productId, p.productName, dd.orderQty
       FROM DeliveryOrderDetails dd
       INNER JOIN Product p ON p.productId = dd.productId
       WHERE dd.deliveryOrderId = ?
       ORDER BY p.productName ASC, dd.id ASC`,
    )
    .all(order.id) as Array<{
    productId: number;
    productName: string;
    orderQty: number;
  }>;

  let orderedTotal = 0;
  let liftedTotal = 0;
  const products = detailRows.map((detail) => {
    const orderQty = Number(detail.orderQty) || 0;
    const liftedQty = getLiftedQtyForDoProduct(
      order.deliveryOrderNo,
      detail.productId,
    );
    const remainingQty = Math.max(orderQty - liftedQty, 0);
    const liftedPercent =
      orderQty > 0 ? Math.round((liftedQty / orderQty) * 1000) / 10 : 0;

    orderedTotal += orderQty;
    liftedTotal += liftedQty;

    return {
      productId: detail.productId,
      productName: detail.productName,
      orderQty: trimQty(orderQty),
      liftedQty: trimQty(liftedQty),
      remainingQty: trimQty(remainingQty),
      liftedPercent: String(liftedPercent),
    };
  });

  const remainingTotal = Math.max(orderedTotal - liftedTotal, 0);

  const saleRows = db
    .prepare(
      `SELECT s.id AS saleId, s.invoiceNo, s.dateIssued, s.status,
              s.customerNameSnapshot AS customerName
       FROM Sale s
       WHERE s.deliveryOrderNo = ?
         AND s.status IN ('PENDING', 'VALIDATED')
       ORDER BY s.dateIssued DESC, s.invoiceNo DESC`,
    )
    .all(order.deliveryOrderNo) as Array<{
    saleId: string;
    invoiceNo: string;
    dateIssued: string;
    status: string;
    customerName: string;
  }>;

  const lifts = saleRows.map((sale) => {
    const lines = db
      .prepare(
        `SELECT sl.productId, p.productName, sl.qtyKg, sl.unitPricePerKg, sl.lineNet
         FROM SaleLine sl
         INNER JOIN Product p ON p.productId = sl.productId
         WHERE sl.saleId = ?
         ORDER BY p.productName ASC, sl.id ASC`,
      )
      .all(sale.saleId) as Array<{
      productId: number;
      productName: string;
      qtyKg: string;
      unitPricePerKg: string;
      lineNet: string;
    }>;

    return {
      saleId: sale.saleId,
      invoiceNo: sale.invoiceNo,
      dateIssued: String(sale.dateIssued).slice(0, 10),
      status: sale.status as DeliveryOrderTrackPayload["lifts"][number]["status"],
      customerName: sale.customerName,
      lines: lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        qtyKg: trimQty(parseAmount(line.qtyKg)),
        unitPricePerKg: String(line.unitPricePerKg ?? "0"),
        lineNet: String(line.lineNet ?? "0"),
      })),
    };
  });

  const transferRows = db
    .prepare(
      `SELECT t.id AS transferId, t.transferredAt,
              dest.deliveryOrderNo AS toDeliveryOrderNo,
              sp.name AS toSalesPointName
       FROM DeliveryOrderTransfer t
       INNER JOIN DeliveryOrder dest ON dest.id = t.toDeliveryOrderId
       INNER JOIN SalesPoint sp ON sp.id = t.toSalesPointId
       WHERE t.fromDeliveryOrderId = ?
       ORDER BY t.transferredAt DESC, t.id DESC`,
    )
    .all(order.id) as Array<{
    transferId: number;
    transferredAt: string;
    toDeliveryOrderNo: string;
    toSalesPointName: string;
  }>;

  const transfersOut = transferRows.map((transfer) => {
    const lines = db
      .prepare(
        `SELECT tl.productId, p.productName, tl.qtyKg
         FROM DeliveryOrderTransferLine tl
         INNER JOIN Product p ON p.productId = tl.productId
         WHERE tl.transferId = ?
         ORDER BY p.productName ASC, tl.id ASC`,
      )
      .all(transfer.transferId) as Array<{
      productId: number;
      productName: string;
      qtyKg: number;
    }>;

    return {
      transferId: transfer.transferId,
      toDeliveryOrderNo: transfer.toDeliveryOrderNo,
      toSalesPointName: transfer.toSalesPointName,
      transferredAt: String(transfer.transferredAt).slice(0, 19),
      lines: lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        qtyKg: trimQty(Number(line.qtyKg) || 0),
      })),
    };
  });

  const settings = db
    .prepare(
      `SELECT companyName, department FROM CompanySettings WHERE id = 'default'`,
    )
    .get() as { companyName: string; department: string | null } | undefined;
  const signatory = loadReportSignatory(String(order.dateIssued).slice(0, 10));

  return {
    companyName: settings?.companyName ?? "Sales Electron",
    department: settings?.department ?? null,
    serviceName: order.commercialServiceNameSnapshot ?? null,
    signatoryName: signatory.name,
    signatoryTitle: signatory.title,
    order: {
      id: order.id,
      deliveryOrderNo: order.deliveryOrderNo,
      status: order.status as DeliveryOrderTrackPayload["order"]["status"],
      sourceKind: normalizeSourceKind(order.sourceKind),
      dateIssued: String(order.dateIssued).slice(0, 10),
      orderRef: order.orderRef,
      customerId: order.customerId,
      customerName: order.customerName,
      salesPointId: order.salesPointId,
      salesPointName: order.salesPointName,
      destinationPending: order.destinationPending === 1,
      transferredFromDeliveryOrderNo,
    },
    totals: {
      orderedKg: trimQty(orderedTotal),
      liftedKg: trimQty(liftedTotal),
      remainingKg: trimQty(remainingTotal),
    },
    products,
    lifts,
    transfersOut,
  };
}
