const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers");

let t, calls = [];
test.before(async () => {
  // Stand-in for the Claude API: first asks for a tool, then answers.
  require.cache[require.resolve("@anthropic-ai/sdk")] = { id: "a", loaded: true, exports: class {
    constructor() { this.beta = { messages: { create: async (req) => {
      calls.push(req);
      const last = req.messages[req.messages.length - 1];
      if (typeof last.content === "string") {
        const tool = /order/.test(last.content) ? { name: "get_order_status", input: { order_ref: "NV-NOPE" } } : { name: "search_products", input: { query: "floor mats", make: "Hyundai", model: "Creta", year: 2023 } };
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", ...tool }] };
      }
      return { stop_reason: "end_turn", content: [{ type: "text", text: "Here you go." }] };
    } } }; }
  } };
  t = await setup({ ANTHROPIC_API_KEY: "test" });
});
test.after(() => t.close());

test("home page: real policies, no made-up stats, structured data, security headers", async () => {
  const r = await t.client().get("/");
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /10,000\+|Average rating|60 sec/);
  assert.match(r.text, /"@type":"Organization"/);
  assert.match(r.text, /<link rel="canonical" href="https:\/\/shop\.test\/">/);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.text, /href="\/p\/jump-starter-2000a"/, "server-rendered product links for crawlers");
  assert.match(r.text, /id="aiBtn"/);
});

test("product page has Product, BreadcrumbList, offer and return policy markup", async () => {
  const r = await t.client().get("/p/all-weather-floor-mats-4-pc");
  assert.equal(r.status, 200);
  const blocks = [...r.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const p = blocks.find((b) => b["@type"] === "Product");
  assert.equal(p.offers.priceCurrency, "INR");
  assert.equal(p.offers.availability, "https://schema.org/InStock");
  assert.equal(p.offers.hasMerchantReturnPolicy.merchantReturnDays, 30);
  assert.equal(p.aggregateRating, undefined, "no rating until there are real reviews");
  assert.ok(blocks.some((b) => b["@type"] === "BreadcrumbList"));
  assert.match(r.text, /Does this fit my car\?/i);
});

test("category, policies, account, track, sitemap, robots, 404", async () => {
  const c = t.client();
  assert.equal((await c.get("/c/electronics")).status, 200);
  for (const p of ["shipping", "returns", "warranty", "terms", "privacy", "contact"]) {
    const r = await c.get("/policies/" + p);
    assert.equal(r.status, 200, p);
    assert.match(r.text, /Draft template/);
  }
  assert.match((await c.get("/policies/contact")).text, /grievance/i);
  assert.match((await c.get("/account")).text, /noindex/);
  assert.equal((await c.get("/track")).status, 200);
  const sm = await c.get("/sitemap.xml");
  assert.match(sm.text, /<loc>https:\/\/shop\.test\/p\/jump-starter-2000a<\/loc>/);
  assert.match((await c.get("/robots.txt")).text, /Disallow: \/admin/);
  assert.equal((await c.get("/p/does-not-exist")).status, 404);
  assert.equal((await c.get("/api/nope")).status, 404);
});

test("catalogue JSON embedded in pages can't break out of its script tag", async () => {
  t.fake.tables.products.find((p) => p.id === 1).short_desc = "</script><script>alert(1)</script>";
  require("../lib/catalog").invalidate();
  const r = await t.client().get("/");
  assert.doesNotMatch(r.text, /<\/script><script>alert\(1\)/);
});

test("assistant runs tools against the real catalogue and suggests cart items", async () => {
  const r = await t.client().post("/api/assistant", { messages: [{ role: "user", text: "floor mats for my creta" }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.reply, "Here you go.");
  const toolResult = JSON.parse(calls[1].messages[2].content[0].content);
  assert.ok(toolResult.some((p) => /Floor Mats/.test(p.name)));
  assert.equal(calls[0].model, "claude-opus-5-5");
});

test("assistant never reveals orders to someone who isn't signed in as the owner", async () => {
  calls = [];
  await t.client().post("/api/assistant", { messages: [{ role: "user", text: "where is my order" }] });
  const result = JSON.parse(calls[1].messages[2].content[0].content);
  assert.match(result.error, /isn't signed in/);
});

test("assistant validates the conversation", async () => {
  assert.equal((await t.client().post("/api/assistant", { messages: [] })).status, 400);
});
