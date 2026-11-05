import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "./password.js";
import {
  AUTO_MANAGED_COLUMNS,
  BLOCKED_TABLES,
  HIDDEN_COLUMNS,
  READ_ONLY_TABLES,
  TABLE_MAP,
  camelToSnake,
  getModelMeta,
  snakeToCamel,
  type DmmfField,
  type ModelMeta,
} from "./tableMeta.js";

export type TableSchemaColumn = {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isRequired: boolean;
  isAutoIncrement: boolean;
  isEditableOnCreate: boolean;
  isEditableOnUpdate: boolean;
  isHidden: boolean;
  isBoolean: boolean;
  defaultValue: string | null;
  allowsNull: boolean;
};

export type TableSchema = {
  table: string;
  primaryKeyColumns: string[];
  columns: TableSchemaColumn[];
};

type Delegate = {
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
  delete: (args: unknown) => Promise<Record<string, unknown>>;
};

function createTextPrimaryKey(): string {
  const time = Date.now().toString(36);
  const random = randomBytes(8).toString("hex");
  return `c${time}${random}`;
}

function getDelegate(table: string): Delegate {
  const key = TABLE_MAP[table];
  if (!key) {
    throw new Error(`Table "${table}" was not found`);
  }
  const delegate = prisma[key] as unknown as Delegate | undefined;
  if (!delegate?.create || !delegate?.update || !delegate?.delete) {
    throw new Error(`Table "${table}" does not support mutations`);
  }
  return delegate;
}

function assertMutableTable(table: string): ModelMeta {
  if (BLOCKED_TABLES.has(table) || READ_ONLY_TABLES.has(table)) {
    throw new Error("This table cannot be modified");
  }
  const meta = getModelMeta(table);
  if (!meta) {
    throw new Error(`Table "${table}" was not found`);
  }
  return meta;
}

function isBooleanField(field: DmmfField, _camelName: string): boolean {
  return field.type === "Boolean";
}

function fieldHasDefault(field: DmmfField): boolean {
  return Boolean(field.hasDefaultValue) || field.isUpdatedAt;
}

function isAutoIncrementField(field: DmmfField): boolean {
  if (!field.isId) return false;
  if (field.type !== "Int" && field.type !== "BigInt") return false;
  const def = field.default as { name?: string } | undefined;
  return Boolean(field.hasDefaultValue && def && def.name === "autoincrement");
}

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

function coerceValue(
  camelName: string,
  rawValue: unknown,
  field: DmmfField | undefined,
): unknown {
  if (rawValue === "" || rawValue === undefined || rawValue === null) {
    return null;
  }

  if (field?.type === "Boolean" || (field && isBooleanField(field, camelName))) {
    if (
      rawValue === true ||
      rawValue === 1 ||
      rawValue === "1" ||
      rawValue === "true"
    ) {
      return true;
    }
    if (
      rawValue === false ||
      rawValue === 0 ||
      rawValue === "0" ||
      rawValue === "false"
    ) {
      return false;
    }
  }

  if (field?.type === "Int" || field?.type === "BigInt") {
    const parsed = Number.parseInt(String(rawValue), 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`"${camelName}" must be an integer`);
    }
    return field.type === "BigInt" ? BigInt(parsed) : parsed;
  }

  if (field?.type === "Float" || field?.type === "Decimal") {
    const parsed = Number.parseFloat(String(rawValue).replace(",", "."));
    if (Number.isNaN(parsed)) {
      throw new Error(`"${camelName}" must be a number`);
    }
    return parsed;
  }

  if (field?.type === "DateTime") {
    if (rawValue instanceof Date) return rawValue;
    const d = new Date(String(rawValue));
    if (Number.isNaN(d.getTime())) {
      throw new Error(`"${camelName}" must be a date`);
    }
    return d;
  }

  if (field?.type === "Json") {
    if (typeof rawValue === "string") {
      try {
        return JSON.parse(rawValue);
      } catch {
        return rawValue;
      }
    }
    return rawValue;
  }

  return String(rawValue);
}

function wrapDatabaseError(error: unknown, operation?: "delete"): Error {
  if (!(error instanceof Error)) {
    return new Error("Database operation failed.");
  }
  const message = error.message;
  if (
    message.includes("Foreign key constraint") ||
    message.includes("foreign key")
  ) {
    if (operation === "delete") {
      return new Error(
        "This record cannot be deleted because other data still references it.",
      );
    }
    return new Error(
      "A linked record was not found. Check category, product, service, or customer type selections.",
    );
  }
  if (message.includes("Unique constraint") || message.includes("unique constraint")) {
    return new Error("A record with these values already exists.");
  }
  return error;
}

function applyUserPassword(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...values };
  const password = next.password;
  delete next.password;
  delete next.passwordPlain;
  delete next.passwordHash;
  delete next.mustChangePassword;

  if (typeof password === "string" && password.trim()) {
    next.passwordHash = hashPassword(password.trim());
    next.mustChangePassword = true;
  }
  return next;
}

function buildSchema(table: string, meta: ModelMeta): TableSchema {
  const columns: TableSchemaColumn[] = meta.fields.map((field) => {
    const camel = snakeToCamel(field.name);
    const hidden = HIDDEN_COLUMNS.has(field.name);
    const autoInc = isAutoIncrementField(field);
    const autoManaged = AUTO_MANAGED_COLUMNS.has(field.name);
    const isPrimaryKey = meta.primaryKeyFields.includes(field.name);
    const isRequired =
      field.isRequired && !fieldHasDefault(field) && !autoInc;

    return {
      name: camel,
      type: field.type,
      isPrimaryKey,
      isRequired,
      isAutoIncrement: autoInc,
      isEditableOnCreate:
        !hidden && !autoInc && !autoManaged && camel !== "updatedAt",
      isEditableOnUpdate: !hidden && !autoInc && !autoManaged && !isPrimaryKey,
      isHidden: hidden,
      isBoolean: isBooleanField(field, camel),
      defaultValue: null,
      allowsNull: !field.isRequired,
    };
  });

  if (table === "User") {
    columns.push({
      name: "password",
      type: "PASSWORD",
      isPrimaryKey: false,
      isRequired: false,
      isAutoIncrement: false,
      isEditableOnCreate: true,
      isEditableOnUpdate: true,
      isHidden: false,
      isBoolean: false,
      defaultValue: null,
      allowsNull: true,
    });
  }

  return {
    table,
    primaryKeyColumns: meta.primaryKeyFields.map(snakeToCamel),
    columns,
  };
}

function prepareInsertData(
  table: string,
  schema: TableSchema,
  meta: ModelMeta,
  inputValues: Record<string, unknown>,
): Record<string, unknown> {
  let values =
    table === "User" ? applyUserPassword(inputValues) : { ...inputValues };
  const byCamel = new Map(schema.columns.map((c) => [c.name, c]));
  const data: Record<string, unknown> = {};

  for (const column of schema.columns) {
    if (column.isHidden || column.name === "password") continue;
    if (!column.isEditableOnCreate) continue;

    if (Object.prototype.hasOwnProperty.call(values, column.name)) {
      const field = meta.byCamel.get(column.name);
      const coerced = coerceValue(column.name, values[column.name], field);
      if (coerced === null && !column.isRequired) continue;
      data[camelToSnake(column.name)] = coerced;
      continue;
    }

    if (column.isPrimaryKey && column.type === "String") {
      data[camelToSnake(column.name)] = createTextPrimaryKey();
      continue;
    }

    if (column.isRequired) {
      throw new Error(`"${column.name}" is required`);
    }
  }

  const now = new Date();
  if (meta.byCamel.has("createdAt") && data.created_at == null) {
    data.created_at = now;
  }
  if (meta.byCamel.has("updatedAt") && data.updated_at == null) {
    data.updated_at = now;
  }

  if (table === "User") {
    if (typeof values.passwordHash === "string" && values.passwordHash.trim()) {
      data.password_hash = values.passwordHash;
      data.must_change_password = true;
    } else if (!data.password_hash) {
      throw new Error("Password is required when creating a user.");
    }
  }

  if (Object.keys(data).length === 0) {
    throw new Error("No values provided for insert");
  }

  return data;
}

function prepareUpdateData(
  table: string,
  schema: TableSchema,
  meta: ModelMeta,
  inputValues: Record<string, unknown>,
): Record<string, unknown> {
  let values =
    table === "User" ? applyUserPassword(inputValues) : { ...inputValues };
  const data: Record<string, unknown> = {};

  for (const column of schema.columns) {
    if (column.isHidden || column.name === "password") continue;
    if (!column.isEditableOnUpdate) continue;
    if (!Object.prototype.hasOwnProperty.call(values, column.name)) continue;

    const field = meta.byCamel.get(column.name);
    data[camelToSnake(column.name)] = coerceValue(
      column.name,
      values[column.name],
      field,
    );
  }

  if (meta.byCamel.has("updatedAt")) {
    data.updated_at = new Date();
  }

  if (table === "User") {
    if (typeof values.passwordHash === "string" && values.passwordHash.trim()) {
      data.password_hash = values.passwordHash;
      data.must_change_password = true;
    }
  }

  if (Object.keys(data).length === 0) {
    throw new Error("No editable fields were provided");
  }

  return data;
}

function primaryKeyWhere(
  meta: ModelMeta,
  primaryKeyCamel: Record<string, unknown>,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const snake of meta.primaryKeyFields) {
    const camel = snakeToCamel(snake);
    if (!(camel in primaryKeyCamel)) {
      throw new Error(`Missing primary key column "${camel}"`);
    }
    const field = meta.byCamel.get(camel);
    where[snake] = coerceValue(camel, primaryKeyCamel[camel], field);
  }
  return where;
}

export function getTableSchema(tableName: string): TableSchema {
  const table = tableName.trim();
  const meta = getModelMeta(table);
  if (!meta) {
    throw new Error(`Table "${table}" was not found`);
  }
  return buildSchema(table, meta);
}

export async function insertRow(input: {
  table: string;
  values?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  try {
    const table = String(input.table ?? "").trim();
    const meta = assertMutableTable(table);
    const schema = buildSchema(table, meta);
    const data = prepareInsertData(table, schema, meta, input.values ?? {});
    const delegate = getDelegate(table);
    const created = await delegate.create({ data });
    return mapRow(created);
  } catch (error) {
    throw wrapDatabaseError(error);
  }
}

export async function updateRow(input: {
  table: string;
  primaryKey: Record<string, unknown>;
  values?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  try {
    const table = String(input.table ?? "").trim();
    const meta = assertMutableTable(table);
    const schema = buildSchema(table, meta);
    const where = primaryKeyWhere(meta, input.primaryKey ?? {});
    const data = prepareUpdateData(table, schema, meta, input.values ?? {});
    const delegate = getDelegate(table);
    const updated = await delegate.update({ where, data });
    return mapRow(updated);
  } catch (error) {
    throw wrapDatabaseError(error);
  }
}

export async function deleteRow(input: {
  table: string;
  primaryKey: Record<string, unknown>;
}): Promise<void> {
  try {
    const table = String(input.table ?? "").trim();
    const meta = assertMutableTable(table);
    const where = primaryKeyWhere(meta, input.primaryKey ?? {});
    const delegate = getDelegate(table);
    await delegate.delete({ where });
  } catch (error) {
    throw wrapDatabaseError(error, "delete");
  }
}
