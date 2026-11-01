import type { TransportCostReport } from "../../shared/reports.types.ts";
import "./StockCommitmentReport.css";
import "./TransportCostReport.css";
export declare function TransportCostReportDocument({ report }: {
    report: TransportCostReport;
}): import("preact").JSX.Element;
export declare function TransportCostReportScreen({ windowMode }: {
    windowMode?: boolean;
}): import("preact").JSX.Element;
