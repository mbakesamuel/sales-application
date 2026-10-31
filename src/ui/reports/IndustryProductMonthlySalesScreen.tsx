import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type {
  IndustryProductMonthlySalesMonthColumn,
  IndustryProductMonthlySalesReport,
  IndustryProductMonthlySalesRow,
} from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import {
  HIDE_ZERO_ROWS_HINT,
  isIndustryProductMonthlySalesReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./IndustryProductMonthlySalesReport.css";

function formatTons(value: number): string {
  if (Math.abs(value) < 0.0005) {
    return "";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatValue(value: number): string {
  const thousands = value / 1000;
  if (Math.abs(thousands) < 0.5) {
    return "";
  }
  return Math.round(thousands).toLocaleString("en-US");
}

function buildDisplayRows(
  report: IndustryProductMonthlySalesReport,
): IndustryProductMonthlySalesRow[] {
  return [
    ...report.sections.map((section) => section.productRow),
    report.grandTotalRow,
  ];
}

function MonthColumnGroup({ periodCount }: { periodCount: number }) {
  return (
    <colgroup>
      <col class="ipms-col-label" />
      {Array.from({ length: periodCount }).flatMap((_, index) => [
        <col key={`${index}-tons`} class="ipms-col-metric" />,
        <col key={`${index}-value`} class="ipms-col-metric" />,
      ])}
    </colgroup>
  );
}

function MonthBlock({
  columns,
  rows,
  showYtd,
}: {
  columns: IndustryProductMonthlySalesMonthColumn[];
  rows: IndustryProductMonthlySalesRow[];
  showYtd: boolean;
}) {
  const periodCount = columns.length + (showYtd ? 1 : 0);

  return (
    <div class={`ipms-section ${showYtd ? "ipms-section-h2" : "ipms-section-h1"}`}>
      <table class="scr-table ipms-table">
        <MonthColumnGroup periodCount={periodCount} />
        <thead>
          <tr>
            <th class="ipms-label-col" rowSpan={2} />
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
          {rows.map((row) => (
            <tr
              key={row.id}
              class={row.kind === "total" ? "scr-row scr-row-total" : "scr-row"}
            >
              <td class="ipms-label-col">{row.label}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportDocument({ report }: { report: IndustryProductMonthlySalesReport }) {
  const empty = isIndustryProductMonthlySalesReportEmpty(report);
  const rows = buildDisplayRows(report);

  return (
    <DocumentPreview
        title="Industry product monthly sales"
        fileName={`industry-product-monthly-sales-${report.financialYear}-${report.asAtIso}.pdf`}
        page="landscape"
        bodyClass="ipms-print-landscape"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No Industry sales for non-LPO / non-bottled products in this period."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No Industry sales for non-LPO / non-bottled products in this period."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document ipms-document"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      showComments={!empty}
      showFooter={!empty}
      header={
        empty ? undefined : (
          <ReportHeader
            companyName={report.settings.companyName}
            department={report.settings.department ?? null}
            serviceName={report.settings.serviceName ?? null}
            title={report.reportTitle}
          />
        )
      }
    >
      {empty ? null : (
        <>
          <MonthBlock
            columns={report.monthColumnsH1}
            rows={rows}
            showYtd={false}
          />
          <MonthBlock columns={report.monthColumnsH2} rows={rows} showYtd />
          <p class="ipms-footnote">Value in &apos;000 FRS · taxes excluded</p>
        </>
      )}
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function IndustryProductMonthlySalesScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<IndustryProductMonthlySalesReport | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data =
          await getAuthenticatedReports().getIndustryProductMonthlySales();
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
    return (
      <p class="scr-status">Loading industry product monthly sales report…</p>
    );
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page ipms-page">
            <ReportDocument report={report} />
    </div>
  );
}
