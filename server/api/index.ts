import { handle } from "hono/vercel";
// Import source (not dist): Vercel remaps src→dist when tsconfig has outDir, which
// breaks typechecking against emitted JS. Root tsconfig.json is noEmit for that reason.
import { app } from "../src/app.js";

export const config = {
  runtime: "nodejs",
  // PDF generation via Chromium needs headroom on cold start.
  maxDuration: 60,
  memory: 1024,
};

export default handle(app);
