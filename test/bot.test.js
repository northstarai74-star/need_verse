const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers");

let t;
test.before(async () => { delete process.env.ANTHROPIC_API_KEY; t = await setup(); });
test.after(() => t.close());

const ask = (text, vehicle) => t.client().post("/api/assistant", { messages: [{ role: "user", text }], vehicle });

test("chat bubble shows on every page even without an AI key", async () => {
  for (const p of ["/", "/p/jump-starter-2000a", "/track"]) {
    const r = await t.client().get(p);
    assert.match(r.text, /id="aiBtn"/, p);
    assert.match(r.text, /Automated helper/, p);
  }
});

test("finds products for a car and a budget, with links and add-to-cart buttons", async () => {
  const r = await ask("floor mats for my 2023 creta under 5000");
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.reply, /Hyundai Creta/);
  assert.match(r.json.reply, /All-Weather Floor Mats/);
  assert.deepEqual(r.json.links[0], ["All-Weather Floor Mats (4-pc)", "/p/all-weather-floor-mats-4-pc"]);
  assert.equal(r.json.actions[0].productId, 1);
});

test("budget-only and saved-car questions", async () => {
  const cheap = await ask("something under 2k");
  assert.ok(cheap.json.actions.length > 0);
  assert.ok(!/₹[3-9],\d{3}|₹\d{2},/.test(cheap.json.reply), "nothing over budget");
  const mine = await ask("dash cam", { make: "Tata", model: "Nexon", year: 2024 });
  assert.match(mine.json.reply, /Dash Cam/);
});

test("store questions get policy answers that match the real settings", async () => {
  assert.match((await ask("where is my order?")).json.links[0][1], /\/track/);
  assert.match((await ask("do you have cash on delivery")).json.reply, /₹5,000/);
  assert.match((await ask("can I return it if it doesn't fit")).json.reply, /30 days/);
  assert.match((await ask("how long does delivery take")).json.reply, /₹999/);
  assert.match((await ask("hello")).json.reply, /Tell me your car/);
});

test("unknown requests get a helpful fallback, and empty chats are refused", async () => {
  const r = await ask("qwertyuiop");
  assert.match(r.json.reply, /couldn't find/);
  assert.equal((await t.client().post("/api/assistant", { messages: [] })).status, 400);
});
