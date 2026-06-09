-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — FASE 5.2 + 5.3 auth & tier schema
-- ─────────────────────────────────────────────────────────────────────────
-- Run this once, manually, in Supabase Studio → SQL Editor (or via the
-- Supabase CLI: `supabase db push`). The app does NOT auto-run migrations —
-- shipping the SQL keeps schema changes auditable and under your control.
--
-- Tables:
--   users        — one row per wallet that has ever signed in (wallet-first;
--                  email is optional and only captured for receipts / waitlist)
--   auth_nonces  — short-lived SIWE / SIWS challenge nonces (anti-replay)
--   tier_cache   — memoizes the result of an on-chain tier check so we don't
--                  hammer Helius on every page load (5-minute TTL by default)
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── users ────────────────────────────────────────────────────────────────
create table if not exists users (
  id                 uuid primary key default gen_random_uuid(),
  wallet_address     text unique not null,
  wallet_chain       text not null check (wallet_chain in ('evm','solana')),
  email              text,
  email_verified_at  timestamptz,
  created_at         timestamptz default now(),
  last_seen_at       timestamptz default now()
);
create index if not exists idx_users_wallet on users(wallet_address);

-- ── auth_nonces ──────────────────────────────────────────────────────────
-- One pending challenge per wallet. A fresh nonce overwrites the previous one
-- (ON CONFLICT in the issue path), so a wallet can only have one live nonce.
create table if not exists auth_nonces (
  wallet_address  text primary key,
  nonce           text not null,
  issued_at       timestamptz default now(),
  expires_at      timestamptz not null
);

-- ── tier_cache ───────────────────────────────────────────────────────────
create table if not exists tier_cache (
  wallet_address  text primary key,
  tier            text not null check (tier in ('free','pro','trader','pilot')),
  source          text not null check (source in ('nft','subscription','admin')),
  checked_at      timestamptz default now(),
  expires_at      timestamptz not null
);
create index if not exists idx_tier_expires on tier_cache(expires_at);

-- ── Row-Level Security ───────────────────────────────────────────────────
-- The app only ever reaches these tables through the server-side service-role
-- client, which bypasses RLS. Enabling RLS with no permissive policies means
-- that even if the anon/publishable key ever leaked, these tables stay sealed.
alter table users      enable row level security;
alter table auth_nonces enable row level security;
alter table tier_cache enable row level security;

-- ── Admin seed row ───────────────────────────────────────────────────────
-- Lets you exercise tier-gated surfaces end-to-end before the 5.4 NFT mint is
-- live. This wallet resolves to `pilot` for ~a century. Replace or delete it
-- before production launch. `source='admin'` so it's never mistaken for an
-- on-chain (nft) grant.
insert into tier_cache (wallet_address, tier, source, expires_at)
values (
  '5JAk16Tp1Us9dDKrUfEj3ktMXwDcGhewRxPqydqFV3Sr',
  'pilot',
  'admin',
  now() + interval '100 years'
)
on conflict (wallet_address) do nothing;
