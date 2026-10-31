/**
 * Cliente de `/admin/api/killswitch` para os painéis (ADM-004).
 *
 * ⚠️ O ESTADO NASCE DESCONHECIDO. Os painéis começavam com tudo `false` e uma
 * leitura que falhava deixava esse `false` na tela — OFF (kill-switches) ou ON
 * (gates) sem ninguém ter lido nada, e um clique virava `!undefined` = ligar.
 * Aqui: só `on`/`off` lidos com sucesso habilitam o botão, e o próximo valor sai
 * do estado lido, nunca de um default.
 */
import type { ChaveDeInterruptor } from "@/lib/admin/gate-keys";

export type EstadoTri = "on" | "off" | "invalido" | "desconhecido";

export interface InterruptorLido {
  chave:        ChaveDeInterruptor;
  estado:       EstadoTri;
  persistido:   string | null;
  atualizadoEm: string | null;
}

export type LeituraCliente =
  | { ok: true; estados: Record<string, InterruptorLido> }
  | { ok: false; porque: string };

export async function lerInterruptoresCliente(): Promise<LeituraCliente> {
  try {
    const res = await fetch("/admin/api/killswitch", { cache: "no-store" });
    const json = await res.json().catch(() => null) as
      { interruptores?: Record<string, InterruptorLido>; porque?: string; error?: string } | null;
    if (!res.ok || !json?.interruptores) {
      return { ok: false, porque: json?.porque ?? json?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, estados: json.interruptores };
  } catch (e) {
    return { ok: false, porque: String(e) };
  }
}

/** Botão só com estado CONHECIDO. */
export const conhecido = (e: EstadoTri | undefined): e is "on" | "off" => e === "on" || e === "off";

export type GravacaoCliente =
  | { ok: true }
  | { ok: false; conflito: boolean; porque: string };

/** Grava com compare-and-set: `esperado` é o que a tela mostrava. 409 = alguém mudou antes. */
export async function gravarInterruptor(chave: string, enabled: boolean, esperado: boolean): Promise<GravacaoCliente> {
  try {
    const res = await fetch("/admin/api/killswitch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: chave, enabled, esperado, idem: globalThis.crypto.randomUUID() }),
    });
    const json = await res.json().catch(() => null) as { error?: string; porque?: string; auditoriaPorque?: string } | null;
    if (res.ok) return { ok: true };
    return { ok: false, conflito: res.status === 409, porque: json?.porque ?? json?.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, conflito: false, porque: String(e) };
  }
}

/** Rótulo honesto do botão. */
export function rotuloDoEstado(e: EstadoTri | undefined): string {
  if (e === "on") return "ON";
  if (e === "off") return "OFF";
  if (e === "invalido") return "VALOR INVÁLIDO";
  return "DESCONHECIDO";
}
