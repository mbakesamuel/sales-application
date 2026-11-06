import { useEffect, useState } from "preact/hooks";
import { formatDisplayDate } from "../../../shared/formatDisplayDate.ts";
import type { AuthUser } from "../../auth/session.ts";
import { getElectronApi } from "../../auth/client.ts";
import type { ValidationQueuePage } from "../types.ts";
import "../../sales/sales.css";

interface ValidationQueueClientProps {
  user: AuthUser;
  onOpenOrder: (deliveryOrderNo: string) => void;
}

export function ValidationQueueClient({ user, onOpenOrder }: ValidationQueueClientProps) {
  const [page, setPage] = useState<ValidationQueuePage | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(
    null,
  );

  async function refresh() {
    setPage(await getElectronApi().deliveryOrders.listValidationQueue(user.id));
  }

  useEffect(() => {
    void refresh();
  }, []);

  const selectedIds = Object.entries(selected)
    .filter(([, checked]) => checked)
    .map(([id]) => id);

  const allChecked =
    page != null &&
    page.rows.length > 0 &&
    page.rows.every((row) => selected[String(row.id)]);

  async function validateSelected() {
    if (selectedIds.length === 0) {
      setMessage({ type: "error", text: "Select at least one delivery order." });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const result = await getElectronApi().deliveryOrders.validateMany({
        orderIds: selectedIds as never,
        userId: user.id,
      });

      if (result.ok === false) {
        setMessage({ type: "error", text: result.error });
        return;
      }

      const errorText =
        result.errors.length > 0
          ? ` · ${result.errors.length} failed`
          : "";
      setMessage({
        type: "ok",
        text: `Validated ${result.validated} delivery order(s)${errorText}.`,
      });
      setSelected({});
      await refresh();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Validation failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="sales-client">
      <div class="sales-panel">
        <div class="sales-panel-header">
          <div>
            <h3>Validation queue</h3>
            <p class="sales-muted">
              Pending delivery orders awaiting validation.
              {page ? ` ${page.totalPending} total pending.` : ""}
            </p>
          </div>
          <button
            type="button"
            class="sales-btn-primary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => void validateSelected()}
          >
            {busy ? "Validating…" : `Validate selected (${selectedIds.length})`}
          </button>
        </div>

        {message ? (
          <div class={`sales-banner sales-banner-${message.type}`}>{message.text}</div>
        ) : null}

        <div class="sales-table-wrap">
          {!page ? (
            <p class="sales-muted">Loading…</p>
          ) : (
            <table class="sales-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(event) => {
                        const checked = (event.currentTarget as HTMLInputElement).checked;
                        if (!page) {
                          return;
                        }
                        const next: Record<string, boolean> = {};
                        if (checked) {
                          for (const row of page.rows) {
                            next[String(row.id)] = true;
                          }
                        }
                        setSelected(next);
                      }}
                    />
                  </th>
                  <th>DO no.</th>
                  <th>Date</th>
                  <th>Collection point</th>
                  <th>Customer</th>
                  <th class="sales-num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {page.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} class="sales-empty">
                      No delivery orders are awaiting validation.
                    </td>
                  </tr>
                ) : null}
                {page.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[String(row.id)])}
                        onChange={(event) => {
                          const checked = (event.currentTarget as HTMLInputElement).checked;
                          setSelected((current) => ({
                            ...current,
                            [String(row.id)]: checked,
                          }));
                        }}
                      />
                    </td>
                    <td>{row.deliveryOrderNo}</td>
                    <td>{formatDisplayDate(row.dateIssuedIso)}</td>
                    <td>{row.salesPointName}</td>
                    <td>{row.customerName}</td>
                    <td class="sales-num">{row.totalAmountXaf}</td>
                    <td class="sales-row-actions">
                      <button
                        type="button"
                        class="sales-btn-secondary sales-btn-small"
                        onClick={() => onOpenOrder(row.deliveryOrderNo)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
