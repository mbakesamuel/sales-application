/**
 * Dedicated Vercel entry for /api/print/* so Chromium binaries can be
 * included only on this function (keeps the main API lean).
 */
export { default, config } from "./handler.js";
