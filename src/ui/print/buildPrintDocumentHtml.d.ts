export type PrintPage = "portrait" | "portrait-weekly" | "portrait-wide" | "portrait-compact" | "portrait-receipt" | "landscape" | "landscape-wide" | "landscape-tight" | "list";
export declare function isLandscapePage(page: PrintPage): boolean;
export declare function buildPrintDocumentHtml(bodyHtml: string, options: {
    title: string;
    page?: PrintPage;
    bodyClass?: string;
    forPdf?: boolean;
}): string;
