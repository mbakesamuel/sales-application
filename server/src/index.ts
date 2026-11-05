import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDbTargetLog } from "./db/config.js";
import { getDbConfig } from "./db/index.js";
import { healthRoute } from "./routes/health.js";
import { syncRoute } from "./routes/sync.js";
import { v1Route } from "./routes/v1.js";
import { authRoute } from "./routes/auth.js";
import { appRpcRoute } from "./routes/appRpc.js";

dotenv.config();

const app = new Hono();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiDist = path.resolve(__dirname, "../../dist-react");

// Global middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

// Routes
app.route("/api/health", healthRoute);
app.route("/api/auth", authRoute);
app.route("/api/app", appRpcRoute);
app.route("/api/sync", syncRoute);
app.route("/api/v1", v1Route);

app.get("/api", (c) => {
  return c.json({
    name: "Sales Central API",
    version: "2.0.0",
    docs: "/api/health",
    auth: "/api/auth",
    app: "/api/app/:namespace/:method",
    commandApi: "/api/v1",
    sync: "/api/sync",
  });
});

if (fs.existsSync(uiDist)) {
  app.use(
    "/*",
    serveStatic({
      root: uiDist,
      rewriteRequestPath: (p) => (p.startsWith("/api") ? p : p),
    }),
  );
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json({ ok: false, error: "Not found" }, 404);
    }
    const indexPath = path.join(uiDist, "index.html");
    if (!fs.existsSync(indexPath)) {
      return c.json(
        { error: "UI not built. Run npm run build in repo root." },
        404,
      );
    }
    return c.html(fs.readFileSync(indexPath, "utf8"));
  });
} else {
  app.get("/", (c) => {
    return c.json({
      name: "Sales Central API",
      version: "2.0.0",
      hint: "Build UI (dist-react) to serve the browser client from this host.",
      docs: "/api/health",
    });
  });
}

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || "0.0.0.0";

console.log(`Starting Hono sync server on http://${host}:${port}...`);
console.log(formatDbTargetLog(getDbConfig()));

serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`Sales Central API listening at http://${info.address}:${info.port}`);
  },
);
