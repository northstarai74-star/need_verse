/* Home and category pages: fit finder, kits, filters and the product grid. */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = window.Store, { C, money, esc } = S, { CATS, BUNDLES } = Core;
  const fixedCat = C.category || null;
  let cat = fixedCat || "All";
  const f = { min: "", max: "", stock: false, rated: false, fit: false };

  // ----- Fit finder -----
  const makeSel = $("make"), modelSel = $("model"), yearSel = $("year");
  function fill(sel, items, label) { sel.innerHTML = `<option value="">${label}</option>` + items.map((i) => `<option>${esc(i)}</option>`).join(""); sel.disabled = !items.length; }
  function steps() { $("s1").classList.toggle("done", !!makeSel.value); $("s2").classList.toggle("done", !!modelSel.value); $("s3").classList.toggle("done", !!yearSel.value); }
  if (makeSel) {
    fill(makeSel, Object.keys(C.vehicles).sort(), "Select make");
    makeSel.onchange = () => { fill(modelSel, Object.keys(C.vehicles[makeSel.value] || {}).sort(), "Select model"); fill(yearSel, [], "Select year"); steps(); };
    modelSel.onchange = () => { const r = (C.vehicles[makeSel.value] || {})[modelSel.value], ys = []; if (r) for (let y = r[1]; y >= r[0]; y--) ys.push(y); fill(yearSel, ys, "Select year"); steps(); };
    yearSel.onchange = steps;
    $("fitForm").onsubmit = (e) => {
      e.preventDefault();
      if (!makeSel.value || !modelSel.value || !yearSel.value) return S.toast("Pick make, model and year");
      S.setVehicle({ make: makeSel.value, model: modelSel.value, year: yearSel.value });
      f.fit = true; $("fFit").checked = true;
      S.toast("Showing parts for your " + modelSel.value);
      $("shop").scrollIntoView({ behavior: "smooth" });
    };
  }
  function renderGarage() {
    const g = $("garage"); if (!g) return;
    const v = S.vehicle; g.hidden = !v; if (!v) return;
    g.innerHTML = `<span>✔ Your car:</span><b>${esc(S.vehicleName(v))}</b><button type="button" id="clearCar">Change</button>`;
    $("clearCar").onclick = () => { S.setVehicle(null); };
  }

  // ----- Kits -----
  if ($("kitGrid")) {
    $("kitGrid").innerHTML = BUNDLES.map((b, i) => {
      const items = b.ids.map((id) => S.byId.get(id));
      if (items.some((p) => !p)) return "";
      const raw = items.reduce((s, p) => s + p.price, 0), ok = items.every((p) => p.inStock);
      return `<div class="kit"><span class="big" aria-hidden="true">${b.icon}</span><span class="tag">Save ${Math.round(b.off * 100)}%</span><h3>${esc(b.name)}</h3><p>${esc(b.desc)}</p>
      <p class="small muted" style="flex:0">${items.map((p) => `<a href="/p/${p.slug}">${esc(p.name)}</a>`).join(" + ")}</p>
      <div class="row"><b>${money(Math.round(raw * (1 - b.off) * 100) / 100)}</b><s>${money(raw)}</s></div>
      <button class="btn" type="button" data-b="${i}" ${ok ? "" : "disabled"}>${ok ? "Add full kit" : "Part of this kit is out of stock"}</button></div>`;
    }).join("");
    $("kitGrid").onclick = (e) => {
      const i = e.target.dataset.b; if (i == null) return;
      BUNDLES[i].ids.forEach((id) => { S.cart[id] = (S.cart[id] || 0) + 1; });
      S.cartChanged(); S.track("add_to_cart", { value: 0 }); S.toast("Kit added to cart"); S.openCart(true);
    };
  }

  // ----- Grid -----
  function renderChips() {
    if (fixedCat) { $("chips").innerHTML = ""; return; }
    $("chips").innerHTML = ["All", ...Object.keys(CATS)].map((c) => `<button type="button" class="chip ${c === cat ? "on" : ""}" data-c="${c}" aria-pressed="${c === cat}">${c}</button>`).join("");
  }
  $("chips").onclick = (e) => { const c = e.target.dataset.c; if (c) { cat = c; renderChips(); render(); } };

  function render() {
    const q = $("search").value.trim();
    const v = S.vehicle;
    let list, info = "";
    if (q) {
      const r = Search.search(S.searchIndex, q);
      list = r.items;
      if (r.vehicle) info = ` for ${r.vehicle.make}${r.vehicle.model ? " " + r.vehicle.model : ""}${r.vehicle.year ? " " + r.vehicle.year : ""}`;
      if (r.partial) info += " (closest matches)";
    } else list = [...C.products];
    const min = Number(f.min) || 0, max = Number(f.max) || Infinity;
    list = list.filter((p) => (cat === "All" || p.category === cat) && p.price >= min && p.price <= max && (!f.stock || p.inStock) &&
      (!f.rated || (p.rating || 0) >= 4) && (!f.fit || !v || S.fitsVehicle(p)));
    const s = $("sort").value;
    if (!q || s !== "pop") list.sort((a, b) => s === "low" ? a.price - b.price : s === "high" ? b.price - a.price : s === "rate" ? (b.rating || 0) - (a.rating || 0) || b.reviewCount - a.reviewCount
      : s === "new" ? String(b.updatedAt).localeCompare(String(a.updatedAt)) : b.sold - a.sold || (b.inStock - a.inStock));
    $("shopEye").textContent = q ? `Results for “${q}”` : fixedCat || (cat === "All" ? "All products" : cat);
    $("resultInfo").textContent = `${list.length} item${list.length === 1 ? "" : "s"}${info}`;
    $("vbar").innerHTML = v ? `<div class="vbar">🚗 Your car: <b>${esc(S.vehicleName(v))}</b>${f.fit ? " · showing only parts that fit" : ""}
      <button type="button" class="linkbtn" id="vToggle">${f.fit ? "Show everything" : "Only show parts that fit"}</button></div>` : "";
    if ($("vToggle")) $("vToggle").onclick = () => { f.fit = !f.fit; $("fFit").checked = f.fit; render(); };
    $("grid").innerHTML = list.length ? list.map(S.card).join("") : `<div class="empty"><div style="font-size:2.6rem" aria-hidden="true">🔍</div>
      <p>No products match${q ? ` “${esc(q)}”` : ""}${f.fit && v ? ` that fit your ${esc(v.model)}` : ""}.</p>
      <p><button type="button" class="linkbtn" id="emptyClear">Clear search and filters</button>${document.getElementById("aiBtn") ? ' or <button type="button" class="linkbtn" id="emptyAsk">ask the fit assistant</button>' : ""}</p></div>`;
    if ($("emptyClear")) $("emptyClear").onclick = clearAll;
    if ($("emptyAsk")) $("emptyAsk").onclick = () => $("aiBtn").click();
    S.renderWish();
  }
  function clearAll() { $("search").value = ""; f.min = f.max = ""; f.stock = f.rated = f.fit = false; ["pMin", "pMax"].forEach((i) => ($(i).value = "")); ["fStock", "fRated", "fFit"].forEach((i) => ($(i).checked = false)); if (!fixedCat) cat = "All"; renderChips(); render(); }
  $("pMin").oninput = (e) => { f.min = e.target.value; render(); };
  $("pMax").oninput = (e) => { f.max = e.target.value; render(); };
  $("fStock").onchange = (e) => { f.stock = e.target.checked; render(); };
  $("fRated").onchange = (e) => { f.rated = e.target.checked; render(); };
  $("fFit").onchange = (e) => { if (e.target.checked && !S.vehicle) { e.target.checked = false; S.toast("Pick your car in the fit finder first"); return; } f.fit = e.target.checked; render(); };
  $("fClear").onclick = clearAll;
  $("sort").onchange = render;
  $("search").addEventListener("input", () => { render(); });
  $("search").addEventListener("keydown", (e) => { if (e.key === "Enter") $("shop").scrollIntoView({ behavior: "smooth" }); });

  // ----- Reorder -----
  const last = S.local.get("lastOrder", null);
  if ($("reorderSec") && last && Object.keys(last).some((id) => S.byId.has(Number(id)))) {
    $("reorderSec").hidden = false;
    $("reorderBtn").onclick = () => { for (const id in last) if (S.byId.get(Number(id))?.inStock) S.cart[id] = (S.cart[id] || 0) + last[id]; S.cartChanged(); S.openCart(true); };
  }

  const q = new URLSearchParams(location.search).get("q");
  if (q) { $("search").value = q; setTimeout(() => $("shop").scrollIntoView(), 50); }
  if (S.vehicle) { f.fit = true; $("fFit").checked = true; }
  S.onVehicle((v) => { renderGarage(); if (!v) { f.fit = false; $("fFit").checked = false; } render(); });
  document.addEventListener("session:change", () => { renderGarage(); render(); });
  renderGarage(); renderChips(); render();
})();
