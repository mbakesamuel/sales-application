import type { ComponentChildren } from "preact";
import "../components/FormDialog.css";
import "../company-settings/CompanySettingsScreen.css";
import "./ReportOverlayShell.css";
import "./ReportComments.css";
interface ReportOverlayShellProps {
    reportId?: string;
    title?: string;
    /** Full-window PDF preview: dark chrome, Print + Close with X. Implies body portal. */
    preview?: boolean;
    /** Portal to document.body above stock/form modals (z-index 130). Implied by preview. */
    elevated?: boolean;
    onClose: () => void;
    children: ComponentChildren;
}
export declare function ReportOverlayShell({ reportId, title, preview, elevated, onClose, children, }: ReportOverlayShellProps): import("preact").JSX.Element;
export {};
