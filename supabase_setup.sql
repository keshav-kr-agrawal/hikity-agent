-- ─────────────────────────────────────────────────────────
-- Vantage Scout — Supabase Setup SQL
-- Run this ONCE in Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────

-- 1. Create the leads table with all required columns
create table if not exists leads (
  id         bigint generated always as identity primary key,
  name       text not null,
  phone      text default 'N/A',
  status     text default 'New',
  rating     text,
  pitch      text,
  created_at timestamptz default now()
);

-- 2. Add 'rating' column if the table already exists without it
alter table leads add column if not exists rating text;
alter table leads add column if not exists pitch  text;

-- 3. Enable Row Level Security
alter table leads enable row level security;

-- 4. Drop old restrictive policies (if any)
drop policy if exists "Public access" on leads;
drop policy if exists "Allow all" on leads;

-- 5. Allow full public access via anon key (SELECT, INSERT, UPDATE, DELETE)
create policy "anon_select" on leads for select using (true);
create policy "anon_insert" on leads for insert with check (true);
create policy "anon_update" on leads for update using (true) with check (true);
create policy "anon_delete" on leads for delete using (true);
