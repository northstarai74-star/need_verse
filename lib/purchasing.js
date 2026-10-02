// Suppliers, purchase orders and reorder suggestions.
const db = require("../db");
const catalog = require("./catalog");
const { STATES, money } = require("../public/core");
const { clip, esc, validEmail } = require("./security");

class PurchaseError extends Error { constructor(status, message) { super(message); this.status = status; } }
const r2 = (n) => Math.round(n * 100) / 100;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const OPEN = ["draft", "sent", "partially_received"];

function cleanSupplier(b) {
  const s = {
    name: clip(b.name, 120), contactName: clip(b.contactName, 100), email: clip(b.email, 120).toLowerCase(), phone: clip(b.phone, 20),
    gstin: clip(b.gstin, 15).toUpperCase(), address: clip(b.address, 300), state: clip(b.state, 60), paymentTerms: clip(b.paymentTerms, 60),
    leadTimeDays: Number(b.leadTimeDays ?? 7), notes: clip(b.notes, 1000), active: b.active !== false
  };
  if (!s.name) return { error: "Enter the supplier's name." };
  if (s.email && !validEmail(s.email)) return { error: "Enter a valid email address, or leave it empty." };
  if (s.gstin && !GSTIN.test(s.gstin)) return { error: "That GSTIN doesn't look right. It should be 15 characters, like 29ABCDE1234F1Z5." };
  if (s.state && !STATES.includes(s.state)) return { error: "Choose the supplier's state from the list." };
  if (!Number.isInteger(s.leadTimeDays) || s.leadTimeDays < 0 || s.leadTimeDays > 365) return { error: "Lead time must be 0 to 365 days." };
  return { supplier: s };
}

// lines: [{productId, qty, cost}] -> full PO items from the catalogue.
async function buildItems(lines, supplierId) {
  const products = new Map((await db.listProducts()).map((p) => [p.id, p]));
  const items = [];
  for (const l of Array.isArray(lines) ? lines.slice(0, 200) : []) {
    const p = products.get(Number(l.productId)), qty = Number(l.qty), cost = l.cost === "" || l.cost == null ? p?.costPrice ?? null : Number(l.cost);
    if (!p) throw new PurchaseError(400, "A product on this order doesn't exist.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new PurchaseError(400, `Enter a whole-number quantity for ${p.name}.`);
    if (cost == null || !(cost >= 0)) throw new PurchaseError(400, `Enter the cost price for ${p.name}.`);
    if (items.some((x) => x.productId === p.id)) throw new PurchaseError(400, `${p.name} is listed twice.`);
    items.push({ productId: p.id, name: p.name, sku: p.sku, supplierSku: p.supplierId === supplierId ? p.supplierSku : "", qty, received: 0, cost: r2(cost) });
  }
  if (!items.length) throw new PurchaseError(400, "Add at least one product.");
  return items;
}
const total = (items) => r2(items.reduce((s, l) => s + l.qty * l.cost, 0));
const hist = (po, event, by, extra) => [...(po.history || []), { at: new Date().toISOString(), event, by, ...(extra || {}) }];

async function createPO({ supplierId, lines, notes, expectedAt }, by) {
  const sup = await db.getSupplier(Number(supplierId));
  if (!sup) throw new PurchaseError(400, "Choose a supplier.");
  const items = await buildItems(lines, sup.id);
  const n = await db.nextPoNo();
  const year = new Date().getFullYear();
  return db.insertPurchaseOrder({
    poNo: `PO-${year}-${String(n).padStart(4, "0")}`, supplierId: sup.id, status: "draft", items, total: total(items),
    notes: clip(notes, 1000), expectedAt: expectedAt ? String(expectedAt).slice(0, 10) : null, history: [{ at: new Date().toISOString(), event: "created", by }]
  });
}

async function editPO(id, { lines, notes, expectedAt }, by) {
  const po = await db.getPurchaseOrder(id);
  if (!po) throw new PurchaseError(404, "Purchase order not found.");
  if (po.status !== "draft") throw new PurchaseError(400, "Only draft purchase orders can be edited.");
  const items = await buildItems(lines, po.supplierId);
  return db.updatePurchaseOrder(id, { items, total: total(items), notes: clip(notes, 1000), expectedAt: expectedAt ? String(expectedAt).slice(0, 10) : null, history: hist(po, "edited", by) });
}

async function setStatus(id, status, by) {
  const po = await db.getPurchaseOrder(id);
  if (!po) throw new PurchaseError(404, "Purchase order not found.");
  const ok = { sent: ["draft"], cancelled: ["draft", "sent"] }[status];
  if (!ok || !ok.includes(po.status)) throw new PurchaseError(400, `A ${po.status.replace("_", " ")} purchase order can't be marked ${status}.`);
  return db.updatePurchaseOrder(id, { status, history: hist(po, status, by) });
}

// Receives goods: adds stock for each line, never more than was ordered. Optionally updates product cost prices.
const receiving = new Set();
async function receive(id, lines, { updateCost }, by) {
  if (receiving.has(id)) throw new PurchaseError(409, "This purchase order is already being received.");
  receiving.add(id);
  try {
    const po = await db.getPurchaseOrder(id);
    if (!po) throw new PurchaseError(404, "Purchase order not found.");
    if (!["sent", "partially_received"].includes(po.status)) throw new PurchaseError(400, "Mark the purchase order as sent before receiving goods.");
    const got = new Map((Array.isArray(lines) ? lines : []).map((l) => [Number(l.productId), Number(l.qty)]));
    const items = po.items.map((l) => ({ ...l }));
    let any = false;
    for (const l of items) {
      const q = got.get(l.productId) || 0;
      if (!Number.isInteger(q) || q < 0) throw new PurchaseError(400, `Enter a whole number for ${l.name}.`);
      if (q > l.qty - l.received) throw new PurchaseError(400, `Only ${l.qty - l.received} of ${l.name} are still due on this order.`);
      if (q) any = true;
    }
    if (!any) throw new PurchaseError(400, "Enter how many of at least one item arrived.");
    const done = [];
    for (const l of items) {
      const q = got.get(l.productId) || 0;
      if (!q) continue;
      const left = await db.adjustStock(l.productId, q, "restock", po.poNo);
      if (left == null) throw new PurchaseError(400, `Couldn't add stock for ${l.name}.`);
      l.received += q; done.push(`${l.name} ×${q}`);
      if (updateCost) await db.updateProduct(l.productId, { costPrice: l.cost });
    }
    const status = items.every((l) => l.received >= l.qty) ? "received" : "partially_received";
    catalog.invalidate();
    return db.updatePurchaseOrder(id, { items, status, history: hist(po, "received", by, { note: done.join(", ") }) });
  } finally { receiving.delete(id); }
}

// Products that need ordering: low or running out within the supplier's lead time, after counting stock already on order.
function suggestions({ products, orders, pos, suppliers }) {
  const since = Date.now() - 30 * 864e5, sold = {}, incoming = {};
  for (const o of orders) {
    if (!["paid", "cod"].includes(o.status) || o.fulfillment === "cancelled" || new Date(o.createdAt).getTime() < since) continue;
    for (const l of o.items || []) sold[l.id] = (sold[l.id] || 0) + l.qty;
  }
  for (const po of pos) if (OPEN.includes(po.status)) for (const l of po.items) incoming[l.productId] = (incoming[l.productId] || 0) + l.qty - l.received;
  const sup = new Map(suppliers.map((s) => [s.id, s]));
  const out = [];
  for (const p of products) {
    if (p.status !== "active") continue;
    const s = sup.get(p.supplierId), lead = s ? s.leadTimeDays : 7, daily = (sold[p.id] || 0) / 30, inc = incoming[p.id] || 0;
    const target = Math.max(p.lowStockAt * 2, Math.ceil(daily * (lead + 30)));
    const runningOut = p.stock <= p.lowStockAt || (daily > 0 && p.stock < daily * lead);
    const need = target - p.stock - inc;
    if (runningOut && need > 0)
      out.push({ productId: p.id, name: p.name, sku: p.sku, stock: p.stock, sold30: sold[p.id] || 0, incoming: inc, suggest: need,
        supplierId: p.supplierId || null, supplier: s ? s.name : null, cost: p.costPrice, daysLeft: daily ? Math.floor(p.stock / daily) : null });
  }
  return out.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.stock - b.stock);
}

function poHtml(po, s) {
  const b = process.env;
  return `<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#111">
  <h1 style="margin:0 0 4px;font-size:22px">Purchase order ${esc(po.poNo)}</h1>
  <p style="margin:0 0 16px;color:#555">${new Date(po.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}${po.expectedAt ? ` · Needed by ${new Date(po.expectedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}</p>
  <table style="width:100%;font-size:14px;margin-bottom:16px"><tr>
    <td style="vertical-align:top;width:50%"><b>From</b><br>${esc(b.BUSINESS_LEGAL_NAME || b.BUSINESS_NAME || "Needverse")}<br>${esc(b.BUSINESS_ADDRESS || "")}${b.BUSINESS_GSTIN ? `<br>GSTIN ${esc(b.BUSINESS_GSTIN)}` : ""}${b.BUSINESS_PHONE ? `<br>${esc(b.BUSINESS_PHONE)}` : ""}</td>
    <td style="vertical-align:top"><b>To</b><br>${esc(s.name)}${s.contactName ? `<br>Attn: ${esc(s.contactName)}` : ""}<br>${esc(s.address)}${s.gstin ? `<br>GSTIN ${esc(s.gstin)}` : ""}</td></tr></table>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr style="background:#f3f3f3"><th style="text-align:left;padding:8px;border:1px solid #ccc">Item</th><th style="text-align:left;padding:8px;border:1px solid #ccc">Your code</th><th style="padding:8px;border:1px solid #ccc">Qty</th><th style="text-align:right;padding:8px;border:1px solid #ccc">Unit cost</th><th style="text-align:right;padding:8px;border:1px solid #ccc">Amount</th></tr>
    ${po.items.map((l) => `<tr><td style="padding:8px;border:1px solid #ccc">${esc(l.name)}<br><small style="color:#777">${esc(l.sku)}</small></td><td style="padding:8px;border:1px solid #ccc">${esc(l.supplierSku || "-")}</td>
      <td style="padding:8px;border:1px solid #ccc;text-align:center">${l.qty}</td><td style="padding:8px;border:1px solid #ccc;text-align:right">${money(l.cost)}</td><td style="padding:8px;border:1px solid #ccc;text-align:right">${money(l.qty * l.cost)}</td></tr>`).join("")}
    <tr><td colspan="4" style="padding:8px;border:1px solid #ccc;text-align:right"><b>Total</b></td><td style="padding:8px;border:1px solid #ccc;text-align:right"><b>${money(po.total)}</b></td></tr></table>
  ${s.paymentTerms ? `<p style="margin:16px 0 0"><b>Payment terms:</b> ${esc(s.paymentTerms)}</p>` : ""}
  ${po.notes ? `<p style="margin:8px 0 0"><b>Notes:</b> ${esc(po.notes)}</p>` : ""}
  <p style="margin:16px 0 0;color:#777;font-size:12px">Please quote ${esc(po.poNo)} on your invoice and delivery challan.</p></div>`;
}

module.exports = { PurchaseError, cleanSupplier, createPO, editPO, setStatus, receive, suggestions, poHtml, OPEN };
