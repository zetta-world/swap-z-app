-- ── Admin seed: Solana wallet (carteira ADM adicional) ───────────────────
-- Address format is Solana base58 (44 chars). Seeded at `pilot` (highest tier)
-- with a ~century expiry. `source='admin'` short-circuits on-chain checks and
-- unlocks /api/tier/select so this wallet can switch freely between all plans.
insert into tier_cache (wallet_address, tier, source, expires_at)
values (
  '4iVKTpNMd7vefvx5VkBJpZxdJVSbuV3oxkcBUm8QzCNj',
  'pilot',
  'admin',
  now() + interval '100 years'
)
on conflict (wallet_address) do update
  set tier       = excluded.tier,
      source     = excluded.source,
      expires_at = excluded.expires_at;
