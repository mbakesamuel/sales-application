import { useEffect, useState } from "preact/hooks";
import { formatDisplayDate, formatDisplayDateTime } from "../../shared/formatDisplayDate.ts";
import type { TransferPrintPayload } from "../../shared/stock.types.ts";
import { TRANSFER_MODE_LABELS } from "../../shared/stockTransferMode.ts";
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
import "./TransferPrintView.css";

interface TransferPrintViewProps {
  transferId: string;
  userId: string;
  onClose: () => void;
}

function isIntraTransfer(transfer: TransferPrintPayload["transfer"]): boolean {
  return transfer.transferMode === "INTRA_SALES_POINT";
}

export function TransferPrintView({
  transferId,
  userId,
  onClose,
}: TransferPrintViewProps) {
  const [payload, setPayload] = useState<TransferPrintPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getElectronApi().stock.loadTransferPrintById({
          userId,
          transferId,
        });
        if (!cancelled) {
          if (!data) {
            setError("Transfer not found.");
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
  }, [transferId, userId]);

  if (error) {
    return (
      <ReportOverlayShell preview title="Stock transfer" onClose={onClose}>
        <p class="sales-error">{error}</p>
      </ReportOverlayShell>
    );
  }

  if (!payload) {
    return (
      <ReportOverlayShell preview title="Stock transfer" onClose={onClose}>
        <p class="sales-muted">Loading print view…</p>
      </ReportOverlayShell>
    );
  }
  const { transfer } = payload;
  const intra = isIntraTransfer(transfer);

  return (
    <ReportOverlayShell preview title="Stock transfer" onClose={onClose}>
          <DocumentPreview
            title="Stock transfer"
            fileName={`stock-transfer-${transfer.transferNo}.pdf`}
            bodyClass="st-print-mode"
            sourceKey={payload}
          >
          <article class="scr-document do-print-document st-print-document">
            <DocumentStatusStamp label={draftStampLabel(transfer.status)} />
            <ReportHeader
              companyName={payload.companyName}
              department={payload.department}
              serviceName={payload.serviceName}
              title="Transfer of bottle oil"
            />

            <section class="do-print-meta-grid">
              <div class="do-print-meta-col">
                <p>
                  <span class="do-print-label">Transfer #:</span>{" "}
                  <strong>{transfer.transferNo}</strong>
                </p>
                <p>
                  <span class="do-print-label">Type:</span>{" "}
                  {TRANSFER_MODE_LABELS[transfer.transferMode]}
                </p>
                <p>
                  <span class="do-print-label">Status:</span>{" "}
                  {STOCK_DOC_STATUS_LABELS[transfer.status]}
                </p>
              </div>
              <div class="do-print-meta-col">
                <p>
                  <span class="do-print-label">From:</span>{" "}
                  <strong>{transfer.fromSalesPointName}</strong>
                </p>
                <p>
                  <span class="do-print-label">
                    {intra ? "Collection point:" : "To:"}
                  </span>{" "}
                  {intra
                    ? transfer.fromSalesPointName
                    : transfer.toSalesPointName}
                </p>
                {intra && transfer.locationSummary ? (
                  <p>
                    <span class="do-print-label">Locations:</span>{" "}
                    {transfer.locationSummary}
                  </p>
                ) : null}
                <p>
                  <span class="do-print-label">Total quantity:</span>{" "}
                  {trimQty(transfer.totalQty)}
                </p>
              </div>
            </section>

            <section class="do-print-meta-grid sr-print-audit-grid">
              <div class="do-print-meta-col">
                <p>
                  <span class="do-print-label">Drafted by:</span>{" "}
                  {transfer.createdByName}
                </p>
                <p class="do-print-muted">
                  {formatDisplayDateTime(transfer.createdAtIso)}
                </p>
              </div>
              {transfer.dispatchedByName ? (
                <div class="do-print-meta-col">
                  <p>
                    <span class="do-print-label">Dispatched by:</span>{" "}
                    {transfer.dispatchedByName}
                  </p>
                  <p class="do-print-muted">
                    {transfer.dispatchedAtIso
                      ? formatDisplayDate(transfer.dispatchedAtIso)
                      : "—"}
                  </p>
                </div>
              ) : (
                <div class="do-print-meta-col" />
              )}
              {transfer.receivedByName ? (
                <div class="do-print-meta-col">
                  <p>
                    <span class="do-print-label">Received by:</span>{" "}
                    {transfer.receivedByName}
                  </p>
                  <p class="do-print-muted">
                    {transfer.receivedAtIso
                      ? formatDisplayDate(transfer.receivedAtIso)
                      : "—"}
                  </p>
                </div>
              ) : null}
            </section>

            {transfer.notes ? (
              <section class="sr-print-notes">
                <p>
                  <span class="do-print-label">Notes:</span> {transfer.notes}
                </p>
              </section>
            ) : null}

            {transfer.consignedBy ||
            transfer.consDesign ||
            transfer.consDate ||
            transfer.receiveBy ||
            transfer.receiveByDesign ||
            transfer.receiveDate ? (
              <section class="do-print-meta-grid sr-print-audit-grid">
                <div class="do-print-meta-col">
                  <p class="do-print-label">Consignment</p>
                  {transfer.consignedBy ? (
                    <p>
                      <span class="do-print-label">Consigned by:</span>{" "}
                      {transfer.consignedBy}
                    </p>
                  ) : null}
                  {transfer.consDesign ? (
                    <p>
                      <span class="do-print-label">Designation:</span>{" "}
                      {transfer.consDesign}
                    </p>
                  ) : null}
                  {transfer.consDate ? (
                    <p class="do-print-muted">
                      {formatDisplayDate(transfer.consDate)}
                    </p>
                  ) : null}
                </div>
                <div class="do-print-meta-col">
                  <p class="do-print-label">Receipt</p>
                  {transfer.receiveBy ? (
                    <p>
                      <span class="do-print-label">Received by:</span>{" "}
                      {transfer.receiveBy}
                    </p>
                  ) : null}
                  {transfer.receiveByDesign ? (
                    <p>
                      <span class="do-print-label">Designation:</span>{" "}
                      {transfer.receiveByDesign}
                    </p>
                  ) : null}
                  {transfer.receiveDate ? (
                    <p class="do-print-muted">
                      {formatDisplayDate(transfer.receiveDate)}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            <table class="do-print-table sr-print-table st-print-table">
              <colgroup>
                <col class="sr-print-col-item" />
                <col />
                <col />
                <col />
                <col class="sr-print-col-uom" />
                <col class="sr-print-col-qty" />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th>From location</th>
                  <th>To location</th>
                  <th class="do-print-num">UOM</th>
                  <th class="do-print-num">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {transfer.lines.map((line, index) => (
                  <tr key={line.id}>
                    <td>{index + 1}</td>
                    <td>{line.productName}</td>
                    <td>{line.fromStorageLocationName}</td>
                    <td>{line.toStorageLocationName ?? "Pending receipt"}</td>
                    <td class="do-print-num">{line.uom}</td>
                    <td class="do-print-num">{trimQty(line.qty)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} class="do-print-num do-print-label">
                    Total
                  </td>
                  <td class="do-print-num do-print-label">
                    {trimQty(transfer.totalQty)}
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
