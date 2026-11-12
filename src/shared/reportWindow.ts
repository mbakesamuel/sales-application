/** Hash prefix for dedicated Electron report windows. */
export const REPORT_WINDOW_HASH_PREFIX = "#/report-window/";

/** Routes that open in a secondary BrowserWindow. */
export const REPORT_WINDOW_ROUTE_IDS = new Set([
  "daily-sales-report",
  "daily-sales-matrix-report",
  "stock-commitment-report",
  "stock-report",
  "commitment-report",
  "bottle-oil-stock-sales-report",
  "bottled-weekly-issues-report",
  "sales-delivery-report",
  "monthly-delivery-report-h1",
  "monthly-delivery-report-h2",
  "monthly-stock-reconciliation-report",
  "loose-lpo-stock-summary-report",
  "monthly-payment-delivery-report",
  "transport-cost-report",
  "monthly-deliveries-by-destination-report",
  "monthly-palm-oil-sales-report",
  "revenue-taxes-report",
  "industry-product-monthly-sales-report",
  "bottled-palm-oil-sales-return-report",
  "monthly-bottled-oil-report",
  "other-product-sales-deliveries-report",
  "palm-oil-sales-activity-report",
  "audit-trail-report",
  "stock-bin-card-report",
  "sales-budget-monthly-crosstab",
  "sales-budget-monthly-revenue-crosstab",
  "sales-budget-weekly-crosstab",
  "sales-budget-weekly-revenue-crosstab",
]);

export function parseReportWindowHash(hash = window.location.hash): string | null {
  if (!hash.startsWith(REPORT_WINDOW_HASH_PREFIX)) {
    return null;
  }
  const reportId = hash.slice(REPORT_WINDOW_HASH_PREFIX.length).split(/[?#]/)[0]?.trim() ?? "";
  return reportId.length > 0 ? reportId : null;
}

export function isReportWindowMode(): boolean {
  return parseReportWindowHash() != null;
}

export function opensInReportWindow(reportId: string): boolean {
  return REPORT_WINDOW_ROUTE_IDS.has(reportId);
}
