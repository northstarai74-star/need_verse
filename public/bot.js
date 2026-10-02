/* Built-in store helper: answers common questions and finds products without any AI service.
   Used by the chat bubble when no ANTHROPIC_API_KEY is set (and inside the preview). */
(function (root) {
  const Core = root.Core || (typeof require !== "undefined" ? require("./core") : null);
  const Search = root.Search || (typeof require !== "undefined" ? require("./search") : null);

  function policy(topic, env = {}) {
    const S = Core.STORE, m = Core.money, cod = env.cod !== false;
    return {
      shipping: `Shipping is free on orders of ${m(S.freeShip)} or more after discounts; below that it's ${m(S.shipFee)}. Most orders arrive in ${env.eta || "3-7"} days. You can check the exact estimate for your PIN code on any product page.`,
      returns: `You can return items within ${S.returnDays} days of delivery from your account or the Track order page. If a product listed as fitting your car doesn't fit, the return is free. Refunds go back to your original payment method once we receive the item.`,
      cod: cod ? `Yes, cash on delivery is available for orders up to ${m(S.codMax)} at most PIN codes, with a ${m(S.codFee)} fee. Choose it at checkout.` : "Cash on delivery isn't available right now. You can pay by UPI, card, netbanking or wallet.",
      payment: "You can pay by UPI, cards, netbanking or wallets through Razorpay" + (cod ? ", or choose cash on delivery." : "."),
      warranty: "Warranty depends on the product and is listed on its page. To make a claim, contact us with your order number and photos of the problem.",
      cancel: "You can cancel an order yourself from your account or the Track order page until we start packing it. Prepaid orders are refunded in full automatically.",
      track: "You can follow your order on the Track order page with your order number and email, or under Orders in your account.",
      contact: "You can reach us through the details on our Contact page. Include your order number if it's about an order."
    }[topic];
  }

  const INTENTS = [
    ["track", /\b(track|where('?s| is) my (order|parcel|package)|order status|status of my order|not (yet )?(arrived|received|delivered)|awb|courier)\b/],
    ["cancel", /\bcancel/],
    ["returns", /\b(return|refund|exchange|replace|money back|doesn'?t fit|did ?n[o']?t fit|wrong (item|size|part)|damaged|broken|defective)\b/],
    ["cod", /\b(cod|cash on delivery|pay on delivery|cash)\b/],
    ["payment", /\b(pay|payment|upi|card|netbanking|wallet|emi|razorpay)\b/],
    ["shipping", /\b(ship|shipping|deliver|delivery|how long|when will|dispatch|pin ?code|pincode)\b/],
    ["warranty", /\b(warranty|guarantee)\b/],
    ["contact", /\b(contact|phone|call|email|human|agent|support|talk to|whatsapp)\b/]
  ];
  const LINKS = { track: ["Track an order", "/track"], cancel: ["Track an order", "/track"], returns: ["Return policy", "/policies/returns"], cod: ["Shipping policy", "/policies/shipping"],
    shipping: ["Shipping policy", "/policies/shipping"], warranty: ["Warranty policy", "/policies/warranty"], contact: ["Contact us", "/policies/contact"], payment: ["Terms", "/policies/terms"] };

  function budget(text) {
    const t = text.toLowerCase().replace(/,/g, "");
    const k = /(under|below|less than|within|upto|up to|max|budget(?: of)?)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?/.exec(t);
    if (!k) return null;
    return Number(k[2]) * (k[3] ? 1000 : 1);
  }

  // ctx: {products, vehicles, vehicle, index?, cod, eta}
  function answer(message, ctx) {
    const text = String(message || "").trim(), low = text.toLowerCase();
    if (!text) return { reply: "Ask me about a product, your car, delivery or returns.", actions: [], links: [] };
    if (/^(hi|hello|hey|namaste|hii+|good (morning|afternoon|evening))\b[\s!.]*$/i.test(text))
      return { reply: "Hi! Tell me your car and what you're looking for, like \"floor mats for a 2023 Creta under 5000\". I can also help with delivery, returns and orders.", actions: [], links: [] };
    if (/\b(thanks|thank you|thx|ok(ay)?|great|cool)\b[\s!.]*$/i.test(text) && text.split(/\s+/).length <= 4)
      return { reply: "Happy to help! Anything else?", actions: [], links: [] };

    const index = ctx.index || Search.build(ctx.products, ctx.vehicles);
    const max = budget(text);
    const query = low.replace(/(under|below|less than|within|upto|up to|max|budget(?: of)?)\s*(?:rs\.?|inr|₹)?\s*\d[\d,.]*\s*(k|thousand)?/g, " ")
      .replace(/\b(something|anything|some|any|things?|stuff|items?|products?|accessories|accessory|parts?|options?|ideas?|gifts?|cheap|good|nice|i|me|show|need|want|looking|please|recommend|suggest|what|do|you|have|is|are|there|can|get|my|a|an|the|for|best|buy)\b/g, " ");
    const r = Search.search(index, query);
    const vehicle = r.vehicle && r.vehicle.model ? r.vehicle : ctx.vehicle && !r.vehicle ? ctx.vehicle : r.vehicle;
    const intent = INTENTS.find(([, re]) => re.test(low));
    const productish = r.terms.length > 0 && r.items.length > 0 && !r.partial;

    // Questions about the store win unless the message is clearly asking for a product.
    if (intent && !(productish && /\b(for|need|want|buy|show|looking|recommend|suggest|best)\b/.test(low))) {
      const [k] = intent;
      return { reply: policy(k, ctx), actions: [], links: LINKS[k] ? [LINKS[k]] : [] };
    }

    let items = r.items.filter((p) => (!max || p.price <= max));
    if (vehicle && vehicle.model) items = items.filter((p) => Core.fits(p, { year: vehicle.year || 2024, ...vehicle }) || p.universal);
    const inStock = items.filter((p) => p.inStock);
    const picks = (inStock.length ? inStock : items).slice(0, 3);
    const forCar = vehicle ? ` for ${vehicle.year ? vehicle.year + " " : ""}${vehicle.make}${vehicle.model ? " " + vehicle.model : ""}` : "";
    const under = max ? ` under ${Core.money(max)}` : "";

    if (!r.terms.length && vehicle && !picks.length)
      return { reply: `I couldn't find accessories listed${forCar}${under} yet. Universal items like dash cams and phone mounts fit every car.`, actions: [], links: [["Browse all products", "/#shop"]] };
    if (!picks.length) {
      return { reply: `Sorry, I couldn't find anything matching that${forCar}${under}. Try a simpler word like "mats", "dash cam" or "charger", or browse the categories.`,
        actions: [], links: [["Browse all products", "/#shop"], ["Contact us", "/policies/contact"]] };
    }
    const lines = picks.map((p) => `• ${p.name}: ${Core.money(p.price)}${p.inStock ? "" : " (out of stock)"}${p.universal ? " · fits every car" : vehicle && vehicle.model ? " · fits your car" : ""}`);
    const intro = r.partial ? `I didn't find an exact match, but these are close${forCar}${under}:` : `Here's what I found${forCar}${under}:`;
    const tail = !vehicle && picks.some((p) => !p.universal) ? "\n\nTell me your car (make, model and year) and I'll check the fit." : "";
    return {
      reply: `${intro}\n${lines.join("\n")}${tail}`,
      actions: picks.filter((p) => p.inStock).map((p) => ({ type: "add_to_cart", productId: p.id, qty: 1 })),
      links: picks.map((p) => [p.name, "/p/" + p.slug])
    };
  }

  const api = { answer, policy, budget };
  if (typeof module !== "undefined") module.exports = api; else root.Bot = api;
})(this);
