import type { ComponentChildren } from "preact";
import { type PrintPage } from "./buildPrintDocumentHtml.ts";
import "./DocumentPreview.css";
export declare function DocumentPreview({ title, fileName, page, bodyClass, sourceKey, isEmpty, emptyMessage, emptyHint, attributionFooter, children, }: {
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
}): import("preact").JSX.Element;
