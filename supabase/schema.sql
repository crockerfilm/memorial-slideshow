-- Run this whole file once in Supabase Dashboard -> SQL Editor -> New query
-- It sets up the two tables and the permissions needed for the builder/present pages.
--
-- If you already ran an earlier version of this file against this project
-- (before audio_enabled / filename / loop_enabled / random_order existed),
-- these two lines bring an existing table up to date safely -- they're a
-- no-op on a fresh project.
alter table if exists slides add column if not exists audio_enabled boolean not null default true;
alter table if exists slides add column if not exists filename text not null default '';
alter table if exists settings add column if not exists loop_enabled boolean not null default true;
alter table if exists settings add column if not exists random_order boolean not null default false;
alter table if exists settings add column if not exists photo_seconds integer not null default 6;

-- 1. Table that stores each photo/video slot and its order
create table if not exists slides (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  type text not null check (type in ('photo','video')),
  caption text not null default '',
  sort_order integer not null default 0,
  audio_enabled boolean not null default true,
  filename text not null default '',
  created_at timestamptz not null default now()
);

alter table slides enable row level security;

-- Anyone with the anon key can read (needed so the present view works for guests)
create policy "slides are publicly readable"
  on slides for select
  using (true);

-- Anyone with the anon key can insert/update/delete.
-- This is intentionally open (no login system) -- the builder page is protected
-- only by a passcode in the page itself, not real server-side auth. Fine for a
-- private family album with an unlisted link, not appropriate for anything
-- more sensitive. See README for the tradeoff.
create policy "slides are publicly writable"
  on slides for insert
  with check (true);

create policy "slides are publicly updatable"
  on slides for update
  using (true);

create policy "slides are publicly deletable"
  on slides for delete
  using (true);

-- 2. Single-row table for the title card / closing card / music track /
-- playback behavior
create table if not exists settings (
  id integer primary key default 1,
  title text not null default '',
  subtitle text not null default '',
  dates text not null default '',
  closing_message text not null default 'Thank you for celebrating a life well lived.',
  music_path text not null default '',
  loop_enabled boolean not null default true,
  random_order boolean not null default false,
  photo_seconds integer not null default 6,
  constraint single_row check (id = 1)
);

insert into settings (id, title, subtitle, dates, closing_message)
values (
  1,
  'Patrick Lawrence DeLaere Jr.',
  'Celebrating the life of',
  'September 18, 1969 – July 6, 2026',
  'Thank you for celebrating a life well lived.'
)
on conflict (id) do nothing;

alter table settings enable row level security;

create policy "settings are publicly readable"
  on settings for select
  using (true);

create policy "settings are publicly updatable"
  on settings for update
  using (true);

-- 3. Storage bucket for the actual photo/video/audio files.
-- Create the bucket itself in the Dashboard first (Storage -> New bucket ->
-- name it exactly "media" -> toggle "Public bucket" ON), then run the
-- policies below.

create policy "media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'media');

create policy "media is publicly uploadable"
  on storage.objects for insert
  with check (bucket_id = 'media');

create policy "media is publicly deletable"
  on storage.objects for delete
  using (bucket_id = 'media');
