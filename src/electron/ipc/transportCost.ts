import { ipcMain } from "electron";
import type {
  TransportCostComputeInput,
  TransportCostComputeResult,
  TransportCostFormOptions,
} from "../../shared/transportCost.types.js";
import {
  computeTransportCost,
  getTransportCostFormOptions,
} from "../transport/service.js";
import { requireAuthUser } from "../auth/requireUser.js";

export function registerTransportCostHandlers(): void {
  ipcMain.handle(
    "transportCost:getFormOptions",
    (_event, authToken: string): TransportCostFormOptions => {
      const user = requireAuthUser(authToken);
      return getTransportCostFormOptions(user.id);
    },
  );

  ipcMain.handle(
    "transportCost:compute",
    (_event, authToken: string, input: TransportCostComputeInput): TransportCostComputeResult => {
      const user = requireAuthUser(authToken);
      return computeTransportCost(input, user.id);
    },
  );
}
