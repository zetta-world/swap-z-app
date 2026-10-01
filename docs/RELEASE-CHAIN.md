# RELEASE CHAIN — cadeia de custódia

> Função: mostrar **qual commit veio de qual** e o status de cada um.
> Toda ancestralidade abaixo foi conferida com `git merge-base --is-ancestor`
> em 01/10/2026. De `25fc4b0` até `9f2ddcb` há **99 commits**: 75 na linha
> first-parent e 24 que entraram pelos **10 merges** dos Rounds 2–5. Nenhum
> merge traz ramo de fora da cadeia.

> ⛔ **NUNCA FAZER DEPLOY DE WORKTREE POR NOME.**
> ⛔ **Deploy só pode nascer de um SHA marcado `RELEASE_CANDIDATE` nesta página.**
> ⛔ **Hoje NENHUM SHA está marcado `RELEASE_CANDIDATE`.** `RELEASE_CANDIDATE=NONE`.
>
> **Política de deploy (decisão do dono, 01/10/2026; regra de 31/08 SUSPENSA):**
> nada vai para produção automaticamente. Deploy exige as quatro coisas:
> 1. SHA explícito;
> 2. o SHA marcado `RELEASE_CANDIDATE` aqui;
> 3. certificação PASS nesse SHA;
> 4. autorização explícita do dono.
>
> Ver `docs/AI-OPERATING-RULES.md` §6.1.
>
> **Termos (revisões 3 e 4):** `CERTIFIED` só para SHA com recertificação no
> SHA exato em PASS, sempre qualificado:
> - `CERTIFIED_EXACT_SHA`: só `0d21874b4147bb8a0b232aa0abc2302471a720e5`;
> - `CERTIFIED_RUNTIME_ANCESTOR`: o SHA não foi recertificado, mas um ancestral
>   foi e o delta é conhecido (`43c484b`, `DELTA=DOCS_ONLY`);
> - `HISTORICAL_CERTIFICATION_LEGACY`: chamado "certified" antes da revisão 3,
>   sem prova de recert exata pelo critério atual (R9, PC-B1, PC-B2).
>
> `LAST_CERTIFIED_RUNTIME=0d21874b4147bb8a0b232aa0abc2302471a720e5` ·
> `CERTIFIED_FEATURE_SHA=NONE` · `CONTROL_PLANE_HEAD=NOT_YET_COMMITTED`.
> `CERTIFIED_FEATURE_SHA` (o C1 recertificado) não é necessariamente o
> `CONTROL_PLANE_HEAD` (o C2 de atestação, só docs, nunca CERTIFIED).

---

## 1. Desenho (leia de cima para baixo: cada um veio do de cima)

```
 [PRODUÇÃO HOJE]
 25fc4b0  main · auditoria externa 30 achados fechada (#446)    PRODUCTION (registro 26/09)
    │
    │  Round 1 … Round 7   (09/15 → 09/16)
    ▼
 15b89c8  fim do Round 7                                          HISTORICAL
    │  Round 8
    ▼
 83c50fe  fim do Round 8                                          HISTORICAL
    │  Round 9
    ▼
 798fe27  Round 9 — origin/round9-surgical (congelada)            HISTORICAL_CERTIFICATION_LEGACY  DO NOT DEPLOY
    │  Platform Closure Batch 1
    ▼
 a5bdd61  PC-B1                                                   HISTORICAL_CERTIFICATION_LEGACY  DO NOT DEPLOY
    │  Platform Closure Batch 2
    ▼
 3123fb4  PC-B2 — retest independente PASS                        HISTORICAL_CERTIFICATION_LEGACY  DO NOT DEPLOY
    │  (docs) + Batch 3
    ▼
 691bfdc  PC-B3 — 0067 ACL tabelas financeiras  ───────────────┐  SUPERSEDED (candidato antigo)
    │                                                         │
    │  preprod                                                └──► origin/platform-closure
    ▼                                                              4cf073a  (+10 commits SÓ DE DOCS)
 56b06bd  preprod: estabiliza backtests                           HISTORICAL
    ▼
 c230b92  preprod: fecha achados da auditoria independente        HISTORICAL
    ▼
 16e4000  preprod: endurece harnesses                             HISTORICAL (1 critical/9 high no npm audit)
    │  supply chain
    ▼
 0d21874  runtime recert PASS — 0 critical / 0 high              CERTIFIED_EXACT_SHA (lab local)  DO NOT DEPLOY*
    │  docs
    ▼
 43c484b  docs: RELEASE-RUNBOOK — head do PR #447 (DRAFT)         DOCS_BASELINE · CERTIFIED_RUNTIME_ANCESTOR=0d21874 · DELTA=DOCS_ONLY · CI=PASS · EXACT_SHA_RECERTIFIED=NO   DO NOT DEPLOY*
    │  Early Access Fase 1
    ▼
 9f2ddcb  Early Access Fase 1 (gate CLOSED) — só local           COMMITTED_FEATURE_CHECKPOINT  DO NOT DEPLOY
          PRODUCT_BASE_SHA · PHASE1_RECERT: BLOCKED — EA-TEST-F10-FLAKY
    │  control plane + correção do teste F10
    ▼
 C1 (ainda não existe)  CANDIDATE_SHA                             recert COMPLETA no SHA exato pendente
    │  se RECERT(C1)=PASS: só docs (diff de produto C1..C2 vazio)
    ▼
 C2 (ainda não existe)  CONTROL_PLANE_ATTESTATION_COMMIT          registra CERTIFIED_FEATURE_SHA=C1; C2 NÃO é CERTIFIED; DO NOT DEPLOY
    │  Early Access Fase 2 (double opt-in), PHASE_BASE_SHA = C2
    ▼
 (ainda não existe)                                               BLOCKED_NOT_STARTED
    ▼
  …
    ▼
 FINAL RELEASE CANDIDATE                                          NOT_STARTED
```

`*` `0d21874`/`43c484b` são o **melhor candidato de runtime** que existe, mas
**não** estão marcados `RELEASE_CANDIDATE`. Faltam a autorização do dono, a
leitura de migrations em produção, a Vercel (DEFERRED_EXTERNAL_PAYMENT) e a
prova AP-LOCK hospedada (`RELEASE-RUNBOOK.md` §6–§7).

## 2. Nós da cadeia

| # | nome humano | SHA curto | SHA completo | tree | branch / ref | status | certificação | filho autorizado |
|---|---|---|---|---|---|---|---|---|
| 0 | main histórica (produção) | `25fc4b0` | `25fc4b0fa55db72472c7ae00af42596209d7c362` | `176a4fdaa877082b6abd1925ae60bc4ae86af70e` | `origin/main`, `main` | PRODUCTION (último registro `[VERCEL]` 26/09) | CI run 34986267827 SUCCESS; retest histórico incompleto | `140c860` |
| 1 | Round 1 (meio) | `140c860` | `140c860e5e483e6cc5b8eb885a990ea7bc70694e` | `2b16f7d22c2f4227fd0edb36c7fd5e9f398812ca` | — | HISTORICAL | — | `d7741bb` |
| 2 | Round 1 (fim) | `d7741bb` | `d7741bb1c10552a61810ed86f76d86715b087115` | `307ebe96d49c309efbb425a25c46c145e32da161` | `origin/claude/swap-z-recovery-deploy-b7y2cw`, `kimi/round2-audit-fixes` | HISTORICAL | retest incompleto | `6b08172` (R2) |
| 3 | Round 2 (fim) | `6b08172` | `6b081723689aad549c64aa6a6b8b31589fef2215` | `2eb6e840c938eaa5aef49828b021cca043f47b43` | — | HISTORICAL | — | `1325bd3` |
| 4 | Round 3 (fim) | `1325bd3` | `1325bd3dcfd6bc2b9bdbcdb61b62b4de374c7d86` | `ffb722b53f011bfe1a709cfea3468aaad04fad1e` | — | HISTORICAL | — | `1cb82ce` |
| 5 | Round 4 (fim) | `1cb82ce` | `1cb82ce9aa8bfe39884d1370baf3f8ed46266bb0` | `f8edf0cbf0c3a246df4d628894045adc39ff6ec5` | — | HISTORICAL | — | `bd30dea` |
| 6 | Round 5 (fim) | `bd30dea` | `bd30dea3cb71c2de0bdbfc3a906c32753a1696ee` | `65e8c1205d91f2deb861d120d03475d621ecb55b` | — | HISTORICAL | — | `e536c40` |
| 7 | Round 6 (fim) | `e536c40` | `e536c409c8400a23ca28c4b0bc5689e8be48f5bc` | `8ffa1d5e81d61f2019692572d64bdf8a06003f64` | — | HISTORICAL | — | `15b89c8` |
| 8 | Round 7 (fim) | `15b89c8` | `15b89c8809c6a475b2808b415f2e61ca09208938` | `5958ef44987bb44c9e61fb560775d18e456a47bd` | — | HISTORICAL | — | `83c50fe` (R8) |
| 9 | Round 8 (fim) | `83c50fe` | `83c50fe3acb8f019cd56ed2018f712cd0f2acf49` | `5bbe683d5f37a464b94184f4effba48deb29b31f` | — | HISTORICAL | suíte local 3586/3586; retest incompleto | `798fe27` (R9) |
| 10 | Round 9 | `798fe27` | `798fe2762370d3e2c7b57115c4caee350e82d104` | `087f82d035d4a06ed053864903bb0bcee1510eae` | `origin/round9-surgical` (congelada) | HISTORICAL_CERTIFICATION_LEGACY (era "CERTIFIED (código-base)") | retest I1–I12 `[DONO]`; reconfirmado `[RETEST]` em `3123fb4`; CI #968 FAIL ambiental | `519097a`…`a5bdd61` |
| 11 | Platform Closure B1 | `a5bdd61` | `a5bdd61d9915c84799d200b22645fe85de7ee4b5` | `a995443b95183bb98a2176458984c5518a0fa902` | — | HISTORICAL_CERTIFICATION_LEGACY (era "CERTIFIED") | CI 35985516785 SUCCESS | `3123fb4` |
| 12 | Platform Closure B2 | `3123fb4` | `3123fb4972cd0ea46a152e00c0bd1c625efb12e5` | `0f3cc3ce15678069caad28b289c1b4cccd006a80` | — | HISTORICAL_CERTIFICATION_LEGACY (era "CERTIFIED"; retest independente PASS, sem recert completa pelo critério atual) | **retest independente PASS** (`docs/retest-independente-batch2-3123fb4.md`); CI 36231021269 | `691bfdc` |
| 13 | Platform Closure B3 (0067) | `691bfdc` | `691bfdc6917de621b59d1092eec3ceeeea5d8c90` | `93a5a5386215b66efeb18ed09dedc02c4fe8e394` | worktree `candidate/` (detached); base de `origin/platform-closure` | SUPERSEDED como candidato (por `0d21874`) | "PASS WITH DELTA 0059→0067" `[DONO]`; staging Phase 3 INCOMPLETE (rollback/rebuild) | `56b06bd` |
| 13b | platform-closure (docs) | `4cf073a` | `4cf073a69d293ccd2ed28d48f92367656621bc12` | `a281d96b699ab51048094e280f6a792440a36de6` | `origin/platform-closure` | HISTORICAL_EVIDENCE (ramo lateral, só docs) | CI 36404963301 SUCCESS | **nenhum** (não é ancestral do atual) |
| 14 | preprod 1 | `56b06bd` | `56b06bde053c50ca4ffb2f284b17c3213bc5203e` | `1ef34f7cdcdff3db3213c7499a47f72f09b6214c` | — | HISTORICAL | — | `c230b92` |
| 15 | preprod 2 | `c230b92` | `c230b92b4e6db80bc2f9483a2c8bc249dabe23ea` | `dfadb2efc22d474fab0a0166d514f955e84a7a92` | — | HISTORICAL | — | `16e4000` |
| 16 | preprod 3 (blocker closure) | `16e4000` | `16e4000f969674aa704b6ea304587709b13de6c3` | `343c4531aef69a81fb773a99fcc340c3f50de43f` | `preprod-blocker-closure-20260929T111136Z` (local) | HISTORICAL | suíte 3961/3961 ×2; supply chain FAIL (1 critical / 9 high) | `0d21874` |
| 17 | **Runtime certificado** | `0d21874` | `0d21874b4147bb8a0b232aa0abc2302471a720e5` | `62ad70e36a8bcc57331297d8ce929f232fadad2c` | worktree `recert-0d21874-…` (detached) | **CERTIFIED_EXACT_SHA** (lab local) | **RUNTIME RECERTIFICATION: PASS**; suíte 264/3971 ×2; 0 critical / 0 high | `43c484b` |
| 18 | Docs baseline / PR #447 | `43c484b` | `43c484bd1fdc24cdbd8182914514d80d769deeb2` | `1c6505a6c6bd12ac06d2d3ef6eb9f9a0598814d7` | `origin/preprod-final-closure-20260930T131123Z` | DOCS_BASELINE · `CERTIFIED_RUNTIME_ANCESTOR=0d21874` · `DELTA=DOCS_ONLY` · `CI=PASS` · `EXACT_SHA_RECERTIFIED=NO` | CI 36838326106 + 36838252838 SUCCESS | `9f2ddcb` |
| 19 | **Early Access Fase 1** | `9f2ddcb` | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` | `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` | `early-access-phase2-email-double-optin-20261001`, `whitelist-fundraising-readiness-20261001` (ambos locais) | **COMMITTED_FEATURE_CHECKPOINT** (o dono o designou "certified feature checkpoint", L-009; `CERTIFIED` reservado desde L-016) | auditoria adversarial pré-hardening; **recert no SHA commitado: BLOCKED** (`reports/EARLY-ACCESS-PHASE1-RECERT-9f2ddcb-20261001.txt`: npm ci / type-check / lint / guardas PASS, alvo EA FAIL 1/123 por teste não determinístico, build/suíte/T15 NOT_RUN); sem CI | C1 (control plane + correção do teste F10, já no working tree) → recert completa no SHA exato → atestação C2 → Fase 2 |
| 19b | C1 — commit candidato (control plane + teste F10) | — | — | — | `early-access-phase2-email-double-optin-20261001` | ainda não existe (working tree, revisões 3–4) | recert completa no SHA exato pendente; se PASS vira `CERTIFIED_FEATURE_SHA` | C2 |
| 19c | C2 — commit de atestação (só docs) | — | — | — | idem | ainda não existe; só se RECERT(C1)=PASS | **nunca** CERTIFIED; prova: diff de produto `C1..C2` vazio; vira `CONTROL_PLANE_HEAD` | Fase 2 |
| 20 | Early Access Fase 2 | — | — | — | `early-access-phase2-email-double-optin-20261001` | **BLOCKED_NOT_STARTED** · NEXT_PHASE · sem código | — | — |
| ∞ | FINAL RELEASE CANDIDATE | — | — | — | — | NOT_STARTED | — | — |

Provas rápidas:

```bash
git rev-list --count 25fc4b0..9f2ddcb                                 # 99 (75 first-parent)
for s in 25fc4b0 798fe27 691bfdc 56b06bd c230b92 16e4000 0d21874 43c484b; do
  git merge-base --is-ancestor $s 9f2ddcb && echo "$s ancestral"; done
git diff --stat 0d21874 43c484b                                       # só docs/
git diff --stat 691bfdc origin/platform-closure                      # só docs/
```

## 3. Regras para promover um SHA a `RELEASE_CANDIDATE`

Todas obrigatórias, com evidência citada no ledger:

1. O SHA descende de `0d21874` (runtime certificado), ou é ele mesmo.
2. **Recertificação no SHA exato** (`CERTIFIED_EXACT_SHA`; um commit de
   atestação C2 não herda a certificação do C1 para fins de release): `npm ci`, build, lint, type-check, suíte
   completa ×2, arneses SQL 01–15, secret audit e smoke. Evidência com
   `MANIFEST.sha256`.
3. CI oficial verde **nesse SHA**, o que exige push autorizado.
4. Delta de migrations contra a produção medido por leitura autorizada (hoje:
   0059→0067, mais a 0068 se a Fase 1 entrar).
5. Nenhum `OPEN_BLOCKER` aplicável ao escopo do release em
   `docs/AUDIT-RECONCILIATION.md` §5.
6. Gates de exposição pública fechados, a menos que o dono decida abri-los à
   parte. Exemplo: `disable_early_access=true`.
7. **Autorização escrita do dono** para aquele SHA, registrada no ledger.

Mesmo com 1–7 cumpridos, o deploy em si é **outra** autorização do dono
(política de 01/10, `AI-OPERATING-RULES.md` §6.1).

Só com 1–7 cumpridos esta página ganha uma linha com `RELEASE_CANDIDATE`.
