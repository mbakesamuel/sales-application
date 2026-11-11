import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { formatDbTargetLog, loadDbConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runSeed() {
  const { target, databaseUrl, databaseName } = loadDbConfig();
  console.log(formatDbTargetLog({ target, databaseUrl, databaseName }));

  const seedPath = path.join(__dirname, "../../schema/seed_demo.sql");
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Seed file not found at ${seedPath}`);
  }

  console.log(`Applying seed from: ${seedPath}`);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

  try {
    await sql.unsafe(fs.readFileSync(seedPath, "utf8"));
    console.log("Seed executed successfully!");
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

void runSeed();
