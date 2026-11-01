import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { useEffect, useState } from "preact/hooks";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type { MonthlyDeliveriesByDestinationReport } from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import {
  HIDE_ZERO_ROWS_HINT,
  isMonthlyDeliveriesByDestinationReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./MonthlyDeliveriesByDestinationReport.css";

function formatKg(value: number): string {
  if (Math.abs(value) < 0.0005) {
    return "—";
  }
  return Math.round(value).toLocaleString("en-US");
}

function formatPct(value: number | null): string {
  if (value == null || Math.abs(value) < 0.0005) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}



function KgCells({
  industriesKg,
  wholesalesKg,
  retailKg,
  cdcWorkersKg,
  makokoKg,
  totalKg,
}: {
  industriesKg: number;
  wholesalesKg: number;
  retailKg: number;
  cdcWorkersKg: number;
  makokoKg: number;
  totalKg: number;
}) {
  return (
    <>
      <td class="scr-num">{formatKg(industriesKg)}</td>
      <td class="scr-num">{formatKg(wholesalesKg)}</td>
      <td class="scr-num">{formatKg(retailKg)}</td>
      <td class="scr-num">{formatKg(cdcWorkersKg)}</td>
      <td class="scr-num">{formatKg(makokoKg)}</td>
      <td class="scr-num">{formatKg(totalKg)}</td>
    </>
  );
}

function ReportTable({ report }: { report: MonthlyDeliveriesByDestinationReport }) {
  return (
    <div class="scr-bottled-block mdd-section">
      <table class="scr-table mdd-table">
        <thead>
          <tr>
            <th class="mdd-weeks-col">WEEKS</th>
            <th class="mdd-dates-col">DATES</th>
            <th>INDUSTRIES</th>
            <th>WHOLESALES</th>
            <th>RETAIL</th>
            <th>CDC WORKERS</th>
            <th>MAKOKO FARMS</th>
            <th>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {report.weeks.map((week) => (
            <tr key={week.weekIndex} class="scr-row">
              <td class="mdd-center">{week.weekIndex}</td>
              <td class="mdd-center">{week.datesLabel}</td>
              <KgCells {...week} />
            </tr>
          ))}
          <tr class="scr-row scr-row-total">
            <td />
            <td class="mdd-center">TOTAL</td>
            <KgCells {...report.totals} />
          </tr>
          <tr class="scr-row scr-row-total">
            <td colSpan={2} />
            <td class="scr-num">{formatPct(report.percentages.industriesPct)}</td>
            <td class="scr-num">{formatPct(report.percentages.wholesalesPct)}</td>
            <td class="scr-num">{formatPct(report.percentages.retailPct)}</td>
            <td class="scr-num">{formatPct(report.percentages.cdcWorkersPct)}</td>
            <td class="scr-num">{formatPct(report.percentages.makokoPct)}</td>
            <td class="scr-num">{formatPct(report.percentages.totalPct)}</td>
          </tr>
        </tbody>
      </table>
      <p class="mdd-legend no-print">
        Validated non-bottled sales (kg) by customer type for the open month. CDC Workers includes
        ration disposition and unmatched types.
      </p>
    </div>
  );
}

function ReportDocument({ report }: { report: MonthlyDeliveriesByDestinationReport }) {
  const empty = isMonthlyDeliveriesByDestinationReportEmpty(report);

  return (
    <DocumentPreview
        title="Deliveries by destination"
        fileName={`monthly-deliveries-by-destination-${report.asAtIso}.pdf`}
        page="portrait"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No deliveries by destination for this period."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No deliveries by destination for this period."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document mdd-document"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title={report.reportTitle}
        />
      }
    >
      <ReportTable report={report} />
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function MonthlyDeliveriesByDestinationScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<MonthlyDeliveriesByDestinationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getMonthlyDeliveriesByDestination();
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
    return <p class="scr-status">Loading deliveries by destination report…</p>;
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page">
            <ReportDocument report={report} />
    </div>
  );
}
