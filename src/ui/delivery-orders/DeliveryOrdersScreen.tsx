import { useEffect, useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import {
  canPerformActionFromSnapshot,
  canWriteRouteFromSnapshot,
} from "../../shared/permissionUtils.ts";
import type { AuthUser } from "../auth/session.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { DeliveryOrdersClient } from "./DeliveryOrdersClient.tsx";
import { DeliveryOrdersList } from "./DeliveryOrdersList.tsx";
import { ValidationQueueClient } from "./validation-queue/ValidationQueueClient.tsx";
import "./deliveryOrders.css";

interface DeliveryOrdersScreenProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  readOnly?: boolean;
  initialLookupNo?: string;
}

type DeliveryOrdersView = "list" | "queue";

export function DeliveryOrdersScreen({
  user,
  permissions,
  readOnly = false,
  initialLookupNo = "",
}: DeliveryOrdersScreenProps) {
  const canUseScreen =
    canWriteRouteFromSnapshot(permissions, "delivery-orders") && !readOnly;
  const canValidate = canPerformActionFromSnapshot(
    permissions,
    "validate_delivery_orders",
  );
  const [view, setView] = useState<DeliveryOrdersView>("list");
  const [formOpen, setFormOpen] = useState(false);
  const [lookupNo, setLookupNo] = useState("");
  const [listReloadKey, setListReloadKey] = useState(0);

  useEffect(() => {
    const trimmed = initialLookupNo.trim();
    if (!trimmed || !canUseScreen) {
      return;
    }
    setLookupNo(trimmed);
    setFormOpen(true);
    setView("list");
  }, [initialLookupNo, canUseScreen]);

  function openNewOrder() {
    if (!canUseScreen) {
      return;
    }
    setLookupNo("");
    setFormOpen(true);
  }

  function openOrder(deliveryOrderNo: string) {
    if (!canUseScreen) {
      return;
    }
    setLookupNo(deliveryOrderNo);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setLookupNo("");
    setListReloadKey((current) => current + 1);
  }

  return (
    <div class="sales-screen">
      <div class="sales-tabs">
        <button
          type="button"
          class={`sales-tab${view === "list" ? " is-active" : ""}`}
          onClick={() => setView("list")}
        >
          DO list
        </button>
        {canValidate ? (
          <button
            type="button"
            class={`sales-tab${view === "queue" ? " is-active" : ""}`}
            onClick={() => setView("queue")}
          >
            Validation queue
          </button>
        ) : null}
      </div>

      {view === "list" ? (
        <DeliveryOrdersList
          key={listReloadKey}
          user={user}
          onOpenOrder={openOrder}
          onOpenScreen={canUseScreen ? openNewOrder : undefined}
        />
      ) : null}

      {view === "queue" && canValidate ? (
        <ValidationQueueClient user={user} onOpenOrder={openOrder} />
      ) : null}

      {formOpen && canUseScreen ? (
        <FormDialog
          ariaLabel="Delivery order form"
          title=""
          wide
          panelClassName="do-form-dialog-panel"
          onClose={closeForm}
        >
          <DeliveryOrdersClient
            key={lookupNo || "new"}
            user={user}
            permissions={permissions}
            initialLookupNo={lookupNo}
            onClose={closeForm}
          />
        </FormDialog>
      ) : null}
    </div>
  );
}
