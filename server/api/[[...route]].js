import { handle } from "@hono/node-server/vercel";
import { Hono } from "hono";
// Bundled by `npm run vercel-build`.
import { app as coreApp } from "./_app.mjs";

/**
 * Vercel Node calls the default export as (req, res) => void.
 * `@hono/node-server/vercel` adapts that correctly.
 * `hono/vercel` does NOT (Web Fetch only) and causes:
 *   TypeError: this.raw.headers.get is not a function
 * plus hung responses / 60s timeouts.
 *
 * Also: for files under /api, some runtimes present the path without the
 * `/api` prefix. Retry once with `/api` prepended when the first match 404s.
 */
const app = new Hono();

app.all("*", async (c) => {
  const first = await coreApp.fetch(c.req.raw);
  if (first.status !== 404) {
    return first;
  }
  const url = new URL(c.req.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return first;
  }
  url.pathname =
    url.pathname === "/" ? "/api" : `/api${url.pathname}`;
  return coreApp.fetch(new Request(url.toString(), c.req.raw));
});

export default handle(app);

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
  memory: 1024,
};
