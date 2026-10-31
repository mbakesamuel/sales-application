import { PRINT_DOCUMENT_CSS } from "./printDocumentCss.ts";

export type PrintPage =
  | "portrait"
  | "portrait-weekly"
  | "portrait-receipt"
  | "landscape"
  | "landscape-wide"
  | "landscape-tight"
  | "list";

const PAGE_STYLE: Record<PrintPage, string> = {
  portrait: "@media print { @page { size: A4 portrait; margin: 8mm; } }",
  "portrait-weekly":
    "@media print { @page { size: A4 portrait; margin: 6mm 8mm; } }",
  "portrait-receipt":
    "@media print { @page { size: A4 portrait; margin: 8mm 8px; } }",
  landscape: "@media print { @page { size: A4 landscape; margin: 6mm 10mm; } }",
  "landscape-wide":
    "@media print { @page { size: A4 landscape; margin: 6mm 14mm; } }",
  "landscape-tight":
    /* Extra top margin so thead / product title are not clipped after page breaks. */
    "@media print { @page { size: A4 landscape; margin: 10mm 5mm 12mm 5mm; } }",
  list: "@media print { @page { size: A4 portrait; margin: 10mm; } }",
};

export function isLandscapePage(page: PrintPage): boolean {
  return page.startsWith("landscape");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function absoluteAssetUrl(url: string): string {
  if (!url || /^(data|https?|file|blob):/i.test(url)) {
    return url;
  }
  return new URL(url, window.location.href).href;
}

function absolutizeHtmlUrls(html: string): string {
  return html.replace(
    /\b(src|href)="([^"]*)"/g,
    (match, attr: string, url: string) => {
      if (!url || /^(data|https?|file|blob|#|mailto:)/i.test(url)) {
        return match;
      }
      return `${attr}="${escapeHtml(absoluteAssetUrl(url))}"`;
    },
  );
}

export function buildPrintDocumentHtml(
  bodyHtml: string,
  options: {
    title: string;
    page?: PrintPage;
    bodyClass?: string;
    forPdf?: boolean;
  },
): string {
  const page = options.page ?? "portrait";
  const bodyClass = [
    "scr-print-mode",
    options.forPdf === false ? "" : "scr-pdf-export",
    options.bodyClass ?? "",
  ]
    .filter((part) => part.trim().length > 0)
    .join(" ");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(options.title)}</title>
<style>
html, body {
  background: #ffffff !important;
  background-color: #ffffff !important;
}
html {
  --text: #1c2b14;
  --accent: #388e3c;
  --accent-hover: #2e7d32;
  --accent-fg: #ffffff;
  --border: #d9e4c0;
}
${PRINT_DOCUMENT_CSS}
${PAGE_STYLE[page]}
body.customers-print-mode .customers-print-document,
body.scr-print-mode .tcc-print-document {
  display: block !important;
  visibility: visible !important;
  position: static !important;
}
body.customers-print-mode .customers-print-document * {
  visibility: visible !important;
}
</style>
</head>
<body class="${escapeHtml(bodyClass)}">
${absolutizeHtmlUrls(bodyHtml)}
</body>
</html>`;
}
