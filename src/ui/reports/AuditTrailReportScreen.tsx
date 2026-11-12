import { useEffect, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { getAuthenticatedReports } from "../auth/reports.ts";
import {
  formatDisplayDate,
  formatDisplayDateTime,
} from "../../shared/formatDisplayDate.ts";
import type { AuditTrailReport } from "../../shared/reports.types.ts";
import { utcIsoDateToday } from "../stock/stockUtils.ts";
import { ReportFilterGate } from "./ReportFilterGate.tsx";
import { ReportDocumentShell } from "./ReportDocumentShell.tsx";
import { ReportHeader } from "./ReportHeader.tsx";
import "./StockCommitmentReport.css";
import "./SalesBudgetCrosstab.css";

function startOfMonthIso(): string {
  const today = utcIsoDateToday();
  return `${today.slice(0, 8)}01`;
}

function AuditTrailDocument({ report }: { report: AuditTrailReport }) {
  const empty = report.events.length === 0;
  const periodLabel = `${formatDisplayDate(report.fromIso)} – ${formatDisplayDate(report.toIso)}`;

  return (
    <DocumentPreview
      title="Audit trail"
      fileName={`audit-trail-${report.fromIso}_${report.toIso}.pdf`}
      page="landscape"
      sourceKey={report}
      isEmpty={empty}
      emptyMessage="No audit events in this period."
    >
      <ReportDocumentShell
        isEmpty={empty}
        emptyMessage="No audit events in this period."
        className="scr-document wpp-pack-page"
        comments={report.comments}
        signatoryName={report.settings.signatoryName}
        signatoryTitle={report.settings.signatoryTitle}
        header={
          <ReportHeader
            companyName={report.settings.companyName}
            department={report.settings.department ?? null}
            serviceName={report.settings.serviceName ?? null}
            title={`AUDIT TRAIL REPORT (${periodLabel})`}
          />
        }
      >
        <table class="scr-table">
          <thead>
            <tr>
              <th>Date / time</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Outcome</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {report.events.map((event) => (
              <tr key={event.id} class="scr-row">
                <td>{formatDisplayDateTime(event.occurredAtIso)}</td>
                <td>{event.username}</td>
                <td>{event.role ?? ""}</td>
                <td>{event.action}</td>
                <td>{event.outcome}</td>
                <td>{event.summary ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportDocumentShell>
    </DocumentPreview>
  );
}

export function AuditTrailReportScreen({
  windowMode = false,
}: {
  windowMode?: boolean;
}) {
  void windowMode;
  const [fromIso, setFromIso] = useState(startOfMonthIso);
  const [toIso, setToIso] = useState(utcIsoDateToday);
  const [userId, setUserId] = useState<string>("");
  const [appliedFrom, setAppliedFrom] = useState(startOfMonthIso);
  const [appliedTo, setAppliedTo] = useState(utcIsoDateToday);
  const [appliedUserId, setAppliedUserId] = useState<string | null>(null);
  const [report, setReport] = useState<AuditTrailReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedReports().getAuditTrail(
          appliedFrom,
          appliedTo,
          appliedUserId,
        );
        if (!cancelled) {
          setReport(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load audit trail.",
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
  }, [appliedFrom, appliedTo, appliedUserId]);

  function applyFilters() {
    setAppliedFrom(fromIso);
    setAppliedTo(toIso);
    setAppliedUserId(userId.trim() ? userId.trim() : null);
  }

  if (loading && !report) {
    return <p class="scr-status">Loading audit trail…</p>;
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
      reportId="audit-trail-report"
      className="scr-page sbc-root"
      filters={
        <>
          <div class="scr-toolbar no-print sbc-toolbar">
            <div class="dsr-filters">
              <label class="dsr-filter">
                <input
                  type="date"
                  aria-label="From date"
                  title="From"
                  value={fromIso}
                  disabled={loading}
                  onInput={(event) =>
                    setFromIso((event.currentTarget as HTMLInputElement).value)
                  }
                />
              </label>
              <label class="dsr-filter">
                <input
                  type="date"
                  aria-label="To date"
                  title="To"
                  value={toIso}
                  disabled={loading}
                  onInput={(event) =>
                    setToIso((event.currentTarget as HTMLInputElement).value)
                  }
                />
              </label>
              <label class="dsr-filter">
                <select
                  aria-label="User"
                  title="User"
                  value={userId}
                  disabled={loading}
                  onChange={(event) =>
                    setUserId((event.currentTarget as HTMLSelectElement).value)
                  }
                >
                  <option value="">All users</option>
                  {report.users.map((user) => (
                    <option key={user.userId} value={user.userId}>
                      {user.username}
                      {user.role ? ` (${user.role})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                class="dsr-filter"
                disabled={loading}
                onClick={applyFilters}
              >
                Apply
              </button>
            </div>
          </div>
          {error ? (
            <p class="scr-status scr-status-error no-print">{error}</p>
          ) : null}
        </>
      }
    >
      <AuditTrailDocument report={report} />
    </ReportFilterGate>
  );
}
