const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

// ---------- Passwords ----------
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(pw), salt, 64);
  return `s1$${salt.toString("base64")}$${hash.toString("base64")}`;
}
async function verifyPassword(pw, stored) {
  const [v, salt, hash] = String(stored || "").split("$");
  if (v !== "s1" || !salt || !hash) return false;
  const got = await scrypt(String(pw), Buffer.from(salt, "base64"), 64);
  const want = Buffer.from(hash, "base64");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const passwordProblem = (pw) => (typeof pw !== "string" || pw.length < 8 ? "Use at least 8 characters for your password." : pw.length > 200 ? "That password is too long." : null);

// Constant-time string compare.
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash("sha256").update(String(a)).digest(), crypto.createHash("sha256").update(String(b)).digest());

// ---------- TOTP (authenticator app codes, RFC 6238) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(s) {
  let bits = "";
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, "")) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function base32Encode(buf) {
  let bits = "", out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
function totpAt(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
function totp(secret, time = Date.now()) { return totpAt(secret, Math.floor(time / 30000)); }
function verifyTotp(secret, code, time = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(time / 30000);
  return [-1, 0, 1].some((d) => same(totpAt(secret, step + d), c));
}
const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

// ---------- Signed links (invoices, order tracking) ----------
const KEY = () => process.env.APP_SECRET || process.env.RAZORPAY_KEY_SECRET || "";
const sign = (purpose, value) => crypto.createHmac("sha256", KEY()).update(purpose + ":" + value).digest("base64url").slice(0, 32);
const checkSig = (purpose, value, sig) => typeof sig === "string" && sig.length === 32 && same(sign(purpose, value), sig);

// ---------- Rate limiting (per IP, in memory) ----------
const buckets = new Map();
function limiter(name, max, windowMs) {
  return (req, res, next) => {
    const key = name + "|" + req.ip, t = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
    if (++b.n > max) {
      res.set("Retry-After", String(Math.ceil((b.reset - t) / 1000)));
      return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    }
    next();
  };
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60000).unref();
const resetLimits = () => buckets.clear();

// ---------- Headers and cross-site protection ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "frame-src https:",
  "connect-src 'self' https:",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join("; ");
function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\")",
    "X-Frame-Options": "DENY"
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}
// State-changing API calls must be JSON and, when the browser says where they came from, same-origin.
// Forms on other sites can't send JSON without a CORS preflight, which this server never allows.
function sameOriginJson(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.is("application/json")) return res.status(415).json({ error: "Send requests as JSON." });
  const origin = req.get("origin");
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = ""; }
    if (host !== req.get("host")) return res.status(403).json({ error: "Cross-site request blocked." });
  }
  next();
}

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const validEmail = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

module.exports = { hashPassword, verifyPassword, passwordProblem, same, totp, verifyTotp, newTotpSecret, sign, checkSig, limiter, resetLimits,
  securityHeaders, sameOriginJson, clip, esc, validEmail };
