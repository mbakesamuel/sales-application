import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import "../components/FormDialog.css";
import "../customers/CustomersScreen.css";
import "./TransportCostComputeScreen.css";
interface TransportCostComputeScreenProps {
    permissions: RolePermissionsSnapshot;
    readOnly?: boolean;
}
export declare function TransportCostComputeScreen({ permissions, readOnly, }: TransportCostComputeScreenProps): import("preact").JSX.Element;
export {};
