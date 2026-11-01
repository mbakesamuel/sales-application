const Database = require("better-sqlite3");
const db = new Database("C:/Users/user/AppData/Roaming/sales-electron/sales.db", { readonly: true });
console.log(db.prepare("SELECT * FROM FinancialMonth").all());
console.log(db.prepare("SELECT * FROM FinancialYearPeriod").all());
