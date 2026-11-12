import { useEffect, useMemo, useState } from "preact/hooks";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";

import { FormDialog } from "../components/FormDialog.tsx";
import { buildRowKey } from "../utils/formRowKey.ts";
import "../components/FormDialog.css";

interface ProductFormModalProps {
  mode: "create" | "edit";
  row?: Record<string, unknown>;
  onClose: () => void;
  onSaved: () => void;
}

interface LookupOption {
  id: string;
  label: string;
}

interface FormData {
  productName: string;
  productCode: string;
  productCatId: string;
  commercialServiceId: string;
  uom: string;
  omitsStorageLocation: boolean;
  excludeFromDeliveryOrders: boolean;
  requiresManualUnitPrice: boolean;
  nonStockable: boolean;
}

const UOM_OPTIONS = ["Kg", "Unit", "Litre", "Ton", "Bag"] as const;

function buildLabel(row: Record<string, unknown>, columns: string[]): string {
  for (const column of columns) {
    const value = row[column];
    if (value != null && String(value).trim()) {
      return String(value);
    }
  }
  return String(row.id ?? row.productCatId ?? "");
}

function readBoolean(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function initForm(mode: "create" | "edit", row?: Record<string, unknown>): FormData {
  if (mode !== "edit" || !row) {
    return {
      productName: "",
      productCode: "",
      productCatId: "",
      commercialServiceId: "",
      uom: "Kg",
      omitsStorageLocation: false,
      excludeFromDeliveryOrders: false,
      requiresManualUnitPrice: false,
      nonStockable: false,
    };
  }

  return {
    productName: row.productName != null ? String(row.productName) : "",
    productCode: row.productCode != null ? String(row.productCode) : "",
    productCatId: row.productCatId != null ? String(row.productCatId) : "",
    commercialServiceId:
      row.commercialServiceId != null ? String(row.commercialServiceId) : "",
    uom: row.uom != null ? String(row.uom) : "Kg",
    omitsStorageLocation: readBoolean(row.omitsStorageLocation),
    excludeFromDeliveryOrders: readBoolean(row.excludeFromDeliveryOrders),
    requiresManualUnitPrice: readBoolean(row.requiresManualUnitPrice),
    nonStockable: readBoolean(row.nonStockable),
  };
}

function storageLocationHelp(row: Record<string, unknown> | undefined): string {
  const excludeFromSales = readBoolean(row?.excludeFromSales);
  const stockPoolProductId = row?.stockPoolProductId;
  const hasPool =
    stockPoolProductId != null &&
    stockPoolProductId !== "" &&
    Number.isFinite(Number(stockPoolProductId));

  if (excludeFromSales && !hasPool) {
    return "When intake grouping is on, receipts and transfers post to this pool product.";
  }
  if (hasPool) {
    return "When intake grouping is on, stock is held on the pool product; this setting applies when grouping is off.";
  }
  return "Stock is tracked at collection-point level only (no tank/location).";
}

export function ProductFormModal({
  mode,
  row,
  onClose,
  onSaved,
}: ProductFormModalProps) {
  const [form, setForm] = useState<FormData>(() => initForm(mode, row));
  const [categories, setCategories] = useState<LookupOption[]>([]);
  const [services, setServices] = useState<LookupOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const rowKey = useMemo(() => buildRowKey(row, ["productId"]), [row]);

  useEffect(() => {
    setForm(initForm(mode, row));
    setError(null);
  }, [mode, rowKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadLookups() {
      try {
        const api = getElectronApi();
        const [categoryResult, serviceResult] = await Promise.all([
          api.db.queryTable({ table: "ProductCat", limit: 200 }),
          api.db.queryTable({ table: "CommercialService", limit: 200 }),
        ]);

        if (cancelled) {
          return;
        }

        setCategories(
          categoryResult.rows
            .map((optionRow) => ({
              id: String(optionRow.productCatId ?? ""),
              label: buildLabel(optionRow, ["productCat", "productCode"]),
            }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        );
        setServices(
          serviceResult.rows
            .map((optionRow) => ({
              id: String(optionRow.id ?? ""),
              label: buildLabel(optionRow, ["name", "code"]),
            }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        );
      } catch {
        // Selects fall back to current values only.
      }
    }

    void loadLookups();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setError(null);

    const productName = form.productName.trim();
    const productCode = form.productCode.trim();
    const productCatId = Number.parseInt(form.productCatId, 10);
    const uom = form.uom.trim() || "Kg";

    if (!productName) {
      setError("Product name is required.");
      return;
    }
    if (!form.productCatId || Number.isNaN(productCatId)) {
      setError("Category is required.");
      return;
    }

    setIsSubmitting(true);

    const payload: Record<string, unknown> = {
      productName,
      productCode: productCode || null,
      productCatId,
      uom,
      commercialServiceId: form.commercialServiceId || null,
      omitsStorageLocation: form.omitsStorageLocation ? 1 : 0,
      excludeFromDeliveryOrders: form.excludeFromDeliveryOrders ? 1 : 0,
      requiresManualUnitPrice: form.requiresManualUnitPrice ? 1 : 0,
      nonStockable: form.nonStockable ? 1 : 0,
    };

    try {
      if (mode === "create") {
        await getAuthenticatedDb().insertRow({ table: "Product", values: payload });
      } else {
        if (row?.productId == null) {
          throw new Error("Product id is missing.");
        }
        await getAuthenticatedDb().updateRow({
          table: "Product",
          primaryKey: { productId: row.productId },
          values: payload,
        });
      }

      onSaved();
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to save product.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = mode === "create" ? "Add Product" : "Edit Product";
  const uomChoices = UOM_OPTIONS.includes(form.uom as (typeof UOM_OPTIONS)[number])
    ? UOM_OPTIONS
    : ([form.uom, ...UOM_OPTIONS] as string[]);

  return (
    <FormDialog
      ariaLabel={title}
      title={title}
      subtitle="Manage catalog item details, category, and unit of measure"
      wide
      onClose={onClose}
    >
      <form class="form-dialog-form" onSubmit={(event) => void handleSubmit(event)}>
        <div class="form-dialog-row">
          <label class="form-dialog-label" for="product-name">
            Product name
          </label>
          <div class="form-dialog-control">
            <input
              id="product-name"
              class="form-dialog-input"
              value={form.productName}
              disabled={isSubmitting}
              placeholder="e.g. Grade A Palm Oil"
              onInput={(event) =>
                updateField("productName", (event.currentTarget as HTMLInputElement).value)
              }
            />
          </div>
        </div>

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="product-code">
            Product code
          </label>
          <div class="form-dialog-control">
            <input
              id="product-code"
              class="form-dialog-input"
              value={form.productCode}
              disabled={isSubmitting}
              placeholder="e.g. PO-A"
              onInput={(event) =>
                updateField("productCode", (event.currentTarget as HTMLInputElement).value)
              }
            />
          </div>
        </div>

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="product-category">
            Category
          </label>
          <div class="form-dialog-control">
            <select
              id="product-category"
              class="form-dialog-input"
              value={form.productCatId}
              disabled={isSubmitting}
              required
              onChange={(event) =>
                updateField(
                  "productCatId",
                  (event.currentTarget as HTMLSelectElement).value,
                )
              }
            >
              <option value="">Select category…</option>
              {categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="product-service">
            Commercial service
          </label>
          <div class="form-dialog-control">
            <select
              id="product-service"
              class="form-dialog-input"
              value={form.commercialServiceId}
              disabled={isSubmitting}
              onChange={(event) =>
                updateField(
                  "commercialServiceId",
                  (event.currentTarget as HTMLSelectElement).value,
                )
              }
            >
              <option value="">— None —</option>
              {services.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="product-uom">
            Unit of measure
          </label>
          <div class="form-dialog-control">
            <select
              id="product-uom"
              class="form-dialog-input"
              value={form.uom}
              disabled={isSubmitting}
              onChange={(event) =>
                updateField("uom", (event.currentTarget as HTMLSelectElement).value)
              }
            >
              {uomChoices.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="product-omit-location">
            Storage location
          </label>
          <div class="form-dialog-control">
            <label class="form-dialog-checkbox-label">
              <input
                id="product-omit-location"
                type="checkbox"
                checked={form.omitsStorageLocation}
                disabled={isSubmitting}
                onChange={(event) =>
                  updateField(
                    "omitsStorageLocation",
                    (event.currentTarget as HTMLInputElement).checked,
                  )
                }
              />
              No storage location
            </label>
            <p class="form-dialog-hint">{storageLocationHelp(row)}</p>
          </div>
        </div>

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="product-exclude-do">
            Delivery orders
          </label>
          <div class="form-dialog-control">
            <label class="form-dialog-checkbox-label">
              <input
                id="product-exclude-do"
                type="checkbox"
                checked={form.excludeFromDeliveryOrders}
                disabled={isSubmitting}
                onChange={(event) =>
                  updateField(
                    "excludeFromDeliveryOrders",
                    (event.currentTarget as HTMLInputElement).checked,
                  )
                }
              />
              Exclude from delivery orders
            </label>
            <p class="form-dialog-hint">
              When checked, this product does not appear on the Delivery Order
              form (e.g. sludge oil, palm kernel).
            </p>
          </div>
        </div>

        <div class="form-dialog-row">
          <label class="form-dialog-label" for="product-manual-price">
            Pricing
          </label>
          <div class="form-dialog-control">
            <label class="form-dialog-checkbox-label">
              <input
                id="product-manual-price"
                type="checkbox"
                checked={form.requiresManualUnitPrice}
                disabled={isSubmitting}
                onChange={(event) =>
                  updateField(
                    "requiresManualUnitPrice",
                    (event.currentTarget as HTMLInputElement).checked,
                  )
                }
              />
              Negotiated unit price
            </label>
            <p class="form-dialog-hint">
              When checked, sales and delivery orders require a manually entered
              unit price (no price schedule). Use for products priced by
              consultation with the customer.
            </p>
            <label class="form-dialog-checkbox-label" style={{ marginTop: "0.75rem" }}>
              <input
                id="product-non-stockable"
                type="checkbox"
                checked={form.nonStockable}
                disabled={isSubmitting}
                onChange={(event) =>
                  updateField(
                    "nonStockable",
                    (event.currentTarget as HTMLInputElement).checked,
                  )
                }
              />
              Non-stockable
            </label>
            <p class="form-dialog-hint">
              When checked, sales invoices do not require stock availability and
              do not post stock movements (typical for negotiated / service-like
              products).
            </p>
          </div>
        </div>

        {error ? <p class="form-dialog-error">{error}</p> : null}

        <div class="form-dialog-actions">
          <button
            type="submit"
            class="form-dialog-btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving…" : mode === "create" ? "Add product" : "Save changes"}
          </button>
          <button
            type="button"
            class="form-dialog-btn-secondary"
            disabled={isSubmitting}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
