import { useMemo, useState } from "preact/hooks";
import type { SalesPointOption, StockBalanceRow } from "../../shared/stock.types.ts";

interface OnHandTabProps {
  salesPoints: SalesPointOption[];
  scopedSalesPointId: number | null;
  rows: StockBalanceRow[];
}

interface GroupedRow {
  salesPointId: number;
  salesPointName: string;
  storageLocationId: number;
  storageLocationName: string;
  productId: number;
  productName: string;
  uom: string;
  qty: number;
  sellableQty: number;
  unsellableQty: number;
}

function formatOnHandQty(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export function OnHandTab({ salesPoints, scopedSalesPointId, rows }: OnHandTabProps) {
  const [salesPointId, setSalesPointId] = useState<string>(
    scopedSalesPointId != null ? String(scopedSalesPointId) : "",
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (salesPointId && String(r.salesPointId) !== salesPointId) return false;
      if (
        q &&
        !r.productName.toLowerCase().includes(q) &&
        !r.salesPointName.toLowerCase().includes(q) &&
        !r.storageLocationName.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });

    const grouped = new Map<string, GroupedRow>();

    for (const r of base) {
      if (r.storageLocationId == null) {
        continue;
      }
      const key = `${r.salesPointId}:${r.storageLocationId}:${r.productId}`;
      const existing = grouped.get(key);
      const qtyNum = Number.parseFloat(r.qty);
      const qty = Number.isFinite(qtyNum) ? qtyNum : 0;
      const sellableAdd = r.condition === "SELLABLE" ? qty : 0;
      const unsellableAdd = r.condition === "UNSELLABLE" ? qty : 0;
      if (existing) {
        existing.qty += qty;
        existing.sellableQty += sellableAdd;
        existing.unsellableQty += unsellableAdd;
      } else {
        grouped.set(key, {
          salesPointId: r.salesPointId,
          salesPointName: r.salesPointName,
          storageLocationId: r.storageLocationId,
          storageLocationName: r.storageLocationName,
          productId: r.productId,
          productName: r.productName,
          uom: r.uom,
          qty,
          sellableQty: sellableAdd,
          unsellableQty: unsellableAdd,
        });
      }
    }

    return [...grouped.values()].sort((a, b) => {
      const sp = a.salesPointName.localeCompare(b.salesPointName);
      if (sp !== 0) return sp;
      const loc = a.storageLocationName.localeCompare(b.storageLocationName);
      if (loc !== 0) return loc;
      return a.productName.localeCompare(b.productName);
    });
  }, [rows, salesPointId, search]);

  return (
    <section class="stock-section">
      <div class="stock-filters">
        {scopedSalesPointId == null ? (
          <label class="stock-field">
            <select
              value={salesPointId}
              onChange={(event) =>
                setSalesPointId((event.currentTarget as HTMLSelectElement).value)
              }
              aria-label="Collection point"
            >
              <option value="">Collection point</option>
              {salesPoints.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label class="stock-field stock-field-grow">
          <input
            value={search}
            onInput={(event) => setSearch((event.currentTarget as HTMLInputElement).value)}
            placeholder="Search product or collection point"
            aria-label="Search"
          />
        </label>
      </div>

      <div class="stock-table-wrap">
        <table class="stock-table">
          <thead>
            <tr>
              <th>Collection point</th>
              <th>Storage</th>
              <th>Product</th>
              <th class="stock-num">Balance Qty</th>
              <th>UOM</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} class="stock-empty-cell">
                  No balances to show.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={`${r.salesPointId}-${r.storageLocationId}-${r.productId}`}
                  class={r.unsellableQty > 0 && r.sellableQty <= 0 ? "stock-row-warn" : ""}
                >
                  <td>{r.salesPointName}</td>
                  <td>
                    <div>{r.storageLocationName}</div>
                    {r.unsellableQty > 0 ? (
                      <div class="stock-subtext stock-hint-warn">
                        Unsellable stock at this location
                      </div>
                    ) : null}
                  </td>
                  <td>{r.productName}</td>
                  <td class="stock-num stock-strong">
                    <div>{formatOnHandQty(r.qty)}</div>
                    {r.unsellableQty > 0 ? (
                      <div class="stock-subtext stock-hint-warn">
                        {formatOnHandQty(r.unsellableQty)} unsellable
                        {r.sellableQty > 0
                          ? ` · ${formatOnHandQty(r.sellableQty)} sellable`
                          : " · not available for POS sales"}
                      </div>
                    ) : null}
                  </td>
                  <td class="stock-muted">{r.uom}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p class="stock-hint">
        Showing {filtered.length} balance{filtered.length === 1 ? "" : "s"}.
      </p>
    </section>
  );
}
