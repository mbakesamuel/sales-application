import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { MonthlyBottledOilReport } from "../../shared/reports.types.ts";
import { ReportCommentsSection } from "./ReportCommentsSection.tsx";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { isMonthlyBottledOilReportEmpty } from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./MonthlyBottledOilReport.css";

function formatQty(value: number): string {
  if (value === 0) {
    return "0";
  }
  return Math.round(value).toLocaleString("en-US");
}

function formatAmount(value: number): string {
  if (value === 0) {
    return "0";
  }
  return Math.round(value).toLocaleString("en-US");
}

function ReportDocument({ report }: { report: MonthlyBottledOilReport }) {
  const empty = isMonthlyBottledOilReportEmpty(report);

  return (
    <DocumentPreview
        title="Monthly bottled oil"
        fileName={`monthly-bottled-oil-${report.financialYear}-${report.asAtIso}.pdf`}
        page="landscape"
        bodyClass="mbo-print-landscape"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No Bottle Oil Ration or Public relation sales in this period."
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No Bottle Oil Ration or Public relation sales in this period."
      className="scr-document mbo-document"
      
      
      showComments={false}
      showFooter={false}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title={""}
        />
      }
    >
      <section class="mbo-routing" aria-label="Routing">
        <p class="mbo-routing-from">
          <span class="mbo-routing-key">From:</span> MPOS
        </p>
        <p class="mbo-routing-to">
          <span class="mbo-routing-key">TO:</span> Accounts Manager
          <span class="mbo-routing-date">
            {formatDisplayDate(report.asAtIso)}
          </span>
        </p>
      </section>

      <h1 class="mbo-title">BOTTLED PALM OIL ISSUED TO GM'S PR FOR {report.monthName} {report.financialYear}</h1>

      <div class="mbo-section">
        <table class="scr-table mbo-table">
          <thead>
            <tr>
              <th rowSpan={2}>DATE</th>
              <th rowSpan={2}>NAME/CUSTOMER</th>
              <th rowSpan={2}>ADDRESS</th>
              <th class="mbo-pack-group" colSpan={3}>
                PRODUCTS
              </th>
              <th rowSpan={2}>RECEIVED BY</th>
              <th rowSpan={2}>AMOUNT</th>
              <th rowSpan={2}>VEH. C. NO</th>
            </tr>
            <tr>
              <th class="mbo-pack-col">1x20L</th>
              <th class="mbo-pack-col">3x5L</th>
              <th class="mbo-pack-col">1x15L</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.saleId} class="scr-row">
                <td>{formatDisplayDate(row.dateIssued)}</td>
                <td>{row.customerName}</td>
                <td>{row.address || "—"}</td>
                <td class="scr-num mbo-pack-col">{formatQty(row.qty20L)}</td>
                <td class="scr-num mbo-pack-col">{formatQty(row.qty3x5L)}</td>
                <td class="scr-num mbo-pack-col">{formatQty(row.qty15L)}</td>
                <td>{row.receivedBy || "—"}</td>
                <td class="scr-num">{formatAmount(row.amount)}</td>
                <td>{row.vehConsignmentNo || "—"}</td>
              </tr>
            ))}
            <tr class="scr-row scr-row-total">
              <td class="mbo-total-label" colSpan={3}>
                TOTAL
              </td>
              <td class="scr-num mbo-pack-col">
                {formatQty(report.totals.qty20L)}
              </td>
              <td class="scr-num mbo-pack-col">
                {formatQty(report.totals.qty3x5L)}
              </td>
              <td class="scr-num mbo-pack-col">
                {formatQty(report.totals.qty15L)}
              </td>
              <td />
              <td class="scr-num">{formatAmount(report.totals.amount)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <ReportCommentsSection comments={report.comments} />

      <section class="mbo-signatories" aria-label="Signatories">
        <div class="mbo-signatory">
          <p class="mbo-signatory-label">Prepared By</p>
        </div>
        <div class="mbo-signatory">
          <p class="mbo-signatory-label">Checked By</p>
        </div>
        <div class="mbo-signatory">
          <p class="mbo-signatory-label">Approved By</p>
        </div>
      </section>
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function MonthlyBottledOilReportScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<MonthlyBottledOilReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getMonthlyBottledOil();
        if (!cancelled) {
          setReport(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load report.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p class="scr-status">Loading bottled oil monthly report…</p>;
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page mbo-page">
            <ReportDocument report={report} />
    </div>
  );
}
