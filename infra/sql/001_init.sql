-- Initial database schema for odds service

create table if not exists events (
  id bigserial primary key,
  provider_refs jsonb not null default '{}'::jsonb,
  sport text not null,
  league text not null,
  home text not null,
  away text not null,
  start_time timestamptz not null,
  status text not null default 'scheduled'
);

create table if not exists markets (
  id bigserial primary key,
  event_id bigint not null references events(id) on delete cascade,
  type text not null,               -- moneyline | spread | total
  params jsonb not null default '{}'::jsonb
);

create table if not exists outcomes (
  id bigserial primary key,
  market_id bigint not null references markets(id) on delete cascade,
  side text not null,               -- HOME | AWAY | DRAW | OVER | UNDER
  canonical_key text not null
);

create table if not exists odds_ticks (
  id bigserial primary key,
  outcome_id bigint not null references outcomes(id) on delete cascade,
  provider text not null,
  price_decimal numeric(10,4) not null,    -- store canonical decimal
  line numeric(10,2),                      -- null for moneyline
  price_type text not null default 'main', -- main/alt/boost
  ts timestamptz not null default now()
);
create index on odds_ticks (outcome_id, ts);
create index on odds_ticks (provider, ts);

-- Open/Close by provider/outcome for CLV
create table if not exists market_open (
  outcome_id bigint not null references outcomes(id) on delete cascade,
  provider text not null,
  price_decimal numeric(10,4) not null,
  line numeric(10,2),
  ts_open timestamptz not null,
  primary key (outcome_id, provider)
);

create table if not exists market_close (
  outcome_id bigint not null references outcomes(id) on delete cascade,
  provider text not null,
  price_decimal numeric(10,4) not null,
  line numeric(10,2),
  ts_close timestamptz not null,
  primary key (outcome_id, provider)
);

create table if not exists user_bets (
  id bigserial primary key,
  user_id uuid not null,
  event_id bigint not null references events(id),
  market_id bigint not null references markets(id),
  outcome_id bigint not null references outcomes(id),
  book text not null,
  stake_cents bigint not null,
  placed_price_decimal numeric(10,4) not null,
  placed_line numeric(10,2),
  placed_ts timestamptz not null default now()
);