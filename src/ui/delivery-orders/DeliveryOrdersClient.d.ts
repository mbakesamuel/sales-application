import type { AuthUser } from "../auth/session.ts";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import "../sales/sales.css";
import "./deliveryOrders.css";
interface DeliveryOrdersClientProps {
    user: AuthUser;
    permissions: RolePermissionsSnapshot;
    initialLookupNo?: string;
    /** Close the hosting modal (list refresh is handled by the parent). */
    onClose?: () => void;
}
export declare function DeliveryOrdersClient({ user, permissions, initialLookupNo, onClose, }: DeliveryOrdersClientProps): import("preact").JSX.Element;
export {};
