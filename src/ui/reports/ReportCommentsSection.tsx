import { useLayoutEffect } from "preact/hooks";
import { useReportCommentsChrome } from "./ReportChrome.tsx";
import "./ReportComments.css";

interface ReportCommentsSectionProps {
  comments: string | null | undefined;
}

/** Printed/on-document comments block; hidden when empty. */
export function ReportCommentsSection({ comments }: ReportCommentsSectionProps) {
  const chrome = useReportCommentsChrome();

  useLayoutEffect(() => {
    chrome?.registerReportComments(comments);
  }, [chrome, comments]);

  const text = (
    chrome?.overridden ? chrome.text : (comments ?? chrome?.text ?? null)
  )?.trim() ?? "";

  if (!text) {
    return null;
  }

  return (
    <section class="scr-comments">
      <h3 class="scr-comments-title">Comments</h3>
      <div class="scr-comments-body">{text}</div>
    </section>
  );
}
