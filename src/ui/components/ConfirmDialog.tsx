import { FormDialog } from "./FormDialog.tsx";
import "./FormDialog.css";
import "./ConfirmDialog.css";

interface ConfirmDialogProps {
  ariaLabel: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  ariaLabel,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <FormDialog
      ariaLabel={ariaLabel}
      title={title}
      subtitle={description}
      elevated
      onClose={busy ? () => undefined : onCancel}
    >
      <div class="confirm-dialog-actions">
        <button
          type="button"
          class="form-dialog-btn-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          class={
            confirmVariant === "danger"
              ? "confirm-dialog-btn-danger"
              : "form-dialog-btn-primary"
          }
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </FormDialog>
  );
}
