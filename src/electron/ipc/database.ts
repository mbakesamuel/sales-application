import { ipcMain } from "electron";
import type {
  ClearOperationalDataInput,
  ClearOperationalDataResponse,
  TableDeleteInput,
  TableInsertInput,
  TableQueryInput,
  TableQueryResult,
  TableSchema,
  TableUpdateInput,
} from "../../shared/database.types.js";
import { assertTableWrite } from "../auth/permissions/service.js";
import { requireAuthUser } from "../auth/requireUser.js";
import { clearOperationalData } from "../db/clearOperationalData.js";
import { getDatabase } from "../db/index.js";
import {
  deleteRow,
  getTableSchema,
  insertRow,
  updateRow,
} from "../db/tableMutations.js";
import { queryTable } from "../db/tableQuery.js";
import {
  setCompanyUiTheme,
  type SetCompanyUiThemeResult,
} from "../reports/companySettings.js";
import {
  getSyncState,
  pruneOperationalOutboxItems,
} from "../sync/syncOutbox.js";

export function registerDatabaseHandlers(): void {
  ipcMain.handle("db:getSchemaSummary", (): { tableCount: number; tables: string[] } => {
    const rows = getDatabase()
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != 'schema_migrations'
         ORDER BY name`,
      )
      .all() as { name: string }[];

    const tables = rows.map((row) => row.name);

    return {
      tableCount: tables.length,
      tables,
    };
  });

  ipcMain.handle(
    "db:queryTable",
    (_event, input: TableQueryInput): TableQueryResult => {
      if (!input || typeof input.table !== "string") {
        throw new Error("Table name is required");
      }

      return queryTable(input);
    },
  );

  ipcMain.handle(
    "db:getTableSchema",
    (_event, table: string): TableSchema => {
      if (typeof table !== "string" || !table.trim()) {
        throw new Error("Table name is required");
      }

      return getTableSchema(table.trim());
    },
  );

  ipcMain.handle(
    "db:insertRow",
    (_event, input: TableInsertInput): Record<string, unknown> => {
      if (!input || typeof input.table !== "string") {
        throw new Error("Table name is required");
      }

      const user = requireAuthUser(input.authToken);
      assertTableWrite(user.role, input.table.trim());
      return insertRow(input);
    },
  );

  ipcMain.handle(
    "db:updateRow",
    (_event, input: TableUpdateInput): Record<string, unknown> => {
      if (!input || typeof input.table !== "string") {
        throw new Error("Table name is required");
      }

      const user = requireAuthUser(input.authToken);
      assertTableWrite(user.role, input.table.trim());
      return updateRow(input);
    },
  );

  ipcMain.handle(
    "db:setCompanyUiTheme",
    (
      _event,
      input: { authToken?: string; uiThemePreset?: unknown },
    ): SetCompanyUiThemeResult => {
      const user = requireAuthUser(input?.authToken);
      assertTableWrite(user.role, "CompanySettings");
      return setCompanyUiTheme(input?.uiThemePreset);
    },
  );

  ipcMain.handle("db:deleteRow", (_event, input: TableDeleteInput): void => {
    if (!input || typeof input.table !== "string") {
      throw new Error("Table name is required");
    }

    const user = requireAuthUser(input.authToken);
    assertTableWrite(user.role, input.table.trim());
    deleteRow(input);
  });

  ipcMain.handle(
    "db:clearOperationalData",
    async (
      _event,
      input: ClearOperationalDataInput,
    ): Promise<ClearOperationalDataResponse> => {
      try {
        const user = requireAuthUser(input?.authToken);
        if (user.role !== "ADMIN") {
          return {
            ok: false,
            error: "Only Administrators can clear operational data.",
          };
        }
        if (!input || input.confirm !== "CLEAR") {
          return {
            ok: false,
            error: 'Confirmation required: confirm must be "CLEAR".',
          };
        }

        const db = getDatabase();
        db.pragma("foreign_keys = ON");
        const result = clearOperationalData(db);

        if (!input.alsoClearSyncDb) {
          return { ok: true, ...result };
        }

        const state = getSyncState(db);
        const serverUrl = state.syncServerUrl?.trim().replace(/\/+$/, "");
        if (!serverUrl) {
          return {
            ok: true,
            ...result,
            syncCleared: false,
            syncError: "Sync server URL is not configured.",
          };
        }

        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (state.apiToken) {
            headers.Authorization = `Bearer ${state.apiToken}`;
          }

          const response = await fetch(
            `${serverUrl}/api/sync/clear-operational`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ confirm: "CLEAR" }),
              signal: AbortSignal.timeout(60_000),
            },
          );

          const body = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            tables?: string[];
            error?: string;
          };

          if (!response.ok || !body.ok) {
            const errText =
              body.error ||
              `Sync clear failed (HTTP ${response.status})`;
            return {
              ok: true,
              ...result,
              syncCleared: false,
              syncError: errText,
            };
          }

          pruneOperationalOutboxItems(db);

          return {
            ok: true,
            ...result,
            syncCleared: true,
            syncTables: body.tables,
          };
        } catch (syncErr: unknown) {
          const msg =
            syncErr instanceof Error ? syncErr.message : String(syncErr);
          return {
            ok: true,
            ...result,
            syncCleared: false,
            syncError: msg,
          };
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    },
  );
}
