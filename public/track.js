/* Order tracking for guests: order number + email, or the signed link from the confirmation email. */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = window.Store;
  let order = null, token = null, returns = [];
  const out = $("trackOut");
  function show() {
    out.innerHTML = order ? `<div class="narrow" style="max-width:760px">${OrdersUI.render(order, token, returns, null)}</div>` : "";
  }
  async function reload() {
    const r = await S.api("GET", `/api/track/${encodeURIComponent(order.ref)}?t=${encodeURIComponent(token)}`);
    order = r.order; token = r.token; returns = r.returns; show();
  }
  OrdersUI.bind(out, () => [order], reload);
  $("trackForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = e.target.querySelector(".err");
    err.textContent = "";
    try { const r = await S.api("POST", "/api/track", f); order = r.order; token = r.token; returns = r.returns; show(); out.scrollIntoView({ behavior: "smooth" }); }
    catch (x) { err.textContent = x.message; }
  };
  const p = new URLSearchParams(location.search);
  if (p.get("ref") && p.get("t")) {
    order = { ref: p.get("ref") }; token = p.get("t");
    reload().catch(() => { order = null; out.innerHTML = '<p class="err">This tracking link is invalid. Enter your order number and email instead.</p>'; });
  }
})();
