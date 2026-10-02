// Posts server errors to a chat webhook (Slack or Discord incoming webhook URL in ERROR_WEBHOOK_URL).
// At most one alert per distinct message every 10 minutes, so a broken dependency can't flood the channel.
const recent = new Map();

function report(err, where) {
  const msg = `${where ? where + ": " : ""}${err?.error?.description || err?.message || String(err)}`.slice(0, 500);
  console.error(msg, err?.stack ? "\n" + err.stack : "");
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const t = Date.now();
  if (recent.get(msg) > t - 10 * 60000) return;
  recent.set(msg, t);
  const text = `[${process.env.BUSINESS_NAME || "Needverse"} ${process.env.NODE_ENV || "development"}] ${msg}`;
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }) })
    .catch((e) => console.error("Error alert failed:", e.message));
}

module.exports = { report };
