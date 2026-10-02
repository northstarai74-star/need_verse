// Builds the Express app. server.js starts it; tests import it directly.
const path = require("path");
const fs = require("fs");
const express = require("express");
const db = require("./db");
const catalog = require("./lib/catalog");
const pages = require("./lib/pages");
const assistant = require("./lib/assistant");
const store = require("./routes/store");
const account = require("./routes/account");
const admin = require("./routes/admin");
const { cookieParser, loadSession, adminOk } = require("./lib/auth");
const { securityHeaders, sameOriginJson, limiter } = require("./lib/security");
const { report } = require("./lib/alerts");
const Core = require("./public/core");
const Bot = require("./public/bot");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp(ctx) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.use(securityHeaders);

  app.use(store.webhooks(ctx));
  const big = express.json({ limit: "8mb" }), small = express.json({ limit: "50kb" });
  app.use((req, res, next) => (/\/returns$|^\/api\/admin\/uploads$|^\/api\/admin\/products\/import$/.test(req.path) ? big : small)(req, res, next));
  app.use(express.static(path.join(__dirname, "public"), { index: false, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
  app.use(cookieParser);
  app.use(loadSession);
  app.use("/api", sameOriginJson);
  app.use("/invoice", sameOriginJson);

  // ----- APIs -----
  app.use(account());          // includes /api/admin/signin, so it must come before the admin router
  app.use(admin(ctx));
  app.use(store.api(ctx));
  app.post("/api/assistant", limiter("assistant", 30, 10 * 60000), wrap(async (req, res) => {
    if (!assistant.enabled()) {
      const msgs = Array.isArray(req.body.messages) ? req.body.messages : [];
      const last = msgs.filter((m) => m && m.role === "user" && typeof m.text === "string").pop();
      if (!last) return res.status(400).json({ error: "Ask a question first." });
      const c = await catalog.get();
      const v = req.body.vehicle && typeof req.body.vehicle === "object" ? { make: String(req.body.vehicle.make || ""), model: String(req.body.vehicle.model || ""), year: Number(req.body.vehicle.year) || null } : null;
      return res.json(Bot.answer(last.text.slice(0, 500), { products: c.products, vehicles: c.vehicles, vehicle: v && v.make ? v : null,
        cod: process.env.COD_ENABLED !== "false", eta: process.env.DEFAULT_ETA_DAYS }));
    }
    try {
      res.json(await assistant.chat(req.body.messages, { customerId: req.session?.role === "customer" ? req.session.userId : null, vehicle: req.body.vehicle }));
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ error: e.message });
      report(e, "assistant");
      res.status(502).json({ error: "The assistant is unavailable right now. Please try again in a minute." });
    }
  }));

  // ----- Pages -----
  const opts = (req) => ({ assistant: assistant.enabled() ? "claude" : "basic", loggedIn: req.session?.role === "customer" });
  const data = (c) => ({ products: c.products, vehicles: c.vehicles, store: Core.STORE, cats: Core.CATS, bundles: Core.BUNDLES, cod: process.env.COD_ENABLED !== "false" });
  const cat = async () => { const c = await catalog.get(); return { ...c, data: data(c) }; };
  const html = (res, s) => res.set("Cache-Control", "no-cache").type("html").send(s);

  app.get("/", wrap(async (req, res) => html(res, pages.home(await cat(), opts(req)))));
  app.get("/c/:slug", wrap(async (req, res, next) => {
    const name = Object.keys(Core.CATS).find((k) => pages.catSlug(k) === req.params.slug);
    if (!name) return next();
    html(res, pages.category(name, await cat(), opts(req)));
  }));
  app.get("/p/:slug", wrap(async (req, res, next) => {
    const c = await cat(), p = c.bySlug.get(req.params.slug);
    if (!p) return next();
    const reviews = (await db.listReviews({ productId: p.id, status: "approved" })).slice(0, 20);
    html(res, pages.product(p, c, reviews, opts(req)));
  }));
  app.get("/account", wrap(async (req, res) => html(res, pages.account(await cat(), opts(req)))));
  app.get("/track", wrap(async (req, res) => html(res, pages.track(await cat(), opts(req)))));
  app.get("/policies/:slug", wrap(async (req, res, next) => {
    const out = pages.policy(req.params.slug, await cat(), opts(req));
    if (!out) return next();
    html(res, out);
  }));
  app.get("/sitemap.xml", wrap(async (req, res) => res.type("application/xml").send(pages.sitemap(await catalog.get()))));
  app.get("/robots.txt", (req, res) => res.type("text/plain").send(pages.robots()));
  app.get("/admin", (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    if (!process.env.ADMIN_PASSWORD) return res.status(503).send("Admin is disabled. Set ADMIN_PASSWORD in .env.");
    res.type("html").send(fs.readFileSync(path.join(__dirname, adminOk(req) ? "admin.html" : "admin-login.html"), "utf8"));
  });
  app.get("/healthz", (req, res) => res.json({ ok: true }));

  app.use(wrap(async (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    res.status(404); html(res, pages.notFound(await cat(), opts(req)));
  }));

  // Anything that throws lands here. Customers never see internal details.
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That upload is too large." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
    report(err, `${req.method} ${req.path}`);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });
  return app;
}

module.exports = { createApp };
