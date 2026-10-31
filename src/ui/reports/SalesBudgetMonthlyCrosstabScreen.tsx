import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { useEffect, useState } from "preact/hooks";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDateTime } from "../../shared/formatDisplayDate.ts";
import type { SalesBudgetMonthlyCrosstabReport } from "../../shared/reports.types.ts";
import {
  CAL_MONTHS,
  formatPhasedQtyKgDisplay,
  monthName,
} from "../../shared/salesBudgetPhase.ts";
import { ReportFilterGate } from "./ReportFilterGate.tsx";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { salesBudgetMonthlyCrosstabEmptyMessage } from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./SalesBudgetCrosstab.css";

interface SalesBudgetMonthlyCrosstabScreenProps {
  onNavigate?: (routeId: string) => void;
  windowMode?: boolean;
}




function formatGeneratedAt(iso: string): string {
  return formatDisplayDateTime(iso);
}

export function SalesBudgetMonthlyCrosstabScreen({
  onNavigate,
  windowMode = false,
}: SalesBudgetMonthlyCrosstabScreenProps) {
  void windowMode;
  const [report, setReport] = useState<SalesBudgetMonthlyCrosstabReport | null>(null);
  const [reportYear, setReportYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getAuthenticatedReports()
      .getSalesBudgetMonthlyCrosstab(reportYear ?? undefined)
      .then((data) => {
        if (!cancelled) {
          setReport(data);
          setReportYear(data.reportYear);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load report.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reportYear]);

  if (loading && !report) {
    return <p class="scr-status">Loading sales budget monthly crosstab…</p>;
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data.</p>;
  }

  return (
    <ReportFilterGate
      ready
      reportId="sales-budget-monthly-crosstab"
      className="scr-page sbc-root"
      filters={
      <div class="sbc-toolbar no-print">
        <div class="sbc-year-picker">
          {report.yearChoices.map((year) => (
            <button
              key={year}
              type="button"
              class={`sbc-year-btn${year === report.reportYear ? " is-active" : ""}`}
              onClick={() => setReportYear(year)}
            >
              {year}
            </button>
          ))}
        </div>
      </div>
      }
    >
      <DocumentPreview
        title="Sales budget monthly"
        fileName={`sales-budget-monthly-${report.reportYear}.pdf`}
        page="landscape-tight"
        bodyClass="mdr-print-landscape"
        sourceKey={report}
        isEmpty={salesBudgetMonthlyCrosstabEmptyMessage(report) !== null}
        emptyMessage={salesBudgetMonthlyCrosstabEmptyMessage(report) ?? ""}
      >
      <ReportDocumentShell
      isEmpty={salesBudgetMonthlyCrosstabEmptyMessage(report) !== null}
      emptyMessage={salesBudgetMonthlyCrosstabEmptyMessage(report) ?? ""}
      className="scr-document"
        
        
        comments={report.comments}
        signatoryName={report.settings.signatoryName}
        signatoryTitle={report.settings.signatoryTitle}
        header={
          <ReportHeader
            companyName={report.settings.companyName}
            department={report.settings.department}
            serviceName={report.settings.serviceName}
            title="Sales budget — monthly phasing crosstab (kg)"
          />
        }
      >
        <div>
          <p class="sbc-intro">
            Calendar year <strong>{report.reportYear}</strong>. Rows are budget groups; columns are
            January–December. Each cell is phased budget kg for the fiscal period that contains
            that calendar month (from Sales budgets).{" "}
            {onNavigate ? (
              <>
                <button
                  type="button"
                  class="sbc-link-btn"
                  onClick={() => onNavigate("sales-budget-weekly-crosstab")}
                >
                  Weekly phasing crosstab
                </button>
                {" · "}
                <button
                  type="button"
                  class="sbc-link-btn"
                  onClick={() => onNavigate("sales-budget-monthly-revenue-crosstab")}
                >
                  Monthly revenue phasing crosstab
                </button>
              </>
            ) : (
              "See also the weekly phasing and monthly revenue phasing crosstabs."
            )}
            .
          </p>
          <p class="sbc-intro-meta">Generated {formatGeneratedAt(report.generatedAtIso)}</p>
        </div>

        <div class="sbc-table-wrap">
          <table class="sbc-table">
              <thead>
                <tr>
                  <th class="sbc-sticky-col sbc-product-col">Budget group</th>
                  {CAL_MONTHS.map((month) => (
                    <th key={month} class="sbc-num" title={monthName(month)}>
                      {monthName(month).slice(0, 3)}
                    </th>
                  ))}
                  <th class="sbc-num sbc-total-col">Total</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.productCatId}>
                    <td class="sbc-sticky-col sbc-product-col">{row.label}</td>
                    {row.cells.map((kg, index) => (
                      <td
                        key={index}
                        class={`sbc-num${kg === 0 ? " sbc-zero" : ""}`}
                      >
                        {kg === 0 ? "—" : formatPhasedQtyKgDisplay(kg)}
                      </td>
                    ))}
                    <td class={`sbc-num sbc-total-col${row.rowTotal === 0 ? " sbc-zero" : ""}`}>
                      {row.rowTotal === 0 ? "—" : formatPhasedQtyKgDisplay(row.rowTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr class="sbc-foot">
                  <td class="sbc-sticky-col">Column totals (kg)</td>
                  {report.colTotals.map((value, index) => (
                    <td key={index} class={`sbc-num${value === 0 ? " sbc-zero" : ""}`}>
                      {value === 0 ? "—" : formatPhasedQtyKgDisplay(value)}
                    </td>
                  ))}
                  <td class={`sbc-num sbc-total-col${report.grandTotal === 0 ? " sbc-zero" : ""}`}>
                    {report.grandTotal === 0 ? "—" : formatPhasedQtyKgDisplay(report.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
      </ReportDocumentShell>
      </DocumentPreview>
    </ReportFilterGate>
  );
}
