import { Fragment } from "preact";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { useEffect, useState } from "preact/hooks";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import type { DailySalesReport } from "../../shared/reports.types.ts";
import { clampIsoDateToRange, utcIsoDateToday } from "../stock/stockUtils.ts";
import { ReportFilterGate } from "./ReportFilterGate.tsx";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import { isDailySalesReportEmpty } from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./SalesBudgetCrosstab.css";

function formatQty(value: number | null | undefined): string {
  if (value == null) {
    return "";
  }
  if (value === 0) {
    return "0";
  }
  return Math.round(value).toLocaleString("en-US");
}

export function DailySalesReportDocument({ report }: { report: DailySalesReport }) {
  const empty = isDailySalesReportEmpty(report);

  return (
    <DocumentPreview
        title="Daily sales"
        fileName={`daily-sales-${report.reportDateIso}.pdf`}
        page="portrait"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No validated sales for this date."
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No validated sales for this date."
      className="scr-document wpp-pack-page"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title={`DAILY SALES REPORT OF ${formatDisplayDate(report.reportDateIso)}`}
        />
      }
    >
      <div class="scr-bottled-block">
        <table class="scr-table dsr-table">
          <thead>
            <tr>
              <th>SN</th>
              <th>CUSTOMER</th>
              <th>DO. NO.</th>
              <th>DATE ISSUED</th>
              <th>VEHICLE. NO</th>
              <th class="scr-num">QUANTITY</th>
              <th class="scr-num">DO. BALANCE</th>
            </tr>
          </thead>
          <tbody>
            {report.sections.map((section) => (
              <Fragment key={section.productName}>
                <tr key={`${section.productName}-header`} class="scr-row-header">
                  <td colSpan={7}>
                    <strong>{section.productName.toUpperCase()}</strong>
                  </td>
                </tr>
                {section.rows.map((row) => (
                  <tr key={`${section.productName}-${row.sn}`} class="scr-row">
                    <td>{row.sn}</td>
                    <td>{row.customerName}</td>
                    <td>{row.deliveryOrderNo ?? ""}</td>
                    <td>{formatDisplayDate(row.dateIssuedIso)}</td>
                    <td>{row.vehicleNumber ?? ""}</td>
                    <td class="scr-num">{formatQty(row.quantity)}</td>
                    <td class="scr-num">{formatQty(row.doBalance)}</td>
                  </tr>
                ))}
                <tr key={`${section.productName}-subtotal`} class="scr-row scr-row-total">
                  <td colSpan={5} class="scr-row-label">
                    SUBTOTAL
                  </td>
                  <td class="scr-num scr-total-cell">
                    {formatQty(section.subtotalQuantity)}
                  </td>
                  <td class="scr-num scr-total-cell">
                    {formatQty(section.subtotalDoBalance)}
                  </td>
                </tr>
              </Fragment>
            ))}
            <tr class="scr-row scr-row-total">
              <td colSpan={5} class="scr-row-label">
                GRAND TOTAL
              </td>
              <td class="scr-num scr-total-cell">
                {formatQty(report.grandTotalQuantity)}
              </td>
              <td class="scr-num scr-total-cell">
                {formatQty(report.grandTotalDoBalance)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="scr-bottled-block">
        <table class="scr-table dsr-summary-table">
          <thead>
            <tr>
              <th colSpan={2} class="scr-section-title">
                SUMMARY BY CUSTOMER TYPE
              </th>
            </tr>
          </thead>
          <tbody>
            {report.summaryRows.map((row) => (
              <tr key={row.id} class="scr-row">
                <td class="scr-row-label">{row.label}</td>
                <td class="scr-num">{formatQty(row.quantity)}</td>
              </tr>
            ))}
            <tr class="scr-row scr-row-total">
              <td class="scr-row-label">GRAND TOTAL</td>
              <td class="scr-num scr-total-cell">{formatQty(report.summaryGrandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function DailySalesReportScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [postingPeriod, setPostingPeriod] = useState<OpenPostingPeriod | null>(null);
  const [reportDateIso, setReportDateIso] = useState(() => utcIsoDateToday());
  const [salesPointId, setSalesPointId] = useState<number | null>(null);
  const [report, setReport] = useState<DailySalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getAuthenticatedFinancialYears()
      .getOpenPostingPeriod()
      .then((period) => {
        if (!cancelled) {
          setPostingPeriod(period);
          setReportDateIso((current) => clampIsoDateToRange(current, period));
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
        const data = await getAuthenticatedReports().getDailySales(
          reportDateIso,
          salesPointId,
        );
        if (!cancelled) {
          setReport(data);
          if (data.scopedSalesPointId != null) {
            setSalesPointId(data.scopedSalesPointId);
          }
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
  }, [reportDateIso, salesPointId]);

  if (loading && !report) {
    return <p class="scr-status">Loading daily sales report...</p>;
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
      reportId="daily-sales-report"
      className="scr-page sbc-root"
      filters={
        <>
      <div class="scr-toolbar no-print sbc-toolbar">
        <div class="dsr-filters">
          <label class="dsr-filter">
            <input
              type="date"
              placeholder="Date"
              aria-label="Date"
              title="Date"
              value={reportDateIso}
              min={postingPeriod?.startDate}
              max={postingPeriod?.endDate}
              disabled={loading || !postingPeriod}
              onInput={(event) =>
                setReportDateIso(
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
          <label class="dsr-filter">
            <select
              aria-label="Collection point"
              title="Collection point"
              value={salesPointId == null ? "" : String(salesPointId)}
              disabled={loading || report.scopedSalesPointId != null}
              onChange={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                setSalesPointId(value ? Number.parseInt(value, 10) : null);
              }}
            >
              {report.scopedSalesPointId == null ? (
                <option value="">Collection point</option>
              ) : null}
              {report.salesPointOptions.map((point) => (
                <option key={point.id} value={String(point.id)}>
                  {point.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? <p class="scr-status scr-status-error no-print">{error}</p> : null}
        </>
      }
    >
      <DailySalesReportDocument report={report} />
    </ReportFilterGate>
  );
}
