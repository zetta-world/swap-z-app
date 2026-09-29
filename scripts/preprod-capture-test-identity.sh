#!/usr/bin/env bash
set -euo pipefail

# Captura read-only para ligar uma execução de testes ao conteúdo exato usado.
# Não cria artefatos: quem chama decide se redireciona o stdout para evidence.
export LC_ALL=C
export TZ=UTC

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

echo "UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "HEAD=$(git rev-parse HEAD)"
echo "HEAD_TREE=$(git rev-parse 'HEAD^{tree}')"
echo "BRANCH=$(git branch --show-current)"
echo "STATUS_SHORT_BEGIN"
git status --short --untracked-files=all
echo "STATUS_SHORT_END"
echo "DIFF_STAT_HEAD_BEGIN"
git diff --stat HEAD --
echo "DIFF_STAT_HEAD_END"
echo "RELEVANT_SHA256_BEGIN"
sha256sum -- \
  src/lib/api/market-indicators.ts \
  src/lib/api/market-indicators.test.ts \
  src/lib/bancada/mesa-real.ts \
  src/lib/bancada/mesa-real.test.ts \
  src/lib/zion/playbook-backtest.ts \
  src/lib/zion/playbook-backtest.test.ts \
  supabase/tests/13_dca_a58_concorrencia.sh \
  supabase/tests/13_dca_a58_concorrencia_stable.sh \
  scripts/preprod/fake-binance-chaos.mjs \
  scripts/preprod/chaos-c4-recovery.sh \
  scripts/preprod-capture-test-identity.sh
echo "RELEVANT_SHA256_END"
