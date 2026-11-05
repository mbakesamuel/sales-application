import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { formatDbTargetLog, loadDbConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
  const { target, databaseUrl, databaseName } = loadDbConfig();
  console.log(formatDbTargetLog({ target, databaseUrl, databaseName }));

  const schemaPath = path.join(__dirname, "../../schema/postgres_schema.sql");
  console.log(`Running migration from: ${schemaPath}`);

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  const sqlContent = fs.readFileSync(schemaPath, "utf8");

  // Create the database only for local/dev (managed prod hosts like Neon already have a DB)
  if (target === "dev") {
    let targetDbName = databaseName;
    let adminUrl = databaseUrl;

    try {
      const parsed = new URL(databaseUrl);
      targetDbName = parsed.pathname.replace(/^\//, "") || databaseName;
      parsed.pathname = "/postgres";
      adminUrl = parsed.toString();
    } catch {
      // If not a parseable URL, proceed directly to schema apply
    }

    console.log(`Checking if database "${targetDbName}" exists...`);
    const adminSql = postgres(adminUrl, { max: 1, connect_timeout: 10 });

    try {
      const exists = await adminSql`
        SELECT 1 FROM pg_database WHERE datname = ${targetDbName}
      `;

      if (exists.length === 0) {
        console.log(`Database "${targetDbName}" does not exist. Creating...`);
        const safeDbName = targetDbName.replace(/"/g, '""');
        await adminSql.unsafe(`CREATE DATABASE "${safeDbName}"`);
        console.log(`Database "${targetDbName}" created successfully!`);
      } else {
        console.log(`Database "${targetDbName}" already exists.`);
      }
    } finally {
      await adminSql.end();
    }
  } else {
    console.log(
      `Skipping CREATE DATABASE for DB_TARGET=prod (applying schema to "${databaseName}").`,
    );
  }

  console.log(`Applying schema to "${databaseName}"...`);
  const targetSql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

  try {
    await targetSql.unsafe(sqlContent);

    await targetSql.unsafe(`
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_by_user_id TEXT;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
    `);

    const migrationsDir = path.join(__dirname, "../../schema/migrations");
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const file of files) {
        const migrationPath = path.join(migrationsDir, file);
        console.log(`Applying incremental migration: ${file}`);
        await targetSql.unsafe(fs.readFileSync(migrationPath, "utf8"));
      }
    }

    console.log("Migration executed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await targetSql.end();
  }
}

void runMigration();
