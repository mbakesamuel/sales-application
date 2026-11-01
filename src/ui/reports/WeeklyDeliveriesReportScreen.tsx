import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type {
  WeeklyDeliveriesLooseRow,
  WeeklyDeliveriesReport,
} from "../../shared/reports.types.ts";
import { ReportFilterGate } from "./ReportFilterGate.tsx";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { HideZeroRowsToggle } from "./HideZeroRowsToggle.tsx";
import { useHideZeroReportRows } from "./hideZeroReportRows.ts";
import {
  HIDE_ZERO_ROWS_HINT,
  isWeeklyDeliveriesReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./SalesBudgetCrosstab.css";

function formatQty(value: number | null | undefined): string {
  if (value == null) {
    return "";
  }
  if (value === 0) {
    return "0";
  }
  const rounded = Math.round(value);
  return rounded.toLocaleString("en-US");
}

function MatrixSection({
  title,
  salesPointNames,
  rows,
}: {
  title: string;
  salesPointNames: string[];
  rows: WeeklyDeliveriesLooseRow[];
}) {
  if (!rows?.length) {
    return null;
  }

  const pointNames = salesPointNames ?? [];

  return (
    <div class="scr-bottled-block">
      <table class="scr-table wd-matrix-table">
        <thead>
          <tr>
            <th colSpan={pointNames.length + 2} class="scr-section-title">
              {title}
            </th>
          </tr>
          <tr>
            <th />
            {pointNames.map((name) => (
              <th key={name}>{name}</th>
            ))}
            <th>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              class={row.kind === "total" ? "scr-row scr-row-total" : "scr-row"}
            >
              <td class="scr-row-label">{row.label}</td>
              {row.quantities.map((qty, index) => (
                <td key={`${row.label}-${index}`} class="scr-num">
                  {formatQty(qty)}
                </td>
              ))}
              <td class="scr-num scr-total-cell">{formatQty(row.rowTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WeeklyDeliveriesReportDocument({
  report,
}: {
  report: WeeklyDeliveriesReport;
}) {
  const empty = isWeeklyDeliveriesReportEmpty(report);

  return (
    <DocumentPreview
        title="Weekly deliveries"
        fileName={`weekly-deliveries-${report.weekToIso}.pdf`}
        page="portrait-weekly"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No deliveries recorded for this week."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No deliveries recorded for this week."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document wpp-pack-page wd-weekly-deliveries weekly-report-tight"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title={`Deliveries of the week (KGs) ${formatDisplayDate(report.weekFromIso)} – ${formatDisplayDate(report.weekToIso)}`}
        />
      }
    >
      <MatrixSection
        title={report.looseSection.title}
        salesPointNames={report.looseSection.salesPointNames}
        rows={report.looseSection.rows}
      />
      <MatrixSection
        title={report.bottledSection.title}
        salesPointNames={report.bottledSection.salesPointNames}
        rows={report.bottledSection.rows}
      />
      <MatrixSection
        title={report.miscSection.title}
        salesPointNames={report.miscSection.salesPointNames}
        rows={report.miscSection.rows}
      />
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function WeeklyDeliveriesReportScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [hideZero, setHideZero] = useHideZeroReportRows();
  const [report, setReport] = useState<WeeklyDeliveriesReport | null>(null);
  const [weekMondayIso, setWeekMondayIso] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getWeeklyDeliveries(
          weekMondayIso,
          hideZero,
        );
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
  }, [weekMondayIso, hideZero]);

  if (loading && !report) {
    return <p class="scr-status">Loading weekly deliveries report...</p>;
  }

  if (error && !report) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <ReportFilterGate
      ready
      reportId="sales-delivery-report"
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
        <HideZeroRowsToggle
          checked={hideZero}
          disabled={loading}
          onChange={setHideZero}
        />
      </div>

      {error ? <p class="scr-status scr-status-error no-print">{error}</p> : null}
        </>
      }
    >
      <WeeklyDeliveriesReportDocument report={report} />
    </ReportFilterGate>
  );
}
