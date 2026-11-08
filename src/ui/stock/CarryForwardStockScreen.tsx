import { useEffect, useMemo, useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import { canWriteRouteFromSnapshot } from "../../shared/permissionUtils.ts";
import type {
  CarryForwardStockFormOptions,
  CarryForwardStockPendingRow,
  CarryForwardStockProductOption,
  CarryForwardStockRow,
} from "../../shared/carryForwardStock.types.ts";
import type { ProductOption } from "../../shared/stock.types.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import {
  buildReceiptIntakeGroups,
  filterReceiptPickerProducts,
  receiptIntakeDisplayName,
  resolveIntakeProductId,
} from "../../shared/stockIntakeGroups.ts";
import type { AuthUser } from "../auth/session.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import {
  clampIsoDateToRange,
  formatDate,
  utcIsoDateToday,
} from "./stockUtils.ts";
import "../components/FormDialog.css";
import "../commitments/CarryForwardCommitmentsScreen.css";

interface CarryForwardStockScreenProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  readOnly?: boolean;
}

type BatchLineDraft = {
  key: string;
  storageLocationId: string;
  productId: string;
  onHandQty: string;
};

function formatQty(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

const PAGE_SIZE = 15;

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function newLineKey(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyLine(): BatchLineDraft {
  return {
    key: newLineKey(),
    storageLocationId: "",
    productId: "",
    onHandQty: "",
  };
}

function isBottleOilStoreLocation(name: string): boolean {
  return name.toLowerCase().includes("bottle");
}

function productsForLocation(
  products: CarryForwardStockProductOption[],
  locationName: string | null,
): CarryForwardStockProductOption[] {
  const withLocation = products.filter(
    (product) => !product.omitsStorageLocation,
  );
  if (!locationName) {
    return withLocation;
  }
  const bottledOnly = isBottleOilStoreLocation(locationName);
  return withLocation.filter((product) =>
    bottledOnly ? product.isBottled : !product.isBottled,
  );
}

function toProductOptions(
  products: CarryForwardStockProductOption[],
): ProductOption[] {
  return products.map((product) => ({
    productId: product.productId,
    productName: product.productName,
    uom: product.uom,
    isBottled: product.isBottled,
    isLoosePalmOil: false,
    omitsStorageLocation: product.omitsStorageLocation,
    stockIntakeGroup: product.stockIntakeGroup,
    stockPoolProductId: product.stockPoolProductId,
    excludeFromSales: product.excludeFromSales,
    isStockPool: product.isStockPool,
  }));
}

function pickerProductsForLine(
  allProducts: CarryForwardStockProductOption[],
  locationName: string | null,
  lineOmitsStorage: boolean,
  storageLocationId: string,
  groupingEnabled: boolean,
): ProductOption[] {
  const base = lineOmitsStorage
    ? omitStorageProducts(allProducts)
    : storageLocationId
      ? productsForLocation(allProducts, locationName)
      : [
          ...productsForLocation(allProducts, locationName),
          ...omitStorageProducts(allProducts),
        ];
  return filterReceiptPickerProducts(toProductOptions(base), groupingEnabled);
}

function omitStorageProducts(
  products: CarryForwardStockProductOption[],
): CarryForwardStockProductOption[] {
  return products.filter((product) => product.omitsStorageLocation);
}

function findProduct(
  products: CarryForwardStockProductOption[],
  productId: string,
) {
  if (!productId) {
    return undefined;
  }
  return products.find((product) => String(product.productId) === productId);
}

export function CarryForwardStockScreen({
  user,
  permissions,
  readOnly = false,
}: CarryForwardStockScreenProps) {
  const canWrite =
    canWriteRouteFromSnapshot(permissions, "carry-forward-stock") && !readOnly;

  const [rows, setRows] = useState<CarryForwardStockRow[]>([]);
  const [pendingRows, setPendingRows] = useState<CarryForwardStockPendingRow[]>(
    [],
  );
  const [options, setOptions] = useState<CarryForwardStockFormOptions | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [batchSalesPointId, setBatchSalesPointId] = useState("");
  const [batchOccurredAt, setBatchOccurredAt] = useState(utcIsoDateToday());
  const [batchNotes, setBatchNotes] = useState("Opening On-hand Balance");
  const [batchLines, setBatchLines] = useState<BatchLineDraft[]>(() => [
    emptyLine(),
  ]);
  const [postingPeriod, setPostingPeriod] = useState<OpenPostingPeriod | null>(
    null,
  );
  const [page, setPage] = useState(1);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const api = getElectronApi();
      const [list, pending, formOptions] = await Promise.all([
        api.carryForwardStock.list(),
        api.carryForwardStock.listPending({ userId: user.id }),
        api.carryForwardStock.getFormOptions(),
      ]);
      setRows(list);
      setPendingRows(pending);
      setOptions(formOptions);
    } catch (loadError) {
      setRows([]);
      setPendingRows([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load carry-forward stock.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAuthenticatedFinancialYears()
      .getOpenPostingPeriod(user.salesPointId)
      .then((period) => {
        if (!cancelled) {
          setPostingPeriod(period);
          setBatchOccurredAt((current) => clampIsoDateToRange(current, period));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPostingPeriod(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user.salesPointId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter(
      (row) =>
        row.productName.toLowerCase().includes(query) ||
        row.salesPointName.toLowerCase().includes(query) ||
        row.storageLocationName.toLowerCase().includes(query) ||
        (row.lastAdjustmentNo ?? "").toLowerCase().includes(query),
    );
  }, [rows, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const pageStart =
    filtered.length === 0
      ? 0
      : Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length);
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filtered.length);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const filteredPending = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return pendingRows;
    }
    return pendingRows.filter(
      (row) =>
        row.productName.toLowerCase().includes(query) ||
        row.salesPointName.toLowerCase().includes(query) ||
        row.storageLocationName.toLowerCase().includes(query) ||
        row.adjustmentNo.toLowerCase().includes(query),
    );
  }, [pendingRows, search]);

  const pendingAdjustmentCount = useMemo(
    () => new Set(filteredPending.map((row) => row.adjustmentId)).size,
    [filteredPending],
  );

  const locationsForSalesPoint = useMemo(() => {
    if (!options || !batchSalesPointId) {
      return [];
    }
    const spId = Number.parseInt(batchSalesPointId, 10);
    return options.storageLocations.filter((loc) => loc.salesPointId === spId);
  }, [options, batchSalesPointId]);

  const canPostBatch = useMemo(() => {
    if (!batchSalesPointId || !batchOccurredAt || !postingPeriod) {
      return false;
    }
    return batchLines.some((line) => {
      if (!line.productId || line.onHandQty.trim() === "") {
        return false;
      }
      const product = findProduct(options?.products ?? [], line.productId);
      if (product?.omitsStorageLocation) {
        return true;
      }
      return Boolean(line.storageLocationId);
    });
  }, [batchSalesPointId, batchOccurredAt, postingPeriod, batchLines, options]);

  function openBatchEntry(prefill?: {
    salesPointId: number;
    productId: number;
    storageLocationId: number | null;
    currentQty: number;
  }) {
    setActionError(null);
    setActionSuccess(null);
    setBatchNotes("Opening On-hand Balance");
    setBatchOccurredAt(clampIsoDateToRange(utcIsoDateToday(), postingPeriod));
    if (prefill) {
      setBatchSalesPointId(String(prefill.salesPointId));
      const allProducts = options?.products ?? [];
      const prefillProduct = findProduct(allProducts, String(prefill.productId));
      const resolvedProductId = resolveIntakeProductId(
        String(prefill.productId),
        prefillProduct,
        options?.stockIntakeOilGrouping ?? false,
      );
      setBatchLines([
        {
          key: newLineKey(),
          storageLocationId:
            prefill.storageLocationId != null
              ? String(prefill.storageLocationId)
              : "",
          productId: resolvedProductId,
          onHandQty: String(Math.round(prefill.currentQty)),
        },
      ]);
    } else {
      setBatchSalesPointId("");
      setBatchLines([emptyLine()]);
    }
    setBatchOpen(true);
  }

  function onSalesPointChange(nextSalesPointId: string) {
    setBatchSalesPointId(nextSalesPointId);
    setBatchLines((current) =>
      current.map((line) => ({ ...line, storageLocationId: "" })),
    );
  }

  function updateLine(
    key: string,
    patch: Partial<Omit<BatchLineDraft, "key">>,
  ) {
    setBatchLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setBatchLines((current) => [...current, emptyLine()]);
  }

  function removeLine(key: string) {
    setBatchLines((current) => {
      const next = current.filter((line) => line.key !== key);
      return next.length > 0 ? next : [emptyLine()];
    });
  }

  async function saveBatch() {
    if (!canWrite || !batchOpen) {
      return;
    }

    const salesPointId = Number.parseInt(batchSalesPointId, 10);
    if (!Number.isFinite(salesPointId)) {
      setActionError("Select a collection point.");
      return;
    }

    if (!postingPeriod) {
      setActionError(
        "Open a financial month before posting carry-forward stock.",
      );
      return;
    }

    const occurredAt = clampIsoDateToRange(batchOccurredAt, postingPeriod);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
      setActionError("Select a valid date within the open financial month.");
      return;
    }

    const seen = new Set<string>();
    const lines: Array<{
      storageLocationId: number | null;
      productId: number;
      onHandQty: number;
    }> = [];

    for (const line of batchLines) {
      if (!line.productId || line.onHandQty.trim() === "") {
        continue;
      }
      const onHandQty = Number.parseFloat(
        line.onHandQty.trim().replace(",", "."),
      );

      const product = findProduct(options?.products ?? [], line.productId);
      const postingProductId = resolveIntakeProductId(
        line.productId,
        product,
        options?.stockIntakeOilGrouping ?? false,
      );
      const productId = Number.parseInt(postingProductId, 10);
      if (
        !Number.isFinite(productId) ||
        !Number.isFinite(onHandQty) ||
        onHandQty < 0
      ) {
        setActionError("Each line needs a product and on-hand quantity ≥ 0.");
        return;
      }

      let storageLocationId: number | null;
      if (product?.omitsStorageLocation) {
        if (line.storageLocationId) {
          setActionError(
            "Palm Kernel / Cake products do not use storage locations.",
          );
          return;
        }
        storageLocationId = null;
      } else {
        if (!line.storageLocationId) {
          continue;
        }
        storageLocationId = Number.parseInt(line.storageLocationId, 10);
        if (!Number.isFinite(storageLocationId)) {
          setActionError("Each location-based line needs a storage location.");
          return;
        }
      }

      const pairKey =
        storageLocationId == null
          ? `null:${productId}`
          : `${storageLocationId}:${productId}`;
      if (seen.has(pairKey)) {
        setActionError(
          storageLocationId == null
            ? "Duplicate product in the same batch."
            : "Duplicate location and product in the same batch.",
        );
        return;
      }
      seen.add(pairKey);
      lines.push({ storageLocationId, productId, onHandQty });
    }

    if (lines.length === 0) {
      setActionError(
        "Add at least one complete line (product and quantity; location unless Palm Kernel / Cake).",
      );
      return;
    }

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await getElectronApi().carryForwardStock.upsertBatch({
        userId: user.id,
        salesPointId,
        occurredAt,
        notes: batchNotes.trim() || null,
        lines,
      });
      if (result.ok === false) {
        setActionError(result.error);
        return;
      }
      setBatchOpen(false);
      if (result.pendingValidation) {
        const adjLabel = result.adjustmentNo ? ` (${result.adjustmentNo})` : "";
        setActionSuccess(
          result.saved > 0
            ? `Submitted ${result.saved} line${result.saved === 1 ? "" : "s"} for stock validation${adjLabel}. Balances update after a supervisor validates the adjustment.`
            : "No quantity changes to submit.",
        );
      } else if (result.saved > 0) {
        const adjLabel = result.adjustmentNo ? ` (${result.adjustmentNo})` : "";
        setActionSuccess(
          `Posted ${result.saved} line${result.saved === 1 ? "" : "s"}${adjLabel}. Balances and reports are updated.`,
        );
      } else {
        setActionSuccess("No quantity changes to post.");
      }
      await reload();
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save batch.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="cf-screen cf-screen--bf-stock">
      <header class="cf-header">
        <h2 class="cf-title">Brought-forward stock entry</h2>
        <div class="cf-header-actions">
          <button
            type="button"
            class="cf-btn cf-btn-secondary"
            onClick={() => void reload()}
            disabled={loading}
          >
            Refresh
          </button>
          {canWrite ? (
            <button
              type="button"
              class="cf-btn cf-btn-primary"
              onClick={() => openBatchEntry()}
            >
              New Entry
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p class="cf-error">{error}</p> : null}
      {actionSuccess ? <p class="cf-success">{actionSuccess}</p> : null}
      {actionError && !batchOpen ? <p class="cf-error">{actionError}</p> : null}

      <div class="cf-toolbar">
        <input
          class="cf-search"
          type="search"
          value={search}
          placeholder="Search product, collection point, location, adjustment…"
          onInput={(event) =>
            setSearch((event.currentTarget as HTMLInputElement).value)
          }
        />
        <span class="cf-count">
          {loading
            ? "Loading…"
            : [
                `${filtered.length} posted`,
                filteredPending.length > 0
                  ? `${filteredPending.length} pending validation`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </div>

      {filteredPending.length > 0 ? (
        <section class="cf-pending-section">
          <div class="cf-pending-header">
            <h3>Awaiting validation</h3>
            <p>
              {filteredPending.length} line
              {filteredPending.length === 1 ? "" : "s"} across{" "}
              {pendingAdjustmentCount} adjustment
              {pendingAdjustmentCount === 1 ? "" : "s"}
            </p>
          </div>
          <div class="cf-table-wrap">
            <table class="cf-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Collection point</th>
                  <th>Product</th>
                  <th>Location</th>
                  <th class="cf-num">Current qty</th>
                  <th class="cf-num">Proposed qty</th>
                  <th>Adjustment</th>
                </tr>
              </thead>
              <tbody>
                {filteredPending.map((row) => (
                  <tr
                    key={`${row.adjustmentId}-${row.productId}-${row.storageLocationId ?? "null"}`}
                  >
                    <td>
                      <span class="cf-pending-badge">Pending validation</span>
                    </td>
                    <td>{formatDate(row.occurredAt)}</td>
                    <td>{row.salesPointName}</td>
                    <td>
                      {row.productName}
                      <span class="cf-hint-inline"> ({row.uom})</span>
                    </td>
                    <td>{row.storageLocationName}</td>
                    <td class="cf-num">{formatQty(row.currentQty)}</td>
                    <td class="cf-num">{formatQty(row.proposedQty)}</td>
                    <td>{row.adjustmentNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {pendingRows.length > 0 ? (
        <h3 class="cf-posted-title">Posted opening balances</h3>
      ) : null}

      <div class="cf-posted-panel">
        <div class="cf-table-wrap">
          <table class="cf-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Collection point</th>
                <th>Product</th>
                <th>Location</th>
                <th class="cf-num">Bal. Qty.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} class="cf-empty">
                    Loading opening balances…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} class="cf-empty">
                    No carry-forward stock yet. Use New Entry to set opening
                    on-hand.
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr
                    key={`${row.salesPointId}-${row.productId}-${row.storageLocationId ?? "null"}`}
                  >
                    <td>{formatDate(row.lastOccurredAt)}</td>
                    <td>{row.salesPointName}</td>
                    <td>
                      {row.productName}
                      <span class="cf-hint-inline"> ({row.uom})</span>
                    </td>
                    <td>{row.storageLocationName}</td>
                    <td class="cf-num">{formatQty(row.currentQty)}</td>
                    <td class="cf-actions">
                      {canWrite ? (
                        <button
                          type="button"
                          class="cf-link"
                          onClick={() =>
                            openBatchEntry({
                              salesPointId: row.salesPointId,
                              productId: row.productId,
                              storageLocationId: row.storageLocationId,
                              currentQty: row.currentQty,
                            })
                          }
                        >
                          Edit
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading ? (
          <div class="cf-list-footer">
            <span class="cf-count">
              {filtered.length} posted balance
              {filtered.length === 1 ? "" : "s"}
            </span>
            <div class="cf-list-pagination">
              <span>
                Showing {pageStart}–{pageEnd} of {filtered.length}
              </span>
              <div class="cf-list-pagination-pages">
                <button
                  type="button"
                  class="cf-list-pagination-btn"
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <IconChevronLeft />
                </button>
                <span>
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  class="cf-list-pagination-btn"
                  disabled={currentPage >= totalPages}
                  aria-label="Next page"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                >
                  <IconChevronRight />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {batchOpen ? (
        <FormDialog
          ariaLabel="Carry-forward stock batch entry"
          title="Entry Form"
          subtitle="Select collection point and date, then add product rows (location required except Palm Kernel / Cake)."
          wide
          onClose={() => {
            if (!saving) setBatchOpen(false);
          }}
        >
          <div class="cf-batch cf-batch--stock">
            <div class="cf-batch-scope">
              <label class="cf-field">
                <span>Collection point</span>
                <select
                  value={batchSalesPointId}
                  disabled={saving}
                  onChange={(event) =>
                    onSalesPointChange(
                      (event.currentTarget as HTMLSelectElement).value,
                    )
                  }
                >
                  <option value="">Select collection point…</option>
                  {(options?.salesPoints ?? []).map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </label>
              <label class="cf-field">
                <span>Date</span>
                <input
                  type="date"
                  value={batchOccurredAt}
                  min={postingPeriod?.startDate}
                  max={postingPeriod?.endDate}
                  disabled={saving || !postingPeriod}
                  required
                  onInput={(event) =>
                    setBatchOccurredAt(
                      clampIsoDateToRange(
                        (event.currentTarget as HTMLInputElement).value,
                        postingPeriod,
                      ),
                    )
                  }
                />
                {/* {!postingPeriod ? (
                  <span class="cf-hint">
                    Open a financial month to set the date.
                  </span>
                ) : (
                  <span class="cf-hint">
                    Open month: {postingPeriod.monthName}{" "}
                    {postingPeriod.financialYear}
                  </span>
                )} */}
              </label>
              <label class="cf-field cf-field-notes">
                <span>Remarks</span>
                <input
                  type="text"
                  value={batchNotes}
                  disabled={saving}
                  onInput={(event) =>
                    setBatchNotes(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </label>
            </div>

            <div class="cf-batch-toolbar">
              <span class="cf-count">
                {batchLines.length} line{batchLines.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                class="cf-btn cf-btn-primary"
                disabled={saving || !batchSalesPointId}
                onClick={addLine}
              >
                Add line
              </button>
            </div>

            {!batchSalesPointId ? (
              <p class="cf-hint">
                Select a collection point to enter product lines.
              </p>
            ) : (
              <div class="cf-batch-grid-wrap">
                <table class="cf-table cf-batch-grid">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Storage location</th>
                      <th class="cf-num">Desired on hand</th>
                      <th class="cf-col-narrow" />
                    </tr>
                  </thead>
                  <tbody>
                    {batchLines.map((line) => {
                      const allProducts = options?.products ?? [];
                      const groupingEnabled =
                        options?.stockIntakeOilGrouping ?? false;
                      const rawSelectedProduct = findProduct(
                        allProducts,
                        line.productId,
                      );
                      const selectProductId = resolveIntakeProductId(
                        line.productId,
                        rawSelectedProduct,
                        groupingEnabled,
                      );
                      const selectedProduct =
                        findProduct(allProducts, selectProductId) ??
                        rawSelectedProduct;
                      const lineOmitsStorage =
                        selectedProduct?.omitsStorageLocation ?? false;
                      const selectedLocation = locationsForSalesPoint.find(
                        (loc) => String(loc.id) === line.storageLocationId,
                      );
                      const bottledLocation = selectedLocation
                        ? isBottleOilStoreLocation(selectedLocation.name)
                        : false;
                      const pickerProducts = pickerProductsForLine(
                        allProducts,
                        selectedLocation?.name ?? null,
                        lineOmitsStorage,
                        line.storageLocationId,
                        groupingEnabled,
                      );
                      const intakeGroups =
                        groupingEnabled &&
                        !lineOmitsStorage &&
                        !bottledLocation &&
                        pickerProducts.length > 0
                          ? buildReceiptIntakeGroups(
                              toProductOptions(
                                line.storageLocationId
                                  ? productsForLocation(
                                      allProducts,
                                      selectedLocation?.name ?? null,
                                    )
                                  : [
                                      ...productsForLocation(
                                        allProducts,
                                        selectedLocation?.name ?? null,
                                      ),
                                      ...omitStorageProducts(allProducts),
                                    ],
                              ),
                            )
                          : null;
                      return (
                        <tr key={line.key}>
                          <td>
                            <select
                              class="cf-line-select"
                              value={selectProductId}
                              disabled={saving}
                              onChange={(event) => {
                                const nextProductId = (
                                  event.currentTarget as HTMLSelectElement
                                ).value;
                                const nextProduct = findProduct(
                                  allProducts,
                                  nextProductId,
                                );
                                updateLine(line.key, {
                                  productId: nextProductId,
                                  storageLocationId:
                                    nextProduct?.omitsStorageLocation
                                      ? ""
                                      : line.storageLocationId,
                                });
                              }}
                            >
                              <option value="">Select product…</option>
                              {intakeGroups
                                ? intakeGroups.map((group) => (
                                    <optgroup
                                      key={group.key}
                                      label={group.label}
                                    >
                                      {group.products.map((product) => (
                                        <option
                                          key={product.productId}
                                          value={product.productId}
                                        >
                                          {receiptIntakeDisplayName(product)} (
                                          {product.uom})
                                          {product.omitsStorageLocation
                                            ? " · no location"
                                            : ""}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))
                                : pickerProducts.map((product) => (
                                    <option
                                      key={product.productId}
                                      value={product.productId}
                                    >
                                      {product.productName} ({product.uom})
                                      {product.omitsStorageLocation
                                        ? " · no location"
                                        : ""}
                                    </option>
                                  ))}
                            </select>
                          </td>
                          <td>
                            {lineOmitsStorage ? (
                              <span class="cf-hint-inline">—</span>
                            ) : (
                              <select
                                class="cf-line-select"
                                value={line.storageLocationId}
                                disabled={saving}
                                onChange={(event) => {
                                  const nextLocationId = (
                                    event.currentTarget as HTMLSelectElement
                                  ).value;
                                  const nextLocation =
                                    locationsForSalesPoint.find(
                                      (loc) =>
                                        String(loc.id) === nextLocationId,
                                    );
                                  const nextProducts = pickerProductsForLine(
                                    allProducts,
                                    nextLocation?.name ?? null,
                                    false,
                                    nextLocationId,
                                    groupingEnabled,
                                  );
                                  const productStillValid =
                                    !selectProductId ||
                                    nextProducts.some(
                                      (product) =>
                                        String(product.productId) ===
                                        selectProductId,
                                    );
                                  updateLine(line.key, {
                                    storageLocationId: nextLocationId,
                                    productId: productStillValid
                                      ? line.productId
                                      : "",
                                  });
                                }}
                              >
                                <option value="">Select location…</option>
                                {locationsForSalesPoint.map((loc) => (
                                  <option key={loc.id} value={loc.id}>
                                    {loc.name}
                                    {loc.isDefault ? " · default" : ""}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td class="cf-num">
                            <input
                              class="cf-qty-input"
                              type="number"
                              min={0}
                              step="any"
                              disabled={saving}
                              value={line.onHandQty}
                              placeholder="—"
                              onInput={(event) =>
                                updateLine(line.key, {
                                  onHandQty: (
                                    event.currentTarget as HTMLInputElement
                                  ).value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              class="cf-line-remove"
                              disabled={saving}
                              aria-label="Remove line"
                              onClick={() => removeLine(line.key)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {actionError ? <p class="cf-error">{actionError}</p> : null}

            <div
              class="form-dialog-actions"
              style="padding-left: 0; margin-top: 12px;"
            >
              <button
                type="button"
                class="form-dialog-btn-primary"
                disabled={saving || !canPostBatch}
                onClick={() => void saveBatch()}
              >
                {saving ? "Posting…" : "Post"}
              </button>
              <button
                type="button"
                class="form-dialog-btn-secondary"
                disabled={saving}
                onClick={() => setBatchOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
