// Boots the real app against the in-memory database, with Razorpay and email faked.
const crypto = require("crypto");
const { createFake } = require("./fake-supabase");

const KEY_SECRET = "test_key_secret", WEBHOOK_SECRET = "test_webhook_secret";

async function setup(env = {}) {
  Object.assign(process.env, {
    SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "service", ADMIN_USER: "admin", ADMIN_PASSWORD: "admin-pass",
    SMTP_HOST: "smtp.test", SMTP_USER: "shop@test", SMTP_PASS: "x", OWNER_EMAIL: "owner@test", PUBLIC_URL: "https://shop.test",
    BUSINESS_STATE: "Karnataka", ...env
  });
  const fake = createFake();
  require.cache[require.resolve("@supabase/supabase-js")] = { id: "sb", loaded: true, exports: { createClient: () => fake } };
  const sent = [];
  require.cache[require.resolve("nodemailer")] = { id: "nm", loaded: true, exports: { createTransport: () => ({ sendMail: async (m) => { sent.push(m); return {}; } }) } };

  let n = 0;
  const rzpCalls = { orders: [], refunds: [] };
  const rzp = {
    orders: { create: async (o) => { rzpCalls.orders.push(o); return { id: "order_test" + ++n, ...o }; } },
    payments: { refund: async (pid, o) => { rzpCalls.refunds.push({ pid, ...o }); return { id: "rfnd_test" + ++n, amount: o.amount, status: "processed", notes: o.notes }; } }
  };
  const { createApp } = require("../app");
  const app = createApp({ rzp, keyId: "rzp_test_key", keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await require("../seed")();
  return { fake, sent, rzpCalls, base, server, client: () => client(base), close: () => new Promise((r) => server.close(r)) };
}

// fetch with a cookie jar and same-origin JSON defaults, like a browser on the site.
function client(base) {
  let cookie = "";
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method, redirect: "manual",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
    });
    const set = res.headers.get("set-cookie");
    if (set) { const v = set.split(";")[0]; cookie = /=$/.test(v) ? "" : v; }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  return { get: (p, h) => call("GET", p, undefined, h), post: (p, b = {}, h) => call("POST", p, b, h), put: (p, b, h) => call("PUT", p, b, h), del: (p, h) => call("DELETE", p, undefined, h),
    get cookie() { return cookie; } };
}

const customer = (over = {}) => ({ name: "Aarav Sharma", email: "aarav@example.com", phone: "9876543210", addr: "14 MG Road", city: "Bengaluru", state: "Karnataka", zip: "560038", ...over });
const paySig = (orderId, paymentId) => crypto.createHmac("sha256", KEY_SECRET).update(orderId + "|" + paymentId).digest("hex");
const webhookSig = (body) => crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
const stockOf = (fake, id) => fake.tables.products.find((p) => p.id === id).stock;

module.exports = { setup, customer, paySig, webhookSig, stockOf };
