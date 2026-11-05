import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

const target = (process.env.DB_TARGET || "dev").toLowerCase();
const databaseUrl =
  (target === "prod"
    ? process.env.DATABASE_URL_PROD
    : process.env.DATABASE_URL_DEV) || process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("No database URL");
console.log(`Applying 004 to DB_TARGET=${target}`);

const sql = postgres(databaseUrl, { max: 1, ssl: target === "prod" ? "require" : false });
const migration = fs.readFileSync(
  path.join(__dirname, "../schema/migrations/004_sqlite_parity_tables_and_columns.sql"),
  "utf8",
);

try {
  await sql.unsafe(migration);
  const rows = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'report_signatories',
        'transport_rate_schedules',
        'product_sales_budgets',
        'product_sales_budget_month_phase_profiles',
        'consignment_details',
        'vehicle_consignment_notes',
        'delivery_order_transfers',
        'delivery_order_transfer_lines',
        'factories',
        'commercial_invoice_sequences',
        'vehicle_consignment_note_sequences',
        'financial_year_periods',
        'financial_months',
        'document_sequences',
        'auth_sessions'
      )
    ORDER BY tablename
  `;
  console.log("Present tables:");
  for (const row of rows) console.log(`  ${row.tablename}`);
  console.log("OK");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
