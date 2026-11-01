import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { useEffect, useState } from "preact/hooks";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type { TransportCostReport } from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import "./StockCommitmentReport.css";
import "./TransportCostReport.css";

function formatKg(value: number): string {
  if (Math.abs(value) < 0.0005) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.0005) return "—";
  return Math.round(value).toLocaleString("en-US");
}



function ReportTable({ report }: { report: TransportCostReport }) {
  const dataRows = report.rows.filter((row) => row.kind === "data");
  const totalRow = report.rows.find((row) => row.kind === "total");

  return (
    <table class="scr-table">
      <thead>
        <tr>
          <th>Customer</th>
          <th>Collection point</th>
          <th>Product</th>
          <th class="scr-num">Qty lifted (kg)</th>
          <th class="scr-num">Transport cost (XAF)</th>
        </tr>
      </thead>
      <tbody>
        {dataRows.length === 0 ? (
          <tr>
            <td colSpan={5} class="scr-empty-cell">
              No lifted quantities in the open month.
            </td>
          </tr>
        ) : (
          dataRows.map((row) => (
            <tr key={`${row.customerId}-${row.salesPointId}-${row.productId}`}>
              <td>{row.customerName}</td>
              <td>{row.salesPointName}</td>
              <td>{row.productName}</td>
              <td class="scr-num">{formatKg(row.qtyKg)}</td>
              <td class="scr-num">
                {row.rateMissing ? "Incomplete*" : formatMoney(row.transportCost)}
              </td>
            </tr>
          ))
        )}
        {totalRow ? (
          <tr class="scr-total-row">
            <td colSpan={3}>
              <strong>{totalRow.customerName}</strong>
            </td>
            <td class="scr-num">
              <strong>{formatKg(totalRow.qtyKg)}</strong>
            </td>
            <td class="scr-num">
              <strong>
                {totalRow.rateMissing ? "Incomplete*" : formatMoney(totalRow.transportCost)}
              </strong>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export function TransportCostReportDocument({ report }: { report: TransportCostReport }) {
  const dataRows = report.rows.filter((row) => row.kind === "data");
  const hasMissingRate = report.totals.hasMissingRate;

  return (
    <DocumentPreview
        title="Transportation cost"
        fileName={`transport-cost-${report.asAtIso}.pdf`}
        page="portrait-wide"
        sourceKey={report}
        isEmpty={dataRows.length === 0}
        emptyMessage="No lifted quantities in the open month."
      >
      <ReportDocumentShell
      isEmpty={dataRows.length === 0}
      emptyMessage="No lifted quantities in the open month."
      className="tcr-document scr-document"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department}
          serviceName={report.settings.serviceName}
          title={report.reportTitle}
          meta={`Period: ${report.monthStartIso} to ${report.monthEndIso}`}
        />
      }
    >
      {hasMissingRate ? (
        <p class="scr-note">
          * Some rows are missing a transport rate for one or more lift dates.
        </p>
      ) : null}
      <ReportTable report={report} />
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function TransportCostReportScreen({ windowMode = false }: { windowMode?: boolean }) {
  void windowMode;
  const [report, setReport] = useState<TransportCostReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAuthenticatedReports()
      .getTransportCost()
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load report.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p class="scr-status">Loading…</p>;
  if (error) return <p class="scr-status scr-status-error">{error}</p>;
  if (!report) return <p class="scr-status">No data.</p>;

  return (
    <div class="scr-page">
            <TransportCostReportDocument report={report} />
    </div>
  );
}
