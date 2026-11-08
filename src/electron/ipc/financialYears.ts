import { ipcMain } from "electron";
import type {
  FinancialMonthRow,
  FinancialPeriodStatus,
  FinancialYearRow,
  OpenPostingPeriod,
  OpenYearResult,
} from "../../shared/financialYears.types.js";
import { requireAuthUser } from "../auth/requireUser.js";
import {
  closeYear,
  getOpenPostingPeriod,
  listMonthsForOpenYear,
  listMonthsForPeriod,
  listYears,
  openYear,
  postingScopeForUser,
  setMonthStatus,
} from "../financialYears/service.js";

/** Omit/undefined → actor collection point; null → central/head office. */
function resolvePostingScope(
  authToken: string,
  salesPointId?: number | null,
): number | null {
  const user = requireAuthUser(authToken);
  if (salesPointId !== undefined) {
    return salesPointId;
  }
  return postingScopeForUser(user.id);
}

export function registerFinancialYearsHandlers(): void {
  ipcMain.handle(
    "financialYears:listYears",
    (_event, authToken: string): FinancialYearRow[] => {
      requireAuthUser(authToken);
      return listYears();
    },
  );

  ipcMain.handle(
    "financialYears:openYear",
    (_event, authToken: string, financialYear: number): OpenYearResult => {
      requireAuthUser(authToken);
      return openYear(financialYear);
    },
  );

  ipcMain.handle(
    "financialYears:closeYear",
    (_event, authToken: string, periodId: string): FinancialYearRow => {
      requireAuthUser(authToken);
      return closeYear(periodId);
    },
  );

  ipcMain.handle(
    "financialYears:listMonthsForOpenYear",
    (
      _event,
      authToken: string,
      salesPointId?: number | null,
    ): { year: FinancialYearRow | null; months: FinancialMonthRow[] } => {
      return listMonthsForOpenYear(resolvePostingScope(authToken, salesPointId));
    },
  );

  ipcMain.handle(
    "financialYears:listMonthsForPeriod",
    (
      _event,
      authToken: string,
      periodId: string,
      salesPointId?: number | null,
    ): FinancialMonthRow[] => {
      return listMonthsForPeriod(
        periodId,
        resolvePostingScope(authToken, salesPointId),
      );
    },
  );

  ipcMain.handle(
    "financialYears:setMonthStatus",
    (
      _event,
      authToken: string,
      monthId: string,
      status: FinancialPeriodStatus,
      salesPointId?: number | null,
    ): FinancialMonthRow => {
      return setMonthStatus(
        monthId,
        status,
        resolvePostingScope(authToken, salesPointId),
      );
    },
  );

  ipcMain.handle(
    "financialYears:getOpenPostingPeriod",
    (
      _event,
      authToken: string,
      salesPointId?: number | null,
    ): OpenPostingPeriod | null => {
      return getOpenPostingPeriod(resolvePostingScope(authToken, salesPointId));
    },
  );
}
