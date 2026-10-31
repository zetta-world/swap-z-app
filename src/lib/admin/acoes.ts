/**
 * REGISTRO DE AÇÕES DO ADMIN — uma linha por handler de `src/app/admin/api/**` (R2).
 *
 * GERADO da matriz (`docs/ADMIN-API-AUTHORIZATION-MATRIX.md`, 79 linhas). Cada
 * handler chama `autorizarAdmin("<id>")` com o id da SUA linha; `portao`/
 * `completude` (teste) exige isso por método exportado e confere que rota +
 * método do id batem com o arquivo. Rota nova sem linha aqui = teste vermelho.
 *
 *   · `permissoes` — alternativas ("a | b" da matriz: depende do corpo; a
 *     entrada exige ao menos uma, o handler pode exigir a específica);
 *   · `mfa` — `mfa_login` (MFA no login da sessão) ou `step_up` (recente);
 *   · `auditoria` — `duravel_fail_closed` = sem intenção gravada não executa
 *     (ADM-005, `auditoria-duravel.ts`).
 *
 * Módulo PURO.
 */
import type { Permissao } from "./rbac";

export type Risco = "read" | "write" | "sensitive_write" | "financial" | "identity";
export type NivelMfa = "mfa_login" | "step_up";
export type ExigenciaAuditoria = "nao" | "acesso" | "telemetria" | "duravel_fail_closed";

export interface Acao {
  metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  rota: string;
  permissoes: readonly Permissao[];
  risco: Risco;
  mfa: NivelMfa;
  auditoria: ExigenciaAuditoria;
  dados: string;
  /** Ids da matriz quando o handler cobre mais de uma ação (decidida pelo corpo). */
  subacoes?: readonly string[];
}

export const ACOES = {
  "identity.admins.list": { metodo: "GET", rota: "/admin/api/admins", permissoes: ["identity.read"], risco: "read", mfa: "mfa_login", auditoria: "acesso", dados: "identity" },
  "identity.admins.write": { metodo: "POST", rota: "/admin/api/admins", permissoes: ["identity.invite", "identity.revoke"], risco: "identity", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "identity", subacoes: ["identity.admins.grant", "identity.admins.revoke"] },
  "ai.circuit.read": { metodo: "GET", rota: "/admin/api/ai-circuit", permissoes: ["ai.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "operational" },
  "ai.circuit.reset": { metodo: "POST", rota: "/admin/api/ai-circuit", permissoes: ["ai.control"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "operational" },
  "ops.alert.test": { metodo: "POST", rota: "/admin/api/alert-test", permissoes: ["ops.control"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "operational" },
  "ops.alerts.read": { metodo: "GET", rota: "/admin/api/alerts", permissoes: ["ops.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "operational" },
  "analytics.events.read": { metodo: "GET", rota: "/admin/api/analytics", permissoes: ["analytics.read"], risco: "read", mfa: "mfa_login", auditoria: "acesso", dados: "pii_pseudonimo" },
  "lab.flywheel.read": { metodo: "GET", rota: "/admin/api/aprendizado", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "lab" },
  "lab.arbiter.cohort": { metodo: "GET", rota: "/admin/api/arbiter-cohort", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.arbiter.median": { metodo: "POST", rota: "/admin/api/arbiter-median", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "audit.log.read": { metodo: "GET", rota: "/admin/api/audit", permissoes: ["audit.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "security" },
  "security.bench.run": { metodo: "POST", rota: "/admin/api/audit-bench", permissoes: ["security.scan.run"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "security" },
  "trading.automation.read": { metodo: "GET", rota: "/admin/api/autopilot-liberacao", permissoes: ["ops.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial" },
  "trading.automation.write": { metodo: "POST", rota: "/admin/api/autopilot-liberacao", permissoes: ["trading.automation.release"], risco: "financial", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "financial", subacoes: ["trading.automation.release", "trading.pilot.authorize", "trading.pilot.remove"] },
  "lab.backtest.read": { metodo: "GET", rota: "/admin/api/backtest", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "lab" },
  "lab.calibration.run": { metodo: "POST", rota: "/admin/api/calibration", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.celeiro.read": { metodo: "GET", rota: "/admin/api/celeiro", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "simulated" },
  "lab.study.combinacao": { metodo: "POST", rota: "/admin/api/combinacao", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "exec.summary.read": { metodo: "GET", rota: "/admin/api/command", permissoes: ["admin.view"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial_agg" },
  "lab.census.depth": { metodo: "POST", rota: "/admin/api/depth-census", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.slippage.read": { metodo: "GET", rota: "/admin/api/derrapagem", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "lab" },
  "lab.discarded.read": { metodo: "GET", rota: "/admin/api/descartadas", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "lab" },
  "lab.study.dexcex": { metodo: "POST", rota: "/admin/api/dex-cex", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "users.early_access.read": { metodo: "GET", rota: "/admin/api/early-access", permissoes: ["users.support.read"], risco: "read", mfa: "mfa_login", auditoria: "acesso", dados: "pii" },
  "users.early_access.export": { metodo: "GET", rota: "/admin/api/early-access/export", permissoes: ["users.export"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "pii" },
  "users.early_access.transition": { metodo: "POST", rota: "/admin/api/early-access/transition", permissoes: ["users.access.manage"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "pii" },
  "finance.summary.read": { metodo: "GET", rota: "/admin/api/finance", permissoes: ["finance.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial" },
  "lab.study.funding": { metodo: "POST", rota: "/admin/api/funding", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "analytics.growth.read": { metodo: "GET", rota: "/admin/api/growth", permissoes: ["analytics.read"], risco: "read", mfa: "mfa_login", auditoria: "acesso", dados: "pii_pseudonimo" },
  "ops.health.read": { metodo: "GET", rota: "/admin/api/health", permissoes: ["ops.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "operational" },
  "security.killswitch.read": { metodo: "GET", rota: "/admin/api/killswitch", permissoes: ["security.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "security" },
  "security.killswitch.set": { metodo: "POST", rota: "/admin/api/killswitch", permissoes: ["security.killswitch.write"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "security" },
  "lab.registry.read": { metodo: "GET", rota: "/admin/api/lab", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "lab" },
  "lab.registry.sync": { metodo: "POST", rota: "/admin/api/lab", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.runs.last": { metodo: "GET", rota: "/admin/api/lab/ultima", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "lab" },
  "ops.launch_gate.read": { metodo: "GET", rota: "/admin/api/launch-gate", permissoes: ["ops.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "simulated" },
  "finance.ledger.read": { metodo: "GET", rota: "/admin/api/ledger", permissoes: ["finance.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial" },
  "finance.ledger.export": { metodo: "GET", rota: "/admin/api/ledger/export", permissoes: ["finance.export"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "financial" },
  "lab.study.liquidez": { metodo: "POST", rota: "/admin/api/liquidez", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "security.logs.read": { metodo: "GET", rota: "/admin/api/logs", permissoes: ["security.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "security" },
  "lab.maker.run": { metodo: "POST", rota: "/admin/api/maker-backtest", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "finance.margin.read": { metodo: "GET", rota: "/admin/api/margin", permissoes: ["finance.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial" },
  "finance.margin.set": { metodo: "POST", rota: "/admin/api/margin", permissoes: ["finance.config.write"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "financial" },
  "exec.mural.read": { metodo: "GET", rota: "/admin/api/mural", permissoes: ["admin.view"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial_agg" },
  "trading.positions.read": { metodo: "GET", rota: "/admin/api/operations", permissoes: ["ops.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial" },
  "paper.desks.read": { metodo: "GET", rota: "/admin/api/paper", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "simulated" },
  "paper.recap.plan": { metodo: "GET", rota: "/admin/api/paper-recap", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "simulated" },
  "paper.recap.execute": { metodo: "POST", rota: "/admin/api/paper-recap", permissoes: ["paper.manage"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "simulated" },
  "paper.repair.plan": { metodo: "GET", rota: "/admin/api/paper-repair", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "simulated" },
  "paper.repair.execute": { metodo: "POST", rota: "/admin/api/paper-repair", permissoes: ["paper.manage"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "simulated" },
  "paper.reset.plan": { metodo: "GET", rota: "/admin/api/paper-reset", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "simulated" },
  "paper.reset.execute": { metodo: "POST", rota: "/admin/api/paper-reset", permissoes: ["paper.manage"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "simulated" },
  "lab.census.perp": { metodo: "POST", rota: "/admin/api/perp-census", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.playbook.run": { metodo: "POST", rota: "/admin/api/playbook-backtest", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.pools.measure": { metodo: "POST", rota: "/admin/api/pro-piscinas", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.ragnarok.read": { metodo: "GET", rota: "/admin/api/ragnarok", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "simulated" },
  "finance.revenue.read": { metodo: "GET", rota: "/admin/api/receita", permissoes: ["finance.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial" },
  "lab.study.rendimento": { metodo: "POST", rota: "/admin/api/rendimento", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.study.rotacao": { metodo: "POST", rota: "/admin/api/rotacao-grade", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "analytics.stats.read": { metodo: "GET", rota: "/admin/api/stats", permissoes: ["analytics.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial_agg" },
  "security.swap_targets.read": { metodo: "GET", rota: "/admin/api/swap-allowlist", permissoes: ["security.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "security" },
  "security.swap_targets.probe": { metodo: "POST", rota: "/admin/api/swap-allowlist", permissoes: ["security.probe.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "security" },
  "security.swap_guard.read": { metodo: "GET", rota: "/admin/api/swap-guard", permissoes: ["security.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "security" },
  "security.swap_guard.probe": { metodo: "POST", rota: "/admin/api/swap-guard", permissoes: ["security.probe.run"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "security" },
  "lab.cex_fee.read": { metodo: "GET", rota: "/admin/api/taxa-cex", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "lab" },
  "lab.study.tendencia": { metodo: "POST", rota: "/admin/api/tendencia", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "users.tier.read": { metodo: "GET", rota: "/admin/api/tier", permissoes: ["users.support.read"], risco: "read", mfa: "mfa_login", auditoria: "acesso", dados: "pii" },
  "users.tier.write": { metodo: "POST", rota: "/admin/api/tier", permissoes: ["tiers.manage"], risco: "identity", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "financial", subacoes: ["users.tier.grant", "users.tier.revoke"] },
  "finance.tiers.read": { metodo: "GET", rota: "/admin/api/tier-hub", permissoes: ["finance.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "financial_agg" },
  "lab.tournament.read": { metodo: "GET", rota: "/admin/api/tournament", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "simulated" },
  "analytics.traffic.read": { metodo: "GET", rota: "/admin/api/traffic", permissoes: ["analytics.read"], risco: "read", mfa: "mfa_login", auditoria: "acesso", dados: "pii_pseudonimo" },
  "agents.mailbox.read": { metodo: "GET", rota: "/admin/api/ulfhednar", permissoes: ["agents.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "operational" },
  "agents.mailbox.write": { metodo: "POST", rota: "/admin/api/ulfhednar", permissoes: ["agents.instruct"], risco: "sensitive_write", mfa: "step_up", auditoria: "duravel_fail_closed", dados: "operational" },
  "users.profile.read": { metodo: "GET", rota: "/admin/api/users", permissoes: ["users.support.read"], risco: "read", mfa: "mfa_login", auditoria: "acesso", dados: "pii" },
  "lab.study.variancia": { metodo: "POST", rota: "/admin/api/variancia", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.venue.probe": { metodo: "POST", rota: "/admin/api/venue-probe", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "lab.venue.truth": { metodo: "GET", rota: "/admin/api/venue-truth", permissoes: ["lab.read"], risco: "read", mfa: "mfa_login", auditoria: "nao", dados: "lab" },
  "lab.benchmarks.run": { metodo: "POST", rota: "/admin/api/what-worked", permissoes: ["lab.run"], risco: "write", mfa: "mfa_login", auditoria: "telemetria", dados: "lab" },
  "identity.env_admins.read": { metodo: "GET", rota: "/admin/api/whitelist", permissoes: ["identity.read"], risco: "read", mfa: "mfa_login", auditoria: "acesso", dados: "identity" },
} as const satisfies Record<string, Acao>;

export type AcaoId = keyof typeof ACOES;

export function acaoDe(id: AcaoId): Acao {
  return ACOES[id];
}
