// Customer accounts: sign up, sign in, password reset, profile, addresses, My Garage,
// wishlist, order history and verified-purchase reviews.
const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const Core = require("../public/core");
const catalog = require("../lib/catalog");
const orders = require("../lib/orders");
const returns = require("../lib/returns");
const mail = require("../mailer");
const { hashPassword, verifyPassword, passwordProblem, limiter, clip, validEmail, sign } = require("../lib/security");
const { startSession, endSession, requireCustomer, checkAdminLogin } = require("../lib/auth");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const site = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const DUMMY_HASH = "s1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

const me = (c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, addresses: c.addresses, garage: c.garage, wishlist: c.wishlist, marketingOk: c.marketingOk });

function cleanAddress(a) {
  const out = { label: clip(a.label, 30) || "Home", name: clip(a.name, 100), phone: clip(a.phone, 20), addr: clip(a.addr, 200), city: clip(a.city, 80), state: clip(a.state, 60), zip: clip(a.zip, 6) };
  if (!out.name || !out.addr || !out.city || !Core.STATES.includes(out.state) || !Core.validPin(out.zip) || !Core.validPhone(out.phone)) return null;
  return out;
}

module.exports = function account() {
  const r = express.Router();

  r.get("/api/session", wrap(async (req, res) => {
    const s = req.session;
    if (!s) return res.json({ loggedIn: false });
    if (s.role === "admin") return res.json({ loggedIn: true, role: "admin", name: s.userName });
    const c = await db.getCustomer(s.userId);
    if (!c) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, role: "customer", ...me(c) });
  }));

  r.post("/api/account/register", limiter("register", 10, 60 * 60000), wrap(async (req, res) => {
    const b = req.body || {}, name = clip(b.name, 100), email = clip(b.email, 120).toLowerCase();
    if (!name) return res.status(400).json({ error: "Please enter your name." });
    if (!validEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });
    const pwErr = passwordProblem(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const c = await db.createCustomer({ name, email, phone: clip(b.phone, 20), passwordHash: await hashPassword(b.password), marketingOk: b.marketingOk === true });
    if (!c) return res.status(409).json({ error: "An account with this email already exists. Sign in or reset your password." });
    if (c.marketingOk) await db.addSubscriber(email);
    await startSession(req, res, c.id, c.name, "customer");
    res.json({ ok: true, ...me(c) });
  }));

  r.post("/api/account/login", limiter("login", 10, 15 * 60000), wrap(async (req, res) => {
    const email = clip(req.body.email, 120).toLowerCase(), c = validEmail(email) ? await db.getCustomerByEmail(email) : null;
    const ok = await verifyPassword(String(req.body.password || ""), c ? c.passwordHash : DUMMY_HASH);
    if (!c || !ok) return res.status(401).json({ error: "Wrong email or password." });
    await startSession(req, res, c.id, c.name, "customer");
    res.json({ ok: true, ...me(c) });
  }));

  r.post("/api/account/logout", wrap(async (req, res) => { await endSession(req, res); res.json({ ok: true }); }));

  r.post("/api/account/forgot", limiter("forgot", 5, 60 * 60000), wrap(async (req, res) => {
    const c = validEmail(req.body.email) ? await db.getCustomerByEmail(req.body.email.trim()) : null;
    if (c) {
      const token = crypto.randomBytes(32).toString("base64url");
      await db.updateCustomer(c.id, { resetHash: sha(token), resetExpires: new Date(Date.now() + 36e5).toISOString() });
      await mail.sendPasswordReset(c.email, c.name, `${site()}/account?reset=${token}&email=${encodeURIComponent(c.email)}`).catch((e) => console.error("Reset email:", e.message));
    }
    res.json({ ok: true }); // same answer either way, so this can't be used to find out who has an account
  }));

  r.post("/api/account/reset", limiter("reset", 10, 60 * 60000), wrap(async (req, res) => {
    const c = validEmail(req.body.email) ? await db.getCustomerByEmail(req.body.email.trim()) : null;
    const token = String(req.body.token || "");
    if (!c || !c.resetHash || !token || sha(token) !== c.resetHash || new Date(c.resetExpires) < new Date())
      return res.status(400).json({ error: "This reset link is invalid or has expired. Ask for a new one." });
    const pwErr = passwordProblem(req.body.password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    await db.updateCustomer(c.id, { passwordHash: await hashPassword(req.body.password), resetHash: null, resetExpires: null });
    await db.deleteSessionsForUser(c.id);
    await startSession(req, res, c.id, c.name, "customer");
    res.json({ ok: true });
  }));

  // Admin sign in (password + authenticator code when ADMIN_TOTP_SECRET is set).
  r.post("/api/admin/signin", limiter("admin-login", 8, 15 * 60000), wrap(async (req, res) => {
    const out = checkAdminLogin(req.body || {});
    if (!out.ok) {
      if (out.status === 401) await db.audit("anonymous", "admin sign-in failed", null, { username: clip(req.body.username, 40) }, req.ip);
      return res.status(out.status).json({ error: out.error, needCode: !!out.needCode });
    }
    await startSession(req, res, out.user, out.user, "admin");
    await db.audit(out.user, "admin signed in", null, null, req.ip);
    res.json({ ok: true });
  }));
  r.post("/api/signout", wrap(async (req, res) => { await endSession(req, res); res.json({ ok: true }); }));

  // ----- Everything below needs a signed-in customer -----
  r.use("/api/account", requireCustomer);

  r.put("/api/account/profile", wrap(async (req, res) => {
    const name = clip(req.body.name, 100), phone = clip(req.body.phone, 20);
    if (!name) return res.status(400).json({ error: "Please enter your name." });
    if (phone && !Core.validPhone(phone)) return res.status(400).json({ error: "Please enter a valid 10-digit Indian mobile number." });
    const c = await db.updateCustomer(req.session.userId, { name, phone, marketingOk: req.body.marketingOk === true });
    if (c.marketingOk) await db.addSubscriber(c.email);
    res.json(me(c));
  }));

  r.put("/api/account/password", limiter("pw-change", 10, 60 * 60000), wrap(async (req, res) => {
    const c = await db.getCustomer(req.session.userId);
    if (!(await verifyPassword(String(req.body.current || ""), c.passwordHash))) return res.status(400).json({ error: "Your current password is wrong." });
    const pwErr = passwordProblem(req.body.next);
    if (pwErr) return res.status(400).json({ error: pwErr });
    await db.updateCustomer(c.id, { passwordHash: await hashPassword(req.body.next) });
    await db.deleteSessionsForUser(c.id);
    await startSession(req, res, c.id, c.name, "customer");
    res.json({ ok: true });
  }));

  r.put("/api/account/addresses", wrap(async (req, res) => {
    const list = (Array.isArray(req.body.addresses) ? req.body.addresses : []).slice(0, 10).map(cleanAddress);
    if (list.some((a) => !a)) return res.status(400).json({ error: "Each address needs a name, valid mobile number, full address, state and 6-digit PIN code." });
    res.json(me(await db.updateCustomer(req.session.userId, { addresses: list })));
  }));

  r.put("/api/account/garage", wrap(async (req, res) => {
    const { vehicles } = await catalog.get();
    const list = (Array.isArray(req.body.garage) ? req.body.garage : []).slice(0, 10).map((v) => ({ make: clip(v.make, 40), model: clip(v.model, 40), year: Number(v.year) }));
    for (const v of list) {
      const range = vehicles[v.make]?.[v.model];
      if (!range || v.year < range[0] || v.year > range[1]) return res.status(400).json({ error: "Pick a make, model and year from the list." });
    }
    res.json(me(await db.updateCustomer(req.session.userId, { garage: list })));
  }));

  r.put("/api/account/wishlist", wrap(async (req, res) => {
    const { byId } = await catalog.get();
    const list = [...new Set((Array.isArray(req.body.wishlist) ? req.body.wishlist : []).map(Number))].filter((id) => byId.has(id)).slice(0, 100);
    res.json(me(await db.updateCustomer(req.session.userId, { wishlist: list })));
  }));

  r.get("/api/account/orders", wrap(async (req, res) => {
    const list = (await db.listOrdersByCustomer(req.session.userId)).filter((o) => o.status !== "created" && o.status !== "expired");
    const rets = await db.listReturns({ customerId: req.session.userId });
    const mine = await db.listReviews({ customerId: req.session.userId });
    res.json({
      orders: list.map((o) => ({ ...orders.publicOrder(o), token: sign("track", o.ref) })),
      returns: rets.map(returns.publicReturn),
      reviewed: mine.map((v) => v.productId)
    });
  }));

  // Reviews: only for products in one of your delivered orders.
  r.post("/api/account/reviews", limiter("review", 20, 60 * 60000), wrap(async (req, res) => {
    const productId = Number(req.body.productId), rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "Choose a rating from 1 to 5 stars." });
    const delivered = (await db.listOrdersByCustomer(req.session.userId)).find((o) => o.fulfillment === "delivered" && (o.items || []).some((l) => l.id === productId) ||
      o.fulfillment === "delivered" && o.cart && o.cart[productId]);
    if (!delivered) return res.status(403).json({ error: "You can review products from your delivered orders." });
    const c = await db.getCustomer(req.session.userId);
    const parts = c.name.trim().split(/\s+/);
    const v = await db.insertReview({ productId, customerId: c.id, orderRef: delivered.ref, author: parts[0] + (parts[1] ? " " + parts[1][0] + "." : ""),
      rating, title: clip(req.body.title, 120), body: clip(req.body.body, 2000) });
    if (!v) return res.status(409).json({ error: "You've already reviewed this product." });
    res.json({ ok: true, status: v.status });
  }));

  return r;
};
