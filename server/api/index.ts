import { handle } from "hono/vercel";
// Built by `npm run build` (`prisma generate && tsc`, with declaration emit) before packaging.
import { app } from "../dist/app.js";

export const config = {
  runtime: "nodejs",
  // PDF generation via Chromium needs headroom on cold start.
  maxDuration: 60,
  memory: 1024,
};

export default handle(app);
