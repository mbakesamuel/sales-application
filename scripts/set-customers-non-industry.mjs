/**
 * Set every customer that is not Industry to the Retail (non-industry) type.
 * Industry customers are left unchanged. Enqueues SyncOutbox UPDATE rows.
 *
 * Run (close the app if the DB is locked):
 *   npm run transpile:electron && electron scripts/set-customers-non-industry.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";

const APP_USER_DATA = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
  "sales-electron",
);

app.setPath("userData", APP_USER_DATA);

function getDbPath() {
  return path.join(APP_USER_DATA, "sales.db");
}

function isIndustryType(code, name) {
  return `${code ?? ""} ${name ?? ""}`.toUpperCase().includes("INDUSTR");
}

function isRetailType(code, name) {
  return `${code ?? ""} ${name ?? ""}`.toUpperCase().includes("RETAIL");
}

app.whenReady().then(() => {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    app.exit(1);
    return;
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const types = db
      .prepare(
        `SELECT id, code, name FROM CustomerTypeDefinition WHERE isActive = 1`,
      )
      .all();

    if (types.length === 0) {
      console.error("No active CustomerTypeDefinition rows found.");
      app.exit(1);
      return;
    }

    const industryIds = new Set(
      types
        .filter((row) => isIndustryType(row.code, row.name))
        .map((row) => String(row.id)),
    );
    const retail =
      types.find((row) => isRetailType(row.code, row.name)) ??
      types.find((row) => !isIndustryType(row.code, row.name)) ??
      null;

    if (!retail) {
      console.error("Could not resolve a non-industry (Retail) customer type.");
      app.exit(1);
      return;
    }

    if (industryIds.size === 0) {
      console.warn(
        "No Industry customer type found — every customer will be set to Retail.",
      );
    }

    console.log(`Non-industry target type: ${retail.code} / ${retail.name} (${retail.id})`);
    console.log(
      `Industry type ids kept: ${
        industryIds.size ? [...industryIds].join(", ") : "(none)"
      }`,
    );

    const before = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN customerTypeId = ? THEN 1 ELSE 0 END) AS alreadyTarget,
           SUM(
             CASE
               WHEN customerTypeId IS NOT NULL
                 AND customerTypeId NOT IN (${
                   industryIds.size
                     ? [...industryIds].map(() => "?").join(",")
                     : "NULL"
                 })
                 AND customerTypeId != ?
               THEN 1 ELSE 0
             END
           ) AS willUpdate
         FROM Customer`,
      )
      .get(
        retail.id,
        ...(industryIds.size ? [...industryIds] : []),
        retail.id,
      );

    console.log(
      `Customers: total=${before.total}, already ${retail.name}=${before.alreadyTarget}, to update=${before.willUpdate}`,
    );

    const selectToUpdate = db.prepare(
      industryIds.size
        ? `SELECT * FROM Customer
           WHERE customerTypeId NOT IN (${[...industryIds].map(() => "?").join(",")})
             AND customerTypeId != ?`
        : `SELECT * FROM Customer WHERE customerTypeId != ?`,
    );

    const updateStmt = db.prepare(
      `UPDATE Customer
       SET customerTypeId = ?, updatedAt = datetime('now')
       WHERE id = ?`,
    );
    const enqueueStmt = db.prepare(
      `INSERT INTO SyncOutbox (entityType, entityId, action, payloadJson, status, createdAt)
       VALUES ('Customer', ?, 'UPDATE', ?, 'PENDING', datetime('now'))`,
    );
    const selectAfter = db.prepare(`SELECT * FROM Customer WHERE id = ?`);

    const result = db.transaction(() => {
      const rows = industryIds.size
        ? selectToUpdate.all(...industryIds, retail.id)
        : selectToUpdate.all(retail.id);

      let updated = 0;
      for (const row of rows) {
        updateStmt.run(retail.id, row.id);
        const next = selectAfter.get(row.id);
        enqueueStmt.run(String(row.id), JSON.stringify(next));
        updated += 1;
      }
      return { updated, sample: rows.slice(0, 10).map((r) => ({ id: r.id, name: r.name, from: r.customerTypeId })) };
    })();

    const counts = db
      .prepare(
        `SELECT ct.code, ct.name, COUNT(*) AS count
         FROM Customer c
         LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
         GROUP BY c.customerTypeId
         ORDER BY count DESC`,
      )
      .all();

    console.log(`Updated ${result.updated} customer(s) → ${retail.name}.`);
    if (result.sample.length) {
      console.log("Sample:", result.sample);
    }
    console.log("Type counts after:");
    for (const row of counts) {
      console.log(`  ${row.code ?? "?"} / ${row.name ?? "?"} = ${row.count}`);
    }
  } catch (error) {
    console.error(error);
    db.close();
    app.exit(1);
    return;
  }

  db.close();
  app.exit(0);
});
