import { FileSearch } from "lucide-react";
import "./ReportPreviewEmpty.css";

export function ReportPreviewEmpty({
  title,
  message,
  hint,
}: {
  title?: string;
  message: string;
  hint?: string;
}) {
  return (
    <div class="report-preview-empty" role="status">
      <div class="report-preview-empty-card">
        <div class="report-preview-empty-icon" aria-hidden="true">
          <FileSearch size={36} strokeWidth={1.5} />
        </div>
        {title ? <h3 class="report-preview-empty-title">{title}</h3> : null}
        <p class="report-preview-empty-message">{message}</p>
        {hint ? <p class="report-preview-empty-hint">{hint}</p> : null}
        <p class="report-preview-empty-action">
          There is nothing to print for the current selection.
        </p>
      </div>
    </div>
  );
}
