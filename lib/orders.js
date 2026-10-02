// Order lifecycle: checkout, payment, fulfilment, cancellation, refunds and the
// background clean-up of unpaid orders. Every status change goes through updateOrder,
// which is guarded so two requests can never both "win" the same transition.
const crypto = require("crypto");
const db = require("../db");
const Core = require("../public/core");
const catalog = require("./catalog");
const shipping = require("./shipping");
const mail = require("../mailer");
const wa = require("./whatsapp");
const { sign, clip, validEmail } = require("./security");

const { money, STORE } = Core;
const site = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const holdMinutes = () => Number(process.env.ORDER_HOLD_MINUTES || 30);
const nowIso = () => new Date().toISOString();
const r2 = (n) => Math.round(n * 100) / 100;

class OrderError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const hist = (o, event, by, extra) => { o.history = [...(o.history || []), { at: nowIso(), event, by, ...(extra || {}) }]; };
const links = (o) => ({
  track: `${site()}/track?ref=${encodeURIComponent(o.ref)}&t=${sign("track", o.ref)}`,
  invoice: `${site()}/invoice/${encodeURIComponent(o.ref)}?t=${sign("invoice", o.ref)}`
});
function financialYear(d) {
  const ist = new Date(new Date(d).getTime() + 5.5 * 36e5);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String(y + 1).slice(2)}`;
}

// Old orders (before line snapshots) only have {id: qty}; fill in names and prices from the catalogue.
async function withItems(o) {
  if (!o || o.items) return o;
  const products = new Map((await db.listProducts()).map((p) => [p.id, p]));
  o.items = Object.entries(o.cart || {}).map(([id, qty]) => {
    const p = products.get(Number(id));
    return { id: Number(id), name: p ? p.name : "Product " + id, qty, price: p ? p.price : 0, gstRate: p ? p.gstRate : 18, sku: p?.sku, hsn: p?.hsn };
  });
  return o;
}

function cleanCustomer(c) {
  c = c || {};
  const out = {
    name: clip(c.name, 100), email: clip(c.email, 120).toLowerCase(), phone: clip(c.phone, 20), addr: clip(c.addr, 200),
    city: clip(c.city, 80), state: clip(c.state, 60), zip: clip(c.zip, 6)
  };
  if (!out.name || !out.addr || !out.city) return { error: "Please fill in your name and full address." };
  if (!validEmail(out.email)) return { error: "Please enter a valid email address." };
  if (!Core.validPhone(out.phone)) return { error: "Please enter a valid 10-digit Indian mobile number." };
  if (!Core.STATES.includes(out.state)) return { error: "Please choose your state." };
  if (!Core.validPin(out.zip)) return { error: "Please enter a valid 6-digit PIN code." };
  return { customer: out };
}

const couponUsable = (c) => c && c.active && (!c.expiresAt || new Date(c.expiresAt) > new Date()) && (c.maxUses == null || c.uses < c.maxUses);

// Prices a cart for display (cart drawer, checkout). Same maths as createOrder.
async function quote({ cart, promo, cod }) {
  const priced = await catalog.priceCart(cart);
  if (priced.error) return { error: priced.error };
  let coupon = null, promoError = null;
  if (promo) {
    const c = await db.getCoupon(clip(promo, 30).toUpperCase());
    if (couponUsable(c)) coupon = { code: c.code, percent: c.percent, minOrder: c.minOrder };
    else promoError = "That promo code isn't valid or has expired.";
  }
  const totals = Core.computeTotals(priced.lines, { coupon, cod: !!cod });
  if (coupon && !totals.couponOk) promoError = `${coupon.code} needs an order of at least ${money(coupon.minOrder)}.`;
  return { totals, coupon: coupon && totals.couponOk ? coupon : null, promoError, lines: priced.lines };
}

async function createOrder(input, rzp) {
  const method = input.method === "cod" ? "cod" : "online";
  const cc = cleanCustomer(input.customer);
  if (cc.error) throw new OrderError(400, cc.error);
  const c = cc.customer;
  const q = await quote({ cart: input.cart, promo: input.promo, cod: method === "cod" });
  if (q.error) throw new OrderError(400, q.error);
  if (input.promo && q.promoError) throw new OrderError(400, q.promoError);
  const t = q.totals;
  if (method === "cod") {
    if (process.env.COD_ENABLED === "false") throw new OrderError(400, "Cash on delivery isn't available right now. Please pay online.");
    if (!t.codAllowed) throw new OrderError(400, `Cash on delivery is available for orders up to ${money(STORE.codMax)}. Please pay online.`);
  }
  const weight = q.lines.reduce((s, l) => s + (l.weightG || 500) * l.qty, 0);
  const ship = await shipping.check(c.zip, weight, method === "cod");
  if (!ship.ok) throw new OrderError(400, ship.reason);
  if (method === "cod" && !ship.cod) throw new OrderError(400, "Cash on delivery isn't available for this PIN code. Please pay online.");

  const ref = "NV-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const items = q.lines.map(({ id, sku, name, qty, price, gstRate, hsn, weightG, dims, icon, cost }) => ({ id, sku, name, qty, price, gstRate, hsn, weightG, dims, icon, cost }));
  const res = await db.reserveStock(items, ref);
  if (!res.ok) {
    const p = items.find((l) => l.id === res.productId);
    throw new OrderError(409, `Sorry, ${p ? p.name : "an item in your cart"} just sold out or has fewer left than you asked for. Please update your cart.`, { productId: res.productId });
  }
  let orderId;
  try {
    if (method === "online") {
      const rz = await rzp.orders.create({ amount: Math.round(t.total * 100), currency: STORE.currency, receipt: ref, notes: { ref, name: c.name.slice(0, 60), email: c.email.slice(0, 80) } });
      orderId = rz.id;
    } else orderId = "cod_" + crypto.randomBytes(8).toString("hex");
    const v = input.vehicle && typeof input.vehicle === "object" ? { make: clip(input.vehicle.make, 40), model: clip(input.vehicle.model, 40), year: clip(input.vehicle.year, 4) } : null;
    await db.insertOrder(orderId, {
      ref, status: method === "cod" ? "cod" : "created", amount: t.total, currency: STORE.currency, paymentMethod: method,
      cart: Object.fromEntries(items.map((l) => [l.id, l.qty])), items, totals: t, promo: q.coupon ? q.coupon.code : null,
      customer: c, vehicle: v && v.make ? v : null, customerId: input.customerId || null, anonId: clip(input.anonId, 64) || null,
      stockReserved: true, history: [{ at: nowIso(), event: method === "cod" ? "placed (cash on delivery)" : "checkout started", by: "customer" }]
    });
  } catch (e) {
    await db.releaseStock(items, ref, "release").catch((x) => console.error("Stock release failed for", ref, x.message));
    throw e;
  }
  catalog.invalidate();
  if (method === "cod") {
    const o = await db.getOrder(orderId);
    await afterConfirmed(o);
    await sendConfirmation(orderId);
  }
  return { orderId, ref, amount: t.total, method, eta: ship.eta };
}

// Runs once per order when it becomes a real sale (paid online, or COD placed).
async function afterConfirmed(o) {
  try {
    if (!o.invoiceNo) {
      const n = await db.nextInvoiceNo();
      await db.updateOrder(o.orderId, (x) => { if (x.invoiceNo) return false; x.invoiceNo = `NV/${financialYear(x.paidAt || x.createdAt)}/${String(n).padStart(5, "0")}`; });
    }
    if (o.promo) await db.useCoupon(o.promo);
    await db.insertEvents([{ name: "purchase", anonId: o.anonId, value: o.amount }]);
  } catch (e) { console.error("After-order bookkeeping failed for", o.ref, e.message); }
  wa.notify("order_confirmed", o.customer.phone, [o.customer.name.split(" ")[0], o.ref, money(o.amount)]);
  lowStockCheck(o.items || []).catch((e) => console.error("Low stock check:", e.message));
}

const alerted = new Map();
async function lowStockCheck(items) {
  const low = [];
  for (const l of items) {
    const p = await db.getProduct(l.id);
    if (p && p.stock <= p.lowStockAt && alerted.get(p.id) !== new Date().toDateString()) { alerted.set(p.id, new Date().toDateString()); low.push(p); }
  }
  if (low.length) await mail.sendOwnerAlert(`Low stock: ${low.map((p) => p.name).join(", ")}`,
    `<h2 style="margin:0 0 10px">Low stock</h2><ul>${low.map((p) => `<li>${p.name} (${p.sku}): ${p.stock} left</li>`).join("")}</ul>`);
}

// Sends the confirmation email exactly once (claimed atomically; un-claimed if sending fails).
async function sendConfirmation(orderId) {
  let claimed = false;
  const o = await db.updateOrder(orderId, (x) => { claimed = false; if (x.emailSent) return false; x.emailSent = true; claimed = true; });
  if (!claimed) return;
  try {
    if (!(await mail.sendOrderEmails(await withItems(o), links(o)))) throw new Error("email not configured");
  } catch (err) {
    console.error("Order email not sent for", o.ref, "-", err.message);
    await db.updateOrder(orderId, (x) => { x.emailSent = false; });
  }
}

// Called by the browser callback and the Razorpay webhook. Safe to call twice.
async function markPaid(orderId, paymentId, paidPaise) {
  const cur = await db.getOrder(orderId);
  if (!cur) return null;
  if (paidPaise != null && paidPaise !== Math.round(cur.amount * 100)) {
    console.error(`Amount mismatch for ${cur.ref}: paid ${paidPaise}, expected ${Math.round(cur.amount * 100)}`);
    return null;
  }
  let becamePaid = false, needsStock = false;
  let o = await db.updateOrder(orderId, (x) => {
    becamePaid = false; needsStock = false;
    if (x.status === "paid") return false;
    needsStock = x.status === "expired" && !x.stockReserved && !!x.items;
    x.status = "paid"; x.paymentId = paymentId; x.paidAt = nowIso(); becamePaid = true;
    hist(x, "paid", "razorpay");
  });
  if (becamePaid) {
    console.log(`PAID ${o.ref}  ${o.currency} ${o.amount}  ${o.customer.name} <${o.customer.email}>`);
    if (needsStock) {
      const r = await db.reserveStock(o.items, o.ref);
      o = await db.updateOrder(orderId, (x) => { if (r.ok) x.stockReserved = true; else { x.stockIssue = true; hist(x, "paid after expiry, but stock ran out", "system"); } });
      if (!r.ok) await mail.sendOwnerAlert(`Action needed: ${o.ref} paid but out of stock`,
        `<p>Order <b>${o.ref}</b> was paid after its checkout expired, and an item has since sold out. Refund it or restock it from the admin.</p>`);
    }
    catalog.invalidate();
    await afterConfirmed(o);
  }
  await sendConfirmation(orderId);
  return db.getOrder(orderId);
}

const NEXT = {
  new: ["packed", "cancelled"], packed: ["new", "shipped", "cancelled"], shipped: ["out_for_delivery", "delivered", "returned"],
  out_for_delivery: ["shipped", "delivered", "returned"], delivered: ["returned"], cancelled: [], returned: []
};

// Moves an order along. Returns {order, emailed, emailError}.
async function setFulfillment(orderId, status, by, opts = {}) {
  const cur = await db.getOrder(orderId);
  if (!cur) throw new OrderError(404, "Order not found");
  if (cur.status !== "paid" && cur.status !== "cod") throw new OrderError(400, "Only paid or cash-on-delivery orders can be fulfilled.");
  if (cur.fulfillment === status && status !== "shipped") return { order: cur };
  if (cur.fulfillment !== status && !NEXT[cur.fulfillment].includes(status))
    throw new OrderError(400, `An order that is ${cur.fulfillment.replace(/_/g, " ")} can't be moved to ${status.replace(/_/g, " ")}.`);
  if (status === "shipped" && cur.refunded >= cur.amount && cur.amount > 0) throw new OrderError(400, "This order was fully refunded; it can't be shipped.");

  let claimShip = false, firstDelivery = false, release = false;
  const o = await db.updateOrder(orderId, (x) => {
    claimShip = false; firstDelivery = false; release = false;
    if (x.fulfillment !== status && !NEXT[x.fulfillment].includes(status)) return false;
    if (x.fulfillment !== status) hist(x, status.replace(/_/g, " "), by, opts.note ? { note: opts.note } : undefined);
    x.fulfillment = status;
    if (opts.tracking) x.tracking = opts.tracking;
    if (opts.shipment) x.shipment = opts.shipment;
    if (status === "shipped" && !x.shippedEmailSent) { x.shippedEmailSent = true; claimShip = true; }
    if (status === "delivered" && !x.deliveredAt) {
      x.deliveredAt = nowIso(); firstDelivery = true;
      if (x.status === "cod") { x.status = "paid"; x.paidAt = nowIso(); hist(x, "cash collected", by); }
    }
    if ((status === "cancelled" || status === "returned") && x.stockReserved) { x.stockReserved = false; release = true; }
  });
  if (!o) throw new OrderError(404, "Order not found");
  if (release && o.items) { await db.releaseStock(o.items, o.ref, status === "cancelled" ? "cancelled" : "rto"); catalog.invalidate(); }

  let emailed = false, emailError = null;
  if (claimShip) {
    wa.notify("order_shipped", o.customer.phone, [o.customer.name.split(" ")[0], o.ref, o.tracking?.url || o.tracking?.number || "-"]);
    try {
      if (await mail.sendShippedEmail(await withItems(o))) emailed = true;
      else throw new Error("Email is not configured on the server (SMTP settings).");
    } catch (err) {
      console.error("Shipped email failed for", o.ref, err.message);
      emailError = err.message.startsWith("Email is not") ? err.message : "Could not send the email: " + err.message;
      await db.updateOrder(orderId, (x) => { x.shippedEmailSent = false; });
    }
  }
  if (firstDelivery) {
    wa.notify("order_delivered", o.customer.phone, [o.customer.name.split(" ")[0], o.ref]);
    mail.sendDeliveredEmail(o).catch((e) => console.error("Delivered email:", e.message));
  }
  return { order: await db.getOrder(orderId), emailed, emailError, alreadyEmailed: status === "shipped" && !claimShip };
}

// ---------- Refunds ----------
function upsertRefund(o, entity, reason) {
  o.refunds = o.refunds || [];
  let x = o.refunds.find((r) => r.id === entity.id);
  if (!x) { x = { id: entity.id, createdAt: nowIso(), reason: reason || entity.notes?.reason || "" }; o.refunds.push(x); }
  x.amount = entity.amount / 100;
  x.status = entity.status; // pending | processed | failed
  o.refunded = r2(o.refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount, 0));
  return x;
}
// Emails the customer once per refund (claimed atomically).
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
    if (!(await mail.sendRefundEmail(o, r))) throw new Error("email not configured");
  } catch (err) {
    console.error("Refund email not sent for", o.ref, "-", err.message);
    await db.updateOrder(orderId, (x) => { const f = x.refunds.find((y) => y.id === refundId); if (f) f.emailed = false; });
  }
}

const refundLock = new Set();
// Refunds through Razorpay (online) or records a manual bank refund (COD). amount in rupees; omit for the full remainder.
async function refund(orderId, amount, reason, by, rzp) {
  if (refundLock.has(orderId)) throw new OrderError(409, "A refund for this order is already in progress.");
  refundLock.add(orderId);
  try {
    const o = await db.getOrder(orderId);
    if (!o) throw new OrderError(404, "Order not found");
    if (o.status !== "paid") throw new OrderError(400, "Only paid orders can be refunded.");
    const remaining = Math.round(o.amount * 100) - Math.round((o.refunded || 0) * 100);
    if (remaining <= 0) throw new OrderError(400, "This order is already fully refunded.");
    const paise = amount === undefined || amount === null || amount === "" ? remaining : Math.round(Number(amount) * 100);
    if (!Number.isFinite(paise) || paise < 100) throw new OrderError(400, `Enter an amount of at least ${STORE.symbol}1.`);
    if (paise > remaining) throw new OrderError(400, `You can refund at most ${money(remaining / 100)}.`);
    reason = clip(reason, 200);

    let entity;
    if (o.paymentMethod === "cod" || !o.paymentId || o.paymentId === "cod") {
      entity = { id: "manual_" + crypto.randomBytes(4).toString("hex"), amount: paise, status: "processed", notes: { reason } };
    } else {
      try {
        entity = await rzp.payments.refund(o.paymentId, { amount: paise, speed: "normal", notes: { order: o.ref, reason }, receipt: `${o.ref}-R${o.refunds.length + 1}` });
      } catch (err) {
        console.error("refund:", err.error || err);
        throw new OrderError(502, err.error?.description || "Razorpay could not process the refund.");
      }
    }
    let x, release = false;
    const saved = await db.updateOrder(orderId, (y) => {
      release = false;
      x = upsertRefund(y, entity, reason);
      hist(y, `refund ${money(entity.amount / 100)}`, by);
      // A full refund on an order that hasn't left the warehouse cancels it and puts the stock back.
      if (y.refunded >= y.amount && ["new", "packed"].includes(y.fulfillment)) {
        y.fulfillment = "cancelled";
        if (y.stockReserved) { y.stockReserved = false; release = true; }
      }
    });
    if (release && saved.items) { await db.releaseStock(saved.items, saved.ref, "cancelled"); catalog.invalidate(); }
    console.log(`REFUND ${o.ref}  ${money(x.amount)}  (${x.status})  ${reason}`);
    await notifyRefund(orderId, entity.id);
    return { refund: x, refunded: saved.refunded, order: saved };
  } finally { refundLock.delete(orderId); }
}

// Customer cancels before packing. Paid orders are refunded in full automatically.
async function customerCancel(orderId, rzp) {
  const o = await db.getOrder(orderId);
  if (!o) throw new OrderError(404, "Order not found");
  if (o.fulfillment !== "new" || !["paid", "cod"].includes(o.status)) throw new OrderError(400, "This order is already being prepared, so it can't be cancelled here. Contact us and we'll help.");
  if (o.status === "paid" && o.amount > 0) await refund(orderId, null, "Cancelled by customer", "customer", rzp);
  const after = await db.getOrder(orderId);
  if (after.fulfillment !== "cancelled") await setFulfillment(orderId, "cancelled", "customer");
  return db.getOrder(orderId);
}

// ---------- Background jobs ----------
async function expireStale() {
  const cutoff = Date.now() - holdMinutes() * 60000;
  const stale = (await db.listOrders()).filter((o) => o.status === "created" && new Date(o.createdAt).getTime() < cutoff);
  for (const s of stale) {
    let release = false;
    const o = await db.updateOrder(s.orderId, (x) => {
      release = false;
      if (x.status !== "created") return false;
      x.status = "expired"; release = x.stockReserved; x.stockReserved = false;
      hist(x, "checkout expired (not paid)", "system");
    });
    if (release && o.items) await db.releaseStock(o.items, o.ref, "release");
    if (o.status === "expired" && process.env.ABANDONED_CART_EMAILS !== "false" && o.items) {
      let claimed = false;
      await db.updateOrder(o.orderId, (x) => { claimed = false; if (x.abandonedEmailSent || x.status !== "expired") return false; x.abandonedEmailSent = true; claimed = true; });
      if (claimed) {
        const cart = Buffer.from(JSON.stringify(o.cart)).toString("base64url");
        await mail.sendAbandonedEmail(o, `${site()}/?restore=${cart}`).catch((e) => console.error("Abandoned email:", e.message));
      }
    }
  }
  if (stale.length) catalog.invalidate();
  return stale.length;
}

async function sendReviewRequests() {
  const days = Number(process.env.REVIEW_REQUEST_DAYS || 3);
  const due = (await db.listOrders()).filter((o) => o.deliveredAt && !o.reviewEmailSent && Date.now() - new Date(o.deliveredAt).getTime() > days * 864e5);
  if (!due.length) return 0;
  const products = new Map((await db.listProducts()).map((p) => [p.id, p]));
  for (const d of due) {
    let claimed = false;
    const o = await db.updateOrder(d.orderId, (x) => { claimed = false; if (x.reviewEmailSent) return false; x.reviewEmailSent = true; claimed = true; });
    if (claimed) await mail.sendReviewRequest(await withItems(o), products).catch((e) => console.error("Review request:", e.message));
  }
  return due.length;
}

// Public view of an order for the customer (no internal fields).
function publicOrder(o) {
  return {
    ref: o.ref, status: o.status, fulfillment: o.fulfillment, paymentMethod: o.paymentMethod, amount: o.amount, refunded: o.refunded,
    items: (o.items || []).map(({ id, name, qty, price, icon }) => ({ id, name, qty, price, icon })), totals: o.totals, customer: o.customer,
    tracking: o.tracking || (o.shipment?.trackingUrl ? { carrier: o.shipment.courier, number: o.shipment.awb, url: o.shipment.trackingUrl } : null),
    history: (o.history || []).map(({ at, event }) => ({ at, event })), createdAt: o.createdAt, deliveredAt: o.deliveredAt,
    invoiceUrl: o.invoiceNo ? links(o).invoice : null,
    returnUntil: o.deliveredAt ? new Date(new Date(o.deliveredAt).getTime() + STORE.returnDays * 864e5).toISOString() : null,
    canCancel: o.fulfillment === "new" && ["paid", "cod"].includes(o.status)
  };
}

module.exports = { OrderError, cleanCustomer, quote, createOrder, markPaid, setFulfillment, refund, upsertRefund, notifyRefund, customerCancel,
  expireStale, sendReviewRequests, withItems, publicOrder, links, financialYear, NEXT };
