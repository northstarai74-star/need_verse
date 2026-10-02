// Loads the starter data from seed/data.js (car models and coupons). Safe to run again:
// existing products, coupons and stock levels are left alone; vehicles are added or updated.
//   npm run seed
require("dotenv").config();
const db = require("./db");

async function seed(data = require("./seed/data")) {
  const { products, vehicles, coupons } = data;
  await db.check();
  const existing = new Set((await db.listProducts()).map((p) => p.id));
  let added = 0;
  for (const p of products) {
    if (existing.has(p.id)) continue;
    const { makes, short_desc, install_difficulty, fit_notes, ...rest } = p;
    await db.insertProduct({
      ...rest, shortDesc: short_desc, description: short_desc, installDifficulty: install_difficulty || "Easy", fitNotes: fit_notes || "",
      stock: 10, status: "active", gstRate: 18
    });
    await db.setFitment(p.id, makes.map((make) => ({ make, model: null, yearFrom: null, yearTo: null })));
    added++;
  }
  if (products.length) await db.syncProductSeq();

  const rows = [];
  for (const [make, models] of Object.entries(vehicles))
    for (const [model, [yearFrom, yearTo]] of Object.entries(models)) rows.push({ make, model, yearFrom, yearTo });
  await db.upsertVehicles(rows);

  let cAdded = 0;
  for (const c of coupons) {
    if (await db.getCoupon(c.code)) continue;
    await db.upsertCoupon({ code: c.code, percent: c.percent, minOrder: c.min_order, active: true });
    cAdded++;
  }
  return { added, vehicles: rows.length, coupons: cAdded };
}

if (require.main === module) {
  seed().then((r) => console.log(`Seeded: ${r.added} new product(s), ${r.vehicles} vehicle model(s), ${r.coupons} new coupon(s).`))
    .catch((e) => { console.error("Seed failed:", e.message); process.exit(1); });
}
module.exports = seed;
