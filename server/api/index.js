import { handle } from "hono/vercel";
// Bundled by `npm run vercel-build` (no TypeScript graph for Vercel to typecheck).
import { app } from "./_app.mjs";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
  memory: 1024,
};

export default handle(app);
