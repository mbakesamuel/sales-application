import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import type { AuthUser } from "../auth/session.ts";
import "../components/FormDialog.css";
import "./deliveryOrders.css";
interface DeliveryOrdersScreenProps {
    user: AuthUser;
    permissions: RolePermissionsSnapshot;
    readOnly?: boolean;
    initialLookupNo?: string;
}
export declare function DeliveryOrdersScreen({ user, permissions, readOnly, initialLookupNo, }: DeliveryOrdersScreenProps): import("preact").JSX.Element;
export {};
