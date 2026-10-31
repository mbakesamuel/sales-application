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
export function ReportFilterGate({
  ready,
  reportId: _reportId,
  className = "scr-page",
  filters,
  children,
}: ReportFilterGateProps) {
  void _reportId;

  return (
    <div class={`${className} report-filter-gate`}>
      <div class="report-filter-step no-print">{filters}</div>
      {ready ? <div class="report-filter-preview">{children}</div> : null}
    </div>
  );
}
