/* Product page: gallery, fit check, buy box, delivery estimate and reviews. */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = window.Store, { C, esc } = S;
  const p = S.byId.get(C.productId);
  if (!p) return;
  S.track("product_view", { productId: p.id, value: p.price });

  // Gallery
  document.querySelectorAll(".thumbs button").forEach((b) => b.onclick = () => {
    const img = $("gMain").querySelector("img");
    if (img) img.src = b.dataset.img;
    document.querySelectorAll(".thumbs button").forEach((x) => x.classList.toggle("on", x === b));
  });

  // Fit check
  const mk = $("fMake"), md = $("fModel"), yr = $("fYear");
  function fill(sel, items, label) { sel.innerHTML = `<option value="">${label}</option>` + items.map((i) => `<option>${esc(i)}</option>`).join(""); sel.disabled = !items.length; }
  function result() {
    if (!mk) return;
    const v = mk.value && md.value && yr.value ? { make: mk.value, model: md.value, year: Number(yr.value) } : null, out = $("fitRes");
    if (!v) { out.textContent = ""; return; }
    const ok = Core.fits(p, v);
    out.className = "fitres " + (ok ? "ok-t" : "bad-t");
    out.textContent = ok ? `✔ Fits your ${S.vehicleName(v)}` : `✘ Not listed for the ${S.vehicleName(v)}. Check compatible vehicles below, or ask us.`;
    if (!S.vehicle) S.setVehicle(v);
  }
  function setFrom(v) {
    if (!mk) return;
    fill(mk, Object.keys(C.vehicles).sort(), "Make");
    if (v && C.vehicles[v.make]) {
      mk.value = v.make; fill(md, Object.keys(C.vehicles[v.make]).sort(), "Model");
      const r = C.vehicles[v.make][v.model];
      if (r) { md.value = v.model; const ys = []; for (let y = r[1]; y >= r[0]; y--) ys.push(y); fill(yr, ys, "Year"); yr.value = v.year; }
    }
    result();
  }
  if (mk) {
    mk.onchange = () => { fill(md, Object.keys(C.vehicles[mk.value] || {}).sort(), "Model"); fill(yr, [], "Year"); result(); };
    md.onchange = () => { const r = (C.vehicles[mk.value] || {})[md.value], ys = []; if (r) for (let y = r[1]; y >= r[0]; y--) ys.push(y); fill(yr, ys, "Year"); result(); };
    yr.onchange = result;
    setFrom(S.vehicle);
  }

  // Buy box
  let qty = 1;
  const setQ = (n) => { qty = Math.max(1, Math.min(20, n)); $("qVal").textContent = qty; };
  $("qMinus").onclick = () => setQ(qty - 1);
  $("qPlus").onclick = () => setQ(qty + 1);
  $("addBtn").onclick = () => S.add(p.id, qty);
  $("buyBtn").onclick = () => { S.add(p.id, qty); S.openCheckout(); };
  $("wishBtn").dataset.wish = p.id;
  S.renderWish();

  // Delivery estimate
  const savedPin = (S.local.get("contact", {}) || {}).zip;
  if (savedPin) $("pinIn").value = savedPin;
  $("pinForm").onsubmit = async (e) => {
    e.preventDefault();
    const pin = $("pinIn").value.trim(), out = $("pinRes");
    if (!Core.validPin(pin)) { out.className = "pinst bad-t"; out.textContent = "Enter a valid 6-digit PIN code."; return; }
    out.className = "pinst muted"; out.textContent = "Checking…";
    try {
      const r = await S.api("GET", `/api/shipping/check?pin=${pin}&weight=${p.weightG || 500}`);
      out.className = "pinst " + (r.ok ? "ok-t" : "bad-t");
      if (!r.ok) { out.textContent = r.reason; return; }
      const d = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
      out.textContent = `Delivery by ${d(r.eta[0])} – ${d(r.eta[1])}${C.cod ? (r.cod ? " · Cash on delivery available" : " · Prepaid only") : ""}`;
    } catch (err) { out.textContent = err.message; }
  };
  if (savedPin) $("pinForm").requestSubmit();

  // Reviews
  $("revList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-vote]"); if (!b) return;
    const id = b.closest(".rev").dataset.id, kind = b.dataset.vote;
    try {
      await S.api("POST", `/api/reviews/${id}/${kind}`, {});
      if (kind === "helpful") { const n = Number(/\d+/.exec(b.textContent)) + 1; b.textContent = `Helpful (${n})`; } else b.textContent = "Reported";
      b.disabled = true;
    } catch (err) { S.toast(err.message); }
  });

  let rating = 0;
  const dlg = $("revDlg"), form = $("revForm");
  $("starPick").onclick = (e) => {
    const n = Number(e.target.dataset.star); if (!n) return;
    rating = n; [...$("starPick").children].forEach((s, i) => s.classList.toggle("on", i < n));
  };
  dlg.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) dlg.close(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector(".err");
    if (!rating) { err.textContent = "Choose a star rating."; return; }
    const f = Object.fromEntries(new FormData(form));
    try {
      await S.api("POST", "/api/account/reviews", { productId: p.id, rating, title: f.title, body: f.body });
      dlg.close(); $("writeReview").hidden = true; S.toast("Thanks! Your review will appear after a quick check.");
    } catch (x) { err.textContent = x.message; }
  };
  $("writeReview").onclick = () => dlg.showModal();
  async function canReview() {
    if (S.session.role !== "customer") { $("writeReview").hidden = true; return; }
    try {
      const r = await S.api("GET", "/api/account/orders");
      const bought = r.orders.some((o) => o.fulfillment === "delivered" && o.items.some((l) => l.id === p.id));
      $("writeReview").hidden = !bought || r.reviewed.includes(p.id);
    } catch { /* not signed in */ }
  }
  document.addEventListener("session:change", canReview);
  if (location.hash === "#reviews") setTimeout(() => $("reviews").scrollIntoView(), 100);
})();
