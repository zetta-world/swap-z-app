# RELEASE CHAIN — cadeia de custódia

> Função: mostrar **qual commit veio de qual** e o status de cada um.
> Toda ancestralidade abaixo foi conferida com `git merge-base --is-ancestor`
> em 01/10/2026. De `25fc4b0` até `9f2ddcb` há **99 commits**: 75 na linha
> first-parent e 24 que entraram pelos **10 merges** dos Rounds 2–5. Nenhum
> merge traz ramo de fora da cadeia.

> ⛔ **NUNCA FAZER DEPLOY DE WORKTREE POR NOME.**
> ⛔ **Deploy só pode nascer de um SHA marcado `RELEASE_CANDIDATE` nesta página.**
> ⛔ **Hoje nenhum candidato NOVO está marcado `RELEASE_CANDIDATE`.** O release de 13–14/10 (código
> `6d1295bf43f4967b7e15498f1496c132fc09fa7a`, nó 27) foi selecionado e executado, mas a marcação
> `RELEASE_CANDIDATE` **não** foi registrada nesta página antes do deploy — lacuna registrada em L-053
> (reconciliação posterior, 14/10). Isso não é precedente: a regra abaixo continua valendo.
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
> - `CERTIFIED_EXACT_SHA`: `0d21874b4147bb8a0b232aa0abc2302471a720e5` (runtime) e
>   `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (C1b, Early Access Fase 1; L-019) e
>   `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (C1, Early Access Fase 2; L-027);
> - `CERTIFIED_RUNTIME_ANCESTOR`: o SHA não foi recertificado, mas um ancestral
>   foi e o delta é conhecido (`43c484b`, `DELTA=DOCS_ONLY`);
> - `HISTORICAL_CERTIFICATION_LEGACY`: chamado "certified" antes da revisão 3,
>   sem prova de recert exata pelo critério atual (R9, PC-B1, PC-B2).
>
> `LAST_CERTIFIED_RUNTIME=0d21874b4147bb8a0b232aa0abc2302471a720e5` ·
> `CERTIFIED_FEATURE_SHA=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (Fase 2, RECERT(C1)=PASS, 03/10, L-027; antes `f1b4ec1`, Fase 1, L-019) ·
> `CONTROL_PLANE_HEAD` = `THIS_CONTROL_PLANE_COMMIT` da L-053 em `main` (só docs, **não** CERTIFIED;
> filho do RELEASE CODE SHA `6d1295bf43f4967b7e15498f1496c132fc09fa7a`, nó 27). Antes: o da L-049 (histórico).
> C1 `f4af9764e4c773f1bba2821f6cbef9685cfeb59d`: **RECERT FAIL** (02/10, L-018).
> `CERTIFIED_FEATURE_SHA` (o C1 recertificado) não é necessariamente o
> `CONTROL_PLANE_HEAD` (o C2 de atestação, só docs, nunca CERTIFIED).

---

## 1. Desenho (leia de cima para baixo: cada um veio do de cima)

```
 [PRODUÇÃO ATÉ 14/10/2026 ~00:26 UTC — hoje ROLLBACK_CANDIDATE `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ`]
 25fc4b0  main · auditoria externa 30 achados fechada (#446)    HISTORICAL PRODUCTION (registro 26/09; servido até o release de 13–14/10)
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
 f4af976  C1 — CANDIDATE_SHA (control plane + F10)                RECERT FAIL (alvo EA 122/123, EA-TEST-HMAC-189-FLAKY)  DO NOT DEPLOY
    │  correção EA-TEST-HMAC-189-FLAKY + docs revisão 5
    ▼
 f1b4ec1  C1b — CANDIDATE_SHA (teste HMAC-189 + docs rev. 5)      RECERT PASS · CERTIFIED_EXACT_SHA · CERTIFIED_FEATURE_SHA  DO NOT DEPLOY*
    │  só docs (diff de produto C1b..C2 vazio)
    ▼
 74f37f5  C2 (o commit que traz L-019)  CONTROL_PLANE_ATTESTATION_COMMIT   registra CERTIFIED_FEATURE_SHA=f1b4ec1; C2 NÃO é CERTIFIED; DO NOT DEPLOY
    │  Early Access Fase 2 (double opt-in), PHASE_BASE_SHA = 74f37f5
    ▼
 53cd85a  C1 da Fase 2 — CANDIDATE_SHA                             RECERT PASS (recert-c1-53cd85a-v31-20261003T182216Z) · CERTIFIED_EXACT_SHA · CERTIFIED_FEATURE_SHA  DO NOT DEPLOY*
    │  só docs (diff de produto C1..C2 vazio)
    ▼
 C2 da Fase 2 (o commit que traz L-027)  CONTROL_PLANE_ATTESTATION_COMMIT   registra CERTIFIED_FEATURE_SHA=53cd85a; NÃO é CERTIFIED; DO NOT DEPLOY
    │  só docs: ensaio PROD-CLONE CLOSED_PASS (L-028) + reconciliação ao vivo CLOSED (L-029) + runbook revisão 2
    ▼
 commit da L-029  control plane histórico (só docs)               NÃO é CERTIFIED; DO NOT DEPLOY
    │  lanes locais L-031…L-042 (ver ledger)
    ▼
 b464dd7  base do Founders Economics + Commercial Truth           PHASE_BASE; DO NOT DEPLOY
    │  plano + implementação + documentação
    ▼
 c2bfc4a  candidato Founders closure                               EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED; AUDIT PENDING; DO NOT DEPLOY
    │  só docs (diff de produto vazio)
    ▼
 30366d0  atestação L-044                                          CONTROL_PLANE HISTÓRICO; DO NOT DEPLOY
    │  delta final de venda, copy, treinamento e passivo
    ▼
 8ef9bbe  candidato Founders final sale + liability                 EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED; AUDIT PENDING; DO NOT DEPLOY
    │  só docs (diff de produto vazio)
    ▼
 8f1849e  atestação L-045                                           CONTROL_PLANE HISTÓRICO; DO NOT DEPLOY
    │  micro-delta AF-01/AF-02
    ▼
 58bcf8e  candidato Founders final micro-delta                       INDEPENDENT AUDIT FAIL IA-AF01-001; HISTORICAL; DO NOT DEPLOY
    │  só docs (diff de produto vazio)
    ▼
 d08a1e3  atestação/higiene pós-auditoria                           PHASE_BASE AF-01; DO NOT DEPLOY
    │  correção cirúrgica de agenda parcial
    ▼
 efdf6ee  candidato Founders AF-01                                  EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED; AUDIT PENDING; DO NOT DEPLOY
    │  só docs (diff de produto vazio)
    ▼
 35b7c72  commit da L-049 (atestação AF-01)                          control plane histórico; NÃO é CERTIFIED; DO NOT DEPLOY
    │  supply chain (L-050) · página pública Founders (L-051) · blockers finais (L-052, Next 16.3.8)
    ▼
 fd68c4f/56241b2  blockers da página pública Founders              EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED (fd68c4f); DO NOT DEPLOY
    │  Orders Public Truth micro-closure (IA-PUBLIC-ORDERS-001)
    ▼
 2e50b1d/e2f61d1  Orders Public Truth (código / docs)               topo do trabalho aprovado em 13/10; DO NOT DEPLOY por si
    │  release 13–14/10: 2 commits só de teste (trava CE-01)
    ▼
 2352fe1 → 6d1295b  RELEASE CODE SHA                               RELEASED TO PRODUCTION 14/10 (não CERTIFIED_EXACT_SHA; ver nó 27)
    │  só docs (L-053)
    ▼
 commit da L-053  reconciliação de governança pós-release           control plane; NÃO é CERTIFIED; o código servido é o de 6d1295b
```

`*` `0d21874`/`43c484b` são o **melhor candidato de runtime** que existe, mas
**não** estão marcados `RELEASE_CANDIDATE`. O C1b `f1b4ec1` também não: a
recert dele é de feature (laboratório local), não satisfaz sozinha as regras do
§3 (suíte ×2, arneses SQL 01–15, CI oficial, migrations, autorização). Faltam a autorização do dono, a
leitura de migrations em produção, a Vercel (DEFERRED_EXTERNAL_PAYMENT) e a
prova AP-LOCK hospedada (`RELEASE-RUNBOOK.md` §6–§7).
**Atualização L-029 (03/10, medido ao vivo):** leitura das migrations de produção **feita** (55 linhas,
0059–0069 ausentes, sem drift desde 28/09). O release com gate fechado está bloqueado por **R-01** (Vercel
`BLOCKED_BY_ACCOUNT_PAYMENT`, produção em 402) e **R-02** (`CEX_RECOVERY_HMAC_KEY` ausente na Vercel, exigida
pelo alvo). `RC_SELECTION_READY=NO`; recomendação (≠ seleção) de feature: `53cd85a`. Runbook vigente:
`RELEASE-RUNBOOK.md` revisão 2.
**Atualização L-053 (14/10, pós-release):** o release de produção de 13–14/10 usou o código `6d1295b` (nó 27):
`main` avançou por fast-forward `25fc4b0` → `6d1295b`; migrations 0059–0076 aplicadas; R-01 e R-02 fechados; a exceção R-03
foi revisada e mantida (não corrigida). O registro de seleção como `RELEASE_CANDIDATE` **não** existia aqui antes do deploy.
As atualizações L-029 e L-035 abaixo e acima descrevem o estado **anterior** ao release.
**Atualização L-035 (04/10, só lane B):** pré-requisito adicional da seleção de RC — **revisão obrigatória da
exceção temporária R-03** do `npm audit` (`docs/R03-AUDIT-EXCEPTION.md`, `scripts/release/audit-exceptions.json`
`revisar_antes_do_rc: true`). A vulnerabilidade não está corrigida; o RC não pode ser selecionado sem o dono
reafirmar ou remover a exceção. (Na lane de release, o passo de audit ainda é o antigo, não bloqueante.)

## 2. Nós da cadeia

| # | nome humano | SHA curto | SHA completo | tree | branch / ref | status | certificação | filho autorizado |
|---|---|---|---|---|---|---|---|---|
| 0 | main histórica (produção até 14/10) | `25fc4b0` | `25fc4b0fa55db72472c7ae00af42596209d7c362` | `176a4fdaa877082b6abd1925ae60bc4ae86af70e` | `main` local deste checkout (desatualizado); deixou de ser `origin/main` em 14/10 | HISTORICAL PRODUCTION · ROLLBACK_CANDIDATE (`dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ`, servido com sucesso sobre o schema 0076) | CI run 34986267827 SUCCESS; retest histórico incompleto | `140c860` |
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
| 19b | C1 — commit candidato (control plane + teste F10) | `f4af976` | `f4af9764e4c773f1bba2821f6cbef9685cfeb59d` | `d214a354b75cafbd13d2882c94eec98c0e262a28` | `early-access-phase2-email-double-optin-20261001` (local) | CANDIDATE_SHA · **RECERT FAIL** · DO NOT DEPLOY | recert exata 02/10 (`recert-c1-f4af976-20261002T012205Z`): alvo EA 122/123 (EA-TEST-HMAC-189-FLAKY); `reports/EARLY-ACCESS-PHASE1-C1-RECERT-f4af976-20261001.txt`; ledger L-018 | C1b |
| 19b′ | C1b — commit candidato (correção EA-TEST-HMAC-189-FLAKY + docs revisão 5) | `f1b4ec1` | `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` | `ab814e3ba6369a8b66218a9accc76a18ca6f14f6` | `early-access-phase2-email-double-optin-20261001` (local) | **CERTIFIED_EXACT_SHA** · `CERTIFIED_FEATURE_SHA` · DO NOT DEPLOY (não é RELEASE_CANDIDATE) | **RECERT(C1b)=PASS** 02/10, campanha `recert-c1b-f1b4ec1-20261002T095819Z`: ×100 100/100 · alvo EA 123/123 · guardas 264/264 · T15 22/22 · type-check · lint 0/145 · build exit 0 · suíte 271/4096; `reports/EARLY-ACCESS-PHASE1-C1B-RECERT-f1b4ec1-20261002.campaign-20261002T095819Z.txt`; ledger L-019 | C2 |
| 19c | C2 — commit de atestação (só docs) | `74f37f5` (o commit que traz L-019) | `74f37f50d12dae698f14b620914bc0ce5b0c639a` | `5c93c0512b74777724aae62f665b10feaa95f760` | idem | `CONTROL_PLANE_ATTESTATION_COMMIT` · `CONTROL_PLANE_HEAD` · **não** CERTIFIED · DO NOT DEPLOY | prova: diff de produto `f1b4ec1..C2` vazio (medido antes do commit; repetir depois) | Fase 2 (`PHASE_BASE_SHA` = SHA do C2) |
| 20 | Early Access Fase 2 — C1 | `53cd85a` | `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` | `010a448c774247406cc9cc80cba34e8744426557` | `early-access-phase2-email-double-optin-20261001` (local) | **CANDIDATE_SHA · RECERT PASS · CERTIFIED_EXACT_SHA · CERTIFIED_FEATURE_SHA** · DO NOT DEPLOY | `recert-c1-53cd85a-v31-20261003T182216Z` (MANIFEST `31e19f5b1a685b73…`); campanha `recert-c1-53cd85a-20261003T180548Z` = FAIL · HARNESS_FAILURE_G13_SHELL_QUOTING (classificação pela evidência; **não** atribuída ao dono) | L-027 |
| 20x | C2 não autorizado (só docs, idêntico ao 20c exceto pela atribuição) | `6f9c10c` | `6f9c10cb87dbcd3dd6d2be93712c15e0fe228190` | `10c815587e498999bdb748b84771983634d009c9` | tag local `preserved/unauthorized-c2-superseded-6f9c10c` (fora do branch) | **UNAUTHORIZED_LOCAL_ATTESTATION_SUPERSEDED** · nunca enviado · DO NOT USE | substituído pelo 20c | L-027 |
| 20c | Early Access Fase 2 — C2 (atestação, só docs; substituto autorizado) | o commit que traz L-027 | — | — | idem | `CONTROL_PLANE_ATTESTATION_COMMIT` · `CONTROL_PLANE_HEAD` · **não** CERTIFIED · DO NOT DEPLOY | prova: diff de produto `53cd85a..C2` vazio | — |
| 20d | Registro do ensaio PROD-CLONE (CLOSED_PASS) + reconciliação ao vivo (CLOSED) + runbook revisão 2 (só docs) | o commit que traz L-029 | — | — | idem | control plane · **não** CERTIFIED · **não** atestação de recert · DO NOT DEPLOY · `CERTIFIED_FEATURE_SHA` segue `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` | prova: diff de produto `53cd85a..`este vazio; pai = `57d78ebf42866a53f16ef5f0a5cc24bc3ac97c9c` | RC pendente de R-01 (Vercel), R-02 (`CEX_RECOVERY_HMAC_KEY`), re-medição e seleção do dono |
| 21a | base Founders Economics + Commercial Truth (control plane da L-042) | `b464dd7` | `b464dd7fbec0941ffb26ab391a1783328dd876f9` | `897925225fdffa2147786e4de166b9b8538b69bf` | `founders-commercial-economics-closure-20261006` (base local) | PHASE_BASE · DO NOT DEPLOY | nenhuma certificação nova | `183f4c6` → `3562110` → `c2bfc4a` |
| 21b | candidato Founders commercial truth + economics | `c2bfc4a` | `c2bfc4ab93801fc8084e952564afde0cde5ceae6` | `52c8cac23a27f48e25be3498090db1e31d098c43` | `founders-commercial-economics-closure-20261006` (local, sem upstream) | `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` · `READY_FOR_INDEPENDENT_AUDIT` · DO NOT DEPLOY | Node 24; npm ci/build/lint/type-check PASS; 288/288 alvo; suíte 313/4654 PASS; manifest `feafb658…` | auditoria independente |
| 21c | atestação docs-only Founders (L-044) | `30366d0` | `30366d0e95bcf3222f47fb9ef955a2a1bf294096` | `94cc97656ca84be3a21d8b8b3a0cb305bc174fbc` | `founders-commercial-economics-closure-20261006` (local) | control plane histórico · não CERTIFIED · DO NOT DEPLOY | diff de produto `c2bfc4a..30366d0` vazio | substituído pelo delta L-045; `RELEASE_CANDIDATE=NONE` |
| 22a | base do delta final Founders | `30366d0` | `30366d0e95bcf3222f47fb9ef955a2a1bf294096` | `94cc97656ca84be3a21d8b8b3a0cb305bc174fbc` | `founders-sale-rules-final-delta-20261006` (base local) | PHASE_BASE · DO NOT DEPLOY | nenhuma certificação nova | `3a3f659` → `6c638ac` → `167816b` → `1cc619d` → `8ef9bbe` |
| 22b | candidato Founders final sale + liability | `8ef9bbe` | `8ef9bbe27ff1f74dd8d1f7f6e6f7abb180497150` | `d489e23e12004782f9620ac8bedf1f9f3a482ad4` | `founders-sale-rules-final-delta-20261006` (local, sem upstream) | `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` · `READY_FOR_INDEPENDENT_AUDIT` · DO NOT DEPLOY | Node 24; npm ci/build/lint/type-check PASS; alvo 18/270; suíte 314/4669 PASS; modelo determinístico | auditoria independente |
| 22c | atestação docs-only Founders final (L-045) | `8f1849e` | `8f1849eb28a61f1a5f8b477386c3ce0940bc5e67` | `11cace84df18f4d8c8e9b72b31d9252bc8cea04a` | idem | control plane histórico · não CERTIFIED · DO NOT DEPLOY | diff de produto `8ef9bbe..8f1849e` vazio | micro-delta L-046/L-047 |
| 23a | base do Founders final micro-delta | `8f1849e` | `8f1849eb28a61f1a5f8b477386c3ce0940bc5e67` | `11cace84df18f4d8c8e9b72b31d9252bc8cea04a` | `founders-final-microdelta-20261006` (base local) | PHASE_BASE · DO NOT DEPLOY | nenhuma certificação nova | `b2fb586` → `1ad14de` → `58bcf8e` |
| 23b | candidato Founders final micro-delta | `58bcf8e` | `58bcf8e359ec209d65f45006d0f71c17cf1a53a5` | `835084a2ccb117e64a07376f9684d46196466c66` | `founders-final-microdelta-20261006` (local, sem upstream) | **INDEPENDENT_AUDIT_FAIL `IA-AF01-001`** · HISTORICAL · DO NOT DEPLOY | recert do implementador passou, mas auditoria provou agenda parcial sem deadline | corrigido somente em novo candidato `efdf6ee` |
| 23c | atestação docs-only Founders micro-delta (L-047) | `THIS_CONTROL_PLANE_COMMIT` | — | — | idem | `CONTROL_PLANE_HEAD` · não CERTIFIED · DO NOT DEPLOY | diff de produto `58bcf8e..HEAD` vazio | auditoria independente; `RELEASE_CANDIDATE=NONE` |
| 24a | base cirúrgica AF-01 após FAIL independente | `d08a1e3` | `d08a1e3a221b5559630f53fb3318d538ee9c383f` | `84e1c04f4952e42888150f6472f79591b23672fc` | `founders-af01-partial-schedule-fix-20261007` (local, sem upstream) | PHASE_BASE · DO NOT DEPLOY | abertura L-048 | `8fff64f` → `d2c565f` → `efdf6ee` |
| 24b | candidato Founders AF-01 surgical closure | `efdf6ee` | `efdf6ee5a64d4f5491b806da6258706615b6ffec` | `9021c273c1d2e790f3a09da25de8f230ba9ef46e` | idem | `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` · `READY_FOR_INDEPENDENT_AUDIT` · DO NOT DEPLOY | Node 24; npm ci/build/lint/type-check PASS; Founders 17/254; suíte 314/4674; economia sem diff | nova auditoria independente |
| 24c | atestação docs-only Founders AF-01 (L-049) | `THIS_CONTROL_PLANE_COMMIT` | — | — | idem | `CONTROL_PLANE_ATTESTATION_COMMIT` · não CERTIFIED · DO NOT DEPLOY | diff de produto `efdf6ee..HEAD` vazio | auditoria independente; `RELEASE_CANDIDATE=NONE` |
| 25 | blockers da página pública Founders (L-052) | `fd68c4f` | `fd68c4f663ced81c3e040367c62697e473b5d542` | `aea9a29aa766304a80dc6394d40377632966ce1f` | `sales-page-final-blockers-20261008` (local) | `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` · ancestral do release | Next 16.3.8; suíte 320/4702 (implementer-reported) | `56241b2` (docs) → `2e50b1d` |
| 26 | Orders Public Truth micro-closure | `e2f61d1` | `e2f61d174417a45c299117be86ee74027eec75f3` | `7afa9fe6f4a8d41adb2e8597c7bd08b629a82e3e` | `orders-public-truth-microclosure-20261008` (local); base de `origin/release/production-20261013` | ancestral do release; código em `2e50b1d` (`f414c9fad97494addce2e911f307f20eb48e12af`) | medido no release em 13/10: npm ci, lint 0 erros, type-check, suíte 321/4715, build, audit gate R-03 OK, secret scan, economia sem diff | `2352fe1` |
| 27 | **RELEASE CODE SHA (13–14/10)** | `6d1295b` | `6d1295bf43f4967b7e15498f1496c132fc09fa7a` | `22a3a409e6f43d2b5bb8f7e727ef4c8bba0e364a` | `origin/release/production-20261013`; `origin/main` avançou para ele por fast-forward | **RELEASED TO PRODUCTION** (deployment original `dpl_A5PDW653HtRyH4HN6CUdhGC7LLrC`) · **não** `CERTIFIED_EXACT_SHA` · seleção como `RELEASE_CANDIDATE` **não registrada antes do deploy** (lacuna L-053) | no SHA exato: lint 0 erros, type-check, suíte local 321/4716, CI 38488966914 e 38490205461 success, build Vercel (preview `dpl_J6K54QHL9xgiQe9CPPLyhu73DKbR` e produção). Desvios: npm ci, secret scan, arneses SQL e economia medidos em `e2f61d1` (lock/migrations idênticos); build local em `2352fe1` (`592cc876bdee9dee6705e75a7cc3ab2b88726ff0`), recusado em `6d1295b` pelo guarda INC-RR-01. Regra §3 item 7 (autorização para o SHA registrada no ledger antes) não cumprida: a autorização foi da missão | commit da L-053 |
| 28 | reconciliação de governança pós-release (L-053) | `THIS_CONTROL_PLANE_COMMIT` | — | — | `main` | control plane · só docs · **não** CERTIFIED · não é release novo | prova: `git diff 6d1295b..este -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'` vazio; SHA, CI e deployment registrados fora do commit | — |

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


## Atualização L-054 — candidato de navegação Founder Pass

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (commit que acrescenta esta seção; SHA exato no pacote externo founders-menu-20261014 antes de publicar). Base 415ac35; código 34e9159d3f181f2d3a12c57a02826db55d9c2686. Autorização do dono: inclusão e publicação do link no menu. Gate: CI e build do SHA final aprovados e navegação desktop/mobile. Validação de escopo de navegação; não é certificação integral da plataforma. Nenhuma migration ou operação financeira. Ver L-054 e evidência externa para publicação/readback, sem auto-referência impossível do SHA.


## Atualização L-055 — candidato A10 (fechamento final da auditoria externa A08/A09/A10/A17)

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (commit docs-only que acrescenta esta seção; filho de
`5c2306ee5074b56c59d49616139fa9af28c08e4e`). Base `2e3e3971f837c0131e32163e5831587979631d43` (produção
`dpl_2NrEVzr9U2FM3Y8fqAzAa4Y6237v`). Delta de produto: só `src/lib/bancada/tique.ts` (teto de símbolos por
mesa no tique de papel, A10) e dois arquivos de teste. Nenhuma migration, dependência, env ou flag;
nenhum caminho de dinheiro (papel adiante).

Gates no SHA exato `5c2306e` (tree `9e3c5fdefc915a70b9f5b06a62fe3f18eda2cdcd`, árvore limpa antes e
depois): `npm ci` 0 · lint 0 erros/145 avisos (igual à base) · type-check 0 · suíte 323/4724 **×2** ·
build 0 · `npm audit` 0 critical/25 high/40 moderate (= snapshot do release) e `audit-gate.mjs` OK com a
exceção R-03 · secret scan do diff limpo · CI 38555991893 success · preview
`dpl_5NupUqqu4xqjCyFP3ReeLMaq3WR2` READY no SHA, smoke 25/25 idêntico à produção.

Desvios (escopo, como a L-054): arneses SQL 01–15 **não** rodados (delta sem SQL); não é
`CERTIFIED_EXACT_SHA` da plataforma inteira. Delta de migrations contra produção: zero (repo e produção
em 0076). Autorização do dono: a missão "FINAL AUDIT CLOSURE A08/A09/A10/A17" (14/10) autoriza merge em
`main` e deploy se houver correção real necessária, gates e preview PASS. Condição antes do merge: CI
verde no SHA deste commit. Rollback de aplicação: `dpl_2NrEVzr9U2FM3Y8fqAzAa4Y6237v` (`2e3e397`).

Executado (14/10): `main` → `2c0c7c9` (fast-forward); produção `dpl_BhiwniCtsqX7iUTGM3mkhrXFzMSj` READY nesse SHA;
smoke 25/25; sem runtime errors. Detalhe e ressalvas: ledger L-055.


## Atualização L-056 — candidato A31/A32

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (commit docs-only que acrescenta esta seção; filho de
`d04767371ac1fccc975e3384dcbec7323076e14c`). Base `27bf8ebfcb712497755eb4b221cef78981e2ce06` (produção
`dpl_DT9haCV1YucfhoFJkxjRNnrqfDNT`). Rollback de aplicação: esse mesmo deployment). Delta de produto: chave de preço (`lib/precos/chave.ts`), rota `/api/prices`,
`useTokenPrices`, `useOrderWatcher`, `lib/api/geckoterminal.ts`, avaliação do portfólio
(`lib/portfolio/avaliacao.ts`, `PortfolioView`, `useTrackedHoldings`, `DashboardView`), resumo de carteira
do ZION e 3 textos ×4 locales. Nenhuma migration, dependência, env ou flag; A33 intocado.

Gates no SHA exato `d047673` (tree `16f0c14fe287810f531c323f19980c5ea6fc6a4a`, árvore limpa antes e depois):
`npm ci` 0 · lint 0 erros/145 avisos (= base) · type-check 0 · suítes específicas 20/236 · suíte 326/4753 **×2**
· build 0 · `npm audit` 0 critical/25 high/40 moderate (= snapshot) e `audit-gate.mjs` OK (R-03) · secret
scan do diff limpo · CI 38660768007 success · preview `dpl_GtYSYbRDH543sQJ9MVh4rSRnVvYE` READY no SHA:
smoke 25/25 igual à produção; `/api/prices` com preço para USDC/JUP/WIF Solana (produção: `null`);
páginas `/`, `/portfolio`, `/dashboard` em 1440 e 390 sem erro de página.

Desvios (escopo, como L-054/L-055): arneses SQL não rodados (delta sem SQL); não é `CERTIFIED_EXACT_SHA`
da plataforma inteira. Autorização do dono: missão "AUDIT CLOSURE ROUND — ESCOPO EXCLUSIVO: A31 + A32"
(14/10). Condição antes do merge: CI verde no SHA deste commit.

Executado (15/10): `main` → `6c66c13` (fast-forward); produção `dpl_2R8vsDxZNEDMyACbsR1TJ6npPwYB` READY nesse SHA;
smoke 25/25; preços SPL em produção; sem runtime errors. Detalhe: ledger L-056.


## Atualização L-057 — candidato A33

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (commit docs-only que acrescenta esta seção; filho de
`4ba669411173f561930f850daa5e0297cb355d94`). Base `5af0504304caa07225e0fd6989c5f4bb09cd7030` (produção
`dpl_EvGv264czgmaBRPuhaQvFDgMDKxQ`, que também é o rollback de aplicação). Delta de produto: DTO público
`ListQuote`/`paraListagem` em `lib/api/quote-types.ts`, a resposta de `mode=list` em `app/api/quote/route.ts` e o
tipo da lista em `useQuotes`, `SwapCard`, `QuoteComparison`, `CrossChainBanner`. `mode=quote`, o kill-switch e sua
política (`usuario_confirma`, falha aberta) inalterados. Nenhuma migration, dependência, env ou flag.

Gates no SHA exato `4ba6694` (tree `fc3c494263ffc9cf9591ebfe6ea52cbe730aa4f6`, árvore limpa antes e depois):
`npm ci` 0 · lint 0 erros/145 avisos (= base) · type-check 0 · suítes quote/swap/kill-switch/Pro/API 20/262 ·
suíte 327/4765 **×2** · build 0 · `npm audit` = snapshot e `audit-gate.mjs` OK (R-03) · secret scan limpo · CI
38715150493 success · preview `dpl_C1S7yqh5qcmVPUbYfJa5nwoq4fea` READY no SHA: smoke 25/25 igual à produção;
listas reais 0x (com e sem carteira) e Jupiter sem nada executável (produção: calldata real na lista 0x com
carteira); `mode=quote` 0x real devolve payload firme; fluxo do swap no navegador (1440/390) com cotação na tela.

Desvios (escopo, como L-054/55/56): arneses SQL não rodados (delta sem SQL); não é `CERTIFIED_EXACT_SHA` da
plataforma inteira. LiFi sem cotação em produção e preview (pré-existente, LIFI-UPSTREAM-01): o caso LiFi do A33
é provado pelo teste com a rota real. Autorização do dono: missão "FINAL EXTERNAL AUDIT CLOSURE — A33" (15/10).
Condição antes do merge: CI verde no SHA deste commit.

Executado (15/10): `main` → `d390880` (fast-forward); produção `dpl_3E65QrD59LprRzkkS7EMrMukEzRw` READY nesse SHA;
smoke 25/25; lista sem payload executável; sem runtime errors. Detalhe: ledger L-057.


## Atualização L-058 — candidato LIFI-UPSTREAM-01

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (commit docs-only que acrescenta esta seção; filho de
`2719e383910b8ec19c59a3d973eda18de3268090`). Base `835b5b0eb141e991a9bbd94159c6fb9534ff24c4`. Delta de produto:
`lib/api/lifi.ts` (taxa só com integrator cadastrado; sem `referrer`) e `app/api/quote/route.ts` (taxa e
divulgação das rotas LiFi). Nenhuma migration, dependência ou flag; env nova opcional `LIFI_INTEGRATOR`
(ausente = sem taxa LiFi). A33 intocado.

Gates no SHA exato `2719e38` (tree `c2452f834c55a2a4447392830da77bc995318ea4`, árvore limpa antes e depois):
`npm ci` 0 · lint 0 erros/145 avisos (= base) · type-check 0 · suítes quote/API/swap/bridge/tier 21/261 · suíte
328/4776 **×2** · build 0 · `audit-gate.mjs` OK (R-03) · secret scan limpo · CI 38722359434 success · preview
`dpl_7xNZXGofj3izUQb1pZqEza1c9DHu` READY no SHA: smoke 25/25; LiFi real com lista e firme em 3 pares, lista não
executável, taxa divulgada 0%.

Desvios (escopo): arneses SQL não rodados (delta sem SQL); não é `CERTIFIED_EXACT_SHA` da plataforma inteira.
Autorização do dono: missão LIFI-UPSTREAM-01 + escolha "Corrigir já, sem taxa" (15/10). Condição antes do
merge: CI verde no SHA deste commit.

Executado (15/10): `main` → `a19d2c1` (fast-forward); produção `dpl_DCsP5Gbz6kyu9Y1RubfoZ3t9ZN3D` READY nesse SHA;
LiFi cotando; smoke 25/25; sem runtime errors. Detalhe: ledger L-058.


## Atualização L-059 — candidato detecção da taxa LI.FI

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (docs-only, filho de `2b8118d485990342418b4632d93d4bb296c564ca`).
Base `00c9eece2c92a99a03ef10482909aa945978ef42`. Delta: `lib/api/lifi.ts` (`taxaDoIntegradorNaCotacao`),
`app/api/quote/route.ts` (`taxaAceita` da LI.FI). Gates, CI 38825991656 e preview `dpl_4LQyCmZ7rdyaSLqwHenMpwVtDtfV`
em PASS (ledger L-059). Desvios: escopo (sem SQL). Autorização: missão LIFI-UPSTREAM-01 do dono (15/10).
Condição antes do merge: CI verde no SHA deste commit.


## Atualização L-060 — candidato proteção da configuração LI.FI

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (docs-only, filho de `12b898f074cf5c2362f4c0327b964773dd0bd70e`).
Base `7072e60b0923fceac81d8a2fcffbb98f7b4ab48d`. Delta: `lib/api/lifi.ts` (validação do integrator, refazer sem key
em 401) e `app/api/quote/route.ts` (avisos). Gates, CI 38875298148 e preview `dpl_4SMypHFBeLHB6j6NUBzMNBhSjndW` em
PASS (ledger L-060). Desvios: escopo (sem SQL). Autorização: missão LIFI-UPSTREAM-01 do dono. Condição antes do
merge: CI verde no SHA deste commit; depois do deploy, a produção tem de seguir cobrando 100 bps no LI.FI.


## Atualização L-061 — candidato taxa na Solana

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (docs-only, filho de `5f42b444849c574397d7435016d8d96cf310ee06`).
Base `166fd5be9c28fb2ffaaffd9413bf61c40f492698`. Delta: taxa da plataforma na Solana (ledger L-061). Gates, CI
38893612041 e preview `dpl_5CSfJRnf6kQ5FJzUWbzgUJgka5B9` em PASS. Desvios: escopo (sem SQL). Autorização: decisões
do dono de 16/10 (cobrar na Solana; mesma escada; Metis; wSOL). Condição antes do merge: CI verde neste SHA.

## Atualização L-062A — candidato chave da Jupiter

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (docs-only, filho de `06862d96582c8595aaaceff3d0fd25a2a9c69e9d`).
CERTIFIED_FEATURE_SHA = `37666e9ecc5b5ff71d602c5c8854d5d9fab5c657` (tree `edd57e1ed27097ca4bf07c49e1b69a579063482e`),
base `06bff5c57bb31b5ad0076d6a2f1d936dfe23adc9`. Delta: Jupiter autenticada com `JUPITER_API_KEY` (ledger L-062A) —
`lib/api/jupiter.ts`, `api/quote/route.ts`, `lib/admin/deps.ts`, 2 testes, docs; nada de tiers, contas de taxa,
LI.FI, EVM, CEX, DCA, Autopilot, Founder; sem SQL; Swap V2 fora. Gates, CI 38932931702 e preview
`dpl_42NsuWMM4skUAjXpBHcta6XwiCRi` em PASS. Autorização: dono, 16/10 ("AUTORIZO PRODUÇÃO DA L-062A").
Condição antes do merge: CI verde neste SHA. Stop: 401/403, 429 persistente, `lite-api` inesperada, sem
`x-api-key`, vazamento, regressão Solana, divergência de taxa.
Resultado: `main` → `a738e7c` (fast-forward), produção `dpl_3VqE1Ex1RGta87E7gVHUffX1kT82` READY; smoke só-cotação PASS
(Jupiter autenticada, 0 × 401/403/429, 100 bps). Rollback: `06bff5c`.

## Atualização L-062B — candidato Jupiter Swap V2 `/build`

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (docs-only, filho de `2fcf9f2350f9bd610f0f924291d9f11dde3e67e7`).
CERTIFIED_FEATURE_SHA = `6722b5c5b2a33ab920c2d54f925f61015f546b4a` (tree `06e739c444e9cd053fbdb28a1c2bdc2682dae7db`),
base `2a0632616dc5883805aff44ac577dde0e39e9337`. Delta: Jupiter na Swap V2 Router `/build`, transação montada no
servidor (ledger L-062B) — `lib/api/jupiter.ts`, `api/quote/route.ts`, `lib/admin/deps.ts`, `admin/api/swap-guard`,
`lib/solana/{conta-de-taxa,rpc-servidor}.ts`, testes, fixture, docs; nada de tiers, contas de taxa, LI.FI, EVM, CEX,
DCA, Autopilot, Founder; sem SQL. Gates, CI 38952568486 e preview `dpl_Dp1VzZxEUhyTHVghX6iXgqpFDnyo` em PASS.
Autorização: dono, 16/10 ("autorizo a produção da L-062B"). Condição antes do merge: CI verde neste SHA. Stop:
401/403, 429 persistente, sem `x-api-key`, vazamento, transação não-v0 ou recusada pelo guard, taxa não confirmada
na instrução, regressão Solana. Rollback: `2a06326` (`/swap/v1` autenticada).

Resultado L-062B (16/10): `main` → `a675ddb`, produção `dpl_HcK5h3H8LYxgd6qqamhsXvFMrUoZ` — **STOP** (transação de
65 contas em rota longa) e **rollback** para `dpl_AcHcoSLXYEeWB1qvMQE9NXqpimrn` (`2a06326`). `a675ddb` deixa de ser
candidato. Correção: CERTIFIED_FEATURE_SHA = `d86c963d65431ea3e99458d4bee2512d08b6d7e7` (tree
`3fbf5d6436a41f4eb54119d1b09345fcd898abec`), CI 38976037886, preview `dpl_Ef1BQyPLcNKA81ydYCn31WLNRHAi` PASS. **Não
marcado RELEASE_CANDIDATE** — nova autorização do dono necessária.

## Atualização L-062B — candidato correção (`/build` dentro dos limites da rede)

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (docs-only, filho de `551454977f2d8a0b853a36366d82ccf5b3b4d95b`).
CERTIFIED_FEATURE_SHA = `d86c963d65431ea3e99458d4bee2512d08b6d7e7` (tree `3fbf5d6436a41f4eb54119d1b09345fcd898abec`),
base `a675ddb` (a `main`; produção em `2a06326` por rollback). Delta sobre `a675ddb`: transação medida (≤ 64 contas,
≤ 1232 bytes) + nova tentativa com `maxAccounts=40` (`lib/api/jupiter.ts`, testes, docs). CI 38976037886, preview
`dpl_Ef1BQyPLcNKA81ydYCn31WLNRHAi` PASS. Autorização: dono, 16/10 ("sim autorizo produção"). Condição antes do merge:
CI verde neste SHA. Promoção explícita (a Vercel está em rollback). Stop: transação > 64 contas ou > 1232 bytes,
simulação recusada por limite, 401/403, 429 persistente, taxa não confirmada, regressão Solana. Rollback:
`dpl_AcHcoSLXYEeWB1qvMQE9NXqpimrn`.
Resultado: `main` → `fd4172f` (fast-forward), produção `dpl_HcXiT1J7SwzXYNS87oRgq33UQeRc` promovida; smoke só-cotação
PASS (rotas longas dentro dos limites, nova tentativa exercitada, 0 × 401/403/429, 100 bps). Rollback:
`dpl_AcHcoSLXYEeWB1qvMQE9NXqpimrn`.

## Atualização L-065 — candidato RECUPERAÇÃO INTEGRADA (W1 + W3 + W3-C + W3-D + W4 + dependências)

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (docs-only, filho de `b61283d`).
CODE SHA = `b61283d0db1df1ed2edbb7b9243c9d5e20d70f71` (tree `5e99c5a40c8393e6e429988184185e3e5a6c3790`), base `main` = `986ae75`.
Branch `recuperacao/integrada-20261021` = `fix/w3-transmissao-solana` (`33bbcfb`, contém W1 `f5319e9`) + `04ef49b` (deps)
+ `9ddc3e0` (W3-C) + `e8601fa` (W3-D) + `1b9055b`/`b61283d` (W4). Migrations novas: 0077, 0078 (aditivas; aplicar ANTES do
deploy; o código novo lê as colunas/RPCs novas). Gates locais em `b61283d`: tipos · lint 0 erros · suíte 341/5059 ·
build · audit-gate OK (sem exceção nova) · 0 credencial e 0 Jito no bundle · SQL T24/T24b/T25 + 02/14/17 em PostgreSQL
17.6.1.127 descartável · E2E W4 local 12/12. Autorização: dono, MISSÃO MESTRE de 21/10 (publicação integrada
autorizada; operação financeira só com assinatura do dono). Rollback de código: `dpl_7ZLUX4fN3nmNHKoetVxdr7fTrLUg`
(⚠️ religa a Jito no navegador — só com `disable_swap` ligado) ou nova build do candidato anterior com
`NEXT_PUBLIC_SOLANA_JITO=off`. Rollback de banco: não necessário (colunas/tabela novas são ignoradas pelo código antigo).

## Atualização PHANTOM-LIGHTHOUSE-V2 — candidato swap Solana com a Phantom + Next.js 16.4.3 (25/10/2026)

RELEASE_CANDIDATE = THIS_RELEASE_CANDIDATE_COMMIT (docs-only, filho de `4110720d3c6e9c9a429868c4a0e2ebcf868667a6`).
CERTIFIED_FEATURE_SHA = `31920d73e93194113a68ac021bbd370b05621cee` (tree `e317825d6528c23144dd7e7314b4a55bde6957c4`),
base `cc79fc7` (= `main` = produção, `dpl_3YkUirQdfetu5cSCoUqZX2kYaAkR`). Delta: decodificador completo do Lighthouse e
extensão restrita da cotação (`lib/solana/lighthouse.ts`, `vinculo.ts`, `transmissao.ts`), diagnóstico por regra,
"uma cotação, um swap" (`em-voo.ts`, rota `transmitir`), tela (`ExecuteSwap.tsx`: uma execução por vez, cotação Jupiter
> 30 s renovada), folga para a carteira no montador (`lib/api/jupiter.ts`), i18n 4 locales, `next` 16.4.3 (fecha 2
alertas CRÍTICOS de RCE), exceção R-04 do `npm audit` (decisão do dono) — ledger `PHANTOM-LIGHTHOUSE-V2-20261024`.
Regras §3: (1) descende de `0d21874` ✓; (2) RECERT(C1b)=PASS no SHA exato, evidência com `MANIFEST.sha256`
`33e1ad3d…a243a9` ✓ (desvios: arneses SQL e smoke — ledger); (3) CI 40184848534 success no SHA ✓; (4) migrations no
delta `cc79fc7..` = **nenhuma** (medido no repo; banco de produção não lido nesta fase); (5) nenhum `OPEN_BLOCKER` de
`AUDIT-RECONCILIATION.md` §5 no escopo (os abertos são Early Access/autopilot) ✓; (6) gates de exposição pública
inalterados ✓; (7) autorização do dono: 25/10/2026, nesta conversa — "Autorizo produção (Recomendado)" ✓.
Condição antes do merge: CI verde no SHA deste commit. Merge: `main` avança por fast-forward (SHAs preservados).
Stop: build/deploy com erro, runtime errors novos, `/api/quote` Solana quebrada, recusa inesperada em
`/api/solana/transmitir` (o `detalhe` diz a regra), regressão EVM/LI.FI. Rollback: `dpl_3YkUirQdfetu5cSCoUqZX2kYaAkR`
(`cc79fc7`; ⚠️ volta o Next 16.3.8 com os alertas críticos).

Resultado (25/10): `main` → `0430644` (fast-forward, `cc79fc7..0430644`), produção `dpl_DTzQ9Xy56yZroT1N5XBR8WuW3cAJ`
READY, aliases `swap-z-app.vercel.app` no deploy novo; smoke só-cotação PASS (`/api/quote` Solana SOL→USDC 200, rota
Jupiter, taxa 100 bps; home 200); runtime errors: nenhum nos 30 min seguintes. Pendente: primeiro swap real assinado
pelo dono na Phantom. Rollback: `dpl_3YkUirQdfetu5cSCoUqZX2kYaAkR`.
