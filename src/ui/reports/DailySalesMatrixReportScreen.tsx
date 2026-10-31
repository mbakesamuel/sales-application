import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { DailySalesMatrixReport } from "../../shared/reports.types.ts";
import { ReportFilterGate } from "./ReportFilterGate.tsx";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import "./StockCommitmentReport.css";
import "./SalesBudgetCrosstab.css";
import "./DailySalesMatrixReport.css";

function formatQty(value: number): string {
  if (value === 0) {
    return "0";
  }
  return Math.round(value).toLocaleString("en-US");
}

function productOptionLabel(product: {
  name: string;
  productCode: string | null;
}): string {
  return product.productCode ? `${product.name} (${product.productCode})` : product.name;
}

export function DailySalesMatrixReportDocument({
  report,
}: {
  report: DailySalesMatrixReport;
}) {
  return (
    <DocumentPreview
        title="Daily sales matrix"
        fileName={`daily-sales-matrix-${report.monthStartIso.slice(0, 7)}.pdf`}
        page="portrait-weekly"
        sourceKey={report}
        isEmpty={false}
        emptyMessage=""
      >
      <ReportDocumentShell
      isEmpty={false}
      emptyMessage=""
      className="scr-document wpp-pack-page weekly-report-tight dsr-summary-document"
      
      
      comments={report.comments}
      signatoryName={report.settings.signatoryName}
      signatoryTitle={report.settings.signatoryTitle}
      header={
        <ReportHeader
          companyName={report.settings.companyName}
          department={report.settings.department ?? null}
          serviceName={report.settings.serviceName ?? null}
          title={`DAILY SALES SUMMARY FOR ${report.monthLabel.toUpperCase()}`}
        />
      }
    >
      <p class="scr-meta-line">
        Through {formatDisplayDate(report.asAtIso)} · {report.salesPointLabel} ·{" "}
        {report.productLabel}
      </p>

      <div class="scr-bottled-block">
        <table class="scr-table dsr-matrix-table">
          <thead>
            <tr>
              <th class="scr-num">DAY</th>
              <th class="scr-num">INDUSTRY</th>
              <th class="scr-num">WHOLE SALE</th>
              <th class="scr-num">RETAIL</th>
              <th class="scr-num">STAFF / WORKER</th>
              <th class="scr-num">PUB. REL.</th>
              <th class="scr-num">TRANSFER</th>
              <th class="scr-num">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.day} class="scr-row">
                <td class="scr-num">{row.day}</td>
                <td class="scr-num">{formatQty(row.industry)}</td>
                <td class="scr-num">{formatQty(row.wholeSale)}</td>
                <td class="scr-num">{formatQty(row.retail)}</td>
                <td class="scr-num">{formatQty(row.cdcWorker)}</td>
                <td class="scr-num">{formatQty(row.staff)}</td>
                <td class="scr-num">{formatQty(row.trnsfr)}</td>
                <td class="scr-num">{formatQty(row.total)}</td>
              </tr>
            ))}
            <tr class="scr-row scr-row-total">
              <td class="scr-row-label">TOTAL</td>
              <td class="scr-num scr-total-cell">{formatQty(report.columnTotals.industry)}</td>
              <td class="scr-num scr-total-cell">{formatQty(report.columnTotals.wholeSale)}</td>
              <td class="scr-num scr-total-cell">{formatQty(report.columnTotals.retail)}</td>
              <td class="scr-num scr-total-cell">{formatQty(report.columnTotals.cdcWorker)}</td>
              <td class="scr-num scr-total-cell">{formatQty(report.columnTotals.staff)}</td>
              <td class="scr-num scr-total-cell">{formatQty(report.columnTotals.trnsfr)}</td>
              <td class="scr-num scr-total-cell">{formatQty(report.columnTotals.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function DailySalesMatrixReportScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [salesPointId, setSalesPointId] = useState<number | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [report, setReport] = useState<DailySalesMatrixReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getDailySalesMatrix(
          salesPointId,
          productId,
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
  }, [salesPointId, productId]);

  if (loading && !report) {
    return <p class="scr-status">Loading daily sales matrix report...</p>;
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
      reportId="daily-sales-matrix-report"
      className="scr-page sbc-root"
      filters={
        <>
      <div class="scr-toolbar no-print sbc-toolbar dsm-toolbar">      
        <div class="dsr-filters"> 
        {/* <label class="dsr-filter">
            <span>Period</span>
            <span>
              {report.monthLabel} · through {formatDisplayDate(report.asAtIso)}
            </span>
          </label> */}
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
          <label class="dsr-filter">
            <select
              aria-label="Product"
              title="Product"
              value={productId == null ? "" : String(productId)}
              disabled={loading}
              onChange={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                setProductId(value ? Number.parseInt(value, 10) : null);
              }}
            >
              <option value="">Product</option>
              {report.productOptions.map((product) => (
                <option key={product.id} value={String(product.id)}>
                  {productOptionLabel(product)}
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
      <DailySalesMatrixReportDocument report={report} />
    </ReportFilterGate>
  );
}
