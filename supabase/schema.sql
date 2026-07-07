create extension if not exists pgcrypto;

create table if not exists public.flight_alerts (
  id uuid primary key default gen_random_uuid(),
  label text,
  origin text not null default 'ICN',
  destination text not null default 'NCE',
  departure_date date not null,
  return_date date,
  search_mode text not null default 'exact' check (search_mode in ('exact', 'month_range')),
  departure_months text[],
  trip_length_days integer check (trip_length_days is null or trip_length_days > 0),
  adults integer not null default 1 check (adults > 0),
  currency text not null default 'KRW',
  target_price_krw integer not null check (target_price_krw > 0),
  email text not null,
  is_active boolean not null default true,
  last_price_krw integer,
  last_checked_at timestamptz,
  last_notified_at timestamptz,
  check_interval_minutes integer not null default 30 check (check_interval_minutes in (5, 10, 30, 60, 180, 360)),
  notify_cooldown_minutes integer not null default 360 check (notify_cooldown_minutes >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.price_checks (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid references public.flight_alerts(id) on delete cascade,
  checked_at timestamptz not null default now(),
  lowest_price_krw integer,
  carrier text,
  raw_offer jsonb,
  error text
);

create index if not exists flight_alerts_active_idx on public.flight_alerts(is_active, created_at);
create index if not exists price_checks_alert_checked_idx on public.price_checks(alert_id, checked_at desc);

alter table public.flight_alerts enable row level security;
alter table public.price_checks enable row level security;

-- 이 MVP는 Netlify Functions의 SUPABASE_SERVICE_ROLE_KEY로만 DB를 다룹니다.
-- 클라이언트에서 Supabase anon key를 직접 쓰지 않으므로 별도 RLS policy를 만들지 않습니다.

-- 기존 설치본 업그레이드용: 이미 테이블이 있다면 아래 ALTER가 안전하게 필드를 추가합니다.
alter table public.flight_alerts add column if not exists check_interval_minutes integer not null default 30;
alter table public.flight_alerts add column if not exists notify_cooldown_minutes integer not null default 360;
alter table public.flight_alerts add column if not exists search_mode text not null default 'exact';
alter table public.flight_alerts add column if not exists departure_months text[];
alter table public.flight_alerts add column if not exists trip_length_days integer;

create index if not exists flight_alerts_active_checked_idx on public.flight_alerts(is_active, last_checked_at);
