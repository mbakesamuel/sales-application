import { useEffect, useRef, useState } from "preact/hooks";
import { getElectronApi } from "../auth/client.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import {
  locationCoversQty,
  pickLocationForQty,
} from "./storageLocationPick.ts";
import type {
  SalesProductOption,
  SalesStorageLocationBalanceOption,
} from "./types.ts";
import type { SaleDisposition } from "../../shared/sales.types.ts";

export interface SalesLineDraft {
  productId: string;
  qtyKg: string;
  qtyUnits: string;
  unitPricePerKg: string;
  unitPricePerUnit: string;
  storageLocationId: string;
}

interface SalesLineModalProps {
  line: SalesLineDraft;
  products: SalesProductOption[];
  salesPointId: number | null;
  preferredStorageLocationId?: string;
  isBottleMode: boolean;
  saleDisposition: SaleDisposition;
  useRegisteredCustomer: boolean;
  customerId: string;
  transactionDate: string;
  /** When true, Loose Palm Oil lines only list sales tank locations. */
  loosePalmOilRequireSalesTank?: boolean;
  mode: "add" | "edit";
  lockUnitPriceFromSchedule: boolean;
  onClose: () => void;
  onSave: (line: SalesLineDraft) => void;
}

function parseDecimal(value: string): number {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatLocationQty(qty: number): string {
  return qty.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export function SalesLineModal({
  line,
  products,
  salesPointId,
  preferredStorageLocationId = "",
  isBottleMode,
  saleDisposition,
  useRegisteredCustomer,
  customerId,
  transactionDate,
  loosePalmOilRequireSalesTank = true,
  mode,
  lockUnitPriceFromSchedule,
  onClose,
  onSave,
}: SalesLineModalProps) {
  const [draft, setDraft] = useState<SalesLineDraft>(line);
  const [error, setError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [balanceLocations, setBalanceLocations] = useState<
    SalesStorageLocationBalanceOption[]
  >([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const openedProductIdRef = useRef(line.productId);

  const title = mode === "add" ? "Add item" : "Edit item";
  const selectedProduct = products.find(
    (product) => String(product.productId) === draft.productId,
  );
  const omitsStorage = Boolean(selectedProduct?.omitsStorageLocation);
  const isLoosePalmOil = Boolean(selectedProduct?.isMain);
  const needsStorageLocation = !isBottleMode && !omitsStorage;
  const subtitle = isBottleMode
    ? "Enter the bottled product and number of units."
    : omitsStorage
      ? "Enter the product and weight (no storage location)."
      : isLoosePalmOil && loosePalmOilRequireSalesTank
        ? "Enter the loose product, sales tank, and weight."
        : "Enter the loose product, location, and weight.";

  const allowAutoUnitPrice =
    lockUnitPriceFromSchedule ||
    isBottleMode ||
    saleDisposition === "RETAIL";

  useEffect(() => {
    setDraft(line);
    openedProductIdRef.current = line.productId;
    setError(null);
    setPriceError(null);
  }, [line]);

  useEffect(() => {
    if (!allowAutoUnitPrice) {
      setPriceError(null);
      setPriceLoading(false);
      return;
    }

    if (mode === "edit" && draft.productId === openedProductIdRef.current) {
      return;
    }

    // Keep DO / prefilled price until the user changes product.
    if (
      mode === "add" &&
      draft.productId &&
      draft.productId === openedProductIdRef.current
    ) {
      return;
    }

    const productId = Number.parseInt(draft.productId, 10);
    if (!Number.isFinite(productId)) {
      setPriceError(null);
      return;
    }

    let cancelled = false;
    setPriceLoading(true);

    void getElectronApi()
      .sales.previewUnitPrice({
        productId,
        asOfDate: transactionDate,
        saleDisposition,
        customerId:
          useRegisteredCustomer && customerId.trim()
            ? Number.parseInt(customerId, 10)
            : null,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setPriceLoading(false);
        if (result.ok) {
          setPriceError(null);
          setDraft((current) => ({
            ...current,
            unitPricePerKg: result.unitPriceExTax,
            unitPricePerUnit: result.unitPriceExTax,
          }));
          return;
        }

        setPriceError(result.error);
      })
      .catch(() => {
        if (!cancelled) {
          setPriceLoading(false);
          setPriceError("Could not resolve unit price.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    allowAutoUnitPrice,
    customerId,
    draft.productId,
    isBottleMode,
    mode,
    transactionDate,
    useRegisteredCustomer,
    saleDisposition,
  ]);

  useEffect(() => {
    if (!needsStorageLocation) {
      setBalanceLocations([]);
      setLocationsLoading(false);
      setLocationsError(null);
      setDraft((current) =>
        current.storageLocationId
          ? { ...current, storageLocationId: "" }
          : current,
      );
      return;
    }

    const productId = Number.parseInt(draft.productId, 10);
    if (!salesPointId || !Number.isFinite(productId)) {
      setBalanceLocations([]);
      setLocationsLoading(false);
      setLocationsError(null);
      setDraft((current) =>
        current.storageLocationId
          ? { ...current, storageLocationId: "" }
          : current,
      );
      return;
    }

    let cancelled = false;
    setLocationsLoading(true);
    setLocationsError(null);

    void getElectronApi()
      .sales.listStorageLocationsWithBalance({
        salesPointId,
        productId,
        asOfDate: transactionDate,
      })
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setLocationsLoading(false);
        setBalanceLocations(rows);
        setDraft((current) => {
          const qty = parseDecimal(current.qtyKg);
          if (
            current.storageLocationId &&
            locationCoversQty(rows, current.storageLocationId, qty)
          ) {
            return current;
          }
          const picked = pickLocationForQty(
            rows,
            qty,
            preferredStorageLocationId,
          );
          if (picked === current.storageLocationId) {
            return current;
          }
          return { ...current, storageLocationId: picked };
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLocationsLoading(false);
          setBalanceLocations([]);
          setLocationsError("Could not load locations with stock.");
          setDraft((current) =>
            current.storageLocationId
              ? { ...current, storageLocationId: "" }
              : current,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    draft.productId,
    needsStorageLocation,
    preferredStorageLocationId,
    salesPointId,
    transactionDate,
  ]);

  useEffect(() => {
    if (
      !needsStorageLocation ||
      locationsLoading ||
      balanceLocations.length === 0
    ) {
      return;
    }

    setDraft((current) => {
      const qty = parseDecimal(current.qtyKg);
      if (
        current.storageLocationId &&
        locationCoversQty(balanceLocations, current.storageLocationId, qty)
      ) {
        return current;
      }
      const picked = pickLocationForQty(
        balanceLocations,
        qty,
        preferredStorageLocationId,
      );
      if (picked === current.storageLocationId) {
        return current;
      }
      return { ...current, storageLocationId: picked };
    });
  }, [
    balanceLocations,
    draft.qtyKg,
    needsStorageLocation,
    locationsLoading,
    preferredStorageLocationId,
  ]);

  const quantity = parseDecimal(isBottleMode ? draft.qtyUnits : draft.qtyKg);
  const unitPrice = parseDecimal(
    isBottleMode ? draft.unitPricePerUnit : draft.unitPricePerKg,
  );
  const subtotal = Math.round(quantity * unitPrice);

  function updateDraft(values: Partial<SalesLineDraft>) {
    setDraft((current) => ({ ...current, ...values }));
  }

  function submit(event: Event) {
    event.preventDefault();

    if (!draft.productId) {
      setError("Select a product.");
      return;
    }

    if (quantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }

    if (needsStorageLocation) {
      const productLabel = selectedProduct?.productName ?? "this product";
      if (!salesPointId) {
        setError("Select a collection point on the invoice first.");
        return;
      }
      if (!locationsLoading && balanceLocations.length === 0) {
        setError(
          `No stock for ${productLabel} at this collection point. Receive stock first, or choose another product.`,
        );
        return;
      }
      if (!draft.storageLocationId) {
        setError(
          balanceLocations.length > 0
            ? `Not enough stock for ${productLabel} at this collection point for the quantity entered. Reduce the quantity, or receive more stock.`
            : "Select a storage location with available stock.",
        );
        return;
      }
      if (
        !locationCoversQty(
          balanceLocations,
          draft.storageLocationId,
          quantity,
        )
      ) {
        const location = balanceLocations.find(
          (row) => String(row.id) === draft.storageLocationId,
        );
        const locationName = location?.name ?? "the selected location";
        const availableLabel = location
          ? formatLocationQty(location.qty)
          : "0";
        setError(
          `Not enough stock for ${productLabel} at ${locationName}. Only ${availableLabel} kg available.`,
        );
        return;
      }
    }

    if (unitPrice < 0) {
      setError("Unit price cannot be negative.");
      return;
    }

    if (priceError) {
      setError(priceError);
      return;
    }

    onSave(
      omitsStorage ? { ...draft, storageLocationId: "" } : draft,
    );
  }

  const locationHint = !draft.productId
    ? "Select a product first."
    : !salesPointId
      ? "Select a collection point on the invoice first."
      : locationsLoading
        ? "Loading locations with stock…"
        : locationsError
          ? locationsError
          : balanceLocations.length === 0
            ? `No stock for ${
                selectedProduct?.productName ?? "this product"
              } at this collection point on the invoice date. Receive stock first, or choose another product.`
            : isLoosePalmOil && loosePalmOilRequireSalesTank
              ? "Sales tank locations only."
              : null;

  return (
    <FormDialog
      ariaLabel={title}
      title={title}
      subtitle={subtitle}
      elevated
      onClose={onClose}
    >
      <form class="form-dialog-form" onSubmit={submit}>
        <div class="form-dialog-row">
          <label class="form-dialog-label" for="sales-line-product">
            Product
          </label>
          <div class="form-dialog-control">
            <select
              id="sales-line-product"
              class="form-dialog-input"
              value={draft.productId}
              onChange={(event) =>
                updateDraft({
                  productId: (event.currentTarget as HTMLSelectElement).value,
                  storageLocationId: "",
                })
              }
            >
              <option value="">Select a product</option>
              {products.map((product) => (
                <option key={product.productId} value={String(product.productId)}>
                  {product.productName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {needsStorageLocation ? (
          <div class="form-dialog-row">
            <label class="form-dialog-label" for="sales-line-location">
              Storage location
            </label>
            <div class="form-dialog-control">
              <select
                id="sales-line-location"
                class="form-dialog-input"
                value={draft.storageLocationId}
                disabled={!draft.productId || locationsLoading}
                onChange={(event) =>
                  updateDraft({
                    storageLocationId: (
                      event.currentTarget as HTMLSelectElement
                    ).value,
                  })
                }
              >
                <option value="">Select a location</option>
                {balanceLocations.map((location) => (
                  <option key={location.id} value={String(location.id)}>
                    {location.name} — {formatLocationQty(location.qty)} kg
                  </option>
                ))}
              </select>
              {locationHint ? (
                <p
                  class={
                    locationsError ||
                    (draft.productId &&
                      !locationsLoading &&
                      balanceLocations.length === 0)
                      ? "form-dialog-error"
                      : "form-dialog-hint"
                  }
                >
                  {locationHint}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="sales-line-qty">
            {isBottleMode ? "Quantity (units)" : "Quantity (kg)"}
          </label>
          <input
            id="sales-line-qty"
            class="form-dialog-input"
            type="number"
            min="0"
            step={isBottleMode ? "1" : "0.001"}
            value={isBottleMode ? draft.qtyUnits : draft.qtyKg}
            onInput={(event) => {
              const value = (event.currentTarget as HTMLInputElement).value;
              updateDraft(
                isBottleMode
                  ? { qtyUnits: value, qtyKg: value }
                  : { qtyKg: value },
              );
            }}
          />
        </div>

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="sales-line-price">
            {isBottleMode ? "Price per unit" : "Price per kg"}
          </label>
          <input
            id="sales-line-price"
            class="form-dialog-input"
            type="number"
            min="0"
            step="1"
            readOnly={lockUnitPriceFromSchedule}
            value={
              isBottleMode ? draft.unitPricePerUnit : draft.unitPricePerKg
            }
            onInput={
              lockUnitPriceFromSchedule
                ? undefined
                : (event) => {
                    const value = (event.currentTarget as HTMLInputElement)
                      .value;
                    setPriceError(null);
                    updateDraft(
                      isBottleMode
                        ? { unitPricePerUnit: value, unitPricePerKg: value }
                        : { unitPricePerKg: value },
                    );
                  }
            }
          />
          {priceLoading ? (
            <p class="form-dialog-hint">Resolving price from schedule…</p>
          ) : priceError ? (
            <p class="form-dialog-error">{priceError}</p>
          ) : allowAutoUnitPrice && draft.productId ? (
            <p class="form-dialog-hint">
              Price from schedule as of {transactionDate}.
              {lockUnitPriceFromSchedule
                ? ""
                : " You can override it manually."}
            </p>
          ) : null}
        </div>

        <div class="form-dialog-subtotal">
          <span>Line subtotal</span>
          <strong>
            {subtotal.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}{" "}
            XAF
          </strong>
        </div>

        {error ? <p class="form-dialog-error">{error}</p> : null}

        <div class="form-dialog-actions">
          <button type="submit" class="form-dialog-btn-primary">
            {mode === "add" ? "Add item" : "Save changes"}
          </button>
          <button type="button" class="form-dialog-btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
