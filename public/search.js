/* Product search: understands car names ("creta floor mat", "led for scorpio 2023"),
   tolerates typos and common synonyms, and falls back to partial matches. */
(function (root) {
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const squash = (s) => norm(s).replace(/ /g, "");
  const STOP = new Set(["for", "the", "a", "an", "my", "of", "and", "with", "in", "to", "car", "cars", "accessories", "accessory", "best", "buy", "new"]);
  const SYN = {
    mat: ["mats", "floor", "carpet"], mats: ["mat", "floor"], carpet: ["mat", "mats"], cover: ["covers", "seat"], covers: ["cover", "seat"],
    cam: ["camera", "dash", "dashcam"], camera: ["cam", "dash"], dashcam: ["dash", "cam"], recorder: ["cam", "dash"],
    charger: ["charging", "charge", "wireless"], holder: ["mount"], stand: ["mount"], mount: ["holder"],
    led: ["light", "bulb", "headlight"], light: ["led", "bulb", "headlight"], lights: ["led", "bulb", "headlight"], bulb: ["led", "headlight"],
    wiper: ["wipers", "blade", "blades"], wipers: ["wiper", "blade"], vacuum: ["cleaner", "hoover"], cleaner: ["vacuum", "cleaning"],
    tyre: ["tire", "inflator"], tire: ["tyre", "inflator"], pump: ["inflator"], compressor: ["inflator"],
    battery: ["jump", "starter"], booster: ["jump", "starter"], jumper: ["jump", "starter"], polish: ["coating", "ceramic"], wax: ["coating", "ceramic"],
    shade: ["sun", "sunshade"], sunshade: ["sun", "shade"], organiser: ["organizer"], organizer: ["organiser", "storage"], boot: ["trunk"], dicky: ["trunk"],
    scanner: ["obd", "obd2", "diagnostic"], obd: ["obd2", "scanner"], towel: ["towels", "microfiber", "cloth"], cloth: ["towel", "microfiber"],
    roof: ["cargo", "carrier"], carrier: ["cargo", "roof"], hitch: ["tow"], flap: ["flaps", "mud"], flaps: ["flap", "mud"]
  };

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        best = Math.min(best, cur[j]);
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function build(products, vehicles) {
    const docs = products.map((p) => ({
      p,
      name: new Set(norm(p.name).split(" ")),
      words: new Set(norm([p.name, p.category, p.shortDesc, p.brand, p.sku, Object.values(p.specs || {}).join(" ")].join(" ")).split(" ").filter(Boolean))
    }));
    const models = [], makes = [];
    for (const [make, ms] of Object.entries(vehicles || {})) {
      makes.push({ make, key: squash(make), first: norm(make).split(" ")[0] });
      for (const model of Object.keys(ms)) models.push({ make, model, key: squash(model), words: norm(model).split(" ").length, range: ms[model] });
    }
    models.sort((a, b) => b.key.length - a.key.length);
    return { docs, models, makes };
  }

  // Pulls a vehicle out of the query: model names (with or without spaces/dashes), make names and a year.
  function findVehicle(idx, tokens) {
    let found = null, used = new Set();
    for (let n = 3; n >= 1 && !found; n--) {
      for (let i = 0; i + n <= tokens.length && !found; i++) {
        const key = tokens.slice(i, i + n).join("");
        if (key.length < 2) continue;
        let cands = idx.models.filter((x) => x.key === key);
        if (!cands.length && key.length >= 4) cands = idx.models.filter((x) => x.key.startsWith(key) || (key.length >= 5 && lev(key, x.key, 1) <= 1));
        if (!cands.length) continue;
        // "scorpio" could be Scorpio-N or Scorpio Classic: keep the make, leave the model open.
        if (cands.length === 1) found = { make: cands[0].make, model: cands[0].model };
        else if (cands.every((x) => x.make === cands[0].make)) found = { make: cands[0].make, model: null, hint: key };
        else continue;
        for (let k = i; k < i + n; k++) used.add(k);
      }
    }
    if (!found) {
      for (let i = 0; i < tokens.length && !found; i++) {
        const mk = idx.makes.find((x) => x.key === tokens[i] || x.first === tokens[i] || (tokens[i].length >= 5 && lev(tokens[i], x.key, 1) <= 1));
        if (mk) { found = { make: mk.make, model: null }; used.add(i); }
      }
    } else {
      tokens.forEach((t, i) => { if (idx.makes.some((x) => x.key === t || x.first === t)) used.add(i); });
    }
    tokens.forEach((t, i) => { if (/^(19[89]\d|20[0-4]\d)$/.test(t)) { used.add(i); if (found) found.year = Number(t); } });
    return { vehicle: found, rest: tokens.filter((_, i) => !used.has(i)) };
  }

  function termScore(doc, term) {
    const alts = [term, ...(SYN[term] || [])];
    let best = 0;
    for (const w of doc.words) {
      for (const a of alts) {
        const boost = doc.name.has(w) ? 1.5 : 1, alt = a === term ? 1 : 0.8;
        if (w === a) best = Math.max(best, 3 * boost * alt);
        else if (a.length >= 2 && w.startsWith(a)) best = Math.max(best, 2 * boost * alt);
        else if (a === term && a.length >= 4 && lev(a, w, a.length >= 7 ? 2 : 1) <= (a.length >= 7 ? 2 : 1)) best = Math.max(best, 1.2 * boost);
      }
    }
    return best;
  }

  const fitsLoose = (p, v) => !v || p.universal || (p.fitment || []).some((f) => f.make === v.make && (!v.model || !f.model || f.model === v.model) &&
    (!v.year || ((f.yearFrom == null || v.year >= f.yearFrom) && (f.yearTo == null || v.year <= f.yearTo))));

  function search(idx, q) {
    const tokens = norm(q).split(" ").filter(Boolean);
    const { vehicle, rest } = findVehicle(idx, tokens);
    const terms = rest.filter((t) => !STOP.has(t));
    let partial = false;
    let scored = idx.docs.filter((d) => fitsLoose(d.p, vehicle)).map((d) => {
      const s = terms.map((t) => termScore(d, t));
      return { p: d.p, all: s.every((x) => x > 0), any: s.some((x) => x > 0), score: s.reduce((a, b) => a + b, 0) };
    });
    let hits = terms.length ? scored.filter((x) => x.all) : scored;
    if (!hits.length && terms.length) { hits = scored.filter((x) => x.any); partial = hits.length > 0; }
    hits.sort((a, b) => b.score - a.score || (b.p.sold || 0) - (a.p.sold || 0));
    return { items: hits.map((x) => x.p), vehicle, partial, terms };
  }

  const api = { build, search, fitsLoose, norm };
  if (typeof module !== "undefined") module.exports = api; else root.Search = api;
})(this);
