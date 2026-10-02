const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../public/core");
const { totp, verifyTotp, newTotpSecret, hashPassword, verifyPassword } = require("../lib/security");
const { invoiceLines } = require("../lib/invoice");
const { financialYear } = require("../lib/orders");

test("prices include GST and discounts reduce the tax proportionally", () => {
  const t = Core.computeTotals([{ id: 1, price: 1180, qty: 1, gstRate: 18 }], null);
  assert.equal(t.tax, 180);
  assert.equal(t.ship, 0);
  const d = Core.computeTotals([{ id: 1, price: 1180, qty: 1, gstRate: 18 }], { coupon: { percent: 10, minOrder: 0 } });
  assert.equal(d.disc, 118);
  assert.equal(d.tax, 162);
});

test("shipping fee below the free threshold, COD fee only when asked", () => {
  const t = Core.computeTotals([{ id: 5, price: 500, qty: 1, gstRate: 18 }], { cod: true });
  assert.equal(t.ship, Core.STORE.shipFee);
  assert.equal(t.codFee, Core.STORE.codFee);
  assert.equal(t.total, 500 + Core.STORE.shipFee + Core.STORE.codFee);
});

test("coupon minimum order is enforced", () => {
  const t = Core.computeTotals([{ id: 5, price: 500, qty: 1 }], { coupon: { percent: 10, minOrder: 1000 } });
  assert.equal(t.couponOk, false);
  assert.equal(t.disc, 0);
});

test("kit discount applies only when every kit item is in the cart", () => {
  const lines = [{ id: 15, price: 2639, qty: 1 }, { id: 14, price: 1199, qty: 1 }];
  assert.equal(Core.computeTotals(lines).kit, 0);
  assert.ok(Core.computeTotals([...lines, { id: 13, price: 1599, qty: 1 }]).kit > 0);
});

test("fitment matches make, model and year ranges", () => {
  const p = { universal: false, fitment: [{ make: "Hyundai", model: "Creta", yearFrom: 2020, yearTo: 2024 }, { make: "Tata", model: null, yearFrom: null, yearTo: null }] };
  assert.equal(Core.fits(p, { make: "Hyundai", model: "Creta", year: 2022 }), true);
  assert.equal(Core.fits(p, { make: "Hyundai", model: "Creta", year: 2019 }), false);
  assert.equal(Core.fits(p, { make: "Hyundai", model: "Venue", year: 2022 }), false);
  assert.equal(Core.fits(p, { make: "Tata", model: "Nexon", year: 2023 }), true);
  assert.equal(Core.fits({ universal: true, fitment: [] }, { make: "Kia", model: "Seltos", year: 2021 }), true);
});

test("Indian PIN codes and mobile numbers are validated", () => {
  assert.ok(Core.validPin("560038"));
  assert.ok(!Core.validPin("060038"));
  assert.ok(!Core.validPin("56003"));
  assert.ok(Core.validPhone("9876543210"));
  assert.ok(Core.validPhone("+91 98765 43210"));
  assert.ok(!Core.validPhone("1234567890"));
});

test("TOTP codes verify within one step and fail otherwise", () => {
  const s = newTotpSecret(), now = Date.now();
  assert.ok(verifyTotp(s, totp(s, now), now));
  assert.ok(verifyTotp(s, totp(s, now - 30000), now));
  assert.ok(!verifyTotp(s, totp(s, now - 120000), now));
  assert.ok(!verifyTotp(s, "abc", now));
  // RFC 6238 test vector (SHA-1, T=59s) for the ASCII secret "12345678901234567890".
  assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000), "287082");
});

test("passwords hash and verify", async () => {
  const h = await hashPassword("correct horse");
  assert.ok(await verifyPassword("correct horse", h));
  assert.ok(!(await verifyPassword("wrong", h)));
  assert.ok(!(await verifyPassword("x", "garbage")));
});

test("invoice lines back GST out of inclusive prices and add shipping", () => {
  const rows = invoiceLines({ items: [{ name: "A", qty: 1, price: 590, gstRate: 18 }], totals: { disc: 0, ship: 99, codFee: 0 } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].taxable, 500);
  assert.equal(rows[0].tax, 90);
  assert.equal(rows[1].hsn, "9965");
});

test("financial year runs April to March in IST", () => {
  assert.equal(financialYear("2026-04-01T00:00:00+05:30"), "2026-27");
  assert.equal(financialYear("2026-03-31T23:00:00+05:30"), "2025-26");
});
