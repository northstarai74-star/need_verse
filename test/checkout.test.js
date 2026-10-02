const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, customer, paySig, webhookSig, stockOf } = require("./helpers");

let t;
test.before(async () => { t = await setup(); });
test.after(() => t.close());
test.beforeEach(() => require("../lib/security").resetLimits());

const pay = (c, o, pid = "pay_" + Math.random().toString(36).slice(2)) =>
  c.post("/api/verify-payment", { razorpay_order_id: o.orderId, razorpay_payment_id: pid, razorpay_signature: paySig(o.orderId, pid) });
const order = (c, extra = {}) => c.post("/api/create-order", { cart: { 2: 1 }, customer: customer(), ...extra });

test("catalogue lists active products with no made-up ratings", async () => {
  const r = await t.client().get("/api/catalog");
  assert.equal(r.status, 200);
  assert.equal(r.json.products.length, 18);
  assert.ok(r.json.products.every((p) => p.rating === null && p.reviewCount === 0 && p.bestSeller === false));
  assert.ok(r.json.vehicles["Hyundai"]["Creta"]);
  assert.ok(!("costPrice" in r.json.products[0]));
});

test("online order reserves stock, payment confirms it once, and assigns an invoice number", async () => {
  const c = t.client(), before = stockOf(t.fake, 2);
  const o = await order(c);
  assert.equal(o.status, 200, o.text);
  assert.equal(o.json.amount, 719900);
  assert.equal(stockOf(t.fake, 2), before - 1);
  const sentBefore = t.sent.length;
  const v = await pay(c, o.json, "pay_once");
  assert.equal(v.status, 200);
  assert.equal(t.sent.length, sentBefore + 2, "customer and owner emails");
  // The webhook for the same payment must not send again or double anything.
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { order_id: o.json.orderId, id: "pay_once", amount: 719900 } } } });
  const w = await c.post("/api/razorpay-webhook", body, { "x-razorpay-signature": webhookSig(body) });
  assert.equal(w.status, 200);
  assert.equal(t.sent.length, sentBefore + 2);
  const row = t.fake.tables.orders.find((x) => x.order_id === o.json.orderId);
  assert.equal(row.status, "paid");
  assert.match(row.invoice_no, /^NV\/\d{4}-\d{2}\/\d{5}$/);
  assert.equal(row.items[0].price, 7199);
  assert.equal(stockOf(t.fake, 2), before - 1);
});

test("a bad payment signature is rejected", async () => {
  const c = t.client(), o = await order(c);
  const r = await c.post("/api/verify-payment", { razorpay_order_id: o.json.orderId, razorpay_payment_id: "pay_x", razorpay_signature: "0".repeat(64) });
  assert.equal(r.status, 400);
});

test("webhook with a bad signature is rejected", async () => {
  const r = await t.client().post("/api/razorpay-webhook", "{}", { "x-razorpay-signature": "nope" });
  assert.equal(r.status, 400);
});

test("prices from the browser are ignored", async () => {
  const c = t.client();
  const o = await c.post("/api/create-order", { cart: { 2: 1 }, customer: customer(), amount: 1, price: 1, total: 1 });
  assert.equal(o.json.amount, 719900);
});

test("checkout validates state, PIN, phone and email", async () => {
  const c = t.client();
  for (const [bad, msg] of [[{ state: "Atlantis" }, /state/], [{ zip: "12345" }, /PIN/], [{ phone: "12345" }, /mobile/], [{ email: "nope" }, /email/]]) {
    const r = await c.post("/api/create-order", { cart: { 2: 1 }, customer: customer(bad) });
    assert.equal(r.status, 400); assert.match(r.json.error, msg);
  }
});

test("can't buy more than is in stock, and a failed checkout takes no stock", async () => {
  const c = t.client(), before = stockOf(t.fake, 16);
  const r = await c.post("/api/create-order", { cart: { 16: before + 1, 2: 1 }, customer: customer() });
  assert.equal(r.status, 409);
  assert.equal(r.json.productId, 16);
  assert.equal(stockOf(t.fake, 16), before);
});

test("two shoppers racing for the last unit: exactly one wins", async () => {
  t.fake.tables.products.find((p) => p.id === 12).stock = 1;
  const [a, b] = await Promise.all([t.client(), t.client()].map((c) => c.post("/api/create-order", { cart: { 12: 1 }, customer: customer() })));
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(stockOf(t.fake, 12), 0);
});

test("invalid and expired coupons are refused; valid ones discount", async () => {
  const c = t.client();
  assert.equal((await order(c, { promo: "NOPE" })).status, 400);
  t.fake.tables.coupons.push({ code: "OLD", percent: 20, min_order: 0, max_uses: null, uses: 0, expires_at: "2020-01-01T00:00:00Z", active: true, created_at: "x" });
  assert.equal((await order(c, { promo: "OLD" })).status, 400);
  const ok = await order(c, { promo: "SAVE10" });
  assert.equal(ok.json.amount, Math.round(7199 * 0.9 * 100));
});

test("cash on delivery: confirmed straight away, fee added, limit enforced", async () => {
  const c = t.client(), sentBefore = t.sent.length;
  const r = await c.post("/api/create-order", { cart: { 5: 1 }, customer: customer(), method: "cod" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.cod, true);
  assert.equal(r.json.amount, 1439 + 49 + 0 + (1439 >= 999 ? 0 : 99));
  const row = t.fake.tables.orders.find((x) => x.ref === r.json.ref);
  assert.equal(row.status, "cod");
  assert.ok(row.invoice_no);
  assert.equal(t.sent.length, sentBefore + 2);
  const big = await c.post("/api/create-order", { cart: { 17: 1 }, customer: customer(), method: "cod" });
  assert.equal(big.status, 400);
  assert.match(big.json.error, /up to/);
});

test("COD order delivered counts as paid; can then be refunded manually", async () => {
  const c = t.client();
  const r = await c.post("/api/create-order", { cart: { 14: 1 }, customer: customer(), method: "cod" });
  const id = t.fake.tables.orders.find((x) => x.ref === r.json.ref).order_id;
  const orders = require("../lib/orders");
  await orders.setFulfillment(id, "packed", "test");
  await orders.setFulfillment(id, "shipped", "test");
  await orders.setFulfillment(id, "delivered", "test");
  const row = t.fake.tables.orders.find((x) => x.order_id === id);
  assert.equal(row.status, "paid");
  assert.ok(row.delivered_at);
  const out = await orders.refund(id, 100, "partial", "test", null);
  assert.match(out.refund.id, /^manual_/);
  assert.equal(out.refunded, 100);
});

test("fulfilment only moves along allowed steps", async () => {
  const c = t.client(), o = await order(c);
  await pay(c, o.json);
  const orders = require("../lib/orders");
  await assert.rejects(orders.setFulfillment(o.json.orderId, "delivered", "test"), /can't be moved/);
  await orders.setFulfillment(o.json.orderId, "packed", "test");
  await orders.setFulfillment(o.json.orderId, "shipped", "test", { tracking: { carrier: "Delhivery", number: "123", url: "" } });
  await assert.rejects(orders.setFulfillment(o.json.orderId, "cancelled", "test"), /can't be moved/);
});

test("unpaid checkouts expire, release stock and send one abandoned-cart email", async () => {
  const c = t.client(), before = stockOf(t.fake, 3);
  const o = await c.post("/api/create-order", { cart: { 3: 2 }, customer: customer({ email: "leaver@example.com" }) });
  assert.equal(stockOf(t.fake, 3), before - 2);
  t.fake.tables.orders.find((x) => x.order_id === o.json.orderId).created_at = new Date(Date.now() - 3600e3).toISOString();
  const orders = require("../lib/orders");
  await orders.expireStale();
  await orders.expireStale();
  assert.equal(stockOf(t.fake, 3), before);
  const row = t.fake.tables.orders.find((x) => x.order_id === o.json.orderId);
  assert.equal(row.status, "expired");
  const mails = t.sent.filter((m) => m.to === "leaver@example.com");
  assert.equal(mails.length, 1);
  assert.match(mails[0].html, /restore=/);
});

test("payment arriving after expiry re-takes stock, or flags the order if it's gone", async () => {
  const c = t.client(), orders = require("../lib/orders");
  const o = await c.post("/api/create-order", { cart: { 6: 1 }, customer: customer() });
  t.fake.tables.orders.find((x) => x.order_id === o.json.orderId).created_at = new Date(Date.now() - 3600e3).toISOString();
  await orders.expireStale();
  const before = stockOf(t.fake, 6);
  await pay(c, o.json);
  assert.equal(stockOf(t.fake, 6), before - 1);

  const o2 = await c.post("/api/create-order", { cart: { 6: 1 }, customer: customer() });
  t.fake.tables.orders.find((x) => x.order_id === o2.json.orderId).created_at = new Date(Date.now() - 3600e3).toISOString();
  await orders.expireStale();
  t.fake.tables.products.find((p) => p.id === 6).stock = 0;
  await pay(c, o2.json);
  const row = t.fake.tables.orders.find((x) => x.order_id === o2.json.orderId);
  assert.equal(row.status, "paid");
  assert.equal(row.stock_issue, true);
  t.fake.tables.products.find((p) => p.id === 6).stock = 10;
});

test("full refund before shipping cancels the order and restocks", async () => {
  const c = t.client(), before = stockOf(t.fake, 7);
  const o = await c.post("/api/create-order", { cart: { 7: 1 }, customer: customer() });
  await pay(c, o.json, "pay_refundme");
  assert.equal(stockOf(t.fake, 7), before - 1);
  const orders = require("../lib/orders");
  const out = await orders.refund(o.json.orderId, null, "test", "test", { payments: { refund: async (pid, x) => ({ id: "rfnd_1", amount: x.amount, status: "processed", notes: x.notes }) } });
  assert.equal(out.order.fulfillment, "cancelled");
  assert.equal(stockOf(t.fake, 7), before);
  await assert.rejects(orders.refund(o.json.orderId, null, "", "test", null), /already fully refunded/);
});

test("customer cancels with the tracking token: paid order refunded automatically", async () => {
  const c = t.client(), o = await order(c);
  const v = await pay(c, o.json, "pay_cancelme");
  const before = t.rzpCalls.refunds.length;
  const r = await c.post(`/api/orders/${o.json.ref}/cancel`, { token: v.json.trackToken });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.fulfillment, "cancelled");
  assert.equal(t.rzpCalls.refunds.length, before + 1);
  const bad = await t.client().post(`/api/orders/${o.json.ref}/cancel`, { token: "x".repeat(32) });
  assert.equal(bad.status, 404);
});

test("order tracking needs the matching email or a signed link", async () => {
  const c = t.client(), o = await order(c);
  const v = await pay(c, o.json);
  assert.equal((await c.post("/api/track", { ref: o.json.ref, email: "someone@else.com" })).status, 404);
  const ok = await c.post("/api/track", { ref: o.json.ref, email: "AARAV@example.com" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.order.ref, o.json.ref);
  assert.ok(!("orderId" in ok.json.order) && !("anonId" in ok.json.order));
  assert.equal((await t.client().get(`/api/track/${o.json.ref}?t=${v.json.trackToken}`)).status, 200);
  assert.equal((await t.client().get(`/api/track/${o.json.ref}?t=${"a".repeat(32)}`)).status, 404);
});

test("invoice needs a signed link and shows GST", async () => {
  const c = t.client(), o = await order(c);
  await pay(c, o.json);
  const row = t.fake.tables.orders.find((x) => x.order_id === o.json.orderId);
  const { links } = require("../lib/orders");
  const url = new URL(links({ ref: row.ref }).invoice);
  const r = await t.client().get(url.pathname + url.search);
  assert.equal(r.status, 200);
  assert.match(r.text, /Tax Invoice/);
  assert.match(r.text, /CGST/, "same-state order splits CGST/SGST");
  assert.equal((await t.client().get(url.pathname)).status, 404);
});

test("delivery check validates PIN codes", async () => {
  const c = t.client();
  assert.equal((await c.get("/api/shipping/check?pin=560038")).json.ok, true);
  assert.equal((await c.get("/api/shipping/check?pin=12")).json.ok, false);
});

test("quote matches what checkout charges", async () => {
  const c = t.client();
  const q = await c.post("/api/quote", { cart: { 15: 1, 14: 1, 13: 1 }, promo: "SAVE10" });
  const o = await c.post("/api/create-order", { cart: { 15: 1, 14: 1, 13: 1 }, promo: "SAVE10", customer: customer() });
  assert.equal(Math.round(q.json.totals.total * 100), o.json.amount);
});
