const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, customer, paySig, stockOf } = require("./helpers");

let t, c;
test.before(async () => {
  t = await setup();
  c = t.client();
  assert.equal((await c.post("/api/admin/signin", { username: "admin", password: "admin-pass" })).status, 200);
});
test.after(() => t.close());
test.beforeEach(() => require("../lib/security").resetLimits());

const supplier = (over = {}) => ({ name: "AutoParts India", contactName: "Rahul", email: "orders@autoparts.example", phone: "9811111111",
  gstin: "29ABCDE1234F1Z5", address: "Peenya, Bengaluru", state: "Karnataka", paymentTerms: "Net 30", leadTimeDays: 5, ...over });

test("supplier APIs are admin-only", async () => {
  const anon = t.client();
  for (const p of ["/api/admin/suppliers", "/api/admin/purchase-orders", "/api/admin/reorder", "/api/admin/purchase-orders/1/print"]) assert.equal((await anon.get(p)).status, 401, p);
  assert.equal((await anon.post("/api/admin/suppliers", supplier())).status, 401);
});

test("suppliers are validated, unique by name, and editable", async () => {
  assert.equal((await c.post("/api/admin/suppliers", supplier({ name: "" }))).status, 400);
  assert.equal((await c.post("/api/admin/suppliers", supplier({ gstin: "BADGSTIN" }))).status, 400);
  assert.equal((await c.post("/api/admin/suppliers", supplier({ state: "Atlantis" }))).status, 400);
  const r = await c.post("/api/admin/suppliers", supplier());
  assert.equal(r.status, 200, r.text);
  assert.equal((await c.post("/api/admin/suppliers", supplier())).status, 409);
  const e = await c.put(`/api/admin/suppliers/${r.json.supplier.id}`, supplier({ leadTimeDays: 10 }));
  assert.equal(e.json.supplier.leadTimeDays, 10);
  assert.ok(t.fake.tables.audit_log.some((a) => a.action === "supplier created"));
});

test("products link to a supplier; supplier never reaches the public catalogue", async () => {
  const sid = t.fake.tables.suppliers[0].id;
  const p = (await c.get("/api/admin/products")).json.products.find((x) => x.id === 2);
  assert.equal((await c.put("/api/admin/products/2", { ...p, supplierId: 999 })).status, 400);
  const r = await c.put("/api/admin/products/2", { ...p, supplierId: sid, supplierSku: "AP-DC2K", costPrice: 4200 });
  assert.equal(r.status, 200, r.text);
  const pub = (await t.client().get("/api/catalog")).json.products.find((x) => x.id === 2);
  assert.ok(!("supplierId" in pub) && !("supplierSku" in pub) && !("costPrice" in pub));
  const csv = await c.get("/api/admin/products.csv");
  assert.match(csv.text, /"AutoParts India","AP-DC2K"/);
});

test("purchase order: create, send by email, receive in parts, stock and cost update", async () => {
  const sid = t.fake.tables.suppliers[0].id, before = stockOf(t.fake, 2), sentBefore = t.sent.length;
  assert.equal((await c.post("/api/admin/purchase-orders", { supplierId: sid, lines: [] })).status, 400);
  assert.equal((await c.post("/api/admin/purchase-orders", { supplierId: sid, lines: [{ productId: 2, qty: 0 }] })).status, 400);
  const r = await c.post("/api/admin/purchase-orders", { supplierId: sid, lines: [{ productId: 2, qty: 10, cost: 4000 }, { productId: 3, qty: 5, cost: 1500 }], notes: "Urgent" });
  assert.equal(r.status, 200, r.text);
  const po = r.json.order;
  assert.match(po.poNo, /^PO-\d{4}-0001$/);
  assert.equal(po.total, 47500);
  assert.equal(po.items[0].supplierSku, "AP-DC2K");

  assert.equal((await c.post(`/api/admin/purchase-orders/${po.id}/receive`, { lines: [{ productId: 2, qty: 1 }] })).status, 400, "must be sent first");
  const s = await c.post(`/api/admin/purchase-orders/${po.id}/send`, {});
  assert.equal(s.status, 200); assert.equal(s.json.emailed, true);
  const mail = t.sent[sentBefore];
  assert.equal(mail.to, "orders@autoparts.example");
  assert.match(mail.html, /PO-\d{4}-0001/);
  assert.equal((await c.put(`/api/admin/purchase-orders/${po.id}`, { lines: [{ productId: 2, qty: 1, cost: 1 }] })).status, 400, "sent orders are locked");

  assert.equal((await c.post(`/api/admin/purchase-orders/${po.id}/receive`, { lines: [{ productId: 2, qty: 11 }] })).status, 400, "can't receive more than ordered");
  const p1 = await c.post(`/api/admin/purchase-orders/${po.id}/receive`, { lines: [{ productId: 2, qty: 6 }], updateCost: true });
  assert.equal(p1.json.order.status, "partially_received");
  assert.equal(stockOf(t.fake, 2), before + 6);
  assert.equal(t.fake.tables.products.find((x) => x.id === 2).cost_price, 4000);
  const p2 = await c.post(`/api/admin/purchase-orders/${po.id}/receive`, { lines: [{ productId: 2, qty: 4 }, { productId: 3, qty: 5 }] });
  assert.equal(p2.json.order.status, "received");
  assert.equal(stockOf(t.fake, 2), before + 10);
  assert.equal((await c.post(`/api/admin/purchase-orders/${po.id}/receive`, { lines: [{ productId: 2, qty: 1 }] })).status, 400);
  assert.ok(t.fake.tables.inventory_log.some((l) => l.ref === po.poNo && l.delta === 6));
  const print = await c.get(`/api/admin/purchase-orders/${po.id}/print`);
  assert.match(print.text, /Purchase order PO-/);
});

test("cancelling: drafts and sent orders only", async () => {
  const sid = t.fake.tables.suppliers[0].id;
  const po = (await c.post("/api/admin/purchase-orders", { supplierId: sid, lines: [{ productId: 5, qty: 3, cost: 500 }] })).json.order;
  assert.equal((await c.post(`/api/admin/purchase-orders/${po.id}/cancel`, {})).json.order.status, "cancelled");
  assert.equal((await c.post(`/api/admin/purchase-orders/${po.id}/send`, {})).status, 400);
});

test("reorder suggestions count sales, lead time and stock already on order", async () => {
  const sid = t.fake.tables.suppliers[0].id;
  t.fake.tables.products.find((x) => x.id === 9).stock = 2;
  t.fake.tables.products.find((x) => x.id === 9).supplier_id = sid;
  const shopper = t.client();
  const o = await shopper.post("/api/create-order", { cart: { 9: 1 }, customer: customer() });
  await shopper.post("/api/verify-payment", { razorpay_order_id: o.json.orderId, razorpay_payment_id: "pay_r", razorpay_signature: paySig(o.json.orderId, "pay_r") });
  let s = (await c.get("/api/admin/reorder")).json.suggestions.find((x) => x.productId === 9);
  assert.ok(s, "low-stock product is suggested");
  assert.equal(s.supplier, "AutoParts India");
  assert.equal(s.sold30, 1);
  assert.equal(s.stock, 1);
  const need = s.suggest;
  await c.post("/api/admin/purchase-orders", { supplierId: sid, lines: [{ productId: 9, qty: need, cost: 1000 }] });
  s = (await c.get("/api/admin/reorder")).json.suggestions.find((x) => x.productId === 9);
  assert.equal(s, undefined, "nothing more to order once it's on a purchase order");
});

test("supplier list shows product count, open orders and value received", async () => {
  const s = (await c.get("/api/admin/suppliers")).json.suppliers[0];
  assert.equal(s.products, 2);
  assert.ok(s.openOrders >= 1);
  assert.equal(s.received, 47500);
});
