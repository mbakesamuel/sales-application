import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import type {
  BinCardConditionFilter,
  BinCardQuery,
  BinCardReport,
} from "../../shared/stock.types.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthToken } from "../auth/db.ts";
import { ReportDocumentShell } from "../reports/ReportDocumentShell.tsx";
import { ReportHeader } from "../reports/ReportHeader.tsx";
import { isBinCardReportMovementsEmpty } from "../reports/reportEmpty.ts";
import "../reports/StockCommitmentReport.css";
import { formatDate } from "./stockUtils.ts";
import "./BinCardReport.css";

function formatQty(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0000005) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function conditionLabel(condition: BinCardConditionFilter): string {
  if (condition === "ALL") return "All conditions";
  if (condition === "UNSELLABLE") return "Unsellable";
  return "Sellable";
}

function isBinCardQuery(value: unknown): value is BinCardQuery {
  if (!value || typeof value !== "object") {
    return false;
  }
  const query = value as BinCardQuery;
  return (
    Number.isFinite(Number(query.productId)) &&
    typeof query.fromIso === "string" &&
    typeof query.toIso === "string"
  );
}



function ReportDocument({ report }: { report: BinCardReport }) {
  const empty = isBinCardReportMovementsEmpty(report);

  return (
    <DocumentPreview
        title="Bin card"
        fileName={`bin-card-${report.productId}-${report.fromIso}-${report.toIso}.pdf`}
        page="portrait"
        sourceKey={report}
        isEmpty={empty}
        emptyMessage="No movements in this period."
      >
      <ReportDocumentShell
      isEmpty={empty}
      emptyMessage="No movements in this period."
      className="scr-document bcr-document"
      
      
      showComments={false}
      showFooter={false}
      header={
        <ReportHeader
          companyName={report.companyName}
          department={report.department}
          serviceName={report.serviceName}
          title="Stock bin card"
        />
      }
    >
      <div class="bcr-meta">
        <p>
          <span class="scr-meta-label">Product:</span> {report.productName}
        </p>
        <p>
          <span class="scr-meta-label">UOM:</span> {report.uom}
        </p>
        <p>
          <span class="scr-meta-label">Collection point:</span>{" "}
          {report.salesPointLabel}
        </p>
        <p>
          <span class="scr-meta-label">Location:</span>{" "}
          {report.storageLocationLabel}
        </p>
        <p>
          <span class="scr-meta-label">Condition:</span>{" "}
          {conditionLabel(report.condition)}
        </p>
        <p>
          <span class="scr-meta-label">Period:</span> {formatDate(report.fromIso)}{" "}
          – {formatDate(report.toIso)}
        </p>
      </div>

      <div class="bcr-section">
        <table class="scr-table bcr-table">
          <thead>
            <tr>
              <th class="bcr-date-col">Date</th>
              <th class="bcr-ref-col">Reference</th>
              <th class="bcr-particulars-col">Particulars</th>
              <th class="bcr-qty-col">In</th>
              <th class="bcr-qty-col">Out</th>
              <th class="bcr-balance-col">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr class="scr-row scr-row-total">
              <td class="bcr-date-col">{formatDate(report.fromIso)}</td>
              <td class="bcr-ref-col">—</td>
              <td class="bcr-particulars-col">Opening balance</td>
              <td class="scr-num bcr-qty-col">—</td>
              <td class="scr-num bcr-qty-col">—</td>
              <td class="scr-num bcr-balance-col">
                {formatQty(report.openingBalance)}
              </td>
            </tr>
            {report.lines.map((line) => (
              <tr key={line.id} class="scr-row">
                <td class="bcr-date-col">{formatDate(line.occurredAtIso)}</td>
                <td class="bcr-ref-col">{line.reference}</td>
                <td class="bcr-particulars-col">
                  {line.particulars}
                  {report.salesPointId == null ||
                  report.storageLocationId == null ? (
                    <span class="bcr-location-hint">
                      {" "}
                      ({line.salesPointName}
                      {report.storageLocationId == null
                        ? ` / ${line.storageLocationName}`
                        : ""}
                      )
                    </span>
                  ) : null}
                </td>
                <td class="scr-num bcr-qty-col">
                  {line.qtyIn > 0 ? formatQty(line.qtyIn) : "—"}
                </td>
                <td class="scr-num bcr-qty-col">
                  {line.qtyOut > 0 ? formatQty(line.qtyOut) : "—"}
                </td>
                <td class="scr-num bcr-balance-col">
                  {formatQty(line.balance)}
                </td>
              </tr>
            ))}
            <tr class="scr-row scr-row-total">
              <td class="bcr-date-col">{formatDate(report.toIso)}</td>
              <td class="bcr-ref-col">—</td>
              <td class="bcr-particulars-col">Closing balance</td>
              <td class="scr-num bcr-qty-col">—</td>
              <td class="scr-num bcr-qty-col">—</td>
              <td class="scr-num bcr-balance-col">
                {formatQty(report.closingBalance)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {report.isBottled ? (
        <p class="bcr-footnote">
          Bottled product quantities are in pack units ({report.uom}).
        </p>
      ) : (
        <p class="bcr-footnote">Quantities in {report.uom}.</p>
      )}
    </ReportDocumentShell>
      </DocumentPreview>
  );
}

export function BinCardReportScreen({
  windowMode = false,
  initialQuery = null,
}: {
  windowMode?: boolean;
  initialQuery?: unknown;
}) {
  const [query, setQuery] = useState<BinCardQuery | null>(
    isBinCardQuery(initialQuery) ? initialQuery : null,
  );
  const [report, setReport] = useState<BinCardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isBinCardQuery(initialQuery)) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    if (!windowMode) {
      return;
    }
    const api = getElectronApi();
    return api.reportWindow.onBootstrap((payload) => {
      if (payload.reportId !== "stock-bin-card-report") {
        return;
      }
      if (isBinCardQuery(payload.query)) {
        setQuery(payload.query);
      }
    });
  }, [windowMode]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!query) {
        setLoading(false);
        setReport(null);
        setError(
          "No bin card filters were provided. Open this report from Stocks → Bin card.",
        );
        return;
      }

      const token = getAuthToken();
      if (!token) {
        setLoading(false);
        setError("Login required.");
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const session = await getElectronApi().auth.getSession(token);
        if (!session?.user?.id) {
          throw new Error("Session expired.");
        }
        const data = await getElectronApi().stock.getBinCard(
          session.user.id,
          query,
        );
        if (!cancelled) {
          setReport(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setReport(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load bin card report.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (loading) {
    return <p class="scr-status">Loading bin card report…</p>;
  }

  if (error) {
    return <p class="scr-status scr-status-error">{error}</p>;
  }

  if (!report) {
    return <p class="scr-status">No report data available.</p>;
  }

  return (
    <div class="scr-page">
      <div class="scr-toolbar no-print">
      </div>

      {report.truncated ? (
        <p class="scr-status no-print">
          Showing the first 5,000 movements in range.
        </p>
      ) : null}

      <ReportDocument report={report} />
    </div>
  );
}
