import { getAuthToken } from "./db.ts";
import { getElectronApi } from "./client.ts";

function requireAuthToken(): string {
  const token = getAuthToken();
  if (!token) {
    throw new Error("Login required.");
  }
  return token;
}

/**
 * Omit salesPointId so HTTP JSON does not coerce `undefined` → `null`
 * (central scope). Server/Electron then resolve to the actor's collection point.
 * Pass `null` explicitly for company/head-office scope.
 */
export function getAuthenticatedFinancialYears() {
  const api = getElectronApi().financialYears;

  return {
    listYears: () => api.listYears(requireAuthToken()),
    openYear: (financialYear: number) =>
      api.openYear(requireAuthToken(), financialYear),
    closeYear: (periodId: string) => api.closeYear(requireAuthToken(), periodId),
    listMonthsForOpenYear: (salesPointId?: number | null) =>
      salesPointId === undefined
        ? api.listMonthsForOpenYear(requireAuthToken())
        : api.listMonthsForOpenYear(requireAuthToken(), salesPointId),
    listMonthsForPeriod: (periodId: string, salesPointId?: number | null) =>
      salesPointId === undefined
        ? api.listMonthsForPeriod(requireAuthToken(), periodId)
        : api.listMonthsForPeriod(requireAuthToken(), periodId, salesPointId),
    setMonthStatus: (
      monthId: string,
      status: "OPEN" | "CLOSED",
      salesPointId?: number | null,
    ) =>
      salesPointId === undefined
        ? api.setMonthStatus(requireAuthToken(), monthId, status)
        : api.setMonthStatus(
            requireAuthToken(),
            monthId,
            status,
            salesPointId,
          ),
    getOpenPostingPeriod: (salesPointId?: number | null) =>
      salesPointId === undefined
        ? api.getOpenPostingPeriod(requireAuthToken())
        : api.getOpenPostingPeriod(requireAuthToken(), salesPointId),
  };
}
