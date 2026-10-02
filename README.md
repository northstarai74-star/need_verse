# Needverse

Online store for car accessories in India. Shoppers pick their car once and see only parts that fit, then pay with UPI, cards, netbanking, wallets or cash on delivery.

Node.js and Express, Supabase (Postgres) for data, Razorpay for payments. Pages are rendered on the server, so every product has its own URL that search engines can index.

## Setup

1. `npm install`
2. Create a Supabase project and run `schema.sql` in its SQL Editor. Run it again after updates; it is safe to re-run.
3. `cp .env.example .env` and fill in the required sections: Razorpay keys, Supabase URL and service role key, and an admin password.
4. `npm run seed` loads about 70 car models for the fit finder and two coupons (SAVE10, WELCOME5). Then add your products in the admin under Products (one at a time or by CSV import).
5. `npm run totp` creates a two-factor secret for the admin. Put it in `.env` and add it to your authenticator app.
6. `npm start`, then open http://localhost:3000. The admin is at http://localhost:3000/admin.

`npm test` runs the test suite against an in-memory database. No accounts or keys are needed.

## Before you go live

The admin Overview page has a setup checklist. In short:

- **Business details:** set `BUSINESS_*` and `GRIEVANCE_*` in `.env`. They appear on invoices, the footer and the policy pages.
- **Policies and tax:** have a lawyer review the pages under `/policies/`, then set `POLICIES_REVIEWED=true`. Confirm each product's GST rate and HSN code with your CA.
- **Webhooks:** add the Razorpay webhook. If you use Shiprocket, add its webhook too.
- **Hosting:** set `PUBLIC_URL`, `NODE_ENV=production` and `TRUST_PROXY=1` (when behind a host's proxy).
- **Full test run:** place a test order, refund it, and run a return from request to refund. Then switch to live Razorpay keys.
- **Backups:** turn on daily backups in Supabase (Project Settings → Database) and test restoring one.
- **Error alerts:** set `ERROR_WEBHOOK_URL`.

## How it fits together

| Path | What it does |
|---|---|
| `app.js`, `server.js` | Builds and starts the Express app |
| `routes/store.js` | Catalogue, quotes, PIN checks, checkout, payments, webhooks, tracking, returns, reviews |
| `routes/account.js` | Customer accounts and admin sign-in |
| `routes/admin.js` | Admin API (every change goes to the audit log) |
| `lib/orders.js` | Order lifecycle: stock reservation, payment, fulfilment steps, refunds, expiry |
| `lib/pages.js`, `lib/policies.js` | Server-rendered pages, structured data, sitemap, policies |
| `lib/purchasing.js` | Suppliers, purchase orders, receiving stock and reorder suggestions |
| `lib/shipping.js`, `lib/whatsapp.js` | Shiprocket and WhatsApp (each off until configured) |
| `public/bot.js`, `lib/assistant.js` | Website chat bot: a built-in helper that works with no setup, upgraded to Claude when `ANTHROPIC_API_KEY` is set |
| `public/core.js` | Pricing, GST and fitment rules shared by browser and server |
| `public/*.js`, `public/store.css` | Storefront scripts and styles |
| `admin.html` | Admin dashboard |
| `schema.sql`, `seed.js` | Database schema and starter data |

Unpaid online checkouts hold stock for 30 minutes. A background job then expires them, puts the stock back, and sends one abandoned-cart email. It also sends review requests and clears old sessions and analytics events.
