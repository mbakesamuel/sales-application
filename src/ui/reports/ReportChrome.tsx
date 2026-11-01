import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";
import { Printer } from "lucide-react";

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

const ReportPrintRegisterContext = createContext<
  ((action: ReportPrintAction | null) => void) | null
>(null);
const ReportPrintActionContext = createContext<ReportPrintAction | null>(null);
const ReportCommentsChromeContext =
  createContext<ReportCommentsChromeValue | null>(null);

function normalizeComments(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ReportChromeProvider({ children }: { children: ComponentChildren }) {
  const [action, setAction] = useState<ReportPrintAction | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [overridden, setOverridden] = useState(false);

  const register = useCallback((next: ReportPrintAction | null) => {
    setAction(next);
  }, []);

  const registerReportComments = useCallback(
    (next: string | null | undefined) => {
      if (overridden) {
        return;
      }
      const normalized = normalizeComments(next);
      setText((current) => (current === normalized ? current : normalized));
    },
    [overridden],
  );

  const setLiveComments = useCallback((next: string | null) => {
    const normalized = normalizeComments(next);
    setText(normalized);
    setOverridden(true);
    setRevision((current) => current + 1);
  }, []);

  const commentsValue = useMemo(
    () => ({
      text,
      revision,
      overridden,
      registerReportComments,
      setLiveComments,
    }),
    [text, revision, overridden, registerReportComments, setLiveComments],
  );

  return (
    <ReportPrintRegisterContext.Provider value={register}>
      <ReportPrintActionContext.Provider value={action}>
        <ReportCommentsChromeContext.Provider value={commentsValue}>
          {children}
        </ReportCommentsChromeContext.Provider>
      </ReportPrintActionContext.Provider>
    </ReportPrintRegisterContext.Provider>
  );
}

export function useReportPrintRegister() {
  return useContext(ReportPrintRegisterContext);
}

export function useReportCommentsChrome() {
  return useContext(ReportCommentsChromeContext);
}

export function useReportCommentsRevision() {
  return useContext(ReportCommentsChromeContext)?.revision ?? 0;
}

export function ReportPrintButton() {
  const action = useContext(ReportPrintActionContext);
  return (
    <button
      type="button"
      class="report-inline-print"
      disabled={!action?.canPrint || action.busy}
      onClick={() => action?.print()}
    >
      <Printer size={16} aria-hidden="true" />
      {action?.busy ? "Printing…" : "Print"}
    </button>
  );
}
