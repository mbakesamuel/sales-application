import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type {
  BottledPalmOilSalesReturnReport,
  BottledPalmOilSalesReturnRow,
  BottledPalmOilSalesReturnRowKind,
} from "../../shared/reports.types.ts";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import {
  HIDE_ZERO_ROWS_HINT,
  isBottledPalmOilSalesReturnReportEmpty,
} from "./reportEmpty.ts";
import "./StockCommitmentReport.css";
import "./BottledPalmOilSalesReturnReport.css";

const AMOUNT_KINDS = new Set<BottledPalmOilSalesReturnRowKind>([
  "cashSales",
  "publicRelation",
  "totalIssues",
]);

const TOTAL_KG_KINDS = new Set<BottledPalmOilSalesReturnRowKind>([
  "bf",
  "reception",
  "totalStock",
  "cashSales",
  "publicRelation",
  "totalIssues",
  "balance",
]);

const PACK_QTY_AS_KG_KINDS = new Set<BottledPalmOilSalesReturnRowKind>([
  "issuesKg",
  "balanceKg",
]);

const EMPHASIS_KINDS = new Set<BottledPalmOilSalesReturnRowKind>([
  "totalStock",
  "totalIssues",
  "balance",
]);

function formatQty(value: number): string {
  if (Math.abs(value) < 0.0005) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatAmount(value: number): string {
  if (Math.abs(value) < 0.5) {
    return "—";
  }
  return Math.round(value).toLocaleString("en-US");
}

function formatKg(value: number): string {
  if (Math.abs(value) < 0.0005) {
    return "—";
  }
  return Math.round(value).toLocaleString("en-US");
}

function rowClassName(row: BottledPalmOilSalesReturnRow): string | undefined {
  if (row.kind === "section") {
    return "scr-row-header";
  }
  if (EMPHASIS_KINDS.has(row.kind)) {
    return "scr-row scr-row-total";
  }
  return "scr-row";
}

function ReportDocument({ report }: { report: BottledPalmOilSalesReturnReport }) {
  const colSpan = report.packColumns.length * 2 + 3;
  const empty = isBottledPalmOilSalesReturnReportEmpty(report);

  return (
    <DocumentPreview
        title="Bottled palm oil sales return"
        fileName={`bottled-palm-oil-sales-return-${report.financialYear}-${report.asAtIso}.pdf`}
        page="landscape"
        bodyClass="bposr-print-landscape"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No bottled palm oil sales or returns for this period."
        emptyHint={HIDE_ZERO_ROWS_HINT}
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No bottled palm oil sales or returns for this period."
      emptyHint={HIDE_ZERO_ROWS_HINT}
      className="scr-document bposr-document"
      
      
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
      <div class="bposr-section">
        <table class="scr-table bposr-table">
          <thead>
            <tr>
              <th class="bposr-label-col" rowSpan={2} />
              {report.packColumns.map((column) => (
                <th key={column.id} colSpan={2}>
                  {column.label}
                </th>
              ))}
              <th rowSpan={2}>TOTAL IN KGS</th>
              <th rowSpan={2}>GRAND TOTAL IN FCFA</th>
            </tr>
            <tr>
              {report.packColumns.flatMap((column) => [
                <th key={`${column.id}-qty`}>QUANTITY</th>,
                <th key={`${column.id}-amount`}>AMOUNT WITHOUT T.</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              if (row.kind === "section") {
                return (
                  <tr key={row.id} class={rowClassName(row)}>
                    <td colSpan={colSpan}>
                      <strong>{row.label}</strong>
                    </td>
                  </tr>
                );
              }

              const showAmount = AMOUNT_KINDS.has(row.kind);
              const showTotalKg = TOTAL_KG_KINDS.has(row.kind);
              const packQtyAsKg = PACK_QTY_AS_KG_KINDS.has(row.kind);

              return (
                <tr key={row.id} class={rowClassName(row)}>
                  <td class="bposr-label-col">{row.label}</td>
                  {row.packs.flatMap((cell, index) => {
                    const packId = report.packColumns[index]?.id ?? index;
                    return [
                      <td key={`${row.id}-${packId}-qty`} class="scr-num">
                        {packQtyAsKg ? formatKg(cell.qty) : formatQty(cell.qty)}
                      </td>,
                      <td key={`${row.id}-${packId}-amount`} class="scr-num">
                        {showAmount ? formatAmount(cell.amount) : "—"}
                      </td>,
                    ];
                  })}
                  <td class="scr-num">
                    {showTotalKg ? formatKg(row.totalKg) : "—"}
                  </td>
                  <td class="scr-num">
                    {showAmount ? formatAmount(row.grandTotalFcfa) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p class="bposr-footnote">Value without taxes · amounts in FCFA</p>
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function BottledPalmOilSalesReturnScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [report, setReport] = useState<BottledPalmOilSalesReturnReport | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data =
          await getAuthenticatedReports().getBottledPalmOilSalesReturn();
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
  }, []);

  if (loading) {
    return (
      <p class="scr-status">Loading bottled palm oil sales return…</p>
    );
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page bposr-page">
            <ReportDocument report={report} />
    </div>
  );
}
