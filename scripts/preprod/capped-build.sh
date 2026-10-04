#!/usr/bin/env bash
# Build/compilação pesada no laboratório SEMPRE com limite de memória (INC-RR-01, L-028/L-029):
# em 03/10 um `docker buildx build` sem limite, com 4 stacks no ar num host de 3,7 GiB, levou o
# Acer a reiniciar. Este wrapper:
#   1. recusa começar com MemAvailable < MIN_AVAIL_MIB (padrão 1024, o mesmo piso da recert);
#   2. roda o comando num container com --memory/--memory-swap fixos e heap do Node limitado;
#   3. nunca usa buildx sem limite.
#
#   scripts/preprod/capped-build.sh <worktree> [volume_node_modules] [-- comando]
#   (comando padrão: npm run build)
#
# Variáveis: IMAGE (padrão node:24-bookworm-slim) · MEM (2g) · MEMSWAP (5g) · HEAP_MB (1792) ·
# MIN_AVAIL_MIB (1024) · NET (bridge — o build do Next busca next/font/google).
set -euo pipefail
WT=${1:?worktree}; shift
VOL=""; if [[ $# -gt 0 && "$1" != "--" ]]; then VOL=$1; shift; fi
[[ "${1:-}" == "--" ]] && shift
CMD=${*:-npm run build}
IMAGE=${IMAGE:-node:24-bookworm-slim}; MEM=${MEM:-2g}; MEMSWAP=${MEMSWAP:-5g}; HEAP_MB=${HEAP_MB:-1792}
MIN_AVAIL_MIB=${MIN_AVAIL_MIB:-1024}; NET=${NET:-bridge}
avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
if (( avail < MIN_AVAIL_MIB )); then
  echo "RECUSADO: MemAvailable=${avail}MiB < ${MIN_AVAIL_MIB}MiB (INC-RR-01). Libere memória ou pare stacks SUAS, nunca as preservadas." >&2
  exit 3
fi
[[ -d "$WT" ]] || { echo "worktree inexistente: $WT" >&2; exit 2; }
NM=(); [[ -n "$VOL" ]] && NM=(-v "$VOL:/app/node_modules")
echo "capped-build: MemAvailable=${avail}MiB · --memory=$MEM --memory-swap=$MEMSWAP · heap=${HEAP_MB}MB · net=$NET · cmd=$CMD"
exec docker run --rm --pull never --memory="$MEM" --memory-swap="$MEMSWAP" --network "$NET" \
  --user "$(id -u):$(id -g)" -e HOME=/tmp/h -e CI=1 -e NEXT_TELEMETRY_DISABLED=1 \
  -e NODE_OPTIONS="--max-old-space-size=$HEAP_MB" -v "$WT":/app "${NM[@]}" -w /app "$IMAGE" \
  sh -c "mkdir -p /tmp/h && $CMD"
