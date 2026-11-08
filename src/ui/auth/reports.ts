import { getAuthToken } from "./db.ts";
import { getElectronApi } from "./client.ts";

function requireAuthToken(): string {
  const token = getAuthToken();
  if (!token) {
    throw new Error("Login required.");
  }
  return token;
}

export function getAuthenticatedReports() {
  const api = getElectronApi().reports;

  return {
    getStockCommitment: (hideZero?: boolean, asAtIso?: string) =>
      api.getStockCommitment(requireAuthToken(), hideZero, asAtIso),
    getStockReport: (hideZero?: boolean, asAtIso?: string) =>
      api.getStockReport(requireAuthToken(), hideZero, asAtIso),
    getCommitmentReport: (hideZero?: boolean) =>
      api.getCommitmentReport(requireAuthToken(), hideZero),
    getBottleOilStockSales: (hideZero?: boolean, asAtIso?: string) =>
      api.getBottleOilStockSales(requireAuthToken(), hideZero, asAtIso),
    getBottledWeeklyIssues: (
      estimateBasis?: import("../../shared/reports.types.ts").BottledWeeklyEstimateBasis,
      weekMondayIso?: string,
    ) => api.getBottledWeeklyIssues(requireAuthToken(), estimateBasis, weekMondayIso),
    getWeekChoices: () => api.getWeekChoices(requireAuthToken()),
    getWeeklyDeliveries: (weekMondayIso?: string, hideZero?: boolean) =>
      api.getWeeklyDeliveries(requireAuthToken(), weekMondayIso, hideZero),
    getMonthlyDelivery: (half: 1 | 2) =>
      api.getMonthlyDelivery(half, requireAuthToken()),
    getMonthlyStockReconciliation: (hideZero?: boolean) =>
      api.getMonthlyStockReconciliation(requireAuthToken(), hideZero),
    getLooseLpoStockSummary: () =>
      api.getLooseLpoStockSummary(requireAuthToken()),
    getMonthlyPaymentDelivery: () =>
      api.getMonthlyPaymentDelivery(requireAuthToken()),
    getTransportCost: () => api.getTransportCost(requireAuthToken()),
    getMonthlyDeliveriesByDestination: () =>
      api.getMonthlyDeliveriesByDestination(requireAuthToken()),
    getMonthlyPalmOilSales: () =>
      api.getMonthlyPalmOilSales(requireAuthToken()),
    getPalmOilSalesActivity: () =>
      api.getPalmOilSalesActivity(requireAuthToken()),
    getIndustryProductMonthlySales: () =>
      api.getIndustryProductMonthlySales(requireAuthToken()),
    getBottledPalmOilSalesReturn: () =>
      api.getBottledPalmOilSalesReturn(requireAuthToken()),
    getOtherProductSalesDeliveries: () =>
      api.getOtherProductSalesDeliveries(requireAuthToken()),
    getMonthlyBottledOil: () =>
      api.getMonthlyBottledOil(requireAuthToken()),
    getRevenueTaxes: (
      period?: import("../../shared/reports.types.ts").RevenueTaxesPeriod,
      salesPointId?: number | null,
    ) => api.getRevenueTaxes(requireAuthToken(), period, salesPointId ?? null),
    getSalesBudgetMonthlyCrosstab: (reportYear?: number) =>
      api.getSalesBudgetMonthlyCrosstab(requireAuthToken(), reportYear),
    getSalesBudgetWeeklyCrosstab: (reportYear?: number) =>
      api.getSalesBudgetWeeklyCrosstab(requireAuthToken(), reportYear),
    getSalesBudgetMonthlyRevenueCrosstab: (reportYear?: number) =>
      api.getSalesBudgetMonthlyRevenueCrosstab(requireAuthToken(), reportYear),
    getSalesBudgetWeeklyRevenueCrosstab: (reportYear?: number) =>
      api.getSalesBudgetWeeklyRevenueCrosstab(requireAuthToken(), reportYear),
    getDailySales: (reportDateIso: string, salesPointId?: number | null) =>
      api.getDailySales(requireAuthToken(), reportDateIso, salesPointId ?? null),
    getDailySalesMatrix: (salesPointId?: number | null, productId?: number | null) =>
      api.getDailySalesMatrix(requireAuthToken(), salesPointId ?? null, productId ?? null),
    saveReportComments: (input: { reportId: string; text: string | null }) =>
      api.saveReportComments(requireAuthToken(), input),
    listSignatories: () => api.listSignatories(requireAuthToken()),
    getSignatory: (asAtIso?: string | null) =>
      api.getSignatory(requireAuthToken(), asAtIso ?? null),
    upsertSignatory: (input: {
      id?: string | null;
      name: string;
      title: string;
      effectiveFrom: string;
    }) => api.upsertSignatory(requireAuthToken(), input),
    deleteSignatory: (id: string) =>
      api.deleteSignatory(requireAuthToken(), id),
  };
}
