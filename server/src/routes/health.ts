import { Hono } from "hono";
import { checkDbConnection, getDbConfig } from "../db/index.js";
import { checkPrismaConnection } from "../db/prisma.js";

export const healthRoute = new Hono();

healthRoute.get("/", async (c) => {
  let target = "unknown";
  let databaseName = "unknown";
  try {
    const cfg = getDbConfig();
    target = cfg.target;
    databaseName = cfg.databaseName;
  } catch (err) {
    console.error("Health: DB config error:", err);
    return c.json(
      {
        ok: false,
        version: "1.1.0",
        service: "sales-sync-server",
        serverTime: new Date().toISOString(),
        database: "misconfigured",
        prisma: "misconfigured",
        dbTarget: process.env.DB_TARGET ?? null,
        databaseName: null,
        error:
          err instanceof Error
            ? err.message
            : "Database URL is not configured for this environment.",
      },
      503,
    );
  }

  const [dbConnected, prismaConnected] = await Promise.all([
    checkDbConnection(4_000),
    checkPrismaConnection(4_000),
  ]);
  const ok = dbConnected && prismaConnected;
  return c.json(
    {
      ok,
      version: "1.1.0",
      service: "sales-sync-server",
      serverTime: new Date().toISOString(),
      database: dbConnected ? "connected" : "disconnected",
      prisma: prismaConnected ? "connected" : "disconnected",
      dbTarget: target,
      databaseName,
    },
    ok ? 200 : 503,
  );
});
