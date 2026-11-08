import { useEffect, useState } from "preact/hooks";
import { SlidersHorizontal } from "lucide-react";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type { ReportSignatoryRow } from "../../shared/reports.types.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import "../company-settings/CompanySettingsScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

interface ReportSettingsScreenProps {
  readOnly?: boolean;
}

function emptyForm() {
  return {
    id: null as string | null,
    name: "",
    title: "Manager, Palm Oil Sales",
    effectiveFrom: new Date().toISOString().slice(0, 10),
  };
}

export function ReportSettingsScreen({ readOnly = false }: ReportSettingsScreenProps) {
  const [signatories, setSignatories] = useState<ReportSignatoryRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signatoryBusy, setSignatoryBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setSignatories(await getAuthenticatedReports().listSignatories());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load report settings.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function closeSignatoryForm() {
    setFormOpen(false);
    setForm(emptyForm());
  }

  function startEdit(row: ReportSignatoryRow) {
    setForm({
      id: row.id,
      name: row.name,
      title: row.title,
      effectiveFrom: row.effectiveFrom,
    });
    setFormOpen(true);
    setSavedHint(null);
    setError(null);
  }

  function startCreate() {
    setForm(emptyForm());
    setFormOpen(true);
    setSavedHint(null);
    setError(null);
  }

  async function onSaveSignatory() {
    if (readOnly || signatoryBusy) {
      return;
    }
    setSignatoryBusy(true);
    setError(null);
    setSavedHint(null);
    try {
      const result = await getAuthenticatedReports().upsertSignatory({
        id: form.id,
        name: form.name,
        title: form.title,
        effectiveFrom: form.effectiveFrom,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setSavedHint(form.id ? "Signatory updated." : "Signatory added.");
      closeSignatoryForm();
      setSignatories(await getAuthenticatedReports().listSignatories());
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save signatory.",
      );
    } finally {
      setSignatoryBusy(false);
    }
  }

  async function onDeleteSignatory(row: ReportSignatoryRow) {
    if (readOnly || signatoryBusy) {
      return;
    }
    const confirmed = await confirmDelete(
      `Delete signatory "${row.name}" effective ${formatDisplayDate(row.effectiveFrom)}?`,
    );
    if (!confirmed) {
      return;
    }
    setSignatoryBusy(true);
    setError(null);
    setSavedHint(null);
    try {
      const result = await getAuthenticatedReports().deleteSignatory(row.id);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      if (formOpen && form.id === row.id) {
        closeSignatoryForm();
      }
      setSavedHint("Signatory deleted.");
      setSignatories(await getAuthenticatedReports().listSignatories());
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete signatory.",
      );
    } finally {
      setSignatoryBusy(false);
    }
  }

  return (
    <div class="company-settings-screen">
      <header class="company-settings-header">
        <div class="company-settings-heading">
          <SlidersHorizontal size={22} aria-hidden="true" />
          <div>
            <h2>Report settings</h2>
            <p>Footer signatory</p>
          </div>
        </div>
      </header>

      <div class="company-settings-toolbar">
        {loading ? <span>Loading…</span> : null}
        {savedHint && !error ? <span>{savedHint}</span> : null}
      </div>

      {error ? (
        <p class="company-settings-error" style="padding: 0 24px; color: #b91c1c;">
          {error}
        </p>
      ) : null}

      <section class="report-signatory-section">
        <div class="report-signatory-section-header">
          <div>
            <h3>Report signatory</h3>
            <p>
              Global footer name and title. Reports use the latest entry whose{" "}
              <strong>effective from</strong> date is on or before the report as-at
              date.
            </p>
          </div>
          {!readOnly ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={loading || signatoryBusy}
              onClick={startCreate}
            >
              Add signatory
            </button>
          ) : null}
        </div>

        <div class="company-settings-table-card report-signatory-card">
          <div class="cf-table-wrap">
            <table class="cf-table" style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr>
                  <th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--border);">
                    Effective from
                  </th>
                  <th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--border);">
                    Name
                  </th>
                  <th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--border);">
                    Title
                  </th>
                  <th style="padding: 8px; border-bottom: 1px solid var(--border);" />
                </tr>
              </thead>
              <tbody>
                {signatories.length === 0 ? (
                  <tr>
                    <td colSpan={4} style="padding: 12px; color: #64748b;">
                      No signatories yet.
                    </td>
                  </tr>
                ) : (
                  signatories.map((row) => (
                    <tr key={row.id}>
                      <td style="padding: 8px; border-bottom: 1px solid var(--border);">
                        {formatDisplayDate(row.effectiveFrom)}
                      </td>
                      <td style="padding: 8px; border-bottom: 1px solid var(--border);">
                        {row.name}
                      </td>
                      <td style="padding: 8px; border-bottom: 1px solid var(--border);">
                        {row.title}
                      </td>
                      <td
                        style="padding: 8px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap;"
                      >
                        {!readOnly ? (
                          <>
                            <button
                              type="button"
                              class="company-settings-secondary-btn"
                              style="margin-right: 8px;"
                              disabled={signatoryBusy}
                              onClick={() => startEdit(row)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              class="company-settings-secondary-btn"
                              disabled={signatoryBusy || signatories.length <= 1}
                              onClick={() => void onDeleteSignatory(row)}
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {formOpen && !readOnly ? (
        <FormDialog
          ariaLabel={form.id ? "Edit signatory" : "Add signatory"}
          title={form.id ? "Edit signatory" : "Add signatory"}
          subtitle="Name and title appear on printed report footers from the effective date onward."
          onClose={closeSignatoryForm}
        >
          <form
            class="company-settings-form report-signatory-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onSaveSignatory();
            }}
          >
            <label class="company-settings-field">
              <span>Name</span>
              <input
                class="company-settings-input"
                type="text"
                value={form.name}
                disabled={signatoryBusy}
                placeholder="Full name as printed"
                autoComplete="off"
                onInput={(event) =>
                  setForm({
                    ...form,
                    name: (event.currentTarget as HTMLInputElement).value,
                  })
                }
              />
            </label>

            <div class="company-settings-form-grid">
              <label class="company-settings-field">
                <span>Title</span>
                <input
                  class="company-settings-input"
                  type="text"
                  value={form.title}
                  disabled={signatoryBusy}
                  placeholder="Manager, Palm Oil Sales"
                  autoComplete="off"
                  onInput={(event) =>
                    setForm({
                      ...form,
                      title: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                />
              </label>

              <label class="company-settings-field">
                <span>Effective from</span>
                <input
                  class="company-settings-input report-signatory-date-input"
                  type="date"
                  value={form.effectiveFrom}
                  disabled={signatoryBusy}
                  onInput={(event) =>
                    setForm({
                      ...form,
                      effectiveFrom: (event.currentTarget as HTMLInputElement)
                        .value,
                    })
                  }
                />
              </label>
            </div>

            <div class="form-dialog-actions report-signatory-form-actions">
              <button
                type="button"
                class="form-dialog-btn-secondary"
                disabled={signatoryBusy}
                onClick={closeSignatoryForm}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="company-settings-primary-btn"
                disabled={signatoryBusy}
              >
                {signatoryBusy ? "Saving…" : form.id ? "Update" : "Add"}
              </button>
            </div>
          </form>
        </FormDialog>
      ) : null}
    </div>
  );
}
