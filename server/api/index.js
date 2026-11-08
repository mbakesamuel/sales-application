import { handle } from "hono/vercel";
// Plain JS entry: avoids Vercel NODE_TYPESCRIPT_ERROR on remapped ../dist/app.js.
// Built by vercel.json buildCommand (`tsc -p tsconfig.build.json`).
import { app } from "../dist/app.js";

export const config = {
  runtime: "nodejs",
  // PDF generation via Chromium needs headroom on cold start.
  maxDuration: 60,
  memory: 1024,
};

export default handle(app);
