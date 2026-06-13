-- ── Admin seed: carteira Phantom / Solana (sign-in via Phantom app) ─────────
-- Endereço Solana base58 usado para assinar via Phantom (SIWS). Seeded como
-- source='admin' tier='pilot' com expiry ~100 anos — acesso total à plataforma
-- e ao seletor de planos em /api/tier/select.
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
