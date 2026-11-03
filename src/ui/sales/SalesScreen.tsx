import { useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import {
  canAccessSalesModuleForVariant,
  isSalesModuleReadOnlyForVariant,
  saleProductModeForVariant,
  type SalesModuleVariant,
} from "../../shared/salesModule.ts";
import type { AuthUser } from "../auth/session.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { SalesClient } from "./SalesClient.tsx";
import { SalesList } from "./SalesList.tsx";
import "./sales.css";

interface SalesScreenProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  readOnly?: boolean;
  variant?: SalesModuleVariant;
}

export function SalesScreen({
  user,
  permissions,
  readOnly = false,
  variant = "loose",
}: SalesScreenProps) {
  const canAccess = canAccessSalesModuleForVariant(permissions, variant);
  const canUsePos =
    canAccess &&
    !isSalesModuleReadOnlyForVariant(permissions, variant) &&
    !readOnly;
  const [formOpen, setFormOpen] = useState(false);
  const [lookupInvoiceNo, setLookupInvoiceNo] = useState("");
  const [listReloadKey, setListReloadKey] = useState(0);

  if (!canAccess) {
    return (
      <p class="home-access-denied">
        You do not have permission to view{" "}
        {variant === "bottled" ? "Bottle Oil sales" : "sales invoices"}.
      </p>
    );
  }

  const listTitle =
    variant === "bottled" ? "Bottle Oil invoices" : "Sales invoices";
  const formTitle =
    variant === "bottled" ? "Bottle Oil invoice" : "Invoice details";

  function openNewInvoice() {
    if (!canUsePos) {
      return;
    }
    setLookupInvoiceNo("");
    setFormOpen(true);
  }

  function openInvoice(invoiceNo: string) {
    if (!canUsePos) {
      return;
    }
    setLookupInvoiceNo(invoiceNo);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setLookupInvoiceNo("");
    setListReloadKey((current) => current + 1);
  }

  return (
    <div class="sales-screen">
      <SalesList
        key={listReloadKey}
        user={user}
        variant={variant}
        listTitle={listTitle}
        productMode={saleProductModeForVariant(variant)}
        onOpenInvoice={openInvoice}
        onOpenScreen={canUsePos ? openNewInvoice : undefined}
      />

      {formOpen && canUsePos ? (
        <FormDialog
          ariaLabel={formTitle}
          title={formTitle}
          wide
          panelClassName="sales-form-dialog-panel"
          onClose={closeForm}
        >
          <SalesClient
            key={lookupInvoiceNo || "new"}
            user={user}
            permissions={permissions}
            variant={variant}
            initialInvoiceNo={lookupInvoiceNo}
            onClose={closeForm}
          />
        </FormDialog>
      ) : null}
    </div>
  );
}
