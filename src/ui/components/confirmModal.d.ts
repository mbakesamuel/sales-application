export interface ConfirmModalOptions {
    ariaLabel?: string;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: "primary" | "danger";
}
export declare function openConfirm(options: ConfirmModalOptions): Promise<boolean>;
/** Danger-styled delete confirmation modal (replaces browser/native confirm). */
export declare function confirmDelete(description: string): Promise<boolean>;
export declare function ConfirmModalHost(): import("preact").JSX.Element | null;
