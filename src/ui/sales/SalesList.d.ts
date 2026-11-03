import type { SaleProductMode } from "../../shared/sales.types.ts";
import type { SalesModuleVariant } from "../../shared/salesModule.ts";
import type { AuthUser } from "../auth/session.ts";
interface SalesListProps {
    user: AuthUser;
    variant?: SalesModuleVariant;
    listTitle?: string;
    productMode: SaleProductMode;
    onOpenInvoice: (invoiceNo: string) => void;
    onOpenScreen?: () => void;
}
export declare function SalesList({ user, variant, listTitle, productMode, onOpenInvoice, onOpenScreen, }: SalesListProps): import("preact").JSX.Element;
export {};
