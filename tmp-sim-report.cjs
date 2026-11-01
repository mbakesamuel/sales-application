const Database = require("better-sqlite3");
const db = new Database("C:/Users/user/AppData/Roaming/sales-electron/sales.db", {
  readonly: true,
});

const PACK_COLUMNS = [
  { id: "jug20", litresPerUnit: 20, packIds: ["jug20"] },
  { id: "carton15", litresPerUnit: 15, packIds: ["carton15", "unit1"] },
  { id: "carton5", litresPerUnit: 15, packIds: ["carton5"] },
];

function detect(productName, productCode) {
  const text = `${productName} ${productCode ?? ""}`.toUpperCase();
  if (text.includes("20L") || text.includes("JUG")) return "jug20";
  if (text.includes("3X5") || (text.includes("5L") && text.includes("CTN"))) return "carton5";
  if (text.includes("15L")) return "carton15";
  if (text.includes("1L")) return "unit1";
  return "other";
}

function packColumnIndex(packId) {
  return PACK_COLUMNS.findIndex((c) => c.packIds.includes(packId));
}

const products = db
  .prepare(
    `SELECT p.productId, p.productName, p.productCode, COALESCE(pc.isBottled,0) AS isBottled
     FROM Product p LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId`,
  )
  .all();

const packByProduct = new Map(
  products
    .filter((p) => p.isBottled === 1)
    .map((p) => [p.productId, detect(p.productName, p.productCode)]),
);

console.log("packByProduct", [...packByProduct.entries()]);

const lines = db
  .prepare(
    `SELECT s.id AS saleId, s.dateIssued, s.saleDisposition, sl.productId,
            COALESCE(sl.qtyUnits, sl.qtyKg) AS units, sl.lineNet
     FROM Sale s
     JOIN SaleLine sl ON sl.saleId = s.id
     JOIN Product p ON p.productId = sl.productId
     LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
     WHERE s.status='VALIDATED' AND COALESCE(pc.isBottled,0)=1
       AND s.dateIssued >= '2025-12-29' AND s.dateIssued <= '2026-01-11'`,
  )
  .all();

const days = ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"];
const daySet = new Set(days);
const totalsPack = [0, 0, 0];
const totalsValue = [0, 0, 0];

for (const line of lines) {
  if (!daySet.has(String(line.dateIssued).slice(0, 10))) continue;
  const packId = packByProduct.get(line.productId);
  const idx = packColumnIndex(packId);
  console.log("line", {
    date: line.dateIssued,
    productId: line.productId,
    packId,
    idx,
    units: line.units,
    lineNet: line.lineNet,
  });
  if (idx >= 0) {
    totalsPack[idx] += Number(line.units);
    totalsValue[idx] += Number(line.lineNet);
  }
}

console.log("week1 totalsPack", totalsPack, "totalsValue", totalsValue);

const days2 = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
const daySet2 = new Set(days2);
const totalsPack2 = [0, 0, 0];
const totalsValue2 = [0, 0, 0];
for (const line of lines) {
  if (!daySet2.has(String(line.dateIssued).slice(0, 10))) continue;
  const packId = packByProduct.get(line.productId);
  const idx = packColumnIndex(packId);
  console.log("line2", {
    date: line.dateIssued,
    packId,
    idx,
    units: line.units,
  });
  if (idx >= 0) {
    totalsPack2[idx] += Number(line.units);
    totalsValue2[idx] += Number(line.lineNet);
  }
}
console.log("week2 totalsPack", totalsPack2, "totalsValue", totalsValue2);
