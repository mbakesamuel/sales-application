import { useEffect, useState } from "preact/hooks";
import { buildDeliveryOrderQrText } from "../../shared/deliveryOrderQr.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import {
  formatTaxLabelFromAmounts,
  formatTaxLabelWithPercent,
  SALES_TAX_LABEL,
} from "../../shared/taxRules.ts";
import { getElectronApi } from "../auth/client.ts";
import { QrCode } from "../components/QrCode.tsx";
import { ReportHeader } from "../reports/ReportHeader.tsx";
import { ReportFooter } from "../reports/ReportFooter.tsx";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import {
  DocumentStatusStamp,
  draftStampLabel,
} from "../print/DocumentStatusStamp.tsx";
import type { DeliveryOrderPrintPayload } from "./types.ts";
import "../reports/StockCommitmentReport.css";
import "./DeliveryOrderPrintView.css";

interface DeliveryOrderPrintViewProps {
  orderId: number;
  onClose: () => void;
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

function resolveVatLabel(order: DeliveryOrderPrintPayload["order"]): string {
  if (order.vatRate?.trim()) {
    return formatTaxLabelWithPercent("VAT", order.vatRate);
  }
  return formatTaxLabelFromAmounts("VAT", order.subtotalExTax, order.vatAmount);
}

function resolveSalesTaxLabel(order: DeliveryOrderPrintPayload["order"]): string {
  const stored = order.otherTaxLabel?.trim();
  if (stored?.includes("%")) {
    return stored;
  }
  const base = stored || SALES_TAX_LABEL;
  return formatTaxLabelFromAmounts(
    base,
    order.subtotalExTax,
    order.otherTaxAmount,
  );
}

export function DeliveryOrderPrintView({
  orderId,
  onClose,
}: DeliveryOrderPrintViewProps) {
  const [payload, setPayload] = useState<DeliveryOrderPrintPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data =
          await getElectronApi().deliveryOrders.loadPrintById(orderId);
        if (!cancelled) {
          if (!data) {
            setError("Delivery order not found.");
            return;
          }
          setPayload(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load print view.",
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const shellTitle = payload
    ? `Delivery Order #${payload.order.deliveryOrderNo}`
    : "Delivery Order";

  if (error) {
    return (
      <ReportOverlayShell preview title={shellTitle} onClose={onClose}>
        <p class="scr-status scr-status-error">{error}</p>
      </ReportOverlayShell>
    );
  }

  if (!payload) {
    return (
      <ReportOverlayShell preview title={shellTitle} onClose={onClose}>
        <p class="scr-status">Loading print view…</p>
      </ReportOverlayShell>
    );
  }

  const { order } = payload;
  const showVat = Number.parseFloat(order.vatAmount) > 0;
  const showOtherTax = Number.parseFloat(order.otherTaxAmount) > 0;
  const pdfFileName = `delivery-order-${order.deliveryOrderNo}.pdf`;

  return (
    <ReportOverlayShell preview title={shellTitle} onClose={onClose}>
      <DocumentPreview
        title={shellTitle}
        fileName={pdfFileName}
        sourceKey={payload}
      >
        <article class="scr-document do-print-document">
          <DocumentStatusStamp label={draftStampLabel(order.status)} />
          <ReportHeader
            companyName={payload.companyName}
            department={payload.department}
            serviceName={payload.serviceName}
            title="DELIVERY ORDER "
          />

          <section class="do-print-meta-grid">
            <div class="do-print-meta-col">
              <p>
                <span class="do-print-label">Delivery Order #:</span>{" "}
                <strong>{order.deliveryOrderNo}</strong>
              </p>
              <p>
                <span class="do-print-label">Order Date:</span>{" "}
                {formatDisplayDate(order.dateIssuedIso)}
              </p>
              {order.orderRef ? (
                <p>
                  <span class="do-print-label">Customer Ref:</span>{" "}
                  {order.orderRef}
                </p>
              ) : null}
            </div>
            <div class="do-print-meta-col">
              <p>
                <span class="do-print-label">Customer:</span>{" "}
                <strong>{order.customerName}</strong>
              </p>
              {order.taxpayerId ? (
                <p>
                  <span class="do-print-label">Taxpayer ID:</span>{" "}
                  {order.taxpayerId}
                </p>
              ) : null}
              <p>
                <span class="do-print-label">Collection Point:</span>{" "}
                {order.salesPointName}
              </p>
            </div>
          </section>

          <section class="do-print-info-grid">
            <div class="do-print-info-block">
              <div class="do-print-info-heading">Customer Address</div>
              <div class="do-print-info-body">
                <p>{order.customerName}</p>
                {order.customerAddress ? (
                  <p>{order.customerAddress}</p>
                ) : (
                  <p class="do-print-muted">No address on file</p>
                )}
                {order.customerPhone ? <p>{order.customerPhone}</p> : null}
              </div>
            </div>
            <div class="do-print-info-block">
              <div class="do-print-info-heading">Order Details</div>
              <div class="do-print-info-body">
                <p>
                  <span class="do-print-label">Status:</span> {order.status}
                </p>
                {order.createdByName ? (
                  <p>
                    <span class="do-print-label">Prepared by:</span>{" "}
                    {order.createdByName}
                  </p>
                ) : null}
                {order.validatedByName ? (
                  <p>
                    <span class="do-print-label">Validated by:</span>{" "}
                    {order.validatedByName}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <table class="do-print-table">
            <colgroup>
              <col class="do-print-col-item" />
              <col />
              <col class="do-print-col-qty" />
              <col class="do-print-col-price" />
              <col class="do-print-col-total" />
            </colgroup>
            <thead>
              <tr>
                <th>Item</th>
                <th>Description</th>
                <th class="do-print-num">Quantity</th>
                <th class="do-print-num">Unit Price</th>
                <th class="do-print-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.lineNo}>
                  <td>{line.lineNo}</td>
                  <td>{line.productName}</td>
                  <td class="do-print-num">
                    {line.orderQty} {line.orderUnit}
                  </td>
                  <td class="do-print-num">{formatMoney(line.unitPrice)}</td>
                  <td class="do-print-num">
                    {formatMoney(line.lineSubtotalExTax)} XAF
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr class="do-print-totals-row">
                <td colSpan={4} class="do-print-totals-label">
                  Subtotal
                </td>
                <td class="do-print-num do-print-totals-amount">
                  {formatMoney(order.subtotalExTax)} XAF
                </td>
              </tr>
              {showVat ? (
                <tr class="do-print-totals-row">
                  <td colSpan={4} class="do-print-totals-label">
                    {resolveVatLabel(order)}
                  </td>
                  <td class="do-print-num do-print-totals-amount">
                    {formatMoney(order.vatAmount)} XAF
                  </td>
                </tr>
              ) : null}
              {showOtherTax ? (
                <tr class="do-print-totals-row">
                  <td colSpan={4} class="do-print-totals-label">
                    {resolveSalesTaxLabel(order)}
                  </td>
                  <td class="do-print-num do-print-totals-amount">
                    {formatMoney(order.otherTaxAmount)} XAF
                  </td>
                </tr>
              ) : null}
              <tr class="do-print-totals-row do-print-grand-total">
                <td colSpan={4} class="do-print-totals-label">
                  Grand Total
                </td>
                <td class="do-print-num do-print-totals-amount">
                  {formatMoney(order.grandTotal)} XAF
                </td>
              </tr>
            </tfoot>
          </table>

          {order.payments.length > 0 ? (
            <section class="do-print-payments">
              <h3>Payments</h3>
              <ul>
                {order.payments.map((payment, index) => (
                  <li key={index}>
                    {payment.methodName}
                    {payment.paymentDate
                      ? ` · ${formatDisplayDate(payment.paymentDate)}`
                      : ""}
                    {payment.detail ? ` · ${payment.detail}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section class="do-print-footer">
            <div class="do-print-qr">
              <QrCode
                value={buildDeliveryOrderQrText(order, payload.companyName)}
                size={96}
                alt="Delivery order verification QR code"
              />
            </div>
            <div class="do-print-signatures">
              <ReportFooter
                name={payload.signatoryName}
                label={payload.signatoryTitle}
              />
            </div>
          </section>
        </article>
      </DocumentPreview>
    </ReportOverlayShell>
  );
}
