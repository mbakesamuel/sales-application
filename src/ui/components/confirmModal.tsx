import { useEffect, useState } from "preact/hooks";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

export interface ConfirmModalOptions {
  ariaLabel?: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
}

type ConfirmRequest = ConfirmModalOptions & {
  resolve: (value: boolean) => void;
};

let presentRequest: ((request: ConfirmRequest) => void) | null = null;
let pendingRequest: ConfirmRequest | null = null;

function settle(request: ConfirmRequest, value: boolean) {
  if (pendingRequest === request) {
    pendingRequest = null;
  }
  request.resolve(value);
}

export function openConfirm(options: ConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const request: ConfirmRequest = { ...options, resolve };
    if (presentRequest) {
      presentRequest(request);
      return;
    }
    // Host not mounted yet — fall back so callers still get an answer.
    resolve(
      window.confirm(
        [options.title, options.description].filter(Boolean).join("\n\n"),
      ),
    );
  });
}

/** Danger-styled delete confirmation modal (replaces browser/native confirm). */
export function confirmDelete(description: string): Promise<boolean> {
  return openConfirm({
    ariaLabel: "Confirm delete",
    title: "Confirm delete",
    description,
    confirmLabel: "Delete",
    confirmVariant: "danger",
  });
}

export function ConfirmModalHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    presentRequest = (next) => {
      pendingRequest = next;
      setRequest(next);
    };
    return () => {
      presentRequest = null;
    };
  }, []);

  if (!request) {
    return null;
  }

  return (
    <ConfirmDialog
      ariaLabel={request.ariaLabel ?? request.title}
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      confirmVariant={request.confirmVariant}
      onCancel={() => {
        settle(request, false);
        setRequest(null);
      }}
      onConfirm={() => {
        settle(request, true);
        setRequest(null);
      }}
    />
  );
}
