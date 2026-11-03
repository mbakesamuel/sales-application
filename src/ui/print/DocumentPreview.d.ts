import type { ComponentChildren } from "preact";
import { type PrintPage } from "./buildPrintDocumentHtml.ts";
import "./DocumentPreview.css";
export declare function DocumentPreview(props: {
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
