import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { hasNativePdfExport } from "../api/httpAppApi.ts";
import { getElectronApi } from "../auth/client.ts";
import {
  useReportCommentsRevision,
  useReportPrintRegister,
} from "../reports/ReportChrome.tsx";
import {
  ReportPreviewEmptyProvider,
  useReportPreviewEmptyInfo,
} from "../reports/ReportPreviewEmptyContext.tsx";
import { ReportPreviewEmpty } from "../reports/ReportPreviewEmpty.tsx";
import {
  buildPrintDocumentHtml,
  isLandscapePage,
  type PrintPage,
} from "./buildPrintDocumentHtml.ts";
import { PdfViewer } from "./PdfViewer.tsx";
import "./DocumentPreview.css";

function stableToken(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function HtmlDocumentViewer({
  html,
  loading,
  error,
}: {
  html: string | null;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <div class="pdf-viewer html-doc-viewer">
      <div class="pdf-viewer-stage html-doc-viewer-stage">
        {loading ? <p class="pdf-viewer-status">Preparing document preview…</p> : null}
        {error ? <p class="pdf-viewer-status pdf-viewer-error">{error}</p> : null}
        {!loading && !error && !html ? (
          <p class="pdf-viewer-status">No document preview.</p>
        ) : null}
        {!loading && !error && html ? (
          <iframe
            class="html-doc-viewer-frame"
            title="Document preview"
            srcdoc={html}
          />
        ) : null}
      </div>
    </div>
  );
}

function DocumentPreviewBody({
  title,
  fileName,
  page = "portrait",
  bodyClass,
  sourceKey,
  isEmpty = false,
  emptyMessage = "No data for this report.",
  emptyHint,
  attributionFooter = true,
  children,
}: {
  title: string;
  fileName: string;
  page?: PrintPage;
  bodyClass?: string;
  sourceKey: unknown;
  isEmpty?: boolean;
  emptyMessage?: string;
  emptyHint?: string;
  attributionFooter?: boolean;
  children: ComponentChildren;
}) {
  const registeredEmpty = useReportPreviewEmptyInfo();
  const effectiveEmpty = isEmpty || registeredEmpty != null;
  const effectiveMessage = isEmpty
    ? emptyMessage
    : (registeredEmpty?.message ?? emptyMessage);
  const effectiveHint = isEmpty ? emptyHint : (registeredEmpty?.hint ?? emptyHint);

  const nativePdf = hasNativePdfExport();
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(!effectiveEmpty);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const token = stableToken(sourceKey);
  const commentsRevision = useReportCommentsRevision();
  const landscape = isLandscapePage(page);
  const captureRef = useRef<HTMLDivElement>(null);
  const registerPrint = useReportPrintRegister();
  const printRef = useRef<() => void>(() => {});
  const ready = nativePdf
    ? Boolean(pdfBytes && pdfBytes.byteLength > 0)
    : Boolean(previewHtml);

  useEffect(() => {
    if (effectiveEmpty) {
      setLoading(false);
      setError(null);
      setPdfBytes(null);
      setPreviewHtml(null);
      setStatus(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfBytes(null);
    setPreviewHtml(null);
    setStatus(null);

    const started = Date.now();
    let timer = 0;

    const snapshot = () => {
      const host = captureRef.current;
      if (cancelled || !host) {
        if (!cancelled) setLoading(false);
        return;
      }
      const body = host.innerHTML;
      void (async () => {
        try {
          if (cancelled) return;
          const documentHtml = buildPrintDocumentHtml(body, {
            title,
            page,
            bodyClass,
            forPdf: nativePdf,
          });
          if (cancelled) return;

          if (!nativePdf) {
            setPreviewHtml(documentHtml);
            return;
          }

          const bytes = await getElectronApi().print.htmlToPdf(documentHtml, {
            landscape,
            attributionFooter,
          });
          if (cancelled) return;
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          if (copy.byteLength < 5) {
            throw new Error("PDF generation returned empty output");
          }
          const header = String.fromCharCode(
            copy[0]!,
            copy[1]!,
            copy[2]!,
            copy[3]!,
            copy[4]!,
          );
          if (header !== "%PDF-") {
            throw new Error("PDF generation returned invalid output");
          }
          setPdfBytes(copy);
        } catch (err) {
          if (!cancelled) {
            setPdfBytes(null);
            setPreviewHtml(null);
            setError(err instanceof Error ? err.message : "Could not open the document");
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    };

    const watch = () => {
      if (cancelled) return;
      const host = captureRef.current;
      const pending = host?.querySelector(".qr-code-placeholder");
      const stillWaiting = !host || (pending != null && Date.now() - started < 2500);
      if (stillWaiting && Date.now() - started < 2500) {
        timer = window.setTimeout(watch, 40);
        return;
      }
      snapshot();
    };
    timer = window.setTimeout(watch, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // children is read from the render that produced this token / comments revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    commentsRevision,
    title,
    page,
    bodyClass,
    landscape,
    effectiveEmpty,
    attributionFooter,
    nativePdf,
  ]);

  async function handlePrint() {
    if (effectiveEmpty || !ready) {
      setStatus("Nothing to print.");
      return;
    }
    setPrinting(true);
    setStatus("Opening print dialog…");
    try {
      if (nativePdf && pdfBytes) {
        const copy = new Uint8Array(pdfBytes.byteLength);
        copy.set(pdfBytes);
        await getElectronApi().print.printPdf(copy);
      } else if (previewHtml) {
        await getElectronApi().print.printHtml(previewHtml);
      } else {
        throw new Error("Nothing to print.");
      }
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Print failed");
    } finally {
      setPrinting(false);
    }
  }

  async function handleSave() {
    if (effectiveEmpty || !ready) {
      setStatus("Nothing to save.");
      return;
    }
    setSaving(true);
    try {
      if (nativePdf && pdfBytes) {
        setStatus("Saving PDF…");
        const copy = new Uint8Array(pdfBytes.byteLength);
        copy.set(pdfBytes);
        const result = await getElectronApi().print.savePdf({
          defaultName: fileName,
          data: copy,
        });
        if ("path" in result) {
          setStatus(`Saved PDF to ${result.path}`);
        } else {
          setStatus(null);
        }
      } else if (previewHtml) {
        setStatus('Choose “Save as PDF” as the destination in the print dialog.');
        await getElectronApi().print.printHtml(previewHtml);
      } else {
        throw new Error("Nothing to save.");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not save the PDF");
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || printing || saving;
  printRef.current = () => {
    void handlePrint();
  };

  useEffect(() => {
    if (!registerPrint) {
      return;
    }
    registerPrint({
      print: () => printRef.current(),
      busy: printing,
      canPrint: !effectiveEmpty && ready && !printing && !loading,
    });
    return () => registerPrint(null);
  }, [registerPrint, printing, loading, ready, effectiveEmpty]);

  if (effectiveEmpty) {
    return (
      <div class="doc-preview doc-preview-empty">
        <ReportPreviewEmpty
          title={title}
          message={effectiveMessage}
          hint={effectiveHint}
        />
        {/* Keep shell mounted so empty registration stays in sync with filters. */}
        <div ref={captureRef} class="doc-preview-capture" aria-hidden="true">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div class="doc-preview">
      {registerPrint ? (
        status ? <p class="doc-preview-status">{status}</p> : null
      ) : (
        <div class="doc-preview-actions">
          <button
            type="button"
            class="scr-btn"
            disabled={busy || !ready}
            onClick={() => void handlePrint()}
          >
            {printing ? "Printing…" : "Print"}
          </button>
          <button
            type="button"
            class="scr-btn scr-btn-secondary"
            disabled={busy || !ready}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : nativePdf ? "Save PDF" : "Save as PDF…"}
          </button>
          {status ? <span class="doc-preview-status">{status}</span> : null}
        </div>
      )}
      {nativePdf ? (
        <PdfViewer data={pdfBytes} loading={loading} error={error} />
      ) : (
        <HtmlDocumentViewer html={previewHtml} loading={loading} error={error} />
      )}
      <div ref={captureRef} class="doc-preview-capture" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

export function DocumentPreview(props: {
  title: string;
  fileName: string;
  page?: PrintPage;
  bodyClass?: string;
  sourceKey: unknown;
  isEmpty?: boolean;
  emptyMessage?: string;
  emptyHint?: string;
  attributionFooter?: boolean;
  children: ComponentChildren;
}) {
  return (
    <ReportPreviewEmptyProvider>
      <DocumentPreviewBody {...props} />
    </ReportPreviewEmptyProvider>
  );
}
