// Background work that runs inside the server process every few minutes.
const db = require("../db");
const orders = require("./orders");
const { report } = require("./alerts");

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const expired = await orders.expireStale();
    if (expired) console.log(`Expired ${expired} unpaid checkout(s) and released their stock.`);
    await orders.sendReviewRequests();
    await db.cleanupExpiredSessions();
    await db.deleteEventsBefore(new Date(Date.now() - 396 * 864e5).toISOString());
  } catch (e) { report(e, "background job"); }
  finally { running = false; }
}

function start(everyMs = 5 * 60000) {
  setTimeout(tick, 15000).unref();
  return setInterval(tick, everyMs).unref();
}

module.exports = { start, tick };
