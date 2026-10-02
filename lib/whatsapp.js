// WhatsApp order updates through the Meta WhatsApp Cloud API. Off unless WHATSAPP_TOKEN and
// WHATSAPP_PHONE_ID are set. Each message uses a template you create and get approved in
// WhatsApp Manager; the template names are set in .env. Body variables are listed per template.
const env = () => process.env;
const enabled = () => Boolean(env().WHATSAPP_TOKEN && env().WHATSAPP_PHONE_ID);

const TEMPLATES = {
  order_confirmed: () => env().WA_TPL_ORDER,       // {{1}} name, {{2}} order ref, {{3}} amount
  order_shipped: () => env().WA_TPL_SHIPPED,       // {{1}} name, {{2}} order ref, {{3}} tracking link or number
  order_delivered: () => env().WA_TPL_DELIVERED    // {{1}} name, {{2}} order ref
};

const toIndianNumber = (phone) => {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d.length === 12 && d.startsWith("91") ? d : null;
};

async function send(kind, phone, params) {
  const name = TEMPLATES[kind]?.(), to = toIndianNumber(phone);
  if (!enabled() || !name || !to) return false;
  const r = await fetch(`https://graph.facebook.com/v21.0/${env().WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: "Bearer " + env().WHATSAPP_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template",
      template: { name, language: { code: env().WA_TPL_LANG || "en" }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text) })) }] } })
  });
  if (!r.ok) throw new Error("WhatsApp send failed: " + (await r.text()).slice(0, 200));
  return true;
}

// Never lets a WhatsApp problem break an order flow.
const notify = (kind, phone, params) => send(kind, phone, params).catch((e) => { console.error(e.message); return false; });

module.exports = { enabled, notify, toIndianNumber };
