import { app, BrowserWindow, Menu, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, initDatabase } from "./db/index.js";
import { registerDeliveryOrdersHandlers } from "./ipc/deliveryOrders.js";
import { registerCarryForwardHandlers } from "./ipc/carryForward.js";
import { registerCarryForwardStockHandlers } from "./ipc/carryForwardStock.js";
import { registerAuthHandlers } from "./ipc/auth.js";
import { registerDatabaseHandlers } from "./ipc/database.js";
import { registerPermissionsHandlers } from "./ipc/permissions.js";
import { registerSalesHandlers } from "./ipc/sales.js";
import { registerVehicleConsignmentNotesHandlers } from "./ipc/vehicleConsignmentNotes.js";
import { registerReportsHandlers } from "./ipc/reports.js";
import { registerDashboardHandlers } from "./ipc/dashboard.js";
import { registerStockHandlers } from "./ipc/stock.js";
import { registerFinancialYearsHandlers } from "./ipc/financialYears.js";
import { registerDialogHandlers } from "./ipc/dialog.js";
import { registerPrintHandlers } from "./ipc/print.js";
import { registerBackupHandlers } from "./ipc/backup.js";
import { startBackupScheduler } from "./db/backupSchedule.js";
import { registerTransportCostHandlers } from "./ipc/transportCost.js";
import { registerWindowsHandlers } from "./ipc/windows.js";
import { registerBookletsHandlers } from "./ipc/booklets.js";
import { registerSyncHandlers } from "./ipc/sync.js";
import { getSyncService } from "./sync/syncService.js";
import { backfillFinancialMonths } from "./financialYears/service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = "http://localhost:5173";

async function waitForDevServer(
  url: string,
  attempts = 40,
  delayMs = 250,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Vite not up yet, or transient network change — retry.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Dev server did not become ready at ${url}`);
}

async function loadDevUrl(mainWindow: BrowserWindow): Promise<void> {
  await waitForDevServer(DEV_SERVER_URL);

  const maxLoadAttempts = 5;
  for (let attempt = 1; attempt <= maxLoadAttempts; attempt += 1) {
    try {
      await mainWindow.loadURL(DEV_SERVER_URL);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        message.includes("ERR_NETWORK_CHANGED") ||
        message.includes("ERR_CONNECTION_REFUSED") ||
        message.includes("ERR_CONNECTION_RESET") ||
        message.includes("ERR_FAILED");
      if (!retryable || attempt === maxLoadAttempts) {
        throw error;
      }
      console.warn(
        `Dev URL load failed (attempt ${attempt}/${maxLoadAttempts}): ${message}. Retrying…`,
      );
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

/** Ctrl/Cmd +/- / 0 — works even with Menu.setApplicationMenu(null). */
function wireZoomShortcuts(win: BrowserWindow): void {
  win.webContents.setZoomFactor(1);
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    if (!(input.control || input.meta)) {
      return;
    }
    const key = input.key;
    if (key === "=" || key === "+" || key === "Add") {
      event.preventDefault();
      win.webContents.setZoomFactor(
        Math.min(win.webContents.getZoomFactor() + 0.1, 1.5),
      );
      return;
    }
    if (key === "-" || key === "_" || key === "Subtract") {
      event.preventDefault();
      win.webContents.setZoomFactor(
        Math.max(win.webContents.getZoomFactor() - 0.1, 0.7),
      );
      return;
    }
    if (key === "0" || key === "NumPad0") {
      event.preventDefault();
      win.webContents.setZoomFactor(1);
    }
  });
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    title: "Sales Management Application",
    backgroundColor: "#f4f7eb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1,
    },
  });

  wireZoomShortcuts(mainWindow);

  if (!app.isPackaged) {
    void loadDevUrl(mainWindow).catch((error) => {
      console.error("Failed to load Vite dev server:", error);
    });
  } else {
    mainWindow.loadFile(
      path.join(app.getAppPath(), "dist-react", "index.html"),
    );
  }

  return mainWindow;
}

/** Thin client: renderer uses VITE_API_BASE_URL HTTP API; no local SQLite. */
const THIN_CLIENT =
  process.env.SALES_THIN_CLIENT === "1" ||
  Boolean(process.env.SALES_API_BASE_URL?.trim());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  if (THIN_CLIENT) {
    console.log(
      "SALES_THIN_CLIENT: skipping SQLite — UI must use VITE_API_BASE_URL HTTP API.",
    );
    registerDialogHandlers();
    registerPrintHandlers();
    registerWindowsHandlers();
    createWindow();
  } else {
    try {
      initDatabase();
      backfillFinancialMonths();
    } catch (error) {
      console.error("Database initialization failed:", error);
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        "Database initialization failed",
        `${message}\n\nThe application cannot start. If this persists after reinstalling, delete the folder:\n${app.getPath("userData")}`,
      );
      app.exit(1);
      return;
    }
    registerDatabaseHandlers();
    registerAuthHandlers();
    registerSalesHandlers();
    registerDeliveryOrdersHandlers();
    registerVehicleConsignmentNotesHandlers();
    registerCarryForwardHandlers();
    registerCarryForwardStockHandlers();
    registerStockHandlers();
    registerReportsHandlers();
    registerDashboardHandlers();
    registerFinancialYearsHandlers();
    registerPermissionsHandlers();
    registerDialogHandlers();
    registerPrintHandlers();
    registerBackupHandlers();
    startBackupScheduler();
    registerTransportCostHandlers();
    registerWindowsHandlers();
    registerBookletsHandlers();
    registerSyncHandlers();
    getSyncService().init();
    createWindow();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (!THIN_CLIENT) {
      closeDatabase();
    }
    app.quit();
  }
});

app.on("before-quit", () => {
  if (!THIN_CLIENT) {
    closeDatabase();
  }
});
