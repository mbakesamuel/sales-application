import { useCallback, useEffect, useState } from "preact/hooks";
import { Database } from "lucide-react";
import type {
  BackupInfo,
  BackupScheduleConfig,
  BackupScheduleStatus,
} from "../../shared/backup.types.ts";
import { formatDisplayDateTime } from "../../shared/formatDisplayDate.ts";
import { getAuthenticatedBackup } from "../auth/backup.ts";
import "../company-settings/CompanySettingsScreen.css";
import "./DataBackupScreen.css";

interface DataBackupScreenProps {
  readOnly?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function DataBackupScreen({ readOnly = false }: DataBackupScreenProps) {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [scheduleStatus, setScheduleStatus] = useState<BackupScheduleStatus | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<BackupScheduleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | "restore" | "schedule" | "auto" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const backup = getAuthenticatedBackup();
      const [data, status] = await Promise.all([
        backup.getInfo(),
        backup.getSchedule(),
      ]);
      setInfo(data);
      setScheduleStatus(status);
      setScheduleDraft(status.config);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load backup info.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate() {
    if (readOnly) {
      return;
    }
    setBusy("create");
    setError(null);
    setSuccess(null);
    try {
      const result = await getAuthenticatedBackup().create();
      if (!result.ok) {
        if (!result.cancelled) {
          setError(result.error ?? "Backup failed.");
        }
        return;
      }
      setSuccess(
        `Backup saved (${formatBytes(result.sizeBytes)}): ${result.filePath}`,
      );
      await reload();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Backup failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    if (readOnly) {
      return;
    }
    const confirmed = window.api.dialog.confirm(
      "Restore will replace ALL application data with the selected backup file and restart the app. Continue?",
    );
    if (!confirmed) {
      return;
    }

    setBusy("restore");
    setError(null);
    setSuccess(null);
    try {
      const result = await getAuthenticatedBackup().restore();
      if (!result.ok) {
        if (!result.cancelled) {
          setError(result.error ?? "Restore failed.");
        }
        return;
      }
      setSuccess("Restore complete. Restarting…");
    } catch (restoreError) {
      setError(
        restoreError instanceof Error ? restoreError.message : "Restore failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleChooseFolder() {
    if (readOnly || !scheduleDraft) {
      return;
    }
    setError(null);
    try {
      const result = await getAuthenticatedBackup().chooseDestinationFolder();
      if (!result.ok) {
        if (!result.cancelled) {
          setError(result.error ?? "Could not choose folder.");
        }
        return;
      }
      setScheduleDraft({ ...scheduleDraft, destinationDir: result.folderPath });
    } catch (chooseError) {
      setError(
        chooseError instanceof Error ? chooseError.message : "Could not choose folder.",
      );
    }
  }

  async function handleSaveSchedule() {
    if (readOnly || !scheduleDraft) {
      return;
    }
    if (scheduleDraft.enabled && !scheduleDraft.destinationDir) {
      setError("Choose a destination folder before enabling automatic backup.");
      return;
    }

    setBusy("schedule");
    setError(null);
    setSuccess(null);
    try {
      const result = await getAuthenticatedBackup().updateSchedule(scheduleDraft);
      if (!result.ok) {
        setError(result.error ?? "Failed to save automatic backup settings.");
        return;
      }
      setScheduleStatus(result.status);
      setScheduleDraft(result.status.config);
      setSuccess("Automatic backup settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save automatic backup settings.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleRunScheduledNow() {
    if (readOnly) {
      return;
    }
    if (!scheduleDraft?.destinationDir) {
      setError("Set a destination folder before running an automatic backup.");
      return;
    }

    setBusy("auto");
    setError(null);
    setSuccess(null);
    try {
      const saveResult = await getAuthenticatedBackup().updateSchedule(scheduleDraft);
      if (!saveResult.ok) {
        setError(saveResult.error ?? "Failed to save settings before backup.");
        return;
      }
      setScheduleStatus(saveResult.status);
      setScheduleDraft(saveResult.status.config);

      const result = await getAuthenticatedBackup().runScheduledNow();
      if (!result.ok) {
        setError(result.error ?? "Automatic backup failed.");
        await reload();
        return;
      }
      setSuccess(
        `Automatic backup saved (${formatBytes(result.sizeBytes)}): ${result.filePath}`,
      );
      await reload();
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : "Automatic backup failed.",
      );
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="data-backup-screen company-settings-screen">
      <header class="company-settings-header">
        <div class="company-settings-heading">
          <Database size={22} aria-hidden="true" />
          <div>
            <h2>Data backup</h2>
            <p>Full database backup and restore (ADMIN)</p>
          </div>
        </div>
      </header>

      <div class="data-backup-body">
        {loading ? <p class="data-backup-note">Loading backup information…</p> : null}
        {error ? <p class="data-backup-error">{error}</p> : null}
        {success ? <p class="data-backup-success">{success}</p> : null}

        {info ? (
          <>
            <div class="data-backup-cards-row">
              <section class="data-backup-card">
                <h3>Where data lives</h3>
                <dl class="data-backup-dl">
                  <dt>Data folder</dt>
                  <dd>{info.userDataDir}</dd>
                  <dt>Database file</dt>
                  <dd>{info.dbPath}</dd>
                  <dt>Database size</dt>
                  <dd>{formatBytes(info.dbSizeBytes)}</dd>
                  {info.walSizeBytes > 0 ? (
                    <>
                      <dt>WAL file</dt>
                      <dd>{formatBytes(info.walSizeBytes)}</dd>
                    </>
                  ) : null}
                </dl>
              </section>

              <section class="data-backup-card">
                <h3>Last backup from this app</h3>
                {info.lastBackupAt && info.lastBackupPath ? (
                  <dl class="data-backup-dl">
                    <dt>Created</dt>
                    <dd>{formatDisplayDateTime(info.lastBackupAt)}</dd>
                    <dt>File</dt>
                    <dd>{info.lastBackupPath}</dd>
                    <dt>Size</dt>
                    <dd>
                      {info.lastBackupSizeBytes != null
                        ? formatBytes(info.lastBackupSizeBytes)
                        : "—"}
                    </dd>
                  </dl>
                ) : (
                  <p class="data-backup-note">No backup created from this app yet.</p>
                )}
              </section>
            </div>

            {scheduleDraft ? (
              <section class="data-backup-card">
                <h3>Automatic backup (while app is running)</h3>
                <p class="data-backup-note">
                  Runs once per day at the chosen time when this application is open.
                  For backups when the app is closed, use the Windows Task Scheduler script
                  documented in the user guide.
                </p>

                <label class="data-backup-field data-backup-checkbox">
                  <input
                    type="checkbox"
                    checked={scheduleDraft.enabled}
                    disabled={readOnly || busy != null}
                    onChange={(event) =>
                      setScheduleDraft({
                        ...scheduleDraft,
                        enabled: (event.currentTarget as HTMLInputElement).checked,
                      })
                    }
                  />
                  Enable automatic daily backup
                </label>

                <div class="data-backup-field">
                  <span class="data-backup-label">Destination folder</span>
                  <div class="data-backup-folder-row">
                    <span class="data-backup-folder-path">
                      {scheduleDraft.destinationDir ?? "Not set"}
                    </span>
                    <button
                      type="button"
                      class="company-settings-primary-btn data-backup-secondary-btn"
                      disabled={readOnly || busy != null}
                      onClick={() => void handleChooseFolder()}
                    >
                      Browse…
                    </button>
                  </div>
                </div>

                <div class="data-backup-schedule-fields">
                  <label class="data-backup-field">
                    <span class="data-backup-label">Time of day</span>
                    <input
                      class="data-backup-input"
                      type="time"
                      value={scheduleDraft.timeOfDay}
                      disabled={readOnly || busy != null}
                      onInput={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          timeOfDay: (event.currentTarget as HTMLInputElement).value,
                        })
                      }
                    />
                  </label>

                  <label class="data-backup-field">
                    <span class="data-backup-label">Keep automatic backups</span>
                    <input
                      class="data-backup-input data-backup-input-narrow"
                      type="number"
                      min={1}
                      max={365}
                      value={scheduleDraft.retentionCount}
                      disabled={readOnly || busy != null}
                      onInput={(event) =>
                        setScheduleDraft({
                          ...scheduleDraft,
                          retentionCount: Number(
                            (event.currentTarget as HTMLInputElement).value,
                          ),
                        })
                      }
                    />
                  </label>
                </div>

                {scheduleStatus ? (
                  <dl class="data-backup-dl data-backup-schedule-status">
                    <dt>Next run</dt>
                    <dd>
                      {scheduleStatus.nextRunAt
                        ? formatDisplayDateTime(scheduleStatus.nextRunAt)
                        : "—"}
                    </dd>
                    <dt>Last automatic backup</dt>
                    <dd>
                      {scheduleStatus.lastAutoBackupAt
                        ? formatDisplayDateTime(scheduleStatus.lastAutoBackupAt)
                        : "—"}
                    </dd>
                    {scheduleStatus.lastAutoBackupPath ? (
                      <>
                        <dt>Last automatic file</dt>
                        <dd>{scheduleStatus.lastAutoBackupPath}</dd>
                      </>
                    ) : null}
                    {scheduleStatus.lastAutoBackupError ? (
                      <>
                        <dt>Last error</dt>
                        <dd class="data-backup-error-inline">
                          {scheduleStatus.lastAutoBackupError}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}

                <div class="data-backup-actions">
                  <button
                    type="button"
                    class="company-settings-primary-btn"
                    disabled={readOnly || busy != null}
                    onClick={() => void handleSaveSchedule()}
                  >
                    {busy === "schedule" ? "Saving…" : "Save automatic backup settings"}
                  </button>
                  <button
                    type="button"
                    class="company-settings-primary-btn data-backup-secondary-btn"
                    disabled={readOnly || busy != null}
                    onClick={() => void handleRunScheduledNow()}
                  >
                    {busy === "auto" ? "Running…" : "Run automatic backup now"}
                  </button>
                </div>
              </section>
            ) : null}

            <section class="data-backup-card">
              <h3>Actions</h3>
              <div class="data-backup-actions">
                <button
                  type="button"
                  class="company-settings-primary-btn"
                  disabled={readOnly || busy != null}
                  onClick={() => void handleCreate()}
                >
                  {busy === "create" ? "Creating backup…" : "Create backup"}
                </button>
                <button
                  type="button"
                  class="company-settings-primary-btn company-settings-delete-btn"
                  disabled={readOnly || busy != null}
                  onClick={() => void handleRestore()}
                >
                  {busy === "restore" ? "Restoring…" : "Restore from backup"}
                </button>
              </div>
            </section>

            <p class="data-backup-warning">
              Restore replaces all sales, stock, delivery orders, and settings with
              the selected backup. The current database is renamed to{" "}
              <code>sales.db.old-&#123;timestamp&#125;</code> before restore. The app
              restarts automatically after a successful restore.
            </p>
            <p class="data-backup-note">
              Report CSV/PDF exports are not full backups. Use a{" "}
              <code>.db</code> backup file for disaster recovery. Restore with the
              same or newer application version when possible.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
