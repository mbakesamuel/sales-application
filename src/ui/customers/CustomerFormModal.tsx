import { useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import { buildRowKey } from "../utils/formRowKey.ts";
import "../components/FormDialog.css";
import "./CustomerFormModal.css";

interface CustomerFormModalProps {
  mode: "create" | "edit";
  row?: Record<string, unknown>;
  onClose: () => void;
  onSaved: () => void;
}

interface CustomerFormData {
  name: string;
  customerTypeId: string;
  residency: "LOCAL" | "OVERSEAS";
  email: string;
  phone: string;
  address: string;
  taxRegimeId: string;
  taxpayerId: string;
  commercialServiceId: string;
}

interface LookupOption {
  id: string;
  label: string;
}

type FieldKey = keyof CustomerFormData;
type FieldErrors = Partial<Record<FieldKey, string>>;

const EMPTY_FORM: CustomerFormData = {
  name: "",
  customerTypeId: "",
  residency: "LOCAL",
  email: "",
  phone: "",
  address: "",
  taxRegimeId: "",
  taxpayerId: "",
  commercialServiceId: "",
};

/** Tax regime selected (not None) ⇒ customer has a TPN; None ⇒ no TPN. */
function hasTaxpayerIdFromRegime(taxRegimeId: string): boolean {
  return taxRegimeId.trim().length > 0;
}

const STEPS = [
  { id: "basic", label: "Basic" },
  { id: "contact", label: "Contact" },
] as const;

function FieldRow({
  label,
  required,
  error,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  htmlFor?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="form-dialog-row">
      <label class="form-dialog-label" for={htmlFor}>
        {label}
        {required ? " *" : ""}
      </label>
      <div class="form-dialog-control">
        {children}
        {error ? <p class="form-dialog-hint cfm-field-error">{error}</p> : null}
      </div>
    </div>
  );
}

function buildLabel(
  optionRow: Record<string, unknown>,
  labelColumns: string[],
): string {
  for (const column of labelColumns) {
    const value = optionRow[column];
    if (value != null && String(value).trim()) {
      return String(value);
    }
  }
  return String(optionRow.id ?? "");
}

function initFromRow(
  mode: "create" | "edit",
  row?: Record<string, unknown>,
): CustomerFormData {
  if (mode !== "edit" || !row) {
    return { ...EMPTY_FORM };
  }

  const residency = String(row.residency ?? "LOCAL").toUpperCase();

  return {
    name: row.name != null ? String(row.name) : "",
    customerTypeId: row.customerTypeId != null ? String(row.customerTypeId) : "",
    residency: residency === "OVERSEAS" ? "OVERSEAS" : "LOCAL",
    email: row.email != null ? String(row.email) : "",
    phone: row.phone != null ? String(row.phone) : "",
    address: row.address != null ? String(row.address) : "",
    taxRegimeId: row.taxRegimeId != null ? String(row.taxRegimeId) : "",
    taxpayerId: row.taxpayerId != null ? String(row.taxpayerId) : "",
    commercialServiceId:
      row.commercialServiceId != null ? String(row.commercialServiceId) : "",
  };
}

export function CustomerFormModal({
  mode,
  row,
  onClose,
  onSaved,
}: CustomerFormModalProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CustomerFormData>(() => initFromRow(mode, row));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customerTypes, setCustomerTypes] = useState<LookupOption[]>([]);
  const [taxRegimes, setTaxRegimes] = useState<LookupOption[]>([]);
  const [commercialServices, setCommercialServices] = useState<LookupOption[]>([]);
  const rowKey = useMemo(() => buildRowKey(row, ["id"]), [row]);

  useEffect(() => {
    setForm(initFromRow(mode, row));
    setStep(0);
    setErrors({});
    setSubmitError(null);
  }, [mode, rowKey]);

  useEffect(() => {
    let cancelled = false;
    const selectedTaxRegimeId =
      row?.taxRegimeId != null && row.taxRegimeId !== ""
        ? String(row.taxRegimeId)
        : null;

    async function loadLookups() {
      try {
        const api = getElectronApi();
        const [types, regimes, services] = await Promise.all([
          api.db.queryTable({ table: "CustomerTypeDefinition", limit: 200 }),
          api.db.queryTable({ table: "TaxRegime", limit: 200 }),
          api.db.queryTable({ table: "CommercialService", limit: 200 }),
        ]);

        if (cancelled) {
          return;
        }

        setCustomerTypes(
          types.rows
            .map((optionRow) => ({
              id: String(optionRow.id ?? ""),
              label: buildLabel(optionRow, ["name", "code"]),
            }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        );
        setTaxRegimes(
          regimes.rows
            .filter((optionRow) => {
              const isActive =
                optionRow.isActive === 1 ||
                optionRow.isActive === true ||
                optionRow.isActive == null;
              const id = String(optionRow.id ?? "");
              return (
                isActive ||
                (selectedTaxRegimeId != null && id === selectedTaxRegimeId)
              );
            })
            .map((optionRow) => {
              const isActive =
                optionRow.isActive === 1 ||
                optionRow.isActive === true ||
                optionRow.isActive == null;
              const label = buildLabel(optionRow, ["name"]);
              return {
                id: String(optionRow.id ?? ""),
                label: isActive ? label : `${label} (inactive)`,
              };
            })
            .sort((left, right) => left.label.localeCompare(right.label)),
        );
        setCommercialServices(
          services.rows
            .map((optionRow) => ({
              id: String(optionRow.id ?? ""),
              label: buildLabel(optionRow, ["name", "code"]),
            }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        );
      } catch {
        // Selects will simply show any pre-existing value.
      }
    }

    void loadLookups();

    return () => {
      cancelled = true;
    };
  }, [row?.taxRegimeId]);

  function setField<K extends FieldKey>(key: K, value: CustomerFormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function validateStep(target: number): boolean {
    const stepErrors: FieldErrors = {};

    if (target === 0) {
      if (!form.name.trim()) {
        stepErrors.name = "Name is required.";
      }
      if (!form.customerTypeId) {
        stepErrors.customerTypeId = "Customer type is required.";
      }
      if (hasTaxpayerIdFromRegime(form.taxRegimeId) && !form.taxpayerId.trim()) {
        stepErrors.taxpayerId = "Tax Payer's No. is required when a tax regime is selected.";
      }
      if (!form.commercialServiceId) {
        stepErrors.commercialServiceId = "Commercial service is required.";
      }
    }

    if (target === 1) {
      if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        stepErrors.email = "Invalid email address.";
      }
    }

    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  }

  function goNext() {
    if (validateStep(step)) {
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    }
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 0));
  }

  async function submit() {
    for (let index = 0; index < STEPS.length; index += 1) {
      if (!validateStep(index)) {
        setStep(index);
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      customerTypeId: form.customerTypeId,
      residency: form.residency,
      isPosPlaceholder: 0,
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      taxRegimeId: form.taxRegimeId.trim() ? form.taxRegimeId.trim() : null,
      hasTaxpayerId: hasTaxpayerIdFromRegime(form.taxRegimeId) ? 1 : 0,
      taxpayerId: hasTaxpayerIdFromRegime(form.taxRegimeId)
        ? form.taxpayerId.trim()
        : "",
      commercialServiceId: form.commercialServiceId,
    };

    try {
      if (mode === "create") {
        await getAuthenticatedDb().insertRow({ table: "Customer", values: payload });
      } else {
        if (!row || row.id == null) {
          throw new Error("Customer id is missing.");
        }
        await getAuthenticatedDb().updateRow({
          table: "Customer",
          primaryKey: { id: row.id },
          values: payload,
        });
      }

      onSaved();
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to save customer.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = mode === "create" ? "Add Customer" : "Edit Customer";
  const isLast = step === STEPS.length - 1;

  return (
    <FormDialog
      ariaLabel={title}
      title={title}
      subtitle={`Step ${step + 1} of ${STEPS.length} — ${STEPS[step].label}`}
      wide
      onClose={onClose}
    >
      <form
        class="form-dialog-form cfm-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (isLast) {
            void submit();
          } else {
            goNext();
          }
        }}
      >
        <div class="cfm-steps" aria-hidden="true">
          {STEPS.map((stepDef, index) => (
            <span
              key={stepDef.id}
              class={`cfm-step-dot${index === step ? " is-active" : ""}${
                index < step ? " is-done" : ""
              }`}
            />
          ))}
        </div>

        {step === 0 ? (
          <>
            <FieldRow label="Full name" required error={errors.name} htmlFor="cfm-name">
              <input
                id="cfm-name"
                class="form-dialog-input"
                value={form.name}
                disabled={isSubmitting}
                placeholder="Business Name"
                onInput={(event) =>
                  setField("name", (event.currentTarget as HTMLInputElement).value)
                }
              />
            </FieldRow>

            <FieldRow
              label="Customer type"
              required
              error={errors.customerTypeId}
              htmlFor="cfm-type"
            >
              <select
                id="cfm-type"
                class="form-dialog-input"
                value={form.customerTypeId}
                disabled={isSubmitting}
                onChange={(event) =>
                  setField(
                    "customerTypeId",
                    (event.currentTarget as HTMLSelectElement).value,
                  )
                }
              >
                <option value="">Select…</option>
                {customerTypes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Tax regime" htmlFor="cfm-regime">
              <select
                id="cfm-regime"
                class="form-dialog-input"
                value={form.taxRegimeId}
                disabled={isSubmitting}
                onChange={(event) => {
                  const next = (event.currentTarget as HTMLSelectElement).value;
                  setForm((current) => ({
                    ...current,
                    taxRegimeId: next,
                    taxpayerId: next.trim() ? current.taxpayerId : "",
                  }));
                  setErrors((current) => {
                    if (!current.taxpayerId) {
                      return current;
                    }
                    const nextErrors = { ...current };
                    delete nextErrors.taxpayerId;
                    return nextErrors;
                  });
                }}
              >
                <option value="">— None —</option>
                {taxRegimes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p class="form-dialog-hint">
                Determines how this customer is taxed on invoices. Select a regime
                only when the customer has a Tax Payer's No.
              </p>
            </FieldRow>

            {hasTaxpayerIdFromRegime(form.taxRegimeId) ? (
              <FieldRow
                label="Tax Payer's No."
                required
                error={errors.taxpayerId}
                htmlFor="cfm-taxpayer"
              >
                <input
                  id="cfm-taxpayer"
                  class="form-dialog-input form-dialog-input-mono"
                  value={form.taxpayerId}
                  disabled={isSubmitting}
                  placeholder="P0000000000000"
                  onInput={(event) =>
                    setField(
                      "taxpayerId",
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </FieldRow>
            ) : null}

            <FieldRow label="Residency" required htmlFor="cfm-residency">
              <select
                id="cfm-residency"
                class="form-dialog-input"
                value={form.residency}
                disabled={isSubmitting}
                onChange={(event) =>
                  setField(
                    "residency",
                    (event.currentTarget as HTMLSelectElement).value as
                      | "LOCAL"
                      | "OVERSEAS",
                  )
                }
              >
                <option value="LOCAL">Domestic</option>
                <option value="OVERSEAS">Foreign</option>
              </select>
            </FieldRow>

            <FieldRow
              label="Commercial service"
              required
              error={errors.commercialServiceId}
              htmlFor="cfm-service"
            >
              <select
                id="cfm-service"
                class="form-dialog-input"
                value={form.commercialServiceId}
                disabled={isSubmitting}
                onChange={(event) =>
                  setField(
                    "commercialServiceId",
                    (event.currentTarget as HTMLSelectElement).value,
                  )
                }
              >
                <option value="">Select a service…</option>
                {commercialServices.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p class="form-dialog-hint">
                Assigns the customer to a commercial service and pricing structure.
              </p>
            </FieldRow>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <FieldRow label="Email" error={errors.email} htmlFor="cfm-email">
              <input
                id="cfm-email"
                type="email"
                class="form-dialog-input"
                value={form.email}
                disabled={isSubmitting}
                placeholder="name@example.com"
                onInput={(event) =>
                  setField("email", (event.currentTarget as HTMLInputElement).value)
                }
              />
            </FieldRow>

            <FieldRow label="Phone" htmlFor="cfm-phone">
              <input
                id="cfm-phone"
                type="tel"
                class="form-dialog-input"
                value={form.phone}
                disabled={isSubmitting}
                placeholder="e.g. +237 6 99 99 99 99"
                onInput={(event) =>
                  setField("phone", (event.currentTarget as HTMLInputElement).value)
                }
              />
            </FieldRow>

            <div class="form-dialog-row form-dialog-row-stretch">
              <label class="form-dialog-label" for="cfm-address">
                Address
              </label>
              <div class="form-dialog-control">
                <textarea
                  id="cfm-address"
                  class="form-dialog-input"
                  value={form.address}
                  disabled={isSubmitting}
                  placeholder="Full address"
                  onInput={(event) =>
                    setField(
                      "address",
                      (event.currentTarget as HTMLTextAreaElement).value,
                    )
                  }
                />
              </div>
            </div>
          </>
        ) : null}

        {submitError ? <p class="form-dialog-error">{submitError}</p> : null}

        <div class="form-dialog-actions cfm-actions">
          {step > 0 ? (
            <button
              type="button"
              class="form-dialog-btn-secondary"
              disabled={isSubmitting}
              onClick={goBack}
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              class="form-dialog-btn-secondary"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            class="form-dialog-btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Saving…"
              : isLast
                ? mode === "create"
                  ? "Add customer"
                  : "Save changes"
                : "Continue"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
