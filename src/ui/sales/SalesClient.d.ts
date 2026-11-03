import type { AuthUser } from "../auth/session.ts";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import { type SalesModuleVariant } from "../../shared/salesModule.ts";
import "./sales.css";
interface SalesClientProps {
    user: AuthUser;
    permissions: RolePermissionsSnapshot;
    variant?: SalesModuleVariant;
    onClose: () => void;
    initialInvoiceNo?: string;
}
export declare function SalesClient({ user, permissions, variant, onClose, initialInvoiceNo, }: SalesClientProps): import("preact").JSX.Element;
export {};
