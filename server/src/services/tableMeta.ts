import { Prisma } from "@prisma/client";
import type { prisma } from "../db/prisma.js";

/** Electron PascalCase table → Prisma delegate / model name. */
export const TABLE_MAP: Record<string, keyof typeof prisma> = {
  CompanySettings: "company_settings",
  Customer: "customers",
  CustomerTypeDefinition: "customer_type_definitions",
  TaxRegime: "tax_regimes",
  TaxRateSchedule: "tax_rate_schedules",
  CommercialService: "commercial_services",
  Product: "products",
  ProductCat: "product_cats",
  ProductUnitPriceSchedule: "product_unit_price_schedules",
  User: "users",
  Role: "roles",
  SalesPoint: "sales_points",
  Location: "locations",
  StorageLocation: "storage_locations",
  PaymentMethodDefinition: "payment_method_definitions",
  DocumentBooklet: "document_booklets",
  FinancialYearPeriod: "financial_year_periods",
  FinancialMonth: "financial_months",
  TransportRateSchedule: "transport_rate_schedules",
  ProductSalesBudget: "product_sales_budgets",
  ProductSalesBudgetMonthPhaseProfile:
    "product_sales_budget_month_phase_profiles",
  Factory: "factories",
  ReportSignatory: "report_signatories",
  Payment: "payments",
  DeliveryOrderPaymentDetails: "delivery_order_payment_details",
};

/** Tables that may be read through the generic grid but never mutated via db.* RPC. */
export const READ_ONLY_TABLES = new Set<string>([
  "Role",
  "Payment",
  "DeliveryOrderPaymentDetails",
  "DocumentBooklet",
  "FinancialYearPeriod",
  "FinancialMonth",
]);

/** Hard-blocked (auth / permission internals). */
export const BLOCKED_TABLES = new Set<string>([
  "Role",
  "RoleRoutePermission",
  "RoleActionPermission",
  "AuthSession",
]);

/** Snake-case columns never sent to the UI nor accepted from it. */
export const HIDDEN_COLUMNS = new Set<string>([
  "password_hash",
  "password_plain",
  "must_change_password",
  "token_hash",
]);

/** Columns maintained by the server. */
export const AUTO_MANAGED_COLUMNS = new Set<string>(["created_at", "updated_at"]);

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export type DmmfField = {
  name: string;
  kind: string;
  type: string;
  isId: boolean;
  isRequired: boolean;
  isList: boolean;
  isUpdatedAt: boolean;
  hasDefaultValue: boolean;
  default?: unknown;
};

export type ModelMeta = {
  modelName: string;
  fields: DmmfField[];
  primaryKeyFields: string[];
  /** camelCase UI name → field */
  byCamel: Map<string, DmmfField>;
};

const modelCache = new Map<string, ModelMeta>();

export function getModelMeta(table: string): ModelMeta | null {
  const modelName = TABLE_MAP[table];
  if (!modelName) return null;
  const cached = modelCache.get(table);
  if (cached) return cached;

  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) return null;

  const fields = (model.fields as unknown as DmmfField[]).filter(
    (f) => (f.kind === "scalar" || f.kind === "enum") && !f.isList,
  );
  const primaryKeyFields = model.primaryKey?.fields?.length
    ? [...model.primaryKey.fields]
    : fields.filter((f) => f.isId).map((f) => f.name);

  const meta: ModelMeta = {
    modelName: String(modelName),
    fields,
    primaryKeyFields,
    byCamel: new Map(fields.map((f) => [snakeToCamel(f.name), f])),
  };
  modelCache.set(table, meta);
  return meta;
}
