import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type {
  MonthlyPalmOilSalesMonthColumn,
  MonthlyPalmOilSalesReport,
  MonthlyPalmOilSalesRow,
} from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import {
  HIDE_ZERO_ROWS_HINT,
  isMonthlyPalmOilSalesReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./MonthlyBottledOilReport.css";
import "./MonthlyPalmOilSalesReport.css";

function formatTons(value: number): string {
  if (Math.abs(value) < 0.0005) {
    return "-";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatValue(value: number): string {
  const thousands = value / 1000;
  if (Math.abs(thousands) < 0.5) {
    return "-";
  }
  return Math.round(thousands).toLocaleString("en-US");
}

function MonthColumnGroup({ periodCount }: { periodCount: number }) {
  return (
    <colgroup>
      <col class="mpos-col-label" />
      {Array.from({ length: periodCount }).flatMap((_, index) => [
        <col key={`${index}-tons`} class="mpos-col-metric" />,
        <col key={`${index}-value`} class="mpos-col-metric" />,
      ])}
    </colgroup>
  );
}

function halfRangeLabel(columns: MonthlyPalmOilSalesMonthColumn[]): string {
  const first = columns[0]?.label;
  const last = columns[columns.length - 1]?.label;
  if (!first || !last) {
    return "";
  }
  return `${first} TO ${last}`;
}

function MonthBlock({
  columns,
  rows,
  showYtd,
}: {
  columns: MonthlyPalmOilSalesMonthColumn[];
  rows: MonthlyPalmOilSalesRow[];
  showYtd: boolean;
}) {
  const periodCount = columns.length + (showYtd ? 1 : 0);
  const sectionRange = halfRangeLabel(columns);

  return (
    <div class={`mpos-section ${showYtd ? "mpos-section-h2" : "mpos-section-h1"}`}>
      <table class="scr-table mpos-table">
        <MonthColumnGroup periodCount={periodCount} />
        <thead>
          <tr>
            <th class="mpos-label-col" rowSpan={2} />
            {columns.map((column) => (
              <th key={column.month} colSpan={2}>
                {column.label}
              </th>
            ))}
            {showYtd ? <th colSpan={2}>TOTAL</th> : null}
          </tr>
          <tr>
            {columns.flatMap((column) => [
              <th key={`${column.month}-tons`}>TONS</th>,
              <th key={`${column.month}-value`}>VALUE</th>,
            ])}
            {showYtd ? (
              <>
                <th>TONS</th>
                <th>VALUE</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowClass =
              row.kind === "section"
                ? "scr-row-header"
                : row.kind === "subtotal" || row.kind === "total"
                  ? "scr-row scr-row-total"
                  : "scr-row";

            if (row.kind === "section") {
              const colSpan = columns.length * 2 + (showYtd ? 2 : 0) + 1;
              const sectionLabel = sectionRange
                ? `${row.label} ${sectionRange}`
                : row.label;
              return (
                <tr key={row.id} class={rowClass}>
                  <td colSpan={colSpan}>
                    <strong>{sectionLabel}</strong>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={row.id} class={rowClass}>
                <td class="mpos-label-col">{row.label}</td>
                {columns.flatMap((column) => {
                  const cell = row.months[column.month - 1] ?? {
                    tons: 0,
                    value: 0,
                  };
                  return [
                    <td key={`${row.id}-${column.month}-tons`} class="scr-num">
                      {formatTons(cell.tons)}
                    </td>,
                    <td key={`${row.id}-${column.month}-value`} class="scr-num">
                      {formatValue(cell.value)}
                    </td>,
                  ];
                })}
                {showYtd ? (
                  <>
                    <td class="scr-num">{formatTons(row.ytd.tons)}</td>
                    <td class="scr-num">{formatValue(row.ytd.value)}</td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportDocument({ report }: { report: MonthlyPalmOilSalesReport }) {
  const empty = isMonthlyPalmOilSalesReportEmpty(report);

  return (
    <DocumentPreview
        title="Monthly palm oil sales"
        fileName={`monthly-palm-oil-sales-${report.financialYear}-${report.asAtIso}.pdf`}
        page="landscape-wide"
        bodyClass="mpos-print-landscape"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No palm oil sales for this month."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No palm oil sales for this month."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document mpos-document"
      
      
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
      <section class="mbo-routing" aria-label="Routing">
        <p class="mbo-routing-from">
          <span class="mbo-routing-key">From:</span> MPOS
        </p>
        <p class="mbo-routing-to">
          <span class="mbo-routing-key">TO:</span> COMMERCIAL DIRECTOR
          <span class="mbo-routing-date">
            {formatDisplayDate(report.generatedAtIso.slice(0, 10))}
          </span>
        </p>
      </section>

      <MonthBlock
        columns={report.monthColumnsH1}
        rows={report.rows}
        showYtd={false}
      />
      <MonthBlock
        columns={report.monthColumnsH2}
        rows={report.rows}
        showYtd
      />
      <p class="mpos-footnote">Value in &apos;000 FRS · taxes excluded</p>
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function MonthlyPalmOilSalesScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<MonthlyPalmOilSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getMonthlyPalmOilSales();
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
    return <p class="scr-status">Loading monthly palm oil sales report…</p>;
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
