require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const Razorpay = require("razorpay");
const { STORE, byId, computeTotals } = require("./public/catalog.js");
const { sendOrderEmails, sendShippedEmail, sendRefundEmail, emailEnabled } = require("./mailer");
const db = require("./db");

const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, ADMIN_USER = "admin", ADMIN_PASSWORD, PORT = 3000 } = process.env;
if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error("\nMissing Razorpay keys. Copy .env.example to .env and fill in RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.\n");
  process.exit(1);
}

const rzp = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
const app = express();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Marks an order paid and sends the confirmation email. Called by both the browser callback and
// the webhook. The "claim" below is an atomic database update, so only one caller sends the email.
async function markPaid(orderId, paymentId, paidPaise) {
  const cur = await db.getOrder(orderId);
  if (!cur) return null;
  if (paidPaise != null && paidPaise !== Math.round(cur.amount * 100)) {
    console.error(`Amount mismatch for ${cur.ref}: paid ${paidPaise}, expected ${Math.round(cur.amount * 100)}`);
    return null;
  }
  let becamePaid, claimed;
  const o = await db.updateOrder(orderId, (x) => {
    becamePaid = false; claimed = false;
    if (x.status !== "paid") { x.status = "paid"; x.paymentId = paymentId; x.paidAt = new Date().toISOString(); becamePaid = true; }
    if (!x.emailSent) { x.emailSent = true; claimed = true; }
    if (!becamePaid && !claimed) return false;
  });
  if (becamePaid) console.log(`PAID ${o.ref}  ${o.currency} ${o.amount}  ${o.customer.name} <${o.customer.email}>`);
  if (claimed) {
    try {
      if (!(await sendOrderEmails(o))) throw new Error("email not configured");
    } catch (err) {
      console.error("Order email not sent for", o.ref, "-", err.message);
      await db.updateOrder(orderId, (x) => { x.emailSent = false; });
    }
  }
  return o;
}

// ---------- Refund bookkeeping ----------
const round2 = (n) => Math.round(n * 100) / 100;
function upsertRefund(o, entity, reason) {
  o.refunds = o.refunds || [];
  let x = o.refunds.find((r) => r.id === entity.id);
  if (!x) { x = { id: entity.id, createdAt: new Date().toISOString(), reason: reason || entity.notes?.reason || "" }; o.refunds.push(x); }
  x.amount = entity.amount / 100;
  x.status = entity.status; // pending | processed | failed
  o.refunded = round2(o.refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount, 0));
  return x;
}
// Emails the customer once per refund (claimed atomically, so two events can't double-send).
async function notifyRefund(orderId, refundId) {
  let claimed = false;
  const o = await db.updateOrder(orderId, (x) => {
    claimed = false;
    const r = x.refunds.find((y) => y.id === refundId);
    if (!r || r.emailed) return false;
    r.emailed = true; claimed = true;
  });
  if (!claimed) return;
  const r = o.refunds.find((y) => y.id === refundId);
  try {
    if (!(await sendRefundEmail(o, r))) throw new Error("email not configured");
  } catch (err) {
    console.error("Refund email not sent for", o.ref, "-", err.message);
    await db.updateOrder(orderId, (x) => { const f = x.refunds.find((y) => y.id === refundId); if (f) f.emailed = false; });
  }
}

// Razorpay -> server confirmation. Works even if the shopper closes the tab after paying.
app.post("/api/razorpay-webhook", express.raw({ type: "*/*", limit: "200kb" }), async (req, res) => {
  if (!RAZORPAY_WEBHOOK_SECRET) return res.status(503).send("Webhook secret not configured");
  const sig = req.get("x-razorpay-signature") || "";
  const expected = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(req.body).digest("hex");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)))
    return res.status(400).send("Bad signature");
  try {
    const evt = JSON.parse(req.body.toString("utf8"));
    if (evt.event === "payment.captured" || evt.event === "order.paid") {
      const pay = evt.payload?.payment?.entity;
      if (pay?.order_id) await markPaid(pay.order_id, pay.id, pay.amount);
    }
    // Keeps refunds in sync, including ones started from the Razorpay Dashboard.
    if (["refund.created", "refund.processed", "refund.failed"].includes(evt.event)) {
      const ref = evt.payload?.refund?.entity;
      const found = ref?.payment_id ? await db.findByPaymentId(ref.payment_id) : null;
      if (found) {
        await db.updateOrder(found.orderId, (x) => { upsertRefund(x, ref, ""); });
        if (ref.status !== "failed") await notifyRefund(found.orderId, ref.id);
        else console.error(`REFUND FAILED ${found.ref}: ${ref.id}`);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("webhook:", err);
    res.status(500).send("error"); // Razorpay will retry
  }
});

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Validate the cart coming from the browser; prices are never taken from the client.
function cleanCart(input) {
  const cart = {};
  if (!input || typeof input !== "object") return null;
  for (const [id, q] of Object.entries(input)) {
    const qty = Number(q);
    if (!byId(Number(id)) || !Number.isInteger(qty) || qty < 1 || qty > 50) return null;
    cart[id] = qty;
  }
  return Object.keys(cart).length ? cart : null;
}

app.post("/api/create-order", wrap(async (req, res) => {
  const cart = cleanCart(req.body.cart);
  if (!cart) return res.status(400).json({ error: "Your cart is empty or invalid." });
  const promo = typeof req.body.promo === "string" && STORE.promos[req.body.promo] ? req.body.promo : null;
  const c = req.body.customer || {};
  if (!c.name || !c.email || !c.phone || !c.addr || !c.city || !c.zip)
    return res.status(400).json({ error: "Please fill in all checkout details." });
  const clip = (v, n) => String(v).trim().slice(0, n);

  const t = computeTotals(cart, promo);
  const amount = Math.round(t.total * 100); // paise
  const ref = "NV-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const order = await rzp.orders.create({
    amount, currency: STORE.currency, receipt: ref,
    notes: { ref, name: clip(c.name, 60), email: clip(c.email, 80) }
  });

  await db.insertOrder(order.id, {
    ref, status: "created", amount: t.total, currency: STORE.currency, cart, promo,
    customer: { name: clip(c.name, 100), email: clip(c.email, 120), phone: clip(c.phone, 20), addr: clip(c.addr, 200), city: clip(c.city, 80), zip: clip(c.zip, 12) },
    vehicle: req.body.vehicle && typeof req.body.vehicle === "object"
      ? { make: clip(req.body.vehicle.make ?? "", 40), model: clip(req.body.vehicle.model ?? "", 40), year: clip(req.body.vehicle.year ?? "", 4) } : null
  });

  res.json({ key: RAZORPAY_KEY_ID, orderId: order.id, amount, currency: STORE.currency, ref });
}));

app.post("/api/verify-payment", wrap(async (req, res) => {
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
  if (typeof oid !== "string" || typeof pid !== "string" || typeof sig !== "string")
    return res.status(400).json({ error: "Missing payment details." });

  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(oid + "|" + pid).digest("hex");
  const ok = expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!ok) return res.status(400).json({ error: "Payment verification failed." });

  const o = await markPaid(oid, pid);
  if (!o) return res.status(404).json({ error: "Order not found." });
  res.json({ ref: o.ref, amount: o.amount });
}));

// ---------- Admin (orders page) ----------
// Protected with HTTP Basic auth. Disabled unless ADMIN_PASSWORD is set.
const same = (a, b) => { const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send("Admin is disabled. Set ADMIN_PASSWORD in .env.");
  const [scheme, token] = (req.get("authorization") || "").split(" ");
  const [u, ...p] = scheme === "Basic" && token ? Buffer.from(token, "base64").toString().split(":") : [];
  if (u !== undefined && same(u, ADMIN_USER) && same(p.join(":"), ADMIN_PASSWORD)) return next();
  res.set("WWW-Authenticate", 'Basic realm="Nnedverse admin"').status(401).send("Login required");
}
const FULFIL = ["new", "packed", "shipped", "delivered", "cancelled"];

app.get("/admin", adminAuth, (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/admin-full", adminAuth, (req, res) => res.sendFile(path.join(__dirname, "admin-full.html")));
app.get("/api/admin/orders", adminAuth, wrap(async (req, res) => {
  const items = (await db.listOrders()).map((o) => ({
    ...o, lines: Object.entries(o.cart).map(([id, q]) => { const p = byId(Number(id)); return { name: p ? p.name : "Product " + id, qty: q, price: p ? p.price : 0 }; })
  }));
  res.json({ symbol: STORE.symbol, orders: items });
}));

app.post("/api/admin/orders/:id/fulfillment", adminAuth, wrap(async (req, res) => {
  const id = req.params.id;
  const { status, tracking } = req.body || {};
  if (!FULFIL.includes(status)) return res.status(400).json({ error: "Invalid status" });
  const cur = await db.getOrder(id);
  if (!cur) return res.status(404).json({ error: "Order not found" });
  if (cur.status !== "paid") return res.status(400).json({ error: "Only paid orders can be fulfilled" });
  if (status === "shipped" && cur.refunded >= cur.amount) return res.status(400).json({ error: "This order was fully refunded; it can't be shipped." });

  let track = null;
  if (status === "shipped" && tracking && typeof tracking === "object") {
    const clip = (v, n) => String(v ?? "").trim().slice(0, n);
    const url = clip(tracking.url, 300);
    if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Tracking link must start with http:// or https://" });
    track = { carrier: clip(tracking.carrier, 60), number: clip(tracking.number, 60), url };
  }

  // Save the status, and claim the one-time shipped email in the same atomic update.
  let claimed = false;
  const o = await db.updateOrder(id, (x) => {
    claimed = false;
    x.fulfillment = status;
    if (track) x.tracking = track;
    if (status === "shipped" && !x.shippedEmailSent) { x.shippedEmailSent = true; claimed = true; }
  });

  let emailed = false, emailError = null;
  if (claimed) {
    try {
      if (await sendShippedEmail(o)) emailed = true;
      else throw new Error("Email is not configured on the server (SMTP settings).");
    } catch (err) {
      console.error("Shipped email failed for", o.ref, err.message);
      emailError = err.message.startsWith("Email is not") ? err.message : "Could not send the email: " + err.message;
      await db.updateOrder(id, (x) => { x.shippedEmailSent = false; }); // so it can be retried
    }
  }
  res.json({ ok: true, emailed, emailError, alreadyEmailed: status === "shipped" && !claimed });
}));

// Refund through Razorpay. Omit "amount" for a full refund of whatever is left.
const refundLock = new Set(); // stops a double-click from sending two refunds
app.post("/api/admin/orders/:id/refund", adminAuth, wrap(async (req, res) => {
  const id = req.params.id;
  if (refundLock.has(id)) return res.status(409).json({ error: "A refund for this order is already in progress." });
  refundLock.add(id);
  try {
    const o = await db.getOrder(id);
    if (!o) return res.status(404).json({ error: "Order not found" });
    if (o.status !== "paid" || !o.paymentId) return res.status(400).json({ error: "Only paid orders can be refunded." });

    const remaining = Math.round(o.amount * 100) - Math.round((o.refunded || 0) * 100); // paise
    if (remaining <= 0) return res.status(400).json({ error: "This order is already fully refunded." });
    const raw = req.body?.amount;
    const paise = raw === undefined || raw === null || raw === "" ? remaining : Math.round(Number(raw) * 100);
    if (!Number.isFinite(paise) || paise < 100) return res.status(400).json({ error: `Enter an amount of at least ${STORE.symbol}1.` });
    if (paise > remaining) return res.status(400).json({ error: `You can refund at most ${STORE.symbol}${remaining / 100}.` });
    const reason = String(req.body?.reason || "").trim().slice(0, 200);

    let r;
    try {
      r = await rzp.payments.refund(o.paymentId, {
        amount: paise, speed: "normal",
        notes: { order: o.ref, reason }, receipt: `${o.ref}-R${o.refunds.length + 1}`
      });
    } catch (err) {
      console.error("refund:", err.error || err);
      return res.status(502).json({ error: err.error?.description || "Razorpay could not process the refund." });
    }

    let x;
    const saved = await db.updateOrder(id, (y) => {
      x = upsertRefund(y, r, reason);
      // A full refund on an order that hasn't left the warehouse cancels it.
      if (y.refunded >= y.amount && ["new", "packed"].includes(y.fulfillment)) y.fulfillment = "cancelled";
    });
    console.log(`REFUND ${o.ref}  ${STORE.symbol}${x.amount}  (${x.status})  ${reason}`);
    await notifyRefund(id, r.id);
    res.json({ ok: true, refund: x, refunded: saved.refunded });
  } finally { refundLock.delete(id); }
}));

app.get("/api/admin/orders.csv", adminAuth, wrap(async (req, res) => {
  const q = (v) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const rows = [["Ref", "Date", "Payment", "Fulfilment", "Total", "Refunded", "Name", "Email", "Phone", "Address", "City", "ZIP", "Items", "Payment ID"]];
  for (const o of await db.listOrders()) rows.push([o.ref, o.createdAt, o.status, o.fulfillment || "new", o.amount, o.refunded || 0, o.customer.name, o.customer.email, o.customer.phone, o.customer.addr, o.customer.city, o.customer.zip,
    Object.entries(o.cart).map(([id, n]) => `${byId(Number(id))?.name} x${n}`).join("; "), o.paymentId || ""]);
  res.type("text/csv").attachment("orders.csv").send(rows.map((r) => r.map(q).join(",")).join("\n"));
}));

// ---------- Admin (Products Management) ----------
app.get("/api/admin/products", adminAuth, wrap(async (req, res) => {
  const products = await db.listProducts();
  const withInventory = await Promise.all(products.map(async (p) => ({
    ...p, inventory: await db.getInventory(p.id)
  })));
  res.json({ symbol: STORE.symbol, products: withInventory });
}));

app.post("/api/admin/products", adminAuth, wrap(async (req, res) => {
  const { name, cat, price, rating, n, pop, icon, fits, desc, active } = req.body || {};
  if (!name || !cat) return res.status(400).json({ error: "Name and category are required" });
  const p = await db.createProduct({
    name, cat, price: Number(price) || 0, rating: Number(rating) || 4.5, n: Number(n) || 0,
    pop: Number(pop) || 50, icon, fits: fits || [], desc, active: active !== false
  });
  await db.updateInventory(p.id, 0, 0);
  res.json(p);
}));

app.put("/api/admin/products/:id", adminAuth, wrap(async (req, res) => {
  const { name, cat, price, rating, n, pop, icon, fits, desc, active } = req.body || {};
  const p = await db.updateProduct(Number(req.params.id), {
    name, cat, price: Number(price), rating: Number(rating), n: Number(n),
    pop: Number(pop), icon, fits, desc, active
  });
  if (!p) return res.status(404).json({ error: "Product not found" });
  res.json(p);
}));

app.delete("/api/admin/products/:id", adminAuth, wrap(async (req, res) => {
  await db.deleteProduct(Number(req.params.id));
  res.json({ ok: true });
}));

// ---------- Admin (Inventory Management) ----------
app.put("/api/admin/inventory/:productId", adminAuth, wrap(async (req, res) => {
  const { quantity, reserved, low_stock_alert } = req.body || {};
  const inv = await db.updateInventory(Number(req.params.productId), Number(quantity), Number(reserved));
  res.json(inv);
}));

// ---------- Admin (Coupon Management) ----------
app.get("/api/admin/coupons", adminAuth, wrap(async (req, res) => {
  const coupons = await db.listCoupons();
  res.json({ coupons });
}));

app.post("/api/admin/coupons", adminAuth, wrap(async (req, res) => {
  const { code, discount_percent, max_uses, active, expires_at } = req.body || {};
  if (!code || !discount_percent) return res.status(400).json({ error: "Code and discount are required" });
  const c = await db.createCoupon({
    code: code.toUpperCase(), discount_percent: Number(discount_percent),
    max_uses: max_uses ? Number(max_uses) : null, active: active !== false,
    expires_at: expires_at || null
  });
  res.json(c);
}));

app.put("/api/admin/coupons/:id", adminAuth, wrap(async (req, res) => {
  const { code, discount_percent, max_uses, active, expires_at } = req.body || {};
  const c = await db.updateCoupon(Number(req.params.id), {
    code: code ? code.toUpperCase() : undefined,
    discount_percent: discount_percent !== undefined ? Number(discount_percent) : undefined,
    max_uses: max_uses !== undefined ? (max_uses ? Number(max_uses) : null) : undefined,
    active, expires_at
  });
  if (!c) return res.status(404).json({ error: "Coupon not found" });
  res.json(c);
}));

// ---------- Admin (Customer Dashboard) ----------
app.get("/api/admin/customers", adminAuth, wrap(async (req, res) => {
  const customers = await db.listCustomers();
  res.json({ customers });
}));

app.get("/api/admin/customers/:email", adminAuth, wrap(async (req, res) => {
  const orders = (await db.listOrders()).filter(o => o.customer.email === req.params.email);
  res.json({ orders: orders.map(o => ({
    ref: o.ref, createdAt: o.createdAt, status: o.status, fulfillment: o.fulfillment,
    amount: o.amount, refunded: o.refunded || 0
  })) });
}));

// ---------- Admin (Analytics Dashboard) ----------
app.get("/api/admin/analytics", adminAuth, wrap(async (req, res) => {
  const orders = await db.listOrders();
  const paidOrders = orders.filter(o => o.status === "paid");

  const stats = {
    totalOrders: orders.length,
    paidOrders: paidOrders.length,
    totalRevenue: paidOrders.reduce((s, o) => s + (o.amount - (o.refunded || 0)), 0),
    avgOrderValue: paidOrders.length ? paidOrders.reduce((s, o) => s + o.amount, 0) / paidOrders.length : 0,
    totalRefunded: paidOrders.reduce((s, o) => s + (o.refunded || 0), 0),
    pendingOrders: orders.filter(o => o.fulfillment === "new").length,
    shippedOrders: paidOrders.filter(o => o.fulfillment === "shipped").length,
    deliveredOrders: paidOrders.filter(o => o.fulfillment === "delivered").length
  };

  // Top products
  const productSales = {};
  for (const o of paidOrders) {
    for (const [id, qty] of Object.entries(o.cart)) {
      const p = byId(Number(id));
      if (!p) continue;
      if (!productSales[id]) productSales[id] = { name: p.name, qty: 0, revenue: 0 };
      productSales[id].qty += qty;
      productSales[id].revenue += p.price * qty;
    }
  }
  const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // Orders over time (last 7 days)
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dailyOrders = {};
  for (let i = 0; i < 7; i++) {
    const date = new Date(sevenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    dailyOrders[date] = { orders: 0, revenue: 0 };
  }
  for (const o of paidOrders) {
    const date = o.createdAt.split("T")[0];
    if (dailyOrders[date]) {
      dailyOrders[date].orders += 1;
      dailyOrders[date].revenue += o.amount - (o.refunded || 0);
    }
  }

  res.json({ stats, topProducts, dailyOrders });
}));

// Anything that throws inside a route lands here. Customers never see internal details.
app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.path}:`, err.error || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: req.path === "/api/create-order" ? "Could not start payment. Please try again." : "Something went wrong. Please try again." });
});

db.check().then(() => {
  app.listen(PORT, () => {
    console.log(`Nnedverse running at http://localhost:${PORT}`);
    console.log(`Database: Supabase connected`);
    console.log(`Webhook:  ${RAZORPAY_WEBHOOK_SECRET ? "ready at /api/razorpay-webhook" : "NOT configured (set RAZORPAY_WEBHOOK_SECRET)"}`);
    console.log(`Admin:    ${ADMIN_PASSWORD ? `http://localhost:${PORT}/admin  (user: ${ADMIN_USER})` : "DISABLED (set ADMIN_PASSWORD)"}`);
    console.log(`Emails:   ${emailEnabled ? "enabled" : "NOT configured (set SMTP_* in .env)"}`);
  });
}).catch((err) => {
  console.error(`\nCannot start: ${err.message}\nSee .env.example and schema.sql for the Supabase setup.\n`);
  process.exit(1);
});
