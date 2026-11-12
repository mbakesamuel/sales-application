import { prisma } from "../db/prisma.js";
import { getOpenPostingPeriod as getOpenFinancialPostingPeriod } from "./financialYearsService.js";

const FALLBACK_TAX = {
  vatRate: 0.1925,
  salesActual: 0.02,
  salesSimplified: 0.05,
  salesNoTaxpayer: 0.1,
};

function parseTaxRate(value: string | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

async function loadCustomerListTaxRates(asOfDate: string) {
  const asOf = asOfDate.trim().slice(0, 10);
  const rows = await prisma.tax_rate_schedules.findMany({
    where: {
      is_active: true,
      ...(asOf ? { effective_from: { lte: asOf } } : {}),
    },
    orderBy: { effective_from: "desc" },
  });
  const pick = (kind: string) =>
    rows.find((r) => r.rate_kind === kind)?.rate ?? null;
  return {
    vatRate: parseTaxRate(pick("VAT")) || FALLBACK_TAX.vatRate,
    salesActual: parseTaxRate(pick("SALES_ACTUAL")) || FALLBACK_TAX.salesActual,
    salesSimplified:
      parseTaxRate(pick("SALES_SIMPLIFIED")) || FALLBACK_TAX.salesSimplified,
    salesNoTaxpayer:
      parseTaxRate(pick("SALES_NO_TAXPAYER")) || FALLBACK_TAX.salesNoTaxpayer,
  };
}

function resolveCustomerTaxFields(input: {
  residency: string | null | undefined;
  taxRegimeKind: string | null | undefined;
  taxpayerId: string | null | undefined;
  salesTaxExempt: boolean;
  rates: {
    vatRate: number;
    salesActual: number;
    salesSimplified: number;
    salesNoTaxpayer: number;
  };
}): { vatApplies: boolean; salesTaxRate: number } {
  const residency = String(input.residency ?? "LOCAL").toUpperCase();
  const vatApplies = residency === "LOCAL";
  if (input.salesTaxExempt) {
    return { vatApplies, salesTaxRate: 0 };
  }
  const hasTaxpayer = String(input.taxpayerId ?? "").trim().length > 0;
  const regime = String(input.taxRegimeKind ?? "SIMPLIFIED").toUpperCase();
  const salesTaxRate = !hasTaxpayer
    ? input.rates.salesNoTaxpayer
    : regime === "REAL"
      ? input.rates.salesActual
      : input.rates.salesSimplified;
  return { vatApplies, salesTaxRate };
}

/** Sales / DO form customers with tax profile fields (Electron parity). */
export async function listCustomers() {
  const [rows, rates] = await Promise.all([
    prisma.customers.findMany({
      where: { is_pos_placeholder: false },
      orderBy: { name: "asc" },
      take: 2000,
      include: {
        tax_regimes: { select: { id: true, name: true, kind: true } },
        customer_type_definitions: {
          select: { id: true, exempt_from_sales_tax: true },
        },
      },
    }),
    loadCustomerListTaxRates(new Date().toISOString().slice(0, 10)).catch(
      () => ({ ...FALLBACK_TAX }),
    ),
  ]);

  return rows.map((row) => {
    const salesTaxExempt =
      row.customer_type_definitions?.exempt_from_sales_tax === true;
    const tax = resolveCustomerTaxFields({
      residency: row.residency,
      taxRegimeKind: row.tax_regimes?.kind,
      taxpayerId: row.taxpayer_id,
      salesTaxExempt,
      rates,
    });
    return {
      id: row.id,
      name: row.name,
      taxRegimeId: row.tax_regime_id,
      taxRegimeName: row.tax_regimes?.name ?? null,
      taxRegimeKind: row.tax_regimes?.kind ?? null,
      customerTypeId: row.customer_type_id,
      residency: row.residency,
      taxpayerId: row.taxpayer_id,
      vatApplies: tax.vatApplies,
      salesTaxExempt,
      salesTaxRate: tax.salesTaxRate,
    };
  });
}

export async function listProducts() {
  const rows = await prisma.products.findMany({
    where: {
      exclude_from_delivery_orders: false,
      product_cats: { is_bottled: false },
    },
    orderBy: { product_name: "asc" },
    take: 2000,
  });
  return rows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    productCatId: row.product_cat_id,
    uom: row.uom,
    requiresManualUnitPrice: Boolean(row.requires_manual_unit_price),
  }));
}

export type SalesFormProductOption = {
  productId: number;
  productName: string;
  productCat: string;
  productCatCode: string;
  isMain: boolean;
  omitsStorageLocation: boolean;
  requiresManualUnitPrice: boolean;
  nonStockable: boolean;
};

function isLooseLpoSalesProduct(args: {
  productCode: string | null;
  productName: string;
  isBottled: boolean;
}): boolean {
  if (args.isBottled) return false;
  if ((args.productCode ?? "").trim().toUpperCase() === "LPO") return true;
  return args.productName.trim().toLowerCase() === "loose palm oil";
}

/** Sales invoice form catalogs: split by ProductCat.is_bottled (Electron parity). */
export async function listSalesFormProducts(): Promise<{
  looseProducts: SalesFormProductOption[];
  bottledProducts: SalesFormProductOption[];
}> {
  const rows = await prisma.products.findMany({
    where: { exclude_from_sales: false },
    orderBy: { product_name: "asc" },
    take: 200,
    include: {
      product_cats: {
        select: {
          product_cat: true,
          product_code: true,
          is_bottled: true,
        },
      },
    },
  });

  const looseProducts: SalesFormProductOption[] = [];
  const bottledProducts: SalesFormProductOption[] = [];

  for (const row of rows) {
    const isBottled = Boolean(row.product_cats.is_bottled);
    const option: SalesFormProductOption = {
      productId: row.product_id,
      productName: row.product_name,
      productCat: row.product_cats.product_cat,
      productCatCode: row.product_cats.product_code,
      isMain: isLooseLpoSalesProduct({
        productCode: row.product_code,
        productName: row.product_name,
        isBottled,
      }),
      omitsStorageLocation: Boolean(row.omits_storage_location),
      requiresManualUnitPrice: Boolean(row.requires_manual_unit_price),
      nonStockable: Boolean(row.non_stockable),
    };
    if (isBottled) {
      bottledProducts.push(option);
    } else {
      looseProducts.push(option);
    }
  }

  return { looseProducts, bottledProducts };
}

export async function listSalesPoints() {
  const rows = await prisma.sales_points.findMany({
    where: { is_active: true },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    attachedToMill: row.attached_to_mill,
    isActive: row.is_active,
  }));
}

export async function getCompanySettings() {
  const row = await prisma.company_settings.findFirst();
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.company_name,
    department: row.department,
    vatRate: row.vat_rate,
    logoUrl: row.logo_url,
    uiThemePreset: row.ui_theme_preset,
    hideZeroReportRows: row.hide_zero_report_rows,
    autoGenerateDeliveryOrderNo: row.auto_generate_delivery_order_no,
    enforceDeliveryOrderBookletValidation:
      row.enforce_delivery_order_booklet_validation,
    autoGenerateSalesInvoiceNo: row.auto_generate_sales_invoice_no,
    enforceSalesInvoiceBookletValidation:
      row.enforce_sales_invoice_booklet_validation,
    salesInvoiceLockUnitPrice: row.sales_invoice_lock_unit_price,
    loosePalmOilRequireSalesTank: row.loose_palm_oil_require_sales_tank,
  };
}

export async function getOpenPostingPeriod(salesPointId?: number | null) {
  return getOpenFinancialPostingPeriod(salesPointId);
}
