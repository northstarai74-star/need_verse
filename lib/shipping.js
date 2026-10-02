// Delivery checks and courier bookings. Uses Shiprocket when SHIPROCKET_EMAIL and
// SHIPROCKET_PASSWORD are set; otherwise accepts any valid Indian PIN code with a
// default delivery estimate, and shipments are entered by hand in the admin.
const { validPin } = require("../public/core");

const API = "https://apiv2.shiprocket.in/v1/external";
const env = () => process.env;
const enabled = () => Boolean(env().SHIPROCKET_EMAIL && env().SHIPROCKET_PASSWORD && env().SHIP_FROM_PIN);
const blocked = () => new Set(String(env().BLOCKED_PINS || "").split(/[\s,]+/).filter(Boolean));
const defaultEta = () => { const [a, b] = String(env().DEFAULT_ETA_DAYS || "3-7").split("-").map(Number); return [a || 3, b || a || 7]; };

let token = null, tokenAt = 0;
async function call(path, opts = {}) {
  if (!token || Date.now() - tokenAt > 8 * 864e5) {
    const r = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: env().SHIPROCKET_EMAIL, password: env().SHIPROCKET_PASSWORD }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) throw new Error("Shiprocket login failed: " + (j.message || r.status));
    token = j.token; tokenAt = Date.now();
  }
  const r = await fetch(API + path, { ...opts, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Shiprocket: " + (j.message || r.status));
  return j;
}

const cache = new Map();
// Returns {ok, cod, eta:[min,max], reason?}
async function check(pin, weightG = 500, wantCod = false) {
  pin = String(pin || "").trim();
  if (!validPin(pin)) return { ok: false, reason: "Enter a valid 6-digit PIN code." };
  if (blocked().has(pin)) return { ok: false, reason: "Sorry, we don't deliver to this PIN code yet." };
  const codOn = env().COD_ENABLED !== "false";
  if (!enabled()) return { ok: true, cod: codOn, eta: defaultEta() };
  const key = `${pin}|${Math.ceil(weightG / 500)}|${wantCod ? 1 : 0}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 36e5) return hit.v;
  let v;
  try {
    const q = new URLSearchParams({ pickup_postcode: env().SHIP_FROM_PIN, delivery_postcode: pin, weight: String(Math.max(0.5, weightG / 1000)), cod: wantCod ? "1" : "0" });
    const j = await call("/courier/serviceability/?" + q);
    const list = j?.data?.available_courier_companies || [];
    if (!list.length) v = { ok: false, reason: wantCod ? "Cash on delivery isn't available for this PIN code. Try paying online." : "Sorry, couriers don't deliver to this PIN code yet." };
    else {
      const days = list.map((c) => Number(c.estimated_delivery_days)).filter((n) => n > 0);
      const min = days.length ? Math.min(...days) : defaultEta()[0];
      v = { ok: true, cod: codOn && list.some((c) => Number(c.cod) === 1), eta: [min, Math.max(min + 2, ...days.slice(0, 3))] };
    }
  } catch (e) {
    console.error("Delivery check failed, using default estimate:", e.message);
    v = { ok: true, cod: codOn, eta: defaultEta() };
  }
  cache.set(key, { at: Date.now(), v });
  return v;
}

// Creates the courier order, assigns an AWB and fetches the label. Returns shipment info for the order.
async function createShipment(o, lines) {
  if (!enabled()) throw new Error("Shiprocket is not configured. Set SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD and SHIP_FROM_PIN.");
  const c = o.customer, [first, ...rest] = c.name.split(" ");
  const weightKg = Math.max(0.5, lines.reduce((s, l) => s + (l.weightG || 500) * l.qty, 0) / 1000);
  const d = lines.reduce((m, l) => ({ l: Math.max(m.l, l.dims?.l || 30), b: Math.max(m.b, l.dims?.b || 20), h: m.h + (l.dims?.h || 10) * l.qty }), { l: 10, b: 10, h: 0 });
  const created = await call("/orders/create/adhoc", { method: "POST", body: JSON.stringify({
    order_id: o.ref, order_date: new Date(o.createdAt).toISOString().slice(0, 16).replace("T", " "),
    pickup_location: env().SHIPROCKET_PICKUP || "Primary",
    billing_customer_name: first, billing_last_name: rest.join(" ") || ".", billing_address: c.addr, billing_city: c.city,
    billing_pincode: c.zip, billing_state: c.state || "", billing_country: "India", billing_email: c.email, billing_phone: String(c.phone).replace(/\D/g, "").slice(-10),
    shipping_is_billing: true,
    order_items: lines.map((l) => ({ name: l.name, sku: l.sku || String(l.id), units: l.qty, selling_price: l.price, hsn: l.hsn || "" })),
    payment_method: o.paymentMethod === "cod" ? "COD" : "Prepaid",
    sub_total: o.amount, length: d.l, breadth: d.b, height: Math.min(d.h, 100), weight: weightKg
  }) });
  const shipmentId = created.shipment_id;
  const awb = await call("/courier/assign/awb", { method: "POST", body: JSON.stringify({ shipment_id: shipmentId }) });
  const a = awb?.response?.data || {};
  let labelUrl = null;
  try { labelUrl = (await call("/courier/generate/label", { method: "POST", body: JSON.stringify({ shipment_id: [shipmentId] }) })).label_url || null; }
  catch (e) { console.error("Label not generated:", e.message); }
  try { await call("/courier/generate/pickup", { method: "POST", body: JSON.stringify({ shipment_id: [shipmentId] }) }); }
  catch (e) { console.error("Pickup not requested:", e.message); }
  return { provider: "shiprocket", orderId: created.order_id, shipmentId, awb: a.awb_code || null, courier: a.courier_name || null, labelUrl,
    trackingUrl: a.awb_code ? `https://shiprocket.co/tracking/${a.awb_code}` : null };
}

// Maps a courier status to our fulfilment status (null = no change).
function mapStatus(s) {
  const t = String(s || "").toUpperCase();
  if (/RTO.*(DELIVERED|RECEIVED)/.test(t)) return "returned";
  if (/OUT FOR DELIVERY/.test(t)) return "out_for_delivery";
  if (/^DELIVERED/.test(t)) return "delivered";
  if (/SHIPPED|IN TRANSIT|PICKED UP|REACHED/.test(t)) return "shipped";
  return null;
}

module.exports = { enabled, check, createShipment, mapStatus };
