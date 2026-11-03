import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import { type SalesModuleVariant } from "../../shared/salesModule.ts";
import type { AuthUser } from "../auth/session.ts";
import "../components/FormDialog.css";
import "./sales.css";
interface SalesScreenProps {
    user: AuthUser;
    permissions: RolePermissionsSnapshot;
    readOnly?: boolean;
    variant?: SalesModuleVariant;
}
export declare function SalesScreen({ user, permissions, readOnly, variant, }: SalesScreenProps): import("preact").JSX.Element;
export {};
