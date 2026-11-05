import { Hono } from "hono";
import { sessionAuthMiddleware } from "../middleware/sessionAuth.js";
import {
  MAX_PRINT_HTML_BYTES,
  renderHtmlToPdf,
} from "../print/htmlToPdf.js";

export const printRoute = new Hono();

printRoute.use("*", sessionAuthMiddleware);

printRoute.post("/html-to-pdf", async (c) => {
  const body = await c.req.json().catch(() => null);
  const html = typeof body?.html === "string" ? body.html : "";
  if (!html.trim()) {
    return c.json({ ok: false, error: "Print HTML is required" }, 400);
  }
  if (Buffer.byteLength(html, "utf8") > MAX_PRINT_HTML_BYTES) {
    return c.json(
      { ok: false, error: "Print HTML exceeds the maximum allowed size" },
      413,
    );
  }

  try {
    const pdf = await renderHtmlToPdf(html, {
      landscape: body?.landscape === true,
      attributionFooter: body?.attributionFooter !== false,
    });
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="report.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "PDF generation failed";
    console.error("[print/html-to-pdf]", message);
    return c.json({ ok: false, error: message }, 500);
  }
});
