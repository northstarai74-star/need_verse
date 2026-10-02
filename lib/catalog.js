// Builds the public catalogue: active products with fitment, real ratings from approved
// reviews and real sales numbers. Cached for a minute; admin changes clear the cache.
const db = require("../db");

const TTL = 60 * 1000;
let cache = null, cachedAt = 0, building = null;

const LIVE = (o) => o.status === "paid" || o.status === "cod";
const linesOf = (o) => o.items || Object.entries(o.cart || {}).map(([id, qty]) => ({ id: Number(id), qty }));

async function build() {
  const [products, fitment, reviews, orders, vehicles] = await Promise.all([
    db.listProducts(), db.listFitment(), db.listReviews({ status: "approved" }), db.listOrders(), db.listVehicles()
  ]);
  const fitBy = {}, rate = {}, sold = {}, pairs = {};
  for (const f of fitment) (fitBy[f.productId] ||= []).push({ make: f.make, model: f.model, yearFrom: f.yearFrom, yearTo: f.yearTo });
  for (const r of reviews) { const x = (rate[r.productId] ||= { sum: 0, n: 0 }); x.sum += r.rating; x.n++; }
  const since = Date.now() - 90 * 864e5;
  for (const o of orders) {
    if (!LIVE(o) || o.fulfillment === "cancelled") continue;
    const ids = linesOf(o).map((l) => l.id);
    if (new Date(o.createdAt).getTime() >= since) for (const l of linesOf(o)) sold[l.id] = (sold[l.id] || 0) + l.qty;
    for (const a of ids) for (const b of ids) if (a !== b) { const m = (pairs[a] ||= {}); m[b] = (m[b] || 0) + 1; }
  }
  const active = products.filter((p) => p.status === "active");
  const top = active.map((p) => [p.id, sold[p.id] || 0]).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  const activeIds = new Set(active.map((p) => p.id));
  const list = active.map((p) => {
    const r = rate[p.id];
    return {
      id: p.id, sku: p.sku, slug: p.slug, name: p.name, shortDesc: p.shortDesc, description: p.description, category: p.category, brand: p.brand,
      price: p.price, mrp: p.mrp && p.mrp > p.price ? p.mrp : null, gstRate: p.gstRate, hsn: p.hsn, icon: p.icon, images: p.images || [],
      videoUrl: p.videoUrl, specs: p.specs || {}, included: p.included, installDifficulty: p.installDifficulty, installGuide: p.installGuide,
      warranty: p.warranty, weightG: p.weightG, dims: p.dims, faqs: p.faqs || [], fitNotes: p.fitNotes, seoTitle: p.seoTitle, metaDesc: p.metaDesc,
      universal: p.universal, fitment: fitBy[p.id] || [], inStock: p.stock > 0, stockLeft: p.stock > 0 && p.stock <= p.lowStockAt ? p.stock : null,
      rating: r ? Math.round((r.sum / r.n) * 10) / 10 : null, reviewCount: r ? r.n : 0, sold: sold[p.id] || 0, bestSeller: top.includes(p.id),
      alsoBought: Object.entries(pairs[p.id] || {}).filter(([id]) => activeIds.has(Number(id))).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => Number(id)),
      updatedAt: p.updatedAt
    };
  });
  const makes = {};
  for (const v of vehicles) (makes[v.make] ||= {})[v.model] = [v.yearFrom, v.yearTo];
  return { products: list, vehicles: makes, byId: new Map(list.map((p) => [p.id, p])), bySlug: new Map(list.map((p) => [p.slug, p])) };
}

async function get() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  if (!building) building = build().then((c) => { cache = c; cachedAt = Date.now(); return c; }).finally(() => { building = null; });
  return building;
}
function invalidate() { cache = null; }

// Turns a browser cart {productId: qty} into priced lines from the database.
// Returns {lines} or {error}. Prices always come from here, never from the browser.
async function priceCart(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Your cart is empty or invalid." };
  const products = new Map((await db.listProducts()).map((p) => [p.id, p]));
  const lines = [];
  for (const [id, q] of Object.entries(input)) {
    const qty = Number(q), p = products.get(Number(id));
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return { error: "Each item can be ordered 1 to 20 at a time." };
    if (!p || p.status !== "active") return { error: "An item in your cart is no longer available. Please remove it and try again.", productId: Number(id) };
    lines.push({ id: p.id, sku: p.sku, name: p.name, qty, price: p.price, gstRate: p.gstRate, hsn: p.hsn, weightG: p.weightG, dims: p.dims, icon: p.icon, cost: p.costPrice ?? null });
  }
  if (!lines.length) return { error: "Your cart is empty or invalid." };
  return { lines };
}

module.exports = { get, invalidate, priceCart, linesOf };
