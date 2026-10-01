-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create table if not exists public.orders (
  order_id            text primary key,                 -- Razorpay order id (order_xxx)
  ref                 text not null unique,             -- customer-facing number (NV-ABC123)
  status              text not null default 'created'
                        check (status in ('created','paid')),
  fulfillment         text not null default 'new'
                        check (fulfillment in ('new','packed','shipped','delivered','cancelled')),
  amount              numeric(12,2) not null check (amount >= 0),
  currency            text not null default 'INR',
  refunded            numeric(12,2) not null default 0,
  payment_id          text unique,                      -- Razorpay payment id (pay_xxx)
  promo               text,
  cart                jsonb not null,                   -- {"productId": qty}
  customer            jsonb not null,                   -- name, email, phone, addr, city, zip
  vehicle             jsonb,
  tracking            jsonb,                            -- carrier, number, url
  refunds             jsonb not null default '[]'::jsonb,
  email_sent          boolean not null default false,
  shipped_email_sent  boolean not null default false,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  version             integer not null default 0        -- used to stop two requests overwriting each other
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx     on public.orders (status, fulfillment);

-- Products table
create table if not exists public.products (
  id                  serial primary key,
  name                text not null,
  cat                 text not null,
  price               numeric(12,2) not null check (price >= 0),
  rating              numeric(3,2) default 4.5,
  n                   integer default 0,
  pop                 integer default 50,
  icon                text,
  fits                jsonb not null default '[]'::jsonb,
  desc                text,
  img                 text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Inventory table
create table if not exists public.inventory (
  id                  serial primary key,
  product_id          integer not null references public.products(id) on delete cascade,
  quantity            integer not null default 0,
  reserved            integer not null default 0,
  low_stock_alert     integer default 10,
  updated_at          timestamptz not null default now(),
  unique(product_id)
);

-- Coupons table
create table if not exists public.coupons (
  id                  serial primary key,
  code                text not null unique,
  discount_percent    numeric(5,2) not null,
  max_uses            integer,
  used_count          integer not null default 0,
  active              boolean not null default true,
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

-- Customers table
create table if not exists public.customers (
  id                  serial primary key,
  email               text not null unique,
  name                text not null,
  phone               text,
  addr                text,
  city                text,
  zip                 text,
  total_orders        integer not null default 0,
  total_spent         numeric(12,2) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists products_active_idx on public.products (active);
create index if not exists inventory_product_idx on public.inventory (product_id);
create index if not exists coupons_active_idx on public.coupons (active);
create index if not exists customers_email_idx on public.customers (email);

-- Lock the table down. The server uses the service_role key, which bypasses
-- row level security. With RLS on and no policies, the public "anon" key
-- (which is visible in browsers) can read and write nothing.
alter table public.orders enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.coupons enable row level security;
alter table public.customers enable row level security;
