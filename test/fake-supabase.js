// In-memory stand-in for the parts of supabase-js this app uses, with the same
// defaults, unique constraints and stock functions as schema.sql. Tests only.
const crypto = require("crypto");

const now = () => new Date().toISOString();
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const DEFAULTS = {
  orders: () => ({ status: "created", fulfillment: "new", currency: "INR", refunded: 0, refunds: [], email_sent: false, shipped_email_sent: false,
    paid_at: null, created_at: now(), version: 0, payment_method: "online", stock_reserved: false, stock_issue: false, history: [],
    abandoned_email_sent: false, review_email_sent: false, payment_id: null, invoice_no: null, items: null, totals: null, customer_id: null,
    anon_id: null, shipment: null, delivered_at: null, tracking: null, vehicle: null, promo: null }),
  sessions: () => ({ created_at: now(), role: "admin" }),
  products: () => ({ short_desc: "", description: "", brand: "", mrp: null, cost_price: null, gst_rate: 18, hsn: "", stock: 0, low_stock_at: 5, status: "draft",
    universal: false, icon: "📦", images: [], video_url: null, specs: {}, included: "", install_difficulty: "Easy", install_guide: "", warranty: "",
    weight_g: 500, dims_cm: { l: 30, b: 20, h: 10 }, faqs: [], fit_notes: "", seo_title: "", meta_desc: "", created_at: now(), updated_at: now() }),
  vehicles: () => ({}),
  product_fitment: () => ({ model: null, year_from: null, year_to: null }),
  inventory_log: () => ({ created_at: now(), ref: null }),
  coupons: () => ({ min_order: 0, max_uses: null, uses: 0, expires_at: null, active: true, created_at: now() }),
  customers: () => ({ id: crypto.randomUUID(), phone: "", addresses: [], garage: [], wishlist: [], marketing_ok: false, reset_hash: null, reset_expires: null, created_at: now() }),
  reviews: () => ({ title: "", body: "", status: "pending", helpful: 0, reports: 0, created_at: now() }),
  returns: () => ({ details: "", photos: [], status: "requested", admin_note: "", refund_amount: null, restocked: false, history: [], created_at: now(), updated_at: now() }),
  subscribers: () => ({ created_at: now() }),
  events: () => ({ created_at: now() }),
  audit_log: () => ({ created_at: now() })
};
const SERIAL = new Set(["products", "vehicles", "product_fitment", "inventory_log", "reviews", "returns", "events", "audit_log"]);
const UNIQUE = {
  orders: [["order_id"], ["ref"], ["payment_id"], ["invoice_no"]], sessions: [["id"]], products: [["id"], ["sku"], ["slug"]],
  vehicles: [["make", "model"]], coupons: [["code"]], customers: [["id"], ["email"]], reviews: [["product_id", "customer_id"]], subscribers: [["email"]]
};
const CHECK = {
  orders: (r) => ["created", "paid", "cod", "expired"].includes(r.status) &&
    ["new", "packed", "shipped", "out_for_delivery", "delivered", "cancelled", "returned"].includes(r.fulfillment),
  products: (r) => r.stock >= 0 && ["active", "draft", "archived"].includes(r.status),
  returns: (r) => ["requested", "approved", "rejected", "picked_up", "received", "refunded", "replaced"].includes(r.status),
  reviews: (r) => r.rating >= 1 && r.rating <= 5 && ["pending", "approved", "rejected"].includes(r.status)
};

function createFake() {
  const tables = {}, seq = {}, files = {};
  let invoiceSeq = 0;
  const T = (n) => (tables[n] ||= []);
  const dup = (name, row, except) => (UNIQUE[name] || []).some((cols) =>
    cols.every((c) => row[c] != null) && T(name).some((x) => x !== except && cols.every((c) => x[c] === row[c])));
  const err = (message, code) => ({ message, code });

  class Query {
    constructor(name) { this.name = name; this.op = "select"; this.filters = []; this.orders = []; this.returning = false; }
    select(_cols, opts) { if (this.op === "select") this.countMode = opts && opts.count; else this.returning = true; return this; }
    insert(rows) { this.op = "insert"; this.payload = rows; return this; }
    update(obj) { this.op = "update"; this.payload = obj; return this; }
    upsert(rows, opts = {}) { this.op = "upsert"; this.payload = rows; this.opts = opts; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    lt(c, v) { this.filters.push((r) => r[c] < v); return this; }
    lte(c, v) { this.filters.push((r) => r[c] <= v); return this; }
    gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
    gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
    is(c, v) { this.filters.push((r) => r[c] === v); return this; }
    order(c, o = {}) { this.orders.push([c, o.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.single = "maybe"; return this; }
    single() { this.single = "one"; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    match() { return T(this.name).filter((r) => this.filters.every((f) => f(r))); }
    prep(row) {
      const r = { ...DEFAULTS[this.name]?.(), ...clone(row) };
      if (SERIAL.has(this.name) && r.id == null) r.id = (seq[this.name] = (seq[this.name] || 0) + 1);
      return r;
    }
    run() {
      const name = this.name, check = CHECK[name] || (() => true);
      let out = [];
      if (this.op === "insert" || this.op === "upsert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const staged = [];
        for (const raw of rows) {
          if (this.op === "upsert") {
            const cols = (this.opts.onConflict || "id").split(",");
            const hit = T(name).find((x) => cols.every((c) => x[c] === raw[c]));
            if (hit) { if (!this.opts.ignoreDuplicates) { Object.assign(hit, clone(raw)); out.push(hit); } continue; }
          }
          const r = this.prep(raw);
          if (dup(name, r) || staged.some((s) => (UNIQUE[name] || []).some((cols) => cols.every((c) => s[c] != null && s[c] === r[c]))))
            return { data: null, error: err(`duplicate key value violates unique constraint on ${name}`, "23505") };
          if (!check(r)) return { data: null, error: err(`new row for relation "${name}" violates check constraint`, "23514") };
          staged.push(r);
        }
        T(name).push(...staged); out.push(...staged);
      } else if (this.op === "update") {
        const hits = this.match();
        for (const h of hits) {
          const next = { ...h, ...clone(this.payload) };
          if (dup(name, next, h)) return { data: null, error: err("duplicate key value violates unique constraint", "23505") };
          if (!check(next)) return { data: null, error: err(`new row for relation "${name}" violates check constraint`, "23514") };
        }
        for (const h of hits) Object.assign(h, clone(this.payload));
        out = hits;
      } else if (this.op === "delete") {
        const hits = new Set(this.match());
        tables[name] = T(name).filter((r) => !hits.has(r));
        out = [...hits];
      } else {
        out = this.match();
        for (const [c, asc] of [...this.orders].reverse())
          out = [...out].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        if (this.lim != null) out = out.slice(0, this.lim);
      }
      if (this.op !== "select" && !this.returning) return { data: null, error: null };
      out = clone(out);
      if (this.single === "maybe") return { data: out[0] ?? null, error: null };
      if (this.single === "one") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: err("expected one row") };
      return { data: out, error: null };
    }
  }

  const logStock = (id, delta, after, reason, ref) =>
    T("inventory_log").push({ ...DEFAULTS.inventory_log(), id: (seq.inventory_log = (seq.inventory_log || 0) + 1), product_id: id, delta, stock_after: after, reason, ref: ref ?? null });

  const RPC = {
    reserve_stock({ p_items, p_ref }) {
      const products = T("products");
      for (const it of p_items) {
        const p = products.find((x) => x.id === Number(it.id));
        if (!p || p.status !== "active" || p.stock < it.qty) return { data: null, error: err(`out_of_stock:${it.id}`, "P0001") };
      }
      for (const it of p_items) { const p = products.find((x) => x.id === Number(it.id)); p.stock -= it.qty; logStock(p.id, -it.qty, p.stock, "order", p_ref); }
      return { data: null, error: null };
    },
    release_stock({ p_items, p_ref, p_reason }) {
      for (const it of p_items) {
        const p = T("products").find((x) => x.id === Number(it.id));
        if (p) { p.stock += it.qty; logStock(p.id, it.qty, p.stock, p_reason, p_ref); }
      }
      return { data: null, error: null };
    },
    adjust_stock({ p_id, p_delta, p_reason, p_ref }) {
      const p = T("products").find((x) => x.id === p_id);
      if (!p || p.stock + p_delta < 0) return { data: null, error: err("invalid_stock", "P0001") };
      p.stock += p_delta; logStock(p.id, p_delta, p.stock, p_reason, p_ref);
      return { data: p.stock, error: null };
    },
    next_invoice_no() { return { data: ++invoiceSeq, error: null }; },
    use_coupon({ p_code }) { const c = T("coupons").find((x) => x.code === p_code); if (c) c.uses++; return { data: null, error: null }; },
    sync_product_seq() { seq.products = Math.max(0, ...T("products").map((p) => p.id)); return { data: null, error: null }; }
  };

  return {
    tables, files,
    from: (name) => new Query(name),
    rpc: async (fn, args) => RPC[fn](args || {}),
    storage: {
      from: (bucket) => ({
        upload: async (path, buf, opts) => { files[bucket + "/" + path] = { buf, type: opts.contentType }; return { data: { path }, error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }),
        createSignedUrl: async (path) => ({ data: { signedUrl: `https://storage.test/signed/${bucket}/${path}` }, error: null })
      })
    }
  };
}

module.exports = { createFake };
