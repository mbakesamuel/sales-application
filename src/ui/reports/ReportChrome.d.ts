import type { ComponentChildren } from "preact";
export type ReportPrintAction = {
    print: () => void;
    busy: boolean;
    canPrint: boolean;
};
type ReportCommentsChromeValue = {
    text: string | null;
    revision: number;
    overridden: boolean;
    registerReportComments: (text: string | null | undefined) => void;
    setLiveComments: (text: string | null) => void;
};
export declare function ReportChromeProvider({ children }: {
    children: ComponentChildren;
}): import("preact").JSX.Element;
export declare function useReportPrintRegister(): ((action: ReportPrintAction | null) => void) | null;
export declare function useReportCommentsChrome(): ReportCommentsChromeValue | null;
export declare function useReportCommentsRevision(): number;
export declare function ReportPrintButton(): import("preact").JSX.Element;
export {};
