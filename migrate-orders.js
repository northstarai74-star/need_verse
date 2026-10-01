// One-time: copies orders from the old server-data/orders.json into Supabase.
// Safe to run twice; orders that already exist are skipped.
//   node migrate-orders.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("./db");

(async () => {
  const file = path.join(__dirname, "server-data", "orders.json");
  if (!fs.existsSync(file)) return console.log("No server-data/orders.json found. Nothing to migrate.");
  await db.check();
  const orders = JSON.parse(fs.readFileSync(file, "utf8"));
  const ids = Object.keys(orders);
  let n = 0;
  for (const id of ids) { await db.importOrder(id, orders[id]); n++; }
  console.log(`Imported ${n} order(s) into Supabase. You can keep server-data/orders.json as a backup.`);
})().catch((e) => { console.error("Migration failed:", e.message); process.exit(1); });
