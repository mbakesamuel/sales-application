import "../customers/CustomersScreen.css";
import "./FinancialMonthsScreen.css";
interface FinancialMonthsScreenProps {
    readOnly?: boolean;
    /** Attached collection point, or null for head-office personal month. */
    salesPointId?: number | null;
}
export declare function FinancialMonthsScreen({ readOnly, salesPointId, }?: FinancialMonthsScreenProps): import("preact").JSX.Element;
export {};
