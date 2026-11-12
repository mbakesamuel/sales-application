import { StockCommitmentReportScreen } from "./StockCommitmentReport.tsx";
import { StockReportScreen } from "./StockReportScreen.tsx";
import { CommitmentReportScreen } from "./CommitmentReportScreen.tsx";
import { BottleOilStockSalesReportScreen } from "./BottleOilStockSalesReportScreen.tsx";
import { BottledWeeklyIssuesReportScreen } from "./BottledWeeklyIssuesReportScreen.tsx";
import { WeeklyDeliveriesReportScreen } from "./WeeklyDeliveriesReportScreen.tsx";
import { DailySalesReportScreen } from "./DailySalesReportScreen.tsx";
import { DailySalesMatrixReportScreen } from "./DailySalesMatrixReportScreen.tsx";
import {
  MonthlyDeliveryReportH1Screen,
  MonthlyDeliveryReportH2Screen,
} from "./MonthlyDeliveryReportScreen.tsx";
import { MonthlyStockReconciliationScreen } from "./MonthlyStockReconciliationScreen.tsx";
import { LooseLpoStockSummaryScreen } from "./LooseLpoStockSummaryScreen.tsx";
import { MonthlyPaymentDeliveryScreen } from "./MonthlyPaymentDeliveryScreen.tsx";
import { MonthlyDeliveriesByDestinationScreen } from "./MonthlyDeliveriesByDestinationScreen.tsx";
import { MonthlyPalmOilSalesScreen } from "./MonthlyPalmOilSalesScreen.tsx";
import { IndustryProductMonthlySalesScreen } from "./IndustryProductMonthlySalesScreen.tsx";
import { BottledPalmOilSalesReturnScreen } from "./BottledPalmOilSalesReturnScreen.tsx";
import { MonthlyBottledOilReportScreen } from "./MonthlyBottledOilReportScreen.tsx";
import { OtherProductSalesDeliveriesScreen } from "./OtherProductSalesDeliveriesScreen.tsx";
import { RevenueTaxesReportScreen } from "./RevenueTaxesReportScreen.tsx";
import { SalesBudgetMonthlyCrosstabScreen } from "./SalesBudgetMonthlyCrosstabScreen.tsx";
import { SalesBudgetMonthlyRevenueCrosstabScreen } from "./SalesBudgetMonthlyRevenueCrosstabScreen.tsx";
import { SalesBudgetWeeklyCrosstabScreen } from "./SalesBudgetWeeklyCrosstabScreen.tsx";
import { SalesBudgetWeeklyRevenueCrosstabScreen } from "./SalesBudgetWeeklyRevenueCrosstabScreen.tsx";
import { TransportCostReportScreen } from "./TransportCostReportScreen.tsx";
import { PalmOilSalesActivityScreen } from "./PalmOilSalesActivityScreen.tsx";
import { AuditTrailReportScreen } from "./AuditTrailReportScreen.tsx";
import { BinCardReportScreen } from "../stock/BinCardReportScreen.tsx";
import "./ReportLightSurface.css";

export function ReportBody({
  reportId,
  query,
  windowMode = true,
}: {
  reportId: string;
  query?: unknown;
  windowMode?: boolean;
}) {
  switch (reportId) {
    case "stock-commitment-report":
      return <StockCommitmentReportScreen windowMode={windowMode} />;
    case "stock-report":
      return <StockReportScreen windowMode={windowMode} />;
    case "commitment-report":
      return <CommitmentReportScreen windowMode={windowMode} />;
    case "bottle-oil-stock-sales-report":
      return <BottleOilStockSalesReportScreen windowMode={windowMode} />;
    case "bottled-weekly-issues-report":
      return <BottledWeeklyIssuesReportScreen windowMode={windowMode} />;
    case "sales-delivery-report":
      return <WeeklyDeliveriesReportScreen windowMode={windowMode} />;
    case "daily-sales-report":
      return <DailySalesReportScreen windowMode={windowMode} />;
    case "daily-sales-matrix-report":
      return <DailySalesMatrixReportScreen windowMode={windowMode} />;
    case "monthly-delivery-report-h1":
      return <MonthlyDeliveryReportH1Screen windowMode={windowMode} />;
    case "monthly-delivery-report-h2":
      return <MonthlyDeliveryReportH2Screen windowMode={windowMode} />;
    case "monthly-stock-reconciliation-report":
      return <MonthlyStockReconciliationScreen windowMode={windowMode} />;
    case "loose-lpo-stock-summary-report":
      return <LooseLpoStockSummaryScreen windowMode={windowMode} />;
    case "monthly-payment-delivery-report":
      return <MonthlyPaymentDeliveryScreen windowMode={windowMode} />;
    case "transport-cost-report":
      return <TransportCostReportScreen windowMode={windowMode} />;
    case "monthly-deliveries-by-destination-report":
      return <MonthlyDeliveriesByDestinationScreen windowMode={windowMode} />;
    case "monthly-palm-oil-sales-report":
      return <MonthlyPalmOilSalesScreen windowMode={windowMode} />;
    case "industry-product-monthly-sales-report":
      return <IndustryProductMonthlySalesScreen windowMode={windowMode} />;
    case "bottled-palm-oil-sales-return-report":
      return <BottledPalmOilSalesReturnScreen windowMode={windowMode} />;
    case "monthly-bottled-oil-report":
      return <MonthlyBottledOilReportScreen windowMode={windowMode} />;
    case "other-product-sales-deliveries-report":
      return <OtherProductSalesDeliveriesScreen windowMode={windowMode} />;
    case "stock-bin-card-report":
      return (
        <BinCardReportScreen
          windowMode={windowMode}
          initialQuery={query ?? null}
        />
      );
    case "revenue-taxes-report":
      return <RevenueTaxesReportScreen windowMode={windowMode} />;
    case "sales-budget-monthly-crosstab":
      return <SalesBudgetMonthlyCrosstabScreen windowMode={windowMode} />;
    case "sales-budget-weekly-crosstab":
      return <SalesBudgetWeeklyCrosstabScreen windowMode={windowMode} />;
    case "sales-budget-monthly-revenue-crosstab":
      return <SalesBudgetMonthlyRevenueCrosstabScreen windowMode={windowMode} />;
    case "sales-budget-weekly-revenue-crosstab":
      return <SalesBudgetWeeklyRevenueCrosstabScreen windowMode={windowMode} />;
    case "palm-oil-sales-activity-report":
      return <PalmOilSalesActivityScreen windowMode={windowMode} />;
    case "audit-trail-report":
      return <AuditTrailReportScreen windowMode={windowMode} />;
    default:
      return (
        <p class="scr-status scr-status-error">
          Unknown report: {reportId}
        </p>
      );
  }
}
