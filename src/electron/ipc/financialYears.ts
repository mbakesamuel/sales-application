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
  getOpenPostingPeriodForActor,
  listMonthsForOpenYear,
  listMonthsForOpenYearForActor,
  listMonthsForPeriod,
  listYears,
  openYear,
  postingScopeForUser,
  setMonthStatus,
  setMonthStatusForActor,
} from "../financialYears/service.js";

/**
 * Collection-point actors always use their SP scope.
 * Head-office actors use personal UserPostingMonth (ignore client null scope).
 */
function resolveActorMonthAccess(authToken: string): {
  userId: string;
  salesPointId: number | null;
} {
  const user = requireAuthUser(authToken);
  return {
    userId: user.id,
    salesPointId: postingScopeForUser(user.id),
  };
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
      _salesPointId?: number | null,
    ): { year: FinancialYearRow | null; months: FinancialMonthRow[] } => {
      const { userId, salesPointId } = resolveActorMonthAccess(authToken);
      if (salesPointId != null) {
        return listMonthsForOpenYear(salesPointId);
      }
      return listMonthsForOpenYearForActor(userId);
    },
  );

  ipcMain.handle(
    "financialYears:listMonthsForPeriod",
    (
      _event,
      authToken: string,
      periodId: string,
      _salesPointId?: number | null,
    ): FinancialMonthRow[] => {
      const { userId, salesPointId } = resolveActorMonthAccess(authToken);
      if (salesPointId != null) {
        return listMonthsForPeriod(periodId, salesPointId);
      }
      // HO: reuse open-year actor list filtered by period via set/list helpers.
      const { year, months } = listMonthsForOpenYearForActor(userId);
      if (!year || year.id !== periodId) {
        return [];
      }
      return months;
    },
  );

  ipcMain.handle(
    "financialYears:setMonthStatus",
    (
      _event,
      authToken: string,
      monthId: string,
      status: FinancialPeriodStatus,
      _salesPointId?: number | null,
    ): FinancialMonthRow => {
      const { userId, salesPointId } = resolveActorMonthAccess(authToken);
      if (salesPointId != null) {
        return setMonthStatus(monthId, status, salesPointId);
      }
      return setMonthStatusForActor(userId, monthId, status);
    },
  );

  ipcMain.handle(
    "financialYears:getOpenPostingPeriod",
    (
      _event,
      authToken: string,
      _salesPointId?: number | null,
    ): OpenPostingPeriod | null => {
      const { userId, salesPointId } = resolveActorMonthAccess(authToken);
      if (salesPointId != null) {
        return getOpenPostingPeriod(salesPointId);
      }
      return getOpenPostingPeriodForActor(userId);
    },
  );
}
