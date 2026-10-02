// Store policies required for an Indian online store (Consumer Protection (E-Commerce) Rules, 2020;
// Digital Personal Data Protection Act, 2023). These are starting templates filled from .env:
// have a lawyer review them, then set POLICIES_REVIEWED=true to remove the draft notice.
const { STORE, money } = require("../public/core");
const { esc } = require("./security");

const LIST = [
  { slug: "shipping", title: "Shipping policy" },
  { slug: "returns", title: "Returns, refunds and cancellations" },
  { slug: "warranty", title: "Warranty policy" },
  { slug: "terms", title: "Terms of use" },
  { slug: "privacy", title: "Privacy policy" },
  { slug: "contact", title: "Contact and grievances" }
];

function biz() {
  const e = process.env, miss = (k) => `<mark>[set ${k} in .env]</mark>`;
  return {
    name: esc(e.BUSINESS_NAME || "Nnedverse"), legal: e.BUSINESS_LEGAL_NAME ? esc(e.BUSINESS_LEGAL_NAME) : miss("BUSINESS_LEGAL_NAME"),
    address: e.BUSINESS_ADDRESS ? esc(e.BUSINESS_ADDRESS) : miss("BUSINESS_ADDRESS"), gstin: e.BUSINESS_GSTIN ? esc(e.BUSINESS_GSTIN) : miss("BUSINESS_GSTIN"),
    email: e.BUSINESS_EMAIL ? esc(e.BUSINESS_EMAIL) : miss("BUSINESS_EMAIL"), phone: e.BUSINESS_PHONE ? esc(e.BUSINESS_PHONE) : miss("BUSINESS_PHONE"),
    officer: e.GRIEVANCE_OFFICER ? esc(e.GRIEVANCE_OFFICER) : miss("GRIEVANCE_OFFICER"), gEmail: e.GRIEVANCE_EMAIL ? esc(e.GRIEVANCE_EMAIL) : miss("GRIEVANCE_EMAIL"),
    gPhone: e.GRIEVANCE_PHONE ? esc(e.GRIEVANCE_PHONE) : "", city: e.JURISDICTION_CITY ? esc(e.JURISDICTION_CITY) : miss("JURISDICTION_CITY"),
    eta: esc(e.DEFAULT_ETA_DAYS || "3-7"), cod: e.COD_ENABLED !== "false"
  };
}

const BODY = {
  shipping: (b) => `
<p>We ship across India from ${b.address}. Orders placed before 2 PM on a working day are usually packed the same day.</p>
<h2>Charges</h2><ul><li>Free shipping on orders of ${money(STORE.freeShip)} or more after discounts.</li><li>Orders below that are charged ${money(STORE.shipFee)}.</li>
${b.cod ? `<li>Cash on delivery orders have an extra ${money(STORE.codFee)} fee and are available up to ${money(STORE.codMax)}.</li>` : ""}</ul>
<h2>Delivery time</h2><p>Most orders arrive in ${b.eta} working days. The estimate for your PIN code is shown on each product page and at checkout. Remote areas can take longer.</p>
<h2>Tracking</h2><p>When your order ships we email you the courier name and tracking number. You can also see it any time on the <a href="/track">Track order</a> page or in your account.</p>
<h2>Failed deliveries</h2><p>If the courier can't deliver after their attempts, the parcel returns to us. We then refund prepaid orders in full minus the outbound shipping charge, or contact you to reship.</p>`,
  returns: (b) => `
<h2>Returns</h2><p>You can return items within <b>${STORE.returnDays} days of delivery</b> if they are unused and in their original packaging. Request a return from your account or the <a href="/track">Track order</a> page.</p>
<ul><li><b>Doesn't fit:</b> if our site listed the product as fitting your vehicle and it doesn't, we arrange the pickup free and refund in full.</li>
<li><b>Damaged, defective or wrong item:</b> add a photo when you request the return. We pick it up free and refund or replace it.</li>
<li><b>Changed your mind:</b> accepted within the return window; the return pickup cost may be deducted from the refund.</li></ul>
<p>Items that have been installed, cut or modified, and consumables that have been opened (such as coating sprays), can't be returned unless they're defective.</p>
<h2>Refunds</h2><p>We refund within 2 working days of receiving and checking the return. Online payments go back to the original payment method; cash-on-delivery orders are refunded by bank transfer or UPI to an account you share with us. Banks usually take 5 to 7 working days to show the money.</p>
<h2>Cancellations</h2><p>You can cancel an order yourself from your account or the tracking page until we start packing it. Prepaid orders are refunded in full automatically. After packing, contact us and we'll help.</p>`,
  warranty: (b) => `
<p>Products carry the warranty shown on their product page. Warranty starts on the delivery date and covers manufacturing defects under normal use.</p>
<h2>How to claim</h2><p>Email ${b.email} with your order number, a short description and photos or a video of the problem. We reply within 2 working days with a repair, replacement or refund.</p>
<h2>Not covered</h2><ul><li>Damage from accidents, misuse, incorrect installation or modification</li><li>Normal wear and tear</li><li>Products installed on a vehicle they aren't listed as fitting</li></ul>`,
  terms: (b) => `
<p>This website is operated by ${b.legal} ("we"), ${b.address}, GSTIN ${b.gstin}. By using it or placing an order you agree to these terms.</p>
<h2>Products and prices</h2><p>Prices are in Indian rupees and include GST. Delivery, cash-on-delivery fees and discounts are shown before you pay. We try to describe products and fitment accurately; if a mistake affects your order we'll contact you and you can cancel for a full refund.</p>
<h2>Orders</h2><p>An order is confirmed when payment succeeds or, for cash on delivery, when you place it and receive our confirmation. We may cancel orders that we can't fulfil, with a full refund.</p>
<h2>Payments</h2><p>Online payments are processed by Razorpay. We don't store your card or bank details.</p>
<h2>Reviews</h2><p>Only customers who bought and received a product can review it. We publish positive and negative reviews alike and remove only reviews that are abusive, off-topic or not genuine. We don't write or pay for reviews.</p>
<h2>Accounts</h2><p>Keep your password private. You're responsible for orders placed from your account.</p>
<h2>Liability</h2><p>Nothing in these terms limits your rights under the Consumer Protection Act, 2019. Apart from that, our liability for any order is limited to the amount you paid for it.</p>
<h2>Law and disputes</h2><p>These terms are governed by Indian law. Courts in ${b.city} have jurisdiction, without affecting your right to approach a consumer commission.</p>`,
  privacy: (b) => `
<p>${b.legal} ("we") is the data fiduciary for personal data collected on this website, under the Digital Personal Data Protection Act, 2023.</p>
<h2>What we collect and why</h2><ul>
<li><b>Order details</b> (name, email, mobile, address, items): to deliver your order, send updates, issue GST invoices and handle returns.</li>
<li><b>Account details</b> (name, email, password stored as a secure hash, saved cars, addresses, wishlist): to run your account.</li>
<li><b>Your car</b> (make, model, year): to show products that fit. Stored on your device, and in your account if you're signed in.</li>
<li><b>Usage events</b> (pages and products viewed, cart and checkout steps) linked to a random ID on your device, not your name: to understand what works on the site.</li>
<li><b>Marketing emails</b>: only if you opt in. Unsubscribe from any email or your account.</li></ul>
<h2>Who we share it with</h2><p>Only service providers that help us run the store: Razorpay (payments), Supabase (database hosting), our email provider, our courier partners (name, address and phone for delivery), WhatsApp (order updates, if enabled)${process.env.ANTHROPIC_API_KEY ? ", and Anthropic (messages you send to the shopping assistant)" : ""}. We don't sell your data.</p>
<h2>How long we keep it</h2><p>Order and invoice records are kept for 8 years as required by tax law. Account data is kept until you ask us to delete your account. Usage events are deleted after 13 months.</p>
<h2>Your rights</h2><p>You can ask to access, correct or erase your personal data, withdraw consent for marketing, or nominate someone to exercise your rights. Email ${b.gEmail}. We respond within 30 days.</p>
<h2>Security</h2><p>Data is encrypted in transit, passwords are hashed, and access is limited to staff who need it. If a breach affects you, we'll tell you and the Data Protection Board as the law requires.</p>
<h2>Cookies and storage</h2><p>We use one essential cookie to keep you signed in, and your browser's local storage to remember your cart, car and checkout details on your device.</p>
<h2>Grievances</h2><p>Contact our grievance officer: ${b.officer}, ${b.gEmail}${b.gPhone ? ", " + b.gPhone : ""}.</p>`,
  contact: (b) => `
<h2>Business details</h2><p>${b.legal}<br>${b.address}<br>GSTIN: ${b.gstin}<br>Email: ${b.email}<br>Phone: ${b.phone}</p>
<h2>Customer support</h2><p>For help with an order, email ${b.email} with your order number. We reply within one working day.</p>
<h2>Grievance officer</h2><p>Under the Consumer Protection (E-Commerce) Rules, 2020, complaints can be sent to our grievance officer:</p>
<p>${b.officer}<br>${b.gEmail}${b.gPhone ? `<br>${b.gPhone}` : ""}<br>${b.address}</p>
<p>We acknowledge every complaint within 48 hours and resolve it within one month of receiving it.</p>`
};

function render(slug) {
  const meta = LIST.find((p) => p.slug === slug);
  if (!meta) return null;
  const b = biz();
  const draft = process.env.POLICIES_REVIEWED === "true" ? "" :
    '<p class="draft">Draft template. Have a lawyer review this page, then set POLICIES_REVIEWED=true in .env to remove this notice.</p>';
  return { title: meta.title, desc: `${meta.title} for ${b.name}, an online store for car accessories in India.`,
    html: `<h1>${esc(meta.title)}</h1>${draft}${BODY[slug](b)}` };
}

module.exports = { LIST, render };
