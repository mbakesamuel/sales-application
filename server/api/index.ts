import { handle } from "hono/vercel";
import { app } from "../src/app.js";

export const config = {
  runtime: "nodejs",
  // PDF generation via Chromium needs headroom on cold start.
  maxDuration: 60,
  memory: 1024,
};

export default handle(app);
