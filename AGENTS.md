# AGENTS.md — Z-SWAP

**READ `docs/START-HERE.md` BEFORE ANY WORK.**

This file is for any automated agent or assistant, whatever the vendor. It
repeats only the invariants. The method is in `docs/AI-OPERATING-RULES.md`,
and which document to trust is in `docs/DOCUMENT-AUTHORITY.md`.

## Invariants

1. **Verify location first:** `pwd`, `git branch --show-current`,
   `git rev-parse HEAD`, `git rev-parse HEAD^{tree}`, `git status --short`.
   HEAD is **not** a fixed value: control-plane commits (`CLAUDE.md`,
   `AGENTS.md`, `docs/**`) legitimately move it. Identity is valid when the
   branch is the expected one, `PRODUCT_BASE_SHA`
   (`9f2ddcbe45f9f93c9a33c331e31e32c45d410019`) is an ancestor of HEAD, the
   tree matches the state the ledger records, every commit after the base is
   explained in the ledger / `RELEASE-CHAIN.md`, and there is no unauthorized
   **product** delta:
   `git diff --stat "$PRODUCT_BASE_SHA"..HEAD -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'`.
   **Current state (L-053, post-release reconciliation, 14/10/2026):** the production release of 13–14/10
   shipped release code SHA `6d1295bf43f4967b7e15498f1496c132fc09fa7a` (`main` fast-forwarded from `25fc4b0`;
   original production deployment `dpl_A5PDW653HtRyH4HN6CUdhGC7LLrC`; hosted DB migrations 0059–0076 applied,
   head `20261014002550`). R-01 (Vercel) and R-02 (`CEX_RECOVERY_HMAC_KEY` present by name) are CLOSED. `main`
   now carries a docs-only control-plane commit (L-053) on top of that code; **no** new release candidate is in
   progress. Autopilot and real DCA remain DISABLED. The working tree is expected CLEAN. Details, evidence and
   open findings: `docs/START-HERE.md` §2–§10 and `docs/CURRENT-STATE.md`. On mismatch,
   **STOP** and report. Do not "fix" it with checkout, reset, stash
   or rebase.
2. **GitHub-dependent task?** Run `git fetch origin --tags --prune` first.
   Measure local refs and `origin/*` separately.
3. **Separate facts:** local branch ≠ GitHub ≠ Acer lab runtime ≠ production.
4. **Document authority:** `PLANO-*.md` and `AUDITORIA-*.md` are **not**
   current state unless `docs/DOCUMENT-AUTHORITY.md` says so. A "🟢" inside a
   plan is not proof.
5. **Forbidden without explicit owner authorization:** push, merge, deploy,
   production DB (read or write), hosted Supabase, real credentials, real
   trades, public exposure, sudo, and restarting lab services.
6. **Release policy:** nothing goes to production automatically. Deploy
   requires all four:
   1. an explicit SHA;
   2. the SHA marked `RELEASE_CANDIDATE` in `docs/RELEASE-CHAIN.md`;
   3. its certification PASS;
   4. explicit owner authorization.

   **Never deploy a worktree or branch by name.**
7. **Never** edit an existing migration, delete branches or worktrees, delete
   or rename historical docs, or turn a FAIL into a PASS by retrying.
8. **Phase lifecycle** (the exact SHA only exists after the commit):
   1. isolated branch/worktree;
   2. base measured and recorded;
   3. plan;
   4. implementation;
   5. audit;
   6. fixes;
   7. pre-commit validation;
   8. **candidate commit C1**;
   9. **full recertification at the exact SHA of C1**;
   10. **docs-only attestation commit C2** (only if C1 PASSED): records
       `CERTIFIED_FEATURE_SHA=<C1>`, `RECERT_RESULT=PASS` and the evidence;
       must prove `git diff <C1>..<C2> -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'`
       is empty. C2 is **never** called CERTIFIED and cannot be deployed
       unless itself recertified as `RELEASE_CANDIDATE`;
   11. next phase, starting from C2.

   `CERTIFIED_FEATURE_SHA` (C1) is not necessarily `CONTROL_PLANE_HEAD` (C2).
   If recertification of C1 fails: no PASS attestation, no retry-to-pass, no
   reclassification; record the FAIL, fix, create **C1b** and recertify the
   **whole** C1b. Details: `docs/AI-OPERATING-RULES.md` §5.
9. **Terminology:** "certified" must always be one of
   `CERTIFIED_EXACT_SHA` (exact-SHA recert PASS — today `0d21874` runtime and
   `f1b4ec1` Early Access Phase 1, `53cd85a` Early Access Phase 2),
   `CERTIFIED_RUNTIME_ANCESTOR` (an ancestor was recertified, known delta) or
   `HISTORICAL_CERTIFICATION_LEGACY` (called certified before revision 3,
   no exact-SHA proof). Audit counts say `KNOWN_MISSING_CORRECTIONS` and
   `UNKNOWN_FINDINGS` separately.
10. **Agent mural:** do **not** run `scripts/mural.mjs` automatically — it
    uses hosted Supabase with a real credential. Only with explicit owner
    authorization for hosted Supabase; otherwise coordinate through the
    ledger, the docs or the current chat.

## Where to write

| what | where |
|---|---|
| state changed | `docs/CURRENT-STATE.md` (replace) and `docs/LAUNCH-READINESS-LEDGER.md` (append) |
| finding status | `docs/AUDIT-RECONCILIATION.md` §5 (append) |
| new/obsolete doc | `docs/DOCUMENT-AUTHORITY.md` |
| raw evidence | outside the repo: `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/{reports,evidence}` |

Code map and repo conventions: `CLAUDE.md` (from "Z-SWAP — mapa do repo" on).
