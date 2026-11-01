import { useEffect, useState } from "preact/hooks";
import { SlidersHorizontal } from "lucide-react";
import { getAuthenticatedDb } from "../auth/db.ts";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type { ReportSignatoryRow } from "../../shared/reports.types.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import { getRouteLabel } from "../../shared/routeCatalog.ts";
import { REPORT_WINDOW_ROUTE_IDS } from "../../shared/reportWindow.ts";
import "../company-settings/CompanySettingsScreen.css";
import "./ReportComments.css";

const COMMENT_REPORT_IDS = [...REPORT_WINDOW_ROUTE_IDS]
  .filter((reportId) => reportId !== "stock-bin-card-report")
  .sort((left, right) => getRouteLabel(left).localeCompare(getRouteLabel(right)));

function parseReportComments(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const comments: Record<string, string> = {};
    for (const [reportId, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        comments[reportId] = value;
      }
    }
    return comments;
  } catch {
    return {};
  }
}

interface ReportSettingsScreenProps {
  readOnly?: boolean;
}

function emptyForm() {
  return {
    id: null as string | null,
    name: "",
    title: "Manager, Palm Oil Sales",
    effectiveFrom: new Date().toISOString().slice(0, 10),
  };
}

export function ReportSettingsScreen({ readOnly = false }: ReportSettingsScreenProps) {
  const [signatories, setSignatories] = useState<ReportSignatoryRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [signatoryBusy, setSignatoryBusy] = useState(false);
  const [commentsByReport, setCommentsByReport] = useState<Record<string, string>>({});
  const [commentReportId, setCommentReportId] = useState(COMMENT_REPORT_IDS[0] ?? "");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const reports = getAuthenticatedReports();
      const [settingsResult, list] = await Promise.all([
        getAuthenticatedDb().queryTable({ table: "CompanySettings" }),
        reports.listSignatories(),
      ]);
      const row = (settingsResult.rows as Array<Record<string, unknown>>).find(
        (r) => String(r.id) === "default",
      );
      setCommentsByReport(parseReportComments(row?.reportCommentsJson));
      if (!row) {
        setError("Company settings row not found. Configure App settings first.");
      }
      setSignatories(list);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load report settings.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    setCommentDraft(commentsByReport[commentReportId] ?? "");
  }, [commentsByReport, commentReportId]);

  async function onSaveComments() {
    if (readOnly || commentSaving || commentReportId.length === 0) {
      return;
    }
    setCommentSaving(true);
    setError(null);
    setSavedHint(null);
    try {
      const trimmed = commentDraft.trim();
      const result = await getAuthenticatedReports().saveReportComments({
        reportId: commentReportId,
        text: trimmed.length > 0 ? trimmed : null,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setCommentsByReport((current) => {
        const next = { ...current };
        if (result.comments) {
          next[commentReportId] = result.comments;
        } else {
          delete next[commentReportId];
        }
        return next;
      });
      setCommentDraft(result.comments ?? "");
      setSavedHint("Report comments saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save comments.",
      );
    } finally {
      setCommentSaving(false);
    }
  }

  function startEdit(row: ReportSignatoryRow) {
    setForm({
      id: row.id,
      name: row.name,
      title: row.title,
      effectiveFrom: row.effectiveFrom,
    });
    setSavedHint(null);
    setError(null);
  }

  function startCreate() {
    setForm(emptyForm());
    setSavedHint(null);
    setError(null);
  }

  async function onSaveSignatory() {
    if (readOnly || signatoryBusy) {
      return;
    }
    setSignatoryBusy(true);
    setError(null);
    setSavedHint(null);
    try {
      const result = await getAuthenticatedReports().upsertSignatory({
        id: form.id,
        name: form.name,
        title: form.title,
        effectiveFrom: form.effectiveFrom,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setSavedHint(form.id ? "Signatory updated." : "Signatory added.");
      setForm(emptyForm());
      setSignatories(await getAuthenticatedReports().listSignatories());
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save signatory.",
      );
    } finally {
      setSignatoryBusy(false);
    }
  }

  async function onDeleteSignatory(row: ReportSignatoryRow) {
    if (readOnly || signatoryBusy) {
      return;
    }
    const confirmed = window.confirm(
      `Delete signatory "${row.name}" effective ${formatDisplayDate(row.effectiveFrom)}?`,
    );
    if (!confirmed) {
      return;
    }
    setSignatoryBusy(true);
    setError(null);
    setSavedHint(null);
    try {
      const result = await getAuthenticatedReports().deleteSignatory(row.id);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      if (form.id === row.id) {
        setForm(emptyForm());
      }
      setSavedHint("Signatory deleted.");
      setSignatories(await getAuthenticatedReports().listSignatories());
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete signatory.",
      );
    } finally {
      setSignatoryBusy(false);
    }
  }

  return (
    <div class="company-settings-screen">
      <header class="company-settings-header">
        <div class="company-settings-heading">
          <SlidersHorizontal size={22} aria-hidden="true" />
          <div>
            <h2>Report settings</h2>
            <p>Report comments and footer signatory</p>
          </div>
        </div>
      </header>

      <div class="company-settings-toolbar">
        {loading ? <span>Loading…</span> : null}
        {savedHint && !error ? <span>{savedHint}</span> : null}
      </div>

      {error ? (
        <p class="company-settings-error" style="padding: 0 24px; color: #b91c1c;">
          {error}
        </p>
      ) : null}

      <section style="padding: 8px 24px 24px; max-width: 40rem;">
        <h3 style="margin: 0 0 8px; font-size: 16px; color: var(--text-h);">
          Report comments
        </h3>
        <p style="margin: 0 0 16px; color: #64748b; font-size: 13px; line-height: 1.45;">
          Comments print on the report when the text is not empty. Clear the text and save to
          hide that block.
        </p>
        <label class="scr-comments-field" style="margin-bottom: 12px;">
          <span>Report</span>
          <select
            class="company-settings-input"
            value={commentReportId}
            disabled={loading || readOnly || commentSaving}
            onChange={(event) => {
              setCommentReportId((event.currentTarget as HTMLSelectElement).value);
              setSavedHint(null);
            }}
          >
            {COMMENT_REPORT_IDS.map((reportId) => (
              <option key={reportId} value={reportId}>
                {getRouteLabel(reportId)}
              </option>
            ))}
          </select>
        </label>
        <label class="scr-comments-field">
          <span>Comments</span>
          <textarea
            class="company-settings-input"
            rows={8}
            value={commentDraft}
            disabled={loading || readOnly || commentSaving}
            placeholder="Enter vital comments for this report…"
            onInput={(event) => {
              setCommentDraft((event.currentTarget as HTMLTextAreaElement).value);
              setSavedHint(null);
            }}
          />
        </label>
        {!readOnly ? (
          <button
            type="button"
            class="company-settings-primary-btn"
            style="margin-top: 12px;"
            disabled={loading || commentSaving || commentReportId.length === 0}
            onClick={() => void onSaveComments()}
          >
            {commentSaving ? "Saving…" : "Save comments"}
          </button>
        ) : null}
      </section>

      <section style="padding: 8px 24px 32px; max-width: 52rem;">
        <h3 style="margin: 0 0 8px; font-size: 16px; color: var(--text-h);">
          Report signatory
        </h3>
        <p style="margin: 0 0 16px; color: #64748b; font-size: 13px; line-height: 1.45;">
          Global footer name and title. Reports use the latest entry whose{" "}
          <strong>effective from</strong> date is on or before the report as-at date.
        </p>

        <div class="cf-table-wrap" style="margin-bottom: 16px;">
          <table class="cf-table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--border);">
                  Effective from
                </th>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--border);">
                  Name
                </th>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--border);">
                  Title
                </th>
                <th style="padding: 8px; border-bottom: 1px solid var(--border);" />
              </tr>
            </thead>
            <tbody>
              {signatories.length === 0 ? (
                <tr>
                  <td colSpan={4} style="padding: 12px; color: #64748b;">
                    No signatories yet.
                  </td>
                </tr>
              ) : (
                signatories.map((row) => (
                  <tr key={row.id}>
                    <td style="padding: 8px; border-bottom: 1px solid var(--border);">
                      {formatDisplayDate(row.effectiveFrom)}
                    </td>
                    <td style="padding: 8px; border-bottom: 1px solid var(--border);">
                      {row.name}
                    </td>
                    <td style="padding: 8px; border-bottom: 1px solid var(--border);">
                      {row.title}
                    </td>
                    <td
                      style="padding: 8px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap;"
                    >
                      {!readOnly ? (
                        <>
                          <button
                            type="button"
                            class="company-settings-secondary-btn"
                            style="margin-right: 8px;"
                            disabled={signatoryBusy}
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="company-settings-secondary-btn"
                            disabled={signatoryBusy || signatories.length <= 1}
                            onClick={() => void onDeleteSignatory(row)}
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!readOnly ? (
          <div class="company-settings-table-card report-signatory-form-card">
            <form
              class="company-settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveSignatory();
              }}
            >
              <div class="report-signatory-form-heading">
                <strong>{form.id ? "Edit signatory" : "Add signatory"}</strong>
                <p>
                  Name and title appear on printed report footers from the effective
                  date onward.
                </p>
              </div>

              <label class="company-settings-field">
                <span>Name</span>
                <input
                  class="company-settings-input"
                  type="text"
                  value={form.name}
                  disabled={signatoryBusy}
                  placeholder="Full name as printed"
                  autoComplete="off"
                  onInput={(event) =>
                    setForm({
                      ...form,
                      name: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                />
              </label>

              <div class="company-settings-form-grid">
                <label class="company-settings-field">
                  <span>Title</span>
                  <input
                    class="company-settings-input"
                    type="text"
                    value={form.title}
                    disabled={signatoryBusy}
                    placeholder="Manager, Palm Oil Sales"
                    autoComplete="off"
                    onInput={(event) =>
                      setForm({
                        ...form,
                        title: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </label>

                <label class="company-settings-field">
                  <span>Effective from</span>
                  <input
                    class="company-settings-input report-signatory-date-input"
                    type="date"
                    value={form.effectiveFrom}
                    disabled={signatoryBusy}
                    onInput={(event) =>
                      setForm({
                        ...form,
                        effectiveFrom: (event.currentTarget as HTMLInputElement)
                          .value,
                      })
                    }
                  />
                </label>
              </div>

              <div class="report-signatory-form-actions">
                <button
                  type="submit"
                  class="company-settings-primary-btn"
                  disabled={signatoryBusy}
                >
                  {signatoryBusy ? "Saving…" : form.id ? "Update" : "Add"}
                </button>
                {form.id ? (
                  <button
                    type="button"
                    class="company-settings-secondary-btn"
                    disabled={signatoryBusy}
                    onClick={startCreate}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        ) : null}
      </section>
    </div>
  );
}
