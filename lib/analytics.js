// Store metrics for the admin dashboard, computed from orders and first-party events.
const r2 = (n) => Math.round(n * 100) / 100;
const LIVE = (o) => (o.status === "paid" || o.status === "cod") && o.fulfillment !== "cancelled";
const FUNNEL = ["page_view", "product_view", "add_to_cart", "begin_checkout", "payment_started", "purchase"];
const day = (iso) => new Date(new Date(iso).getTime() + 5.5 * 36e5).toISOString().slice(0, 10); // IST date

function summarize({ orders, events, products, days }) {
  const since = Date.now() - days * 864e5;
  const inRange = (o) => new Date(o.createdAt).getTime() >= since;
  const live = orders.filter((o) => LIVE(o) && inRange(o));
  const gross = live.reduce((s, o) => s + o.amount, 0);
  const refunds = orders.filter(inRange).reduce((s, o) => s + (o.refunded || 0), 0);

  let exGst = 0, cogs = 0, costedExGst = 0, units = 0, costedUnits = 0;
  const sellers = {}, byDay = {};
  for (const o of live) {
    const items = o.items || [], sub = items.reduce((s, l) => s + l.price * l.qty, 0) || 1, disc = o.totals?.disc || 0;
    for (const l of items) {
      const value = l.price * l.qty * (1 - disc / sub), rate = l.gstRate ?? 18, net = value * 100 / (100 + rate);
      exGst += net; units += l.qty;
      if (l.cost != null) { cogs += l.cost * l.qty; costedExGst += net; costedUnits += l.qty; }
      const s = (sellers[l.id] ||= { id: l.id, name: l.name, units: 0, revenue: 0 });
      s.units += l.qty; s.revenue += value;
    }
    const d = (byDay[day(o.createdAt)] ||= { orders: 0, revenue: 0 });
    d.orders++; d.revenue += o.amount;
  }

  // Customers are matched by email across all time, so repeat buyers are counted even as guests.
  const firstSeen = {}, count = {}, spend = {};
  for (const o of orders.filter(LIVE)) {
    const e = o.customer.email.toLowerCase(), t = new Date(o.createdAt).getTime();
    count[e] = (count[e] || 0) + 1; spend[e] = (spend[e] || 0) + o.amount - (o.refunded || 0);
    if (!firstSeen[e] || t < firstSeen[e]) firstSeen[e] = t;
  }
  const emails = Object.keys(count);
  const newCustomers = emails.filter((e) => firstSeen[e] >= since).length;

  const uniq = {}, sources = {}, searches = {};
  for (const ev of events) {
    (uniq[ev.name] ||= new Set()).add(ev.anonId || "anon");
    if (ev.name === "page_view") {
      let host = "Direct";
      try { if (ev.referrer) host = new URL(ev.referrer).host || "Direct"; } catch { /* keep Direct */ }
      sources[host] = (sources[host] || 0) + 1;
    }
    if (ev.name === "search" && ev.path) { const q = ev.path.toLowerCase(); searches[q] = (searches[q] || 0) + 1; }
  }
  const funnel = FUNNEL.map((name) => ({ name, visitors: uniq[name]?.size || 0 }));
  const visitors = funnel[0].visitors;
  const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));

  const series = [];
  for (let t = since; t <= Date.now(); t += 864e5) { const k = day(new Date(t).toISOString()); series.push({ day: k, ...(byDay[k] || { orders: 0, revenue: 0 }) }); }

  return {
    days, revenue: r2(gross), netRevenue: r2(gross - refunds), refunds: r2(refunds), orders: live.length, aov: live.length ? r2(gross / live.length) : 0,
    refundRate: gross ? r2((refunds / gross) * 100) : 0, units,
    grossMargin: costedExGst ? r2(((costedExGst - cogs) / costedExGst) * 100) : null, grossProfit: costedExGst ? r2(costedExGst - cogs) : null,
    costCoverage: units ? Math.round((costedUnits / units) * 100) : 0, revenueExGst: r2(exGst),
    conversionRate: visitors ? r2(((uniq.purchase?.size || 0) / visitors) * 100) : null, visitors,
    funnel, customers: emails.length, newCustomers,
    repeatRate: emails.length ? r2((emails.filter((e) => count[e] > 1).length / emails.length) * 100) : 0,
    ltv: emails.length ? r2(emails.reduce((s, e) => s + spend[e], 0) / emails.length) : 0,
    cod: live.filter((o) => o.paymentMethod === "cod").length, online: live.filter((o) => o.paymentMethod !== "cod").length,
    abandonedCheckouts: orders.filter((o) => inRange(o) && (o.status === "expired" || o.status === "created")).length,
    bestSellers: Object.values(sellers).sort((a, b) => b.units - a.units).slice(0, 10).map((s) => ({ ...s, revenue: r2(s.revenue) })),
    series: series.map((d) => ({ ...d, revenue: r2(d.revenue) })),
    sources: top(sources, 8), searches: top(searches, 10),
    lowStock: products.filter((p) => p.status === "active" && p.stock <= p.lowStockAt).map((p) => ({ id: p.id, name: p.name, sku: p.sku, stock: p.stock }))
  };
}

module.exports = { summarize };
