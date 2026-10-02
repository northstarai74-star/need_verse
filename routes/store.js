// Public storefront API: catalogue, pricing, delivery checks, checkout, payments,
// order tracking, returns, reviews, newsletter and analytics.
const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const Core = require("../public/core");
const catalog = require("../lib/catalog");
const orders = require("../lib/orders");
const shipping = require("../lib/shipping");
const returns = require("../lib/returns");
const invoice = require("../lib/invoice");
const { limiter, sign, checkSig, clip, validEmail, same } = require("../lib/security");
const { isAdmin } = require("../lib/auth");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, ...(e.extra || {}) });

// May this request see this order? Admin, the signed-in owner, or someone holding the order's tracking link.
const canSee = (req, o, token) => isAdmin(req) || (req.session?.role === "customer" && o.customerId === req.session.userId) || checkSig("track", o.ref, token);

// Raw-body webhooks. Mounted before the JSON parser.
function webhooks(ctx) {
  const r = express.Router();
  r.post("/api/razorpay-webhook", express.raw({ type: "*/*", limit: "200kb" }), async (req, res) => {
    if (!ctx.webhookSecret) return res.status(503).send("Webhook secret not configured");
    const sig = req.get("x-razorpay-signature") || "";
    const expected = crypto.createHmac("sha256", ctx.webhookSecret).update(req.body).digest("hex");
    if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return res.status(400).send("Bad signature");
    try {
      const evt = JSON.parse(req.body.toString("utf8"));
      if (evt.event === "payment.captured" || evt.event === "order.paid") {
        const pay = evt.payload?.payment?.entity;
        if (pay?.order_id) await orders.markPaid(pay.order_id, pay.id, pay.amount);
      }
      // Keeps refunds in sync, including ones started from the Razorpay Dashboard.
      if (["refund.created", "refund.processed", "refund.failed"].includes(evt.event)) {
        const ref = evt.payload?.refund?.entity;
        const found = ref?.payment_id ? await db.findByPaymentId(ref.payment_id) : null;
        if (found) {
          await db.updateOrder(found.orderId, (x) => { orders.upsertRefund(x, ref, ""); });
          if (ref.status !== "failed") await orders.notifyRefund(found.orderId, ref.id);
          else console.error(`REFUND FAILED ${found.ref}: ${ref.id}`);
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("webhook:", err);
      res.status(500).send("error"); // Razorpay will retry
    }
  });

  // Courier status updates from Shiprocket (Settings -> API -> Webhooks, with the token below).
  r.post("/api/shiprocket-webhook", express.json({ limit: "200kb" }), async (req, res) => {
    const want = process.env.SHIPROCKET_WEBHOOK_TOKEN;
    if (!want || !same(req.get("x-api-key") || "", want)) return res.status(401).send("Bad token");
    try {
      const b = req.body || {}, next = shipping.mapStatus(b.current_status || b.shipment_status);
      let o = b.order_id ? await db.getOrderByRef(String(b.order_id)) : null;
      if (!o && b.awb) o = (await db.listOrders()).find((x) => x.shipment?.awb === String(b.awb)) || null;
      if (o && next && next !== o.fulfillment) {
        await orders.setFulfillment(o.orderId, next, "courier", { note: clip(b.current_status, 80) }).catch((e) => console.log(`Courier update ignored for ${o.ref}: ${e.message}`));
      }
      res.json({ ok: true });
    } catch (err) { console.error("shiprocket webhook:", err); res.status(500).send("error"); }
  });
  return r;
}

function api(ctx) {
  const r = express.Router();

  r.get("/api/catalog", wrap(async (req, res) => {
    const c = await catalog.get();
    res.set("Cache-Control", "public, max-age=30");
    res.json({ store: Core.STORE, cats: Core.CATS, bundles: Core.BUNDLES, products: c.products, vehicles: c.vehicles,
      cod: process.env.COD_ENABLED !== "false", returnReasons: returns.REASONS });
  }));

  r.post("/api/quote", limiter("quote", 120, 60000), wrap(async (req, res) => {
    const q = await orders.quote({ cart: req.body.cart, promo: req.body.promo, cod: req.body.cod });
    if (q.error) return res.status(400).json({ error: q.error });
    res.json({ totals: q.totals, coupon: q.coupon, promoError: q.promoError, lines: q.lines.map(({ id, name, qty, price, icon }) => ({ id, name, qty, price, icon })) });
  }));

  r.get("/api/shipping/check", limiter("pin", 60, 60000), wrap(async (req, res) => {
    const weight = Math.min(50000, Math.max(100, Number(req.query.weight) || 500));
    res.json(await shipping.check(req.query.pin, weight, req.query.cod === "1"));
  }));

  r.post("/api/create-order", limiter("order", 15, 10 * 60000), wrap(async (req, res) => {
    try {
      const b = req.body || {};
      const out = await orders.createOrder({ ...b, customerId: req.session?.role === "customer" ? req.session.userId : null }, ctx.rzp);
      if (out.method === "cod")
        return res.json({ cod: true, ref: out.ref, amount: out.amount, eta: out.eta, trackToken: sign("track", out.ref) });
      res.json({ key: ctx.keyId, orderId: out.orderId, amount: Math.round(out.amount * 100), currency: Core.STORE.currency, ref: out.ref, eta: out.eta });
    } catch (e) {
      if (e instanceof orders.OrderError) return fail(res, e);
      console.error("create-order:", e.error || e);
      res.status(500).json({ error: "Could not start payment. Please try again." });
    }
  }));

  r.post("/api/verify-payment", limiter("verify", 30, 10 * 60000), wrap(async (req, res) => {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
    if (typeof oid !== "string" || typeof pid !== "string" || typeof sig !== "string") return res.status(400).json({ error: "Missing payment details." });
    const expected = crypto.createHmac("sha256", ctx.keySecret).update(oid + "|" + pid).digest("hex");
    const ok = expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    if (!ok) return res.status(400).json({ error: "Payment verification failed." });
    const o = await orders.markPaid(oid, pid);
    if (!o) return res.status(404).json({ error: "Order not found." });
    res.json({ ref: o.ref, amount: o.amount, trackToken: sign("track", o.ref) });
  }));

  // Order tracking for anyone with the order number and email (or the signed link from their email).
  r.post("/api/track", limiter("track", 20, 10 * 60000), wrap(async (req, res) => {
    const o = await db.getOrderByRef(clip(req.body.ref, 20).toUpperCase());
    if (!o || !validEmail(req.body.email) || o.customer.email.toLowerCase() !== String(req.body.email).trim().toLowerCase())
      return res.status(404).json({ error: "We couldn't find an order with that number and email." });
    res.json({ order: orders.publicOrder(o), token: sign("track", o.ref), returns: (await db.listReturns({ orderId: o.orderId })).map(returns.publicReturn) });
  }));
  r.get("/api/track/:ref", wrap(async (req, res) => {
    const o = await db.getOrderByRef(clip(req.params.ref, 20));
    if (!o || !canSee(req, o, req.query.t)) return res.status(404).json({ error: "Order not found." });
    res.json({ order: orders.publicOrder(o), token: sign("track", o.ref), returns: (await db.listReturns({ orderId: o.orderId })).map(returns.publicReturn) });
  }));

  r.post("/api/orders/:ref/cancel", limiter("cancel", 10, 10 * 60000), wrap(async (req, res) => {
    const o = await db.getOrderByRef(clip(req.params.ref, 20));
    if (!o || !canSee(req, o, req.body.token)) return res.status(404).json({ error: "Order not found." });
    try { res.json({ order: orders.publicOrder(await orders.customerCancel(o.orderId, ctx.rzp)) }); }
    catch (e) { if (e instanceof orders.OrderError) return fail(res, e); throw e; }
  }));

  r.post("/api/orders/:ref/returns", express.json({ limit: "8mb" }), limiter("returns", 10, 60 * 60000), wrap(async (req, res) => {
    const o = await db.getOrderByRef(clip(req.params.ref, 20));
    if (!o || !canSee(req, o, req.body.token)) return res.status(404).json({ error: "Order not found." });
    try {
      const ret = await returns.createReturn(await orders.withItems(o), req.body, req.session?.role === "customer" ? req.session.userId : null);
      res.json({ return: returns.publicReturn(ret) });
    } catch (e) { if (e instanceof returns.ReturnError) return fail(res, e); throw e; }
  }));

  r.get("/invoice/:ref", wrap(async (req, res) => {
    const o = await db.getOrderByRef(clip(req.params.ref, 20));
    if (!o || !(isAdmin(req) || checkSig("invoice", o.ref, req.query.t) || (req.session?.role === "customer" && o.customerId === req.session.userId)))
      return res.status(404).send("Invoice not found.");
    if (!["paid", "cod"].includes(o.status)) return res.status(404).send("Invoice not available for unpaid orders.");
    res.set("Cache-Control", "private, no-store").type("html").send(invoice.render(await orders.withItems(o)));
  }));

  r.get("/api/products/:id/reviews", wrap(async (req, res) => {
    const list = await db.listReviews({ productId: Number(req.params.id), status: "approved" });
    res.json({ reviews: list.map((v) => ({ id: v.id, author: v.author, rating: v.rating, title: v.title, body: v.body, helpful: v.helpful, createdAt: v.createdAt, verified: true })) });
  }));
  const voted = new Set();
  r.post("/api/reviews/:id/:action(helpful|report)", limiter("vote", 30, 60 * 60000), wrap(async (req, res) => {
    const id = Number(req.params.id), key = `${req.ip}|${id}|${req.params.action}`;
    if (voted.has(key)) return res.json({ ok: true });
    voted.add(key);
    const v = await db.getReview(id);
    if (!v || v.status !== "approved") return res.status(404).json({ error: "Review not found." });
    if (req.params.action === "helpful") await db.updateReview(id, { helpful: v.helpful + 1 });
    else await db.updateReview(id, { reports: v.reports + 1, ...(v.reports + 1 >= 3 ? { status: "pending" } : {}) });
    if (v.reports + 1 >= 3) catalog.invalidate();
    res.json({ ok: true });
  }));

  r.post("/api/subscribe", limiter("subscribe", 10, 60 * 60000), wrap(async (req, res) => {
    if (!validEmail(req.body.email)) return res.status(400).json({ error: "Please enter a valid email address." });
    await db.addSubscriber(req.body.email.trim());
    res.json({ ok: true });
  }));

  const EVENTS = new Set(["page_view", "product_view", "add_to_cart", "begin_checkout", "payment_started", "search"]);
  r.post("/api/events", limiter("events", 240, 60000), wrap(async (req, res) => {
    const list = (Array.isArray(req.body.events) ? req.body.events : []).slice(0, 20).filter((e) => e && EVENTS.has(e.name)).map((e) => ({
      name: e.name, anonId: clip(e.anonId, 64), productId: Number.isInteger(e.productId) ? e.productId : null,
      value: Number.isFinite(e.value) ? e.value : null, path: clip(e.path, 200), referrer: clip(e.referrer, 200)
    }));
    if (list.length) await db.insertEvents(list);
    res.status(204).end();
  }));

  return r;
}

module.exports = { webhooks, api };
