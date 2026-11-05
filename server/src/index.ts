import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { formatDbTargetLog } from "./db/config.js";
import { getDbConfig } from "./db/index.js";
import { app } from "./app.js";
import { closePdfBrowser } from "./print/htmlToPdf.js";

dotenv.config();

const isVercel = Boolean(process.env.VERCEL);

if (!isVercel) {
  const port = Number(process.env.PORT) || 3001;
  const host = process.env.HOST || "0.0.0.0";

  console.log(`Starting Hono sync server on http://${host}:${port}...`);
  console.log(formatDbTargetLog(getDbConfig()));

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info) => {
      console.log(
        `Sales Central API listening at http://${info.address}:${info.port}`,
      );
    },
  );

  async function shutdown(signal: string) {
    console.log(`Shutting down (${signal})…`);
    await closePdfBrowser();
    process.exit(0);
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

export default app;
