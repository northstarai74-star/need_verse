// Data layer on Supabase (Postgres). The rest of the app works with plain camelCase
// objects; this file maps them to and from table rows.
const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const configured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const fail = (what, error) => { throw new Error(`Database error (${what}): ${error.message || error}`); };
const num = (v) => (v == null ? v : Number(v));

// [camelKey, snake_column, numeric?]
function mapper(fields) {
  return {
    from(r) {
      if (!r) return null;
      const o = {};
      for (const [c, s, n] of fields) if (s in r) o[c] = n ? num(r[s]) : r[s];
      return o;
    },
    to(o) {
      const r = {};
      for (const [c, s] of fields) if (o[c] !== undefined) r[s] = o[c];
      return r;
    }
  };
}

// ---------- Orders ----------
const ORDER = mapper([
  ["orderId", "order_id"], ["ref", "ref"], ["status", "status"], ["fulfillment", "fulfillment"],
  ["amount", "amount", 1], ["currency", "currency"], ["refunded", "refunded", 1], ["paymentId", "payment_id"],
  ["promo", "promo"], ["cart", "cart"], ["customer", "customer"], ["vehicle", "vehicle"], ["tracking", "tracking"],
  ["refunds", "refunds"], ["emailSent", "email_sent"], ["shippedEmailSent", "shipped_email_sent"], ["paidAt", "paid_at"],
  ["createdAt", "created_at"], ["version", "version"], ["items", "items"], ["totals", "totals"],
  ["paymentMethod", "payment_method"], ["customerId", "customer_id"], ["anonId", "anon_id"],
  ["stockReserved", "stock_reserved"], ["stockIssue", "stock_issue"], ["invoiceNo", "invoice_no"], ["shipment", "shipment"],
  ["history", "history"], ["deliveredAt", "delivered_at"], ["abandonedEmailSent", "abandoned_email_sent"],
  ["reviewEmailSent", "review_email_sent"]
]);
function fromOrder(r) {
  const o = ORDER.from(r);
  if (!o) return null;
  o.refunded = o.refunded || 0; o.refunds = o.refunds || []; o.history = o.history || [];
  o.paymentId = o.paymentId || undefined; o.tracking = o.tracking || undefined;
  o.fulfillment = o.fulfillment || "new"; o.paymentMethod = o.paymentMethod || "online";
  return o;
}
function toOrder(o) {
  const r = ORDER.to(o);
  delete r.version;
  return r;
}

// Throws a readable error if the connection or the tables aren't ready.
async function check() {
  if (!configured) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
  for (const t of ["orders", "products", "customers", "sessions"]) {
    const { error } = await sb.from(t).select("*").limit(1);
    if (error) throw new Error(/relation .* does not exist|schema cache|Could not find the table/i.test(error.message)
      ? `The '${t}' table doesn't exist yet. Run schema.sql in the Supabase SQL Editor.`
      : error.message);
  }
}

async function insertOrder(orderId, o) {
  const { error } = await sb.from("orders").insert(toOrder({ ...o, orderId }));
  if (error) fail("insert order", error);
}
async function getOrder(orderId) {
  const { data, error } = await sb.from("orders").select("*").eq("order_id", orderId).maybeSingle();
  if (error) fail("get order", error);
  return fromOrder(data);
}
async function getOrderByRef(ref) {
  const { data, error } = await sb.from("orders").select("*").eq("ref", ref).maybeSingle();
  if (error) fail("get order", error);
  return fromOrder(data);
}
async function findByPaymentId(paymentId) {
  const { data, error } = await sb.from("orders").select("*").eq("payment_id", paymentId).maybeSingle();
  if (error) fail("find order", error);
  return fromOrder(data);
}
async function listOrders() {
  const { data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false });
  if (error) fail("list orders", error);
  return data.map(fromOrder);
}
async function listOrdersByCustomer(customerId) {
  const { data, error } = await sb.from("orders").select("*").eq("customer_id", customerId).order("created_at", { ascending: false });
  if (error) fail("list orders", error);
  return data.map(fromOrder);
}

// Read -> change -> write, guarded by the `version` column so two requests touching
// the same order can't silently overwrite each other (the loser re-reads and retries).
// mutate(order) edits the object; return false to skip writing. Returns the saved order, or null if missing.
async function updateOrder(orderId, mutate) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await sb.from("orders").select("*").eq("order_id", orderId).maybeSingle();
    if (error) fail("read order", error);
    if (!data) return null;
    const o = fromOrder(data);
    if ((await mutate(o)) === false) return o;
    const row = toOrder(o);
    delete row.order_id; delete row.created_at;
    row.version = data.version + 1;
    const res = await sb.from("orders").update(row).eq("order_id", orderId).eq("version", data.version).select();
    if (res.error) fail("update order", res.error);
    if (res.data && res.data.length) return fromOrder(res.data[0]);
  }
  throw new Error("Database busy: could not save the order after several tries.");
}

async function importOrder(orderId, o) {
  const { error } = await sb.from("orders").upsert(toOrder({ ...o, orderId }), { onConflict: "order_id", ignoreDuplicates: true });
  if (error) fail("import order", error);
}

async function nextInvoiceNo() {
  const { data, error } = await sb.rpc("next_invoice_no");
  if (error) fail("invoice number", error);
  return Number(data);
}

// ---------- Products, fitment, inventory ----------
const PRODUCT = mapper([
  ["id", "id"], ["sku", "sku"], ["slug", "slug"], ["name", "name"], ["shortDesc", "short_desc"], ["description", "description"],
  ["category", "category"], ["brand", "brand"], ["price", "price", 1], ["mrp", "mrp", 1], ["costPrice", "cost_price", 1], ["gstRate", "gst_rate", 1], ["hsn", "hsn"],
  ["stock", "stock"], ["lowStockAt", "low_stock_at"], ["status", "status"], ["universal", "universal"], ["icon", "icon"],
  ["images", "images"], ["videoUrl", "video_url"], ["specs", "specs"], ["included", "included"],
  ["installDifficulty", "install_difficulty"], ["installGuide", "install_guide"], ["warranty", "warranty"],
  ["weightG", "weight_g"], ["dims", "dims_cm"], ["faqs", "faqs"], ["fitNotes", "fit_notes"], ["seoTitle", "seo_title"],
  ["metaDesc", "meta_desc"], ["supplierId", "supplier_id"], ["supplierSku", "supplier_sku"], ["createdAt", "created_at"], ["updatedAt", "updated_at"]
]);
const FIT = mapper([["id", "id"], ["productId", "product_id"], ["make", "make"], ["model", "model"], ["yearFrom", "year_from"], ["yearTo", "year_to"]]);

async function listProducts() {
  const { data, error } = await sb.from("products").select("*").order("id");
  if (error) fail("list products", error);
  return data.map(PRODUCT.from);
}
async function getProduct(id) {
  const { data, error } = await sb.from("products").select("*").eq("id", id).maybeSingle();
  if (error) fail("get product", error);
  return PRODUCT.from(data);
}
async function insertProduct(p) {
  const { data, error } = await sb.from("products").insert(PRODUCT.to(p)).select();
  if (error) fail("insert product", error);
  return PRODUCT.from(data[0]);
}
async function updateProduct(id, patch) {
  const row = PRODUCT.to(patch);
  delete row.id; delete row.stock; delete row.created_at;
  row.updated_at = new Date().toISOString();
  const { data, error } = await sb.from("products").update(row).eq("id", id).select();
  if (error) fail("update product", error);
  return PRODUCT.from(data[0]);
}
async function upsertProducts(rows) {
  const { error } = await sb.from("products").upsert(rows.map(PRODUCT.to), { onConflict: "id" });
  if (error) fail("upsert products", error);
}
async function syncProductSeq() {
  const { error } = await sb.rpc("sync_product_seq");
  if (error) fail("sync product ids", error);
}
async function listFitment() {
  const { data, error } = await sb.from("product_fitment").select("*");
  if (error) fail("list fitment", error);
  return data.map(FIT.from);
}
async function setFitment(productId, rows) {
  const del = await sb.from("product_fitment").delete().eq("product_id", productId);
  if (del.error) fail("clear fitment", del.error);
  if (!rows.length) return;
  const { error } = await sb.from("product_fitment").insert(rows.map((f) => FIT.to({ ...f, productId })));
  if (error) fail("save fitment", error);
}

// items: [{id, qty}]. Takes stock for every line or none. Returns {ok} or {ok:false, productId}.
async function reserveStock(items, ref) {
  const { error } = await sb.rpc("reserve_stock", { p_items: items.map(({ id, qty }) => ({ id, qty })), p_ref: ref });
  if (!error) return { ok: true };
  const m = /out_of_stock:(\d+)/.exec(error.message || "");
  if (m) return { ok: false, productId: Number(m[1]) };
  fail("reserve stock", error);
}
async function releaseStock(items, ref, reason) {
  const { error } = await sb.rpc("release_stock", { p_items: items.map(({ id, qty }) => ({ id, qty })), p_ref: ref, p_reason: reason });
  if (error) fail("release stock", error);
}
async function adjustStock(productId, delta, reason, ref) {
  const { data, error } = await sb.rpc("adjust_stock", { p_id: productId, p_delta: delta, p_reason: reason, p_ref: ref || null });
  if (error) {
    if (/invalid_stock/.test(error.message)) return null;
    fail("adjust stock", error);
  }
  return Number(data);
}
async function inventoryLog(productId, limit = 200) {
  let q = sb.from("inventory_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (productId) q = q.eq("product_id", productId);
  const { data, error } = await q;
  if (error) fail("inventory log", error);
  return data.map((r) => ({ id: r.id, productId: r.product_id, delta: r.delta, stockAfter: r.stock_after, reason: r.reason, ref: r.ref, createdAt: r.created_at }));
}

// ---------- Vehicles ----------
async function listVehicles() {
  const { data, error } = await sb.from("vehicles").select("*").order("make").order("model");
  if (error) fail("list vehicles", error);
  return data.map((r) => ({ id: r.id, make: r.make, model: r.model, yearFrom: r.year_from, yearTo: r.year_to }));
}
async function upsertVehicles(rows) {
  const { error } = await sb.from("vehicles").upsert(rows.map((v) => ({ make: v.make, model: v.model, year_from: v.yearFrom, year_to: v.yearTo })), { onConflict: "make,model" });
  if (error) fail("save vehicles", error);
}
async function deleteVehicle(id) {
  const { error } = await sb.from("vehicles").delete().eq("id", id);
  if (error) fail("delete vehicle", error);
}

// ---------- Coupons ----------
const COUPON = mapper([["code", "code"], ["percent", "percent", 1], ["minOrder", "min_order", 1], ["maxUses", "max_uses"], ["uses", "uses"],
  ["expiresAt", "expires_at"], ["active", "active"], ["createdAt", "created_at"]]);
async function getCoupon(code) {
  const { data, error } = await sb.from("coupons").select("*").eq("code", code).maybeSingle();
  if (error) fail("get coupon", error);
  return COUPON.from(data);
}
async function listCoupons() {
  const { data, error } = await sb.from("coupons").select("*").order("created_at", { ascending: false });
  if (error) fail("list coupons", error);
  return data.map(COUPON.from);
}
async function upsertCoupon(c) {
  const row = COUPON.to(c); delete row.uses; delete row.created_at;
  const { error } = await sb.from("coupons").upsert(row, { onConflict: "code" });
  if (error) fail("save coupon", error);
}
async function useCoupon(code) {
  const { error } = await sb.rpc("use_coupon", { p_code: code });
  if (error) fail("use coupon", error);
}

// ---------- Sessions ----------
async function createSession(sessionId, userId, userName, ipAddress, role = "admin", days = 7) {
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await sb.from("sessions").insert({ id: sessionId, user_id: userId, user_name: userName, ip_address: ipAddress, expires_at: expiresAt, role });
  if (error) fail("create session", error);
}
async function getSession(sessionId) {
  const { data, error } = await sb.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) fail("get session", error);
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) { await deleteSession(sessionId); return null; }
  return { id: data.id, userId: data.user_id, userName: data.user_name, role: data.role || "admin", createdAt: data.created_at };
}
async function deleteSession(sessionId) {
  const { error } = await sb.from("sessions").delete().eq("id", sessionId);
  if (error) fail("delete session", error);
}
async function deleteSessionsForUser(userId) {
  const { error } = await sb.from("sessions").delete().eq("user_id", userId);
  if (error) fail("delete sessions", error);
}
async function cleanupExpiredSessions() {
  const { error } = await sb.from("sessions").delete().lt("expires_at", new Date().toISOString());
  if (error) fail("cleanup sessions", error);
}

// ---------- Customers ----------
const CUSTOMER = mapper([["id", "id"], ["email", "email"], ["name", "name"], ["phone", "phone"], ["passwordHash", "password_hash"],
  ["addresses", "addresses"], ["garage", "garage"], ["wishlist", "wishlist"], ["marketingOk", "marketing_ok"],
  ["resetHash", "reset_hash"], ["resetExpires", "reset_expires"], ["createdAt", "created_at"]]);
async function createCustomer(c) {
  const { data, error } = await sb.from("customers").insert(CUSTOMER.to(c)).select();
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) return null;
    fail("create customer", error);
  }
  return CUSTOMER.from(data[0]);
}
async function getCustomer(id) {
  const { data, error } = await sb.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) fail("get customer", error);
  return CUSTOMER.from(data);
}
async function getCustomerByEmail(email) {
  const { data, error } = await sb.from("customers").select("*").eq("email", String(email).toLowerCase()).maybeSingle();
  if (error) fail("get customer", error);
  return CUSTOMER.from(data);
}
async function updateCustomer(id, patch) {
  const row = CUSTOMER.to(patch); delete row.id; delete row.email; delete row.created_at;
  const { data, error } = await sb.from("customers").update(row).eq("id", id).select();
  if (error) fail("update customer", error);
  return CUSTOMER.from(data[0]);
}
async function listCustomers() {
  const { data, error } = await sb.from("customers").select("*").order("created_at", { ascending: false });
  if (error) fail("list customers", error);
  return data.map(CUSTOMER.from);
}

// ---------- Reviews ----------
const REVIEW = mapper([["id", "id"], ["productId", "product_id"], ["customerId", "customer_id"], ["orderRef", "order_ref"], ["author", "author"],
  ["rating", "rating"], ["title", "title"], ["body", "body"], ["status", "status"], ["helpful", "helpful"], ["reports", "reports"], ["createdAt", "created_at"]]);
async function insertReview(r) {
  const { data, error } = await sb.from("reviews").insert(REVIEW.to(r)).select();
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) return null;
    fail("insert review", error);
  }
  return REVIEW.from(data[0]);
}
async function listReviews(filter = {}) {
  let q = sb.from("reviews").select("*").order("created_at", { ascending: false });
  if (filter.productId) q = q.eq("product_id", filter.productId);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.customerId) q = q.eq("customer_id", filter.customerId);
  const { data, error } = await q;
  if (error) fail("list reviews", error);
  return data.map(REVIEW.from);
}
async function getReview(id) {
  const { data, error } = await sb.from("reviews").select("*").eq("id", id).maybeSingle();
  if (error) fail("get review", error);
  return REVIEW.from(data);
}
async function updateReview(id, patch) {
  const row = REVIEW.to(patch); delete row.id;
  const { error } = await sb.from("reviews").update(row).eq("id", id);
  if (error) fail("update review", error);
}

// ---------- Returns ----------
const RETURN = mapper([["id", "id"], ["orderId", "order_id"], ["orderRef", "order_ref"], ["customerId", "customer_id"], ["items", "items"],
  ["reason", "reason"], ["details", "details"], ["photos", "photos"], ["status", "status"], ["adminNote", "admin_note"],
  ["refundAmount", "refund_amount", 1], ["restocked", "restocked"], ["history", "history"], ["createdAt", "created_at"], ["updatedAt", "updated_at"]]);
async function insertReturn(r) {
  const { data, error } = await sb.from("returns").insert(RETURN.to(r)).select();
  if (error) fail("insert return", error);
  return RETURN.from(data[0]);
}
async function listReturns(filter = {}) {
  let q = sb.from("returns").select("*").order("created_at", { ascending: false });
  if (filter.orderId) q = q.eq("order_id", filter.orderId);
  if (filter.customerId) q = q.eq("customer_id", filter.customerId);
  const { data, error } = await q;
  if (error) fail("list returns", error);
  return data.map(RETURN.from);
}
async function getReturn(id) {
  const { data, error } = await sb.from("returns").select("*").eq("id", id).maybeSingle();
  if (error) fail("get return", error);
  return RETURN.from(data);
}
async function updateReturn(id, patch) {
  const row = RETURN.to(patch); delete row.id;
  row.updated_at = new Date().toISOString();
  const { data, error } = await sb.from("returns").update(row).eq("id", id).select();
  if (error) fail("update return", error);
  return RETURN.from(data[0]);
}

// ---------- Newsletter, analytics, audit ----------
async function addSubscriber(email) {
  const { error } = await sb.from("subscribers").upsert({ email: String(email).toLowerCase() }, { onConflict: "email", ignoreDuplicates: true });
  if (error) fail("subscribe", error);
}
async function listSubscribers() {
  const { data, error } = await sb.from("subscribers").select("*").order("created_at", { ascending: false });
  if (error) fail("list subscribers", error);
  return data.map((r) => ({ email: r.email, createdAt: r.created_at }));
}
async function insertEvents(rows) {
  const { error } = await sb.from("events").insert(rows.map((e) => ({ name: e.name, anon_id: e.anonId || null, product_id: e.productId || null,
    value: e.value ?? null, path: e.path || null, referrer: e.referrer || null })));
  if (error) fail("insert events", error);
}
async function listEvents(sinceIso) {
  const { data, error } = await sb.from("events").select("*").gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(50000);
  if (error) fail("list events", error);
  return data.map((r) => ({ name: r.name, anonId: r.anon_id, productId: r.product_id, value: num(r.value), path: r.path, referrer: r.referrer, createdAt: r.created_at }));
}
async function deleteEventsBefore(iso) {
  const { error } = await sb.from("events").delete().lt("created_at", iso);
  if (error) fail("delete events", error);
}
async function audit(actor, action, target, details, ip) {
  const { error } = await sb.from("audit_log").insert({ actor, action, target: target == null ? null : String(target), details: details || null, ip: ip || null });
  if (error) console.error("audit log write failed:", error.message);
}
async function listAudit(limit = 300) {
  const { data, error } = await sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) fail("list audit", error);
  return data.map((r) => ({ id: r.id, actor: r.actor, action: r.action, target: r.target, details: r.details, ip: r.ip, createdAt: r.created_at }));
}

// ---------- Suppliers and purchase orders ----------
const SUPPLIER = mapper([["id", "id"], ["name", "name"], ["contactName", "contact_name"], ["email", "email"], ["phone", "phone"], ["gstin", "gstin"],
  ["address", "address"], ["state", "state"], ["paymentTerms", "payment_terms"], ["leadTimeDays", "lead_time_days"], ["notes", "notes"], ["active", "active"], ["createdAt", "created_at"]]);
async function listSuppliers() {
  const { data, error } = await sb.from("suppliers").select("*").order("name");
  if (error) fail("list suppliers", error);
  return data.map(SUPPLIER.from);
}
async function getSupplier(id) {
  const { data, error } = await sb.from("suppliers").select("*").eq("id", id).maybeSingle();
  if (error) fail("get supplier", error);
  return SUPPLIER.from(data);
}
async function saveSupplier(id, s) {
  const row = SUPPLIER.to(s); delete row.id; delete row.created_at;
  const q = id ? sb.from("suppliers").update(row).eq("id", id) : sb.from("suppliers").insert(row);
  const { data, error } = await q.select();
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) return null;
    fail("save supplier", error);
  }
  return SUPPLIER.from(data[0]);
}

const PO = mapper([["id", "id"], ["poNo", "po_no"], ["supplierId", "supplier_id"], ["status", "status"], ["items", "items"], ["total", "total", 1],
  ["notes", "notes"], ["expectedAt", "expected_at"], ["history", "history"], ["createdAt", "created_at"], ["updatedAt", "updated_at"]]);
async function nextPoNo() {
  const { data, error } = await sb.rpc("next_po_no");
  if (error) fail("PO number", error);
  return Number(data);
}
async function listPurchaseOrders() {
  const { data, error } = await sb.from("purchase_orders").select("*").order("created_at", { ascending: false });
  if (error) fail("list purchase orders", error);
  return data.map(PO.from);
}
async function getPurchaseOrder(id) {
  const { data, error } = await sb.from("purchase_orders").select("*").eq("id", id).maybeSingle();
  if (error) fail("get purchase order", error);
  return PO.from(data);
}
async function insertPurchaseOrder(po) {
  const row = PO.to(po); delete row.id;
  const { data, error } = await sb.from("purchase_orders").insert(row).select();
  if (error) fail("create purchase order", error);
  return PO.from(data[0]);
}
async function updatePurchaseOrder(id, patch) {
  const row = PO.to(patch); delete row.id; delete row.po_no; delete row.created_at;
  row.updated_at = new Date().toISOString();
  const { data, error } = await sb.from("purchase_orders").update(row).eq("id", id).select();
  if (error) fail("update purchase order", error);
  return PO.from(data[0]);
}

// ---------- File storage ----------
async function uploadFile(bucket, path, buffer, contentType) {
  const { error } = await sb.storage.from(bucket).upload(path, buffer, { contentType, upsert: false });
  if (error) fail("upload", error);
  return { path, url: sb.storage.from(bucket).getPublicUrl(path).data.publicUrl };
}
async function signedUrl(bucket, path, seconds = 600) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) fail("signed url", error);
  return data.signedUrl;
}

module.exports = {
  configured, check,
  insertOrder, getOrder, getOrderByRef, findByPaymentId, listOrders, listOrdersByCustomer, updateOrder, importOrder, nextInvoiceNo,
  listProducts, getProduct, insertProduct, updateProduct, upsertProducts, syncProductSeq, listFitment, setFitment,
  reserveStock, releaseStock, adjustStock, inventoryLog,
  listVehicles, upsertVehicles, deleteVehicle,
  getCoupon, listCoupons, upsertCoupon, useCoupon,
  createSession, getSession, deleteSession, deleteSessionsForUser, cleanupExpiredSessions,
  createCustomer, getCustomer, getCustomerByEmail, updateCustomer, listCustomers,
  insertReview, listReviews, getReview, updateReview,
  insertReturn, listReturns, getReturn, updateReturn,
  addSubscriber, listSubscribers, insertEvents, listEvents, deleteEventsBefore, audit, listAudit,
  listSuppliers, getSupplier, saveSupplier, nextPoNo, listPurchaseOrders, getPurchaseOrder, insertPurchaseOrder, updatePurchaseOrder,
  uploadFile, signedUrl
};
