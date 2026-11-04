import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import type {
  StockCommitmentBottledSection,
  StockCommitmentReport,
  StockCommitmentReportRow,
} from "../../shared/reports.types.ts";
import { clampIsoDateToRange, utcIsoDateToday } from "../stock/stockUtils.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { HideZeroRowsToggle } from "./HideZeroRowsToggle.tsx";
import { useHideZeroReportRows } from "./hideZeroReportRows.ts";
import {
  HIDE_ZERO_ROWS_HINT,
  isStockCommitmentReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";

function formatKg(value: number | null | undefined): string {
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

function formatUnits(value: number | null | undefined): string {
  if (value == null || value === 0) {
    return "0";
  }
  return Math.round(value).toLocaleString("en-US");
}

function isJugPackLabel(label: string): boolean {
  const text = label.toUpperCase();
  return text.includes("20L") || text.includes("JUG");
}

function bottledPackColClass(label: string): string {
  const classes = ["scr-bottled-pack-col", "sr-bottled-product-col"];
  if (isJugPackLabel(label)) {
    classes.push("scr-bottled-pack-col--jug");
  }
  return classes.join(" ");
}

function rowClassName(row: StockCommitmentReportRow): string {
  if (row.kind === "header") {
    return "scr-row scr-row-header";
  }
  if (row.kind === "subtotal" || row.kind === "total" || row.kind === "grand_total") {
    return "scr-row scr-row-total";
  }
  return row.indent ? "scr-row scr-row-indent" : "scr-row";
}

function BottledSection({ section }: { section: StockCommitmentBottledSection }) {
  return (
    <div class="scr-bottled-block">
      <table class="scr-table scr-bottled-table sr-report-matrix sr-bottled-products">
        <colgroup>
          <col class="sr-col-label" />
          {section.columns.map((column) => (
            <col key={column.id} class={bottledPackColClass(column.label)} />
          ))}
          <col class="sr-col-last" />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={section.columns.length + 2} class="scr-section-title">
              {section.sectionNo}. {section.title}
            </th>
          </tr>
          <tr>
            <th />
            {section.columns.map((column) => (
              <th
                key={column.id}
                class={`sr-bottled-product-head ${bottledPackColClass(column.label)}`}
                title={column.label}
              >
                {column.label}
              </th>
            ))}
            <th>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="scr-row-label">UNITS</td>
            {section.unitCounts.map((count, index) => (
              <td
                key={`units-${index}`}
                class={`scr-num ${bottledPackColClass(section.columns[index]?.label ?? "")}`}
              >
                {formatUnits(count)}
              </td>
            ))}
            <td class="scr-num scr-total-cell">{formatUnits(section.totalUnits)}</td>
          </tr>
          <tr>
            <td class="scr-row-label">LITRES</td>
            {section.litres.map((litre, index) => (
              <td
                key={`litres-${index}`}
                class={`scr-num ${bottledPackColClass(section.columns[index]?.label ?? "")}`}
              >
                {formatUnits(litre)}
              </td>
            ))}
            <td class="scr-num scr-total-cell">{formatUnits(section.totalLitres)}</td>
          </tr>
          <tr>
            <td class="scr-row-label">KGS</td>
            {section.kgs.map((kg, index) => (
              <td
                key={`kgs-${index}`}
                class={`scr-num ${bottledPackColClass(section.columns[index]?.label ?? "")}`}
              >
                {formatKg(kg)}
              </td>
            ))}
            <td class="scr-num scr-total-cell">{formatKg(section.totalKgs)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function StockCommitmentReportDocument({
  report,
}: {
  report: StockCommitmentReport;
}) {
  const empty = isStockCommitmentReportEmpty(report);

  return (
    <DocumentPreview
        title="Stock commitment"
        fileName={`stock-commitment-${report.asAtIso}.pdf`}
        page="portrait-weekly"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No stock or commitment quantities to display."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No stock or commitment quantities to display."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document sr-stock-compact sr-stock-report wpp-pack-page weekly-report-tight"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title={`STOCK VS COMMITMENTS AS AT ${formatDisplayDate(report.asAtIso)}`}
        />
      }
    >
      <table class="scr-table scr-stock-main-table">
        <thead>
          <tr>
            <th>PRODUCT</th>
            <th class="scr-col-sales-point">SALES POINT</th>
            <th>STOCK (KG)</th>
            <th>COMMITMENTS (KG)</th>
            <th>BALANCE (KG)</th>
          </tr>
        </thead>
        <tbody>
          {report.sections.map((section) =>
            section.rows.map((row, index) => (
              <tr key={`${section.sectionNo}-${index}`} class={rowClassName(row)}>
                <td>{row.kind === "header" ? row.label : row.label}</td>
                <td class="scr-col-sales-point">
                  {row.salesPointName ?? (row.kind === "data" ? "" : "")}
                </td>
                <td class="scr-num">{formatKg(row.stockKg)}</td>
                <td class="scr-num">{formatKg(row.commitmentKg)}</td>
                <td class="scr-num">{formatKg(row.balanceKg)}</td>
              </tr>
            )),
          )}
          {report.looseGrandTotal ? (
            <tr class={rowClassName(report.looseGrandTotal)}>
              <td>{report.looseGrandTotal.label}</td>
              <td class="scr-col-sales-point">
                {report.looseGrandTotal.salesPointName ?? ""}
              </td>
              <td class="scr-num">{formatKg(report.looseGrandTotal.stockKg)}</td>
              <td class="scr-num">{formatKg(report.looseGrandTotal.commitmentKg)}</td>
              <td class="scr-num">{formatKg(report.looseGrandTotal.balanceKg)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {report.bottledSection ? (
        <BottledSection section={report.bottledSection} />
      ) : null}
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function StockCommitmentReportScreen({
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
  const [report, setReport] = useState<StockCommitmentReport | null>(null);
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
        const data = await getAuthenticatedReports().getStockCommitment(
          hideZero,
          asAtIso,
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
  }, [hideZero, asAtIso]);

  if (loading && !report) {
    return <p class="scr-status">Loading stock &amp; commitment report...</p>;
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
      <StockCommitmentReportDocument report={report} />
    </div>
  );
}
