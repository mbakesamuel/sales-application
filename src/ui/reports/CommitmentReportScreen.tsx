import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { CommitmentReport, CommitmentReportSection } from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { isCommitmentReportEmpty, HIDE_ZERO_ROWS_HINT } from "./reportEmpty.ts";
import "./StockCommitmentReport.css";

function formatQty(value: number | null | undefined): string {
  if (value == null) {
    return "";
  }
  if (value === 0) {
    return "0";
  }
  const rounded = Math.round(value);
  if (rounded < 0) {
    return `(${Math.abs(rounded).toLocaleString("en-US")})`;
  }
  return rounded.toLocaleString("en-US");
}

function CommitmentSectionRows({
  section,
  columnCount,
}: {
  section: CommitmentReportSection;
  columnCount: number;
}) {
  return (
    <>
      <tr>
        <th colSpan={columnCount} class="scr-section-title">
          {section.sectionLetter}. {section.title}
        </th>
      </tr>
      {section.rows.map((row, index) => (
        <tr
          key={`${section.sectionLetter}-${index}`}
          class={row.kind === "total" ? "scr-row scr-row-total" : "scr-row"}
        >
          <td>{row.label}</td>
          {row.quantities.map((qty, qtyIndex) => (
            <td key={`${index}-${qtyIndex}`} class="scr-num">
              {formatQty(qty)}
            </td>
          ))}
          <td class="scr-num">{formatQty(row.rowTotal)}</td>
        </tr>
      ))}
    </>
  );
}

export function CommitmentReportDocument({ report }: { report: CommitmentReport }) {
  const empty = isCommitmentReportEmpty(report);
  const columnCount = report.salesPointNames.length + 2;

  return (
    <DocumentPreview
        title="Commitment report"
        fileName={`commitment-report-${report.asAtIso}.pdf`}
        page="portrait-weekly"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No commitment quantities to display."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No commitment quantities to display."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document sr-stock-compact cr-commitment-report wpp-pack-page weekly-report-tight"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title={`COMMITMENTS AS AT ${formatDisplayDate(report.asAtIso)}`}
        />
      }
    >
      {report.salesPointNames.length > 0 ? (
        <div class="scr-bottled-block">
          <table class="scr-table scr-category-matrix">
            <thead>
              <tr>
                <th>CUSTOMER</th>
                {report.salesPointNames.map((name) => (
                  <th key={name}>{name}</th>
                ))}
                <th>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {report.sections.map((section) => (
                <CommitmentSectionRows
                  key={section.sectionLetter}
                  section={section}
                  columnCount={columnCount}
                />
              ))}
              <tr class="scr-row scr-row-total">
                <td>GRAND TOTAL</td>
                {report.columnTotals.map((qty, index) => (
                  <td key={`gt-${index}`} class="scr-num">
                    {formatQty(qty)}
                  </td>
                ))}
                <td class="scr-num">{formatQty(report.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function CommitmentReportScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<CommitmentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getCommitmentReport();
        if (!cancelled) {
          setReport(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load report.");
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
    return <p class="scr-status">Loading commitment report...</p>;
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page">
      <CommitmentReportDocument report={report} />
    </div>
  );
}
