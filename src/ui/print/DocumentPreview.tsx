import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { canExportPdf } from "../api/httpAppApi.ts";
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

  const pdfExport = canExportPdf();
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [htmlDocument, setHtmlDocument] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"pdf" | "html">("pdf");
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
  const ready =
    previewMode === "pdf"
      ? Boolean(pdfBytes && pdfBytes.byteLength > 0)
      : Boolean(htmlDocument);

  useEffect(() => {
    if (effectiveEmpty) {
      setLoading(false);
      setError(null);
      setPdfBytes(null);
      setHtmlDocument(null);
      setPreviewMode("pdf");
      setStatus(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfBytes(null);
    setHtmlDocument(null);
    setPreviewMode("pdf");
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
        const browserHtml = buildPrintDocumentHtml(body, {
          title,
          page,
          bodyClass,
          forPdf: false,
        });
        const pdfDocumentHtml = buildPrintDocumentHtml(body, {
          title,
          page,
          bodyClass,
          forPdf: true,
        });

        // Always keep an HTML document so web clients can print even if
        // server-side Chromium PDF generation is unavailable.
        if (!cancelled) {
          setHtmlDocument(browserHtml);
        }

        if (!pdfExport) {
          if (!cancelled) {
            setPreviewMode("html");
            setPdfBytes(null);
            setError(null);
            setLoading(false);
          }
          return;
        }

        try {
          if (cancelled) return;
          const bytes = await getElectronApi().print.htmlToPdf(pdfDocumentHtml, {
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
          setPreviewMode("pdf");
          setError(null);
        } catch (err) {
          if (!cancelled) {
            // Fall back to browser HTML print/preview instead of a hard error.
            setPdfBytes(null);
            setPreviewMode("html");
            setError(null);
            setStatus(
              err instanceof Error
                ? `PDF preview unavailable (${err.message}). Using browser print.`
                : "PDF preview unavailable. Using browser print.",
            );
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
    pdfExport,
  ]);

  async function handlePrint() {
    if (effectiveEmpty) {
      setStatus("Nothing to print.");
      return;
    }
    setPrinting(true);
    setStatus("Opening print dialog…");
    try {
      // Prefer HTML print (same as Personel LetterPdfOverlay) so the OS/Chromium
      // print dialog sizes to the app window instead of a tiny PDF iframe.
      if (htmlDocument) {
        await getElectronApi().print.printHtml(htmlDocument);
      } else if (previewMode === "pdf" && pdfBytes && pdfBytes.byteLength > 0) {
        const copy = new Uint8Array(pdfBytes.byteLength);
        copy.set(pdfBytes);
        await getElectronApi().print.printPdf(copy);
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
    if (effectiveEmpty) {
      setStatus("Nothing to save.");
      return;
    }
    setSaving(true);
    setStatus("Saving PDF…");
    try {
      if (pdfBytes && pdfBytes.byteLength > 0) {
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
        return;
      }
      if (htmlDocument) {
        // Browser has no silent PDF save — open print dialog so the user can
        // choose "Save as PDF".
        await getElectronApi().print.printHtml(htmlDocument);
        setStatus('Use the print dialog and choose "Save as PDF".');
        return;
      }
      throw new Error("Nothing to save.");
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
            {saving ? "Saving…" : "Save PDF"}
          </button>
          {status ? <span class="doc-preview-status">{status}</span> : null}
        </div>
      )}
      {previewMode === "pdf" ? (
        <PdfViewer data={pdfBytes} loading={loading} error={error} />
      ) : (
        <div class="doc-preview-html">
          {loading ? (
            <p class="doc-preview-status">Preparing print preview…</p>
          ) : htmlDocument ? (
            <iframe
              class="doc-preview-html-frame"
              title={`${title} preview`}
              srcDoc={htmlDocument}
            />
          ) : (
            <p class="doc-preview-status pdf-viewer-error">
              Could not prepare print preview.
            </p>
          )}
        </div>
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
