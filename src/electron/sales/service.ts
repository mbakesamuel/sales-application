import type {
  CreateSaleInput,
  LoadedSaleView,
  PendingSaleRow,
  SalesFormOptions,
  SalesListFilters,
  SalesListResult,
  SalesStorageLocationBalanceOption,
  SalesValidateManyResult,
  SalesValidationQueuePage,
  SaveSaleResult,
  SaleDisposition,
  SaleMutationResult,
  UnitPricePreviewResult,
} from "../../shared/sales.types.js";
import {
  BOTTLE_OIL_SALES_ROUTE_ID,
  SALES_ROUTE_ID,
} from "../../shared/salesModule.js";
import { validateBookletSerial } from "../../shared/bookletSerial.js";
import { validateSerialForSalesPoint } from "../booklets/service.js";
import {
  loadAutoGenerateSalesInvoiceNo,
  loadEnforceSalesInvoiceBookletValidation,
} from "../companySettings/salesDoDocumentNumbers.js";
import { allocateInvoiceNo, newPaymentId, newSaleId, newSaleLineId } from "./invoice.js";
import {
  isDispositionPaymentMethodId,
  paymentMethodIdForDisposition,
  SYS_PM_PUBLIC_RELATION,
  SYS_PM_RATION,
} from "../../shared/dispositionPaymentMethods.js";
import {
  resolveCustomerTaxProfile,
  SALES_TAX_LABEL,
} from "../../shared/taxRules.js";
import { isLooseLpoProduct } from "../../shared/looseLpoProduct.js";
import {
  DO_RETAIL_WHOLESALE_THRESHOLD_KG,
  retailSaleQtyTooHighMessage,
} from "../../shared/doPricingCustomerType.js";
import { assertRouteWrite, assertAction, canPerformAction, canWriteRoute } from "../auth/permissions/service.js";
import {
  collectionPointScopeError,
  filterByCollectionPointScope,
  getUserCollectionPointId,
} from "../auth/collectionPointScope.js";
import { getDatabase } from "../db/index.js";
import {
  listActiveSalesPoints,
  requireActiveSalesPoint,
} from "../salesPoints/active.js";
import {
  getCustomerTypeIdForCustomer,
  getRetailCustomerTypeId,
  getStaffWorkerCustomerTypeId,
  resolveUnitPriceExTax,
} from "../pricing/resolveUnitPrice.js";
import { loadTaxRatesAsOf } from "../tax/resolveRates.js";
import { enqueueOutboxItem, serializeSaleForSync } from "../sync/syncOutbox.js";
import { isCommandApiEnabled } from "../api/client.js";
import { createSaleRemote } from "../api/salesRemote.js";
import {
  requireCommandApiOnline,
  requireCommandApiOnlineCached,
} from "../api/onlineOnly.js";
import { getAvailableSellableForSaleAsOf } from "../stock/pendingSaleReservations.js";
import { assertSaleLinesStockAsOf, deductStockForValidatedSale, reverseStockForValidatedSale, productOmitsStorageLocationById, resolveSaleLineStorageLocation } from "../stock/sales.js";
import {
  loadLoosePalmOilRequireSalesTank,
  productIsLoosePalmOilById,
  productRequiresSalesTankForLooseSale,
  resolveStockProductId,
} from "../stock/productStorage.js";
import { isInsufficientStockError } from "../stock/errors.js";
import { parseQty } from "../stock/decimal.js";
import { formatTaxRateSnapshot, formatXaf, parseAmount, roundMoney, trimQty } from "./money.js";
import {
  assertDateInOpenMonthForActor,
  resolveListDateRange,
} from "../financialYears/service.js";

const QTY_EPS = 0.000001;

function loadBottleOilUseRegisteredCustomers(
  db: ReturnType<typeof getDatabase>,
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "bottleOilUseRegisteredCustomers")) {
      return false;
    }

    const row = db
      .prepare(
        `SELECT bottleOilUseRegisteredCustomers
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { bottleOilUseRegisteredCustomers: number | null } | undefined;

    return Number(row?.bottleOilUseRegisteredCustomers ?? 0) !== 0;
  } catch {
    return false;
  }
}

function loadBottleOilAllowRation(
  db: ReturnType<typeof getDatabase>,
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "bottleOilAllowRation")) {
      return false;
    }

    const row = db
      .prepare(
        `SELECT bottleOilAllowRation
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { bottleOilAllowRation: number | null } | undefined;

    return Number(row?.bottleOilAllowRation ?? 0) !== 0;
  } catch {
    return false;
  }
}

function loadLooseSalesAllowPublicRelation(
  db: ReturnType<typeof getDatabase>,
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "looseSalesAllowPublicRelation")) {
      return false;
    }

    const row = db
      .prepare(
        `SELECT looseSalesAllowPublicRelation
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { looseSalesAllowPublicRelation: number | null } | undefined;

    return Number(row?.looseSalesAllowPublicRelation ?? 0) !== 0;
  } catch {
    return false;
  }
}

function loadLooseSalesAllowUnregisteredCustomer(
  db: ReturnType<typeof getDatabase>,
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "looseSalesAllowUnregisteredCustomer")) {
      return false;
    }

    const row = db
      .prepare(
        `SELECT looseSalesAllowUnregisteredCustomer
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { looseSalesAllowUnregisteredCustomer: number | null } | undefined;

    return Number(row?.looseSalesAllowUnregisteredCustomer ?? 0) !== 0;
  } catch {
    return false;
  }
}

function loadSalesInvoiceLockUnitPrice(
  db: ReturnType<typeof getDatabase>,
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "salesInvoiceLockUnitPrice")) {
      return false;
    }

    const row = db
      .prepare(
        `SELECT salesInvoiceLockUnitPrice
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { salesInvoiceLockUnitPrice: number | null } | undefined;

    return Number(row?.salesInvoiceLockUnitPrice ?? 1) !== 0;
  } catch {
    return false;
  }
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertSaleRouteWrite(
  role: string,
  saleProductMode: string | null | undefined,
): void {
  const routeId =
    saleProductMode === "BOTTLE" ? BOTTLE_OIL_SALES_ROUTE_ID : SALES_ROUTE_ID;
  assertRouteWrite(role, routeId);
}

function validateSaleLineProducts(
  db: ReturnType<typeof getDatabase>,
  lines: Array<{ productId: number }>,
  isBottleMode: boolean,
): string | null {
  const check = db.prepare(
    `SELECT p.productName, COALESCE(pc.isBottled, 0) AS isBottled
     FROM Product p
     INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
     WHERE p.productId = ?`,
  );

  for (const line of lines) {
    const row = check.get(line.productId) as
      | { productName: string; isBottled: number }
      | undefined;
    if (!row) {
      return `Product ${line.productId} was not found.`;
    }
    const isBottled = row.isBottled === 1;
    if (isBottleMode && !isBottled) {
      return `${row.productName} is not a bottled product. Use Sales Invoicing for loose products.`;
    }
    if (!isBottleMode && isBottled) {
      return `${row.productName} is bottled. Use Bottle Oil sales for bottled products.`;
    }
  }

  return null;
}

function getVatRateDecimal(): string {
  return String(loadTaxRatesAsOf(todayIsoDate()).vatRate);
}

function parseCustomerId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);

  return Number.isFinite(parsed) ? parsed : null;
}

function validateSalePaymentMethods(
  payments: CreateSaleInput["payments"],
): string | null {
  for (const payment of payments) {
    if (parseAmount(payment.amount) <= 0) {
      continue;
    }

    if (!String(payment.paymentMethodId ?? "").trim()) {
      return "Select a payment method.";
    }
  }

  return null;
}

function validateDispositionPayments(
  saleDisposition: CreateSaleInput["saleDisposition"] | undefined,
  payments: CreateSaleInput["payments"],
  invoiceGross: number,
): string | null {
  const disposition = saleDisposition ?? "NORMAL";
  const activePayments = payments.filter(
    (payment) => parseAmount(payment.amount) > 0,
  );
  const requiredMethodId = paymentMethodIdForDisposition(disposition);

  if (requiredMethodId) {
    if (activePayments.length !== 1) {
      return "Special dispositions require a single payment line.";
    }

    const payment = activePayments[0];
    if (payment.paymentMethodId !== requiredMethodId) {
      return "Payment method does not match sale disposition.";
    }

    if (Math.round(parseAmount(payment.amount)) !== invoiceGross) {
      return "Paid amount must equal invoice total.";
    }

    return null;
  }

  for (const payment of activePayments) {
    if (isDispositionPaymentMethodId(payment.paymentMethodId)) {
      return "Disposition payment methods are only allowed for Ration or Public relation sales.";
    }
  }

  return null;
}

function formatProductSummary(
  lines: Array<{ productName: string; qtyKg: string }>,
): string {
  if (lines.length === 0) {
    return "";
  }

  if (lines.length === 1) {
    return lines[0].productName;
  }

  return `${lines[0].productName} +${lines.length - 1} more`;
}

function getInvoiceOnlyTaxRegimeId(db: ReturnType<typeof getDatabase>): string | null {
  const simplified = db
    .prepare(
      `SELECT id FROM TaxRegime
       WHERE kind = 'SIMPLIFIED'
       ORDER BY name ASC
       LIMIT 1`,
    )
    .get() as { id: string } | undefined;

  if (simplified) {
    return simplified.id;
  }

  return (
    (db.prepare(`SELECT id FROM TaxRegime ORDER BY name ASC LIMIT 1`).get() as
      | { id: string }
      | undefined)?.id ?? null
  );
}

/**
 * Active sales-point storage locations for a product (SELLABLE condition qty > 0).
 * When asOfDateIso is set, balances are reconstructed from movements through that date.
 * PKCP/PKP → []. LPO + require-sales-tank setting → sales tanks only. Else any location.
 */
export function listStorageLocationsWithBalance(
  salesPointId: number,
  productId: number,
  asOfDateIso?: string | null,
): SalesStorageLocationBalanceOption[] {
  if (!Number.isFinite(salesPointId) || !Number.isFinite(productId)) {
    return [];
  }

  const db = getDatabase();
  const stockProductId = resolveStockProductId(db, productId);
  if (productOmitsStorageLocationById(db, stockProductId)) {
    return [];
  }

  const requireSalesTank = productRequiresSalesTankForLooseSale(db, stockProductId);
  const salesTankSql = requireSalesTank
    ? " AND COALESCE(sl.isSalesTank, 0) = 1"
    : "";

  const asOf =
    asOfDateIso?.trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const locations = db
    .prepare(
      `SELECT sl.id, l.locationName AS name
       FROM StorageLocation sl
       INNER JOIN Location l ON l.id = sl.locationId
       WHERE sl.salesPointId = ?
         AND COALESCE(sl.isActive, 1) = 1${salesTankSql}
       ORDER BY l.locationName ASC`,
    )
    .all(salesPointId) as Array<{ id: number; name: string }>;

  return locations
    .map((location) => ({
      id: location.id,
      name: location.name,
      qty: getAvailableSellableForSaleAsOf(
        db,
        salesPointId,
        stockProductId,
        location.id,
        asOf,
      ),
    }))
    .filter((row) => row.qty > QTY_EPS);
}

export function getSalesFormOptions(userId: string): SalesFormOptions {
  const db = getDatabase();
  const user = db
    .prepare(`SELECT role FROM User WHERE id = ?`)
    .get(userId) as { role: string } | undefined;
  const role = user?.role ?? "";
  const canDirectValidateLoose =
    Boolean(user) &&
    canWriteRoute(role, SALES_ROUTE_ID) &&
    canPerformAction(role, "direct_validate_sales");
  const canDirectValidateBottled =
    Boolean(user) &&
    canWriteRoute(role, BOTTLE_OIL_SALES_ROUTE_ID) &&
    canPerformAction(role, "direct_validate_sales");
  const canDirectValidate = canDirectValidateLoose || canDirectValidateBottled;

  const customers = db
    .prepare(
      `SELECT c.id, c.name, c.taxRegimeId, c.residency, c.taxpayerId,
              tr.name AS taxRegimeName, tr.kind AS taxRegimeKind,
              COALESCE(ct.exemptFromSalesTax, 0) AS exemptFromSalesTax
       FROM Customer c
       LEFT JOIN TaxRegime tr ON tr.id = c.taxRegimeId
       LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
       WHERE COALESCE(c.isPosPlaceholder, 0) = 0
       ORDER BY c.name ASC
       LIMIT 200`,
    )
    .all() as Array<{
    id: number;
    name: string;
    taxRegimeId: string | null;
    residency: string;
    taxpayerId: string | null;
    taxRegimeName: string | null;
    taxRegimeKind: string | null;
    exemptFromSalesTax: number;
  }>;

  const products = db
    .prepare(
      `SELECT p.productId, p.productName, p.productCode, pc.productCat,
              pc.productCode AS productCatCode, pc.isBottled,
              COALESCE(p.excludeFromSales, 0) AS excludeFromSales,
              COALESCE(p.omitsStorageLocation, 0) AS omitsStorageLocation
       FROM Product p
       INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE COALESCE(p.excludeFromSales, 0) = 0
       ORDER BY p.productName ASC
       LIMIT 200`,
    )
    .all() as Array<{
    productId: number;
    productName: string;
    productCode: string | null;
    productCat: string;
    productCatCode: string;
    isBottled: number;
    omitsStorageLocation: number;
  }>;

  const looseProducts = products
    .filter((product) => product.isBottled !== 1)
    .map(({ productId, productName, productCat, productCode, productCatCode, isBottled, omitsStorageLocation }) => ({
      productId,
      productName,
      productCat,
      productCatCode,
      isMain: isLooseLpoProduct({
        productCode,
        productName,
        isBottled,
      }),
      omitsStorageLocation: omitsStorageLocation === 1,
    }));

  const bottledProducts = products
    .filter((product) => product.isBottled === 1)
    .map(({ productId, productName, productCat, productCode, productCatCode, isBottled, omitsStorageLocation }) => ({
      productId,
      productName,
      productCat,
      productCatCode,
      isMain: isLooseLpoProduct({
        productCode,
        productName,
        isBottled,
      }),
      omitsStorageLocation: omitsStorageLocation === 1,
    }));

  const paymentMethods = db
    .prepare(
      `SELECT id, code, name, kind
       FROM PaymentMethodDefinition
       WHERE isActive = 1
         AND kind NOT IN ('CREDIT', 'PUBLIC_RELATION')
       ORDER BY sortOrder ASC, name ASC`,
    )
    .all() as SalesFormOptions["paymentMethods"];

  const scopedSalesPointId = getUserCollectionPointId(userId);
  const salesPoints = filterByCollectionPointScope(
    listActiveSalesPoints(db, 200),
    scopedSalesPointId,
  );

  const storageLocations = db
    .prepare(
      `SELECT sl.id, sl.salesPointId, l.locationName AS name, sl.isDefault,
              COALESCE(sl.isSalesTank, 0) AS isSalesTank
       FROM StorageLocation sl
       INNER JOIN Location l ON l.id = sl.locationId
       WHERE sl.salesPointId IS NOT NULL AND COALESCE(sl.isActive, 1) = 1
         AND EXISTS (
           SELECT 1 FROM SalesPoint sp
           WHERE sp.id = sl.salesPointId AND COALESCE(sp.isActive, 1) = 1
         )
         ${scopedSalesPointId == null ? "" : "AND sl.salesPointId = ?"}
       ORDER BY sl.salesPointId ASC, l.locationName ASC
       LIMIT 1000`,
    )
    .all(
      ...(scopedSalesPointId == null ? [] : [scopedSalesPointId]),
    ) as Array<{
    id: number;
    salesPointId: number;
    name: string;
    isDefault: number;
    isSalesTank: number;
  }>;

  const company = db
    .prepare(`SELECT companyName, vatRate FROM CompanySettings WHERE id = 'default'`)
    .get() as { companyName: string; vatRate: string } | undefined;

  const rates = loadTaxRatesAsOf(todayIsoDate());
  const companyVatRate = String(rates.vatRate);
  const mappedCustomers = customers.map((customer) => {
    const tax = resolveCustomerTaxProfile({
      residency: customer.residency,
      taxRegimeKind: customer.taxRegimeKind,
      taxpayerId: customer.taxpayerId,
      salesTaxExempt: customer.exemptFromSalesTax === 1,
      rates,
    });
    return {
      id: customer.id,
      name: customer.name,
      taxRegimeId: customer.taxRegimeId,
      taxRegimeName: customer.taxRegimeName,
      taxRegimeKind: customer.taxRegimeKind,
      residency: customer.residency,
      taxpayerId: customer.taxpayerId,
      vatApplies: tax.vatApplies,
      salesTaxExempt: customer.exemptFromSalesTax === 1,
      salesTaxRate: tax.salesTaxRate,
    };
  });

  const mappedLocations = storageLocations.map((location) => ({
    id: location.id,
    salesPointId: location.salesPointId,
    name: location.name,
    isDefault: location.isDefault === 1,
    isSalesTank: location.isSalesTank === 1,
  }));

  const botaSalesPoint =
    salesPoints.find((point) => point.name.toUpperCase().includes("BOTA")) ?? null;
  // Bottle oil sells from Bottle Oil Store — not a bulk sales tank.
  const bottleOilStoreLocation =
    mappedLocations.find(
      (location) =>
        botaSalesPoint != null &&
        location.salesPointId === botaSalesPoint.id &&
        location.name.toLowerCase().includes("bottle"),
    ) ?? null;

  return {
    customers: mappedCustomers,
    looseProducts,
    bottledProducts,
    paymentMethods,
    salesPoints,
    storageLocations: mappedLocations,
    scopedSalesPointId,
    vatRateDecimal: companyVatRate,
    companyName: company?.companyName ?? "Sales Electron",
    botaSalesPointId: botaSalesPoint?.id ?? null,
    bottleOilStoreLocationId: bottleOilStoreLocation?.id ?? null,
    invoiceOnlyTaxRegimeId: getInvoiceOnlyTaxRegimeId(db),
    canDirectValidate,
    canDirectValidateLoose,
    canDirectValidateBottled,
    bottleOilUseRegisteredCustomers: loadBottleOilUseRegisteredCustomers(db),
    bottleOilAllowRation: loadBottleOilAllowRation(db),
    looseSalesAllowPublicRelation: loadLooseSalesAllowPublicRelation(db),
    looseSalesAllowUnregisteredCustomer: loadLooseSalesAllowUnregisteredCustomer(db),
    loosePalmOilRequireSalesTank: loadLoosePalmOilRequireSalesTank(db),
    salesInvoiceLockUnitPrice: loadSalesInvoiceLockUnitPrice(db),
    autoGenerateSalesInvoiceNo: loadAutoGenerateSalesInvoiceNo(),
    enforceSalesInvoiceBookletValidation:
      loadEnforceSalesInvoiceBookletValidation(),
    rationPaymentMethodId: SYS_PM_RATION,
    publicRelationPaymentMethodId: SYS_PM_PUBLIC_RELATION,
  };
}

export function previewSaleUnitPrice(input: {
  productId: number;
  asOfDate: string;
  customerId?: number | null;
  saleDisposition?: SaleDisposition | null;
}): UnitPricePreviewResult {
  if (!Number.isFinite(input.productId) || input.productId <= 0) {
    return { ok: false, error: "Product is required." };
  }

  const asOfDate = input.asOfDate?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return { ok: false, error: "Transaction date must be YYYY-MM-DD." };
  }

  let customerTypeId: string | null = null;
  if (input.customerId != null) {
    const cid = parseCustomerId(input.customerId);
    if (cid == null) {
      return { ok: false, error: "Customer not found." };
    }

    const customer = getDatabase()
      .prepare(`SELECT id FROM Customer WHERE id = ?`)
      .get(cid) as { id: number } | undefined;
    if (!customer) {
      return { ok: false, error: "Customer not found." };
    }

    customerTypeId =
      input.saleDisposition === "RETAIL"
        ? getRetailCustomerTypeId()
        : getCustomerTypeIdForCustomer(cid);
  } else if (input.saleDisposition === "RATION") {
    customerTypeId = getStaffWorkerCustomerTypeId();
  } else if (
    input.saleDisposition === "PUBLIC_RELATION" ||
    input.saleDisposition === "RETAIL"
  ) {
    customerTypeId = getRetailCustomerTypeId();
  } else {
    // Normal invoice-only / unregistered: no customer type — LPO price requires a registered customer.
    customerTypeId = null;
  }

  const result = resolveUnitPriceExTax(input.productId, customerTypeId, asOfDate);
  if (!result.ok) {
    return result;
  }

  return { ok: true, unitPriceExTax: result.unitPriceExTax };
}

export function listPendingSales(): PendingSaleRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT s.invoiceNo, s.soldAt, s.grossAmount, s.customerNameSnapshot,
              sp.name AS salesPointName
       FROM Sale s
       LEFT JOIN SalesPoint sp ON sp.id = s.salesPointId
       WHERE s.status = 'PENDING'
       ORDER BY s.soldAt DESC, s.invoiceNo DESC
       LIMIT 200`,
    )
    .all() as Array<{
    invoiceNo: string;
    soldAt: string;
    grossAmount: string;
    customerNameSnapshot: string;
    salesPointName: string | null;
  }>;

  return rows.map((row) => ({
    invoiceNo: row.invoiceNo,
    soldAtIso: row.soldAt.slice(0, 10),
    customerName: row.customerNameSnapshot,
    totalLabel: formatXaf(row.grossAmount),
    salesPointName: row.salesPointName,
  }));
}

export function listSalesValidationQueue(userId: string): SalesValidationQueuePage {
  const db = getDatabase();
  const user = db
    .prepare(`SELECT role, salesPointId, isActive FROM User WHERE id = ?`)
    .get(userId) as
    | { role: string; salesPointId: number | null; isActive: number }
    | undefined;

  if (!user?.isActive) {
    throw new Error("Login required.");
  }
  if (!canPerformAction(user.role, "validate_sales")) {
    throw new Error("You do not have permission to validate sales.");
  }

  const scoped = user.salesPointId;
  const scopeSql =
    scoped == null ? "" : " AND s.salesPointId = @scopedSalesPointId";
  const params = { scopedSalesPointId: scoped ?? -1 };

  const totalPending = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM Sale s WHERE s.status = 'PENDING'${scopeSql}`,
      )
      .get(params) as { count: number }
  ).count;

  const rows = db
    .prepare(
      `SELECT s.id, s.invoiceNo, s.soldAt, s.dateIssued, s.grossAmount,
              s.customerNameSnapshot, s.saleProductMode,
              sp.name AS salesPointName,
              COALESCE(u.name, '—') AS createdByName,
              (SELECT COUNT(*) FROM SaleLine sl WHERE sl.saleId = s.id) AS lineCount
       FROM Sale s
       LEFT JOIN SalesPoint sp ON sp.id = s.salesPointId
       LEFT JOIN User u ON u.id = s.createdByUserId
       WHERE s.status = 'PENDING'${scopeSql}
       ORDER BY s.soldAt ASC, s.invoiceNo ASC
       LIMIT 200`,
    )
    .all(params) as Array<{
    id: string;
    invoiceNo: string;
    soldAt: string;
    dateIssued: string | null;
    grossAmount: string;
    customerNameSnapshot: string;
    saleProductMode: string | null;
    salesPointName: string | null;
    createdByName: string;
    lineCount: number;
  }>;

  return {
    totalPending,
    rows: rows.map((row) => ({
      id: row.id,
      invoiceNo: row.invoiceNo,
      soldAtIso: String(row.soldAt).slice(0, 10),
      dateIssuedIso: String(row.dateIssued ?? row.soldAt).slice(0, 10),
      customerName: row.customerNameSnapshot,
      salesPointName: row.salesPointName,
      createdByName: row.createdByName,
      saleProductMode:
        row.saleProductMode === "BOTTLE" || row.saleProductMode === "LOOSE"
          ? row.saleProductMode
          : null,
      totalLabel: formatXaf(row.grossAmount),
      lineCount: Number(row.lineCount) || 0,
    })),
  };
}

export function validateManySales(
  saleIds: string[],
  userId: string,
): SalesValidateManyResult {
  const uniqueIds = [
    ...new Set(saleIds.filter((id) => typeof id === "string" && id.trim())),
  ];
  if (uniqueIds.length === 0) {
    return { ok: false, error: "Select at least one sales invoice." };
  }

  let validated = 0;
  const errors: Array<{ id: string; invoiceNo?: string; error: string }> = [];

  for (const id of uniqueIds) {
    const result = validateSale(id, userId);
    if (result.ok) {
      validated += 1;
    } else {
      const invoiceNo = getDatabase()
        .prepare(`SELECT invoiceNo FROM Sale WHERE id = ?`)
        .get(id) as { invoiceNo: string } | undefined;
      errors.push({
        id,
        invoiceNo: invoiceNo?.invoiceNo,
        error: result.error,
      });
    }
  }

  return { ok: true, validated, errors };
}

export function loadSaleByInvoiceNo(
  invoiceNo: string,
  userId?: string,
): LoadedSaleView | null {
  const trimmed = invoiceNo.trim();
  if (!trimmed) {
    return null;
  }

  const db = getDatabase();
  const sale = db
    .prepare(
      `SELECT s.*, sp.name AS salesPointName,
              cu.name AS createdByName, vu.name AS validatedByName,
              canu.name AS cancelledByName
       FROM Sale s
       LEFT JOIN SalesPoint sp ON sp.id = s.salesPointId
       INNER JOIN User cu ON cu.id = s.createdByUserId
       LEFT JOIN User vu ON vu.id = s.validatedByUserId
       LEFT JOIN User canu ON canu.id = s.cancelledByUserId
       WHERE s.invoiceNo = ?`,
    )
    .get(trimmed) as Record<string, unknown> | undefined;

  if (!sale) {
    return null;
  }

  if (userId) {
    const scopeError = collectionPointScopeError(
      userId,
      sale.salesPointId == null ? null : Number(sale.salesPointId),
    );
    if (scopeError) {
      return null;
    }
  }

  const lines = db
    .prepare(
      `SELECT sl.*, p.productName, pc.productCat
       FROM SaleLine sl
       INNER JOIN Product p ON p.productId = sl.productId
       INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE sl.saleId = ?
       ORDER BY sl.id ASC`,
    )
    .all(sale.id) as Array<Record<string, unknown>>;

  const payments = db
    .prepare(
      `SELECT pay.*, pm.code AS methodCode, pm.name AS methodName, pm.kind
       FROM Payment pay
       INNER JOIN PaymentMethodDefinition pm ON pm.id = pay.paymentMethodId
       WHERE pay.saleId = ?
       ORDER BY pay.id ASC`,
    )
    .all(sale.id) as Array<Record<string, unknown>>;

  return {
    id: String(sale.id),
    invoiceNo: String(sale.invoiceNo),
    soldAtIso: String(sale.soldAt),
    referenceNumber: sale.referenceNumber ? String(sale.referenceNumber) : null,
    salesPointId: sale.salesPointId != null ? Number(sale.salesPointId) : null,
    salesPointName: sale.salesPointName ? String(sale.salesPointName) : null,
    customerId: sale.customerId != null ? Number(sale.customerId) : null,
    customerName: String(sale.customerNameSnapshot),
    createdByUserId: String(sale.createdByUserId),
    createdByName: String(sale.createdByName),
    status: sale.status as LoadedSaleView["status"],
    validatedAtIso: sale.validatedAt ? String(sale.validatedAt) : null,
    validatedByName: sale.validatedByName ? String(sale.validatedByName) : null,
    cancelledAtIso: sale.cancelledAt ? String(sale.cancelledAt) : null,
    cancelledByName: sale.cancelledByName ? String(sale.cancelledByName) : null,
    cancelReason: sale.cancelReason ? String(sale.cancelReason) : null,
    vehicleNumber: String(sale.vehicleNumber),
    dateIssuedIso: String(sale.dateIssued ?? sale.soldAt),
    deliveryOrderNo: sale.deliveryOrderNo ? String(sale.deliveryOrderNo) : null,
    saleProductMode: sale.saleProductMode
      ? (String(sale.saleProductMode) as LoadedSaleView["saleProductMode"])
      : null,
    saleDisposition: sale.saleDisposition
      ? (String(sale.saleDisposition) as LoadedSaleView["saleDisposition"])
      : null,
    netAmount: String(sale.netAmount),
    vatAmount: String(sale.vatAmount),
    grossAmount: String(sale.grossAmount),
    lines: lines.map((line) => ({
      productId: Number(line.productId),
      productName: String(line.productName),
      productCat: String(line.productCat),
      storageLocationId:
        line.storageLocationId != null ? Number(line.storageLocationId) : null,
      qtyKg: String(line.qtyKg),
      qtyUnits: line.qtyUnits != null ? String(line.qtyUnits) : null,
      unitPricePerKg: String(line.unitPricePerKg),
      unitPricePerUnit:
        line.unitPricePerUnit != null ? String(line.unitPricePerUnit) : null,
      lineNet: String(line.lineNet),
      lineVat: String(line.lineVat),
      lineGross: String(line.lineGross),
    })),
    payments: payments.map((payment) => ({
      paymentMethodId: String(payment.paymentMethodId),
      methodCode: String(payment.methodCode),
      methodName: String(payment.methodName),
      kind: payment.kind as LoadedSaleView["payments"][number]["kind"],
      amount: String(payment.amount),
      chequeNo: payment.chequeNo ? String(payment.chequeNo) : null,
      bank: payment.bank ? String(payment.bank) : null,
      traiteNo: payment.traiteNo ? String(payment.traiteNo) : null,
      traiteIssuedOn: payment.traiteIssuedOn ? String(payment.traiteIssuedOn) : null,
      traiteMaturityOn: payment.traiteMaturityOn
        ? String(payment.traiteMaturityOn)
        : null,
      paidAtIso: String(payment.paidAt),
    })),
  };
}

export function listSales(filters: SalesListFilters = {}): SalesListResult {
  const db = getDatabase();
  const q = String(filters.q ?? "").trim();
  const period = filters.period ?? "month";
  const params: unknown[] = [];
  const whereParts: string[] = [];

  const scopedSalesPointId =
    typeof filters.userId === "string" && filters.userId.trim()
      ? getUserCollectionPointId(filters.userId.trim())
      : null;
  if (scopedSalesPointId != null) {
    whereParts.push(`s.salesPointId = ?`);
    params.push(scopedSalesPointId);
  }

  if (q) {
    whereParts.push(`s.invoiceNo LIKE ?`);
    params.push(`%${q}%`);
  }

  const productMode = filters.productMode;
  if (productMode === "LOOSE" || productMode === "BOTTLE") {
    whereParts.push(`COALESCE(s.saleProductMode, 'LOOSE') = ?`);
    params.push(productMode);
  }

  const { fromIso, toIso, periodLabel } = resolveListDateRange(
    period === "year" || period === "all" ? period : "month",
  );
  if (fromIso && toIso) {
    whereParts.push(`substr(s.dateIssued, 1, 10) >= ?`);
    whereParts.push(`substr(s.dateIssued, 1, 10) <= ?`);
    params.push(fromIso, toIso);
  }

  const whereClause =
    whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT s.id, s.invoiceNo, s.dateIssued, s.status, s.grossAmount,
              s.customerNameSnapshot, s.deliveryOrderNo, sp.name AS salesPointName
       FROM Sale s
       LEFT JOIN SalesPoint sp ON sp.id = s.salesPointId
       ${whereClause}
       ORDER BY s.dateIssued DESC, s.invoiceNo DESC
       LIMIT 300`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  let totalAmount = 0;
  let totalQty = 0;
  const listRows: SalesListResult["rows"] = [];

  const isBottledList = productMode === "BOTTLE";

  for (const row of rows) {
    const lineRows = db
      .prepare(
        `SELECT sl.qtyKg, sl.qtyUnits, p.productName
         FROM SaleLine sl
         INNER JOIN Product p ON p.productId = sl.productId
         WHERE sl.saleId = ?`,
      )
      .all(row.id) as Array<{ qtyKg: string; qtyUnits: string | null; productName: string }>;

    const gross = parseAmount(String(row.grossAmount));
    let rowQty = 0;
    for (const line of lineRows) {
      if (isBottledList) {
        rowQty += parseAmount(line.qtyUnits ?? line.qtyKg);
      } else {
        rowQty += parseAmount(line.qtyKg);
      }
    }
    totalAmount += gross;
    totalQty += rowQty;

    listRows.push({
      id: String(row.id),
      invoiceNo: String(row.invoiceNo),
      soldAtIso: String(row.dateIssued).slice(0, 10),
      salesPointName: row.salesPointName ? String(row.salesPointName) : "",
      deliveryOrderNo: row.deliveryOrderNo ? String(row.deliveryOrderNo) : null,
      customerName: String(row.customerNameSnapshot),
      productSummary: formatProductSummary(lineRows),
      status: row.status as SalesListResult["rows"][number]["status"],
      totalQtyLabel: isBottledList
        ? `${trimQty(rowQty)} units`
        : `${trimQty(rowQty)} kg`,
      totalAmountXaf: formatXaf(gross),
    });
  }

  return {
    rows: listRows,
    totals: {
      count: listRows.length,
      totalQtyLabel: isBottledList
        ? `${trimQty(totalQty)} units`
        : `${trimQty(totalQty)} kg`,
      totalAmountXaf: formatXaf(totalAmount),
    },
    periodLabel,
  };
}

export async function createSale(input: CreateSaleInput): Promise<SaveSaleResult> {
  const db = getDatabase();

  if (!input.userId) {
    return { ok: false, error: "Login required." };
  }

  const role = getDatabase()
    .prepare(`SELECT role FROM User WHERE id = ?`)
    .get(input.userId) as { role: string } | undefined;

  if (!role) {
    return { ok: false, error: "User not found." };
  }

  const saleProductMode = input.saleProductMode ?? "LOOSE";

  try {
    assertSaleRouteWrite(role.role, saleProductMode);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  if (input.salesPointId != null && Number.isFinite(input.salesPointId)) {
    const spCheck = requireActiveSalesPoint(db, input.salesPointId);
    if (!spCheck.ok) {
      return { ok: false, error: spCheck.error };
    }
  }

  const scopeError = collectionPointScopeError(input.userId, input.salesPointId);
  if (scopeError) {
    return { ok: false, error: scopeError };
  }

  const validateImmediately = Boolean(input.validateImmediately);
  if (validateImmediately) {
    try {
      assertAction(role.role, "direct_validate_sales");
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "You do not have permission to validate sales directly.",
      };
    }
  }

  const isBottleMode = saleProductMode === "BOTTLE";
  const saleDisposition = input.saleDisposition ?? "NORMAL";
  const isSpecialDisposition =
    saleDisposition === "RATION" || saleDisposition === "PUBLIC_RELATION";
  /** Ration / Public relation / Retail: invoice name only (no directory customer). */
  const isInvoiceOnlyDisposition =
    isSpecialDisposition || saleDisposition === "RETAIL";
  const registeredCustomerId = parseCustomerId(input.customerId);
  const bottleOilUseRegisteredCustomers = isBottleMode
    ? loadBottleOilUseRegisteredCustomers(db)
    : true;
  const bottleOilAllowRation = isBottleMode
    ? loadBottleOilAllowRation(db)
    : true;
  const looseAllowUnregistered = isBottleMode
    ? false
    : loadLooseSalesAllowUnregisteredCustomer(db);

  if (isBottleMode && saleDisposition === "RATION" && !bottleOilAllowRation) {
    return {
      ok: false,
      error:
        "Ration disposition is not enabled for Bottle Oil sales. Change App settings or use a normal disposition.",
    };
  }

  if (
    !isBottleMode &&
    saleDisposition === "PUBLIC_RELATION" &&
    !loadLooseSalesAllowPublicRelation(db)
  ) {
    return {
      ok: false,
      error:
        "Public relation disposition is not enabled for Sales Invoicing. Change App settings or use a normal disposition.",
    };
  }

  const useRegisteredCustomer = isInvoiceOnlyDisposition
    ? false
    : isBottleMode
      ? bottleOilUseRegisteredCustomers
      : !looseAllowUnregistered;

  if (
    isBottleMode &&
    !isSpecialDisposition &&
    !bottleOilUseRegisteredCustomers &&
    registeredCustomerId != null
  ) {
    return {
      ok: false,
      error:
        "Bottle Oil sales is configured for invoice-only customers. Enter the customer name on the invoice.",
    };
  }

  if (
    !isBottleMode &&
    !isInvoiceOnlyDisposition &&
    !looseAllowUnregistered &&
    registeredCustomerId == null &&
    input.customerNameOverride?.trim()
  ) {
    return {
      ok: false,
      error:
        "Sales Invoicing requires a customer from the directory. Change App settings or select a registered customer.",
    };
  }

  if (!useRegisteredCustomer && !input.customerNameOverride?.trim()) {
    return { ok: false, error: "Enter the customer name on the invoice." };
  }

  if (useRegisteredCustomer && registeredCustomerId == null) {
    return { ok: false, error: "Select a customer." };
  }

  if (
    !isBottleMode &&
    !isSpecialDisposition &&
    saleDisposition !== "RETAIL" &&
    !input.vehicleNumber.trim()
  ) {
    return { ok: false, error: "Enter a vehicle number." };
  }

  const activeLines = input.lines.filter((line) => {
    if (!line.productId) {
      return false;
    }

    if (isBottleMode) {
      return parseAmount(line.qtyUnits ?? line.qtyKg) > 0;
    }

    return parseAmount(line.qtyKg) > 0;
  });

  if (activeLines.length === 0) {
    return { ok: false, error: "Add at least one line item." };
  }

  const productError = validateSaleLineProducts(db, activeLines, isBottleMode);
  if (productError) {
    return { ok: false, error: productError };
  }

  if (
    !isBottleMode &&
    (saleDisposition === "RATION" || saleDisposition === "PUBLIC_RELATION")
  ) {
    for (const line of activeLines) {
      if (!productIsLoosePalmOilById(db, line.productId)) {
        return {
          ok: false,
          error:
            "Ration and Public relation dispositions are only allowed for Loose Palm Oil products.",
        };
      }
    }
  }

  let customerId: number | null = null;
  let customerNameSnapshot: string;
  let taxRegimeId: string | null;
  let vatApplies = false;
  let salesTaxRate = 0;
  let vatRate = 0;

  if (useRegisteredCustomer) {
    const customer = db
      .prepare(
        `SELECT c.id, c.name, c.taxRegimeId, c.residency, c.taxpayerId,
                tr.kind AS taxRegimeKind,
                COALESCE(ct.exemptFromSalesTax, 0) AS exemptFromSalesTax
         FROM Customer c
         LEFT JOIN TaxRegime tr ON tr.id = c.taxRegimeId
         LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
         WHERE c.id = ?`,
      )
      .get(registeredCustomerId!) as
      | {
          id: number;
          name: string;
          taxRegimeId: string | null;
          residency: string;
          taxpayerId: string | null;
          taxRegimeKind: string | null;
          exemptFromSalesTax: number;
        }
      | undefined;

    if (!customer) {
      return { ok: false, error: "Customer not found." };
    }

    customerId = customer.id;
    customerNameSnapshot = customer.name;
    taxRegimeId = customer.taxRegimeId;

    const asOfDate = (input.dateIssued || todayIsoDate()).trim().slice(0, 10);
    const rates = loadTaxRatesAsOf(asOfDate);
    const tax = resolveCustomerTaxProfile({
      residency: customer.residency,
      taxRegimeKind: customer.taxRegimeKind,
      taxpayerId: customer.taxpayerId,
      salesTaxExempt: customer.exemptFromSalesTax === 1,
      rates,
    });
    vatApplies = tax.vatApplies;
    vatRate = tax.vatRate;
    salesTaxRate = tax.salesTaxRate;
  } else {
    customerNameSnapshot = input.customerNameOverride!.trim();
    taxRegimeId = getInvoiceOnlyTaxRegimeId(db);
  }

  const skipTax = isBottleMode || isSpecialDisposition;
  if (skipTax || !useRegisteredCustomer) {
    vatApplies = false;
    vatRate = 0;
    salesTaxRate = 0;
  }

  if (saleDisposition === "RETAIL") {
    if (isBottleMode) {
      return {
        ok: false,
        error: "Retail disposition is only available for loose product sales.",
      };
    }
    if (input.deliveryOrderNo?.trim()) {
      return {
        ok: false,
        error:
          "Retail sales cannot be linked to a delivery order. Clear the DO or use a normal disposition.",
      };
    }
    for (const line of activeLines) {
      const qty = parseAmount(line.qtyKg);
      if (qty >= DO_RETAIL_WHOLESALE_THRESHOLD_KG) {
        return { ok: false, error: retailSaleQtyTooHighMessage() };
      }
    }
  }

  if (input.deliveryOrderNo?.trim() && !isBottleMode && !isSpecialDisposition) {
    if (saleDisposition === "RETAIL") {
      return {
        ok: false,
        error: "Retail sales cannot be linked to a delivery order.",
      };
    }
    if (!useRegisteredCustomer || !customerId) {
      return {
        ok: false,
        error: "Delivery orders require a registered customer from the directory.",
      };
    }

    const doRow = db
      .prepare(
        `SELECT customerId FROM DeliveryOrder
         WHERE deliveryOrderNo = ? AND status = 'VALIDATED'`,
      )
      .get(input.deliveryOrderNo.trim()) as { customerId: number } | undefined;

    if (!doRow) {
      return { ok: false, error: "Delivery order not found or not validated." };
    }

    if (doRow.customerId !== customerId) {
      return {
        ok: false,
        error: "Selected customer does not match the delivery order.",
      };
    }
  }

  let netTotal = 0;
  let vatTotal = 0;
  let salesTaxTotal = 0;
  const computedLines = activeLines.map((line) => {
    if (isBottleMode) {
      const qty = parseAmount(line.qtyUnits ?? line.qtyKg);
      const unitPrice = parseAmount(line.unitPricePerUnit ?? line.unitPricePerKg);
      const lineGross = qty * unitPrice;
      netTotal += lineGross;
      return {
        ...line,
        qtyKg: roundMoney(qty),
        qtyUnits: roundMoney(qty),
        unitPricePerKg: roundMoney(unitPrice),
        unitPricePerUnit: roundMoney(unitPrice),
        lineNet: roundMoney(lineGross),
        lineVat: "0.00",
        lineGross: roundMoney(lineGross),
      };
    }

    const qty = parseAmount(line.qtyKg);
    const unitPrice = parseAmount(line.unitPricePerKg);
    const lineNet = qty * unitPrice;
    const lineVat = vatApplies ? lineNet * vatRate : 0;
    const lineSalesTax = lineNet * salesTaxRate;
    const lineGross = lineNet + lineVat + lineSalesTax;
    netTotal += lineNet;
    vatTotal += lineVat;
    salesTaxTotal += lineSalesTax;

    return {
      ...line,
      lineNet: roundMoney(lineNet),
      lineVat: roundMoney(lineVat),
      lineGross: roundMoney(lineGross),
    };
  });

  const grossTotal = isBottleMode ? netTotal : netTotal + vatTotal + salesTaxTotal;
  if (isBottleMode) {
    vatTotal = 0;
    salesTaxTotal = 0;
  }

  // Match UI totals: round net first, then tax on that net (FCFA have no decimals).
  // Comparing raw floats against the rounded paid amount caused false "must equal" failures.
  const invoiceNet = Math.round(isBottleMode ? grossTotal : netTotal);
  const invoiceVat = isBottleMode ? 0 : Math.round(invoiceNet * (vatApplies ? vatRate : 0));
  const invoiceSalesTax = isBottleMode ? 0 : Math.round(invoiceNet * salesTaxRate);
  const invoiceGross = isBottleMode
    ? invoiceNet
    : invoiceNet + invoiceVat + invoiceSalesTax;

  const paidTotal = Math.round(
    input.payments.reduce((sum, payment) => sum + parseAmount(payment.amount), 0),
  );

  if (paidTotal !== invoiceGross) {
    return {
      ok: false,
      error: "Paid amount must equal invoice total (no credit sales).",
    };
  }

  const paymentMethodError = validateSalePaymentMethods(input.payments);
  if (paymentMethodError) {
    return { ok: false, error: paymentMethodError };
  }

  const dispositionPaymentError = validateDispositionPayments(
    saleDisposition,
    input.payments,
    invoiceGross,
  );
  if (dispositionPaymentError) {
    return { ok: false, error: dispositionPaymentError };
  }

  const useCommandApi = isCommandApiEnabled();

  let invoiceNo: string;
  if (useCommandApi && loadAutoGenerateSalesInvoiceNo()) {
    // Server allocates the shared invoice number.
    invoiceNo = "";
  } else if (loadAutoGenerateSalesInvoiceNo()) {
    invoiceNo = allocateInvoiceNo(db);
    const duplicateInvoice = db
      .prepare(`SELECT 1 AS found FROM Sale WHERE invoiceNo = ?`)
      .get(invoiceNo) as { found: number } | undefined;
    if (duplicateInvoice) {
      return { ok: false, error: "Could not allocate a unique invoice number." };
    }
  } else {
    const serialResult = validateBookletSerial(input.invoiceNo);
    if (!serialResult.ok) {
      return { ok: false, error: serialResult.error };
    }

    invoiceNo = serialResult.serial;

    if (loadEnforceSalesInvoiceBookletValidation()) {
      if (input.salesPointId == null) {
        return {
          ok: false,
          error: "A collection point must be selected to validate booklet serial.",
        };
      }
      const bookletCheck = validateSerialForSalesPoint({
        documentKind: "SALES_INVOICE",
        serial: invoiceNo,
        salesPointId: input.salesPointId,
      });
      if (!bookletCheck.ok) {
        return { ok: false, error: bookletCheck.error };
      }
    }

    const duplicateInvoice = db
      .prepare(`SELECT 1 AS found FROM Sale WHERE invoiceNo = ?`)
      .get(invoiceNo) as { found: number } | undefined;

    if (duplicateInvoice) {
      return { ok: false, error: "This serial number is already used." };
    }
  }

  let saleId = newSaleId();
  const soldAt = input.dateIssued || nowIso().slice(0, 10);

  // HO: personal UserPostingMonth. CP user: their collection-point open month.
  let postingPeriod;
  try {
    postingPeriod = assertDateInOpenMonthForActor(soldAt, input.userId);
  } catch (periodError) {
    return {
      ok: false,
      error:
        periodError instanceof Error
          ? periodError.message
          : "Open a financial month before posting.",
    };
  }

  if (input.salesPointId != null && Number.isFinite(input.salesPointId)) {
    try {
      assertSaleLinesStockAsOf(db, {
        salesPointId: input.salesPointId,
        dateIssued: soldAt,
        isBottleMode,
        lines: computedLines.map((line) => ({
          productId: line.productId,
          qtyKg: line.qtyKg,
          qtyUnits: line.qtyUnits ?? null,
          storageLocationId: line.storageLocationId ?? null,
        })),
      });
    } catch (stockError) {
      if (isInsufficientStockError(stockError)) {
        return { ok: false, error: stockError.message };
      }
      return {
        ok: false,
        error:
          stockError instanceof Error ? stockError.message : "Could not verify stock.",
      };
    }
  }

  const timestamp = nowIso();

  if (useCommandApi) {
    const online = await requireCommandApiOnline();
    if (!online.ok) {
      return online;
    }
    if (input.salesPointId == null || !Number.isFinite(input.salesPointId)) {
      return { ok: false, error: "Collection point is required." };
    }

    const remote = await createSaleRemote({
      ...input,
      salesPointId: input.salesPointId,
      invoiceNo: invoiceNo || undefined,
      financialYear: postingPeriod.financialYear,
      financialMonth: postingPeriod.calendarMonth,
      postingCalendarYear: postingPeriod.financialYear,
      customerNameSnapshot,
      netAmount: roundMoney(invoiceNet),
      vatAmount: roundMoney(invoiceVat),
      grossAmount: roundMoney(invoiceGross),
      vatRateSnapshot: formatTaxRateSnapshot(vatRate),
      taxRegimeId,
      lines: computedLines.map((line) => ({
        productId: line.productId,
        qtyKg: String(line.qtyKg),
        unitPricePerKg: String(line.unitPricePerKg),
        lineNet: String(line.lineNet),
        lineVat: String(line.lineVat),
        lineGross: String(line.lineGross),
        qtyUnits: line.qtyUnits != null ? String(line.qtyUnits) : null,
        unitPricePerUnit:
          line.unitPricePerUnit != null ? String(line.unitPricePerUnit) : null,
        storageLocationId: line.storageLocationId ?? null,
      })),
      payments: input.payments.map((payment) => ({
        paymentMethodId:
          paymentMethodIdForDisposition(saleDisposition) ??
          payment.paymentMethodId,
        amount: String(roundMoney(parseAmount(payment.amount))),
        chequeNo: payment.chequeNo?.trim() || null,
        bank: payment.bank?.trim() || null,
        traiteNo: payment.traiteNo?.trim() || null,
        traiteIssuedOn: payment.traiteIssuedOn || null,
        traiteMaturityOn: payment.traiteMaturityOn || null,
      })),
    });

    if (!remote.ok) {
      return remote;
    }

    saleId = remote.saleId;
    invoiceNo = remote.invoiceNo;
  }

  const insertSale = db.prepare(
    `INSERT INTO Sale (
      id, invoiceNo, soldAt, customerId, createdByUserId, customerNameSnapshot,
      taxRegimeId, vatRateSnapshot, netAmount, vatAmount, grossAmount,
      createdAt, updatedAt, referenceNumber, salesPointId, status,
      vehicleNumber, dateIssued, deliveryOrderNo, saleProductMode, saleDisposition,
      financialYear, financialMonth, postingCalendarYear
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertLine = db.prepare(
    `INSERT INTO SaleLine (
      id, saleId, productId, qtyKg, unitPricePerKg, lineNet, lineVat, lineGross,
      qtyUnits, unitPricePerUnit, storageLocationId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertPayment = db.prepare(
    `INSERT INTO Payment (
      id, saleId, amount, chequeNo, paidAt, createdAt, bank,
      traiteNo, traiteIssuedOn, traiteMaturityOn, paymentMethodId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    insertSale.run(
      saleId,
      invoiceNo,
      soldAt,
      customerId,
      input.userId,
      customerNameSnapshot,
      taxRegimeId,
      formatTaxRateSnapshot(vatRate),
      roundMoney(invoiceNet),
      roundMoney(invoiceVat),
      roundMoney(invoiceGross),
      timestamp,
      timestamp,
      input.referenceNumber?.trim() || null,
      input.salesPointId ?? null,
      input.vehicleNumber.trim() || (isBottleMode ? "BPO-OUTBOUND" : ""),
      soldAt,
      isBottleMode || isSpecialDisposition
        ? null
        : input.deliveryOrderNo?.trim() || null,
      saleProductMode,
      saleDisposition,
      postingPeriod.financialYear,
      postingPeriod.calendarMonth,
      postingPeriod.financialYear,
    );

    for (const line of computedLines) {
      const stockProductId = resolveStockProductId(db, line.productId);
      const omitsStorage = productOmitsStorageLocationById(db, stockProductId);
      const storageLocationId = omitsStorage
        ? null
        : input.salesPointId != null && Number.isFinite(input.salesPointId)
          ? resolveSaleLineStorageLocation(
              db,
              input.salesPointId,
              stockProductId,
              line.storageLocationId ?? null,
              isBottleMode,
            )
          : (line.storageLocationId ?? null);

      insertLine.run(
        newSaleLineId(),
        saleId,
        line.productId,
        line.qtyKg ?? roundMoney(parseAmount(line.qtyKg)),
        line.unitPricePerKg ?? roundMoney(parseAmount(line.unitPricePerKg)),
        line.lineNet,
        line.lineVat,
        line.lineGross,
        line.qtyUnits ?? null,
        line.unitPricePerUnit ?? null,
        storageLocationId,
      );
    }

    for (const payment of input.payments) {
      if (parseAmount(payment.amount) <= 0) {
        continue;
      }

      const paymentMethodId =
        paymentMethodIdForDisposition(saleDisposition) ?? payment.paymentMethodId;

      insertPayment.run(
        newPaymentId(),
        saleId,
        roundMoney(parseAmount(payment.amount)),
        payment.chequeNo?.trim() || null,
        timestamp,
        timestamp,
        payment.bank?.trim() || null,
        payment.traiteNo?.trim() || null,
        payment.traiteIssuedOn || null,
        payment.traiteMaturityOn || null,
        paymentMethodId,
      );
    }

    if (vatApplies && invoiceVat > 0) {
      db.prepare(
        `INSERT INTO SaleAppliedTax (
          id, saleId, codeSnapshot, labelSnapshot, rateSnapshot, amount, createdAt
        ) VALUES (?, ?, 'VAT', 'VAT', ?, ?, ?)`,
      ).run(
        newSaleLineId(),
        saleId,
        formatTaxRateSnapshot(vatRate),
        roundMoney(invoiceVat),
        timestamp,
      );
    }

    if (invoiceSalesTax > 0) {
      db.prepare(
        `INSERT INTO SaleAppliedTax (
          id, saleId, codeSnapshot, labelSnapshot, rateSnapshot, amount, createdAt
        ) VALUES (?, ?, 'SALES_TAX', ?, ?, ?, ?)`,
      ).run(
        newSaleLineId(),
        saleId,
        SALES_TAX_LABEL,
        formatTaxRateSnapshot(salesTaxRate),
        roundMoney(invoiceSalesTax),
        timestamp,
      );
    }

    if (validateImmediately) {
      finalizeValidatedSale(db, {
        saleId,
        userId: input.userId,
        validatedAt: timestamp,
        salesPointId: input.salesPointId ?? null,
        dateIssued: soldAt,
        isBottleMode,
      });
    }

    const payload = serializeSaleForSync(db, saleId);
    if (payload) {
      enqueueOutboxItem(db, "Sale", saleId, "UPSERT", payload);
    }
  });

  try {
    tx();
    return { ok: true, saleId, invoiceNo };
  } catch (error) {
    if (isInsufficientStockError(error)) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not create sale.",
    };
  }
}

type FinalizeValidatedSaleInput = {
  saleId: string;
  userId: string;
  validatedAt: string;
  salesPointId: number | null;
  dateIssued: string;
  isBottleMode: boolean;
};

function finalizeValidatedSale(
  db: ReturnType<typeof getDatabase>,
  input: FinalizeValidatedSaleInput,
): void {
  if (input.salesPointId != null) {
    const lines = db
      .prepare(
        `SELECT productId, qtyKg, qtyUnits, storageLocationId
         FROM SaleLine
         WHERE saleId = ?
         ORDER BY id ASC`,
      )
      .all(input.saleId) as Array<{
      productId: number;
      qtyKg: string;
      qtyUnits: string | null;
      storageLocationId: number | null;
    }>;

    assertSaleLinesStockAsOf(db, {
      salesPointId: input.salesPointId,
      dateIssued: input.dateIssued,
      isBottleMode: input.isBottleMode,
      lines,
      excludeSaleId: input.saleId,
    });
  }

  db.prepare(
    `UPDATE Sale
     SET status = 'VALIDATED', validatedAt = ?, validatedByUserId = ?, updatedAt = ?
     WHERE id = ?`,
  ).run(input.validatedAt, input.userId, input.validatedAt, input.saleId);

  deductStockForValidatedSale(
    db,
    input.saleId,
    input.userId,
    input.validatedAt,
  );
}

export function validateSale(saleId: string, userId: string): SaleMutationResult {
  const online = requireCommandApiOnlineCached();
  if (!online.ok) {
    return online;
  }

  const db = getDatabase();
  const user = db
    .prepare(`SELECT role FROM User WHERE id = ?`)
    .get(userId) as { role: string } | undefined;

  if (!user || !canPerformAction(user.role, "validate_sales")) {
    return { ok: false, error: "You do not have permission to validate sales." };
  }

  const existing = db
    .prepare(
      `SELECT id, status, salesPointId, saleProductMode, dateIssued
       FROM Sale WHERE id = ?`,
    )
    .get(saleId) as
    | {
        id: string;
        status: string;
        salesPointId: number | null;
        saleProductMode: string | null;
        dateIssued: string | null;
      }
    | undefined;

  if (!existing) {
    return { ok: false, error: "Sale not found." };
  }

  const validateScopeError = collectionPointScopeError(
    userId,
    existing.salesPointId,
  );
  if (validateScopeError) {
    return { ok: false, error: validateScopeError };
  }

  if (existing.status === "VALIDATED") {
    return { ok: true };
  }

  try {
    assertSaleRouteWrite(user.role, existing.saleProductMode);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const validatedAt = nowIso();
  const dateIssued = String(existing.dateIssued ?? validatedAt).slice(0, 10);
  const isBottleMode = existing.saleProductMode === "BOTTLE";

  try {
    const tx = db.transaction(() => {
      finalizeValidatedSale(db, {
        saleId,
        userId,
        validatedAt,
        salesPointId: existing.salesPointId,
        dateIssued,
        isBottleMode,
      });

      const payload = serializeSaleForSync(db, saleId);
      if (payload) {
        enqueueOutboxItem(db, "Sale", saleId, "UPDATE", payload);
      }
    });

    tx();
    return { ok: true };
  } catch (error) {
    if (isInsufficientStockError(error)) {
      return { ok: false, error: error.message };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not validate sale.",
    };
  }
}

export function cancelValidatedSale(
  saleId: string,
  userId: string,
  reason: string,
): SaleMutationResult {
  const online = requireCommandApiOnlineCached();
  if (!online.ok) {
    return online;
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { ok: false, error: "Cancellation reason is required." };
  }

  const db = getDatabase();
  const user = db
    .prepare(`SELECT role FROM User WHERE id = ?`)
    .get(userId) as { role: string } | undefined;

  if (!user || !canPerformAction(user.role, "cancel_validated_sales")) {
    return {
      ok: false,
      error: "You do not have permission to cancel validated sales invoices.",
    };
  }

  const existing = db
    .prepare(
      `SELECT id, status, salesPointId, saleProductMode, invoiceNo FROM Sale WHERE id = ?`,
    )
    .get(saleId) as
    | {
        id: string;
        status: string;
        salesPointId: number | null;
        saleProductMode: string | null;
        invoiceNo: string;
      }
    | undefined;

  if (!existing) {
    return { ok: false, error: "Sale not found." };
  }

  const cancelScopeError = collectionPointScopeError(
    userId,
    existing.salesPointId,
  );
  if (cancelScopeError) {
    return { ok: false, error: cancelScopeError };
  }

  if (existing.status !== "VALIDATED") {
    return {
      ok: false,
      error: "Only validated sales invoices can be cancelled.",
    };
  }

  try {
    assertSaleRouteWrite(user.role, existing.saleProductMode);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const cancelledAt = nowIso();
  const cancelTx = db.transaction(() => {
    // 1. Reverse stock movements
    reverseStockForValidatedSale(
      db,
      saleId,
      userId,
      cancelledAt,
      `Cancellation of invoice ${existing.invoiceNo}: ${trimmedReason}`,
    );

    // 2. Mark Sale as REJECTED
    db.prepare(
      `UPDATE Sale
       SET status = 'REJECTED',
           cancelledAt = ?,
           cancelledByUserId = ?,
           cancelReason = ?,
           updatedAt = ?
       WHERE id = ?`,
    ).run(cancelledAt, userId, trimmedReason, cancelledAt, saleId);

    // 3. Reject any associated VehicleConsignmentNote
    db.prepare(
      `UPDATE VehicleConsignmentNote
       SET status = 'REJECTED',
           updatedAt = ?
       WHERE saleId = ?`,
    ).run(cancelledAt, saleId);

    // 4. Enqueue outbox update for PostgreSQL sync
    const payload = serializeSaleForSync(db, saleId);
    if (payload) {
      enqueueOutboxItem(db, "Sale", saleId, "UPDATE", payload);
    }
  });

  cancelTx();
  return { ok: true };
}

export function deleteSale(saleId: string, userId: string): SaleMutationResult {
  const online = requireCommandApiOnlineCached();
  if (!online.ok) {
    return online;
  }

  const db = getDatabase();
  const user = db
    .prepare(`SELECT role FROM User WHERE id = ?`)
    .get(userId) as { role: string } | undefined;

  if (!user) {
    return { ok: false, error: "User not found." };
  }

  try {
    assertRouteWrite(user.role, "sales");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const existing = db
    .prepare(
      `SELECT id, status, salesPointId, saleProductMode, invoiceNo FROM Sale WHERE id = ?`,
    )
    .get(saleId) as
    | {
        id: string;
        status: string;
        salesPointId: number | null;
        saleProductMode: string | null;
        invoiceNo: string;
      }
    | undefined;

  if (!existing) {
    return { ok: false, error: "Sale not found." };
  }

  const deleteScopeError = collectionPointScopeError(
    userId,
    existing.salesPointId,
  );
  if (deleteScopeError) {
    return { ok: false, error: deleteScopeError };
  }

  try {
    assertSaleRouteWrite(user.role, existing.saleProductMode);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  if (existing.status === "VALIDATED" || existing.status === "REJECTED") {
    if (!canPerformAction(user.role, "delete_validated_sales")) {
      return {
        ok: false,
        error: "Only administrators can delete validated or cancelled sales invoices.",
      };
    }
  }

  const deleteTx = db.transaction(() => {
    // If it was validated (and not already reversed via REJECTED), reverse stock movements first
    if (existing.status === "VALIDATED") {
      reverseStockForValidatedSale(
        db,
        saleId,
        userId,
        nowIso(),
        `Permanent deletion of invoice ${existing.invoiceNo}`,
      );
    }

    db.prepare(`DELETE FROM VehicleConsignmentNote WHERE saleId = ?`).run(saleId);
    db.prepare(`DELETE FROM SaleLine WHERE saleId = ?`).run(saleId);
    db.prepare(`DELETE FROM SaleAppliedTax WHERE saleId = ?`).run(saleId);
    db.prepare(`DELETE FROM Payment WHERE saleId = ?`).run(saleId);
    db.prepare(`DELETE FROM Sale WHERE id = ?`).run(saleId);
    enqueueOutboxItem(db, "Sale", saleId, "DELETE", { id: saleId });
  });

  deleteTx();
  return { ok: true };
}
