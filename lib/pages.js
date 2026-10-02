// Server-rendered pages: real URLs, titles, meta descriptions, canonical links and
// structured data for search engines. Interactive parts load from /store.js and a page script.
const Core = require("../public/core");
const { esc } = require("./security");
const policies = require("./policies");

const { money, STORE, CATS } = Core;
const site = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const brand = () => process.env.BUSINESS_NAME || "Needverse";
const catSlug = (c) => Core.slugify(c);
const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, "");
const stars = (r) => { const f = Math.round(r); return "★".repeat(f) + "☆".repeat(5 - f); };
const CART_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6h15l-2 9H8L6 3H3"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>';

function layout({ title, desc, path = "/", body, jsonLd = [], page, data, noindex, assistant }) {
  const canonical = site() + path;
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<meta property="og:type" content="${page === "product" ? "product" : "website"}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(brand())}">
<meta name="theme-color" content="#0a0b0d">
<link rel="icon" type="image/png" href="/favicon.png">
<meta property="og:image" content="${esc(site())}/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/store.css">
${jsonLd.map((j) => `<script type="application/ld+json">${json(j)}</script>`).join("\n")}
</head>
<body data-page="${page}">
<a class="sr" href="#main">Skip to content</a>
<div class="announce">FREE SHIPPING OVER ${money(STORE.freeShip)} &nbsp;·&nbsp; ${process.env.COD_ENABLED === "false" ? "SECURE UPI &amp; CARD PAYMENTS" : "CASH ON DELIVERY AVAILABLE"} &nbsp;·&nbsp; ${STORE.returnDays}-DAY RETURNS</div>
<nav class="nav" aria-label="Main">
  <div class="wrap">
    <a class="logo" href="/"><img src="/logo.webp" alt="${esc(brand())}" width="82" height="68"></a>
    <div class="links"><a href="/#shop">Shop</a><a href="/#cats">Categories</a><a href="/#kits">Kits</a><a href="/track">Track order</a></div>
    <div class="search">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="search" type="search" placeholder="Try “creta floor mats” or “dash cam”" aria-label="Search products" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="ac">
      <div id="ac" class="ac" role="listbox" hidden></div>
    </div>
    <div class="navr">
      <button id="authBtn" class="authbtn" type="button">Sign in</button>
      <div id="authMenu"></div>
      <button id="cartBtn" class="cartbtn" type="button" aria-label="Open cart">${CART_ICON} Cart <b id="cartCount">0</b></button>
    </div>
  </div>
</nav>
<div id="main">${body}</div>
${footer()}
${shell(assistant)}
<script id="catalog" type="application/json">${json(data)}</script>
<script src="https://checkout.razorpay.com/v1/checkout.js" defer></script>
<script src="/core.js"></script>
<script src="/search.js"></script>
<script src="/store.js"></script>
${page === "account" || page === "track" ? '<script src="/orders-ui.js"></script>' : ""}
${page && ["home", "category", "product", "account", "track"].includes(page) ? `<script src="/${page === "category" ? "home" : page}.js"></script>` : ""}
</body>
</html>`;
}

function footer() {
  const e = process.env;
  return `<footer id="help"><div class="wrap">
  <div class="fgrid">
    <div><a class="logo logo-lg" href="/"><img src="/logo.webp" alt="${esc(brand())}" width="121" height="100" loading="lazy"></a>
      <p class="muted small" style="max-width:300px;margin-top:14px">Car accessories that fit your vehicle, picked once and shipped across India.</p>
      ${e.BUSINESS_LEGAL_NAME || e.BUSINESS_ADDRESS ? `<p class="muted small" style="max-width:320px">${esc(e.BUSINESS_LEGAL_NAME || "")}<br>${esc(e.BUSINESS_ADDRESS || "")}${e.BUSINESS_GSTIN ? `<br>GSTIN ${esc(e.BUSINESS_GSTIN)}` : ""}</p>` : ""}</div>
    <div><h4>Shop</h4><ul>${Object.keys(CATS).map((c) => `<li><a href="/c/${catSlug(c)}">${esc(c)}</a></li>`).join("")}</ul></div>
    <div><h4>Help</h4><ul><li><a href="/track">Track your order</a></li><li><a href="/account">Your account</a></li>
      ${policies.LIST.map((p) => `<li><a href="/policies/${p.slug}">${esc(p.title)}</a></li>`).join("")}</ul></div>
    <div><h4>Offers and news</h4><p class="muted small" style="margin:0">New arrivals and offers, about twice a month. Unsubscribe any time.</p>
      <form class="news" id="newsForm"><input type="email" id="newsEmail" placeholder="you@email.com" aria-label="Email" required><button class="btn">Join</button></form></div>
  </div>
  <div class="copy"><span>© ${new Date().getFullYear()} ${esc(e.BUSINESS_LEGAL_NAME || brand())}. All rights reserved.</span><span>Secure payments by Razorpay</span></div>
</div></footer>`;
}

// Cart drawer, checkout, confirmation, sign-in dialog and the assistant. Same on every page.
function shell(assistant) {
  return `<div id="overlay" class="overlay"></div>
<aside id="drawer" class="drawer" aria-label="Cart" aria-hidden="true">
  <div class="dh"><h2>Your cart</h2><button id="closeCart" class="x" type="button" aria-label="Close cart">✕</button></div>
  <div id="ship" class="ship"></div>
  <div id="cartItems" class="items"></div>
  <div class="df">
    <form id="promoForm" class="pf"><input id="promoIn" placeholder="Promo code" aria-label="Promo code"><button class="btn ghost">Apply</button></form>
    <div class="tot">
      <div><span>Subtotal</span><span id="tSub">₹0</span></div>
      <div class="dsc" id="tDiscRow" hidden><span>Savings</span><span id="tDisc"></span></div>
      <div><span>Shipping</span><span id="tShip">₹0</span></div>
      <div class="g"><span>Total</span><span id="tTotal">₹0</span></div>
      <div class="small"><span>Includes GST</span><span id="tTax"></span></div>
    </div>
    <button id="checkoutBtn" class="btn block" type="button">Checkout →</button>
  </div>
</aside>

<dialog id="checkout">
  <form id="coForm" novalidate>
    <h2>Secure Checkout</h2>
    <p class="muted small" id="coLead">No account needed. Your details are remembered on this device.</p>
    <div class="co-summary">
      <div><span>Subtotal</span><span id="coSub"></span></div>
      <div id="coDiscRow" hidden><span>Savings</span><span style="color:var(--ok)" id="coDisc"></span></div>
      <div><span>Shipping</span><span id="coShip"></span></div>
      <div id="coCodRow" hidden><span>Cash on delivery fee</span><span id="coCodFee"></span></div>
      <div class="co-total"><span>Total</span><span id="coTotal"></span></div>
      <div class="tax"><span>Includes GST</span><span id="coTax"></span></div>
    </div>
    <div id="savedAddr" class="saved" hidden></div>
    <label>Full name<input name="name" autocomplete="name" placeholder="Your full name" required maxlength="100"></label>
    <label>Email<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="120"></label>
    <label>Mobile number<input name="phone" type="tel" autocomplete="tel" placeholder="98765 43210" required maxlength="20"></label>
    <label>Street address<input name="addr" autocomplete="street-address" placeholder="House no, street, area" required maxlength="200"></label>
    <div class="two">
      <label>City<input name="city" autocomplete="address-level2" placeholder="City" required maxlength="80"></label>
      <label>PIN code<input name="zip" autocomplete="postal-code" inputmode="numeric" placeholder="560001" required maxlength="6"></label>
    </div>
    <div id="pinStatus" class="pinst" aria-live="polite"></div>
    <label>State<select name="state" autocomplete="address-level1" required><option value="">Choose your state</option>${Core.STATES.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>
    <div class="paym" role="radiogroup" aria-label="Payment method">
      <label><input type="radio" name="method" value="online" checked> <span>Pay online<small>UPI, cards, netbanking or wallets via Razorpay</small></span></label>
      <label id="codOpt"><input type="radio" name="method" value="cod"> <span>Cash on delivery<small id="codNote"></small></span></label>
    </div>
    <div class="co-security"><span aria-hidden="true">🔒</span><span>Payments are processed by Razorpay. We never see your card details.</span></div>
    <p id="coErr" class="err" role="alert"></p>
    <div class="acts">
      <button type="button" id="coCancel" class="btn ghost">Back</button>
      <button class="btn" id="payBtn" style="flex:2">Place order · <span id="coTotal2"></span></button>
    </div>
  </form>
</dialog>

<dialog id="done">
  <h2>Order confirmed ✅</h2>
  <p id="doneMsg" class="muted"></p>
  <div class="acts"><a id="doneTrack" class="btn ghost" href="/track">Track order</a><button id="doneClose" class="btn" type="button">Keep shopping</button></div>
</dialog>

<dialog id="authDlg">
  <div class="tabs" role="tablist"><button type="button" data-tab="login" class="on">Sign in</button><button type="button" data-tab="register">Create account</button></div>
  <form id="loginForm" data-pane="login">
    <label>Email<input name="email" type="email" autocomplete="email" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <p class="err" role="alert"></p>
    <div class="acts"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Sign in</button></div>
    <p class="small"><button type="button" class="linkbtn" data-tab="forgot">Forgot your password?</button></p>
  </form>
  <form id="registerForm" data-pane="register" hidden>
    <label>Name<input name="name" autocomplete="name" required maxlength="100"></label>
    <label>Email<input name="email" type="email" autocomplete="email" required maxlength="120"></label>
    <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
    <label class="check"><input type="checkbox" name="marketingOk"> Send me offers and new arrivals by email</label>
    <p class="muted small">By creating an account you agree to our <a href="/policies/terms" class="linkbtn">terms</a> and <a href="/policies/privacy" class="linkbtn">privacy policy</a>.</p>
    <p class="err" role="alert"></p>
    <div class="acts"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Create account</button></div>
  </form>
  <form id="forgotForm" data-pane="forgot" hidden>
    <p class="muted">Enter your email and we'll send a link to choose a new password.</p>
    <label>Email<input name="email" type="email" autocomplete="email" required></label>
    <p class="err" role="alert"></p>
    <div class="acts"><button type="button" class="btn ghost" data-tab="login">Back</button><button class="btn">Send link</button></div>
  </form>
</dialog>
${`<button id="aiBtn" class="aibtn" type="button" aria-expanded="false">💬 <span>Chat with us</span></button>
<section id="aiBox" class="aibox" aria-label="Shopping assistant" hidden>
  <header><b>Needverse help</b><button id="aiClose" class="x" type="button" aria-label="Close assistant">✕</button></header>
  <div id="aiMsgs" class="aimsgs" aria-live="polite"><div class="m a">Hi! Tell me your car and what you need, like “floor mats for a 2023 Creta under ₹5,000”. I can also help with delivery, returns, COD and your orders.</div></div>
  <form id="aiForm" class="aiform"><input id="aiIn" placeholder="Ask a question" aria-label="Message" maxlength="1000" autocomplete="off"><button class="btn">Send</button></form>
  <p class="ainote">${assistant === "claude" ? "AI answers can be wrong. Check fit details on the product page." : "Automated helper. Check fit details on the product page."}</p>
</section>`}
<div id="toast" class="toast" role="status"></div>`;
}

// ---------- Pages ----------
function home(c, opts) {
  const S = STORE;
  const body = `<header class="hero">
  <div class="wrap">
    <div>
      <span class="eyebrow">Car accessories, made simple</span>
      <h1>Gear up.<em>Drive on.</em></h1>
      <p class="lead">Tell us your car once. We only show accessories that fit it, then check you out in under a minute.</p>
      <div class="facts">
        <div><b>Free shipping</b><span>On orders over ${money(S.freeShip)}</span></div>
        <div><b>${S.returnDays}-day returns</b><span>Doesn't fit? Send it back</span></div>
        <div><b>${process.env.COD_ENABLED === "false" ? "UPI &amp; cards" : "Pay on delivery"}</b><span>${process.env.COD_ENABLED === "false" ? "Secure checkout by Razorpay" : `Cash on delivery up to ${money(S.codMax)}`}</span></div>
      </div>
    </div>
    <form id="fitForm" class="finder">
      <span class="eyebrow">Fit finder</span>
      <h2 style="font-size:1.9rem;margin-bottom:4px">What do you drive?</h2>
      <p class="muted small" style="margin:6px 0 0">Saved on this device${opts.loggedIn ? " and in My Garage" : ""}, so you only do this once.</p>
      <div class="step" id="s1"><span class="num">1</span><select id="make" aria-label="Make"><option value="">Select make</option></select></div>
      <div class="step" id="s2"><span class="num">2</span><select id="model" aria-label="Model" disabled><option value="">Select model</option></select></div>
      <div class="step" id="s3"><span class="num">3</span><select id="year" aria-label="Year" disabled><option value="">Select year</option></select></div>
      <button class="btn" type="submit">Show parts that fit →</button>
      <div id="garage" class="garage" hidden></div>
    </form>
  </div>
</header>
<div class="trust"><div class="wrap">
  <div><span class="ic" aria-hidden="true">✔️</span><p style="margin:0"><b>Fit guarantee</b><span>Listed as fitting but doesn't? Free return</span></p></div>
  <div><span class="ic" aria-hidden="true">🚚</span><p style="margin:0"><b>Delivery estimate</b><span>Check your PIN code on any product</span></p></div>
  <div><span class="ic" aria-hidden="true">↩️</span><p style="margin:0"><b>${S.returnDays}-day returns</b><span>Request from your account</span></p></div>
  <div><span class="ic" aria-hidden="true">🧾</span><p style="margin:0"><b>GST invoice</b><span>With every order</span></p></div>
</div></div>
<main class="wrap">
  <section class="s" id="cats">
    <div class="head"><div><span class="eyebrow">Browse</span><h2>Shop by category</h2></div></div>
    <div id="catGrid" class="cats">${Object.entries(CATS).map(([k, v]) => `<a class="cat" href="/c/${catSlug(k)}" data-c="${esc(k)}" style="--c:${v.c}"><span class="em" aria-hidden="true">${v.em}</span><b>${esc(k)}</b><span>${esc(v.sub)}</span></a>`).join("")}</div>
  </section>
  <section class="s" id="kits">
    <div class="head"><div><span class="eyebrow">Save time &amp; money</span><h2>One-click kits</h2></div><p class="muted" style="max-width:380px;margin:0">Everything you need for a job, discounted automatically when the whole kit is in your cart.</p></div>
    <div id="kitGrid" class="kits"></div>
  </section>
  ${shopSection(c, "All products", "The shop")}
  <section id="reorderSec" class="reorder" hidden>
    <div><h2>Order again in one click</h2><p>Add everything from your last order back to your cart.</p></div>
    <button id="reorderBtn" class="btn" type="button">Reorder last order</button>
  </section>
</main>`;
  return layout({
    title: `${brand()} | Car Accessories That Fit Your Car`, desc: "Car accessories that fit your exact car. Pick your make, model and year once, see only what fits, and check out with UPI, cards or cash on delivery.",
    path: "/", body, page: "home", data: c.data, assistant: opts.assistant,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "Organization", name: process.env.BUSINESS_LEGAL_NAME || brand(), url: site(), ...(process.env.BUSINESS_EMAIL ? { email: process.env.BUSINESS_EMAIL } : {}) },
      { "@context": "https://schema.org", "@type": "WebSite", name: brand(), url: site(), potentialAction: { "@type": "SearchAction", target: `${site()}/?q={search_term_string}`, "query-input": "required name=search_term_string" } }
    ]
  });
}

// Grid + filters. The server lists every product as a link (for crawlers and no-JS); the page script redraws it.
function shopSection(c, eyebrow, heading, category) {
  const list = c.products.filter((p) => !category || p.category === category);
  return `<section class="s" id="shop">
    <div class="head"><div><span class="eyebrow" id="shopEye">${esc(eyebrow)}</span><h2>${esc(heading)}</h2></div><span id="resultInfo" class="muted" aria-live="polite"></span></div>
    <div id="vbar"></div>
    <div class="toolbar">
      <div id="chips" class="chips"></div>
      <select id="sort" aria-label="Sort products"><option value="pop">Best selling</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="rate">Top rated</option><option value="new">Newest</option></select>
    </div>
    <div class="filters">
      <span>Price</span><input id="pMin" type="number" min="0" placeholder="Min ₹" aria-label="Minimum price"><span>to</span><input id="pMax" type="number" min="0" placeholder="Max ₹" aria-label="Maximum price">
      <label class="tg"><input type="checkbox" id="fStock" class="sr"> In stock</label>
      <label class="tg"><input type="checkbox" id="fRated" class="sr"> 4★ and up</label>
      <label class="tg"><input type="checkbox" id="fFit" class="sr"> Fits my car only</label>
      <button type="button" id="fClear" class="linkbtn clr">Clear filters</button>
    </div>
    <div id="grid" class="grid">${list.map((p) => `<article class="card"><div class="info"><span class="cat-l">${esc(p.category)}</span><h3><a href="/p/${p.slug}">${esc(p.name)}</a></h3><p>${esc(p.shortDesc)}</p><span class="price">${money(p.price)}</span></div></article>`).join("")}</div>
  </section>`;
}

function category(cat, c, opts) {
  const body = `<main class="wrap page"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>›</span><span>${esc(cat)}</span></nav>
  <h1 style="font-size:clamp(2.6rem,6vw,4rem)">${esc(cat)}</h1><p class="muted">${esc(CATS[cat].sub)} that fit your car.</p>
  ${shopSection(c, cat, `All ${cat.toLowerCase()} accessories`, cat)}</main>`;
  return layout({
    title: `${cat} Car Accessories | ${brand()}`, desc: `Shop ${cat.toLowerCase()} car accessories (${CATS[cat].sub.toLowerCase()}) matched to your make, model and year. Free shipping over ${money(STORE.freeShip)}.`,
    path: `/c/${catSlug(cat)}`, body, page: "category", data: { ...c.data, category: cat }, assistant: opts.assistant,
    jsonLd: [breadcrumbs([["Home", "/"], [cat, `/c/${catSlug(cat)}`]])]
  });
}

const breadcrumbs = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: site() + path })) });
const fitText = (f) => `${f.make} ${f.model || "(all models)"}${f.yearFrom || f.yearTo ? ` ${f.yearFrom || ""}–${f.yearTo || ""}` : ""}`;
const ytEmbed = (u) => { const m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/.exec(u || ""); return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null; };

function product(p, c, reviews, opts) {
  const img = p.images[0];
  const offPct = p.mrp ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const related = c.products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
  const bundle = Core.BUNDLES.find((b) => b.ids.includes(p.id));
  const together = (p.alsoBought.length ? p.alsoBought : bundle ? bundle.ids.filter((id) => id !== p.id) : []).map((id) => c.byId.get(id)).filter(Boolean).slice(0, 3);
  const specs = [["SKU", p.sku], p.brand && ["Brand", p.brand], ...Object.entries(p.specs), ["Packed weight", `${p.weightG} g`], p.included && ["In the box", p.included],
    ["Installation", p.installDifficulty], p.warranty && ["Warranty", p.warranty]].filter(Boolean);
  const video = ytEmbed(p.videoUrl);
  const miniCard = (x) => `<article class="card"><a class="pic" href="/p/${x.slug}" style="--c:${CATS[x.category].c}40"><span aria-hidden="true">${x.icon}</span>${x.images[0] ? `<img src="${esc(x.images[0])}" alt="" loading="lazy">` : ""}</a>
    <div class="info"><span class="cat-l">${esc(x.category)}</span><h3><a href="/p/${x.slug}">${esc(x.name)}</a></h3><div class="buy"><span class="price">${money(x.price)}</span><button class="add" type="button" data-add="${x.id}" ${x.inStock ? "" : "disabled"}>${x.inStock ? "Add" : "Sold out"}</button></div></div></article>`;

  const body = `<main class="wrap page">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>›</span><a href="/c/${catSlug(p.category)}">${esc(p.category)}</a><span>›</span><span>${esc(p.name)}</span></nav>
  <div class="pp">
    <div class="gal">
      <div class="main" id="gMain" style="--c:${CATS[p.category].c}40"><span aria-hidden="true">${p.icon}</span>${img ? `<img src="${esc(img)}" alt="${esc(p.name)}">` : ""}</div>
      ${p.images.length > 1 ? `<div class="thumbs">${p.images.map((u, i) => `<button type="button" data-img="${esc(u)}" class="${i ? "" : "on"}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      ${video ? `<div class="video"><iframe src="${video}" title="${esc(p.name)} video" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>` : ""}
    </div>
    <div class="buybox">
      <span class="eyebrow">${esc(p.category)}${p.brand ? " · " + esc(p.brand) : ""}</span>
      <h1>${esc(p.name)}</h1>
      <div class="stars">${p.reviewCount ? `${stars(p.rating)}<small><a href="#reviews">${p.rating} · ${p.reviewCount} review${p.reviewCount === 1 ? "" : "s"}</a></small>` : '<span class="none">No reviews yet</span>'}</div>
      <div style="margin-top:14px"><span class="price">${money(p.price)}</span>${p.mrp ? `<span class="mrp">MRP ${money(p.mrp)}</span><span class="off">${offPct}% off</span>` : ""}
        <div class="muted small">Inclusive of all taxes</div></div>
      <div style="margin-top:8px">${!p.inStock ? '<span class="oos">Out of stock</span>' : p.stockLeft ? `<span class="low">Only ${p.stockLeft} left</span>` : '<span class="ok-t small">In stock</span>'}</div>
      <p class="lead">${esc(p.shortDesc)}</p>
      <div class="pbox" id="fitBox"><h3>DOES THIS FIT MY CAR?</h3>
        ${p.universal ? '<p style="margin:0">✔ Fits every vehicle.</p>' : `<div class="row3"><select id="fMake" aria-label="Make"><option value="">Make</option></select><select id="fModel" aria-label="Model" disabled><option value="">Model</option></select><select id="fYear" aria-label="Year" disabled><option value="">Year</option></select></div>
        <div id="fitRes" class="fitres" aria-live="polite"></div>`}
        ${p.fitNotes ? `<p class="small warn-t" style="margin:10px 0 0">${esc(p.fitNotes)}</p>` : ""}
      </div>
      <div class="qtyrow">
        <div class="qty"><button type="button" id="qMinus" aria-label="Decrease quantity">−</button><span id="qVal">1</span><button type="button" id="qPlus" aria-label="Increase quantity">+</button></div>
        <button class="btn ghost" type="button" id="addBtn" ${p.inStock ? "" : "disabled"}>Add to cart</button>
        <button class="btn" type="button" id="buyBtn" ${p.inStock ? "" : "disabled"}>Buy now</button>
        <button class="wish" type="button" id="wishBtn" style="position:static" aria-label="Save to wishlist">♡</button>
      </div>
      <div class="pbox"><h3>DELIVERY</h3>
        <form id="pinForm" style="display:flex;gap:8px"><input id="pinIn" inputmode="numeric" maxlength="6" placeholder="Enter PIN code" aria-label="PIN code" style="flex:1"><button class="btn ghost" style="padding:10px 16px">Check</button></form>
        <div id="pinRes" class="pinst" aria-live="polite"></div>
      </div>
      <div class="perks">
        <div>🚚 <b>Free shipping</b> on orders over ${money(STORE.freeShip)}</div>
        ${process.env.COD_ENABLED === "false" ? "" : `<div>💵 <b>Cash on delivery</b> available up to ${money(STORE.codMax)} (${money(STORE.codFee)} fee)</div>`}
        <div>↩️ <b>${STORE.returnDays}-day returns</b>. <a href="/policies/returns" class="linkbtn">Return policy</a></div>
        ${p.warranty ? `<div>🛡️ <b>Warranty:</b> ${esc(p.warranty)}</div>` : ""}
      </div>
    </div>
  </div>

  ${together.length ? `<section class="sect"><h2>Frequently bought together</h2><div class="mini">${together.map(miniCard).join("")}</div></section>` : ""}
  <section class="sect"><h2>Details</h2>${p.description && p.description !== p.shortDesc ? `<p class="prose">${esc(p.description)}</p>` : ""}
    <div class="tw"><table class="specs"><tbody>${specs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div></section>
  <section class="sect"><h2>Compatible vehicles</h2>${p.universal ? "<p>Fits every vehicle.</p>" : `<ul class="prose" style="white-space:normal">${p.fitment.map((f) => `<li>${esc(fitText(f))}</li>`).join("")}</ul>`}</section>
  ${p.installGuide ? `<section class="sect"><h2>Installation</h2><p class="muted">Difficulty: ${esc(p.installDifficulty)}</p><p class="prose">${esc(p.installGuide)}</p></section>` : ""}
  ${p.faqs.length ? `<section class="sect faq"><h2>Questions</h2>${p.faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>` : ""}
  <section class="sect" id="reviews"><h2>Reviews</h2>
    <div class="rsum">${p.reviewCount ? `<span class="big">${p.rating}</span><div><div class="stars">${stars(p.rating)}</div><div class="muted small">${p.reviewCount} verified review${p.reviewCount === 1 ? "" : "s"}</div></div>` : '<p class="muted" style="margin:0">No reviews yet. Bought this? Review it from your account after delivery.</p>'}
      <button type="button" id="writeReview" class="btn ghost" hidden>Write a review</button></div>
    <div id="revList">${reviews.map((v) => `<div class="rev" data-id="${v.id}"><div class="who"><b>${esc(v.author)}</b><span class="vf">✔ Verified purchase</span> · ${new Date(v.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</div>
      <div class="stars">${stars(v.rating)}</div>${v.title ? `<h4>${esc(v.title)}</h4>` : ""}<p>${esc(v.body)}</p>
      <div class="acts2"><button type="button" data-vote="helpful">Helpful (${v.helpful})</button><button type="button" data-vote="report">Report</button></div></div>`).join("")}</div>
  </section>
  ${related.length ? `<section class="sect"><h2>More ${esc(p.category.toLowerCase())}</h2><div class="mini">${related.map(miniCard).join("")}</div></section>` : ""}
</main>
<dialog id="revDlg"><form id="revForm"><h2>Review this product</h2><p class="muted small">${esc(p.name)}</p>
  <div class="starpick" id="starPick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div>
  <label>Title<input name="title" maxlength="120"></label><label>Your review<textarea name="body" maxlength="2000"></textarea></label>
  <p class="err" role="alert"></p><div class="acts"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Submit review</button></div></form></dialog>`;

  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description || p.shortDesc, sku: p.sku, category: p.category,
    image: p.images.length ? p.images : undefined, brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined, url: `${site()}/p/${p.slug}`,
    offers: { "@type": "Offer", price: p.price.toFixed(2), priceCurrency: "INR", url: `${site()}/p/${p.slug}`, itemCondition: "https://schema.org/NewCondition",
      availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      shippingDetails: { "@type": "OfferShippingDetails", shippingDestination: { "@type": "DefinedRegion", addressCountry: "IN" },
        shippingRate: { "@type": "MonetaryAmount", value: p.price >= STORE.freeShip ? 0 : STORE.shipFee, currency: "INR" } },
      hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", applicableCountry: "IN", returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: STORE.returnDays } },
    ...(p.reviewCount ? { aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.reviewCount },
      review: reviews.slice(0, 5).map((v) => ({ "@type": "Review", author: { "@type": "Person", name: v.author }, reviewRating: { "@type": "Rating", ratingValue: v.rating }, reviewBody: v.body })) } : {})
  };
  const jsonLd = [ld, breadcrumbs([["Home", "/"], [p.category, `/c/${catSlug(p.category)}`], [p.name, `/p/${p.slug}`]])];
  if (p.faqs.length) jsonLd.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  return layout({
    title: p.seoTitle || `${p.name} | ${brand()}`, desc: p.metaDesc || `${p.name}: ${p.shortDesc} ${money(p.price)}, free shipping over ${money(STORE.freeShip)}, ${STORE.returnDays}-day returns.`.slice(0, 160),
    path: `/p/${p.slug}`, body, page: "product", data: { ...c.data, productId: p.id }, jsonLd, assistant: opts.assistant
  });
}

function account(c, opts) {
  return layout({ title: `Your account | ${brand()}`, desc: "Your orders, returns, saved cars, addresses and wishlist.", path: "/account", page: "account", noindex: true,
    data: c.data, assistant: opts.assistant, body: `<main class="wrap page" id="accRoot"><h1 style="font-size:3rem">Your account</h1><p class="muted">Loading…</p></main>` });
}

function track(c, opts) {
  return layout({ title: `Track your order | ${brand()}`, desc: "Track your order, download your invoice or request a return.", path: "/track", page: "track", noindex: true,
    data: c.data, assistant: opts.assistant, body: `<main class="wrap page"><div class="narrow" id="trackRoot">
    <h1 style="font-size:3rem">Track your order</h1><p class="muted">Use the order number from your confirmation email (like NV-1A2B3C).</p>
    <form id="trackForm" class="panel"><label>Order number<input name="ref" required maxlength="20" autocomplete="off"></label>
    <label>Email used at checkout<input name="email" type="email" required autocomplete="email"></label><p class="err" role="alert"></p><button class="btn">Find my order</button></form></div>
    <div id="trackOut"></div></main>` });
}

function policy(slug, c, opts) {
  const p = policies.render(slug);
  if (!p) return null;
  return layout({ title: `${p.title} | ${brand()}`, desc: p.desc, path: `/policies/${slug}`, page: "policy", data: c.data, assistant: opts.assistant,
    body: `<main class="wrap page"><article class="doc">${p.html}</article></main>` });
}

function notFound(c, opts) {
  return layout({ title: `Page not found | ${brand()}`, desc: "This page doesn't exist.", path: "/404", page: "404", noindex: true, data: c.data, assistant: opts.assistant,
    body: `<main class="wrap page doc"><h1>Page not found</h1><p>This page doesn't exist or the product is no longer sold.</p><p><a class="btn" href="/">Back to the shop</a></p></main>` });
}

function sitemap(c) {
  const urls = [["/", null], ...Object.keys(CATS).map((k) => [`/c/${catSlug(k)}`, null]), ...c.products.map((p) => [`/p/${p.slug}`, p.updatedAt]),
    ...policies.LIST.map((p) => [`/policies/${p.slug}`, null])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, t]) =>
    `  <url><loc>${esc(site() + u)}</loc>${t ? `<lastmod>${new Date(t).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
}
const robots = () => `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nDisallow: /api/\nDisallow: /invoice/\nDisallow: /track\n\nSitemap: ${site()}/sitemap.xml\n`;

module.exports = { home, category, product, account, track, policy, notFound, sitemap, robots, catSlug };
