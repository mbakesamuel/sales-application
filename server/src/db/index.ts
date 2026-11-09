import postgres from "postgres";
import { loadDbConfig, type DbConfig, type DbTarget } from "./config.js";

const dbConfig = loadDbConfig();
const onServerless = Boolean(process.env.VERCEL);

export const sql = postgres(dbConfig.databaseUrl, {
  // Serverless: keep the pool tiny so cold starts do not open many sockets.
  max: onServerless ? 1 : 20,
  idle_timeout: onServerless ? 5 : 30,
  connect_timeout: 5,
  transform: {
    undefined: null,
  },
});

export function getDbConfig(): DbConfig {
  return dbConfig;
}

export function getDbTarget(): DbTarget {
  return dbConfig.target;
}

export async function checkDbConnection(
  timeoutMs = 4_000,
): Promise<boolean> {
  try {
    const res = await Promise.race([
      sql`SELECT 1 as connected`,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`SQL health check timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return Boolean(res && res.length > 0);
  } catch (err) {
    console.error("Database connection check failed:", err);
    return false;
  }
}
