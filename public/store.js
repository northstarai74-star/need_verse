/* Shared storefront code for every page: cart, checkout, sign-in, wishlist, search
   suggestions, analytics events and the assistant. Page scripts use window.Store. */
(function () {
  const $ = (id) => document.getElementById(id);
  const C = JSON.parse($("catalog").textContent);
  const { money, STORE, CATS } = Core;
  const byId = new Map(C.products.map((p) => [p.id, p]));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const local = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } }
  };

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "Something went wrong. Please try again."), { status: r.status, data: j });
    return j;
  }
  let tt;
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2600); }

  // ---------- Analytics (first-party, anonymous ID only) ----------
  let anonId = local.get("aid", null);
  if (!anonId) { anonId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); local.set("aid", anonId); }
  let queue = [], qt;
  function track(name, extra = {}) {
    queue.push({ name, anonId, path: location.pathname, referrer: name === "page_view" ? document.referrer : "", ...extra });
    clearTimeout(qt); qt = setTimeout(flush, 1500);
  }
  function flush() {
    if (!queue.length) return;
    const body = JSON.stringify({ events: queue.splice(0, 20) });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    else fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
  addEventListener("pagehide", flush);

  // ---------- State ----------
  let cart = local.get("cart", {}), promo = local.get("promo", null), coupon = local.get("coupon", null);
  let vehicle = local.get("vehicle", null), session = { loggedIn: false }, localWish = local.get("wish", []);
  for (const id of Object.keys(cart)) if (!byId.has(Number(id))) delete cart[id];
  const vehicleListeners = [];
  const wishlist = () => (session.role === "customer" ? session.wishlist : localWish);
  const lines = () => Object.entries(cart).map(([id, qty]) => { const p = byId.get(Number(id)); return { id: p.id, qty, price: p.price, gstRate: p.gstRate, weightG: p.weightG }; });
  const totals = (cod) => Core.computeTotals(lines(), { coupon, cod });
  const fitsVehicle = (p) => Core.fits(p, vehicle);
  const vehicleName = (v) => (v ? `${v.year} ${v.make} ${v.model}` : "");

  function setVehicle(v, opts = {}) {
    vehicle = v ? { make: v.make, model: v.model, year: Number(v.year) } : null;
    local.set("vehicle", vehicle);
    if (vehicle && session.role === "customer" && !opts.noSync) {
      const g = session.garage || [];
      if (!g.some((x) => x.make === vehicle.make && x.model === vehicle.model && x.year === vehicle.year))
        api("PUT", "/api/account/garage", { garage: [vehicle, ...g].slice(0, 10) }).then((s) => { session.garage = s.garage; }).catch(() => {});
    }
    vehicleListeners.forEach((f) => f(vehicle));
  }

  // ---------- Cart ----------
  function add(id, n = 1) {
    const p = byId.get(Number(id));
    if (!p || !p.inStock) return toast("Sorry, that's out of stock.");
    cart[p.id] = Math.min(20, (cart[p.id] || 0) + n);
    track("add_to_cart", { productId: p.id, value: p.price * n });
    cartChanged();
    toast(`Added ${p.name}`);
  }
  function cartChanged() { local.set("cart", cart); renderCart(); }
  function photo(p, cls) { return p.images && p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy" ${cls ? `class="${cls}"` : ""}>` : ""; }

  function renderCart() {
    const ids = Object.keys(cart), count = ids.reduce((s, i) => s + cart[i], 0);
    $("cartCount").textContent = count;
    $("cartItems").innerHTML = ids.length ? ids.map((id) => {
      const p = byId.get(Number(id));
      return `<div class="line"><a class="th" href="/p/${p.slug}" style="--c:${CATS[p.category].c}55">${p.icon}${photo(p)}</a>
      <div><a class="n" href="/p/${p.slug}">${esc(p.name)}</a>${vehicle && !fitsVehicle(p) ? `<div class="small warn-t">Not listed for your ${esc(vehicle.model)}</div>` : ""}
      <div class="qty"><button type="button" data-q="${id}" data-d="-1" aria-label="Decrease">−</button><span>${cart[id]}</span><button type="button" data-q="${id}" data-d="1" aria-label="Increase">+</button></div></div>
      <div class="pr">${money(p.price * cart[id])}<button class="rm" type="button" data-rm="${id}">Remove</button></div></div>`;
    }).join("") : `<div class="cempty"><div aria-hidden="true">🛒</div><p>Your cart is empty.<br>Add something and it shows up here.</p></div>`;
    const t = totals(false);
    $("tSub").textContent = money(t.sub); $("tDiscRow").hidden = t.disc <= 0; $("tDisc").textContent = "−" + money(t.disc);
    $("tShip").textContent = t.ship ? money(t.ship) : "Free"; $("tTotal").textContent = money(t.total); $("tTax").textContent = money(t.tax);
    const left = STORE.freeShip - t.after;
    $("ship").innerHTML = t.sub === 0 ? "" : left > 0
      ? `Add <b>${money(left)}</b> more for free shipping<div class="track"><div class="fill" style="width:${Math.min(100, (t.after / STORE.freeShip) * 100)}%"></div></div>`
      : `🎉 <b>You've unlocked free shipping</b><div class="track"><div class="fill" style="width:100%"></div></div>`;
    $("checkoutBtn").disabled = !ids.length;
    $("promoIn").value = promo || "";
    document.dispatchEvent(new CustomEvent("cart:change"));
  }
  $("cartItems").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const { q, d, rm } = b.dataset;
    if (rm) delete cart[rm];
    if (q) { cart[q] = Math.min(20, cart[q] + Number(d)); if (cart[q] <= 0) delete cart[q]; }
    if (rm || q) cartChanged();
  };
  $("promoForm").onsubmit = async (e) => {
    e.preventDefault();
    const code = $("promoIn").value.trim().toUpperCase();
    if (!code) { promo = null; coupon = null; local.set("promo", null); local.set("coupon", null); return renderCart(); }
    if (!Object.keys(cart).length) return toast("Add something to your cart first.");
    try {
      const q = await api("POST", "/api/quote", { cart, promo: code });
      if (q.promoError) { toast(q.promoError); return; }
      promo = code; coupon = q.coupon; local.set("promo", promo); local.set("coupon", coupon);
      toast(`${code} applied: ${coupon.percent}% off`); renderCart();
    } catch (err) { toast(err.message); }
  };
  function openCart(o) { $("drawer").classList.toggle("open", o); $("overlay").classList.toggle("on", o); $("drawer").setAttribute("aria-hidden", String(!o)); if (o) $("closeCart").focus(); }
  $("cartBtn").onclick = () => openCart(true);
  $("closeCart").onclick = $("overlay").onclick = () => openCart(false);
  addEventListener("keydown", (e) => { if (e.key === "Escape") { openCart(false); closeAc(); } });

  // Restore a cart from an abandoned-cart email link (?restore=...).
  const params = new URLSearchParams(location.search);
  if (params.get("restore")) {
    try {
      const saved = JSON.parse(atob(params.get("restore").replace(/-/g, "+").replace(/_/g, "/")));
      for (const [id, q] of Object.entries(saved)) if (byId.has(Number(id)) && Number.isInteger(q) && q > 0) cart[id] = Math.min(20, q);
      cartChanged(); setTimeout(() => openCart(true), 300);
    } catch { /* bad link: ignore */ }
    params.delete("restore"); history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : ""));
  }

  // ---------- Checkout ----------
  const co = $("checkout"), coForm = $("coForm");
  let pinInfo = null, pinTimer;
  const method = () => coForm.elements.method.value;
  function renderCheckout() {
    const cod = method() === "cod", t = totals(cod), base = totals(false);
    $("coSub").textContent = money(t.sub); $("coDiscRow").hidden = t.disc <= 0; $("coDisc").textContent = "−" + money(t.disc);
    $("coShip").textContent = t.ship ? money(t.ship) : "Free"; $("coCodRow").hidden = !cod; $("coCodFee").textContent = money(STORE.codFee);
    $("coTotal").textContent = $("coTotal2").textContent = money(t.total); $("coTax").textContent = money(t.tax);
    const codOk = C.cod && base.total + STORE.codFee <= STORE.codMax && (!pinInfo || pinInfo.cod);
    const opt = $("codOpt"), radio = opt.querySelector("input");
    radio.disabled = !codOk; opt.classList.toggle("dis", !codOk);
    $("codNote").textContent = !C.cod ? "Not available right now" : base.total + STORE.codFee > STORE.codMax ? `Available for orders up to ${money(STORE.codMax)}`
      : pinInfo && !pinInfo.cod ? "Not available for this PIN code" : `Pay when it arrives. ${money(STORE.codFee)} fee.`;
    if (!codOk && cod) { coForm.elements.method.value = "online"; return renderCheckout(); }
    $("payBtn").firstChild.textContent = cod ? "Place order · " : "Pay securely · ";
  }
  async function checkPin() {
    const pin = coForm.elements.zip.value.trim(), out = $("pinStatus");
    pinInfo = null;
    if (!Core.validPin(pin)) { out.textContent = ""; renderCheckout(); return; }
    out.textContent = "Checking delivery…"; out.className = "pinst muted";
    try {
      const w = lines().reduce((s, l) => s + (l.weightG || 500) * l.qty, 0);
      const r = await api("GET", `/api/shipping/check?pin=${pin}&weight=${w}`);
      pinInfo = r;
      out.className = "pinst " + (r.ok ? "ok-t" : "bad-t");
      out.textContent = r.ok ? `Delivers in ${r.eta[0]}–${r.eta[1]} days${C.cod && !r.cod ? " · Cash on delivery not available here" : ""}` : r.reason;
    } catch { out.textContent = ""; }
    renderCheckout();
  }
  coForm.elements.zip.addEventListener("input", () => { clearTimeout(pinTimer); pinTimer = setTimeout(checkPin, 350); });
  coForm.addEventListener("change", (e) => { if (e.target.name === "method") renderCheckout(); });

  function fillAddress(a) { for (const k of ["name", "phone", "addr", "city", "state", "zip"]) if (a[k] != null && coForm.elements[k]) coForm.elements[k].value = a[k]; checkPin(); }
  function openCheckout() {
    if (!Object.keys(cart).length) return toast("Your cart is empty.");
    const saved = local.get("contact", {});
    for (const k of ["name", "email", "phone", "addr", "city", "state", "zip"]) if (saved[k] && coForm.elements[k]) coForm.elements[k].value = saved[k];
    if (session.role === "customer") {
      if (!coForm.elements.email.value) coForm.elements.email.value = session.email;
      if (!coForm.elements.name.value) coForm.elements.name.value = session.name;
      const list = session.addresses || [];
      $("savedAddr").hidden = !list.length;
      $("savedAddr").innerHTML = list.map((a, i) => `<button type="button" data-addr="${i}">Use ${esc(a.label)}: ${esc(a.city)}</button>`).join("");
      $("coLead").textContent = `Signed in as ${session.email}. This order will appear in your account.`;
    }
    $("coErr").textContent = "";
    renderCheckout(); checkPin();
    openCart(false); co.showModal();
    track("begin_checkout", { value: totals(false).total });
  }
  $("savedAddr").onclick = (e) => { const i = e.target.dataset.addr; if (i != null) fillAddress(session.addresses[i]); };
  $("checkoutBtn").onclick = openCheckout;
  $("coCancel").onclick = () => co.close();

  function validate(f) {
    if (!f.name || !f.addr || !f.city) return "Please fill in your name and full address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) return "Please enter a valid email address.";
    if (!Core.validPhone(f.phone)) return "Please enter a valid 10-digit Indian mobile number.";
    if (!Core.validPin(f.zip)) return "Please enter a valid 6-digit PIN code.";
    if (!f.state) return "Please choose your state.";
    if (pinInfo && !pinInfo.ok) return pinInfo.reason;
    return null;
  }
  function done(ref, amount, token, cod, eta) {
    local.set("lastOrder", cart);
    const f = Object.fromEntries(new FormData(coForm));
    $("doneMsg").textContent = cod
      ? `Thanks ${f.name.split(" ")[0]}! Order ${ref} is placed. Please keep ${money(amount)} ready to pay on delivery${eta ? `, expected in ${eta[0]}–${eta[1]} days` : ""}. We've emailed the details to ${f.email}.`
      : `Thanks ${f.name.split(" ")[0]}! Payment received for order ${ref} (${money(amount)}). A confirmation and GST invoice are on their way to ${f.email}.`;
    $("doneTrack").href = `/track?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}`;
    cart = {}; promo = null; coupon = null; local.set("promo", null); local.set("coupon", null); cartChanged();
    co.close(); $("done").showModal();
  }
  coForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(coForm));
    const problem = validate(f);
    if (problem) { $("coErr").textContent = problem; return; }
    const { method: m, ...contact } = f;
    local.set("contact", { ...contact });
    const btn = $("payBtn"); btn.disabled = true; $("coErr").textContent = "";
    try {
      if (m === "online" && typeof Razorpay === "undefined") throw new Error("The payment window didn't load. Check your connection and try again.");
      const o = await api("POST", "/api/create-order", { cart, promo, customer: contact, vehicle, method: m, anonId });
      if (o.cod) { done(o.ref, o.amount, o.trackToken, true, o.eta); btn.disabled = false; return; }
      track("payment_started", { value: o.amount / 100 });
      const rz = new Razorpay({
        key: o.key, amount: o.amount, currency: o.currency, name: document.querySelector(".logo span")?.textContent || "Nnedverse", description: "Order " + o.ref, order_id: o.orderId,
        prefill: { name: contact.name, email: contact.email, contact: contact.phone }, theme: { color: "#f06000" },
        modal: { ondismiss: () => { btn.disabled = false; } },
        handler: async (resp) => {
          try { const v = await api("POST", "/api/verify-payment", resp); done(v.ref, v.amount, v.trackToken, false, o.eta); }
          catch (err) { $("coErr").textContent = `${err.message} If money was taken, contact us with payment ID ${resp.razorpay_payment_id}.`; co.showModal(); }
          btn.disabled = false;
        }
      });
      rz.on("payment.failed", (x) => { $("coErr").textContent = (x.error && x.error.description) || "Payment failed. Please try again."; btn.disabled = false; });
      co.close(); rz.open();
    } catch (err) {
      $("coErr").textContent = err.message; btn.disabled = false;
      if (err.status === 409 && err.data && err.data.productId) { delete cart[err.data.productId]; cartChanged(); }
    }
  };
  $("doneClose").onclick = () => $("done").close();

  // ---------- Accounts ----------
  const authDlg = $("authDlg");
  function showPane(name) {
    authDlg.querySelectorAll("[data-pane]").forEach((f) => { f.hidden = f.dataset.pane !== name; f.querySelector(".err").textContent = ""; });
    authDlg.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    const first = authDlg.querySelector(`[data-pane="${name}"] input`); if (first) setTimeout(() => first.focus(), 30);
  }
  function openAuth(pane = "login") { showPane(pane); if (!authDlg.open) authDlg.showModal(); }
  authDlg.addEventListener("click", (e) => { const t = e.target.closest("[data-tab]"); if (t) showPane(t.dataset.tab); if (e.target.closest("[data-close]")) authDlg.close(); });
  async function authSubmit(form, url, body, after) {
    const err = form.querySelector(".err"), btn = form.querySelector("button:not([type])");
    btn.disabled = true; err.textContent = "";
    try { await api("POST", url, body); await after(); } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
  }
  $("loginForm").onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    authSubmit(e.target, "/api/account/login", f, async () => { authDlg.close(); await loadSession(); toast(`Welcome back, ${session.name.split(" ")[0]}`); }); };
  $("registerForm").onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    authSubmit(e.target, "/api/account/register", { ...f, marketingOk: !!f.marketingOk }, async () => { authDlg.close(); await loadSession(true); toast("Account created"); }); };
  $("forgotForm").onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    authSubmit(e.target, "/api/account/forgot", f, async () => { e.target.querySelector(".err").textContent = ""; authDlg.close(); toast("If that email has an account, a reset link is on its way."); }); };

  async function loadSession(fresh) {
    try { session = await api("GET", "/api/session"); } catch { session = { loggedIn: false }; }
    if (session.role === "customer") {
      // Bring this device's car and wishlist into the account the first time.
      if (fresh && localWish.length) { try { session = { ...session, ...(await api("PUT", "/api/account/wishlist", { wishlist: [...new Set([...session.wishlist, ...localWish])] })) }; } catch { /* keep going */ } }
      if (vehicle) setVehicle(vehicle); else if (session.garage?.length) setVehicle(session.garage[0], { noSync: true });
    }
    renderAuth(); renderWish();
    document.dispatchEvent(new CustomEvent("session:change", { detail: session }));
  }
  function renderAuth() {
    const b = $("authBtn"), m = $("authMenu");
    if (session.role === "customer") {
      b.innerHTML = `Hi, ${esc(session.name.split(" ")[0])} <span aria-hidden="true">▾</span>`;
      m.innerHTML = `<a href="/account">My account</a><a href="/account#orders">Orders and returns</a><a href="/account#garage">My Garage</a><button type="button" data-out>Sign out</button>`;
    } else if (session.role === "admin") {
      b.innerHTML = `Admin <span aria-hidden="true">▾</span>`;
      m.innerHTML = `<a href="/admin">Admin dashboard</a><button type="button" data-out>Sign out</button>`;
    } else { b.textContent = "Sign in"; m.innerHTML = ""; }
    b.setAttribute("aria-expanded", "false");
  }
  $("authBtn").onclick = (e) => { e.stopPropagation(); if (!session.loggedIn) return openAuth(); const m = $("authMenu"); m.classList.toggle("show"); $("authBtn").setAttribute("aria-expanded", String(m.classList.contains("show"))); };
  $("authMenu").onclick = async (e) => {
    if (!e.target.closest("[data-out]")) return;
    await api("POST", session.role === "admin" ? "/api/signout" : "/api/account/logout").catch(() => {});
    session = { loggedIn: false }; renderAuth(); renderWish(); toast("Signed out");
    document.dispatchEvent(new CustomEvent("session:change", { detail: session }));
  };
  document.addEventListener("click", (e) => { if (!e.target.closest("#authBtn") && !e.target.closest("#authMenu")) $("authMenu").classList.remove("show"); });

  // ---------- Wishlist ----------
  async function toggleWish(id) {
    id = Number(id);
    const list = wishlist(), on = list.includes(id), next = on ? list.filter((x) => x !== id) : [...list, id];
    if (session.role === "customer") {
      try { session = { ...session, ...(await api("PUT", "/api/account/wishlist", { wishlist: next })) }; } catch (e) { return toast(e.message); }
    } else { localWish = next; local.set("wish", next); if (!on) toast("Saved on this device. Sign in to keep it everywhere."); }
    renderWish();
  }
  function renderWish() {
    const list = wishlist();
    document.querySelectorAll("[data-wish]").forEach((b) => { const on = list.includes(Number(b.dataset.wish)); b.classList.toggle("on", on); b.textContent = on ? "♥" : "♡"; b.setAttribute("aria-pressed", String(on)); });
  }
  document.addEventListener("click", (e) => {
    const w = e.target.closest("[data-wish]"); if (w) { e.preventDefault(); toggleWish(w.dataset.wish); return; }
    const a = e.target.closest("[data-add]"); if (a) { e.preventDefault(); add(a.dataset.add); }
  });

  // ---------- Product card (used by grids) ----------
  function stars(r) { const f = Math.round(r); return "★".repeat(f) + "☆".repeat(5 - f); }
  function card(p) {
    const fit = vehicle ? fitsVehicle(p) : null;
    return `<article class="card">
      <a class="pic" href="/p/${p.slug}" style="--c:${CATS[p.category].c}40" aria-label="${esc(p.name)}"><span aria-hidden="true">${p.icon}</span>${photo(p)}
        <div class="fitbadge ${fit ? "ok" : ""}">${fit === true ? "✔ Fits your car" : fit === false ? "Not listed for your car" : p.universal ? "Universal fit" : "Check fit"}</div>
        ${p.bestSeller ? '<div class="best">Best seller</div>' : ""}</a>
      <button class="wish" type="button" data-wish="${p.id}" aria-label="Save ${esc(p.name)} to wishlist">♡</button>
      <div class="info">
        <span class="cat-l">${esc(p.category)}</span>
        <h3><a href="/p/${p.slug}">${esc(p.name)}</a></h3>
        <p>${esc(p.shortDesc)}</p>
        <div class="stars">${p.reviewCount ? `${stars(p.rating)}<small>${p.rating} (${p.reviewCount})</small>` : '<span class="none">No reviews yet</span>'}</div>
        ${!p.inStock ? '<span class="oos">Out of stock</span>' : p.stockLeft ? `<span class="low">Only ${p.stockLeft} left</span>` : ""}
        <div class="buy"><span><span class="price">${money(p.price)}</span>${p.mrp ? `<span class="mrp">${money(p.mrp)}</span>` : ""}</span>
          <button class="add" type="button" data-add="${p.id}" ${p.inStock ? "" : "disabled"}>${p.inStock ? "Add to cart" : "Sold out"}</button></div>
      </div>
    </article>`;
  }

  // ---------- Nav search with suggestions ----------
  const idx = Search.build(C.products, C.vehicles);
  const sIn = $("search"), ac = $("ac");
  let acSel = -1;
  function closeAc() { ac.hidden = true; sIn.setAttribute("aria-expanded", "false"); acSel = -1; }
  function renderAc() {
    const q = sIn.value.trim();
    if (q.length < 2 || document.body.dataset.page === "home" || document.body.dataset.page === "category") return closeAc();
    const r = Search.search(idx, q);
    const cats = Object.keys(CATS).filter((c) => c.toLowerCase().startsWith(q.toLowerCase()));
    ac.innerHTML = (r.vehicle ? `<a href="/?q=${encodeURIComponent(q)}" role="option"><span class="ic">🚗</span><span>All parts for ${esc(r.vehicle.make)} ${esc(r.vehicle.model || "")}<small>Matching “${esc(q)}”</small></span></a>` : "") +
      cats.map((c) => `<a href="/c/${Core.slugify(c)}" role="option"><span class="ic">${CATS[c].em}</span><span>${esc(c)}<small>Category</small></span></a>`).join("") +
      (r.items.length ? `<div class="hd">Products</div>` + r.items.slice(0, 6).map((p) => `<a href="/p/${p.slug}" role="option"><span class="ic">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="">` : p.icon}</span><span>${esc(p.name)}<small>${money(p.price)}${p.inStock ? "" : " · Out of stock"}</small></span></a>`).join("")
        : `<div class="none">No products match “${esc(q)}”. Try a shorter word, or ask the assistant.</div>`);
    ac.hidden = false; sIn.setAttribute("aria-expanded", "true"); acSel = -1;
  }
  sIn.addEventListener("input", renderAc);
  sIn.addEventListener("keydown", (e) => {
    const items = [...ac.querySelectorAll("a")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!items.length) return; acSel = (acSel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((a, i) => a.classList.toggle("sel", i === acSel)); }
    if (e.key === "Enter") {
      if (acSel >= 0 && items[acSel]) { location.href = items[acSel].href; return; }
      if (document.body.dataset.page !== "home" && document.body.dataset.page !== "category" && sIn.value.trim()) location.href = "/?q=" + encodeURIComponent(sIn.value.trim()) + "#shop";
    }
  });
  sIn.addEventListener("blur", () => setTimeout(closeAc, 150));
  let searchTimer;
  sIn.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (sIn.value.trim().length > 2) track("search", { path: sIn.value.trim().toLowerCase().slice(0, 100) }); }, 1200); });

  // ---------- Newsletter ----------
  $("newsForm").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("POST", "/api/subscribe", { email: $("newsEmail").value }); e.target.reset(); toast("You're on the list. Thanks!"); }
    catch (err) { toast(err.message); }
  };

  // ---------- Assistant ----------
  if ($("aiBtn")) {
    const box = $("aiBox"), msgs = $("aiMsgs");
    let history = []; try { history = JSON.parse(sessionStorage.getItem("ai") || "[]"); } catch { /* fresh */ }
    const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, (u) => (u.startsWith(location.origin) || u.startsWith("/") ? `<a href="${u}">${u.replace(location.origin, "")}</a>` : u));
    const show = (role, text) => { const d = document.createElement("div"); d.className = "m " + (role === "user" ? "u" : "a"); d.innerHTML = linkify(text); msgs.append(d); msgs.scrollTop = msgs.scrollHeight; };
    history.forEach((m) => show(m.role, m.text));
    const toggle = (o) => { box.hidden = !o; $("aiBtn").setAttribute("aria-expanded", String(o)); if (o) $("aiIn").focus(); };
    $("aiBtn").onclick = () => toggle(box.hidden);
    $("aiClose").onclick = () => toggle(false);
    $("aiForm").onsubmit = async (e) => {
      e.preventDefault();
      const text = $("aiIn").value.trim(); if (!text) return;
      $("aiIn").value = ""; history.push({ role: "user", text }); show("user", text);
      const wait = document.createElement("div"); wait.className = "m a muted"; wait.textContent = "Thinking…"; msgs.append(wait);
      try {
        const r = await api("POST", "/api/assistant", { messages: history, vehicle });
        wait.remove(); history.push({ role: "assistant", text: r.reply }); show("assistant", r.reply);
        const items = (r.actions || []).filter((a) => a.type === "add_to_cart" && byId.has(a.productId));
        if (items.length) {
          const b = document.createElement("button"); b.className = "btn act"; b.type = "button";
          b.textContent = items.length === 1 ? `Add ${byId.get(items[0].productId).name} to cart` : `Add these ${items.length} items to cart`;
          b.onclick = () => { items.forEach((a) => add(a.productId, a.qty)); b.disabled = true; b.textContent = "Added"; };
          msgs.append(b); msgs.scrollTop = msgs.scrollHeight;
        }
      } catch (err) { wait.textContent = err.message; history.pop(); }
      try { sessionStorage.setItem("ai", JSON.stringify(history.slice(-20))); } catch { /* storage off */ }
    };
  }

  window.Store = { C, byId, esc, money, api, toast, track, add, card, stars, openCart, openCheckout, openAuth, renderWish, toggleWish, local,
    get vehicle() { return vehicle; }, setVehicle, onVehicle: (f) => vehicleListeners.push(f), fitsVehicle, vehicleName,
    get session() { return session; }, loadSession, get cart() { return cart; }, cartChanged, searchIndex: idx };

  renderCart();
  loadSession();
  track("page_view");
})();
