import type { ComponentChildren } from "preact";
export type ReportPreviewEmptyInfo = {
    message: string;
    hint?: string;
};
export declare function ReportPreviewEmptyProvider({ children, }: {
    children: ComponentChildren;
}): import("preact").JSX.Element;
export declare function useReportPreviewEmptyRegister(): ((info: ReportPreviewEmptyInfo | null) => void) | null;
export declare function useReportPreviewEmptyInfo(): ReportPreviewEmptyInfo | null;
