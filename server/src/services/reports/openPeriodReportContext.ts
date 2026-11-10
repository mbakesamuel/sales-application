import {
  getOpenPostingPeriod,
  postingScopeForUser,
  type OpenPostingPeriod,
} from "../financialYearsService.js";
import { todayIso } from "../reportCompany.js";

export type OpenPeriodReportContext = {
  period: OpenPostingPeriod;
  asAtIso: string;
};

/** Open posting period for the actor + as-at capped to period end. */
export async function resolveOpenPeriodReportContext(
  userId?: string | null,
): Promise<OpenPeriodReportContext> {
  const scope = await postingScopeForUser(userId);
  const period = await getOpenPostingPeriod(scope);
  if (!period) {
    throw new Error("Open a financial month before running reports.");
  }
  const today = todayIso();
  const asAtIso = today < period.endDate ? today : period.endDate;
  return { period, asAtIso };
}
