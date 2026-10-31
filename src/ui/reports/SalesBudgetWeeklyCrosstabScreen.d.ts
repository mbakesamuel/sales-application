import type { SalesBudgetWeeklyCrosstabReport } from "../../shared/reports.types.ts";
import "./StockCommitmentReport.css";
import "./SalesBudgetCrosstab.css";
interface SalesBudgetWeeklyCrosstabScreenProps {
    onNavigate?: (routeId: string) => void;
    windowMode?: boolean;
}
export declare function buildQtyMap(report: SalesBudgetWeeklyCrosstabReport): Map<string, number>;
export declare function SalesBudgetWeeklyCrosstabDocument({ report, qtyMap, onNavigate, }: {
    report: SalesBudgetWeeklyCrosstabReport;
    qtyMap: Map<string, number>;
    onNavigate?: (routeId: string) => void;
}): import("preact").JSX.Element;
export declare function SalesBudgetWeeklyCrosstabScreen({ onNavigate, windowMode, }: SalesBudgetWeeklyCrosstabScreenProps): import("preact").JSX.Element;
export {};
