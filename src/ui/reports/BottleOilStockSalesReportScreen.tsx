import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import type {
  BottleOilSalesRow,
  BottleOilSalesSection,
  BottleOilStockSalesReport,
  BottleOilStockSection,
} from "../../shared/reports.types.ts";
import { clampIsoDateToRange, utcIsoDateToday } from "../stock/stockUtils.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { HideZeroRowsToggle } from "./HideZeroRowsToggle.tsx";
import { useHideZeroReportRows } from "./hideZeroReportRows.ts";
import {
  HIDE_ZERO_ROWS_HINT,
  isBottleOilStockSalesReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";

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

function formatKg(value: number | null | undefined): string {
  if (value == null) {
    return "";
  }
  if (value === 0) {
    return "0";
  }
  const rounded = Math.round(value);
  return rounded.toLocaleString("en-US");
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatFcfa(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function StockSection({ section }: { section: BottleOilStockSection }) {
  return (
    <div class="scr-bottled-block bos-stock-section">
      <p class="bos-section-heading">Stock in Units</p>
      <table class="scr-table scr-bottled-table bos-stock-matrix">
        <colgroup>
          <col class="bos-stock-label-col" />
          {section.columns.map((column) => (
            <col key={`unit-col-${column.id}`} class="bos-stock-pack-col" />
          ))}
          <col class="bos-stock-total-col" />
        </colgroup>
        <thead>
          <tr>
            <th />
            {section.columns.map((column) => (
              <th key={`unit-${column.id}`}>{column.unitLabel}</th>
            ))}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <tr
              key={`units-${row.salesPointName}`}
              class={row.kind === "total" ? "scr-row scr-row-total" : "scr-row"}
            >
              <td class="scr-row-label">{row.salesPointName}</td>
              {row.unitCounts.map((count, index) => (
                <td key={`unit-${row.salesPointName}-${index}`} class="scr-num">
                  {formatQty(count)}
                </td>
              ))}
              <td aria-hidden="true" />
            </tr>
          ))}
        </tbody>
      </table>

      <p>Stock in Kgs</p>

      <table class="scr-table scr-bottled-table bos-stock-matrix">
        <colgroup>
          <col class="bos-stock-label-col" />
          {section.columns.map((column) => (
            <col key={`kg-col-${column.id}`} class="bos-stock-pack-col" />
          ))}
          <col class="bos-stock-total-col" />
        </colgroup>
        <thead>
          <tr>
            <th />
            {section.columns.map((column) => (
              <th key={`kg-${column.id}`}>{column.kgLabel}</th>
            ))}
            <th>TOTAL (KGs)</th>
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <tr
              key={`kgs-${row.salesPointName}`}
              class={row.kind === "total" ? "scr-row scr-row-total" : "scr-row"}
            >
              <td class="scr-row-label">{row.salesPointName}</td>
              {row.kgCounts.map((kg, index) => (
                <td key={`kg-${row.salesPointName}-${index}`} class="scr-num">
                  {formatKg(kg)}
                </td>
              ))}
              <td class="scr-num scr-total-cell">{formatKg(row.rowTotalKg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderSalesCell(
  row: BottleOilSalesRow,
  value: number,
  columnIndex: number,
): string {
  if (row.kind === "percentage" || row.kind === "value_percentage") {
    return formatPercent(value);
  }
  if (row.kind === "value") {
    return formatFcfa(row.values[columnIndex] ?? 0);
  }
  return formatKg(value);
}

function renderSalesTotal(row: BottleOilSalesRow): string {
  if (row.kind === "percentage" || row.kind === "value_percentage") {
    return formatPercent(row.rowTotalKg);
  }
  if (row.kind === "value") {
    return formatFcfa(row.rowTotalValue);
  }
  return formatKg(row.rowTotalKg);
}

/* sales section component */
function SalesSection({ section }: { section: BottleOilSalesSection }) {
  return (
    <div class="scr-bottled-block">
      <p class="bos-section-heading">Bottle Oil Sales By Product todate</p>
      <table class="scr-table scr-bottled-table bos-stock-matrix">
        <colgroup>
          <col class="bos-stock-label-col" />
          {section.columns.map((column) => (
            <col key={`sales-col-${column.id}`} class="bos-stock-pack-col" />
          ))}
          <col class="bos-stock-total-col" />
        </colgroup>
        <thead>
          <tr>
            <th />
            {section.columns.map((column) => (
              <th key={column.id}>{column.label}</th>
            ))}
            <th>TOTAL (KGs)</th>
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row, index) => (
            <tr
              key={`${row.label}-${index}`}
              class={
                row.kind === "total" ||
                row.kind === "percentage" ||
                row.kind === "value" ||
                row.kind === "value_percentage"
                  ? "scr-row scr-row-total"
                  : "scr-row"
              }
            >
              <td class="scr-row-label">{row.label}</td>
              {row.kgs.map((kg, columnIndex) => (
                <td key={`${row.label}-${columnIndex}`} class="scr-num">
                  {renderSalesCell(row, kg, columnIndex)}
                </td>
              ))}
              <td class="scr-num scr-total-cell">{renderSalesTotal(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BottleOilStockSalesReportDocument({
  report,
}: {
  report: BottleOilStockSalesReport;
}) {
  const empty = isBottleOilStockSalesReportEmpty(report);

  return (
    <DocumentPreview
        title="Bottle oil stock sales"
        fileName={`bottle-oil-stock-sales-${report.asAtIso ?? new Date().toISOString().slice(0, 10)}.pdf`}
        page="portrait-weekly"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No bottle-oil stock or sales to display."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No bottle-oil stock or sales to display."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document bos-bottle-oil-report wpp-pack-page weekly-report-tight"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title={`BOTTLE OIL STOCK AND SALES TODATE AS AT ${formatDisplayDate(report.asAtIso)}`}
        />
      }
    >
      <StockSection section={report.stockSection} />
      <SalesSection section={report.salesSection} />
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function BottleOilStockSalesReportScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [hideZero, setHideZero] = useHideZeroReportRows();
  const [postingPeriod, setPostingPeriod] = useState<OpenPostingPeriod | null>(
    null,
  );
  const [asAtIso, setAsAtIso] = useState(() => utcIsoDateToday());
  const [report, setReport] = useState<BottleOilStockSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getAuthenticatedFinancialYears()
      .getOpenPostingPeriod()
      .then((period) => {
        if (!cancelled) {
          setPostingPeriod(period);
          setAsAtIso((current) => clampIsoDateToRange(current, period));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPostingPeriod(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getBottleOilStockSales(
          hideZero,
          asAtIso,
        );
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
  }, [hideZero, asAtIso]);

  if (loading && !report) {
    return (
      <p class="scr-status">Loading bottle oil stock &amp; sales report...</p>
    );
  }

  if (error && !report) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page">
      <div class="scr-toolbar no-print">
        <div class="dsr-filters">
          <label class="dsr-filter">
            <input
              type="date"
              placeholder="As at"
              aria-label="As at date"
              title="As at date"
              value={asAtIso}
              min={postingPeriod?.startDate}
              max={postingPeriod?.endDate}
              disabled={loading || !postingPeriod}
              onInput={(event) =>
                setAsAtIso(
                  clampIsoDateToRange(
                    (event.currentTarget as HTMLInputElement).value,
                    postingPeriod,
                  ),
                )
              }
            />
            {!postingPeriod ? (
              <span>Open a financial month to pick a date.</span>
            ) : null}
          </label>
          <HideZeroRowsToggle
            checked={hideZero}
            disabled={loading}
            onChange={setHideZero}
          />
        </div>
      </div>
      {error ? <p class="scr-status scr-status-error no-print">{error}</p> : null}
      <BottleOilStockSalesReportDocument report={report} />
    </div>
  );
}
