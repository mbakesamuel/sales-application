import { handle } from "@hono/node-server/vercel";
import { Hono } from "hono";
import { app as coreApp } from "./_app.mjs";

/**
 * Shared Vercel entry for /api and /api/*.
 *
 * Use `@hono/node-server/vercel` (Node req/res), not `hono/vercel` (Web Fetch).
 * Retry without/with `/api` prefix so both path styles work.
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
  url.pathname = url.pathname === "/" ? "/api" : `/api${url.pathname}`;
  return coreApp.fetch(new Request(url.toString(), c.req.raw));
});

export default handle(app);

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
  memory: 1024,
};
