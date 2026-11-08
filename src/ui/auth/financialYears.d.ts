export declare function getAuthenticatedFinancialYears(): {
  listYears: () => Promise<
    import("../../shared/financialYears.types.ts").FinancialYearRow[]
  >;
  openYear: (
    financialYear: number,
  ) => Promise<import("../../shared/financialYears.types.ts").OpenYearResult>;
  closeYear: (
    periodId: string,
  ) => Promise<import("../../shared/financialYears.types.ts").FinancialYearRow>;
  listMonthsForOpenYear: (
    salesPointId?: number | null,
  ) => Promise<{
    year: import("../../shared/financialYears.types.ts").FinancialYearRow | null;
    months: import("../../shared/financialYears.types.ts").FinancialMonthRow[];
  }>;
  listMonthsForPeriod: (
    periodId: string,
    salesPointId?: number | null,
  ) => Promise<
    import("../../shared/financialYears.types.ts").FinancialMonthRow[]
  >;
  setMonthStatus: (
    monthId: string,
    status: "OPEN" | "CLOSED",
    salesPointId?: number | null,
  ) => Promise<
    import("../../shared/financialYears.types.ts").FinancialMonthRow
  >;
  getOpenPostingPeriod: (
    salesPointId?: number | null,
  ) => Promise<
    import("../../shared/financialYears.types.ts").OpenPostingPeriod | null
  >;
};
