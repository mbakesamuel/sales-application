import { useState } from "preact/hooks";

const STORAGE_KEY = "report-hide-zero-rows";

export function readHideZeroReportRows(): boolean {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value == null) {
      return true;
    }
    return value !== "0" && value !== "false";
  } catch {
    return true;
  }
}

export function writeHideZeroReportRows(hideZero: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, hideZero ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

export function useHideZeroReportRows(): [boolean, (next: boolean) => void] {
  const [hideZero, setHideZero] = useState(readHideZeroReportRows);

  function setHideZeroReportRows(next: boolean): void {
    writeHideZeroReportRows(next);
    setHideZero(next);
  }

  return [hideZero, setHideZeroReportRows];
}
