// Orders storage on Supabase (Postgres). The rest of the app works with plain
// camelCase order objects; this file maps them to and from table rows.
const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const configured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

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
  if (!configured) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
  const { error } = await sb.from(T).select("order_id").limit(1);
  if (error) throw new Error(/relation .* does not exist|schema cache|Could not find the table/i.test(error.message)
    ? "The 'orders' table doesn't exist yet. Run schema.sql in the Supabase SQL Editor."
    : error.message);
}

async function insertOrder(orderId, o) {
  const { error } = await sb.from(T).insert(toRow({ ...o, orderId }));
  if (error) fail("insert", error);
}
async function getOrder(orderId) {
  const { data, error } = await sb.from(T).select("*").eq("order_id", orderId).maybeSingle();
  if (error) fail("get", error);
  return fromRow(data);
}
async function findByPaymentId(paymentId) {
  const { data, error } = await sb.from(T).select("*").eq("payment_id", paymentId).maybeSingle();
  if (error) fail("find", error);
  return fromRow(data);
}
async function listOrders() {
  const { data, error } = await sb.from(T).select("*").order("created_at", { ascending: false });
  if (error) fail("list", error);
  return data.map(fromRow);
}

// Read -> change -> write, guarded by the `version` column so two requests touching
// the same order can't silently overwrite each other (the loser re-reads and retries).
// mutate(order) edits the object; return false to skip writing. Returns the saved order, or null if missing.
async function updateOrder(orderId, mutate) {
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
  const { error } = await sb.from(T).upsert(toRow({ ...o, orderId }), { onConflict: "order_id", ignoreDuplicates: true });
  if (error) fail("import", error);
}

// ===== Products =====
async function getProduct(id) {
  const { data, error } = await sb.from("products").select("*").eq("id", id).maybeSingle();
  if (error) fail("getProduct", error);
  return data;
}
async function listProducts(active = null) {
  let q = sb.from("products");
  if (active !== null) q = q.eq("active", active);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) fail("listProducts", error);
  return data || [];
}
async function createProduct(p) {
  const { data, error } = await sb.from("products").insert(p).select();
  if (error) fail("createProduct", error);
  return data?.[0];
}
async function updateProduct(id, p) {
  const { data, error } = await sb.from("products").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id).select();
  if (error) fail("updateProduct", error);
  return data?.[0];
}
async function deleteProduct(id) {
  const { error } = await sb.from("products").delete().eq("id", id);
  if (error) fail("deleteProduct", error);
}

// ===== Inventory =====
async function getInventory(productId) {
  const { data, error } = await sb.from("inventory").select("*").eq("product_id", productId).maybeSingle();
  if (error) fail("getInventory", error);
  return data || { product_id: productId, quantity: 0, reserved: 0 };
}
async function updateInventory(productId, qty, reserved = null) {
  const update = { quantity: qty, updated_at: new Date().toISOString() };
  if (reserved !== null) update.reserved = reserved;
  const { data, error } = await sb.from("inventory").upsert({ product_id: productId, ...update }, { onConflict: "product_id" }).select();
  if (error) fail("updateInventory", error);
  return data?.[0];
}

// ===== Coupons =====
async function getCoupon(code) {
  const { data, error } = await sb.from("coupons").select("*").eq("code", code.toUpperCase()).maybeSingle();
  if (error) fail("getCoupon", error);
  return data;
}
async function listCoupons(active = null) {
  let q = sb.from("coupons");
  if (active !== null) q = q.eq("active", active);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) fail("listCoupons", error);
  return data || [];
}
async function createCoupon(c) {
  const { data, error } = await sb.from("coupons").insert({ ...c, code: c.code.toUpperCase() }).select();
  if (error) fail("createCoupon", error);
  return data?.[0];
}
async function updateCoupon(id, c) {
  const { data, error } = await sb.from("coupons").update(c).eq("id", id).select();
  if (error) fail("updateCoupon", error);
  return data?.[0];
}
async function incrementCouponUsage(code) {
  const { data, error } = await sb.from("coupons").update({ used_count: sb.raw("used_count + 1") }).eq("code", code.toUpperCase()).select();
  if (error) fail("incrementCouponUsage", error);
  return data?.[0];
}

// ===== Customers =====
async function getOrCreateCustomer(email, name, phone, addr, city, zip) {
  const { data: existing } = await sb.from("customers").select("*").eq("email", email).maybeSingle();
  if (existing) return existing;
  const { data, error } = await sb.from("customers").insert({ email, name, phone, addr, city, zip }).select();
  if (error) fail("createCustomer", error);
  return data?.[0];
}
async function listCustomers() {
  const { data, error } = await sb.from("customers").select("*").order("created_at", { ascending: false });
  if (error) fail("listCustomers", error);
  return data || [];
}
async function updateCustomer(id, c) {
  const { data, error } = await sb.from("customers").update({ ...c, updated_at: new Date().toISOString() }).eq("id", id).select();
  if (error) fail("updateCustomer", error);
  return data?.[0];
}
async function updateCustomerStats(email, amount) {
  const { data, error } = await sb.from("customers").update({
    total_orders: sb.raw("total_orders + 1"),
    total_spent: sb.raw("total_spent + " + amount),
    updated_at: new Date().toISOString()
  }).eq("email", email).select();
  if (error) fail("updateCustomerStats", error);
  return data?.[0];
}

module.exports = {
  configured, check, insertOrder, getOrder, findByPaymentId, listOrders, updateOrder, importOrder,
  getProduct, listProducts, createProduct, updateProduct, deleteProduct,
  getInventory, updateInventory,
  getCoupon, listCoupons, createCoupon, updateCoupon, incrementCouponUsage,
  getOrCreateCustomer, listCustomers, updateCustomer, updateCustomerStats
};
