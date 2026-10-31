import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type {
  MonthlyDeliveryBudgetSection,
  MonthlyDeliveryReport,
} from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import {
  HIDE_ZERO_ROWS_HINT,
  isMonthlyDeliveryReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./MonthlyDeliveryReport.css";

interface MonthlyDeliveryReportScreenProps {
  half: 1 | 2;
  windowMode?: boolean;
}

function formatTons(value: number): string {
  if (value === 0) {
    return "0";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatEstimateTons(value: number): string {
  if (value === 0) {
    return "0";
  }
  return Math.round(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Display FCFA amounts in thousands (000 FCFA). */
function toThousands(value: number): number {
  return value / 1000;
}

function formatValue(value: number): string {
  const thousands = toThousands(value);
  if (thousands === 0) {
    return "0";
  }
  return Math.round(thousands).toLocaleString("en-US");
}

function formatAvgPrice(value: number): string {
  if (value === 0) {
    return "0";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatPct(actual: number, estimate: number): string {
  if (estimate === 0) {
    return actual === 0 ? "0.00%" : "—";
  }
  return `${((actual / estimate) * 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatVariance(value: number): string {
  const thousands = Math.round(toThousands(value));
  const abs = Math.abs(thousands).toLocaleString("en-US");
  return thousands < 0 ? `(${abs})` : abs;
}

function BudgetTable({
  section,
  showGrandTotal,
}: {
  section: MonthlyDeliveryBudgetSection;
  showGrandTotal: boolean;
}) {
  /** Shared widths so the kernel table lines up with the first 13 columns of the main table. */
  const cornerWidth = 88;
  const dataColWidth = 92;
  const gTotalColWidth = 100;
  const varianceColWidth = 110;
  const dataColCount = section.metrics.length * 4;
  const tableWidth =
    cornerWidth +
    dataColCount * dataColWidth +
    (showGrandTotal ? gTotalColWidth * 2 + varianceColWidth : 0);

  return (
    <div class="mdr-budget-block">
      <table
        class={`mdr-budget-table${showGrandTotal ? "" : " mdr-budget-table-kernel"}`}
        style={{ width: `${tableWidth}px` }}
      >
        <colgroup>
          <col style={{ width: `${cornerWidth}px` }} />
          {Array.from({ length: dataColCount }, (_, index) => (
            <col key={`data-${index}`} style={{ width: `${dataColWidth}px` }} />
          ))}
          {showGrandTotal ? (
            <>
              <col style={{ width: `${gTotalColWidth}px` }} />
              <col style={{ width: `${gTotalColWidth}px` }} />
              <col style={{ width: `${varianceColWidth}px` }} />
            </>
          ) : null}
        </colgroup>
        <thead>
          <tr>
            <th class="mdr-budget-corner" rowSpan={2}>
              {section.title}
            </th>
            {section.metrics.flatMap((metric) => [
              <th key={`${metric.id}-tons`} colSpan={2}>
                {metric.tonsLabel}
              </th>,
              <th key={`${metric.id}-value`} colSpan={2}>
                {metric.valueLabel}
              </th>,
            ])}
            {showGrandTotal ? (
              <>
                <th colSpan={2}>G.TOTAL</th>
                <th rowSpan={2}>variance</th>
              </>
            ) : null}
          </tr>
          <tr>
            {section.metrics.flatMap((metric) => [
              <th key={`${metric.id}-te`}>ESTIMATE</th>,
              <th key={`${metric.id}-ta`}>ACTUAL</th>,
              <th key={`${metric.id}-ve`}>ESTIMATE</th>,
              <th key={`${metric.id}-va`}>ACTUAL</th>,
            ])}
            {showGrandTotal ? (
              <>
                <th>ESTIMATE</th>
                <th>ACTUAL</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {/* <tr>
            <td class="mdr-budget-row-label">ESTIMATES</td>
            {section.metrics.flatMap((metric) => [
              <td key={`${metric.id}-eh`} />,
              <td key={`${metric.id}-ah`} />,
              <td key={`${metric.id}-evh`} />,
              <td key={`${metric.id}-avh`} />,
            ])}
            {showGrandTotal ? (
              <>
                <td />
                <td>(000 FCFA)</td>
                <td />
              </>
            ) : null}
          </tr> */}
          <tr class="mdr-budget-to-date">
            <td class="mdr-budget-row-label">EST TO-DATE</td>
            {section.metrics.flatMap((metric) => [
              <td key={`${metric.id}-et`} class="mdr-num">
                {formatEstimateTons(metric.estimateTons)}
              </td>,
              <td key={`${metric.id}-at`} class="mdr-num">
                {formatTons(metric.actualTons)}
              </td>,
              <td key={`${metric.id}-ev`} class="mdr-num">
                {formatValue(metric.estimateValue)}
              </td>,
              <td key={`${metric.id}-av`} class="mdr-num">
                {formatValue(metric.actualValue)}
              </td>,
            ])}
            {showGrandTotal ? (
              <>
                <td class="mdr-num">{formatValue(section.grandEstimateValue)}</td>
                <td class="mdr-num">{formatValue(section.grandActualValue)}</td>
                <td class="mdr-num mdr-budget-variance">
                  {formatVariance(section.variance)}
                </td>
              </>
            ) : null}
          </tr>
          <tr class="mdr-budget-pct">
            <td class="mdr-budget-row-label">%TAGE</td>
            {section.metrics.flatMap((metric) => [
              <td key={`${metric.id}-pte`} />,
              <td key={`${metric.id}-pta`} class="mdr-num">
                {formatPct(metric.actualTons, metric.estimateTons)}
              </td>,
              <td key={`${metric.id}-pve`} />,
              <td key={`${metric.id}-pva`} class="mdr-num">
                {formatPct(metric.actualValue, metric.estimateValue)}
              </td>,
            ])}
            {showGrandTotal ? (
              <>
                <td />
                <td class="mdr-num">
                  {formatPct(section.grandActualValue, section.grandEstimateValue)}
                </td>
                <td />
              </>
            ) : null}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function MonthlyDeliveryReportScreen({
  half,
  windowMode = false,
}: MonthlyDeliveryReportScreenProps) {
  void windowMode;
  const [report, setReport] = useState<MonthlyDeliveryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getMonthlyDelivery(half);
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
  }, [half]);

  if (loading) {
    return <p class="scr-status">Loading monthly delivery report...</p>;
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  const subColSpan = 2;

  return (
    <div class="scr-page mdr-page">
      <DocumentPreview
        title="Monthly delivery"
        fileName={`monthly-delivery-h${half}-${report.asAtIso}.pdf`}
        page="landscape-wide"
        bodyClass="mdr-print-landscape"
        sourceKey={report}
        isEmpty={isMonthlyDeliveryReportEmpty(report)}
        emptyMessage="No delivery data for this period."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={isMonthlyDeliveryReportEmpty(report)}
      emptyMessage="No delivery data for this period."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document mdr-document sr-stock-compact"
        
        
        comments={report.comments}
        signatoryName={report.settings.signatoryName}
        signatoryTitle={report.settings.signatoryTitle}
        header={
          <ReportHeader
            companyName={report.settings.companyName}
            department={report.settings.department ?? null}
            serviceName={report.settings.serviceName ?? null}
            title="Monthly delivery / value"
          />
        }
      >
        {report.sections.map((section) => (
          <div key={section.sectionNo} class="scr-bottled-block mdr-section">
            <table class="scr-table mdr-table">
              <thead>
                <tr>
                  <th rowSpan={2} class="mdr-label-col">
                    {section.title}
                  </th>
                  {report.monthColumns.map((column) => (
                    <th key={column.month} colSpan={subColSpan}>
                      {column.label}
                    </th>
                  ))}
                  <th colSpan={subColSpan}>TODATE</th>
                </tr>
                <tr>
                  {report.monthColumns.flatMap((column) => [
                    <th key={`${column.month}-tons`}>TONS</th>,
                    <th key={`${column.month}-value`}>000 FCFA</th>,
                  ])}
                  <th key="todate-tons">TONS</th>
                  <th key="todate-value">000 FCFA</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr
                    key={row.label}
                    class={
                      row.kind === "total" || row.kind === "subtotal"
                        ? "scr-row scr-row-total"
                        : row.kind === "avg_price"
                          ? "scr-row mdr-avg-row"
                          : row.indent
                            ? "scr-row scr-row-indent"
                            : "scr-row"
                    }
                  >
                    <td class="scr-row-label">{row.label}</td>
                    {row.kind === "avg_price" ? (
                      <>
                        {row.months.map((cell, index) => (
                          <td
                            key={`${row.label}-avg-${index}`}
                            colSpan={subColSpan}
                            class="scr-num"
                          >
                            {formatAvgPrice(cell.value)}
                          </td>
                        ))}
                        <td colSpan={subColSpan} class="scr-num scr-total-cell">
                          {formatAvgPrice(row.toDate.value)}
                        </td>
                      </>
                    ) : (
                      <>
                        {row.months.flatMap((cell, index) => [
                          <td key={`${row.label}-t-${index}`} class="scr-num">
                            {formatTons(cell.tons)}
                          </td>,
                          <td key={`${row.label}-v-${index}`} class="scr-num">
                            {formatValue(cell.value)}
                          </td>,
                        ])}
                        <td class="scr-num scr-total-cell">{formatTons(row.toDate.tons)}</td>
                        <td class="scr-num scr-total-cell">{formatValue(row.toDate.value)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <BudgetTable section={report.kernelPkBudgetSection} showGrandTotal={false} />
        <BudgetTable section={report.budgetSection} showGrandTotal={true} />

        <p class="mdr-footnote">
          PKO = palm kernel oil; PKC = palm kernel cake; CPK = cracked palm kernel; UPK = uncracked
          palm kernel. Palm oil estimate = loose + bottled category budgets. Uncracked/cracked
          actuals are products in the Palm Kernel category; P. KERNEL summarises both. Values are
          shown in 000 FCFA (thousands). Budget TO-DATE is year-to-date through as-at: completed
          months at full phase weight, current month prorated by day. Actuals use invoices dated on
          or before as-at. G.TOTAL includes P. KERNEL (000 FCFA). Delivery tables above remain
          half-scoped (Jan–Jun or Jul–Dec).
        </p>
      </ReportDocumentShell>
      </DocumentPreview>
    </div>
  );
}

export function MonthlyDeliveryReportH1Screen({
  windowMode,
}: {
  windowMode?: boolean;
}) {
  return <MonthlyDeliveryReportScreen half={1} windowMode={windowMode} />;
}

export function MonthlyDeliveryReportH2Screen({
  windowMode,
}: {
  windowMode?: boolean;
}) {
  return <MonthlyDeliveryReportScreen half={2} windowMode={windowMode} />;
}
