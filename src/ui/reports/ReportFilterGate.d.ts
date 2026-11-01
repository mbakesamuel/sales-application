import type { ComponentChildren } from "preact";
interface ReportFilterGateProps {
    ready: boolean;
    /** Kept for call-site compatibility; outer HomeScreen shell owns the title. */
    reportId: string;
    className?: string;
    filters: ComponentChildren;
    children: ComponentChildren;
}
/**
 * Sidebar reports only: filters + PDF in one view inside HomeScreen's overlay.
 * Console document prints do not use this component.
 */
export declare function ReportFilterGate({ ready, reportId: _reportId, className, filters, children, }: ReportFilterGateProps): import("preact").JSX.Element;
export {};
