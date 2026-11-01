import { getDatabase } from "../db/index.js";

export const MOLIWE_SALES_POINT_NAME = "Moliwe";
/** Invoices for transport cost are limited to this customer when the policy is on. */
export const TRANSPORT_COST_CUSTOMER_NAME = "SCR MAYA";

type AppDatabase = ReturnType<typeof getDatabase>;

export function loadTransportCostMoliweOnlyPolicy(
  db: AppDatabase = getDatabase(),
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "transportCostMoliweOnlyPolicy")) {
      return true;
    }

    const row = db
      .prepare(
        `SELECT transportCostMoliweOnlyPolicy
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { transportCostMoliweOnlyPolicy: number | null } | undefined;

    // Prefer on when unset — transport cost is Moliwe + SCR MAY by company policy.
    return Number(row?.transportCostMoliweOnlyPolicy ?? 1) !== 0;
  } catch {
    return true;
  }
}

export function resolveMoliweSalesPointId(
  db: AppDatabase = getDatabase(),
): number | null {
  const row = db
    .prepare(
      `SELECT id FROM SalesPoint
       WHERE isActive = 1 AND TRIM(name) = ? COLLATE NOCASE
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(MOLIWE_SALES_POINT_NAME) as { id: number } | undefined;

  return row?.id ?? null;
}

export function resolveTransportCostCustomerId(
  db: AppDatabase = getDatabase(),
): number | null {
  const row = db
    .prepare(
      `SELECT id FROM Customer
       WHERE COALESCE(isPosPlaceholder, 0) = 0
         AND TRIM(name) = ? COLLATE NOCASE
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(TRANSPORT_COST_CUSTOMER_NAME) as { id: number } | undefined;

  return row?.id ?? null;
}

export function buildTransportCostPolicyNotice(
  policyEnabled: boolean,
  moliweSalesPointId: number | null,
  scrMayCustomerId: number | null = null,
): string | null {
  if (!policyEnabled) {
    return null;
  }
  if (moliweSalesPointId == null) {
    return `Transport cost policy is enabled, but no active collection point named "${MOLIWE_SALES_POINT_NAME}" was found. Add or activate that collection point in Company Settings.`;
  }
  if (scrMayCustomerId == null) {
    return `Transport cost policy is enabled, but no customer named "${TRANSPORT_COST_CUSTOMER_NAME}" was found. Add that customer before computing transport cost.`;
  }
  return `Company policy: transportation cost is limited to ${MOLIWE_SALES_POINT_NAME} invoices for ${TRANSPORT_COST_CUSTOMER_NAME}.`;
}

export function assertTransportCostSalesPointAllowed(
  salesPointId: number,
  policyEnabled: boolean,
  moliweSalesPointId: number | null,
): void {
  if (!policyEnabled) {
    return;
  }
  if (moliweSalesPointId == null) {
    throw new Error(
      `Transport cost policy is enabled, but no active collection point named "${MOLIWE_SALES_POINT_NAME}" was found.`,
    );
  }
  if (salesPointId !== moliweSalesPointId) {
    throw new Error(
      `Transportation cost is limited to the ${MOLIWE_SALES_POINT_NAME} collection point while the transport cost policy is enabled.`,
    );
  }
}

export function assertTransportCostCustomerAllowed(
  customerId: number,
  policyEnabled: boolean,
  scrMayCustomerId: number | null,
): void {
  if (!policyEnabled) {
    return;
  }
  if (scrMayCustomerId == null) {
    throw new Error(
      `Transport cost policy is enabled, but no customer named "${TRANSPORT_COST_CUSTOMER_NAME}" was found.`,
    );
  }
  if (customerId !== scrMayCustomerId) {
    throw new Error(
      `Transportation cost is limited to customer ${TRANSPORT_COST_CUSTOMER_NAME} while the transport cost policy is enabled.`,
    );
  }
}

export function filterLiftedLinesForTransportCostPolicy<
  T extends { salesPointId: number; customerId: number },
>(
  lines: T[],
  policyEnabled: boolean,
  moliweSalesPointId: number | null,
  scrMayCustomerId: number | null,
): T[] {
  if (!policyEnabled) {
    return lines;
  }
  if (moliweSalesPointId == null || scrMayCustomerId == null) {
    return [];
  }
  return lines.filter(
    (line) =>
      line.salesPointId === moliweSalesPointId &&
      line.customerId === scrMayCustomerId,
  );
}

export function assertTransportCostReportPolicyConfigured(
  policyEnabled: boolean,
  moliweSalesPointId: number | null,
  scrMayCustomerId: number | null,
): void {
  if (!policyEnabled) {
    return;
  }
  if (moliweSalesPointId == null) {
    throw new Error(
      `Transport cost policy is enabled, but no active collection point named "${MOLIWE_SALES_POINT_NAME}" was found.`,
    );
  }
  if (scrMayCustomerId == null) {
    throw new Error(
      `Transport cost policy is enabled, but no customer named "${TRANSPORT_COST_CUSTOMER_NAME}" was found.`,
    );
  }
}
