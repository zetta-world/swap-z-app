# RELEASE RUNBOOK — candidato pré-produção `0d21874`

> **O que é:** o pacote de release do candidato certificado em laboratório local,
> com o que foi provado, o que NÃO foi, e o que só o dono pode autorizar.
> Nada aqui é autorização de deploy. Evidência bruta fica fora do repo, em
> `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/{evidence,reports}` (máquina do
> laboratório), sempre com `MANIFEST.sha256` verificável por `sha256sum -c`.
>
> **Atualizado:** 01/10/2026.

## 1. Identidade

| item | valor |
|---|---|
| SHA certificado (runtime) | `0d21874b4147bb8a0b232aa0abc2302471a720e5` |
| Tree | `62ad70e36a8bcc57331297d8ce929f232fadad2c` |
| Pai | `16e4000` → `c230b92` → `56b06bd` → `691bfdc` (linha de `main`/`25fc4b0`) |
| `package-lock.json` | sha256 `8e9b522771c06ba6415c025ca363cb5015f8c3dc221b31dd191ab014766dd38a` |
| Imagem local | `zswap-app:recert-0d21874b4147bb8a0b232aa0abc2302471a720e5-20261001T010514Z`, id `sha256:5b4593b753ca92f62fa9dfd7213ce71dde121e1303322d4601b16b1be7baea37` |
| Campanha | `recert-0d21874-20261001T010514Z` (evidência 607 arquivos, manifest verificado) |

Este documento chega num commit **separado** de docs, filho de `0d21874`: o
código certificado é o do `0d21874`; o commit de docs não toca código.

## 2. O que o `0d21874` muda

Só `package.json` e `package-lock.json`, contra `16e4000`:

- remove `@solana/spl-token` (sem nenhum import no repo; leva 28 entradas do lock);
- `next` `^16.3.6` — RCE em `next/og` (GHSA-vcvr-r3jv-pc5j), alcançável por
  `src/app/opengraph-image.tsx`;
- override `axios` `^1.20.0` (vários HIGH < 1.20.0; limpa `@coinbase/cdp-sdk`);
- override `image-size` `2.0.4` (Metro usa `default(Buffer)`, verificado);
- 10 transitivos pontuais. Sem `npm audit fix` amplo, sem `--force`.

Audit ao vivo: `16e4000` = 1 critical / 9 high · `0d21874` = **0 critical / 0 high**
(full: 36 moderate, 1 low; `--omit=dev`: 34 moderate, 0 low).

## 3. Gates — resultado da campanha final

| gate | resultado |
|---|---|
| npm ci (Node 24.21.0 / npm 11.19.0, tentativa única) | PASS — lock byte-idêntico |
| build de produção | PASS (Next 16.3.6) |
| lint / type-check | PASS — 0 erros, 145 warnings (= baseline) |
| alvo `mesa-real` + `market-indicators` ×5 | PASS 5/5 (37 testes cada) |
| playbook | PASS 29/29 |
| T13 original | **FAIL — evidência histórica válida** (nunca reclassificado) |
| T13 estável (PG 17.6 descartável) | PASS 20/20, A58 PASS |
| C1 / C4 / C2 / C3 (stack descartável) | PASS 10/10 · 10/10 · 3/3 · 5/5 |
| suíte completa ×2 | PASS — 264 arquivos / 3971 testes, conjuntos idênticos |
| secret leak audit | PASS (2ª tentativa; ver SEC-LOG-001) |
| demo smoke `/ /portfolio /bridge /cex /dca` | PASS (HTTP + Chrome headless) |
| egress da stack de recert | PASS sob o desenho de gateway |
| AP-LOCK (PostgREST 14.17 local) | PASS local · hospedado **não provado** |

Todas as falhas intermediárias ficaram preservadas na evidência, cada uma com
causa e correção (harness, fixture, log do Postgres) — nenhuma virou PASS por
retry.

## 4. Capacidade de disco do laboratório

| gate | limite |
|---|---|
| bootstrap completo do LAB | `/srv/docker` livre ≥ **25 GiB** |
| recertificação incremental | `/srv/docker` livre ≥ **20 GiB** (21474836480 B) |
| piso duro durante trabalho Docker pesado | **2 GiB** (2147483648 B) |

⚠️ `/srv/docker` é **partição própria** (`nvme0n1p6`); o gate NÃO se mede em `/`.
O cache npm verificado mora em disco de usuário (bind), não em volume Docker.

## 5. Achados abertos desta campanha

| id | severidade | resumo |
|---|---|---|
| SEC-LOG-001 | HIGH (lab) | a imagem `supabase/postgres` loga `ALTER USER … PASSWORD` no init (`log_statement='ddl'`). Presente nos logs das stacks preservadas DEMO e PRODCLONE. Corrigido na stack de recert com `-c log_statement=none`. |
| INC-REBOOT-001 | HIGH (ops) | secrets só em tmpfs + bind curto: o reboot de 30/09 derrubou as quatro stacks preservadas em silêncio (app "healthy"). Pacote durável preparado, não instalado. |
| EGRESS-001 | MEDIUM | na topologia padrão o app alcança qualquer host, inclusive exchanges reais. O gateway com allowlist foi provado na imagem final. |
| HARNESS-001 | LOW | `scripts/preprod/chaos-c4-recovery.sh` usa `docker top -eo args`; o Docker exige `pid`. Correção: `-eo pid,args`. |
| HARNESS-002 | LOW | o C4 atrás do Caddy perde a identidade por rodada (XFF substituído) → 429 na 9ª. Rodar contra a porta direta do app. |

## 6. Pacote de deploy de produção (NÃO executar sem o dono)

1. **CI:** push da branch → `ci.yml` (lint, type-check, test, `npm audit --audit-level=high`) verde no SHA exato.
2. **Migrations:** o repo traz 0050–0067 relativo a `25fc4b0`; o baseline do clone de
   produção estava em **58**. Antes de aplicar, uma leitura autorizada do
   `supabase_migrations.schema_migrations` de produção. Delta esperado: **0059–0067**,
   na ordem, conforme `LEDGER-MESTRE-RELEASE.md`.
3. **Escritas em produção:** só as migrations do passo 2 — nenhuma carga de dados.
4. **Ações financeiras:** nenhuma. `DCA_PAUSE_GLOBAL`, kill-switch do autopilot e
   `dca_real_liberado` permanecem como estão; abrir qualquer um é decisão separada.
5. **Canário:** deploy de preview Vercel no SHA → smoke das 5 rotas + `/api/telemetry/error`
   → promoção.
6. **Pós-deploy:** rotas 200, ausência de erro novo em runtime logs, crons (cron-job.org)
   respondendo, `admin_kv` inalterado.
7. **Rollback:** promover de volta o deployment `25fc4b0`. Migrations 0059–0067 são
   aditivas/ACL; a reversão de schema segue o ledger, nunca improvisada.

## 7. Só o dono pode autorizar

- push, PR e merge desta branch;
- deploy de produção, migration ou escrita no Supabase hospedado;
- leitura do PostgREST hospedado (versão) para fechar o AP-LOCK;
- recuperação das stacks preservadas: os secrets originais se perderam, e regenerar exige `ALTER ROLE` ou re-init do banco;
- instalação dos secrets duráveis (sudo, `/etc/credstore.encrypted`, systemd) e o teste de reboot;
- aplicar a política de egress e o patch fail-closed do compose às stacks preservadas;
- liberar Tailscale Serve para a demo privada (Funnel segue desligado).

## 8. Relação com outras branches

`docs/PLANO-PROD-CLONE-LAB.md` vive em `origin/platform-closure`, que saiu de `691bfdc`
e não é ancestral deste candidato. Ela deve ser mesclada à parte: não foi recriada
aqui para não bifurcar o documento.
