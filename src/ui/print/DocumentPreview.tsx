import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { getElectronApi } from "../auth/client.ts";
import { useReportPrintRegister } from "../reports/ReportChrome.tsx";
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
  children: ComponentChildren;
}) {
  const registeredEmpty = useReportPreviewEmptyInfo();
  const effectiveEmpty = isEmpty || registeredEmpty != null;
  const effectiveMessage = isEmpty
    ? emptyMessage
    : (registeredEmpty?.message ?? emptyMessage);
  const effectiveHint = isEmpty ? emptyHint : (registeredEmpty?.hint ?? emptyHint);

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(!effectiveEmpty);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const token = stableToken(sourceKey);
  const landscape = isLandscapePage(page);
  const captureRef = useRef<HTMLDivElement>(null);
  const registerPrint = useReportPrintRegister();
  const printRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (effectiveEmpty) {
      setLoading(false);
      setError(null);
      setPdfBytes(null);
      setStatus(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfBytes(null);
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
          const pdfDocumentHtml = buildPrintDocumentHtml(body, {
            title,
            page,
            bodyClass,
            forPdf: true,
          });
          if (cancelled) return;
          const bytes = await getElectronApi().print.htmlToPdf(pdfDocumentHtml, {
            landscape,
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
    // children is read from the render that produced this token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, title, page, bodyClass, landscape, effectiveEmpty]);

  async function handlePrint() {
    if (effectiveEmpty || !pdfBytes || pdfBytes.byteLength === 0) {
      setStatus("Nothing to print.");
      return;
    }
    setPrinting(true);
    setStatus("Opening print dialog…");
    try {
      const copy = new Uint8Array(pdfBytes.byteLength);
      copy.set(pdfBytes);
      await getElectronApi().print.printPdf(copy);
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Print failed");
    } finally {
      setPrinting(false);
    }
  }

  async function handleSave() {
    if (effectiveEmpty || !pdfBytes || pdfBytes.byteLength === 0) {
      setStatus("Nothing to save.");
      return;
    }
    setSaving(true);
    setStatus("Saving PDF…");
    try {
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
      canPrint: !effectiveEmpty && Boolean(pdfBytes) && !printing && !loading,
    });
    return () => registerPrint(null);
  }, [registerPrint, printing, loading, pdfBytes, effectiveEmpty]);

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
            disabled={busy || !pdfBytes}
            onClick={() => void handlePrint()}
          >
            {printing ? "Printing…" : "Print"}
          </button>
          <button
            type="button"
            class="scr-btn scr-btn-secondary"
            disabled={busy || !pdfBytes}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save PDF"}
          </button>
          {status ? <span class="doc-preview-status">{status}</span> : null}
        </div>
      )}
      <PdfViewer data={pdfBytes} loading={loading} error={error} />
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
  children: ComponentChildren;
}) {
  return (
    <ReportPreviewEmptyProvider>
      <DocumentPreviewBody {...props} />
    </ReportPreviewEmptyProvider>
  );
}
