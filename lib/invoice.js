// Printable GST tax invoice (customers use the browser's "Save as PDF").
// Prices include GST, so each line's taxable value is backed out of the selling price.
const { money, STORE } = require("../public/core");
const { esc } = require("./security");

const r2 = (n) => Math.round(n * 100) / 100;
const biz = () => ({
  name: process.env.BUSINESS_LEGAL_NAME || process.env.BUSINESS_NAME || "[Set BUSINESS_LEGAL_NAME in .env]",
  address: process.env.BUSINESS_ADDRESS || "[Set BUSINESS_ADDRESS in .env]",
  state: process.env.BUSINESS_STATE || "",
  gstin: process.env.BUSINESS_GSTIN || "[Set BUSINESS_GSTIN in .env]",
  email: process.env.BUSINESS_EMAIL || "", phone: process.env.BUSINESS_PHONE || ""
});

function invoiceLines(o) {
  const t = o.totals || {}, items = o.items || [];
  const sub = items.reduce((s, l) => s + l.price * l.qty, 0) || 1;
  const rows = items.map((l) => {
    const gross = l.price * l.qty, disc = (t.disc || 0) * gross / sub, value = gross - disc, rate = l.gstRate ?? 18;
    return { name: l.name, sku: l.sku, hsn: l.hsn, qty: l.qty, rate, gross: r2(gross), disc: r2(disc), taxable: r2(value * 100 / (100 + rate)), tax: r2(value * rate / (100 + rate)), total: r2(value) };
  });
  for (const [name, amt] of [["Shipping", t.ship], ["Cash on delivery fee", t.codFee]]) if (amt) {
    const rate = STORE.serviceGst;
    rows.push({ name, hsn: "9965", qty: 1, rate, gross: amt, disc: 0, taxable: r2(amt * 100 / (100 + rate)), tax: r2(amt * rate / (100 + rate)), total: amt });
  }
  return rows;
}

function render(o) {
  const b = biz(), c = o.customer, rows = invoiceLines(o);
  const intra = b.state && c.state && b.state === c.state;
  const tot = rows.reduce((s, r) => ({ taxable: s.taxable + r.taxable, tax: s.tax + r.tax, total: s.total + r.total }), { taxable: 0, tax: 0, total: 0 });
  const taxCols = (r) => intra ? `<td>${money(r2(r.tax / 2))}</td><td>${money(r2(r.tax / 2))}</td>` : `<td>${money(r.tax)}</td>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Invoice ${esc(o.invoiceNo || o.ref)}</title>
<style>body{font:14px/1.5 Arial,sans-serif;color:#111;max-width:860px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0}
.top{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;border-bottom:2px solid #111;padding-bottom:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:16px 0}.box h3{margin:0 0 4px;font-size:12px;text-transform:uppercase;color:#555}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:right}th:first-child,td:first-child{text-align:left}
th{background:#f3f3f3}.note{color:#555;font-size:12px;margin-top:14px}.print{margin:16px 0;padding:10px 18px;border:0;background:#f06000;color:#fff;border-radius:6px;cursor:pointer;font-weight:bold}
@media print{.print{display:none}}@media (max-width:600px){.grid{grid-template-columns:1fr}}</style></head><body>
<button class="print" onclick="print()">Print or save as PDF</button>
<div class="top"><div><h1>Tax Invoice</h1><div>${esc(b.name)}</div><div>${esc(b.address)}</div><div>GSTIN: ${esc(b.gstin)}</div>
${b.email || b.phone ? `<div>${esc(b.email)} ${esc(b.phone)}</div>` : ""}</div>
<div><div><b>Invoice no:</b> ${esc(o.invoiceNo || "Pending")}</div><div><b>Order:</b> ${esc(o.ref)}</div>
<div><b>Date:</b> ${new Date(o.paidAt || o.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}</div>
<div><b>Payment:</b> ${o.paymentMethod === "cod" ? "Cash on delivery" : "Online (Razorpay)"}</div></div></div>
<div class="grid"><div class="box"><h3>Bill and ship to</h3>${esc(c.name)}<br>${esc(c.addr)}<br>${esc(c.city)}, ${esc(c.state || "")} ${esc(c.zip)}<br>${esc(c.phone)}</div>
<div class="box"><h3>Place of supply</h3>${esc(c.state || "-")}</div></div>
<div class="tw"><table><thead><tr><th>Item</th><th>HSN/SAC</th><th>Qty</th><th>Gross</th><th>Discount</th><th>Taxable value</th><th>GST %</th>
${intra ? "<th>CGST</th><th>SGST</th>" : "<th>IGST</th>"}<th>Total</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc(r.name)}${r.sku ? `<br><small>${esc(r.sku)}</small>` : ""}</td><td>${esc(r.hsn || "-")}</td><td>${r.qty}</td><td>${money(r.gross)}</td>
<td>${r.disc ? "−" + money(r.disc) : "-"}</td><td>${money(r.taxable)}</td><td>${r.rate}%</td>${taxCols(r)}<td>${money(r.total)}</td></tr>`).join("")}
<tr><th>Total</th><th></th><th></th><th></th><th></th><th>${money(r2(tot.taxable))}</th><th></th>${intra ? `<th>${money(r2(tot.tax / 2))}</th><th>${money(r2(tot.tax / 2))}</th>` : `<th>${money(r2(tot.tax))}</th>`}<th>${money(o.amount)}</th></tr>
</tbody></table></div>
${o.refunded ? `<p class="note">Refunded so far: ${money(o.refunded)}. A credit note is issued separately for refunds.</p>` : ""}
<p class="note">This is a computer-generated invoice and does not need a signature.</p>
</body></html>`;
}

module.exports = { render, invoiceLines };
