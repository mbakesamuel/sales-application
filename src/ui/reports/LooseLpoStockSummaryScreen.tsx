import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type {
  LooseLpoStockSummaryReport,
  LooseLpoStockSummaryRow,
} from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportFooter } from "./ReportFooter.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { isLooseLpoStockSummaryReportEmpty } from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./MonthlyBottledOilReport.css";
import "./LooseLpoStockSummaryReport.css";

function formatKg(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  return Math.round(value).toLocaleString("en-US");
}

function rowClassName(row: LooseLpoStockSummaryRow): string {
  if (row.kind === "subtotal" || row.kind === "total") {
    return "scr-row scr-row-total";
  }
  return "scr-row";
}

export function LooseLpoStockSummaryDocument({
  report,
}: {
  report: LooseLpoStockSummaryReport;
}) {
  const empty = isLooseLpoStockSummaryReportEmpty(report);

  return (
    <DocumentPreview
        title="Loose LPO stock summary"
        fileName={`loose-lpo-stock-summary-${report.asAtIso}.pdf`}
        page="portrait"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No loose palm oil stock summary figures to display."
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No loose palm oil stock summary figures to display."
      className="scr-document lpo-summary-document wpp-pack-page"
      
      
      comments={report.comments}
      showFooter={false}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title=""
        />
      }
    >
      <section class="mbo-routing" aria-label="Routing">
        <p class="mbo-routing-from">
          <span class="mbo-routing-key">From:</span> MPOS
        </p>
        <p class="mbo-routing-to">
          <span class="mbo-routing-key">TO:</span> COMMERCIAL DIRECTOR
          <span class="mbo-routing-date">{formatDisplayDate(report.asAtIso)}</span>
        </p>
      </section>

      <h1 class="lpo-summary-title">{report.reportTitle}</h1>

      <div>
        <table class="scr-table lpo-summary-table">
          <thead>
            <tr>
              <th />
              <th class="scr-num">THIS MONTH</th>
              <th class="scr-num">{report.toDateColumnLabel}</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.id} class={rowClassName(row)}>
                <td>{row.label}</td>
                <td class="scr-num">{formatKg(row.values.thisMonth)}</td>
                <td class="scr-num">{formatKg(row.values.toDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.settings.signatoryTitle ? (
        <ReportFooter
          name={report.settings.signatoryName}
          label={report.settings.signatoryTitle}
        >
        
        </ReportFooter>
      ) : null}
        <p class="lpo-summary-cc">CC: FIN.D, MC (P), HOMC</p>
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function LooseLpoStockSummaryScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<LooseLpoStockSummaryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getLooseLpoStockSummary();
        if (!cancelled) {
          setReport(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load report.",
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
    return <p class="scr-status">Loading loose LPO stock summary...</p>;
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page">
      <LooseLpoStockSummaryDocument report={report} />
    </div>
  );
}
