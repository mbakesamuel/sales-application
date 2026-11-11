import type {
  ProductOption,
  StockBalanceRow,
  StockCondition,
  StorageLocationOption,
} from "../../shared/stock.types.ts";
import {
  buildReceiptIntakeGroups,
  filterReceiptPickerProducts,
  receiptIntakeDisplayName,
} from "../../shared/stockIntakeGroups.ts";
import { receiptLocationOptionsForProduct, trimQty } from "./stockUtils.ts";

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

export function ReceiptLineEditor({
  products,
  locationProducts,
  lines,
  onChange,
  locationOptions,
  defaultLocationId: defLoc,
  onHand,
  salesPointId,
  stockIntakeOilGrouping = false,
}: ReceiptLineEditorProps) {
  const occupancyProducts = locationProducts ?? products;
  const pickerProducts = filterReceiptPickerProducts(products, stockIntakeOilGrouping);
  const intakeGroups =
    stockIntakeOilGrouping && pickerProducts.length > 0
      ? buildReceiptIntakeGroups(products)
      : null;
  function locationsForLine(productId: string, currentLocationId: string): StorageLocationOption[] {
    const eligible = receiptLocationOptionsForProduct(
      locationOptions,
      onHand,
      salesPointId,
      productId,
      occupancyProducts,
    );
    if (!currentLocationId) {
      return eligible;
    }
    if (eligible.some((loc) => String(loc.id) === currentLocationId)) {
      return eligible;
    }
    const current = locationOptions.find((loc) => String(loc.id) === currentLocationId);
    return current ? [...eligible, current] : eligible;
  }

  function locationAfterProductChange(productId: string, currentLocationId: string): string {
    const eligible = receiptLocationOptionsForProduct(
      locationOptions,
      onHand,
      salesPointId,
      productId,
      occupancyProducts,
    );
    if (currentLocationId && eligible.some((loc) => String(loc.id) === currentLocationId)) {
      return currentLocationId;
    }
    if (defLoc && eligible.some((loc) => String(loc.id) === defLoc)) {
      return defLoc;
    }
    return "";
  }

  function update(idx: number, patch: Partial<ReceiptLineDraft>) {
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function add() {
    onChange([...lines, { productId: "", qty: "", storageLocationId: defLoc }]);
  }

  function remove(idx: number) {
    onChange(
      lines.length === 1
        ? [{ productId: "", qty: "", storageLocationId: defLoc }]
        : lines.filter((_, i) => i !== idx),
    );
  }

  return (
    <div class="stock-line-editor">
      <div class="stock-line-editor-header">
        <span class="stock-line-editor-title">Lines</span>
        <button type="button" class="stock-btn-secondary stock-btn-small" onClick={add}>
          + Add line
        </button>
      </div>
      <div class="stock-line-rows">
        {lines.map((l, idx) => {
          const product =
            products.find((p) => String(p.productId) === l.productId) ??
            pickerProducts.find((p) => String(p.productId) === l.productId);
          const uom = product?.uom ?? "";
          const lineOmitsStorage = product?.omitsStorageLocation ?? false;
          const lineLocations = locationsForLine(l.productId, l.storageLocationId);
          return (
            <div key={idx} class="stock-line-row stock-line-row-receipt">
              <select
                class="stock-line-select"
                value={l.productId}
                onChange={(event) => {
                  const productId = (event.currentTarget as HTMLSelectElement).value;
                  const nextProduct =
                    products.find((p) => String(p.productId) === productId) ??
                    pickerProducts.find((p) => String(p.productId) === productId);
                  update(idx, {
                    productId,
                    storageLocationId: nextProduct?.omitsStorageLocation
                      ? ""
                      : locationAfterProductChange(productId, l.storageLocationId),
                  });
                }}
                aria-label="Product"
              >
                <option value="">Select product…</option>
                {intakeGroups
                  ? intakeGroups.map((group) => (
                      <optgroup key={group.key} label={group.label}>
                        {group.products.map((p) => (
                          <option key={p.productId} value={p.productId}>
                            {receiptIntakeDisplayName(p)}
                            {p.omitsStorageLocation ? " · no location" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : pickerProducts.map((p) => (
                      <option key={p.productId} value={p.productId}>
                        {p.productName}
                        {p.omitsStorageLocation ? " · no location" : ""}
                      </option>
                    ))}
              </select>
              {lineOmitsStorage ? (
                <span class="stock-line-location-placeholder stock-muted">—</span>
              ) : (
                <select
                  class="stock-line-select"
                  value={l.storageLocationId}
                  onChange={(event) =>
                    update(idx, {
                      storageLocationId: (event.currentTarget as HTMLSelectElement).value,
                    })
                  }
                  aria-label="Storage location"
                  required
                >
                  <option value="">Location…</option>
                  {lineLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                      {loc.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="number"
                step="0.001"
                min="0"
                class="stock-line-input"
                value={l.qty}
                onInput={(event) =>
                  update(idx, { qty: (event.currentTarget as HTMLInputElement).value })
                }
                aria-label="Quantity"
                placeholder="Qty"
              />
              <span class="stock-line-uom">{uom}</span>
              <button
                type="button"
                class="stock-line-remove"
                onClick={() => remove(idx)}
                aria-label="Remove line"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {locationOptions.length === 0 ? (
        <p class="stock-hint stock-hint-warn">
          Add storage locations for this collection point under Storage locations.
        </p>
      ) : null}
    </div>
  );
}

function transferAvailableQty(
  onHand: StockBalanceRow[],
  fromSalesPointId: string,
  fromStorageLocationId: string,
  productId: string,
): string {
  if (!fromSalesPointId || !fromStorageLocationId || !productId) return "0";
  const row = onHand.find(
    (r) =>
      String(r.salesPointId) === fromSalesPointId &&
      String(r.storageLocationId) === fromStorageLocationId &&
      String(r.productId) === productId &&
      r.condition === "SELLABLE",
  );
  return row?.qty ?? "0";
}

const STOCK_OPTION_SEP = "|";

type TransferStockOption = {
  key: string;
  productId: string;
  fromStorageLocationId: string;
  productName: string;
  storageLocationName: string;
  uom: string;
  qtyLabel: string;
};

type AdjustmentStockOption = {
  key: string;
  productId: string;
  storageLocationId: string;
  productName: string;
  storageLocationName: string;
  uom: string;
  qtyLabel: string;
};

function stockOptionKey(productId: string, fromStorageLocationId: string): string {
  return `${productId}${STOCK_OPTION_SEP}${fromStorageLocationId}`;
}

function parseStockOptionKey(
  value: string,
): { productId: string; fromStorageLocationId: string } | null {
  const sep = value.indexOf(STOCK_OPTION_SEP);
  if (sep <= 0 || sep === value.length - 1) {
    return null;
  }
  return {
    productId: value.slice(0, sep),
    fromStorageLocationId: value.slice(sep + 1),
  };
}

function formatStockQtyLabel(qty: string): string {
  const n = Number.parseFloat(qty);
  if (!Number.isFinite(n)) {
    return trimQty(qty);
  }
  return Math.round(n).toLocaleString("en-US");
}

function productLabel(
  products: ProductOption[],
  productId: string,
  fallback: string,
): string {
  const product = products.find((p) => String(p.productId) === productId);
  if (product) {
    return receiptIntakeDisplayName(product);
  }
  return fallback;
}

function buildAdjustmentStockOptions(
  onHand: StockBalanceRow[],
  salesPointId: string,
  lines: AdjustmentLineDraft[],
  products: ProductOption[],
  locationOptions: StorageLocationOption[],
  condition: StockCondition,
): AdjustmentStockOption[] {
  if (!salesPointId) {
    return [];
  }

  const byKey = new Map<string, AdjustmentStockOption>();

  for (const row of onHand) {
    if (String(row.salesPointId) !== salesPointId) {
      continue;
    }
    if (row.condition !== condition) {
      continue;
    }
    const qtyNum = Number.parseFloat(row.qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      continue;
    }
    const productId = String(row.productId);
    const storageLocationId = String(row.storageLocationId);
    const key = stockOptionKey(productId, storageLocationId);
    byKey.set(key, {
      key,
      productId,
      storageLocationId,
      productName: row.productName,
      storageLocationName: row.storageLocationName,
      uom: row.uom,
      qtyLabel: formatStockQtyLabel(row.qty),
    });
  }

  for (const line of lines) {
    if (!line.productId || !line.storageLocationId) {
      continue;
    }
    const key = stockOptionKey(line.productId, line.storageLocationId);
    if (byKey.has(key)) {
      continue;
    }
    const product = products.find((p) => String(p.productId) === line.productId);
    const location = locationOptions.find((loc) => String(loc.id) === line.storageLocationId);
    const onHandRow = onHand.find(
      (r) =>
        String(r.salesPointId) === salesPointId &&
        String(r.productId) === line.productId &&
        String(r.storageLocationId) === line.storageLocationId &&
        r.condition === condition,
    );
    byKey.set(key, {
      key,
      productId: line.productId,
      storageLocationId: line.storageLocationId,
      productName: product?.productName ?? onHandRow?.productName ?? `Product ${line.productId}`,
      storageLocationName:
        location?.name ?? onHandRow?.storageLocationName ?? `Location ${line.storageLocationId}`,
      uom: product?.uom ?? onHandRow?.uom ?? "",
      qtyLabel: formatStockQtyLabel(onHandRow?.qty ?? "0"),
    });
  }

  return [...byKey.values()].sort((a, b) => {
    const byName = a.productName.localeCompare(b.productName);
    if (byName !== 0) {
      return byName;
    }
    return a.storageLocationName.localeCompare(b.storageLocationName);
  });
}

function buildTransferStockOptions(
  onHand: StockBalanceRow[],
  fromSalesPointId: string,
  lines: TransferLineDraft[],
  products: ProductOption[],
  fromLocationOptions: StorageLocationOption[],
): TransferStockOption[] {
  if (!fromSalesPointId) {
    return [];
  }

  const byKey = new Map<string, TransferStockOption>();

  for (const row of onHand) {
    if (String(row.salesPointId) !== fromSalesPointId) {
      continue;
    }
    if (row.condition !== "SELLABLE") {
      continue;
    }
    const qtyNum = Number.parseFloat(row.qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      continue;
    }
    const productId = String(row.productId);
    const fromStorageLocationId = String(row.storageLocationId);
    const key = stockOptionKey(productId, fromStorageLocationId);
    byKey.set(key, {
      key,
      productId,
      fromStorageLocationId,
      productName: productLabel(products, productId, row.productName),
      storageLocationName: row.storageLocationName,
      uom: row.uom,
      qtyLabel: formatStockQtyLabel(row.qty),
    });
  }

  for (const line of lines) {
    if (!line.productId || !line.fromStorageLocationId) {
      continue;
    }
    const key = stockOptionKey(line.productId, line.fromStorageLocationId);
    if (byKey.has(key)) {
      continue;
    }
    const product = products.find((p) => String(p.productId) === line.productId);
    const location = fromLocationOptions.find(
      (loc) => String(loc.id) === line.fromStorageLocationId,
    );
    const onHandRow = onHand.find(
      (r) =>
        String(r.salesPointId) === fromSalesPointId &&
        String(r.productId) === line.productId &&
        String(r.storageLocationId) === line.fromStorageLocationId,
    );
    byKey.set(key, {
      key,
      productId: line.productId,
      fromStorageLocationId: line.fromStorageLocationId,
      productName: productLabel(
        products,
        line.productId,
        product?.productName ?? onHandRow?.productName ?? `Product ${line.productId}`,
      ),
      storageLocationName:
        location?.name ?? onHandRow?.storageLocationName ?? `Location ${line.fromStorageLocationId}`,
      uom: product?.uom ?? onHandRow?.uom ?? "",
      qtyLabel: formatStockQtyLabel(onHandRow?.qty ?? "0"),
    });
  }

  return [...byKey.values()].sort((a, b) => {
    const byName = a.productName.localeCompare(b.productName);
    if (byName !== 0) {
      return byName;
    }
    return a.storageLocationName.localeCompare(b.storageLocationName);
  });
}

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

export function TransferLineEditor({
  products,
  lines,
  onChange,
  mode,
  fromSalesPointId,
  onHand,
  asOfDate,
  fromLocationOptions,
  toLocationOptions,
  defaultFromLocationId: defFrom,
  defaultToLocationId: defTo,
  requireDestinationLocation = false,
}: TransferLineEditorProps) {
  const showDestinationLocation = mode === "intra" || requireDestinationLocation;

  function update(idx: number, patch: Partial<TransferLineDraft>) {
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function blankLine(): TransferLineDraft {
    return showDestinationLocation
      ? { productId: "", qty: "", fromStorageLocationId: defFrom, toStorageLocationId: defTo }
      : { productId: "", qty: "", fromStorageLocationId: defFrom };
  }

  function add() {
    onChange([...lines, blankLine()]);
  }

  function remove(idx: number) {
    onChange(lines.length === 1 ? [blankLine()] : lines.filter((_, i) => i !== idx));
  }

  const stockOptions = buildTransferStockOptions(
    onHand,
    fromSalesPointId,
    lines,
    products,
    fromLocationOptions,
  );

  return (
    <div class="stock-line-editor">
      <div class="stock-line-editor-header">
        <span class="stock-line-editor-title">Lines</span>
        <button type="button" class="stock-btn-secondary stock-btn-small" onClick={add}>
          + Add line
        </button>
      </div>
      <div class="stock-line-rows">
        {lines.map((l, idx) => {
          const product = products.find((p) => String(p.productId) === l.productId);
          const uom = product?.uom ?? "";
          const availableStr = transferAvailableQty(
            onHand,
            fromSalesPointId,
            l.fromStorageLocationId,
            l.productId,
          );
          const availableNum = Number.parseFloat(availableStr);
          const qtyNum = Number.parseFloat(l.qty);
          const sameLocation =
            showDestinationLocation &&
            Boolean(l.fromStorageLocationId) &&
            Boolean(l.toStorageLocationId) &&
            l.fromStorageLocationId === l.toStorageLocationId;
          const overAvailable =
            Boolean(l.productId) &&
            Boolean(l.fromStorageLocationId) &&
            Boolean(l.qty) &&
            Number.isFinite(qtyNum) &&
            Number.isFinite(availableNum) &&
            qtyNum > availableNum;
          const productSelectValue =
            l.productId && l.fromStorageLocationId
              ? stockOptionKey(l.productId, l.fromStorageLocationId)
              : "";
          return (
            <div key={idx} class="stock-line-block">
              <div
                class={`stock-line-row stock-line-row-transfer${
                  showDestinationLocation ? " stock-line-row-transfer-intra" : ""
                }`}
              >
                <select
                  class="stock-line-select"
                  value={productSelectValue}
                  disabled={!fromSalesPointId}
                  onChange={(event) => {
                    const raw = (event.currentTarget as HTMLSelectElement).value;
                    if (!raw) {
                      update(idx, { productId: "", fromStorageLocationId: defFrom });
                      return;
                    }
                    const parsed = parseStockOptionKey(raw);
                    if (!parsed) {
                      return;
                    }
                    update(idx, {
                      productId: parsed.productId,
                      fromStorageLocationId: parsed.fromStorageLocationId,
                    });
                  }}
                  aria-label="Product"
                >
                  <option value="">
                    {fromSalesPointId
                      ? "Select product with stock…"
                      : "Select From collection point first…"}
                  </option>
                  {stockOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.productName} — {opt.storageLocationName} ({opt.qtyLabel}
                      {opt.uom ? ` ${opt.uom}` : ""})
                    </option>
                  ))}
                </select>
                <select
                  class="stock-line-select"
                  value={l.fromStorageLocationId}
                  onChange={(event) =>
                    update(idx, {
                      fromStorageLocationId: (event.currentTarget as HTMLSelectElement).value,
                    })
                  }
                  aria-label="From location"
                >
                  <option value="">From…</option>
                  {fromLocationOptions.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                {showDestinationLocation ? (
                  <select
                    class={`stock-line-select${sameLocation ? " stock-line-input-error" : ""}`}
                    value={l.toStorageLocationId ?? ""}
                    onChange={(event) =>
                      update(idx, {
                        toStorageLocationId: (event.currentTarget as HTMLSelectElement).value,
                      })
                    }
                    aria-label="To location"
                    required
                  >
                    <option value="">To…</option>
                    {toLocationOptions.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  class={`stock-line-input${overAvailable ? " stock-line-input-error" : ""}`}
                  value={l.qty}
                  onInput={(event) =>
                    update(idx, { qty: (event.currentTarget as HTMLInputElement).value })
                  }
                  aria-label="Quantity"
                />
                <span class="stock-line-uom">{uom}</span>
                <button
                  type="button"
                  class="stock-line-remove"
                  onClick={() => remove(idx)}
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
              {l.productId && l.fromStorageLocationId ? (
                <p
                  class={`stock-line-note${
                    overAvailable || sameLocation ? " stock-hint-warn" : ""
                  }`}
                >
                  Transferable
                  {asOfDate ? ` as of ${asOfDate}` : " at source"}:{" "}
                  {trimQty(availableStr)} {uom}
                  {asOfDate
                    ? " (lower of that date and current on-hand)"
                    : ""}
                  {overAvailable ? " — exceeds transferable stock" : ""}
                  {sameLocation ? " — from and to locations must differ" : ""}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

export function AdjustmentLineEditor({
  products,
  lines,
  onChange,
  locationOptions,
  defaultLocationId: defLoc,
  mode,
  onHand,
  salesPointId,
}: AdjustmentLineEditorProps) {
  function update(idx: number, patch: Partial<AdjustmentLineDraft>) {
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function add() {
    onChange([
      ...lines,
      {
        productId: "",
        deltaQty: "",
        storageLocationId: defLoc,
        fromCondition: "SELLABLE",
        toCondition: "UNSELLABLE",
      },
    ]);
  }

  function remove(idx: number) {
    onChange(
      lines.length === 1
        ? [
            {
              productId: "",
              deltaQty: "",
              storageLocationId: defLoc,
              fromCondition: "SELLABLE",
              toCondition: "UNSELLABLE",
            },
          ]
        : lines.filter((_, i) => i !== idx),
    );
  }

  return (
    <div class="stock-line-editor">
      <div class="stock-line-editor-header">
        <span class="stock-line-editor-title">Lines</span>
        <button type="button" class="stock-btn-secondary stock-btn-small" onClick={add}>
          + Add line
        </button>
      </div>
      <div class="stock-line-rows">
        {lines.map((l, idx) => {
          const product = products.find((p) => String(p.productId) === l.productId);
          const uom = product?.uom ?? "";
          const spIdNum = Number.parseInt(salesPointId, 10);
          const locIdNum = Number.parseInt(l.storageLocationId, 10);
          const productIdNum = Number.parseInt(l.productId, 10);
          const fromCond = l.fromCondition ?? "SELLABLE";
          const stockCondition: StockCondition =
            mode === "RECLASSIFY" ? fromCond : "SELLABLE";
          const stockOptions = buildAdjustmentStockOptions(
            onHand,
            salesPointId,
            [l],
            products,
            locationOptions,
            stockCondition,
          );
          const availableStr =
            mode === "RECLASSIFY" &&
            Number.isFinite(spIdNum) &&
            Number.isFinite(locIdNum) &&
            Number.isFinite(productIdNum)
              ? onHand.find(
                  (r) =>
                    r.salesPointId === spIdNum &&
                    r.storageLocationId === locIdNum &&
                    r.productId === productIdNum &&
                    r.condition === fromCond,
                )?.qty ?? "0"
              : null;
          const availableNum = availableStr != null ? Number.parseFloat(availableStr) : NaN;
          const qtyNum = Number.parseFloat(l.deltaQty);
          const overAvailable =
            mode === "RECLASSIFY" &&
            availableStr != null &&
            Boolean(l.deltaQty) &&
            Number.isFinite(qtyNum) &&
            Number.isFinite(availableNum) &&
            qtyNum > availableNum;
          const productSelectValue =
            l.productId && l.storageLocationId
              ? stockOptionKey(l.productId, l.storageLocationId)
              : "";
          return (
            <div key={idx} class="stock-line-block">
              <div
                class={`stock-line-row ${
                  mode === "RECLASSIFY" ? "stock-line-row-reclassify" : "stock-line-row-adjust"
                }`}
              >
                <select
                  class="stock-line-select"
                  value={productSelectValue}
                  disabled={!salesPointId}
                  onChange={(event) => {
                    const raw = (event.currentTarget as HTMLSelectElement).value;
                    if (!raw) {
                      update(idx, { productId: "", storageLocationId: defLoc });
                      return;
                    }
                    const parsed = parseStockOptionKey(raw);
                    if (!parsed) {
                      return;
                    }
                    update(idx, {
                      productId: parsed.productId,
                      storageLocationId: parsed.fromStorageLocationId,
                    });
                  }}
                  aria-label="Product"
                >
                  <option value="">
                    {salesPointId
                      ? "Select product with stock…"
                      : "Select collection point first…"}
                  </option>
                  {stockOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.productName} — {opt.storageLocationName} ({opt.qtyLabel}
                      {opt.uom ? ` ${opt.uom}` : ""})
                    </option>
                  ))}
                </select>
                <select
                  class="stock-line-select"
                  value={l.storageLocationId}
                  onChange={(event) =>
                    update(idx, {
                      storageLocationId: (event.currentTarget as HTMLSelectElement).value,
                    })
                  }
                  aria-label="Storage location"
                >
                  <option value="">Location…</option>
                  {locationOptions.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                      {loc.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.001"
                  class={`stock-line-input${overAvailable ? " stock-line-input-error" : ""}`}
                  value={l.deltaQty}
                  onInput={(event) =>
                    update(idx, { deltaQty: (event.currentTarget as HTMLInputElement).value })
                  }
                  aria-label="Delta"
                  placeholder={mode === "RECLASSIFY" ? "Qty" : "± qty"}
                />
                {mode === "RECLASSIFY" ? (
                  <>
                    <select
                      class="stock-line-select"
                      value={l.fromCondition ?? "SELLABLE"}
                      onChange={(event) =>
                        update(idx, {
                          fromCondition: (event.currentTarget as HTMLSelectElement)
                            .value as StockCondition,
                          productId: "",
                          storageLocationId: defLoc,
                        })
                      }
                      aria-label="From condition"
                    >
                      <option value="SELLABLE">Sellable</option>
                      <option value="UNSELLABLE">Unsellable</option>
                    </select>
                    <select
                      class="stock-line-select"
                      value={l.toCondition ?? "UNSELLABLE"}
                      onChange={(event) =>
                        update(idx, {
                          toCondition: (event.currentTarget as HTMLSelectElement)
                            .value as StockCondition,
                        })
                      }
                      aria-label="To condition"
                    >
                      <option value="UNSELLABLE">Unsellable</option>
                      <option value="SELLABLE">Sellable</option>
                    </select>
                  </>
                ) : null}
                <span class="stock-line-uom">{uom}</span>
                <button
                  type="button"
                  class="stock-line-remove"
                  onClick={() => remove(idx)}
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
              {mode === "RECLASSIFY" && availableStr != null && l.productId && l.storageLocationId ? (
                <p class={`stock-line-note${overAvailable ? " stock-hint-warn" : ""}`}>
                  Available ({fromCond === "SELLABLE" ? "sellable" : "unsellable"}):{" "}
                  {trimQty(availableStr)} {uom}
                  {overAvailable ? " — exceeds available stock" : ""}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <p class="stock-hint">
        {mode === "RECLASSIFY"
          ? "Quantity to move (must be > 0). Posts -qty from From and +qty to To."
          : "Delta (+ gain / − loss)"}
      </p>
    </div>
  );
}
