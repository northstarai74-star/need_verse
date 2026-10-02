/* Account page: orders and returns, My Garage, wishlist, addresses, profile and password. */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = window.Store, { C, esc, money } = S;
  const root = $("accRoot");
  const params = new URLSearchParams(location.search);
  let data = { orders: [], returns: [], reviewed: [] }, tab = (location.hash || "#orders").slice(1);

  function signedOut() {
    if (params.get("reset")) {
      root.innerHTML = `<div class="narrow"><h1 style="font-size:3rem">Choose a new password</h1>
        <form id="resetForm" class="panel"><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
        <p class="err" role="alert"></p><button class="btn">Save password</button></form></div>`;
      $("resetForm").onsubmit = async (e) => {
        e.preventDefault();
        try {
          await S.api("POST", "/api/account/reset", { email: params.get("email"), token: params.get("reset"), password: e.target.elements.password.value });
          history.replaceState(null, "", "/account"); S.toast("Password changed. You're signed in."); await S.loadSession();
        } catch (x) { e.target.querySelector(".err").textContent = x.message; }
      };
      return;
    }
    root.innerHTML = `<div class="narrow"><h1 style="font-size:3rem">Your account</h1>
      <p class="muted">Sign in to see your orders, request returns, save your cars and keep a wishlist on every device.</p>
      <p><button class="btn" type="button" id="accIn">Sign in</button> <button class="btn ghost" type="button" id="accUp">Create account</button></p>
      <p class="muted small">Ordered without an account? <a class="linkbtn" href="/track">Track your order here</a>.</p></div>`;
    $("accIn").onclick = () => S.openAuth("login");
    $("accUp").onclick = () => S.openAuth("register");
  }

  const TABS = [["orders", "Orders and returns"], ["garage", "My Garage"], ["wishlist", "Wishlist"], ["addresses", "Addresses"], ["profile", "Profile and security"]];
  function shell() {
    const s = S.session;
    root.innerHTML = `<h1 style="font-size:3rem">Hi, ${esc(s.name.split(" ")[0])}</h1><p class="muted">${esc(s.email)}</p>
      <div class="acc"><nav aria-label="Account sections">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</nav><div id="accBody"></div></div>`;
    root.querySelector("nav").onclick = (e) => { const t = e.target.dataset.tab; if (t) { tab = t; history.replaceState(null, "", "#" + t); shell(); } };
    ({ orders, garage, wishlist, addresses, profile }[tab] || orders)();
  }
  const body = () => $("accBody");

  async function orders() {
    body().innerHTML = '<p class="muted">Loading your orders…</p>';
    try { data = await S.api("GET", "/api/account/orders"); } catch (x) { body().innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
    body().innerHTML = data.orders.length ? data.orders.map((o) => OrdersUI.render(o, o.token, data.returns, data.reviewed)).join("")
      : '<div class="panel"><p style="margin:0">No orders yet. Orders you place while signed in show up here.</p></div>';
  }
  OrdersUI.bind(root, () => data.orders, () => orders());

  function vehicleRow(v) { return `${v.year} ${v.make} ${v.model}`; }
  function garage() {
    const g = S.session.garage || [];
    body().innerHTML = `<div class="panel"><h2>My Garage</h2><p class="muted">The first car is used to filter the shop. Products show whether they fit it.</p>
      <div class="chiplist">${g.map((v, i) => `<span>${i === 0 ? "★ " : ""}${esc(vehicleRow(v))}${i ? `<button type="button" class="linkbtn" data-main="${i}" style="width:auto;border-radius:6px;padding:0 6px">Use</button>` : ""}<button type="button" data-del="${i}" aria-label="Remove ${esc(vehicleRow(v))}">✕</button></span>`).join("") || '<span class="muted">No cars yet.</span>'}</div>
      <form id="gForm" class="formgrid" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end">
        <label>Make<select name="make" required><option value="">Make</option>${Object.keys(C.vehicles).sort().map((m) => `<option>${esc(m)}</option>`).join("")}</select></label>
        <label>Model<select name="model" required disabled><option value="">Model</option></select></label>
        <label>Year<select name="year" required disabled><option value="">Year</option></select></label>
        <button class="btn">Add car</button></form><p class="err" role="alert"></p></div>`;
    const f = $("gForm");
    f.elements.make.onchange = () => { const ms = Object.keys(C.vehicles[f.elements.make.value] || {}).sort(); f.elements.model.innerHTML = '<option value="">Model</option>' + ms.map((m) => `<option>${esc(m)}</option>`).join(""); f.elements.model.disabled = !ms.length; f.elements.year.disabled = true; };
    f.elements.model.onchange = () => { const r = (C.vehicles[f.elements.make.value] || {})[f.elements.model.value], ys = []; if (r) for (let y = r[1]; y >= r[0]; y--) ys.push(y); f.elements.year.innerHTML = '<option value="">Year</option>' + ys.map((y) => `<option>${y}</option>`).join(""); f.elements.year.disabled = !ys.length; };
    const save = async (list) => {
      try { const s = await S.api("PUT", "/api/account/garage", { garage: list }); Object.assign(S.session, s); if (list[0]) S.setVehicle(list[0], { noSync: true }); else S.setVehicle(null); garage(); }
      catch (x) { body().querySelector(".err").textContent = x.message; }
    };
    f.onsubmit = (e) => { e.preventDefault(); const v = { make: f.elements.make.value, model: f.elements.model.value, year: Number(f.elements.year.value) }; save([v, ...g.filter((x) => vehicleRow(x) !== vehicleRow(v))]); };
    body().querySelector(".chiplist").onclick = (e) => {
      const d = e.target.dataset;
      if (d.del != null) save(g.filter((_, i) => i !== Number(d.del)));
      if (d.main != null) save([g[d.main], ...g.filter((_, i) => i !== Number(d.main))]);
    };
  }

  function wishlist() {
    const list = (S.session.wishlist || []).map((id) => S.byId.get(id)).filter(Boolean);
    body().innerHTML = `<div class="panel"><h2>Wishlist</h2>${list.length ? `<div class="grid mini">${list.map(S.card).join("")}</div>` : '<p class="muted" style="margin:0">Tap the heart on any product to save it here.</p>'}</div>`;
    S.renderWish();
  }

  function addrForm(a = {}, i = -1) {
    return `<form class="panel" data-i="${i}"><h2>${i < 0 ? "Add an address" : "Edit address"}</h2><div class="formgrid">
      <label>Label<input name="label" value="${esc(a.label || "Home")}" maxlength="30"></label><label>Name<input name="name" value="${esc(a.name || S.session.name)}" required></label>
      <label>Mobile<input name="phone" type="tel" value="${esc(a.phone || S.session.phone || "")}" required></label><label>PIN code<input name="zip" inputmode="numeric" maxlength="6" value="${esc(a.zip || "")}" required></label>
      <label style="grid-column:1/-1">Street address<input name="addr" value="${esc(a.addr || "")}" required></label>
      <label>City<input name="city" value="${esc(a.city || "")}" required></label>
      <label>State<select name="state" required><option value="">Choose</option>${Core.STATES.map((s) => `<option ${s === a.state ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label></div>
      <p class="err" role="alert"></p><button class="btn">Save address</button></form>`;
  }
  function addresses() {
    const list = S.session.addresses || [];
    body().innerHTML = list.map((a, i) => `<div class="panel"><b>${esc(a.label)}</b><p class="muted" style="margin:6px 0">${esc(a.name)}, ${esc(a.addr)}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)} · ${esc(a.phone)}</p>
      <button type="button" class="linkbtn" data-edit="${i}">Edit</button> · <button type="button" class="linkbtn" data-rm="${i}">Remove</button></div>`).join("") + addrForm();
    const save = async (next) => {
      try { Object.assign(S.session, await S.api("PUT", "/api/account/addresses", { addresses: next })); addresses(); S.toast("Addresses saved"); }
      catch (x) { const errs = body().querySelectorAll(".err"); errs[errs.length - 1].textContent = x.message; }
    };
    body().onclick = (e) => {
      const d = e.target.dataset;
      if (d.rm != null) save(list.filter((_, i) => i !== Number(d.rm)));
      if (d.edit != null) { body().innerHTML = addrForm(list[d.edit], Number(d.edit)); bindForm(); }
    };
    const bindForm = () => body().querySelectorAll("form").forEach((f) => f.onsubmit = (e) => {
      e.preventDefault();
      const a = Object.fromEntries(new FormData(f)), i = Number(f.dataset.i);
      save(i < 0 ? [...list, a] : list.map((x, k) => (k === i ? a : x)));
    });
    bindForm();
  }

  function profile() {
    const s = S.session;
    body().innerHTML = `<form id="pForm" class="panel"><h2>Profile</h2><label>Name<input name="name" value="${esc(s.name)}" required></label>
      <label>Mobile<input name="phone" type="tel" value="${esc(s.phone || "")}"></label><label>Email<input value="${esc(s.email)}" disabled></label>
      <label class="check"><input type="checkbox" name="marketingOk" ${s.marketingOk ? "checked" : ""}> Email me offers and new arrivals</label>
      <p class="err" role="alert"></p><button class="btn">Save profile</button></form>
      <form id="pwForm" class="panel"><h2>Change password</h2><label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
      <label>New password<input name="next" type="password" minlength="8" autocomplete="new-password" required></label><p class="err" role="alert"></p><button class="btn">Change password</button>
      <p class="muted small">Changing your password signs you out on other devices.</p></form>
      <div class="panel"><h2>Your data</h2><p class="muted" style="margin:0">To download or delete your personal data, see our <a class="linkbtn" href="/policies/privacy">privacy policy</a> or contact the grievance officer on the <a class="linkbtn" href="/policies/contact">contact page</a>.</p></div>`;
    $("pForm").onsubmit = async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      try { Object.assign(S.session, await S.api("PUT", "/api/account/profile", { ...f, marketingOk: !!f.marketingOk })); S.toast("Profile saved"); }
      catch (x) { e.target.querySelector(".err").textContent = x.message; }
    };
    $("pwForm").onsubmit = async (e) => {
      e.preventDefault();
      try { await S.api("PUT", "/api/account/password", Object.fromEntries(new FormData(e.target))); e.target.reset(); S.toast("Password changed"); }
      catch (x) { e.target.querySelector(".err").textContent = x.message; }
    };
  }

  document.addEventListener("session:change", () => (S.session.role === "customer" ? shell() : signedOut()));
})();
