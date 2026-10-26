-- 0001: extensions and the private schema (never exposed through the API).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public;

-- Server-side secrets that must never leave the database (e.g. the painter phone salt).
create table private.secret (
  name text primary key,
  value bytea not null,
  created_at timestamptz not null default now()
);
revoke all on private.secret from public;

insert into private.secret (name, value)
values ('painter_phone_salt', extensions.gen_random_bytes(32));
