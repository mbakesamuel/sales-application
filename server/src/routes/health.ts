import { Hono } from "hono";
import { checkDbConnection, getDbConfig } from "../db/index.js";
import { checkPrismaConnection } from "../db/prisma.js";

export const healthRoute = new Hono();

healthRoute.get("/", async (c) => {
  const [dbConnected, prismaConnected] = await Promise.all([
    checkDbConnection(),
    checkPrismaConnection(),
  ]);
  const { target, databaseName } = getDbConfig();
  const ok = dbConnected && prismaConnected;
  return c.json({
    ok,
    version: "1.1.0",
    service: "sales-sync-server",
    serverTime: new Date().toISOString(),
    database: dbConnected ? "connected" : "disconnected",
    prisma: prismaConnected ? "connected" : "disconnected",
    dbTarget: target,
    databaseName,
  });
});
