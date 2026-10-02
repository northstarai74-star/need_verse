// Customer return requests. Only delivered orders, inside the return window, for items
// and quantities that haven't already been returned.
const db = require("../db");
const mail = require("../mailer");
const { STORE, money } = require("../public/core");
const { clip, esc } = require("./security");
const { parseImage } = require("./uploads");

const REASONS = ["Doesn't fit my car", "Damaged or defective", "Wrong item received", "Missing parts", "No longer needed", "Other"];

class ReturnError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function createReturn(o, input, customerId) {
  if (o.fulfillment !== "delivered" || !o.deliveredAt) throw new ReturnError(400, "Returns can be requested once your order is delivered.");
  if (Date.now() - new Date(o.deliveredAt).getTime() > STORE.returnDays * 864e5)
    throw new ReturnError(400, `The ${STORE.returnDays}-day return window for this order has closed. Contact us if something is wrong.`);
  const reason = REASONS.includes(input.reason) ? input.reason : null;
  if (!reason) throw new ReturnError(400, "Choose a reason for the return.");

  const previous = (await db.listReturns({ orderId: o.orderId })).filter((r) => r.status !== "rejected");
  const used = {};
  for (const r of previous) for (const l of r.items) used[l.id] = (used[l.id] || 0) + l.qty;
  const items = [];
  for (const it of Array.isArray(input.items) ? input.items : []) {
    const line = (o.items || []).find((l) => l.id === Number(it.id)), qty = Number(it.qty);
    if (!line || !Number.isInteger(qty) || qty < 1) continue;
    if (qty > line.qty - (used[line.id] || 0)) throw new ReturnError(400, `You can return at most ${line.qty - (used[line.id] || 0)} of ${line.name}.`);
    items.push({ id: line.id, name: line.name, qty, price: line.price });
  }
  if (!items.length) throw new ReturnError(400, "Choose at least one item to return.");

  const photos = [];
  for (const p of (Array.isArray(input.photos) ? input.photos : []).slice(0, 3)) {
    const img = parseImage(p);
    if (img.error) throw new ReturnError(400, img.error);
    photos.push((await db.uploadFile("return-photos", `${o.ref}/${img.name}`, img.buf, img.type)).path);
  }
  if (reason === "Damaged or defective" && !photos.length) throw new ReturnError(400, "Please add at least one photo of the damage.");

  const ret = await db.insertReturn({
    orderId: o.orderId, orderRef: o.ref, customerId: customerId || o.customerId || null, items, reason, details: clip(input.details, 1000), photos,
    history: [{ at: new Date().toISOString(), status: "requested", by: "customer" }]
  });
  mail.sendReturnUpdate(o, ret).catch((e) => console.error("Return email:", e.message));
  mail.sendOwnerAlert(`Return requested for ${o.ref}`, `<h2 style="margin:0 0 10px">Return requested</h2><p>Order <b>${esc(o.ref)}</b> · ${esc(reason)}</p>
    <ul>${items.map((l) => `<li>${esc(l.name)} × ${l.qty} (${money(l.price * l.qty)})</li>`).join("")}</ul><p>${esc(ret.details)}</p>`).catch(() => {});
  return ret;
}

const publicReturn = (r) => ({ id: r.id, orderRef: r.orderRef, items: r.items, reason: r.reason, details: r.details, status: r.status,
  adminNote: r.adminNote, refundAmount: r.refundAmount, createdAt: r.createdAt, updatedAt: r.updatedAt, photoCount: r.photos.length });

module.exports = { REASONS, ReturnError, createReturn, publicReturn };
