import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type {
  PalmOilSalesActivityReport,
  PalmOilSalesActivityRow,
  PalmOilSalesActivitySection,
} from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { isPalmOilSalesActivityReportEmpty } from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./PalmOilSalesActivityReport.css";

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

function formatAvgPrice(value: number): string {
  if (Math.abs(value) < 0.0005) {
    return "";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "";
  }
  return `${Math.round(value)}%`;
}

function ActivitySectionTable({ section }: { section: PalmOilSalesActivitySection }) {
  const colSpan = section.monthColumns.length * 2 + 3;

  return (
    <div class="posa-section">
      <table class="scr-table posa-table">
        <thead>
          <tr>
            <th class="posa-label-col" rowSpan={2} />
            {section.monthColumns.map((column) => (
              <th key={column.month} colSpan={2}>
                {column.label}
              </th>
            ))}
            <th colSpan={2}>TODATE</th>
            <th class="posa-pct-col" rowSpan={2}>
              %TAGE
            </th>
          </tr>
          <tr>
            {section.monthColumns.flatMap((column) => [
              <th key={`${column.month}-tons`}>TONS</th>,
              <th key={`${column.month}-fcfa`}>FCFA</th>,
            ])}
            <th>TONS</th>
            <th>FCFA</th>
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <ActivityRow
              key={row.id}
              row={row}
              section={section}
              colSpan={colSpan}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityRow({
  row,
  section,
  colSpan,
}: {
  row: PalmOilSalesActivityRow;
  section: PalmOilSalesActivitySection;
  colSpan: number;
}) {
  if (row.kind === "section") {
    return (
      <tr class="scr-row-header">
        <td colSpan={colSpan}>
          <strong>{row.label}</strong>
        </td>
      </tr>
    );
  }

  const rowClass =
    row.kind === "total"
      ? "scr-row scr-row-total"
      : row.kind === "avg_price" || row.kind === "budget"
        ? "scr-row"
        : "scr-row";

  return (
    <tr class={rowClass}>
      <td class="posa-label-col">{row.label}</td>
      {section.monthColumns.flatMap((_column, index) => {
        const cell = row.months[index] ?? { tons: 0, value: 0 };
        if (row.kind === "budget") {
          return [
            <td key={`${row.id}-${index}-tons`} class="scr-num" />,
            <td key={`${row.id}-${index}-fcfa`} class="scr-num" />,
          ];
        }
        if (row.kind === "avg_price") {
          return [
            <td key={`${row.id}-${index}-tons`} class="scr-num">
              {formatTons(cell.tons)}
            </td>,
            <td key={`${row.id}-${index}-fcfa`} class="scr-num">
              {formatAvgPrice(cell.value)}
            </td>,
          ];
        }
        return [
          <td key={`${row.id}-${index}-tons`} class="scr-num">
            {formatTons(cell.tons)}
          </td>,
          <td key={`${row.id}-${index}-fcfa`} class="scr-num">
            {formatValue(cell.value)}
          </td>,
        ];
      })}
      {row.kind === "budget" ? (
        <>
          <td class="scr-num" />
          <td class="scr-num">
            {row.toDate.value > 0 ? `BUDG. ${formatAvgPrice(row.toDate.value)}` : ""}
          </td>
        </>
      ) : row.kind === "avg_price" ? (
        <>
          <td class="scr-num">{formatTons(row.toDate.tons)}</td>
          <td class="scr-num">{formatAvgPrice(row.toDate.value)}</td>
        </>
      ) : (
        <>
          <td class="scr-num">{formatTons(row.toDate.tons)}</td>
          <td class="scr-num">{formatValue(row.toDate.value)}</td>
        </>
      )}
      <td class="scr-num posa-pct-col">{formatPct(row.pctTage)}</td>
    </tr>
  );
}

function ReportDocument({ report }: { report: PalmOilSalesActivityReport }) {
  const empty = isPalmOilSalesActivityReportEmpty(report);

  return (
    <DocumentPreview
        title="Palm oil sales activity"
        fileName={`palm-oil-sales-activity-${report.financialYear}-${report.asAtIso}.pdf`}
        page="landscape"
        bodyClass="posa-print-landscape"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No palm oil sales activity for this year."
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No palm oil sales activity for this year."
      className="scr-document posa-document"
      
      
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
      <ActivitySectionTable section={report.looseOilSection} />
      <ActivitySectionTable section={report.looseAndBtldSection} />
      <p class="posa-footnote">Value in &apos;000 FRS · taxes excluded</p>
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function PalmOilSalesActivityScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<PalmOilSalesActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getPalmOilSalesActivity();
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

  if (loading && !report) {
    return <p class="scr-status">Loading palm oil sales activity report…</p>;
  }

  if (error && !report) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page posa-page">
      
      {error ? <p class="scr-status scr-status-error no-print">{error}</p> : null}

      <ReportDocument report={report} />
    </div>
  );
}
