require("dotenv").config();
const Razorpay = require("razorpay");
const db = require("./db");
const jobs = require("./lib/jobs");
const { createApp } = require("./app");
const { report } = require("./lib/alerts");
const { emailEnabled } = require("./mailer");

const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, ADMIN_USER = "admin", ADMIN_PASSWORD, ADMIN_TOTP_SECRET, PORT = 3000 } = process.env;
if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error("\nMissing Razorpay keys. Copy .env.example to .env and fill in RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.\n");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !process.env.TRUST_PROXY) console.warn("TRUST_PROXY is not set: behind a hosting proxy every shopper shares one IP, so rate limits would apply to everyone together. Set TRUST_PROXY=1 if you run behind one proxy (most hosts).");
if (process.env.NODE_ENV === "production" && !process.env.PUBLIC_URL) console.warn("PUBLIC_URL is not set: links in emails, the sitemap and canonical tags will point to localhost.");

const rzp = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
const app = createApp({ rzp, keyId: RAZORPAY_KEY_ID, keySecret: RAZORPAY_KEY_SECRET, webhookSecret: RAZORPAY_WEBHOOK_SECRET });

process.on("unhandledRejection", (e) => report(e, "unhandled rejection"));

db.check().then(() => {
  app.listen(PORT, () => {
    console.log(`Nnedverse running at http://localhost:${PORT}`);
    console.log(`Database: Supabase connected`);
    console.log(`Payments: ${RAZORPAY_KEY_ID.startsWith("rzp_test_") ? "Razorpay TEST mode" : "Razorpay LIVE mode"}`);
    console.log(`Webhook:  ${RAZORPAY_WEBHOOK_SECRET ? "ready at /api/razorpay-webhook" : "NOT configured (set RAZORPAY_WEBHOOK_SECRET)"}`);
    console.log(`Admin:    ${ADMIN_PASSWORD ? `http://localhost:${PORT}/admin  (user: ${ADMIN_USER}, 2FA ${ADMIN_TOTP_SECRET ? "on" : "OFF - set ADMIN_TOTP_SECRET"})` : "DISABLED (set ADMIN_PASSWORD)"}`);
    console.log(`Emails:   ${emailEnabled ? "enabled" : "NOT configured (set SMTP_* in .env)"}`);
  });
  jobs.start();
}).catch((err) => {
  console.error(`\nCannot start: ${err.message}\nSee .env.example and schema.sql for the Supabase setup.\n`);
  process.exit(1);
});
