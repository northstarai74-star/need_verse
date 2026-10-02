// Sessions for customers and the admin, stored in the sessions table and referenced by an
// HttpOnly, SameSite=Strict cookie.
const crypto = require("crypto");
const db = require("../db");
const { same, verifyTotp } = require("./security");

const cookieOpts = (req, days) => ({ httpOnly: true, sameSite: "strict", secure: req.secure, maxAge: days * 864e5, path: "/" });

async function startSession(req, res, userId, userName, role) {
  const days = role === "admin" ? 1 : 30;
  const old = req.cookies?.sid;
  if (old) await db.deleteSession(old).catch(() => {});
  const id = crypto.randomBytes(32).toString("hex");
  await db.createSession(id, userId, userName, req.ip, role, days);
  res.cookie("sid", id, cookieOpts(req, days));
}
async function endSession(req, res) {
  const id = req.cookies?.sid;
  if (id) await db.deleteSession(id);
  res.clearCookie("sid", { httpOnly: true, sameSite: "strict", path: "/" });
}

function cookieParser(req, res, next) {
  const cookies = {};
  for (const part of (req.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) { try { cookies[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch { /* ignore malformed cookie */ } }
  }
  req.cookies = cookies;
  next();
}

async function loadSession(req, res, next) {
  const id = req.cookies?.sid;
  if (id && /^[a-f0-9]{48,64}$/.test(id)) {
    try { req.session = await db.getSession(id); } catch (err) { console.error("Session check failed:", err.message); }
  }
  next();
}

const isAdmin = (req) => req.session?.role === "admin" && req.session.userId === (process.env.ADMIN_USER || "admin");

// With ADMIN_TOTP_SECRET set, only a signed-in (password + code) session counts.
// Without it, Basic auth (for scripts) is also accepted.
function adminOk(req) {
  const { ADMIN_USER = "admin", ADMIN_PASSWORD, ADMIN_TOTP_SECRET } = process.env;
  if (!ADMIN_PASSWORD) return false;
  if (isAdmin(req)) return true;
  if (ADMIN_TOTP_SECRET) return false;
  const [scheme, token] = (req.get("authorization") || "").split(" ");
  const [u, ...p] = scheme === "Basic" && token ? Buffer.from(token, "base64").toString().split(":") : [];
  return u !== undefined && same(u, ADMIN_USER) && same(p.join(":"), ADMIN_PASSWORD);
}
function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: "Admin is disabled. Set ADMIN_PASSWORD in .env." });
  if (adminOk(req)) return next();
  res.status(401).json({ error: "Please sign in to the admin." });
}

function checkAdminLogin({ username, password, code }) {
  const { ADMIN_USER = "admin", ADMIN_PASSWORD, ADMIN_TOTP_SECRET } = process.env;
  if (!ADMIN_PASSWORD) return { status: 503, error: "Admin sign in is disabled. Set ADMIN_PASSWORD in .env." };
  if (!username || !password) return { status: 400, error: "Enter your username and password." };
  const okPw = same(username, ADMIN_USER) && same(password, ADMIN_PASSWORD);
  if (!okPw) return { status: 401, error: "Wrong username or password." };
  if (ADMIN_TOTP_SECRET && !verifyTotp(ADMIN_TOTP_SECRET, code)) return { status: 401, error: "Enter the 6-digit code from your authenticator app.", needCode: true };
  return { ok: true, user: ADMIN_USER };
}

function requireCustomer(req, res, next) {
  if (req.session?.role === "customer") return next();
  res.status(401).json({ error: "Please sign in to your account." });
}

module.exports = { startSession, endSession, cookieParser, loadSession, requireAdmin, adminOk, requireCustomer, checkAdminLogin, isAdmin };
