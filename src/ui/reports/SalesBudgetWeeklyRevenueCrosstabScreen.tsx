import { useEffect, useMemo, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type { SalesBudgetWeeklyRevenueCrosstabReport } from "../../shared/reports.types.ts";
import {
  CAL_MONTHS,
  formatPhasedAmountDisplay,
  monthName,
  salesBudgetCrosstabCellKey,
} from "../../shared/salesBudgetPhase.ts";
import { ReportFilterGate } from "./ReportFilterGate.tsx";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { salesBudgetWeeklyRevenueCrosstabEmptyMessage } from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./SalesBudgetCrosstab.css";

interface SalesBudgetWeeklyRevenueCrosstabScreenProps {
  onNavigate?: (routeId: string) => void;
  windowMode?: boolean;
}

export function buildAmountMap(
  report: SalesBudgetWeeklyRevenueCrosstabReport,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of report.amountByCell) {
    map.set(entry.key, entry.amountFcfa);
  }
  return map;
}

function productWeekTotal(
  amountMap: Map<string, number>,
  weekLabel: string,
  productCatId: number,
): number {
  let total = 0;
  for (const month of CAL_MONTHS) {
    total +=
      amountMap.get(salesBudgetCrosstabCellKey(weekLabel, productCatId, month)) ?? 0;
  }
  return total;
}

function productMonthTotals(
  report: SalesBudgetWeeklyRevenueCrosstabReport,
  productCatId: number,
): { monthTotals: number[]; productGrandTotal: number } {
  const monthTotals = CAL_MONTHS.map((month) => {
    const index = report.cols.findIndex(
      (col) => col.productCatId === productCatId && col.month === month,
    );
    return index >= 0 ? (report.colTotals[index] ?? 0) : 0;
  });
  const productGrandTotal = monthTotals.reduce((sum, value) => sum + value, 0);
  return { monthTotals, productGrandTotal };
}

/**
 * Exactly two pages when there are more than 26 weeks (e.g. 52 → 26 + 26).
 * Last page is slightly smaller when the count is odd so totals still fit.
 */
function splitWeeksAcrossTwoPages<T>(weeks: T[]): T[][] {
  if (weeks.length === 0) {
    return [[]];
  }
  if (weeks.length <= 26) {
    return [weeks];
  }
  const mid = Math.ceil(weeks.length / 2);
  return [weeks.slice(0, mid), weeks.slice(mid)];
}

export function SalesBudgetWeeklyRevenueCrosstabDocument({
  report,
  amountMap,
  onNavigate,
}: {
  report: SalesBudgetWeeklyRevenueCrosstabReport;
  amountMap: Map<string, number>;
  onNavigate?: (routeId: string) => void;
}) {
  const emptyMessage = salesBudgetWeeklyRevenueCrosstabEmptyMessage(report);

  return (
    <DocumentPreview
      title="Sales budget weekly revenue"
      fileName={`sales-budget-weekly-revenue-${report.reportYear}.pdf`}
      page="landscape-tight"
      bodyClass="mdr-print-landscape"
      sourceKey={report}
      isEmpty={emptyMessage !== null}
      emptyMessage={emptyMessage ?? ""}
    >
      <ReportDocumentShell
        className="scr-document wpp-pack-page wpp-pack-crosstab sbc-weekly-crosstab"
        isEmpty={emptyMessage !== null}
        emptyMessage={emptyMessage ?? ""}
        comments={report.comments}
        signatoryName={report.settings.signatoryName}
        signatoryTitle={report.settings.signatoryTitle}
        header={
          <ReportHeader
            companyName={report.settings.companyName}
            department={report.settings.department}
            serviceName={report.settings.serviceName}
            title="Sales budget — weekly phasing crosstab (XAF)"
          />
        }
      >
        <div class="sbc-intro-block no-print">
          <p class="sbc-intro">
            {onNavigate ? (
              <>
                <button
                  type="button"
                  class="sbc-link-btn"
                  onClick={() => onNavigate("sales-budget-monthly-revenue-crosstab")}
                >
                  Monthly revenue phasing crosstab
                </button>
                {" · "}
                <button
                  type="button"
                  class="sbc-link-btn"
                  onClick={() => onNavigate("sales-budget-weekly-crosstab")}
                >
                  Weekly kg phasing crosstab
                </button>
              </>
            ) : null}
          </p>
        </div>

        {report.categoriesInReport.flatMap((cat, catIndex) => {
          const { monthTotals, productGrandTotal } = productMonthTotals(
            report,
            cat.productCatId,
          );
          const weekChunks = splitWeeksAcrossTwoPages(report.sortedWeeks);
          return weekChunks.map((weeks, chunkIndex) => {
            const isLastChunk = chunkIndex === weekChunks.length - 1;
            const isFirstSheet = catIndex === 0 && chunkIndex === 0;
            return (
              <section
                key={`${cat.productCatId}-${chunkIndex}`}
                class={`sbc-product-sheet${isFirstSheet ? "" : " sbc-product-sheet-break"}`}
              >
                <div class="sbc-table-wrap sbc-product-sheet-wrap">
                  <table class="sbc-table sbc-table-weekly sbc-table-product-sheet">
                    <thead>
                      <tr>
                        <th
                          class="sbc-product-sheet-title"
                          colSpan={CAL_MONTHS.length + 2}
                        >
                          {cat.label}
                        </th>
                      </tr>
                      <tr>
                        <th class="sbc-sticky-col sbc-week-col">ISO week</th>
                        {CAL_MONTHS.map((month) => (
                          <th
                            key={month}
                            class="sbc-num sbc-month-head"
                            title={monthName(month)}
                          >
                            {monthName(month).slice(0, 3)}
                          </th>
                        ))}
                        <th class="sbc-num sbc-total-col">Row total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeks.map((week) => {
                        const rowTotal = productWeekTotal(
                          amountMap,
                          week.label,
                          cat.productCatId,
                        );
                        return (
                          <tr key={week.label}>
                            <td class="sbc-sticky-col sbc-week-col">{week.label}</td>
                            {CAL_MONTHS.map((month) => {
                              const amount =
                                amountMap.get(
                                  salesBudgetCrosstabCellKey(
                                    week.label,
                                    cat.productCatId,
                                    month,
                                  ),
                                ) ?? 0;
                              return (
                                <td
                                  key={month}
                                  class={`sbc-num sbc-month-head${amount === 0 ? " sbc-zero" : ""}`}
                                >
                                  {amount === 0 ? "—" : formatPhasedAmountDisplay(amount)}
                                </td>
                              );
                            })}
                            <td
                              class={`sbc-num sbc-total-col${rowTotal === 0 ? " sbc-zero" : ""}`}
                            >
                              {rowTotal === 0 ? "—" : formatPhasedAmountDisplay(rowTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {isLastChunk ? (
                      <tfoot>
                        <tr class="sbc-foot">
                          <td class="sbc-sticky-col sbc-week-col">Column totals (XAF)</td>
                          {monthTotals.map((value, monthIndex) => (
                            <td
                              key={monthIndex}
                              class={`sbc-num sbc-month-head${value === 0 ? " sbc-zero" : ""}`}
                            >
                              {value === 0 ? "—" : formatPhasedAmountDisplay(value)}
                            </td>
                          ))}
                          <td
                            class={`sbc-num sbc-total-col${productGrandTotal === 0 ? " sbc-zero" : ""}`}
                          >
                            {productGrandTotal === 0
                              ? "—"
                              : formatPhasedAmountDisplay(productGrandTotal)}
                          </td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
              </section>
            );
          });
        })}
      </ReportDocumentShell>
    </DocumentPreview>
  );
}

export function SalesBudgetWeeklyRevenueCrosstabScreen({
  onNavigate,
  windowMode = false,
}: SalesBudgetWeeklyRevenueCrosstabScreenProps) {
  void windowMode;
  const [report, setReport] = useState<SalesBudgetWeeklyRevenueCrosstabReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getAuthenticatedReports()
      .getSalesBudgetWeeklyRevenueCrosstab()
      .then((data) => {
        if (!cancelled) {
          setReport(data);
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
  }, []);

  const amountMap = useMemo(() => (report ? buildAmountMap(report) : new Map()), [report]);

  if (loading && !report) {
    return <p class="scr-status">Loading sales budget weekly revenue crosstab…</p>;
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
      reportId="sales-budget-weekly-revenue-crosstab"
      className="scr-page sbc-root"
      filters={null}
    >
      <SalesBudgetWeeklyRevenueCrosstabDocument
        report={report}
        amountMap={amountMap}
        onNavigate={onNavigate}
      />
    </ReportFilterGate>
  );
}
