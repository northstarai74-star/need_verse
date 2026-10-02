/* Store rules shared by the browser and the server. The server re-prices every order with
   these functions, so prices, discounts and shipping can't be changed from the browser. */
(function (root) {
  const STORE = {
    currency: "INR", symbol: "₹",
    freeShip: 999,     // free shipping when the order (after discounts) reaches this
    shipFee: 99,
    codFee: 49,        // extra charge for cash on delivery
    codMax: 5000,      // COD not offered above this total
    returnDays: 30,
    serviceGst: 18     // GST rate included in shipping and COD fees
  };

  const CATS = {
    Interior: { em: "💺", c: "#f06000", sub: "Mats, covers, storage" },
    Electronics: { em: "📹", c: "#3d8bff", sub: "Cams, mounts, scanners" },
    Emergency: { em: "🔋", c: "#ffc53d", sub: "Jump starters, kits" },
    Exterior: { em: "💡", c: "#b25cff", sub: "Lights, wipers, guards" },
    Cleaning: { em: "✨", c: "#2ed3c6", sub: "Coatings, vacuums" },
    Utility: { em: "📦", c: "#3ddc84", sub: "Towing, cargo" }
  };

  // Kits are discounted automatically when every product in them is in the cart.
  const BUNDLES = [
    { name: "Weekly Clean Kit", desc: "Vacuum, microfiber towels and ceramic spray for a showroom finish.", ids: [15, 14, 13], off: 0.10, icon: "🧼" },
    { name: "Road-Trip Safety Kit", desc: "Jump starter, tire inflator and a roadside kit. Never get stranded.", ids: [7, 8, 9], off: 0.12, icon: "🛣️" },
    { name: "Commuter Essentials", desc: "Phone mount, dash cam and sun shade for the daily drive.", ids: [3, 2, 5], off: 0.08, icon: "🚗" }
  ];

  const STATES = ["Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand",
    "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
    "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"];

  const r2 = (n) => Math.round(n * 100) / 100;
  const money = (n) => STORE.symbol + Number(n).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const validPin = (pin) => /^[1-9][0-9]{5}$/.test(String(pin || "").trim());
  const validPhone = (p) => /^(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/.test(String(p || "").trim());

  // product.fitment: [{make, model|null, yearFrom|null, yearTo|null}]; vehicle: {make, model, year}
  function fits(p, v) {
    if (!v || p.universal) return true;
    const y = Number(v.year);
    return (p.fitment || []).some((f) => f.make === v.make && (!f.model || f.model === v.model) &&
      (f.yearFrom == null || y >= f.yearFrom) && (f.yearTo == null || y <= f.yearTo));
  }

  // lines: [{id, price, qty, gstRate}]. coupon: {code, percent, minOrder} or null.
  // Prices include GST; `tax` is the GST contained in the total.
  function computeTotals(lines, opts) {
    const o = opts || {};
    const qty = {}, price = {};
    let sub = 0;
    for (const l of lines) { qty[l.id] = l.qty; price[l.id] = l.price; sub += l.price * l.qty; }
    let kit = 0;
    for (const b of BUNDLES) if (b.ids.every((id) => qty[id])) kit += b.ids.reduce((s, id) => s + price[id], 0) * b.off;
    const couponOk = !!(o.coupon && sub >= (o.coupon.minOrder || 0));
    const couponDisc = couponOk ? (sub - kit) * o.coupon.percent / 100 : 0;
    const disc = kit + couponDisc, after = sub - disc;
    const ship = sub === 0 || after >= STORE.freeShip ? 0 : STORE.shipFee;
    const codFee = o.cod && sub > 0 ? STORE.codFee : 0;
    const total = after + ship + codFee;
    let tax = 0;
    for (const l of lines) {
      const lineTotal = l.price * l.qty, share = sub ? disc * lineTotal / sub : 0, rate = l.gstRate ?? 18;
      tax += (lineTotal - share) * rate / (100 + rate);
    }
    tax += (ship + codFee) * STORE.serviceGst / (100 + STORE.serviceGst);
    return { sub: r2(sub), kit: r2(kit), couponDisc: r2(couponDisc), couponOk, disc: r2(disc), after: r2(after), ship, codFee, tax: r2(tax), total: r2(total),
      codAllowed: total <= STORE.codMax };
  }

  const api = { STORE, CATS, BUNDLES, STATES, money, slugify, validPin, validPhone, fits, computeTotals };
  if (typeof module !== "undefined") module.exports = api; else root.Core = api;
})(this);
