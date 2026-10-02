const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, customer, paySig, stockOf } = require("./helpers");
const { totp, newTotpSecret, resetLimits } = require("../lib/security");

let t;
test.before(async () => { t = await setup(); });
test.after(() => t.close());
test.beforeEach(() => { resetLimits(); delete process.env.ADMIN_TOTP_SECRET; });

async function admin() {
  const c = t.client();
  const r = await c.post("/api/admin/signin", { username: "admin", password: "admin-pass" });
  assert.equal(r.status, 200, r.text);
  return c;
}
const basic = { Authorization: "Basic " + Buffer.from("admin:admin-pass").toString("base64") };

const ADMIN_GETS = ["/api/admin/status", "/api/admin/orders", "/api/admin/orders.csv", "/api/admin/products", "/api/admin/products.csv", "/api/admin/inventory",
  "/api/admin/vehicles", "/api/admin/customers", "/api/admin/subscribers.csv", "/api/admin/coupons", "/api/admin/reviews", "/api/admin/returns", "/api/admin/analytics", "/api/admin/audit"];

test("every admin API refuses anonymous and customer sessions", async () => {
  const anon = t.client(), cust = t.client();
  await cust.post("/api/account/register", { name: "Sneaky", email: "sneaky@example.com", password: "longpassword1" });
  for (const p of ADMIN_GETS) {
    assert.equal((await anon.get(p)).status, 401, p);
    assert.equal((await cust.get(p)).status, 401, p);
  }
  assert.equal((await anon.post("/api/admin/products", { name: "x" })).status, 401);
  assert.equal((await anon.post("/api/admin/orders/x/refund", {})).status, 401);
  assert.equal((await anon.get("/admin")).text.includes("Admin sign in") || (await anon.get("/admin")).text.includes("Sign in"), true);
  assert.ok(!(await anon.get("/admin")).text.includes("/api/admin/orders.csv"));
});

test("wrong admin password is refused and audited", async () => {
  const r = await t.client().post("/api/admin/signin", { username: "admin", password: "nope" });
  assert.equal(r.status, 401);
  assert.ok(t.fake.tables.audit_log.some((a) => a.action === "admin sign-in failed"));
});

test("with 2FA on: code required, Basic auth no longer accepted", async () => {
  process.env.ADMIN_TOTP_SECRET = newTotpSecret();
  assert.equal((await t.client().get("/api/admin/orders", basic)).status, 401);
  const r = await t.client().post("/api/admin/signin", { username: "admin", password: "admin-pass" });
  assert.equal(r.status, 401); assert.equal(r.json.needCode, true);
  assert.equal((await t.client().post("/api/admin/signin", { username: "admin", password: "admin-pass", code: "000000" })).status, 401);
  const c = t.client();
  assert.equal((await c.post("/api/admin/signin", { username: "admin", password: "admin-pass", code: totp(process.env.ADMIN_TOTP_SECRET) })).status, 200);
  assert.equal((await c.get("/api/admin/orders")).status, 200);
});

test("without 2FA, Basic auth works for scripts", async () => {
  assert.equal((await t.client().get("/api/admin/orders", basic)).status, 200);
});

test("cross-site and non-JSON writes are blocked", async () => {
  const c = await admin();
  assert.equal((await c.post("/api/admin/coupons", { code: "EVIL", percent: 50 }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await c.post("/api/admin/coupons", "code=EVIL&percent=50", { "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
});

test("product create/edit validates, records fitment and audits changes", async () => {
  const c = await admin();
  assert.equal((await c.post("/api/admin/products", { name: "X", sku: "bad sku!", category: "Interior", price: 10 })).status, 400);
  assert.equal((await c.post("/api/admin/products", { name: "X", sku: "NV-INT-001", category: "Interior", price: 10 })).status, 400, "duplicate SKU");
  assert.equal((await c.post("/api/admin/products", { name: "X", sku: "NEW-1", category: "Interior", price: 10, status: "active" })).status, 400, "active needs fitment");
  assert.equal((await c.post("/api/admin/products", { name: "X", sku: "NEW-1", category: "Interior", price: 10, fitment: [{ make: "Nope" }] })).status, 400);
  const r = await c.post("/api/admin/products", { name: "Creta Floor Mats", sku: "NV-INT-100", category: "Interior", price: 3499, mrp: 3999, costPrice: 1800, gstRate: 18,
    status: "active", stock: 12, fitment: [{ make: "Hyundai", model: "Creta", yearFrom: 2020, yearTo: 2026 }], specs: { Material: "TPE" }, faqs: [{ q: "Smell?", a: "No" }] });
  assert.equal(r.status, 200, r.text);
  const id = r.json.product.id;
  assert.ok(id > 18, "id counter moved past seeded products");
  assert.equal(stockOf(t.fake, id), 12);
  const cat = (await t.client().get("/api/catalog")).json.products.find((p) => p.id === id);
  assert.ok(cat && cat.mrp === 3999 && cat.fitment[0].model === "Creta" && !("costPrice" in cat));
  const e = await c.put(`/api/admin/products/${id}`, { ...r.json.product, price: 3299, fitment: [{ make: "Hyundai", model: "Creta" }] });
  assert.equal(e.status, 200, e.text);
  assert.ok(t.fake.tables.audit_log.some((a) => a.action === "product updated" && a.details.price.to === 3299));
  const page = await t.client().get(`/p/creta-floor-mats`);
  assert.equal(page.status, 200);
  assert.match(page.text, /"@type":"Product"/);
  assert.match(page.text, /3,299/);
});

test("stock adjustments can't go negative and are logged", async () => {
  const c = await admin(), before = stockOf(t.fake, 4);
  assert.equal((await c.post("/api/admin/products/4/stock", { delta: -(before + 1) })).status, 400);
  assert.equal((await c.post("/api/admin/products/4/stock", { delta: 5, reason: "restock" })).json.stock, before + 5);
  const log = (await c.get("/api/admin/inventory?product=4")).json.log;
  assert.equal(log[0].delta, 5);
});

test("CSV import updates by SKU, sets stock, and reports bad rows", async () => {
  const c = await admin();
  const csv = 'sku,name,category,price,stock,status,fits\nNV-INT-001,"All-Weather Floor Mats, 4 pc",Interior,4199,25,active,Hyundai:Creta:2020:2026|Tata:*\nNEW-CSV-1,Seat Gap Filler,Interior,499,40,active,\nBAD-1,Thing,NotACategory,10,1,draft,';
  const r = await c.post("/api/admin/products/import", { csv });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.results.map((x) => x.ok || "error"), ["updated", "error", "error"]);
  const p = t.fake.tables.products.find((x) => x.sku === "NV-INT-001");
  assert.equal(p.name, "All-Weather Floor Mats, 4 pc");
  assert.equal(p.stock, 25);
  assert.equal(t.fake.tables.product_fitment.filter((f) => f.product_id === p.id).length, 2);
});

test("coupons can be created and are then usable at checkout", async () => {
  const c = await admin();
  assert.equal((await c.post("/api/admin/coupons", { code: "DIWALI", percent: 95 })).status, 400);
  assert.equal((await c.post("/api/admin/coupons", { code: "DIWALI", percent: 15, minOrder: 1000, maxUses: 1 })).status, 200);
  const shopper = t.client();
  const o = await shopper.post("/api/create-order", { cart: { 2: 1 }, promo: "DIWALI", customer: customer() });
  assert.equal(o.json.amount, Math.round(7199 * 0.85 * 100));
  await shopper.post("/api/verify-payment", { razorpay_order_id: o.json.orderId, razorpay_payment_id: "pay_dw", razorpay_signature: paySig(o.json.orderId, "pay_dw") });
  assert.equal(t.fake.tables.coupons.find((x) => x.code === "DIWALI").uses, 1);
  assert.equal((await shopper.post("/api/create-order", { cart: { 2: 1 }, promo: "DIWALI", customer: customer() })).status, 400, "max uses reached");
});

test("vehicles can be added and show up in the catalogue", async () => {
  const c = await admin();
  assert.equal((await c.post("/api/admin/vehicles", { make: "Kia", model: "Syros", yearFrom: 2025, yearTo: 2026 })).status, 200);
  assert.equal((await c.post("/api/admin/vehicles", { make: "Kia", model: "X", yearFrom: 2030, yearTo: 2020 })).status, 400);
  assert.ok((await t.client().get("/api/catalog")).json.vehicles.Kia.Syros);
});

test("orders list, CSV export escapes formulas, analytics and customers compute", async () => {
  const c = await admin(), shopper = t.client();
  const o = await shopper.post("/api/create-order", { cart: { 5: 2 }, customer: customer({ name: "=HYPERLINK(1)" }) });
  await shopper.post("/api/verify-payment", { razorpay_order_id: o.json.orderId, razorpay_payment_id: "pay_an", razorpay_signature: paySig(o.json.orderId, "pay_an") });
  await shopper.post("/api/events", { events: [{ name: "page_view", anonId: "a1" }, { name: "purchase", anonId: "a1" }, { name: "evil", anonId: "a1" }] });
  const list = await c.get("/api/admin/orders");
  assert.ok(list.json.orders.some((x) => x.ref === o.json.ref && x.lines[0].name));
  const csv = await c.get("/api/admin/orders.csv");
  assert.match(csv.text, /"'=HYPERLINK\(1\)"/);
  const a = await c.get("/api/admin/analytics?days=30");
  assert.ok(a.json.revenue > 0 && a.json.orders > 0 && a.json.series.length >= 30);
  assert.equal(a.json.funnel.find((f) => f.name === "page_view").visitors, 1);
  assert.ok(!t.fake.tables.events.some((e) => e.name === "evil"));
  const cs = await c.get("/api/admin/customers");
  assert.ok(cs.json.customers.some((x) => x.email === "aarav@example.com" && x.orders >= 1));
});

test("review moderation changes what shoppers see", async () => {
  const c = await admin();
  t.fake.tables.customers.push({ id: "11111111-1111-1111-1111-111111111111", email: "r@x.com", name: "R", password_hash: "x", addresses: [], garage: [], wishlist: [] });
  t.fake.tables.reviews.push({ id: 900, product_id: 3, customer_id: "11111111-1111-1111-1111-111111111111", order_ref: "NV-1", author: "R.", rating: 2, title: "Meh", body: "Loose fit", status: "pending", helpful: 0, reports: 0, created_at: new Date().toISOString() });
  assert.equal((await t.client().get("/api/products/3/reviews")).json.reviews.length, 0);
  assert.equal((await c.post("/api/admin/reviews/900", { status: "approved" })).status, 200);
  assert.equal((await t.client().get("/api/products/3/reviews")).json.reviews.length, 1);
  assert.equal((await t.client().get("/api/catalog")).json.products.find((p) => p.id === 3).rating, 2);
});
