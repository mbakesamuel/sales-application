import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import { ReportHeader } from "../reports/ReportHeader.tsx";
import { ReportFooter } from "../reports/ReportFooter.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import type { DeliveryOrderTrackPayload } from "./types.ts";
import "../reports/StockCommitmentReport.css";
import "./DeliveryOrderPrintView.css";

interface DeliveryOrderTrackingPrintViewProps {
  payload: DeliveryOrderTrackPayload;
  onClose: () => void;
}

function sourceKindLabel(kind: string): string {
  if (kind === "CARRY_FORWARD") {
    return "Carry-forward";
  }
  if (kind === "TRANSFER") {
    return "Transfer";
  }
  return "Normal";
}

function formatQty(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return amount.toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function formatMoney(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return Math.round(amount).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function totalLiftedPercent(orderedKg: string, liftedKg: string): string {
  const ordered = Number.parseFloat(orderedKg);
  const lifted = Number.parseFloat(liftedKg);
  if (!Number.isFinite(ordered) || ordered <= 0) {
    return "0%";
  }
  return `${Math.round((lifted / ordered) * 1000) / 10}%`;
}

export function DeliveryOrderTrackingPrintView({
  payload,
  onClose,
}: DeliveryOrderTrackingPrintViewProps) {
  const { order, totals, products, lifts, transfersOut } = payload;
  const shellTitle = `Delivery Order Tracking #${order.deliveryOrderNo}`;
  const pdfFileName = `delivery-order-tracking-${order.deliveryOrderNo}.pdf`;

  return (
    <ReportOverlayShell preview title={shellTitle} onClose={onClose}>
      <DocumentPreview
        title={shellTitle}
        fileName={pdfFileName}
        sourceKey={payload}
      >
        <article class="scr-document do-print-document">
          <ReportHeader
            companyName={payload.companyName}
            department={payload.department}
            serviceName={payload.serviceName}
            title="DELIVERY ORDER TRACKING REPORT"
          />

          <section class="do-print-meta-grid">
            <div class="do-print-meta-col">
              <p>
                <span class="do-print-label">Delivery Order #:</span>{" "}
                <strong>{order.deliveryOrderNo}</strong>
              </p>
              <p>
                <span class="do-print-label">Order Date:</span>{" "}
                {formatDisplayDate(order.dateIssued)}
              </p>
              {order.orderRef ? (
                <p>
                  <span class="do-print-label">Customer Ref:</span>{" "}
                  {order.orderRef}
                </p>
              ) : null}
              {order.transferredFromDeliveryOrderNo ? (
                <p>
                  <span class="do-print-label">Transferred from:</span>{" "}
                  {order.transferredFromDeliveryOrderNo}
                </p>
              ) : null}
            </div>
            <div class="do-print-meta-col">
              <p>
                <span class="do-print-label">Customer:</span>{" "}
                <strong>{order.customerName}</strong>
              </p>
              <p>
                <span class="do-print-label">Collection Point:</span>{" "}
                {order.salesPointName}
              </p>
              <p>
                <span class="do-print-label">Status:</span> {order.status}
              </p>
              <p>
                <span class="do-print-label">Source:</span>{" "}
                {sourceKindLabel(order.sourceKind)}
              </p>
            </div>
          </section>

          <section class="do-print-info-grid">
            <div class="do-print-info-block">
              <div class="do-print-info-heading">Totals</div>
              <div class="do-print-info-body">
                <p>
                  <span class="do-print-label">Ordered:</span>{" "}
                  {formatQty(totals.orderedKg)} kg
                </p>
                <p>
                  <span class="do-print-label">Lifted:</span>{" "}
                  {formatQty(totals.liftedKg)} kg
                </p>
                <p>
                  <span class="do-print-label">Remaining:</span>{" "}
                  {formatQty(totals.remainingKg)} kg
                </p>
              </div>
            </div>
            <div class="do-print-info-block">
              <div class="do-print-info-heading">Progress</div>
              <div class="do-print-info-body">
                <p>
                  <span class="do-print-label">% Lifted:</span>{" "}
                  {totalLiftedPercent(totals.orderedKg, totals.liftedKg)}
                </p>
                <p>
                  <span class="do-print-label">Lift invoices:</span>{" "}
                  {lifts.length}
                </p>
                <p>
                  <span class="do-print-label">Transfers out:</span>{" "}
                  {(transfersOut ?? []).length}
                </p>
              </div>
            </div>
          </section>

          <h3 class="do-track-print-section-title">Commitment by product</h3>
          <table class="do-print-table">
            <thead>
              <tr>
                <th>Product</th>
                <th class="do-print-num">Ordered (kg)</th>
                <th class="do-print-num">Lifted (kg)</th>
                <th class="do-print-num">Remaining (kg)</th>
                <th class="do-print-num">% Lifted</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={5} class="do-print-muted">
                    No product lines on this delivery order.
                  </td>
                </tr>
              ) : (
                products.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td class="do-print-num">{formatQty(row.orderQty)}</td>
                    <td class="do-print-num">{formatQty(row.liftedQty)}</td>
                    <td class="do-print-num">{formatQty(row.remainingQty)}</td>
                    <td class="do-print-num">{row.liftedPercent}%</td>
                  </tr>
                ))
              )}
            </tbody>
            {products.length > 0 ? (
              <tfoot>
                <tr class="do-print-totals-row">
                  <td class="do-print-totals-label">Total</td>
                  <td class="do-print-num">
                    <strong>{formatQty(totals.orderedKg)}</strong>
                  </td>
                  <td class="do-print-num">
                    <strong>{formatQty(totals.liftedKg)}</strong>
                  </td>
                  <td class="do-print-num">
                    <strong>{formatQty(totals.remainingKg)}</strong>
                  </td>
                  <td class="do-print-num">
                    <strong>
                      {totalLiftedPercent(totals.orderedKg, totals.liftedKg)}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>

          <h3 class="do-track-print-section-title">Lift history (sales)</h3>
          {lifts.length === 0 ? (
            <p class="do-print-muted">No sales have lifted this delivery order.</p>
          ) : (
            lifts.map((lift) => (
              <section class="do-track-print-lift" key={lift.saleId}>
                <p>
                  <strong>{lift.invoiceNo}</strong>
                  {" · "}
                  {lift.status}
                  {" · "}
                  {formatDisplayDate(lift.dateIssued)}
                  {lift.customerName ? ` · ${lift.customerName}` : ""}
                </p>
                <table class="do-print-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th class="do-print-num">Qty (kg)</th>
                      <th class="do-print-num">Unit price</th>
                      <th class="do-print-num">Line net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lift.lines.map((line) => (
                      <tr
                        key={`${lift.saleId}:${line.productId}:${line.qtyKg}`}
                      >
                        <td>{line.productName}</td>
                        <td class="do-print-num">{formatQty(line.qtyKg)}</td>
                        <td class="do-print-num">
                          {formatMoney(line.unitPricePerKg)}
                        </td>
                        <td class="do-print-num">
                          {formatMoney(line.lineNet)} XAF
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          )}

          <h3 class="do-track-print-section-title">Transfers out</h3>
          {(transfersOut ?? []).length === 0 ? (
            <p class="do-print-muted">
              No transfers out from this delivery order.
            </p>
          ) : (
            (transfersOut ?? []).map((transfer) => (
              <section
                class="do-track-print-lift"
                key={transfer.transferId}
              >
                <p>
                  <strong>{transfer.toDeliveryOrderNo}</strong>
                  {" → "}
                  {transfer.toSalesPointName}
                  {" · "}
                  {formatDisplayDate(transfer.transferredAt.slice(0, 10))}
                </p>
                <table class="do-print-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th class="do-print-num">Transferred (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfer.lines.map((line) => (
                      <tr key={`${transfer.transferId}:${line.productId}`}>
                        <td>{line.productName}</td>
                        <td class="do-print-num">{formatQty(line.qtyKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          )}

          <section class="do-print-signatures">
            <ReportFooter
              name={payload.signatoryName}
              label={payload.signatoryTitle}
            />
          </section>
        </article>
      </DocumentPreview>
    </ReportOverlayShell>
  );
}
