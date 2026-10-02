const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers");

let t;
test.before(async () => { delete process.env.ANTHROPIC_API_KEY; t = await setup({}, { data: require("../seed/data") }); });
test.after(() => t.close());

test("a store with no products yet still works", async () => {
  const c = t.client();
  const cat = await c.get("/api/catalog");
  assert.equal(cat.json.products.length, 0);
  assert.ok(cat.json.vehicles.Hyundai.Creta, "car models are still loaded");
  const home = await c.get("/");
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.text, /id="kits"/, "no kits section without kits");
  assert.equal((await c.get("/c/interior")).status, 200);
  assert.equal((await c.get("/sitemap.xml")).status, 200);
  assert.match((await c.post("/api/assistant", { messages: [{ role: "user", text: "dash cam" }] })).json.reply, /couldn't find/);
  assert.equal((await c.post("/api/create-order", { cart: { 1: 1 }, customer: {} })).status, 400);
});
