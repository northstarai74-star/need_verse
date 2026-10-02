/* Order cards for the account and tracking pages: status, tracking, invoice, cancel and returns. */
(function () {
  const S = window.Store, { esc, money } = S;
  const STEPS = ["new", "packed", "shipped", "out_for_delivery", "delivered"];
  const LABEL = { new: "Order placed", packed: "Packed", shipped: "Shipped", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled", returned: "Returned" };
  const date = (d) => new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" });
  const pill = (o) => o.fulfillment === "cancelled" ? '<span class="pill bad">Cancelled</span>' : o.fulfillment === "returned" ? '<span class="pill warn">Returned</span>'
    : o.fulfillment === "delivered" ? '<span class="pill ok">Delivered</span>' : `<span class="pill blue">${LABEL[o.fulfillment]}</span>`;

  function render(o, token, returns, reviewed) {
    const at = STEPS.indexOf(o.fulfillment), canReturn = o.fulfillment === "delivered" && o.returnUntil && new Date(o.returnUntil) > new Date();
    const mine = (returns || []).filter((r) => r.orderRef === o.ref);
    const t = o.tracking;
    return `<div class="ord" data-ref="${esc(o.ref)}" data-token="${esc(token)}">
      <div class="top"><div><b>${esc(o.ref)}</b> <span class="muted small">· ${date(o.createdAt)}</span></div><div>${pill(o)} ${o.paymentMethod === "cod" ? `<span class="pill">${o.status === "paid" ? "COD paid" : "Pay on delivery"}</span>` : ""}</div></div>
      ${at >= 0 ? `<div class="steps4">${STEPS.map((s, i) => `<div class="${i <= at ? "on" : ""}">${LABEL[s]}</div>`).join("")}</div>` : ""}
      ${t && (t.number || t.url) ? `<p class="small">Courier: <b>${esc(t.carrier || "-")}</b>${t.number ? ` · Tracking no. <b>${esc(t.number)}</b>` : ""}${/^https?:\/\//.test(t.url || "") ? ` · <a class="linkbtn" href="${esc(t.url)}" target="_blank" rel="noopener">Track package</a>` : ""}</p>` : ""}
      ${o.items.map((l) => `<div class="li"><span>${esc(l.name)} × ${l.qty}</span><span>${money(l.price * l.qty)}${reviewed && o.fulfillment === "delivered" && !reviewed.includes(l.id) && S.byId.has(l.id) ? ` · <a class="linkbtn" href="/p/${S.byId.get(l.id).slug}#reviews">Review</a>` : ""}</span></div>`).join("")}
      <div class="li"><b>Total${o.totals?.tax ? ` <span class="muted small">(incl. GST ${money(o.totals.tax)})</span>` : ""}</b><b>${money(o.amount)}</b></div>
      ${o.refunded ? `<p class="small ok-t">Refunded ${money(o.refunded)}</p>` : ""}
      ${mine.map((r) => `<p class="small">Return #${r.id}: <b>${esc(r.status.replace("_", " "))}</b> · ${r.items.map((l) => `${esc(l.name)} × ${l.qty}`).join(", ")}${r.adminNote ? ` · ${esc(r.adminNote)}` : ""}</p>`).join("")}
      ${canReturn ? `<p class="small muted">Return window open until ${date(o.returnUntil)}.</p>` : ""}
      <details class="small"><summary class="muted">Order history</summary><ul class="timeline">${o.history.map((h) => `<li>${date(h.at)}: ${esc(h.event)}</li>`).join("")}</ul></details>
      <div class="acts">
        ${o.invoiceUrl ? `<a class="btn ghost" href="${esc(o.invoiceUrl)}" target="_blank" rel="noopener">GST invoice</a>` : ""}
        ${o.canCancel ? `<button type="button" class="btn ghost" data-act="cancel">Cancel order</button>` : ""}
        ${canReturn ? `<button type="button" class="btn ghost" data-act="return">Request a return</button>` : ""}
      </div>
    </div>`;
  }

  // Return dialog, created once.
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<form id="retForm"><h2>Request a return</h2><p class="muted small" id="retRef"></p><div id="retItems"></div>
    <label>Reason<select name="reason" required><option value="">Choose a reason</option>${(S.C.returnReasons || ["Doesn't fit my car", "Damaged or defective", "Wrong item received", "Missing parts", "No longer needed", "Other"]).map((r) => `<option>${esc(r)}</option>`).join("")}</select></label>
    <label>Details (optional)<textarea name="details" maxlength="1000"></textarea></label>
    <label>Photos (up to 3, needed for damage)<input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple></label>
    <p class="err" role="alert"></p><div class="acts"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Send request</button></div></form>`;
  document.body.append(dlg);
  dlg.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) dlg.close(); });
  let current = null, after = null;
  const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  dlg.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target, err = form.querySelector(".err"), btn = form.querySelector("button:not([type])");
    const items = [...form.querySelectorAll("[data-item]")].map((i) => ({ id: Number(i.dataset.item), qty: Number(i.value) })).filter((i) => i.qty > 0);
    const files = [...form.elements.photos.files].slice(0, 3);
    if (files.some((f) => f.size > 2 * 1024 * 1024)) { err.textContent = "Each photo must be under 2 MB."; return; }
    btn.disabled = true; err.textContent = "";
    try {
      await S.api("POST", `/api/orders/${encodeURIComponent(current.ref)}/returns`, { token: current.token, items, reason: form.elements.reason.value, details: form.elements.details.value, photos: await Promise.all(files.map(readFile)) });
      dlg.close(); S.toast("Return requested. We've emailed you the next steps."); after && after();
    } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
  };

  function bind(root, orders, reload) {
    root.onclick = async (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const card = b.closest(".ord"), ref = card.dataset.ref, token = card.dataset.token, o = orders().find((x) => x.ref === ref);
      if (b.dataset.act === "cancel") {
        if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = o.status === "paid" ? "Confirm: cancel and refund" : "Confirm cancel"; return; }
        b.disabled = true;
        try { await S.api("POST", `/api/orders/${encodeURIComponent(ref)}/cancel`, { token }); S.toast(o.status === "paid" ? "Order cancelled. Your refund has started." : "Order cancelled."); reload(); }
        catch (x) { S.toast(x.message); b.disabled = false; }
      }
      if (b.dataset.act === "return") {
        current = { ref, token }; after = reload;
        dlg.querySelector("#retRef").textContent = `Order ${ref}. Choose how many of each item to return.`;
        dlg.querySelector("#retItems").innerHTML = o.items.map((l) => `<label>${esc(l.name)}<input type="number" min="0" max="${l.qty}" value="${o.items.length === 1 ? l.qty : 0}" data-item="${l.id}"></label>`).join("");
        dlg.querySelector("form").reset(); dlg.querySelector(".err").textContent = "";
        dlg.querySelectorAll("[data-item]").forEach((i, k) => { i.value = o.items.length === 1 ? o.items[k].qty : 0; });
        dlg.showModal();
      }
    };
  }

  window.OrdersUI = { render, bind };
})();
