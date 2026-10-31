import type { ComponentChildren } from "preact";
interface ReportFilterGateProps {
    ready: boolean;
    /** Kept for call-site compatibility; outer HomeScreen shell owns the title. */
    reportId: string;
    className?: string;
    filters: ComponentChildren;
    children: ComponentChildren;
}
export declare function ReportFilterGate({ ready, reportId, className, filters, children, }: ReportFilterGateProps): import("preact").JSX.Element;
export {};
