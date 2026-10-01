#!/usr/bin/env bash
set -euo pipefail

# Captura read-only para ligar uma execução de testes ao conteúdo exato usado.
# Não cria artefatos: quem chama decide se redireciona o stdout para evidence.
export LC_ALL=C
export TZ=UTC

require_clean=0
image_ref=''
while (($#)); do
  case "$1" in
    --require-clean)
      require_clean=1
      shift
      ;;
    --image)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--image exige IMAGE_REF" >&2; exit 2; }
      image_ref=$2
      shift 2
      ;;
    *)
      echo "uso: $0 [--require-clean] [--image IMAGE_REF]" >&2
      exit 2
      ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
status=$(git status --porcelain=v1 --untracked-files=all)

echo "UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "HEAD=$(git rev-parse HEAD)"
echo "HEAD_TREE=$(git rev-parse 'HEAD^{tree}')"
echo "BRANCH=$(git branch --show-current)"
echo "NODE_VERSION=$(node --version)"
echo "NPM_VERSION=$(npm --version)"
node -e '
  const p = require("./package.json");
  const l = require("./package-lock.json");
  console.log(`PACKAGE_NAME=${p.name ?? ""}`);
  console.log(`PACKAGE_VERSION=${p.version ?? ""}`);
  console.log(`PACKAGE_MANAGER=${p.packageManager ?? "npm(lockfile)"}`);
  console.log(`LOCKFILE_VERSION=${l.lockfileVersion ?? ""}`);
'
echo "PACKAGE_LOCK_SHA256=$(sha256sum package-lock.json | awk '{print $1}')"
echo "STATUS_PORCELAIN_BEGIN"
printf '%s\n' "$status"
echo "STATUS_PORCELAIN_END"
if ((require_clean)) && [[ -n "$status" ]]; then
  echo "REQUIRE_CLEAN=FAIL" >&2
  exit 1
fi
echo "REQUIRE_CLEAN=$([[ $require_clean == 1 ]] && echo PASS || echo NOT_REQUESTED)"
echo "DIFF_STAT_HEAD_BEGIN"
git diff --stat HEAD --
echo "DIFF_STAT_HEAD_END"
echo "RELEVANT_SHA256_BEGIN"
sha256sum -- \
  package.json \
  package-lock.json \
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

if [[ -n "$image_ref" ]]; then
  command -v docker >/dev/null || {
    echo "--image solicitado, mas docker não está disponível" >&2
    exit 2
  }
  echo "IMAGE_REF=$image_ref"
  docker image inspect --format 'IMAGE_ID={{.Id}}' "$image_ref"
  docker image inspect --format '{{range .RepoDigests}}IMAGE_REPO_DIGEST={{.}}{{println}}{{end}}' "$image_ref"
fi
