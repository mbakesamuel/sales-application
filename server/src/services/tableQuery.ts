import { prisma } from "../db/prisma.js";
import { TABLE_MAP, snakeToCamel } from "./tableMeta.js";

type TableQueryInput = {
  table: string;
  limit?: number;
  offset?: number;
  search?: string;
};

type TableQueryResult = {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function mapRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    let mapped: unknown = value;
    if (value instanceof Date) {
      mapped = value.toISOString();
    } else if (typeof value === "bigint") {
      mapped = Number(value);
    }
    out[snakeToCamel(key)] = mapped;
  }
  return out;
}

function getDelegate(table: string) {
  const key = TABLE_MAP[table];
  if (!key) return null;
  const delegate = prisma[key] as
    | {
        findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
        count: (args?: unknown) => Promise<number>;
      }
    | undefined;
  return delegate ?? null;
}

export async function queryTable(
  input: TableQueryInput,
): Promise<TableQueryResult> {
  const table = String(input.table ?? "").trim();
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(input.offset ?? 0, 0);
  const search = input.search?.trim() ?? "";

  const delegate = getDelegate(table);
  if (!delegate) {
    return { table, columns: [], rows: [], total: 0, limit, offset };
  }

  // Prefer recent rows; most masters have created_at / updated_at.
  const orderByCandidates = [
    { created_at: "desc" as const },
    { updated_at: "desc" as const },
    { id: "asc" as const },
  ];

  let rows: Record<string, unknown>[] = [];
  let total = 0;
  let lastError: unknown = null;

  for (const orderBy of orderByCandidates) {
    try {
      const where =
        search.length > 0
          ? undefined // generic text search needs per-table columns; skip for now
          : undefined;
      const [found, count] = await Promise.all([
        delegate.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy,
        }),
        delegate.count(where ? { where } : undefined),
      ]);
      rows = found;
      total = count;
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError && rows.length === 0) {
    // Fallback without orderBy for odd tables
    try {
      const [found, count] = await Promise.all([
        delegate.findMany({ take: limit, skip: offset }),
        delegate.count(),
      ]);
      rows = found;
      total = count;
    } catch {
      throw lastError;
    }
  }

  const mapped = rows.map((row) => mapRow(row));
  const columns =
    mapped.length > 0
      ? Object.keys(mapped[0]!)
      : [];

  return {
    table,
    columns,
    rows: mapped,
    total,
    limit,
    offset,
  };
}

export async function getCompanySettingsRow(): Promise<Record<
  string,
  unknown
> | null> {
  const result = await queryTable({ table: "CompanySettings", limit: 1 });
  return result.rows[0] ?? null;
}
