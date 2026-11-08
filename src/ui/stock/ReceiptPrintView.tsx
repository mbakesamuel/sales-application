import { useEffect, useState } from "preact/hooks";
import { formatDisplayDate, formatDisplayDateTime } from "../../shared/formatDisplayDate.ts";
import type { ReceiptPrintPayload } from "../../shared/stock.types.ts";
import { getElectronApi } from "../auth/client.ts";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import { ReportFooter } from "../reports/ReportFooter.tsx";
import { ReportHeader } from "../reports/ReportHeader.tsx";
import {
  DocumentStatusStamp,
  draftStampLabel,
} from "../print/DocumentStatusStamp.tsx";
import { STOCK_DOC_STATUS_LABELS } from "./stockDisplay.ts";
import { formatDate, trimQty } from "./stockUtils.ts";
import "../delivery-orders/DeliveryOrderPrintView.css";
import "./ReceiptPrintView.css";

interface ReceiptPrintViewProps {
  receiptId: string;
  userId: string;
  onClose: () => void;
}

export function ReceiptPrintView({
  receiptId,
  userId,
  onClose,
}: ReceiptPrintViewProps) {
  const [payload, setPayload] = useState<ReceiptPrintPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getElectronApi().stock.loadReceiptPrintById({
          userId,
          receiptId,
        });
        if (!cancelled) {
          if (!data) {
            setError("Receipt not found.");
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
  }, [receiptId, userId]);

  if (error) {
    return (
      <ReportOverlayShell preview title="Stock receipt" onClose={onClose}>
        <p class="sales-error">{error}</p>
      </ReportOverlayShell>
    );
  }

  if (!payload) {
    return (
      <ReportOverlayShell preview title="Stock receipt" onClose={onClose}>
        <p class="sales-muted">Loading print view…</p>
      </ReportOverlayShell>
    );
  }
  const { receipt } = payload;

  return (
    <ReportOverlayShell preview title="Stock receipt" onClose={onClose}>
        <DocumentPreview
          title="Stock receipt"
          fileName={`stock-receipt-${receipt.receiptNo}.pdf`}
          bodyClass="sr-print-mode"
          sourceKey={payload}
        >
        <article class="scr-document do-print-document sr-print-document">
          <DocumentStatusStamp label={draftStampLabel(receipt.status)} />
          <ReportHeader
            companyName={payload.companyName}
            department={payload.department}
            serviceName={payload.serviceName}
            title="Stock receipt"
          />

          <section class="do-print-meta-grid">
            <div class="do-print-meta-col">
              <p>
                <span class="do-print-label">Receipt #:</span>{" "}
                <strong>{receipt.receiptNo}</strong>
              </p>
              {receipt.consignmentNoteNo ? (
                <p>
                  <span class="do-print-label">Consignment Note #:</span>{" "}
                  <strong>{receipt.consignmentNoteNo}</strong>
                </p>
              ) : null}
              <p>
                <span class="do-print-label">Receipt date:</span>{" "}
                {formatDisplayDate(receipt.receivedAtIso)}
              </p>
              <p>
                <span class="do-print-label">Status:</span>{" "}
                {STOCK_DOC_STATUS_LABELS[receipt.status]}
              </p>
            </div>
            <div class="do-print-meta-col">
              <p>
                <span class="do-print-label">Collection point:</span>{" "}
                <strong>{receipt.salesPointName}</strong>
              </p>
              <p>
                <span class="do-print-label">Mill:</span> {receipt.supplierLabel}
              </p>
              <p>
                <span class="do-print-label">Total quantity:</span>{" "}
                {trimQty(receipt.totalQty)}
              </p>
            </div>
          </section>

          {receipt.consignedBy ||
          receipt.consDesign ||
          receipt.consDate ||
          receipt.receiveBy ||
          receipt.receiveByDesign ||
          receipt.receiveDate ? (
            <section class="do-print-meta-grid sr-print-audit-grid">
              <div class="do-print-meta-col">
                <p class="do-print-label">Consignment</p>
                {receipt.consignedBy ? (
                  <p>
                    <span class="do-print-label">Consigned by:</span>{" "}
                    {receipt.consignedBy}
                  </p>
                ) : null}
                {receipt.consDesign ? (
                  <p>
                    <span class="do-print-label">Designation:</span>{" "}
                    {receipt.consDesign}
                  </p>
                ) : null}
                {receipt.consDate ? (
                  <p class="do-print-muted">
                    {formatDisplayDate(receipt.consDate)}
                  </p>
                ) : null}
              </div>
              <div class="do-print-meta-col">
                <p class="do-print-label">Receipt</p>
                {receipt.receiveBy ? (
                  <p>
                    <span class="do-print-label">Received by:</span>{" "}
                    {receipt.receiveBy}
                  </p>
                ) : null}
                {receipt.receiveByDesign ? (
                  <p>
                    <span class="do-print-label">Designation:</span>{" "}
                    {receipt.receiveByDesign}
                  </p>
                ) : null}
                {receipt.receiveDate ? (
                  <p class="do-print-muted">
                    {formatDisplayDate(receipt.receiveDate)}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          <section class="do-print-meta-grid sr-print-audit-grid">
            <div class="do-print-meta-col">
              <p>
                <span class="do-print-label">Drafted by:</span>{" "}
                {receipt.createdByName}
              </p>
              <p class="do-print-muted">
                {formatDisplayDateTime(receipt.createdAtIso)}
              </p>
            </div>
            {receipt.postedByName ? (
              <div class="do-print-meta-col">
                <p>
                  <span class="do-print-label">Posted by:</span>{" "}
                  {receipt.postedByName}
                </p>
                <p class="do-print-muted">
                  {formatDisplayDateTime(receipt.postedAtIso)}
                </p>
              </div>
            ) : (
              <div class="do-print-meta-col" />
            )}
          </section>

          {receipt.notes ? (
            <section class="sr-print-notes">
              <p>
                <span class="do-print-label">Notes:</span> {receipt.notes}
              </p>
            </section>
          ) : null}

          <table class="do-print-table sr-print-table">
            <colgroup>
              <col class="sr-print-col-item" />
              <col />
              <col />
              <col class="sr-print-col-uom" />
              <col class="sr-print-col-qty" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Location</th>
                <th class="do-print-num">UOM</th>
                <th class="do-print-num">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line, index) => (
                <tr key={line.id}>
                  <td>{index + 1}</td>
                  <td>{line.productName}</td>
                  <td>{line.storageLocationName}</td>
                  <td class="do-print-num">{line.uom}</td>
                  <td class="do-print-num">{trimQty(line.qty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} class="do-print-num do-print-label">
                  Total
                </td>
                <td class="do-print-num do-print-label">
                  {trimQty(receipt.totalQty)}
                </td>
              </tr>
            </tfoot>
          </table>

          <p class="sr-print-generated">
            Printed {formatDate(new Date().toISOString())}
          </p>

          <ReportFooter
            label={payload.signatoryTitle}
            name={payload.signatoryName}
          />
        </article>
        </DocumentPreview>
    </ReportOverlayShell>
  );
}
