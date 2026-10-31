import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useState } from "preact/hooks";

export type ReportPreviewEmptyInfo = {
  message: string;
  hint?: string;
};

const ReportPreviewEmptyRegisterContext = createContext<
  ((info: ReportPreviewEmptyInfo | null) => void) | null
>(null);
const ReportPreviewEmptyInfoContext = createContext<ReportPreviewEmptyInfo | null>(null);

export function ReportPreviewEmptyProvider({
  children,
}: {
  children: ComponentChildren;
}) {
  const [info, setInfo] = useState<ReportPreviewEmptyInfo | null>(null);
  const register = useCallback((next: ReportPreviewEmptyInfo | null) => {
    setInfo(next);
  }, []);

  return (
    <ReportPreviewEmptyRegisterContext.Provider value={register}>
      <ReportPreviewEmptyInfoContext.Provider value={info}>
        {children}
      </ReportPreviewEmptyInfoContext.Provider>
    </ReportPreviewEmptyRegisterContext.Provider>
  );
}

export function useReportPreviewEmptyRegister() {
  return useContext(ReportPreviewEmptyRegisterContext);
}

export function useReportPreviewEmptyInfo() {
  return useContext(ReportPreviewEmptyInfoContext);
}
