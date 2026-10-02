const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { setup, customer, paySig, stockOf } = require("./helpers");

let t;
test.before(async () => { t = await setup(); });
test.after(() => t.close());
test.beforeEach(() => require("../lib/security").resetLimits());

async function signup(email = `u${crypto.randomBytes(3).toString("hex")}@example.com`) {
  const c = t.client();
  const r = await c.post("/api/account/register", { name: "Priya Nair", email, password: "longpassword1" });
  assert.equal(r.status, 200, r.text);
  return { c, email };
}
async function deliveredOrder(c, cart = { 1: 1 }) {
  const o = await c.post("/api/create-order", { cart, customer: customer() });
  const pid = "pay_" + crypto.randomBytes(3).toString("hex");
  await c.post("/api/verify-payment", { razorpay_order_id: o.json.orderId, razorpay_payment_id: pid, razorpay_signature: paySig(o.json.orderId, pid) });
  const orders = require("../lib/orders");
  for (const s of ["packed", "shipped", "delivered"]) await orders.setFulfillment(o.json.orderId, s, "test");
  return o.json;
}

test("register, sign out, sign in; wrong password and duplicate email refused", async () => {
  const { c, email } = await signup();
  assert.equal((await c.get("/api/session")).json.role, "customer");
  await c.post("/api/account/logout");
  assert.equal((await c.get("/api/session")).json.loggedIn, false);
  assert.equal((await c.post("/api/account/login", { email, password: "wrong" })).status, 401);
  assert.equal((await c.post("/api/account/login", { email: email.toUpperCase(), password: "longpassword1" })).status, 200);
  assert.equal((await t.client().post("/api/account/register", { name: "X", email, password: "longpassword1" })).status, 409);
  assert.equal((await t.client().post("/api/account/register", { name: "X", email: "new@x.com", password: "short" })).status, 400);
  const stored = t.fake.tables.customers.find((x) => x.email === email);
  assert.match(stored.password_hash, /^s1\$/);
});

test("sign-in attempts are rate limited", async () => {
  const c = t.client();
  let last;
  for (let i = 0; i < 11; i++) last = await c.post("/api/account/login", { email: "x@y.com", password: "nope" });
  assert.equal(last.status, 429);
});

test("password reset works once, with the emailed token only", async () => {
  const { email } = await signup();
  await t.client().post("/api/account/forgot", { email });
  const mail = t.sent.filter((m) => m.to === email).pop();
  const token = /reset=([\w-]+)/.exec(mail.html)[1];
  assert.equal((await t.client().post("/api/account/reset", { email, token: "wrong", password: "brandnewpass" })).status, 400);
  const c = t.client();
  assert.equal((await c.post("/api/account/reset", { email, token, password: "brandnewpass" })).status, 200);
  assert.equal((await c.get("/api/session")).json.email, email);
  assert.equal((await t.client().post("/api/account/reset", { email, token, password: "again12345" })).status, 400);
  // Unknown emails get the same answer.
  assert.equal((await t.client().post("/api/account/forgot", { email: "nobody@nowhere.com" })).status, 200);
});

test("garage only accepts real make/model/year combinations; wishlist only real products", async () => {
  const { c } = await signup();
  assert.equal((await c.put("/api/account/garage", { garage: [{ make: "Hyundai", model: "Creta", year: 2023 }] })).status, 200);
  assert.equal((await c.put("/api/account/garage", { garage: [{ make: "Hyundai", model: "Creta", year: 1990 }] })).status, 400);
  assert.equal((await c.put("/api/account/garage", { garage: [{ make: "Fake", model: "Car", year: 2023 }] })).status, 400);
  const w = await c.put("/api/account/wishlist", { wishlist: [1, 2, 999] });
  assert.deepEqual(w.json.wishlist, [1, 2]);
});

test("addresses are validated", async () => {
  const { c } = await signup();
  const good = { label: "Home", name: "Priya", phone: "9876543210", addr: "1 Road", city: "Kochi", state: "Kerala", zip: "682001" };
  assert.equal((await c.put("/api/account/addresses", { addresses: [good] })).status, 200);
  assert.equal((await c.put("/api/account/addresses", { addresses: [{ ...good, zip: "1" }] })).status, 400);
});

test("account APIs need a customer session", async () => {
  const c = t.client();
  assert.equal((await c.get("/api/account/orders")).status, 401);
  assert.equal((await c.put("/api/account/wishlist", { wishlist: [] })).status, 401);
});

test("customers only see their own orders", async () => {
  const a = await signup(), b = await signup();
  const o = await a.c.post("/api/create-order", { cart: { 3: 1 }, customer: customer() });
  await a.c.post("/api/verify-payment", { razorpay_order_id: o.json.orderId, razorpay_payment_id: "pay_mine", razorpay_signature: paySig(o.json.orderId, "pay_mine") });
  assert.equal((await a.c.get("/api/account/orders")).json.orders.length, 1);
  assert.equal((await b.c.get("/api/account/orders")).json.orders.length, 0);
  assert.equal((await b.c.get(`/api/track/${o.json.ref}`)).status, 404);
  assert.equal((await a.c.get(`/api/track/${o.json.ref}`)).status, 200);
});

test("reviews: only verified buyers after delivery, once each, shown only after approval", async () => {
  const { c } = await signup();
  assert.equal((await c.post("/api/account/reviews", { productId: 1, rating: 5 })).status, 403);
  await deliveredOrder(c, { 1: 1 });
  assert.equal((await c.post("/api/account/reviews", { productId: 1, rating: 9 })).status, 400);
  const r = await c.post("/api/account/reviews", { productId: 1, rating: 4, title: "Good fit", body: "Fits my car well" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "pending");
  assert.equal((await c.post("/api/account/reviews", { productId: 1, rating: 5 })).status, 409);
  assert.equal((await t.client().get("/api/products/1/reviews")).json.reviews.length, 0);
  const id = t.fake.tables.reviews[0].id;
  t.fake.tables.reviews[0].status = "approved";
  require("../lib/catalog").invalidate();
  const p = (await t.client().get("/api/catalog")).json.products.find((x) => x.id === 1);
  assert.equal(p.rating, 4);
  assert.equal(p.reviewCount, 1);
  for (let i = 0; i < 3; i++) await t.client().post(`/api/reviews/${id}/report`, {}, { "X-Forwarded-For": "1.1.1." + i });
  assert.equal(t.fake.tables.reviews[0].reports >= 1, true);
});

test("returns: delivered only, within window, quantities checked, photos checked, restock on receipt", async () => {
  const { c } = await signup();
  const o = await deliveredOrder(c, { 8: 2 });
  const token = require("../lib/security").sign("track", o.ref);
  const path = `/api/orders/${o.ref}/returns`;
  assert.equal((await c.post(path, { token, items: [{ id: 8, qty: 3 }], reason: "No longer needed" })).status, 400);
  assert.equal((await c.post(path, { token, items: [{ id: 8, qty: 1 }], reason: "Damaged or defective" })).status, 400, "needs a photo");
  assert.equal((await c.post(path, { token, items: [{ id: 8, qty: 1 }], reason: "Damaged or defective", photos: ["data:image/png;base64,aGVsbG8="] })).status, 400, "not a real image");
  const png = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]).toString("base64");
  const r = await c.post(path, { token, items: [{ id: 8, qty: 1 }], reason: "Damaged or defective", photos: [png] });
  assert.equal(r.status, 200, r.text);
  assert.equal(Object.keys(t.fake.files).length, 1);
  assert.equal((await c.post(path, { token, items: [{ id: 8, qty: 2 }], reason: "No longer needed" })).status, 400, "only 1 left to return");

  const admin = t.client();
  assert.equal((await admin.post("/api/admin/signin", { username: "admin", password: "admin-pass" })).status, 200);
  const rid = r.json.return.id, before = stockOf(t.fake, 8);
  assert.equal((await admin.post(`/api/admin/returns/${rid}`, { status: "refunded" })).status, 400, "must be received first");
  assert.equal((await admin.post(`/api/admin/returns/${rid}`, { status: "approved" })).status, 200);
  assert.equal((await admin.post(`/api/admin/returns/${rid}`, { status: "received", restock: true })).status, 200);
  assert.equal(stockOf(t.fake, 8), before + 1);
  const ref = await admin.post(`/api/admin/returns/${rid}`, { status: "refunded" });
  assert.equal(ref.status, 200, ref.text);
  assert.equal(ref.json.return.refundAmount, 3599);
  const row = t.fake.tables.orders.find((x) => x.ref === o.ref);
  assert.equal(row.refunded, 3599);
  assert.equal(row.fulfillment, "delivered", "only half came back");

  const late = await deliveredOrder(c, { 9: 1 });
  t.fake.tables.orders.find((x) => x.ref === late.ref).delivered_at = new Date(Date.now() - 40 * 864e5).toISOString();
  const lr = await c.post(`/api/orders/${late.ref}/returns`, { token: require("../lib/security").sign("track", late.ref), items: [{ id: 9, qty: 1 }], reason: "No longer needed" });
  assert.equal(lr.status, 400);
  assert.match(lr.json.error, /window/);
});
