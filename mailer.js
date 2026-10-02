const nodemailer = require("nodemailer");
const { money } = require("./public/core");
const { esc } = require("./lib/security");

const { SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS, MAIL_FROM, OWNER_EMAIL } = process.env;
const enabled = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const transport = enabled
  ? nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } })
  : null;
const brand = () => process.env.BUSINESS_NAME || "Needverse";
const site = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const first = (name) => esc(String(name || "").split(" ")[0]);

async function send(to, subject, html, extra = {}) {
  if (!enabled) { console.log(`(email skipped: SMTP not configured) ${subject}`); return false; }
  await transport.sendMail({ from: MAIL_FROM || SMTP_USER, to, subject, html, replyTo: OWNER_EMAIL || undefined, ...extra });
  return true;
}

const button = (href, label) => `<a href="${esc(href)}" style="background:#f06000;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${esc(label)}</a>`;
const layout = (inner) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
  <div style="background:#f06000;color:#fff;padding:18px 24px;font-size:22px;font-weight:bold">${esc(brand())}</div>
  <div style="padding:24px;border:1px solid #eee;border-top:0">${inner}
    <p style="margin:24px 0 0;color:#777;font-size:12px">Questions? Just reply to this email.</p></div></div>`;
const itemRows = (o) => (o.items || []).map((l) =>
  `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(l.name)} × ${l.qty}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${money(l.price * l.qty)}</td></tr>`).join("");
const address = (c) => `${esc(c.name)}<br>${esc(c.addr)}<br>${esc(c.city)}${c.state ? ", " + esc(c.state) : ""} ${esc(c.zip)}`;

function body(o, forOwner, links = {}) {
  const c = o.customer, t = o.totals || {};
  const cod = o.paymentMethod === "cod";
  const heading = forOwner ? `New ${cod ? "COD" : "paid"} order ${esc(o.ref)}` : `Thanks ${first(c.name)}, your order is confirmed`;
  const sum = (label, v) => (v ? `<tr><td style="padding:4px 0;color:#555">${label}</td><td style="padding:4px 0;text-align:right;color:#555">${v}</td></tr>` : "");
  return layout(`<h2 style="margin:0 0 6px">${heading}</h2>
    <p style="margin:0 0 14px;color:#555">Order <b>${esc(o.ref)}</b>${o.paymentId && !cod ? ` · Payment ID ${esc(o.paymentId)}` : ""}</p>
    ${o.vehicle ? `<p style="margin:0 0 14px;color:#555">Vehicle: ${esc(o.vehicle.year)} ${esc(o.vehicle.make)} ${esc(o.vehicle.model)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(o)}
      ${sum("Savings", t.disc ? "−" + money(t.disc) : "")}${sum("Shipping", t.ship ? money(t.ship) : t.sub ? "Free" : "")}${sum("Cash on delivery fee", t.codFee ? money(t.codFee) : "")}
      <tr><td style="padding:12px 0 0;font-weight:bold">${cod ? "To pay on delivery" : "Total paid"}</td><td style="padding:12px 0 0;text-align:right;font-weight:bold">${money(o.amount)}</td></tr>
      ${t.tax ? `<tr><td colspan="2" style="padding:4px 0 0;color:#777;font-size:12px">Includes GST of ${money(t.tax)}</td></tr>` : ""}</table>
    <h3 style="margin:24px 0 6px">Shipping to</h3>
    <p style="margin:0;color:#333;line-height:1.5">${address(c)}<br>${esc(c.phone)}${forOwner ? `<br>${esc(c.email)}` : ""}</p>
    ${!forOwner && links.track ? `<p style="margin:22px 0 0">${button(links.track, "Track your order")}</p>` : ""}
    ${!forOwner && links.invoice ? `<p style="margin:12px 0 0"><a href="${esc(links.invoice)}" style="color:#f06000">Download your GST invoice</a></p>` : ""}`);
}
async function sendOrderEmails(o, links) {
  const ok = await send(o.customer.email, `Order ${o.ref} confirmed`, body(o, false, links));
  if (ok && OWNER_EMAIL) await send(OWNER_EMAIL, `New ${o.paymentMethod === "cod" ? "COD " : ""}order ${o.ref} (${money(o.amount)})`, body(o, true), { replyTo: o.customer.email });
  return ok;
}

function shippedBody(o) {
  const t = o.tracking || {}, safeUrl = /^https?:\/\//i.test(t.url || "") ? t.url : "";
  const track = (t.carrier || t.number) ? `<div style="background:#f6f6f6;border-radius:8px;padding:14px 16px;margin:16px 0">
      ${t.carrier ? `<div>Courier: <b>${esc(t.carrier)}</b></div>` : ""}${t.number ? `<div>Tracking number: <b>${esc(t.number)}</b></div>` : ""}
      ${safeUrl ? `<div style="margin-top:12px">${button(safeUrl, "Track your package")}</div>` : ""}</div>` : "";
  return layout(`<h2 style="margin:0 0 6px">Your order is on its way</h2>
    <p style="margin:0 0 6px;color:#555">Hi ${first(o.customer.name)}, order <b>${esc(o.ref)}</b> has shipped.</p>${track}
    <h3 style="margin:20px 0 6px">In this package</h3>
    <ul style="margin:0;padding-left:20px;line-height:1.7">${(o.items || []).map((l) => `<li>${esc(l.name)} × ${l.qty}</li>`).join("")}</ul>
    <h3 style="margin:20px 0 6px">Delivering to</h3><p style="margin:0;color:#333;line-height:1.5">${address(o.customer)}</p>
    ${o.paymentMethod === "cod" && o.status !== "paid" ? `<p style="margin:16px 0 0"><b>Please keep ${money(o.amount)} ready</b> to pay on delivery.</p>` : ""}`);
}
const sendShippedEmail = (o) => send(o.customer.email, `Your order ${o.ref} has shipped`, shippedBody(o));

const sendDeliveredEmail = (o) => send(o.customer.email, `Order ${o.ref} delivered`, layout(`<h2 style="margin:0 0 6px">Delivered</h2>
  <p style="margin:0;color:#555">Hi ${first(o.customer.name)}, order <b>${esc(o.ref)}</b> was delivered. If anything isn't right, you can request a return within the return window from your account or the order tracking page.</p>
  <p style="margin:20px 0 0">${button(site() + "/track?ref=" + encodeURIComponent(o.ref), "View your order")}</p>`));

function reviewRequestBody(o, products) {
  const links = (o.items || []).map((l) => { const p = products.get(l.id);
    return p ? `<li style="margin:6px 0"><a href="${esc(site() + "/p/" + p.slug + "#reviews")}" style="color:#f06000">${esc(l.name)}</a></li>` : ""; }).join("");
  return layout(`<h2 style="margin:0 0 6px">How did it go?</h2>
    <p style="margin:0;color:#555">Hi ${first(o.customer.name)}, your reviews help other drivers pick parts that fit. Sign in with this email address to leave a review:</p>
    <ul style="padding-left:20px">${links}</ul>`);
}
const sendReviewRequest = (o, products) => send(o.customer.email, `How are your new parts? (${o.ref})`, reviewRequestBody(o, products));

function refundBody(o, r) {
  const left = Math.round((o.amount - (o.refunded || 0)) * 100) / 100;
  return layout(`<h2 style="margin:0 0 6px">Your refund of ${money(r.amount)} is on its way</h2>
    <p style="margin:0 0 14px;color:#555">Hi ${first(o.customer.name)}, we've refunded part or all of order <b>${esc(o.ref)}</b>${o.paymentMethod === "cod" ? " to the bank account you shared with us" : " to your original payment method"}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee">Refund amount</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right"><b>${money(r.amount)}</b></td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee">Order total</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${money(o.amount)}</td></tr>
      ${left > 0 ? `<tr><td style="padding:8px 0">Not refunded</td><td style="padding:8px 0;text-align:right">${money(left)}</td></tr>` : ""}</table>
    ${r.reason ? `<p style="margin:16px 0 0;color:#555">Note: ${esc(r.reason)}</p>` : ""}
    <p style="margin:16px 0 0;color:#333">Banks usually take <b>5 to 7 working days</b> to show the money in your account. UPI and wallet refunds are often faster.</p>`);
}
const sendRefundEmail = (o, r) => send(o.customer.email, `Refund for order ${o.ref}`, refundBody(o, r));

const sendAbandonedEmail = (o, url) => send(o.customer.email, "You left something in your cart", layout(`<h2 style="margin:0 0 6px">Still thinking it over?</h2>
  <p style="margin:0 0 14px;color:#555">Hi ${first(o.customer.name)}, your checkout didn't finish, so we haven't charged you. Your items are saved:</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(o)}</table>
  <p style="margin:20px 0 0">${button(url, "Return to your cart")}</p>
  <p style="margin:16px 0 0;color:#777;font-size:12px">We only send this once.</p>`));

const RETURN_TEXT = {
  requested: "We've received your return request and will review it within 2 working days.",
  approved: "Your return is approved. We'll arrange a pickup and share the details soon.",
  rejected: "We couldn't approve this return.",
  picked_up: "Your return has been picked up.",
  received: "We've received your returned items and are inspecting them.",
  refunded: "Your refund has been issued.",
  replaced: "Your replacement is on its way."
};
const sendReturnUpdate = (o, ret) => send(o.customer.email, `Return update for order ${o.ref}`, layout(`<h2 style="margin:0 0 6px">Return ${esc(ret.status.replace("_", " "))}</h2>
  <p style="margin:0;color:#555">Hi ${first(o.customer.name)}, ${esc(RETURN_TEXT[ret.status] || "")}</p>
  ${ret.adminNote ? `<p style="margin:14px 0 0;color:#333">Note from us: ${esc(ret.adminNote)}</p>` : ""}
  <ul style="padding-left:20px;line-height:1.7">${ret.items.map((l) => `<li>${esc(l.name)} × ${l.qty}</li>`).join("")}</ul>`));

const sendPasswordReset = (email, name, url) => send(email, `Reset your ${brand()} password`, layout(`<h2 style="margin:0 0 6px">Reset your password</h2>
  <p style="margin:0 0 14px;color:#555">Hi ${first(name)}, use the button below to choose a new password. The link works for 1 hour. If you didn't ask for this, ignore this email.</p>
  <p>${button(url, "Choose a new password")}</p>`));

const sendPurchaseOrder = (po, supplier, html) => send(supplier.email, `Purchase order ${po.poNo} from ${brand()}`, html, { cc: OWNER_EMAIL || undefined });

const sendOwnerAlert = (subject, html) => (OWNER_EMAIL ? send(OWNER_EMAIL, subject, layout(html)) : Promise.resolve(false));

module.exports = { emailEnabled: enabled, sendOrderEmails, sendShippedEmail, sendDeliveredEmail, sendReviewRequest, sendRefundEmail, sendAbandonedEmail,
  sendReturnUpdate, sendPasswordReset, sendOwnerAlert, sendPurchaseOrder, body, shippedBody, refundBody };
