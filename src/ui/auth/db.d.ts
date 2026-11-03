import type { ClearOperationalDataInput, TableDeleteInput, TableInsertInput, TableUpdateInput } from "../../shared/database.types.ts";
export declare function getAuthenticatedDb(): {
    getSchemaSummary: () => Promise<import("../types/electron").SchemaSummary>;
    queryTable: (input: import("../types/electron").TableQueryInput) => Promise<import("../types/electron").TableQueryResult>;
    getTableSchema: (table: string) => Promise<import("../types/electron").TableSchema>;
    insertRow: (input: Omit<TableInsertInput, "authToken">) => Promise<Record<string, unknown>>;
    updateRow: (input: Omit<TableUpdateInput, "authToken">) => Promise<Record<string, unknown>>;
    setCompanyUiTheme: (uiThemePreset: "agro" | "dark") => Promise<{
        ok: true;
        uiThemePreset: "agro" | "dark";
    } | {
        ok: false;
        error: string;
    }>;
    deleteRow: (input: Omit<TableDeleteInput, "authToken">) => Promise<void>;
    clearOperationalData: (input: Omit<ClearOperationalDataInput, "authToken">) => Promise<import("../types/electron").ClearOperationalDataResponse>;
};
export declare function getAuthToken(): string | null;
