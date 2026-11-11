import type { ProductOption, StockBalanceRow, StockCondition, StorageLocationOption } from "../../shared/stock.types.ts";
export type ReceiptLineDraft = {
    productId: string;
    qty: string;
    storageLocationId: string;
};
export type TransferLineDraft = {
    productId: string;
    qty: string;
    fromStorageLocationId: string;
    toStorageLocationId?: string;
};
export type AdjustmentLineDraft = {
    productId: string;
    deltaQty: string;
    storageLocationId: string;
    fromCondition?: StockCondition;
    toCondition?: StockCondition;
};
interface ReceiptLineEditorProps {
    products: ProductOption[];
    /** Full catalog for occupancy / bottled co-mingling checks (defaults to products). */
    locationProducts?: ProductOption[];
    lines: ReceiptLineDraft[];
    onChange: (next: ReceiptLineDraft[]) => void;
    locationOptions: StorageLocationOption[];
    defaultLocationId: string;
    onHand: StockBalanceRow[];
    salesPointId: string;
    stockIntakeOilGrouping?: boolean;
}
export declare function ReceiptLineEditor({ products, locationProducts, lines, onChange, locationOptions, defaultLocationId: defLoc, onHand, salesPointId, stockIntakeOilGrouping, }: ReceiptLineEditorProps): import("preact").JSX.Element;
interface TransferLineEditorProps {
    products: ProductOption[];
    lines: TransferLineDraft[];
    onChange: (next: TransferLineDraft[]) => void;
    mode: "inter" | "intra";
    fromSalesPointId: string;
    onHand: StockBalanceRow[];
    /** YYYY-MM-DD — shown in available-qty hint when set. */
    asOfDate?: string;
    fromLocationOptions: StorageLocationOption[];
    toLocationOptions: StorageLocationOption[];
    defaultFromLocationId: string;
    defaultToLocationId: string;
    /** Inter-point direct post: require destination location on create. */
    requireDestinationLocation?: boolean;
}
export declare function TransferLineEditor({ products, lines, onChange, mode, fromSalesPointId, onHand, asOfDate, fromLocationOptions, toLocationOptions, defaultFromLocationId: defFrom, defaultToLocationId: defTo, requireDestinationLocation, }: TransferLineEditorProps): import("preact").JSX.Element;
interface AdjustmentLineEditorProps {
    products: ProductOption[];
    lines: AdjustmentLineDraft[];
    onChange: (next: AdjustmentLineDraft[]) => void;
    locationOptions: StorageLocationOption[];
    defaultLocationId: string;
    mode: "ADJUST" | "RECLASSIFY";
    onHand: StockBalanceRow[];
    salesPointId: string;
}
export declare function AdjustmentLineEditor({ products, lines, onChange, locationOptions, defaultLocationId: defLoc, mode, onHand, salesPointId, }: AdjustmentLineEditorProps): import("preact").JSX.Element;
export {};
