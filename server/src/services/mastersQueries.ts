import { prisma } from "../db/prisma.js";
import { getOpenPostingPeriod as getOpenFinancialPostingPeriod } from "./financialYearsService.js";

export async function listCustomers() {
  const rows = await prisma.customers.findMany({
    orderBy: { name: "asc" },
    take: 2000,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    taxRegimeId: row.tax_regime_id,
    customerTypeId: row.customer_type_id,
    residency: row.residency,
    taxpayerId: row.taxpayer_id,
  }));
}

export async function listProducts() {
  const rows = await prisma.products.findMany({
    orderBy: { product_name: "asc" },
    take: 2000,
  });
  return rows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    productCatId: row.product_cat_id,
    uom: row.uom,
  }));
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
  };
}

export async function getOpenPostingPeriod() {
  return getOpenFinancialPostingPeriod();
}
