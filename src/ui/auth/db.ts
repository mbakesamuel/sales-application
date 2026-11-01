import { AUTH_TOKEN_KEY } from "./session.ts";
import { getElectronApi } from "./client.ts";
import type {
  ClearOperationalDataInput,
  TableDeleteInput,
  TableInsertInput,
  TableUpdateInput,
} from "../../shared/database.types.ts";

function requireAuthToken(): string {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error("Login required.");
  }
  return token;
}

export function getAuthenticatedDb() {
  const api = getElectronApi().db;

  return {
    getSchemaSummary: () => api.getSchemaSummary(),
    queryTable: api.queryTable.bind(api),
    getTableSchema: api.getTableSchema.bind(api),
    insertRow: (input: Omit<TableInsertInput, "authToken">) =>
      api.insertRow({ ...input, authToken: requireAuthToken() }),
    updateRow: (input: Omit<TableUpdateInput, "authToken">) =>
      api.updateRow({ ...input, authToken: requireAuthToken() }),
    setCompanyUiTheme: (uiThemePreset: "agro" | "dark") =>
      api.setCompanyUiTheme({
        authToken: requireAuthToken(),
        uiThemePreset,
      }),
    deleteRow: (input: Omit<TableDeleteInput, "authToken">) =>
      api.deleteRow({ ...input, authToken: requireAuthToken() }),
    clearOperationalData: (
      input: Omit<ClearOperationalDataInput, "authToken">,
    ) =>
      api.clearOperationalData({
        ...input,
        authToken: requireAuthToken(),
      }),
  };
}

export function getAuthToken(): string | null {
  return sessionStorage.getItem(AUTH_TOKEN_KEY);
}
