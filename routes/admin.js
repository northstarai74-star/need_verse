// Admin API. Every route needs an admin session (or Basic auth when 2FA is off),
// and every change is written to the audit log.
const express = require("express");
const db = require("../db");
const Core = require("../public/core");
const catalog = require("../lib/catalog");
const orders = require("../lib/orders");
const shipping = require("../lib/shipping");
const analytics = require("../lib/analytics");
const mail = require("../mailer");
const wa = require("../lib/whatsapp");
const { parseImage } = require("../lib/uploads");
const purchasing = require("../lib/purchasing");
const { requireAdmin } = require("../lib/auth");
const { clip } = require("../lib/security");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const actor = (req) => req.session?.userId || "admin (basic auth)";
const log = (req, action, target, details) => db.audit(actor(req), action, target, details, req.ip);
const bad = (res, error, status = 400) => res.status(status).json({ error });
const csvCell = (v) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n");
const GST = [0, 5, 12, 18, 28];

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Validates a product from the admin form. Returns {product, fitment} or {error}.
async function cleanProduct(b, existing) {
  const p = {
    sku: clip(b.sku, 40).toUpperCase(), name: clip(b.name, 120), slug: Core.slugify(b.slug || b.name || ""), shortDesc: clip(b.shortDesc, 200),
    description: clip(b.description, 5000), category: clip(b.category, 40), brand: clip(b.brand, 60), price: Number(b.price),
    mrp: b.mrp === "" || b.mrp == null ? null : Number(b.mrp), costPrice: b.costPrice === "" || b.costPrice == null ? null : Number(b.costPrice),
    gstRate: Number(b.gstRate ?? 18), hsn: clip(b.hsn, 10), lowStockAt: Number(b.lowStockAt ?? 5), status: b.status || "draft",
    universal: b.universal === true, icon: clip(b.icon, 8) || "📦", videoUrl: clip(b.videoUrl, 300) || null, included: clip(b.included, 500),
    installDifficulty: clip(b.installDifficulty, 60) || "Easy", installGuide: clip(b.installGuide, 5000), warranty: clip(b.warranty, 200),
    weightG: Number(b.weightG ?? 500), fitNotes: clip(b.fitNotes, 300), seoTitle: clip(b.seoTitle, 70), metaDesc: clip(b.metaDesc, 160),
    images: (Array.isArray(b.images) ? b.images : []).map((u) => clip(u, 500)).filter((u) => /^https:\/\//.test(u)).slice(0, 8),
    specs: Object.fromEntries(Object.entries(b.specs && typeof b.specs === "object" ? b.specs : {}).slice(0, 30).map(([k, v]) => [clip(k, 60), clip(v, 200)]).filter(([k, v]) => k && v)),
    faqs: (Array.isArray(b.faqs) ? b.faqs : []).slice(0, 10).map((f) => ({ q: clip(f?.q, 200), a: clip(f?.a, 1000) })).filter((f) => f.q && f.a),
    dims: { l: Number(b.dims?.l) || 30, b: Number(b.dims?.b) || 20, h: Number(b.dims?.h) || 10 },
    supplierId: b.supplierId === "" || b.supplierId == null ? null : Number(b.supplierId), supplierSku: clip(b.supplierSku, 60)
  };
  if (!p.name) return { error: "Enter a product name." };
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(p.sku)) return { error: "SKU must be 2 to 40 letters, numbers, dashes or underscores." };
  if (!p.slug) return { error: "Enter a URL slug." };
  if (!Core.CATS[p.category]) return { error: "Choose a category." };
  if (!(p.price >= 0)) return { error: "Enter a valid price." };
  if (p.mrp != null && !(p.mrp >= p.price)) return { error: "MRP must be at least the selling price, or left empty." };
  if (p.costPrice != null && !(p.costPrice >= 0)) return { error: "Cost price must be 0 or more." };
  if (!GST.includes(p.gstRate)) return { error: "GST rate must be 0, 5, 12, 18 or 28." };
  if (!["active", "draft", "archived"].includes(p.status)) return { error: "Invalid status." };
  if (!(p.weightG > 0)) return { error: "Enter the packed weight in grams." };
  if (p.videoUrl && !/^https:\/\//.test(p.videoUrl)) return { error: "Video link must start with https://" };
  if (p.supplierId != null && !(await db.getSupplier(p.supplierId))) return { error: "Choose a supplier from the list." };
  const all = await db.listProducts();
  if (all.some((x) => x.sku === p.sku && x.id !== existing?.id)) return { error: `Another product already uses SKU ${p.sku}.` };
  if (all.some((x) => x.slug === p.slug && x.id !== existing?.id)) return { error: `Another product already uses the URL /p/${p.slug}.` };
  const { vehicles } = await catalog.get();
  const fitment = [];
  for (const f of Array.isArray(b.fitment) ? b.fitment.slice(0, 200) : []) {
    const make = clip(f.make, 40), model = clip(f.model, 40) || null;
    const yearFrom = f.yearFrom ? Number(f.yearFrom) : null, yearTo = f.yearTo ? Number(f.yearTo) : null;
    if (!vehicles[make]) return { error: `Unknown make "${make}". Add it under Vehicles first.` };
    if (model && !vehicles[make][model]) return { error: `Unknown model "${make} ${model}". Add it under Vehicles first.` };
    if ((yearFrom && !Number.isInteger(yearFrom)) || (yearTo && !Number.isInteger(yearTo)) || (yearFrom && yearTo && yearFrom > yearTo)) return { error: "Fitment years are invalid." };
    fitment.push({ make, model, yearFrom, yearTo });
  }
  if (!p.universal && !fitment.length && p.status === "active") return { error: "Add at least one vehicle this fits, or mark it as fitting every vehicle." };
  return { product: p, fitment };
}

module.exports = function admin(ctx) {
  const r = express.Router();
  r.use("/api/admin", requireAdmin);

  // ----- Setup status -----
  r.get("/api/admin/status", wrap(async (req, res) => {
    const e = process.env;
    res.json({
      email: mail.emailEnabled, whatsapp: wa.enabled(), shiprocket: shipping.enabled(), webhook: !!e.RAZORPAY_WEBHOOK_SECRET, twoFactor: !!e.ADMIN_TOTP_SECRET,
      assistant: !!e.ANTHROPIC_API_KEY, publicUrl: !!e.PUBLIC_URL, business: !!(e.BUSINESS_NAME && e.BUSINESS_ADDRESS && e.BUSINESS_GSTIN && e.BUSINESS_STATE),
      grievance: !!(e.GRIEVANCE_OFFICER && e.GRIEVANCE_EMAIL), errorAlerts: !!e.ERROR_WEBHOOK_URL, testMode: String(ctx.keyId).startsWith("rzp_test_")
    });
  }));

  // ----- Orders -----
  r.get("/api/admin/orders", wrap(async (req, res) => {
    const list = await db.listOrders();
    for (const o of list) await orders.withItems(o);
    res.json({ symbol: Core.STORE.symbol, next: orders.NEXT, shiprocket: shipping.enabled(), orders: list.map((o) => ({ ...o, lines: o.items, links: orders.links(o) })) });
  }));

  r.post("/api/admin/orders/:id/fulfillment", wrap(async (req, res) => {
    const { status, tracking } = req.body || {};
    if (!orders.NEXT[status]) return bad(res, "Invalid status");
    let track = null;
    if (status === "shipped" && tracking && typeof tracking === "object") {
      const url = clip(tracking.url, 300);
      if (url && !/^https?:\/\//i.test(url)) return bad(res, "Tracking link must start with http:// or https://");
      track = { carrier: clip(tracking.carrier, 60), number: clip(tracking.number, 60), url };
    }
    try {
      const out = await orders.setFulfillment(req.params.id, status, actor(req), { tracking: track });
      await log(req, `order ${status}`, out.order.ref, track);
      res.json({ ok: true, emailed: out.emailed, emailError: out.emailError, alreadyEmailed: out.alreadyEmailed });
    } catch (e) { if (e instanceof orders.OrderError) return bad(res, e.message, e.status); throw e; }
  }));

  r.post("/api/admin/orders/:id/refund", wrap(async (req, res) => {
    try {
      const out = await orders.refund(req.params.id, req.body?.amount, req.body?.reason, actor(req), ctx.rzp);
      await log(req, "refund", out.order.ref, { amount: out.refund.amount, reason: out.refund.reason });
      res.json({ ok: true, refund: out.refund, refunded: out.refunded });
    } catch (e) { if (e instanceof orders.OrderError) return bad(res, e.message, e.status); throw e; }
  }));

  r.post("/api/admin/orders/:id/shipment", wrap(async (req, res) => {
    const o = await orders.withItems(await db.getOrder(req.params.id));
    if (!o) return bad(res, "Order not found", 404);
    if (!["paid", "cod"].includes(o.status) || !["new", "packed"].includes(o.fulfillment)) return bad(res, "Book a courier for paid or COD orders that haven't shipped yet.");
    if (o.shipment?.shipmentId) return bad(res, "A courier is already booked for this order.");
    let s;
    try { s = await shipping.createShipment(o, o.items); } catch (e) { return bad(res, e.message, 502); }
    await db.updateOrder(o.orderId, (x) => { x.shipment = s; x.tracking = { carrier: s.courier || "", number: s.awb || "", url: s.trackingUrl || "" }; });
    await log(req, "courier booked", o.ref, s);
    res.json({ ok: true, shipment: s });
  }));

  r.post("/api/admin/orders/:id/note", wrap(async (req, res) => {
    const note = clip(req.body.note, 500);
    if (!note) return bad(res, "Write a note.");
    const o = await db.updateOrder(req.params.id, (x) => { x.history = [...(x.history || []), { at: new Date().toISOString(), event: "note", by: actor(req), note }]; });
    if (!o) return bad(res, "Order not found", 404);
    await log(req, "order note", o.ref, { note });
    res.json({ ok: true });
  }));

  r.get("/api/admin/orders.csv", wrap(async (req, res) => {
    const rows = [["Ref", "Invoice", "Date", "Payment", "Method", "Fulfilment", "Subtotal", "Discount", "Shipping", "COD fee", "GST included", "Total", "Refunded",
      "Name", "Email", "Phone", "Address", "City", "State", "PIN", "Items", "Payment ID", "AWB"]];
    for (const o of await db.listOrders()) {
      await orders.withItems(o);
      const t = o.totals || {};
      rows.push([o.ref, o.invoiceNo || "", o.createdAt, o.status, o.paymentMethod, o.fulfillment, t.sub ?? "", t.disc ?? "", t.ship ?? "", t.codFee ?? "", t.tax ?? "", o.amount, o.refunded || 0,
        o.customer.name, o.customer.email, o.customer.phone, o.customer.addr, o.customer.city, o.customer.state || "", o.customer.zip,
        o.items.map((l) => `${l.sku || l.id} ${l.name} x${l.qty}`).join("; "), o.paymentId || "", o.shipment?.awb || ""]);
    }
    res.type("text/csv").attachment("orders.csv").send(toCsv(rows));
  }));

  // ----- Products and inventory -----
  r.get("/api/admin/products", wrap(async (req, res) => {
    const [list, fit] = await Promise.all([db.listProducts(), db.listFitment()]);
    res.json({ products: list.map((p) => ({ ...p, fitment: fit.filter((f) => f.productId === p.id) })), cats: Object.keys(Core.CATS), vehicles: (await catalog.get()).vehicles });
  }));

  r.post("/api/admin/products", wrap(async (req, res) => {
    const c = await cleanProduct(req.body || {});
    if (c.error) return bad(res, c.error);
    const stock = Math.max(0, Math.floor(Number(req.body.stock) || 0));
    const p = await db.insertProduct({ ...c.product, stock: 0 });
    await db.setFitment(p.id, c.fitment);
    if (stock) await db.adjustStock(p.id, stock, "restock", "new product");
    catalog.invalidate();
    await log(req, "product created", p.sku, { name: p.name, price: p.price, stock });
    res.json({ product: await db.getProduct(p.id) });
  }));

  r.put("/api/admin/products/:id", wrap(async (req, res) => {
    const cur = await db.getProduct(Number(req.params.id));
    if (!cur) return bad(res, "Product not found", 404);
    const c = await cleanProduct(req.body || {}, cur);
    if (c.error) return bad(res, c.error);
    const p = await db.updateProduct(cur.id, c.product);
    await db.setFitment(cur.id, c.fitment);
    catalog.invalidate();
    const changed = Object.keys(c.product).filter((k) => JSON.stringify(c.product[k]) !== JSON.stringify(cur[k]));
    await log(req, "product updated", p.sku, Object.fromEntries(changed.map((k) => [k, { from: cur[k], to: c.product[k] }])));
    res.json({ product: p });
  }));

  r.post("/api/admin/products/:id/stock", wrap(async (req, res) => {
    const id = Number(req.params.id), delta = Math.trunc(Number(req.body.delta));
    const reason = ["restock", "adjust", "damaged", "return"].includes(req.body.reason) ? req.body.reason : "adjust";
    if (!delta) return bad(res, "Enter how many units to add (or a negative number to remove).");
    const left = await db.adjustStock(id, delta, reason, clip(req.body.note, 100) || null);
    if (left == null) return bad(res, "Stock can't go below zero.");
    catalog.invalidate();
    await log(req, "stock " + reason, id, { delta, stockAfter: left });
    res.json({ stock: left });
  }));

  r.get("/api/admin/inventory", wrap(async (req, res) => {
    res.json({ log: await db.inventoryLog(req.query.product ? Number(req.query.product) : null) });
  }));

  const CSV_COLS = ["sku", "name", "category", "price", "mrp", "cost_price", "stock", "status", "gst_rate", "hsn", "brand", "short_desc", "weight_g", "universal", "fits", "supplier", "supplier_sku"];
  r.get("/api/admin/products.csv", wrap(async (req, res) => {
    const [list, fit, sups] = await Promise.all([db.listProducts(), db.listFitment(), db.listSuppliers()]);
    const supName = (id) => sups.find((x) => x.id === id)?.name || "";
    const fits = (id) => fit.filter((f) => f.productId === id).map((f) => [f.make, f.model || "*", f.yearFrom || "", f.yearTo || ""].join(":")).join("|");
    res.type("text/csv").attachment("products.csv").send(toCsv([CSV_COLS, ...list.map((p) => [p.sku, p.name, p.category, p.price, p.mrp ?? "", p.costPrice ?? "", p.stock, p.status,
      p.gstRate, p.hsn, p.brand, p.shortDesc, p.weightG, p.universal ? "yes" : "no", fits(p.id), supName(p.supplierId), p.supplierSku])]));
  }));

  // Bulk create/update by SKU. "stock" sets the absolute stock level; "fits" is make:model:from:to joined by |.
  r.post("/api/admin/products/import", wrap(async (req, res) => {
    const rows = parseCsv(String(req.body.csv || ""));
    if (rows.length < 2) return bad(res, "Paste a CSV with a header row and at least one product.");
    const head = rows[0].map((h) => h.trim().toLowerCase());
    if (!head.includes("sku")) return bad(res, "The CSV needs a 'sku' column.");
    const results = [], sups = await db.listSuppliers();
    for (const [i, row] of rows.slice(1).entries()) {
      const v = Object.fromEntries(head.map((h, j) => [h, (row[j] ?? "").trim()]));
      const line = i + 2, cur = (await db.listProducts()).find((p) => p.sku === v.sku.toUpperCase());
      const fit = await db.listFitment();
      const base = cur ? { ...cur, fitment: fit.filter((f) => f.productId === cur.id) } : { status: "draft", gstRate: 18 };
      const merged = { ...base };
      const set = (k, key, conv = (x) => x) => { if (head.includes(k) && v[k] !== "") merged[key] = conv(v[k]); };
      set("sku", "sku"); set("name", "name"); set("category", "category"); set("price", "price", Number); set("mrp", "mrp", Number); set("cost_price", "costPrice", Number);
      set("status", "status"); set("gst_rate", "gstRate", Number); set("hsn", "hsn"); set("brand", "brand"); set("short_desc", "shortDesc"); set("weight_g", "weightG", Number);
      set("universal", "universal", (x) => /^(yes|true|1)$/i.test(x));
      set("supplier_sku", "supplierSku");
      if (head.includes("supplier") && v.supplier !== "") {
        const sup = sups.find((x) => x.name.toLowerCase() === v.supplier.toLowerCase());
        if (!sup) { results.push({ line, sku: v.sku, error: `No supplier called "${v.supplier}". Add it under Suppliers first.` }); continue; }
        merged.supplierId = sup.id;
      }
      if (head.includes("fits") && v.fits !== "") merged.fitment = v.fits.split("|").map((s) => { const [make, model, a, b] = s.split(":"); return { make, model: model && model !== "*" ? model : null, yearFrom: a || null, yearTo: b || null }; });
      const c = await cleanProduct(merged, cur);
      if (c.error) { results.push({ line, sku: v.sku, error: c.error }); continue; }
      let p = cur ? await db.updateProduct(cur.id, c.product) : await db.insertProduct({ ...c.product, stock: 0 });
      await db.setFitment(p.id, c.fitment);
      if (head.includes("stock") && v.stock !== "") {
        const target = Math.max(0, Math.floor(Number(v.stock))), delta = target - (cur ? (await db.getProduct(p.id)).stock : 0);
        if (delta) await db.adjustStock(p.id, delta, "import", "csv import");
      }
      results.push({ line, sku: p.sku, ok: cur ? "updated" : "created" });
    }
    catalog.invalidate();
    await log(req, "products imported", null, { rows: results.length, errors: results.filter((x) => x.error).length });
    res.json({ results });
  }));

  r.post("/api/admin/uploads", wrap(async (req, res) => {
    const img = parseImage(req.body.data, 5 * 1024 * 1024);
    if (img.error) return bad(res, img.error);
    const f = await db.uploadFile("product-images", img.name, img.buf, img.type);
    await log(req, "image uploaded", f.path);
    res.json({ url: f.url });
  }));

  // ----- Vehicles -----
  r.get("/api/admin/vehicles", wrap(async (req, res) => res.json({ vehicles: await db.listVehicles() })));
  r.post("/api/admin/vehicles", wrap(async (req, res) => {
    const v = { make: clip(req.body.make, 40), model: clip(req.body.model, 40), yearFrom: Number(req.body.yearFrom), yearTo: Number(req.body.yearTo) };
    const maxYear = new Date().getFullYear() + 1;
    if (!v.make || !v.model) return bad(res, "Enter a make and model.");
    if (!Number.isInteger(v.yearFrom) || !Number.isInteger(v.yearTo) || v.yearFrom < 1980 || v.yearTo > maxYear || v.yearFrom > v.yearTo) return bad(res, `Enter years between 1980 and ${maxYear}.`);
    await db.upsertVehicles([v]);
    catalog.invalidate();
    await log(req, "vehicle saved", `${v.make} ${v.model}`, v);
    res.json({ vehicles: await db.listVehicles() });
  }));
  r.delete("/api/admin/vehicles/:id", wrap(async (req, res) => {
    await db.deleteVehicle(Number(req.params.id));
    catalog.invalidate();
    await log(req, "vehicle deleted", req.params.id);
    res.json({ vehicles: await db.listVehicles() });
  }));

  // ----- Customers -----
  r.get("/api/admin/customers", wrap(async (req, res) => {
    const [list, all] = await Promise.all([db.listCustomers(), db.listOrders()]);
    const live = all.filter((o) => o.status === "paid" || o.status === "cod");
    const view = (email, extra) => {
      const mine = live.filter((o) => o.customer.email.toLowerCase() === email);
      const rets = all.filter((o) => o.customer.email.toLowerCase() === email && o.refunded > 0).length;
      return { email, orders: mine.length, spent: Math.round(mine.reduce((s, o) => s + o.amount - (o.refunded || 0), 0) * 100) / 100, refundedOrders: rets,
        lastOrder: mine[0]?.createdAt || null, ...extra };
    };
    const seen = new Set(list.map((c) => c.email));
    const guests = [...new Set(live.map((o) => o.customer.email.toLowerCase()))].filter((e) => !seen.has(e));
    res.json({ customers: [
      ...list.map((c) => view(c.email, { id: c.id, name: c.name, phone: c.phone, account: true, garage: c.garage, addresses: c.addresses.length, marketingOk: c.marketingOk, createdAt: c.createdAt })),
      ...guests.map((e) => { const o = live.find((x) => x.customer.email.toLowerCase() === e); return view(e, { name: o.customer.name, phone: o.customer.phone, account: false }); })
    ] });
  }));
  r.get("/api/admin/subscribers.csv", wrap(async (req, res) => {
    res.type("text/csv").attachment("subscribers.csv").send(toCsv([["email", "subscribed"], ...(await db.listSubscribers()).map((s) => [s.email, s.createdAt])]));
  }));

  // ----- Coupons -----
  r.get("/api/admin/coupons", wrap(async (req, res) => res.json({ coupons: await db.listCoupons() })));
  r.post("/api/admin/coupons", wrap(async (req, res) => {
    const c = { code: clip(req.body.code, 30).toUpperCase(), percent: Number(req.body.percent), minOrder: Number(req.body.minOrder) || 0,
      maxUses: req.body.maxUses ? Number(req.body.maxUses) : null, expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : null, active: req.body.active !== false };
    if (!/^[A-Z0-9_-]{3,30}$/.test(c.code)) return bad(res, "Codes are 3 to 30 letters or numbers.");
    if (!(c.percent > 0 && c.percent <= 90)) return bad(res, "Discount must be between 1% and 90%.");
    if (c.maxUses != null && !(Number.isInteger(c.maxUses) && c.maxUses > 0)) return bad(res, "Max uses must be a whole number.");
    await db.upsertCoupon(c);
    await log(req, "coupon saved", c.code, c);
    res.json({ coupons: await db.listCoupons() });
  }));

  // ----- Reviews -----
  r.get("/api/admin/reviews", wrap(async (req, res) => {
    const [list, products] = await Promise.all([db.listReviews(), db.listProducts()]);
    const name = new Map(products.map((p) => [p.id, p.name]));
    res.json({ reviews: list.map((v) => ({ ...v, product: name.get(v.productId) || "Product " + v.productId })) });
  }));
  r.post("/api/admin/reviews/:id", wrap(async (req, res) => {
    const status = req.body.status;
    if (!["approved", "rejected", "pending"].includes(status)) return bad(res, "Invalid status.");
    const v = await db.getReview(Number(req.params.id));
    if (!v) return bad(res, "Review not found", 404);
    await db.updateReview(v.id, { status, ...(status === "approved" ? { reports: 0 } : {}) });
    catalog.invalidate();
    await log(req, "review " + status, v.id, { product: v.productId, rating: v.rating });
    res.json({ ok: true });
  }));

  // ----- Returns -----
  const RET_NEXT = { requested: ["approved", "rejected"], approved: ["picked_up", "received", "rejected"], picked_up: ["received"], received: ["refunded", "replaced"], rejected: [], refunded: [], replaced: [] };
  r.get("/api/admin/returns", wrap(async (req, res) => {
    const list = await db.listReturns();
    for (const x of list) x.photoUrls = await Promise.all(x.photos.map((p) => db.signedUrl("return-photos", p)));
    res.json({ returns: list, next: RET_NEXT });
  }));
  r.post("/api/admin/returns/:id", wrap(async (req, res) => {
    const ret = await db.getReturn(Number(req.params.id));
    if (!ret) return bad(res, "Return not found", 404);
    const status = req.body.status, note = clip(req.body.adminNote, 500);
    if (!RET_NEXT[ret.status].includes(status)) return bad(res, `A ${ret.status.replace("_", " ")} return can't move to ${String(status).replace("_", " ")}.`);
    const o = await orders.withItems(await db.getOrder(ret.orderId));
    let refundAmount = null;
    if (status === "refunded") {
      const value = ret.items.reduce((s, l) => s + l.price * l.qty, 0);
      refundAmount = req.body.refundAmount === "" || req.body.refundAmount == null ? Math.min(value, o.amount - (o.refunded || 0)) : Number(req.body.refundAmount);
      try { await orders.refund(o.orderId, refundAmount, `Return #${ret.id}`, actor(req), ctx.rzp); }
      catch (e) { if (e instanceof orders.OrderError) return bad(res, e.message, e.status); throw e; }
    }
    let restocked = ret.restocked;
    if (status === "received" && req.body.restock === true && !ret.restocked) {
      await db.releaseStock(ret.items, o.ref, "return");
      restocked = true; catalog.invalidate();
    }
    const saved = await db.updateReturn(ret.id, { status, adminNote: note || ret.adminNote, restocked, ...(refundAmount != null ? { refundAmount } : {}),
      history: [...ret.history, { at: new Date().toISOString(), status, by: actor(req), note }] });
    // Whole order came back: mark it returned. Stock was handled above by the restock choice, so don't release it again.
    if (["received", "refunded"].includes(status) && ret.items.reduce((s, l) => s + l.qty, 0) >= o.items.reduce((s, l) => s + l.qty, 0))
      await db.updateOrder(o.orderId, (x) => {
        if (x.fulfillment !== "delivered") return false;
        x.fulfillment = "returned"; x.stockReserved = false;
        x.history = [...(x.history || []), { at: new Date().toISOString(), event: "returned", by: actor(req) }];
      });
    mail.sendReturnUpdate(o, saved).catch((e) => console.error("Return email:", e.message));
    await log(req, "return " + status, o.ref, { returnId: ret.id, refundAmount, restocked });
    res.json({ return: saved });
  }));

  // ----- Suppliers and purchase orders -----
  const pfail = (res, e) => { if (e instanceof purchasing.PurchaseError) return bad(res, e.message, e.status); throw e; };
  r.get("/api/admin/suppliers", wrap(async (req, res) => {
    const [sups, products, pos] = await Promise.all([db.listSuppliers(), db.listProducts(), db.listPurchaseOrders()]);
    res.json({ suppliers: sups.map((s) => ({ ...s,
      products: products.filter((p) => p.supplierId === s.id).length,
      openOrders: pos.filter((po) => po.supplierId === s.id && purchasing.OPEN.includes(po.status)).length,
      received: Math.round(pos.filter((po) => po.supplierId === s.id).reduce((t, po) => t + po.items.reduce((u, l) => u + l.received * l.cost, 0), 0) * 100) / 100 })) });
  }));
  for (const [method, path] of [["post", "/api/admin/suppliers"], ["put", "/api/admin/suppliers/:id"]]) {
    r[method](path, wrap(async (req, res) => {
      const c = purchasing.cleanSupplier(req.body || {});
      if (c.error) return bad(res, c.error);
      const id = req.params.id ? Number(req.params.id) : null;
      if (id && !(await db.getSupplier(id))) return bad(res, "Supplier not found", 404);
      const saved = await db.saveSupplier(id, c.supplier);
      if (!saved) return bad(res, `A supplier called ${c.supplier.name} already exists.`, 409);
      await log(req, id ? "supplier updated" : "supplier created", saved.name, c.supplier);
      res.json({ supplier: saved });
    }));
  }

  r.get("/api/admin/purchase-orders", wrap(async (req, res) => {
    const [pos, sups] = await Promise.all([db.listPurchaseOrders(), db.listSuppliers()]);
    res.json({ orders: pos, suppliers: sups });
  }));
  r.post("/api/admin/purchase-orders", wrap(async (req, res) => {
    try { const po = await purchasing.createPO(req.body || {}, actor(req)); await log(req, "purchase order created", po.poNo, { total: po.total }); res.json({ order: po }); }
    catch (e) { pfail(res, e); }
  }));
  r.put("/api/admin/purchase-orders/:id", wrap(async (req, res) => {
    try { const po = await purchasing.editPO(Number(req.params.id), req.body || {}, actor(req)); await log(req, "purchase order edited", po.poNo, { total: po.total }); res.json({ order: po }); }
    catch (e) { pfail(res, e); }
  }));
  r.post("/api/admin/purchase-orders/:id/send", wrap(async (req, res) => {
    try {
      const po = await purchasing.setStatus(Number(req.params.id), "sent", actor(req)), sup = await db.getSupplier(po.supplierId);
      let emailed = false, emailError = null;
      if (req.body.email !== false) {
        if (!sup.email) emailError = "This supplier has no email address, so nothing was emailed.";
        else try { emailed = await mail.sendPurchaseOrder(po, sup, purchasing.poHtml(po, sup)); if (!emailed) emailError = "Email is not configured on the server (SMTP settings)."; }
        catch (e) { emailError = "Could not send the email: " + e.message; }
      }
      await log(req, "purchase order sent", po.poNo, { emailed });
      res.json({ order: po, emailed, emailError });
    } catch (e) { pfail(res, e); }
  }));
  r.post("/api/admin/purchase-orders/:id/cancel", wrap(async (req, res) => {
    try { const po = await purchasing.setStatus(Number(req.params.id), "cancelled", actor(req)); await log(req, "purchase order cancelled", po.poNo); res.json({ order: po }); }
    catch (e) { pfail(res, e); }
  }));
  r.post("/api/admin/purchase-orders/:id/receive", wrap(async (req, res) => {
    try {
      const po = await purchasing.receive(Number(req.params.id), req.body.lines, { updateCost: req.body.updateCost === true }, actor(req));
      await log(req, "purchase order received", po.poNo, { lines: req.body.lines, status: po.status });
      res.json({ order: po });
    } catch (e) { pfail(res, e); }
  }));
  r.get("/api/admin/purchase-orders/:id/print", wrap(async (req, res) => {
    const po = await db.getPurchaseOrder(Number(req.params.id));
    if (!po) return res.status(404).send("Purchase order not found.");
    const sup = await db.getSupplier(po.supplierId);
    res.set("Cache-Control", "no-store").type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${po.poNo}</title>
      <style>@media print{button{display:none}}</style></head><body style="padding:16px"><button onclick="print()" style="margin-bottom:16px;padding:8px 16px">Print or save as PDF</button>${purchasing.poHtml(po, sup)}</body></html>`);
  }));
  r.get("/api/admin/reorder", wrap(async (req, res) => {
    const [products, all, pos, suppliers] = await Promise.all([db.listProducts(), db.listOrders(), db.listPurchaseOrders(), db.listSuppliers()]);
    res.json({ suggestions: purchasing.suggestions({ products, orders: all, pos, suppliers }) });
  }));

  // ----- Analytics, audit -----
  r.get("/api/admin/analytics", wrap(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const [all, events, products] = await Promise.all([db.listOrders(), db.listEvents(new Date(Date.now() - days * 864e5).toISOString()), db.listProducts()]);
    res.json(analytics.summarize({ orders: all, events, products, days }));
  }));
  r.get("/api/admin/audit", wrap(async (req, res) => res.json({ log: await db.listAudit() })));

  return r;
};
