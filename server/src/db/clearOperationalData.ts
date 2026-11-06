import type postgres from "postgres";

/**
 * Ops tables only — mirrors SQLite clearOperationalData scope (keeps masters).
 * Children listed before parents where helpful; TRUNCATE … CASCADE handles FKs.
 */
export const OPERATIONAL_TABLES = [
  "sale_applied_taxes",
  "sale_lines",
  "payments",
  "consignment_details",
  "vehicle_consignment_notes",
  "sales",
  "delivery_order_payment_details",
  "delivery_order_details",
  "delivery_order_transfer_lines",
  "delivery_order_transfers",
  "delivery_orders",
  "stock_receipt_lines",
  "stock_receipts",
  "stock_transfer_lines",
  "stock_transfers",
  "stock_adjustment_lines",
  "stock_adjustments",
  "stock_movements",
] as const;

const SEQUENCE_RESETS = [
  {
    table: "commercial_invoice_sequences",
    sql: `UPDATE "commercial_invoice_sequences" SET next_number = 1, updated_at = NOW()`,
  },
  {
    table: "vehicle_consignment_note_sequences",
    sql: `UPDATE "vehicle_consignment_note_sequences" SET next_number = 1, updated_at = NOW()`,
  },
  {
    table: "document_sequences",
    sql: `UPDATE "document_sequences" SET last_value = 0, updated_at = NOW()`,
  },
] as const;

export type ClearOperationalTablesResult = {
  tables: string[];
  deleted: Record<string, number>;
  sequences: Record<string, number>;
};

/**
 * Truncate stock / sales / delivery-order / VCN operational tables on Postgres.
 * Keeps masters (products, customers, users, settings, devices, etc.).
 */
export async function clearOperationalTables(
  sql: postgres.Sql,
): Promise<ClearOperationalTablesResult> {
  const tables = [...OPERATIONAL_TABLES];
  const deleted: Record<string, number> = {};

  for (const table of tables) {
    try {
      const rows = await sql.unsafe(
        `SELECT COUNT(*)::int AS count FROM "${table}"`,
      );
      deleted[table] = Number(rows[0]?.count ?? 0);
    } catch {
      deleted[table] = 0;
    }
  }

  const quoted = tables.map((t) => `"${t}"`).join(", ");
  await sql.unsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);

  const sequences: Record<string, number> = {};
  for (const seq of SEQUENCE_RESETS) {
    try {
      const result = await sql.unsafe(seq.sql);
      sequences[seq.table] = Number(result.count ?? 0);
    } catch {
      sequences[seq.table] = 0;
    }
  }

  return { tables, deleted, sequences };
}
