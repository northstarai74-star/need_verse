// Orders storage on Supabase (Postgres). The rest of the app works with plain
// camelCase order objects; this file maps them to and from table rows.
const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_MODE } = process.env;
const configured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

// Mock in-memory database for demo/development
const mockOrders = new Map();

const T = "orders";
const fail = (what, error) => { throw new Error(`Database error (${what}): ${error.message || error}`); };

function fromRow(r) {
  if (!r) return null;
  return {
    orderId: r.order_id, ref: r.ref, status: r.status, fulfillment: r.fulfillment,
    amount: Number(r.amount), currency: r.currency, refunded: Number(r.refunded || 0),
    paymentId: r.payment_id || undefined, promo: r.promo, cart: r.cart, customer: r.customer,
    vehicle: r.vehicle, tracking: r.tracking || undefined, refunds: r.refunds || [],
    emailSent: r.email_sent, shippedEmailSent: r.shipped_email_sent,
    paidAt: r.paid_at, createdAt: r.created_at, version: r.version
  };
}
function toRow(o) {
  return {
    order_id: o.orderId, ref: o.ref, status: o.status, fulfillment: o.fulfillment || "new",
    amount: o.amount, currency: o.currency || "INR", refunded: o.refunded || 0,
    payment_id: o.paymentId || null, promo: o.promo || null, cart: o.cart, customer: o.customer,
    vehicle: o.vehicle || null, tracking: o.tracking || null, refunds: o.refunds || [],
    email_sent: !!o.emailSent, shipped_email_sent: !!o.shippedEmailSent,
    paid_at: o.paidAt || null, ...(o.createdAt ? { created_at: o.createdAt } : {})
  };
}

// Throws a readable error if the connection or the table isn't ready.
async function check() {
  if (DEMO_MODE) {
    console.log("Running in DEMO_MODE with in-memory database");
    return;
  }
  if (!configured) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
  const { error } = await sb.from(T).select("order_id").limit(1);
  if (error) throw new Error(/relation .* does not exist|schema cache|Could not find the table/i.test(error.message)
    ? "The 'orders' table doesn't exist yet. Run schema.sql in the Supabase SQL Editor."
    : error.message);
}

async function insertOrder(orderId, o) {
  if (!configured || DEMO_MODE) {
    mockOrders.set(orderId, { ...o, orderId });
    return;
  }
  const { error } = await sb.from(T).insert(toRow({ ...o, orderId }));
  if (error) fail("insert", error);
}
async function getOrder(orderId) {
  if (!configured || DEMO_MODE) {
    return mockOrders.get(orderId) || null;
  }
  const { data, error } = await sb.from(T).select("*").eq("order_id", orderId).maybeSingle();
  if (error) fail("get", error);
  return fromRow(data);
}
async function findByPaymentId(paymentId) {
  if (!configured || DEMO_MODE) {
    for (const order of mockOrders.values()) {
      if (order.paymentId === paymentId) return order;
    }
    return null;
  }
  const { data, error } = await sb.from(T).select("*").eq("payment_id", paymentId).maybeSingle();
  if (error) fail("find", error);
  return fromRow(data);
}
async function listOrders() {
  if (!configured || DEMO_MODE) {
    return Array.from(mockOrders.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  const { data, error } = await sb.from(T).select("*").order("created_at", { ascending: false });
  if (error) fail("list", error);
  return data.map(fromRow);
}

// Read -> change -> write, guarded by the `version` column so two requests touching
// the same order can't silently overwrite each other (the loser re-reads and retries).
// mutate(order) edits the object; return false to skip writing. Returns the saved order, or null if missing.
async function updateOrder(orderId, mutate) {
  if (!configured || DEMO_MODE) {
    const order = mockOrders.get(orderId);
    if (!order) return null;
    await mutate(order);
    mockOrders.set(orderId, order);
    return order;
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await sb.from(T).select("*").eq("order_id", orderId).maybeSingle();
    if (error) fail("read", error);
    if (!data) return null;
    const o = fromRow(data);
    if ((await mutate(o)) === false) return o;
    const row = toRow(o);
    delete row.order_id; delete row.created_at;
    row.version = data.version + 1;
    const res = await sb.from(T).update(row).eq("order_id", orderId).eq("version", data.version).select();
    if (res.error) fail("update", res.error);
    if (res.data && res.data.length) return fromRow(res.data[0]);
  }
  throw new Error("Database busy: could not save the order after several tries.");
}

// Used by migrate-orders.js; skips orders that are already there.
async function importOrder(orderId, o) {
  if (!configured || DEMO_MODE) {
    if (!mockOrders.has(orderId)) {
      mockOrders.set(orderId, { ...o, orderId });
    }
    return;
  }
  const { error } = await sb.from(T).upsert(toRow({ ...o, orderId }), { onConflict: "order_id", ignoreDuplicates: true });
  if (error) fail("import", error);
}

module.exports = { configured, check, insertOrder, getOrder, findByPaymentId, listOrders, updateOrder, importOrder };
