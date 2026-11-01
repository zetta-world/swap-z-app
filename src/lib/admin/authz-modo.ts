import type { FonteLegada } from "@/lib/admin/require";

/**
 * MODO DE AUTENTICAÇÃO DO ADMIN (`ADMIN_AUTH_MODE`) — leitura PURA, sem servidor (a borda e o login
 * corporativo também leem). Regras e significado de cada modo: cabeçalho de `authz.ts`.
 */
export type ModoAuth = "legacy" | "dual" | "corp";
const MODOS: readonly ModoAuth[] = ["legacy", "dual", "corp"];
const FONTES: readonly FonteLegada[] = ["env", "panel", "tier"];

export type LeituraModo = { ok: true; modo: ModoAuth } | { ok: false; bruto: string };

export function lerModoAuth(env: Record<string, string | undefined> = process.env): LeituraModo {
  const bruto = env.ADMIN_AUTH_MODE;
  if (bruto == null || bruto.trim() === "") return { ok: true, modo: "legacy" };
  const v = bruto.trim().toLowerCase() as ModoAuth;
  return MODOS.includes(v) ? { ok: true, modo: v } : { ok: false, bruto: bruto.slice(0, 40) };
}

/** Fontes legadas aceitas em `dual`. Valor ilegível = nenhuma (fecha, não abre). */
export function fontesLegadasPermitidas(env: Record<string, string | undefined> = process.env): Set<FonteLegada> {
  const bruto = env.ADMIN_LEGACY_SOURCES;
  if (bruto == null || bruto.trim() === "") return new Set(FONTES);
  const pedidas = bruto.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (pedidas.some((s) => !FONTES.includes(s as FonteLegada))) return new Set();
  return new Set(pedidas as FonteLegada[]);
}
