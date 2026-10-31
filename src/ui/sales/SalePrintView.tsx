import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import { buildSaleInvoiceQrText } from "../../shared/saleInvoiceQr.ts";
import { getElectronApi } from "../auth/client.ts";
import { QrCode } from "../components/QrCode.tsx";
import { ReportHeader } from "../reports/ReportHeader.tsx";
import { ReportFooter } from "../reports/ReportFooter.tsx";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import type { PrintPage } from "../print/buildPrintDocumentHtml.ts";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import {
  DocumentStatusStamp,
  draftStampLabel,
} from "../print/DocumentStatusStamp.tsx";
import { buildCashReceiptSettlementPhrase, formatAmountInFrancsWords } from "./cashReceiptText.ts";
import type { SalePrintPayload } from "./types.ts";
import "../reports/StockCommitmentReport.css";
import "./SalePrintView.css";

interface SalePrintViewProps {
  saleId: string;
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

function DocumentPrintShell({
  title,
  pdfFileName,
  onClose,
  page = "portrait",
  bodyClass,
  sourceKey,
  children,
}: {
  title: string;
  pdfFileName: string;
  onClose: () => void;
  page?: PrintPage;
  bodyClass?: string;
  sourceKey: unknown;
  children: ComponentChildren;
}) {
  return (
    <ReportOverlayShell preview title={title} onClose={onClose}>
      <DocumentPreview
        title={title}
        fileName={pdfFileName}
        page={page}
        bodyClass={bodyClass}
        sourceKey={sourceKey}
      >
        {children}
      </DocumentPreview>
    </ReportOverlayShell>
  );
}

const CASH_RECEIPT_COPY_LABELS = ["Original", "Duplicate"] as const;

function CashReceiptDocument({ payload }: { payload: SalePrintPayload }) {
  const { sale } = payload;
  const settlement = buildCashReceiptSettlementPhrase(sale.lines);
  const amountLabel = `${formatMoney(sale.grossAmount)} XAF`;

  return (
    <article class="scr-document sale-print-document sale-print-cash-receipt">
      <ReportHeader
        companyName={payload.companyName}
        department="Bota Limbe, South West Region"
        serviceName={payload.serviceName}
        title={`Cash Receipt No ${sale.invoiceNo}`}
      />

      <section class="sale-print-receipt-meta">
        <p>
          <span class="sale-print-label">Date:</span>{" "}
          {formatDisplayDate(sale.dateIssuedIso)}
        </p>
      </section>

      <section class="sale-print-receipt-amount-row">
        <span class="sale-print-label">Amount:</span>
        <div class="sale-print-receipt-amount-box">{amountLabel}</div>
      </section>

      <section class="sale-print-receipt-prose">
        <p>
          Received from <strong>{sale.customerName}</strong>
          <br />
          The sum of{" "}
          <strong class="sale-print-receipt-amount">
            {formatAmountInFrancsWords(sale.grossAmount)}
          </strong>
          <br />
          in settlement of <strong>{settlement}</strong>.
          <br />
          For and on behalf of <strong>{payload.companyName}</strong>.
        </p>
      </section>

      <section class="sale-print-receipt-receiver">
        <div class="sale-print-receipt-receiver-fields">
          <div class="sale-print-receipt-receiver-row">
            <span class="sale-print-receipt-receiver-label">
              Signature of Receiver:
            </span>
            <span class="sale-print-receipt-receiver-line" />
          </div>
          <div class="sale-print-receipt-receiver-row">
            <span class="sale-print-receipt-receiver-label">Full Name:</span>
            <span class="sale-print-receipt-receiver-line" />
          </div>
          <div class="sale-print-receipt-receiver-row">
            <span class="sale-print-receipt-receiver-label">Designation:</span>
            <span class="sale-print-receipt-receiver-line" />
          </div>
          <div class="sale-print-receipt-receiver-row">
            <span class="sale-print-receipt-receiver-label">Unit:</span>
            <span class="sale-print-receipt-receiver-line" />
          </div>
        </div>
      </section>

      <section class="sale-print-footer">
        <div class="sale-print-qr">
          <QrCode
            value={buildSaleInvoiceQrText(sale, payload.companyName)}
            size={56}
            alt="Cash receipt verification QR code"
          />
        </div>
      </section>
    </article>
  );
}

function CashReceiptDualSheet({ payload }: { payload: SalePrintPayload }) {
  const statusStamp = draftStampLabel(payload.sale.status);

  return (
    <div class="sale-cash-print-sheet">
      {CASH_RECEIPT_COPY_LABELS.map((label) => (
        <section
          class="sale-cash-print-copy"
          key={label}
          aria-label={`${label} copy`}
        >
          <div class="sale-cash-print-stamp">{label}</div>
          <DocumentStatusStamp label={statusStamp} />
          <div class="sale-cash-print-copy-body">
            <CashReceiptDocument payload={payload} />
          </div>
        </section>
      ))}
    </div>
  );
}

export function SalePrintView({ saleId, onClose }: SalePrintViewProps) {
  const [payload, setPayload] = useState<SalePrintPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getElectronApi().sales.loadSalePrintById(saleId);
        if (!cancelled) {
          if (!data) {
            setError("Sale not found.");
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
  }, [saleId]);

  if (error) {
    return (
      <ReportOverlayShell preview title="Sales Invoice" onClose={onClose}>
        <p class="scr-status scr-status-error">{error}</p>
      </ReportOverlayShell>
    );
  }

  if (!payload) {
    return (
      <ReportOverlayShell preview title="Sales Invoice" onClose={onClose}>
        <p class="scr-status">Loading print view…</p>
      </ReportOverlayShell>
    );
  }

  const { sale } = payload;
  const isBottleMode = sale.saleProductMode === "BOTTLE";

  if (isBottleMode) {
    const shellTitle = `Cash Receipt ${sale.invoiceNo}`;
    const pdfFileName = `cash-receipt-${sale.invoiceNo}.pdf`;

    return (
      <DocumentPrintShell
        title={shellTitle}
        pdfFileName={pdfFileName}
        onClose={onClose}
        page="portrait-receipt"
        bodyClass="sale-cash-print-mode"
        sourceKey={payload}
      >
        <div class="sale-cash-print-page">
          <CashReceiptDualSheet payload={payload} />
        </div>
      </DocumentPrintShell>
    );
  }

  const isSpecialDisposition =
    sale.saleDisposition === "RATION" ||
    sale.saleDisposition === "PUBLIC_RELATION";
  const skipTax = isSpecialDisposition;
  const showTaxes = !skipTax && sale.appliedTaxes.length > 0;
  const paymentMethods = sale.payments
    .map((payment) => payment.methodName)
    .filter(Boolean);
  const paymentMethodLabel =
    paymentMethods.length > 0
      ? [...new Set(paymentMethods)].join(", ")
      : "—";
  const firstPaymentDate = sale.payments.find(
    (payment) => payment.paymentDate,
  )?.paymentDate;
  const shellTitle = `Sales Invoice ${sale.invoiceNo}`;
  const pdfFileName = `sales-invoice-${sale.invoiceNo}.pdf`;

  return (
    <DocumentPrintShell
      title={shellTitle}
      pdfFileName={pdfFileName}
      onClose={onClose}
      sourceKey={payload}
    >
      <article class="scr-document sale-print-document">
        <DocumentStatusStamp label={draftStampLabel(sale.status)} />
        <ReportHeader
          companyName={payload.companyName}
          department={payload.department}
          serviceName={payload.serviceName}
          title="SALES INVOICE"
        />

        <section class="sale-print-meta-grid">
          <div class="sale-print-meta-col">
            <p>
              <span class="sale-print-label">Invoice No:</span>{" "}
              <strong>{sale.invoiceNo}</strong>
            </p>
            <p>
              <span class="sale-print-label">Invoice Date:</span>{" "}
              {formatDisplayDate(sale.dateIssuedIso)}
            </p>
            {sale.deliveryOrderNo ? (
              <p>
                <span class="sale-print-label">Delivery Order:</span>{" "}
                {sale.deliveryOrderNo}
              </p>
            ) : null}
            {sale.referenceNumber ? (
              <p>
                <span class="sale-print-label">Reference:</span>{" "}
                {sale.referenceNumber}
              </p>
            ) : null}
          </div>
          <div class="sale-print-meta-col">
            <p>
              <span class="sale-print-label">Customer:</span>{" "}
              <strong>{sale.customerName}</strong>
            </p>
            <p>
              <span class="sale-print-label">Salesperson:</span>{" "}
              {sale.salespersonName?.trim() || "—"}
            </p>
            {sale.taxpayerId ? (
              <p>
                <span class="sale-print-label">Taxpayer ID:</span>{" "}
                {sale.taxpayerId}
              </p>
            ) : null}
            {sale.vehicleNumber && sale.vehicleNumber !== "BPO-OUTBOUND" ? (
              <p>
                <span class="sale-print-label">Vehicle:</span>{" "}
                {sale.vehicleNumber}
              </p>
            ) : null}
          </div>
        </section>

        <section class="sale-print-info-grid">
          <div class="sale-print-info-block">
            <div class="sale-print-info-heading">Billing Address:</div>
            <div class="sale-print-info-body">
              <p>{sale.customerName}</p>
              {sale.customerAddress ? (
                <p>{sale.customerAddress}</p>
              ) : (
                <p class="sale-print-muted">No address on file</p>
              )}
              {sale.customerPhone ? <p>{sale.customerPhone}</p> : null}
            </div>
          </div>
          <div class="sale-print-info-block">
            <div class="sale-print-info-heading">Shipping Address:</div>
            <div class="sale-print-info-body">
              {sale.salesPointName ? (
                <>
                  <p>{sale.salesPointName}</p>
                  <p class="sale-print-muted">Collection point</p>
                </>
              ) : (
                <p>Same as billing</p>
              )}
            </div>
          </div>
        </section>

        <table class="sale-print-table">
          <colgroup>
            <col class="sale-print-col-code" />
            <col class="sale-print-col-desc" />
            <col class="sale-print-col-qty" />
            <col class="sale-print-col-price" />
            <col class="sale-print-col-total" />
          </colgroup>
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Description</th>
              <th class="sale-print-num">Quantity</th>
              <th class="sale-print-num">Unit Price</th>
              <th class="sale-print-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line) => (
              <tr key={line.lineNo}>
                <td>{line.productCode?.trim() || "—"}</td>
                <td>
                  {line.productName}
                  {line.productCat ? (
                    <span class="sale-print-cat"> ({line.productCat})</span>
                  ) : null}
                </td>
                <td class="sale-print-num">
                  {line.qty} {line.unitLabel}
                </td>
                <td class="sale-print-num">
                  {formatMoney(line.unitPrice)} XAF
                </td>
                <td class="sale-print-num">
                  {formatMoney(line.lineNet)} XAF
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section class="sale-print-summary">
          <div class="sale-print-payment-block">
            <p>
              <span class="sale-print-label">Payment Method:</span>{" "}
              {paymentMethodLabel}
            </p>
            <p>
              <span class="sale-print-label">Payment Date:</span>{" "}
              {firstPaymentDate
                ? formatDisplayDate(firstPaymentDate)
                : formatDisplayDate(sale.dateIssuedIso)}
            </p>
            <p>
              <span class="sale-print-label">Status:</span> {sale.status}
            </p>
            {sale.payments.length > 1 ? (
              <ul class="sale-print-payment-list">
                {sale.payments.map((payment, index) => (
                  <li key={index}>
                    {payment.methodName}: {payment.amount || "0 XAF"}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div class="sale-print-totals">
            <div>
              <span>Subtotal</span>
              <span>{formatMoney(sale.netAmount)} XAF</span>
            </div>
            {showTaxes
              ? sale.appliedTaxes.map((tax) => (
                  <div key={`${tax.label}:${tax.ratePercent}`}>
                    <span>
                      {tax.label}
                      {tax.ratePercent ? ` (${tax.ratePercent})` : ""}
                    </span>
                    <span>{tax.amount || `${formatMoney("0")} XAF`}</span>
                  </div>
                ))
              : null}
            {!skipTax && !showTaxes && Number.parseFloat(sale.vatAmount) > 0 ? (
              <div>
                <span>VAT</span>
                <span>{formatMoney(sale.vatAmount)} XAF</span>
              </div>
            ) : null}
            <div class="sale-print-grand-total">
              <span>Grand Total:</span>
              <span>{formatMoney(sale.grossAmount)} XAF</span>
            </div>
          </div>
        </section>

        <section class="sale-print-footer">
          <div class="sale-print-qr">
            <QrCode
              value={buildSaleInvoiceQrText(sale, payload.companyName)}
              size={96}
              alt="Invoice verification QR code"
            />
          </div>
          <div class="sale-print-signatures">
            <ReportFooter
              name={payload.signatoryName}
              label={payload.signatoryTitle}
            />
          </div>
        </section>
      </article>
    </DocumentPrintShell>
  );
}
