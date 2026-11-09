import dotenv from "dotenv";

dotenv.config();

export type DbTarget = "dev" | "prod";

export type DbConfig = {
  target: DbTarget;
  databaseUrl: string;
  databaseName: string;
};

const LEGACY_DEFAULT_URL =
  "postgres://postgres:postgres@localhost:5432/sales_central";

function resolveTarget(raw: string | undefined): DbTarget {
  return raw?.trim().toLowerCase() === "prod" ? "prod" : "dev";
}

function parseDatabaseName(databaseUrl: string): string {
  try {
    const pathname = new URL(databaseUrl).pathname.replace(/^\//, "");
    return pathname || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Resolve which Postgres URL to use from DB_TARGET + named URLs.
 * Prefer DATABASE_URL_DEV / DATABASE_URL_PROD; fall back to DATABASE_URL; then localhost default.
 * When DB_TARGET=prod, refuse to fall through to the localhost default (avoids silent mis-connect).
 */
export function loadDbConfig(): DbConfig {
  const target = resolveTarget(process.env.DB_TARGET);
  const onVercel = Boolean(process.env.VERCEL);

  // On Vercel, prefer any configured remote URL even if DB_TARGET was left at "dev".
  if (onVercel) {
    const vercelUrl =
      process.env.DATABASE_URL_PROD?.trim() ||
      process.env.DATABASE_URL?.trim() ||
      process.env.DATABASE_URL_DEV?.trim() ||
      "";
    if (vercelUrl) {
      const resolvedTarget = process.env.DATABASE_URL_PROD?.trim()
        ? "prod"
        : target;
      return {
        target: resolvedTarget,
        databaseUrl: vercelUrl,
        databaseName: parseDatabaseName(vercelUrl),
      };
    }
    throw new Error(
      "Vercel is missing a Postgres URL. Set DATABASE_URL_PROD (recommended) or DATABASE_URL in Project → Environment Variables. Do not use localhost.",
    );
  }

  const namedUrl =
    target === "prod"
      ? process.env.DATABASE_URL_PROD?.trim()
      : process.env.DATABASE_URL_DEV?.trim();
  const legacyUrl = process.env.DATABASE_URL?.trim();

  let databaseUrl = namedUrl || legacyUrl || "";

  if (!databaseUrl) {
    if (target === "prod") {
      throw new Error(
        "DB_TARGET=prod but DATABASE_URL_PROD (and legacy DATABASE_URL) are unset. Set DATABASE_URL_PROD in server/.env.",
      );
    }
    databaseUrl = LEGACY_DEFAULT_URL;
  }

  return {
    target,
    databaseUrl,
    databaseName: parseDatabaseName(databaseUrl),
  };
}

export function formatDbTargetLog(config: DbConfig): string {
  return `Using DB_TARGET=${config.target} (database: ${config.databaseName})`;
}
