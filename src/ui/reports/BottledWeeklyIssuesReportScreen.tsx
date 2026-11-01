import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type {
  BottledWeeklyEstimateBasis,
  BottledWeeklyIssuesReport,
} from "../../shared/reports.types.ts";
import { BOTTLED_WEEKLY_ESTIMATE_BASIS_OPTIONS } from "../../shared/reports.types.ts";
import { ReportFilterGate } from "./ReportFilterGate.tsx";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import {
  HIDE_ZERO_ROWS_HINT,
  isBottledWeeklyIssuesReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./BottledWeeklyIssuesReport.css";
import "./SalesBudgetCrosstab.css";

const ESTIMATE_BASIS_STORAGE_KEY = "bwi-estimate-basis";

function readStoredEstimateBasis(): BottledWeeklyEstimateBasis {
  try {
    const value = localStorage.getItem(ESTIMATE_BASIS_STORAGE_KEY);
    return value === "iso-week" ? "iso-week" : "working-days";
  } catch {
    return "working-days";
  }
}

function writeStoredEstimateBasis(basis: BottledWeeklyEstimateBasis): void {
  try {
    localStorage.setItem(ESTIMATE_BASIS_STORAGE_KEY, basis);
  } catch {
    /* ignore quota / private mode */
  }
}

function formatQty(value: number | null | undefined): string {
  if (value == null) return "";
  if (value === 0) return "0";
  return Math.round(value).toLocaleString("en-US");
}

function formatFcfa(value: number | null | undefined): string {
  if (value == null) return "";
  if (value === 0) return "0";
  return Math.round(value).toLocaleString("en-US");
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatAvgPrice(value: number | null): string {
  if (value == null) return "";
  return Math.round(value).toLocaleString("en-US");
}

/** Detail-table cells: null/zero render as "-". */
function dashQty(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < 1e-9) return "-";
  return Math.round(value).toLocaleString("en-US");
}

function dashFcfa(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < 1e-9) return "-";
  return Math.round(value).toLocaleString("en-US");
}

export function BottledWeeklyIssuesReportDocument({
  report,
}: {
  report: BottledWeeklyIssuesReport;
}) {
  const empty = isBottledWeeklyIssuesReportEmpty(report);
  const packColumns = report.detail.packColumns;
  const footerRowSpan = 1 + report.detail.footer.length;

  return (
    <DocumentPreview
        title="Bottled weekly issues"
        fileName={`bottled-weekly-issues-${report.weekToIso ?? report.asAtIso}.pdf`}
        page="portrait-weekly"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No bottled weekly issues for this period."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No bottled weekly issues for this period."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document bwi-document wpp-pack-page weekly-report-tight"
      
      
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
      <div class="scr-bottled-block">
        <table class="scr-table bwi-detail-table">
          <thead>
            <tr>
              <th>MONTH {report.detail.monthLabel}</th>
              <th>METHOD PAYMT</th>
              {packColumns.map((column) => (
                <th key={column.id} class="bwi-pack-col">
                  {column.label}
                </th>
              ))}
              <th>TOTAL</th>
              <th>VALUE FCFA</th>
              <th class="bwi-mtd-col">MONTH TO DATE</th>
            </tr>
          </thead>
          <tbody>
            {report.detail.days.map((day) =>
              day.methods.map((row, methodIndex) => (
                <tr key={`${day.id}-${row.method}`} class="scr-row">
                  {methodIndex === 0 ? (
                    <td class="scr-row-label bwi-day-cell" rowSpan={3}>
                      <div class="bwi-day-name">{day.label}</div>
                      <div class="bwi-day-date">{day.displayDate}</div>
                    </td>
                  ) : null}
                  <td class="scr-row-label">{row.label}</td>
                  {row.packUnits.map((units, packIndex) => (
                    <td
                      key={`${day.id}-${row.method}-p${packIndex}`}
                      class="scr-num bwi-pack-col"
                    >
                      {dashQty(units)}
                    </td>
                  ))}
                  <td class="scr-num scr-total-cell">{dashQty(row.totalUnits)}</td>
                  <td class="scr-num">{dashFcfa(row.valueFcfa)}</td>
                  <td class="scr-num bwi-mtd-col">
                    {Math.abs(row.valueFcfa) > 1e-9 || Math.abs(row.totalUnits) > 1e-9
                      ? dashFcfa(row.monthToDateValue)
                      : "-"}
                  </td>
                </tr>
              )),
            )}
            <tr class="scr-row scr-row-total">
              <td class="scr-row-label" rowSpan={footerRowSpan}>
                TOTAL
              </td>
              <td class="scr-row-label" />
              {report.detail.totals.packUnits.map((units, packIndex) => (
                <td key={`total-p${packIndex}`} class="scr-num bwi-pack-col">
                  {dashQty(units)}
                </td>
              ))}
              <td class="scr-num scr-total-cell">
                {dashQty(report.detail.totals.totalUnits)}
              </td>
              <td class="scr-num">{dashFcfa(report.detail.totals.valueFcfa)}</td>
              <td class="scr-num bwi-mtd-col">
                {dashFcfa(report.detail.totals.monthToDateValue)}
              </td>
            </tr>
            {report.detail.footer.map((row) => (
              <tr key={row.id} class="scr-row bwi-footer-row">
                <td class="scr-row-label">{row.label}</td>
                {row.packValues.map((value, packIndex) => (
                  <td key={`${row.id}-p${packIndex}`} class="scr-num bwi-pack-col">
                    {row.id === "value" ? dashFcfa(value) : dashQty(value)}
                  </td>
                ))}
                <td class="scr-num scr-total-cell">
                  {row.id === "value" ? dashFcfa(row.total) : dashQty(row.total)}
                </td>
                <td class="scr-num">
                  {row.id === "value" ? dashFcfa(row.valueFcfa) : "-"}
                </td>
                <td class="scr-num bwi-mtd-col">
                  {row.id === "value" ? dashFcfa(row.monthToDateValue) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="scr-bottled-block">
        <table class="scr-table bwi-summary-table">
          <thead>
            <tr>
              <th rowSpan={2}>{report.summary.title}</th>
              <th colSpan={2}>
                WEEK
                <div class="bwi-estimate-basis-note">
                  ESTM: {report.estimateBasisLabel}
                </div>
              </th>
              <th colSpan={2}>MONTH TO DATE</th>
              <th colSpan={2}>YEAR TO DATE</th>
              <th rowSpan={2}>AVERAGE PRICE FCFA/KG</th>
            </tr>
            <tr>
              <th>KGS</th>
              <th>FCFA</th>
              <th>KGS</th>
              <th>FCFA</th>
              <th>KGS</th>
              <th>FCFA</th>
            </tr>
          </thead>
          <tbody>
            {report.summary.rows.map((row) => (
              <tr
                key={row.id}
                class={row.id === "actual" ? "scr-row scr-row-total" : "scr-row"}
              >
                <td class="scr-row-label">{row.label}</td>
                <td class="scr-num">
                  {row.id === "pct"
                    ? formatPercent(row.week.kgs)
                    : formatQty(row.week.kgs)}
                </td>
                <td class="scr-num">
                  {row.id === "pct"
                    ? formatPercent(row.week.value)
                    : formatFcfa(row.week.value)}
                </td>
                <td class="scr-num">
                  {row.id === "pct"
                    ? formatPercent(row.monthToDate.kgs)
                    : formatQty(row.monthToDate.kgs)}
                </td>
                <td class="scr-num">
                  {row.id === "pct"
                    ? formatPercent(row.monthToDate.value)
                    : formatFcfa(row.monthToDate.value)}
                </td>
                <td class="scr-num">
                  {row.id === "pct"
                    ? formatPercent(row.yearToDate.kgs)
                    : formatQty(row.yearToDate.kgs)}
                </td>
                <td class="scr-num">
                  {row.id === "pct"
                    ? formatPercent(row.yearToDate.value)
                    : formatFcfa(row.yearToDate.value)}
                </td>
                <td class="scr-num">{formatAvgPrice(row.averagePrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="scr-bottled-block">
        <table class="scr-table bwi-compare-table">
          <thead>
            <tr>
              <th>METHOD</th>
              <th>{report.compare.currentColumn.label}</th>
              <th>%</th>
              <th>{report.compare.priorColumn.label}</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {report.compare.rows.map((row) => (
              <tr
                key={row.method}
                class={row.method === "TOTAL" ? "scr-row scr-row-total" : "scr-row"}
              >
                <td class="scr-row-label">{row.label}</td>
                <td class="scr-num">{formatQty(row.currentKg)}</td>
                <td class="scr-num">{formatPercent(row.currentPct)}</td>
                <td class="scr-num">{formatQty(row.priorKg)}</td>
                <td class="scr-num">{formatPercent(row.priorPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function BottledWeeklyIssuesReportScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [estimateBasis, setEstimateBasis] = useState<BottledWeeklyEstimateBasis>(
    readStoredEstimateBasis,
  );
  const [weekMondayIso, setWeekMondayIso] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<BottledWeeklyIssuesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getBottledWeeklyIssues(
          estimateBasis,
          weekMondayIso,
        );
        if (!cancelled) setReport(data);
      } catch (loadError) {
        if (!cancelled) {
          setReport(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load bottled weekly issues report.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [estimateBasis, weekMondayIso]);

  function onEstimateBasisChange(next: BottledWeeklyEstimateBasis) {
    writeStoredEstimateBasis(next);
    setEstimateBasis(next);
  }

  if (loading && !report) {
    return <p class="scr-status">Loading bottled weekly issues...</p>;
  }
  if (error && !report) return <p class="scr-status scr-status-error">{error}</p>;
  if (!report) return <p class="scr-status">No report data available.</p>;

  const basisHint =
    BOTTLED_WEEKLY_ESTIMATE_BASIS_OPTIONS.find((option) => option.id === estimateBasis)
      ?.hint ?? "";

  return (
    <ReportFilterGate
      ready
      reportId="bottled-weekly-issues-report"
      className="scr-page sbc-root"
      filters={
        <>
      <div class="scr-toolbar no-print sbc-toolbar">
        {report.weekChoices.length > 0 ? (
          <div class="sbc-year-picker" aria-label="Week in open month">
            {report.weekChoices.map((week) => (
              <button
                key={week.weekMondayIso}
                type="button"
                class={`sbc-year-btn${week.weekMondayIso === report.weekMondayIso ? " is-active" : ""}`}
                disabled={loading}
                onClick={() => setWeekMondayIso(week.weekMondayIso)}
              >
                {week.label}
              </button>
            ))}
          </div>
        ) : null}
        <label class="bwi-estimate-basis">
          <span>Week ESTM</span>
          <select
            value={estimateBasis}
            disabled={loading}
            title={basisHint}
            onChange={(event) => {
              const value = (event.currentTarget as HTMLSelectElement).value;
              onEstimateBasisChange(value === "iso-week" ? "iso-week" : "working-days");
            }}
          >
            {BOTTLED_WEEKLY_ESTIMATE_BASIS_OPTIONS.map((option) => (
              <option key={option.id} value={option.id} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p class="scr-status scr-status-error no-print">{error}</p> : null}
      <p class="bwi-estimate-hint no-print">
        {basisHint}
        {report.estimateWeekDaysInMonth > 0
          ? ` · ${report.estimateWeekDaysInMonth} day(s) of the open month in this week window.`
          : null}
      </p>
        </>
      }
    >
      <BottledWeeklyIssuesReportDocument report={report} />
    </ReportFilterGate>
  );
}
