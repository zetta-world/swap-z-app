-- ── Admin seed: EVM wallet ───────────────────────────────────────────────
-- Second admin wallet (EVM, checksummed — auth normalizes via viem
-- getAddress so the cache row must match this exact casing). `source='admin'`
-- short-circuits the on-chain check and unlocks /api/tier/select, letting
-- this wallet switch freely between every plan (pro / trader / pilot / free)
-- for end-to-end testing. Seeded at `pilot` (highest) by default.
insert into tier_cache (wallet_address, tier, source, expires_at)
values (
  '0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A',
  'pilot',
  'admin',
  now() + interval '100 years'
)
on conflict (wallet_address) do update
  set tier       = excluded.tier,
      source     = excluded.source,
      expires_at = excluded.expires_at;
