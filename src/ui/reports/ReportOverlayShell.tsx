import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { MessageSquareText, X } from "lucide-react";
import { getAuthenticatedDb } from "../auth/db.ts";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import "../company-settings/CompanySettingsScreen.css";
import { getRouteLabel } from "../../shared/routeCatalog.ts";
import { REPORT_WINDOW_ROUTE_IDS } from "../../shared/reportWindow.ts";
import {
  ReportChromeProvider,
  ReportPrintButton,
  useReportCommentsChrome,
} from "./ReportChrome.tsx";
import "./ReportOverlayShell.css";
import "./ReportComments.css";

const escapeCloseStack: Array<() => void> = [];

function supportsReportComments(reportId: string | undefined): boolean {
  return (
    reportId != null &&
    REPORT_WINDOW_ROUTE_IDS.has(reportId) &&
    reportId !== "stock-bin-card-report"
  );
}

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
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        comments[id] = value;
      }
    }
    return comments;
  } catch {
    return {};
  }
}

interface ReportOverlayShellProps {
  reportId?: string;
  title?: string;
  /** Full-window PDF preview: dark chrome, Print + Close with X. Implies body portal. */
  preview?: boolean;
  /** Portal to document.body above stock/form modals (z-index 130). Implied by preview. */
  elevated?: boolean;
  onClose: () => void;
  children: ComponentChildren;
}

function ReportCommentsControls({ reportId }: { reportId: string }) {
  const chrome = useReportCommentsChrome();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeModalRef = useRef(() => {});

  function closeModal() {
    setOpen(false);
    setError(null);
    setSaving(false);
  }
  closeModalRef.current = closeModal;

  useEffect(() => {
    if (!open) {
      return;
    }
    const closer = () => closeModalRef.current();
    escapeCloseStack.push(closer);
    return () => {
      const index = escapeCloseStack.lastIndexOf(closer);
      if (index >= 0) {
        escapeCloseStack.splice(index, 1);
      }
    };
  }, [open]);

  async function openModal() {
    setError(null);
    let next = chrome?.text ?? "";
    if (!next) {
      try {
        const settingsResult = await getAuthenticatedDb().queryTable({
          table: "CompanySettings",
        });
        const row = (
          settingsResult.rows as Array<Record<string, unknown>>
        ).find((item) => String(item.id) === "default");
        next = parseReportComments(row?.reportCommentsJson)[reportId] ?? "";
      } catch {
        // Keep empty draft when settings are unavailable.
      }
    }
    setDraft(next);
    setOpen(true);
  }

  async function onSave() {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const trimmed = draft.trim();
      const result = await getAuthenticatedReports().saveReportComments({
        reportId,
        text: trimmed.length > 0 ? trimmed : null,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      chrome?.setLiveComments(result.comments ?? null);
      closeModal();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save comments.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        class="report-inline-comments"
        onClick={() => void openModal()}
      >
        <MessageSquareText size={16} aria-hidden="true" />
        Comments
      </button>

      {open ? (
        <FormDialog
          elevated
          ariaLabel="Report comments"
          title="Report comments"
          subtitle="These comments print on this report when the text is not empty. Clear and save to hide the block."
          onClose={closeModal}
        >
          <label class="scr-comments-field">
            <span>Comments</span>
            <textarea
              class="company-settings-input"
              rows={8}
              value={draft}
              disabled={saving}
              placeholder="Enter vital comments for this report…"
              onInput={(event) =>
                setDraft((event.currentTarget as HTMLTextAreaElement).value)
              }
            />
          </label>
          {error ? (
            <p class="company-settings-error" style="margin: 8px 0 0;">
              {error}
            </p>
          ) : null}
          <div class="form-dialog-actions" style="margin-top: 14px;">
            <button
              type="button"
              class="form-dialog-btn-secondary"
              disabled={saving}
              onClick={closeModal}
            >
              Cancel
            </button>
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={saving}
              onClick={() => void onSave()}
            >
              {saving ? "Saving…" : "Save comments"}
            </button>
          </div>
        </FormDialog>
      ) : null}
    </>
  );
}

export function ReportOverlayShell({
  reportId,
  title,
  preview = false,
  elevated = false,
  onClose,
  children,
}: ReportOverlayShellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined);
  const displayTitle =
    title ?? (reportId != null ? getRouteLabel(reportId) : "Report");
  const fullWindow = preview || elevated;
  const showComments = preview && supportsReportComments(reportId);

  useEffect(() => {
    if (fullWindow) {
      setHost(document.body);
      return;
    }
    const node = anchorRef.current;
    const next = node?.closest(".home-content") ?? node?.closest(".home-main");
    setHost(next instanceof HTMLElement ? next : null);
  }, [fullWindow]);

  useEffect(() => {
    escapeCloseStack.push(onClose);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const top = escapeCloseStack[escapeCloseStack.length - 1];
      if (top !== onClose) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      const index = escapeCloseStack.lastIndexOf(onClose);
      if (index >= 0) escapeCloseStack.splice(index, 1);
    };
  }, [onClose]);

  const chrome = (
    <div class="report-overlay-panel">
      <div class="report-overlay-toolbar no-print">
        <h2 class="report-overlay-title">{displayTitle}</h2>
        {preview ? (
          <div class="report-inline-actions">
            {showComments && reportId ? (
              <ReportCommentsControls reportId={reportId} />
            ) : null}
            <ReportPrintButton />
            <button type="button" class="report-inline-close" onClick={onClose}>
              <X size={16} aria-hidden="true" />
              Close
            </button>
          </div>
        ) : (
          <button type="button" class="report-overlay-close" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <div class="report-overlay-body">{children}</div>
    </div>
  );

  const panel = (
    <div
      class={[
        "report-overlay-backdrop",
        fullWindow ? "is-elevated" : "",
        preview ? "is-preview" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="region"
      aria-label={displayTitle}
    >
      {preview ? <ReportChromeProvider>{chrome}</ReportChromeProvider> : chrome}
    </div>
  );

  return (
    <>
      <div ref={anchorRef} class="report-overlay-anchor" hidden />
      {host ? createPortal(panel, host) : host === null ? panel : null}
    </>
  );
}
