import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type {
  MonthlyStockReconciliationMatrixRow,
  MonthlyStockReconciliationReport,
} from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import {
  HIDE_ZERO_ROWS_HINT,
  isMonthlyStockReconciliationReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./MonthlyStockReconciliationReport.css";

function formatKg(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  return Math.round(value).toLocaleString("en-US");
}

function rowClassName(row: MonthlyStockReconciliationMatrixRow): string {
  if (row.kind === "total" || row.kind === "subtotal") {
    return "scr-row scr-row-total";
  }
  if (row.kind === "section_header") {
    return "scr-row msr-section-header-row";
  }
  if (row.kind === "blank") {
    return "scr-row msr-blank-row";
  }
  return "scr-row";
}

function DataRow({
  report,
  row,
}: {
  report: MonthlyStockReconciliationReport;
  row: MonthlyStockReconciliationMatrixRow;
}) {
  return (
    <tr class={rowClassName(row)}>
      <td>{row.label}</td>
      {report.salesPointIds.map((salesPointId) => (
        <td key={salesPointId} class="scr-num">
          {formatKg(row.valuesBySalesPointId[String(salesPointId)])}
        </td>
      ))}
      <td class="scr-num scr-total-cell">{formatKg(row.total)}</td>
    </tr>
  );
}

function SectionTitleRow({
  title,
  colCount,
}: {
  title: string;
  colCount: number;
}) {
  return (
    <tr class="msr-section-title-row">
      <td colSpan={colCount} class="scr-section-title">
        {title}
      </td>
    </tr>
  );
}

function ReportMatrix({ report }: { report: MonthlyStockReconciliationReport }) {
  const colCount = report.salesPointNames.length + 2;

  return (
    <div class="scr-bottled-block mdr-section">
      <table class="scr-table sr-report-matrix msr-table">
        <thead>
          <tr>
            <th />
            {report.salesPointNames.map((name) => (
              <th key={name}>{name}</th>
            ))}
            <th>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <DataRow report={report} row={report.openingRow} />

          <SectionTitleRow title={report.receptionSectionTitle} colCount={colCount} />
          {report.receptionRows.map((row, index) => (
            <DataRow key={`reception-${index}`} report={report} row={row} />
          ))}
          <DataRow report={report} row={report.totalReceptionRow} />
          <DataRow report={report} row={report.openingPlusReceptionRow} />

          <SectionTitleRow title={report.issuesSectionTitle} colCount={colCount} />
          {report.issueRows.map((row, index) => (
            <DataRow key={`issue-${index}`} report={report} row={row} />
          ))}
          <DataRow report={report} row={report.totalIssuesRow} />
          <DataRow report={report} row={report.calculatedStockRow} />
          <DataRow report={report} row={report.physicalStockRow} />
          <DataRow report={report} row={report.varianceRow} />

          <SectionTitleRow title={report.bpoSectionTitle} colCount={colCount} />
          {report.bpoRows.map((row, index) => (
            <DataRow key={`bpo-${index}`} report={report} row={row} />
          ))}

          <SectionTitleRow title={report.otherSectionTitle} colCount={colCount} />
          {report.otherRows.map((row, index) => (
            <DataRow key={`other-${index}`} report={report} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonthlyStockReconciliationDocument({
  report,
}: {
  report: MonthlyStockReconciliationReport;
}) {
  const empty = isMonthlyStockReconciliationReportEmpty(report);

  return (
    <DocumentPreview
        title="Monthly stock reconciliation"
        fileName={`monthly-stock-reconciliation-${report.asAtIso}.pdf`}
        page="portrait"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No reconciliation figures to display."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No reconciliation figures to display."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document msr-document wpp-pack-page"
      
      
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
      <ReportMatrix report={report} />
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function MonthlyStockReconciliationScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<MonthlyStockReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getMonthlyStockReconciliation();
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
    return <p class="scr-status">Loading monthly stock reconciliation...</p>;
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page">
      <MonthlyStockReconciliationDocument report={report} />
    </div>
  );
}
