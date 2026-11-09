import { handle } from "hono/vercel";
// Bundled by `npm run vercel-build`.
import { app } from "./_app.mjs";

// Web Handler API — named method exports receive Fetch `Request` and return
// `Response`. A bare default export is treated as legacy Node (req, res) on
 // current Vercel Node runtimes, which crashes Hono CORS with:
//   TypeError: this.raw.headers.get is not a function
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
  memory: 1024,
};

export default handler;
