import { handle } from "hono/vercel";
// Built by `prisma generate && tsc` (vercel.json buildCommand) before packaging.
import { app } from "../dist/app.js";

export const config = {
  runtime: "nodejs",
  // PDF generation via Chromium needs headroom on cold start.
  maxDuration: 60,
  memory: 1024,
};

export default handle(app);
