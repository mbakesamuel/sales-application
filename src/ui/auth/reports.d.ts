export declare function getAuthenticatedReports(): {
    getStockCommitment: (hideZero?: boolean, asAtIso?: string) => Promise<import("../../shared/reports.types.ts").StockCommitmentReport>;
    getStockReport: (hideZero?: boolean, asAtIso?: string) => Promise<import("../../shared/reports.types.ts").StockReport>;
    getCommitmentReport: (hideZero?: boolean) => Promise<import("../../shared/reports.types.ts").CommitmentReport>;
    getBottleOilStockSales: (hideZero?: boolean, asAtIso?: string) => Promise<import("../../shared/reports.types.ts").BottleOilStockSalesReport>;
    getBottledWeeklyIssues: (estimateBasis?: import("../../shared/reports.types.ts").BottledWeeklyEstimateBasis, weekMondayIso?: string) => Promise<import("../../shared/reports.types.ts").BottledWeeklyIssuesReport>;
    getWeekChoices: () => Promise<{
        asAtIso: string;
        weekChoices: import("../../shared/reports.types.ts").WeeklyDeliveriesWeekChoice[];
        defaultWeekMondayIso: string | null;
    }>;
    getWeeklyDeliveries: (weekMondayIso?: string, hideZero?: boolean) => Promise<import("../../shared/reports.types.ts").WeeklyDeliveriesReport>;
    getMonthlyDelivery: (half: 1 | 2) => Promise<import("../../shared/reports.types.ts").MonthlyDeliveryReport>;
    getMonthlyStockReconciliation: (hideZero?: boolean) => Promise<import("../../shared/reports.types.ts").MonthlyStockReconciliationReport>;
    getLooseLpoStockSummary: () => Promise<import("../../shared/reports.types.ts").LooseLpoStockSummaryReport>;
    getMonthlyPaymentDelivery: () => Promise<import("../../shared/reports.types.ts").MonthlyPaymentDeliveryReport>;
    getTransportCost: () => Promise<import("../../shared/reports.types.ts").TransportCostReport>;
    getMonthlyDeliveriesByDestination: () => Promise<import("../../shared/reports.types.ts").MonthlyDeliveriesByDestinationReport>;
    getMonthlyPalmOilSales: () => Promise<import("../../shared/reports.types.ts").MonthlyPalmOilSalesReport>;
    getPalmOilSalesActivity: () => Promise<import("../../shared/reports.types.ts").PalmOilSalesActivityReport>;
    getIndustryProductMonthlySales: () => Promise<import("../../shared/reports.types.ts").IndustryProductMonthlySalesReport>;
    getBottledPalmOilSalesReturn: () => Promise<import("../../shared/reports.types.ts").BottledPalmOilSalesReturnReport>;
    getOtherProductSalesDeliveries: () => Promise<import("../../shared/reports.types.ts").OtherProductSalesDeliveriesReport>;
    getMonthlyBottledOil: () => Promise<import("../../shared/reports.types.ts").MonthlyBottledOilReport>;
    getRevenueTaxes: (period?: import("../../shared/reports.types.ts").RevenueTaxesPeriod, salesPointId?: number | null) => Promise<import("../../shared/reports.types.ts").RevenueTaxesReport>;
    getSalesBudgetMonthlyCrosstab: (reportYear?: number) => Promise<import("../../shared/reports.types.ts").SalesBudgetMonthlyCrosstabReport>;
    getSalesBudgetWeeklyCrosstab: (reportYear?: number) => Promise<import("../../shared/reports.types.ts").SalesBudgetWeeklyCrosstabReport>;
    getSalesBudgetMonthlyRevenueCrosstab: (reportYear?: number) => Promise<import("../../shared/reports.types.ts").SalesBudgetMonthlyRevenueCrosstabReport>;
    getSalesBudgetWeeklyRevenueCrosstab: (reportYear?: number) => Promise<import("../../shared/reports.types.ts").SalesBudgetWeeklyRevenueCrosstabReport>;
    getDailySales: (reportDateIso: string, salesPointId?: number | null) => Promise<import("../../shared/reports.types.ts").DailySalesReport>;
    getDailySalesMatrix: (salesPointId?: number | null, productId?: number | null) => Promise<import("../../shared/reports.types.ts").DailySalesMatrixReport>;
    saveReportComments: (input: {
        reportId: string;
        text: string | null;
    }) => Promise<{
        ok: true;
        comments: string | null;
    } | {
        ok: false;
        error: string;
    }>;
    listSignatories: () => Promise<import("../../shared/reports.types.ts").ReportSignatoryRow[]>;
    getSignatory: (asAtIso?: string | null) => Promise<{
        name: string;
        title: string;
    }>;
    upsertSignatory: (input: {
        id?: string | null;
        name: string;
        title: string;
        effectiveFrom: string;
    }) => Promise<{
        ok: true;
        row: import("../../shared/reports.types.ts").ReportSignatoryRow;
    } | {
        ok: false;
        error: string;
    }>;
    deleteSignatory: (id: string) => Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
};
