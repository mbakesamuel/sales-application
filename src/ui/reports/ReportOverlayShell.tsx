import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { X } from "lucide-react";
import { getRouteLabel } from "../../shared/routeCatalog.ts";
import { ReportChromeProvider, ReportPrintButton } from "./ReportChrome.tsx";
import "./ReportOverlayShell.css";

const escapeCloseStack: Array<() => void> = [];

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
