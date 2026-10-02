-- Run this in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run again after updates: everything is "if not exists" or "or replace".
-- Then run `npm run seed` once to load the starter products, vehicles and coupons.
--
-- Every table has row level security ON with no policies. The server uses the
-- service_role key, which bypasses RLS; the public "anon" key can read and write nothing.

-- ---------- Orders ----------
create table if not exists public.orders (
  order_id            text primary key,                 -- Razorpay order id (order_xxx) or cod_xxx
  ref                 text not null unique,             -- customer-facing number (NV-ABC123)
  status              text not null default 'created',
  fulfillment         text not null default 'new',
  amount              numeric(12,2) not null check (amount >= 0),
  currency            text not null default 'INR',
  refunded            numeric(12,2) not null default 0,
  payment_id          text unique,                      -- Razorpay payment id (pay_xxx)
  promo               text,
  cart                jsonb not null,                   -- {"productId": qty}
  customer            jsonb not null,                   -- name, email, phone, addr, city, state, zip
  vehicle             jsonb,
  tracking            jsonb,                            -- carrier, number, url
  refunds             jsonb not null default '[]'::jsonb,
  email_sent          boolean not null default false,
  shipped_email_sent  boolean not null default false,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  version             integer not null default 0        -- stops two requests overwriting each other
);

alter table public.orders add column if not exists items          jsonb;                 -- price snapshot per line
alter table public.orders add column if not exists totals         jsonb;                 -- sub, disc, ship, codFee, tax...
alter table public.orders add column if not exists payment_method text not null default 'online';
alter table public.orders add column if not exists customer_id    uuid;
alter table public.orders add column if not exists anon_id        text;
alter table public.orders add column if not exists stock_reserved boolean not null default false;
alter table public.orders add column if not exists stock_issue    boolean not null default false;
alter table public.orders add column if not exists invoice_no     text unique;
alter table public.orders add column if not exists shipment       jsonb;                 -- courier shipment ids, awb, label
alter table public.orders add column if not exists history        jsonb not null default '[]'::jsonb;
alter table public.orders add column if not exists delivered_at   timestamptz;
alter table public.orders add column if not exists abandoned_email_sent boolean not null default false;
alter table public.orders add column if not exists review_email_sent    boolean not null default false;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('created','paid','cod','expired'));
alter table public.orders drop constraint if exists orders_fulfillment_check;
alter table public.orders add constraint orders_fulfillment_check
  check (fulfillment in ('new','packed','shipped','out_for_delivery','delivered','cancelled','returned'));
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method in ('online','cod'));

create index if not exists orders_created_at_idx  on public.orders (created_at desc);
create index if not exists orders_status_idx      on public.orders (status, fulfillment);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
alter table public.orders enable row level security;

create sequence if not exists public.invoice_seq;

-- ---------- Sessions (admin and customers) ----------
create table if not exists public.sessions (
  id                  text primary key,
  user_id             text not null,
  user_name           text not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  ip_address          text
);
alter table public.sessions add column if not exists role text not null default 'admin';
create index if not exists sessions_user_id_idx    on public.sessions (user_id);
create index if not exists sessions_expires_at_idx on public.sessions (expires_at);
alter table public.sessions enable row level security;

-- ---------- Catalogue ----------
create table if not exists public.products (
  id                 serial primary key,
  sku                text not null unique,
  slug               text not null unique,
  name               text not null,
  short_desc         text not null default '',
  description        text not null default '',
  category           text not null,
  brand              text not null default '',
  price              numeric(12,2) not null check (price >= 0),   -- selling price, GST inclusive
  mrp                numeric(12,2),                                -- compare-at price
  cost_price         numeric(12,2),                                -- what you pay the supplier (admin only)
  gst_rate           numeric(5,2) not null default 18,
  hsn                text not null default '',
  stock              integer not null default 0 check (stock >= 0),
  low_stock_at       integer not null default 5,
  status             text not null default 'draft' check (status in ('active','draft','archived')),
  universal          boolean not null default false,               -- fits every vehicle
  icon               text not null default '📦',
  images             jsonb not null default '[]'::jsonb,           -- ["https://..."]
  video_url          text,
  specs              jsonb not null default '{}'::jsonb,           -- {"Material":"TPE"}
  included           text not null default '',
  install_difficulty text not null default 'Easy',
  install_guide      text not null default '',
  warranty           text not null default '',
  weight_g           integer not null default 500,
  dims_cm            jsonb not null default '{"l":30,"b":20,"h":10}'::jsonb,
  faqs               jsonb not null default '[]'::jsonb,           -- [{"q":"","a":""}]
  fit_notes          text not null default '',                     -- compatibility warnings
  seo_title          text not null default '',
  meta_desc          text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.products add column if not exists cost_price numeric(12,2);
create index if not exists products_status_idx on public.products (status, category);
alter table public.products enable row level security;

create table if not exists public.vehicles (
  id         serial primary key,
  make       text not null,
  model      text not null,
  year_from  integer not null,
  year_to    integer not null,
  unique (make, model)
);
alter table public.vehicles enable row level security;

-- One row per "this product fits": a whole make, one model, or one model for some years.
create table if not exists public.product_fitment (
  id          serial primary key,
  product_id  integer not null references public.products(id) on delete cascade,
  make        text not null,
  model       text,                 -- null = every model of the make
  year_from   integer,              -- null = every year
  year_to     integer
);
create index if not exists product_fitment_product_idx on public.product_fitment (product_id);
alter table public.product_fitment enable row level security;

create table if not exists public.inventory_log (
  id          bigserial primary key,
  product_id  integer not null references public.products(id) on delete cascade,
  delta       integer not null,
  stock_after integer not null,
  reason      text not null,        -- order, release, restock, return, adjust, import
  ref         text,
  created_at  timestamptz not null default now()
);
create index if not exists inventory_log_product_idx on public.inventory_log (product_id, created_at desc);
alter table public.inventory_log enable row level security;

-- Takes stock for every line or none of them. Raises out_of_stock:<id> if any line can't be filled.
create or replace function public.reserve_stock(p_items jsonb, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; left_after integer;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    update products set stock = stock - (it->>'qty')::int, updated_at = now()
      where id = (it->>'id')::int and status = 'active' and stock >= (it->>'qty')::int
      returning stock into left_after;
    if not found then raise exception 'out_of_stock:%', it->>'id'; end if;
    insert into inventory_log (product_id, delta, stock_after, reason, ref)
      values ((it->>'id')::int, -(it->>'qty')::int, left_after, 'order', p_ref);
  end loop;
end $$;

create or replace function public.release_stock(p_items jsonb, p_ref text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; left_after integer;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    update products set stock = stock + (it->>'qty')::int, updated_at = now()
      where id = (it->>'id')::int returning stock into left_after;
    if found then
      insert into inventory_log (product_id, delta, stock_after, reason, ref)
        values ((it->>'id')::int, (it->>'qty')::int, left_after, p_reason, p_ref);
    end if;
  end loop;
end $$;

-- Admin stock adjustment. Never lets stock go below zero.
create or replace function public.adjust_stock(p_id integer, p_delta integer, p_reason text, p_ref text) returns integer
language plpgsql security definer set search_path = public as $$
declare left_after integer;
begin
  update products set stock = stock + p_delta, updated_at = now()
    where id = p_id and stock + p_delta >= 0 returning stock into left_after;
  if not found then raise exception 'invalid_stock'; end if;
  insert into inventory_log (product_id, delta, stock_after, reason, ref) values (p_id, p_delta, left_after, p_reason, p_ref);
  return left_after;
end $$;

-- The seed inserts products with fixed ids; this moves the id counter past them.
create or replace function public.sync_product_seq() returns void
language sql security definer set search_path = public as $$
  select setval(pg_get_serial_sequence('products', 'id'), greatest((select max(id) from products), 1)) $$;

create or replace function public.next_invoice_no() returns bigint
language sql security definer set search_path = public as $$ select nextval('invoice_seq') $$;

-- ---------- Coupons ----------
create table if not exists public.coupons (
  code        text primary key,
  percent     numeric(5,2) not null check (percent > 0 and percent <= 90),
  min_order   numeric(12,2) not null default 0,
  max_uses    integer,                         -- null = unlimited
  uses        integer not null default 0,
  expires_at  timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.coupons enable row level security;

create or replace function public.use_coupon(p_code text) returns void
language sql security definer set search_path = public as $$
  update coupons set uses = uses + 1 where code = p_code $$;

-- ---------- Customers ----------
create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,          -- stored lowercase
  name            text not null,
  phone           text not null default '',
  password_hash   text not null,
  addresses       jsonb not null default '[]'::jsonb,
  garage          jsonb not null default '[]'::jsonb,   -- [{"make","model","year"}]
  wishlist        jsonb not null default '[]'::jsonb,   -- [productId]
  marketing_ok    boolean not null default false,
  reset_hash      text,
  reset_expires   timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.customers enable row level security;

-- ---------- Reviews (verified buyers only, moderated) ----------
create table if not exists public.reviews (
  id           bigserial primary key,
  product_id   integer not null references public.products(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  order_ref    text not null,
  author       text not null,
  rating       integer not null check (rating between 1 and 5),
  title        text not null default '',
  body         text not null default '',
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  helpful      integer not null default 0,
  reports      integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (product_id, customer_id)
);
create index if not exists reviews_product_idx on public.reviews (product_id, status);
alter table public.reviews enable row level security;

-- ---------- Returns ----------
create table if not exists public.returns (
  id           bigserial primary key,
  order_id     text not null references public.orders(order_id) on delete cascade,
  order_ref    text not null,
  customer_id  uuid,
  items        jsonb not null,                -- [{"id","qty","name","price"}]
  reason       text not null,
  details      text not null default '',
  photos       jsonb not null default '[]'::jsonb,
  status       text not null default 'requested'
                 check (status in ('requested','approved','rejected','picked_up','received','refunded','replaced')),
  admin_note   text not null default '',
  refund_amount numeric(12,2),
  restocked    boolean not null default false,
  history      jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists returns_order_idx on public.returns (order_id);
alter table public.returns enable row level security;

-- ---------- Newsletter, analytics, audit ----------
create table if not exists public.subscribers (
  email       text primary key,
  created_at  timestamptz not null default now()
);
alter table public.subscribers enable row level security;

create table if not exists public.events (
  id          bigserial primary key,
  name        text not null,           -- page_view, product_view, add_to_cart, begin_checkout, payment_started, purchase
  anon_id     text,
  product_id  integer,
  value       numeric(12,2),
  path        text,
  referrer    text,
  created_at  timestamptz not null default now()
);
create index if not exists events_name_time_idx on public.events (name, created_at desc);
alter table public.events enable row level security;

create table if not exists public.audit_log (
  id          bigserial primary key,
  actor       text not null,
  action      text not null,
  target      text,
  details     jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_time_idx on public.audit_log (created_at desc);
alter table public.audit_log enable row level security;

-- Only the server (service_role) may call these functions.
revoke execute on function public.reserve_stock(jsonb, text)               from public, anon, authenticated;
revoke execute on function public.release_stock(jsonb, text, text)         from public, anon, authenticated;
revoke execute on function public.adjust_stock(integer, integer, text, text) from public, anon, authenticated;
revoke execute on function public.next_invoice_no()                        from public, anon, authenticated;
revoke execute on function public.sync_product_seq()                       from public, anon, authenticated;
revoke execute on function public.use_coupon(text)                         from public, anon, authenticated;

-- Product photos (public) and return evidence (private).
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('return-photos',  'return-photos',  false) on conflict (id) do nothing;

-- ---------- Suppliers and purchase orders ----------
create table if not exists public.suppliers (
  id              serial primary key,
  name            text not null unique,
  contact_name    text not null default '',
  email           text not null default '',
  phone           text not null default '',
  gstin           text not null default '',
  address         text not null default '',
  state           text not null default '',
  payment_terms   text not null default '',        -- e.g. "Net 30", "Advance"
  lead_time_days  integer not null default 7 check (lead_time_days between 0 and 365),
  notes           text not null default '',
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.suppliers enable row level security;

alter table public.products add column if not exists supplier_id  integer references public.suppliers(id) on delete set null;
alter table public.products add column if not exists supplier_sku text not null default '';
create index if not exists products_supplier_idx on public.products (supplier_id);

create sequence if not exists public.po_seq;
create table if not exists public.purchase_orders (
  id            serial primary key,
  po_no         text not null unique,
  supplier_id   integer not null references public.suppliers(id),
  status        text not null default 'draft' check (status in ('draft','sent','partially_received','received','cancelled')),
  items         jsonb not null,                 -- [{"productId","name","sku","supplierSku","qty","received","cost"}]
  total         numeric(12,2) not null default 0,
  notes         text not null default '',
  expected_at   date,
  history       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id, status);
alter table public.purchase_orders enable row level security;

create or replace function public.next_po_no() returns bigint
language sql security definer set search_path = public as $$ select nextval('po_seq') $$;
revoke execute on function public.next_po_no() from public, anon, authenticated;
