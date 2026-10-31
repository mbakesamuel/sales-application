import type { SalesBudgetWeeklyRevenueCrosstabReport } from "../../shared/reports.types.ts";
import "./StockCommitmentReport.css";
import "./SalesBudgetCrosstab.css";
interface SalesBudgetWeeklyRevenueCrosstabScreenProps {
    onNavigate?: (routeId: string) => void;
    windowMode?: boolean;
}
export declare function buildAmountMap(report: SalesBudgetWeeklyRevenueCrosstabReport): Map<string, number>;
export declare function SalesBudgetWeeklyRevenueCrosstabDocument({ report, amountMap, onNavigate, }: {
    report: SalesBudgetWeeklyRevenueCrosstabReport;
    amountMap: Map<string, number>;
    onNavigate?: (routeId: string) => void;
}): import("preact").JSX.Element;
export declare function SalesBudgetWeeklyRevenueCrosstabScreen({ onNavigate, windowMode, }: SalesBudgetWeeklyRevenueCrosstabScreenProps): import("preact").JSX.Element;
export {};
