import "../reports/StockCommitmentReport.css";
import "./DeliveryOrderPrintView.css";
interface DeliveryOrderPrintViewProps {
    orderId: number | string;
    onClose: () => void;
}
export declare function DeliveryOrderPrintView({ orderId, onClose, }: DeliveryOrderPrintViewProps): import("preact").JSX.Element;
export {};
