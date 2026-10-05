/**
 * CACHE EXATO DE RESPOSTA DO ZION — só para varreduras PÚBLICAS (CE-07).
 *
 * ⚠️⚠️ O QUE ELE É, E O QUE ELE NÃO É.
 *
 * É: mesma entrada → mesma saída. A chave é o hash do MODELO + SISTEMA + MENSAGEM
 * DO USUÁRIO inteiros, byte a byte. Duas requisições só compartilham resposta se o
 * prompt que iria para o modelo é IDÊNTICO — então nenhuma pergunta recebe a
 * resposta de outra pergunta. Não é cache semântico ("parecido").
 *
 * Não é: cache de nada que tenha dado de usuário. Só entram as varreduras
 * automáticas (sem par escolhido, sem carteira, sem histórico, sem saldo, sem
 * posições, fora do autopilot), cujo payload é feito só de mercado público
 * (pools em alta, pares quentes, indicadores dos majors). Ver `podeUsarCache`.
 *
 * ⚠️ TTL de 60 s e EM MEMÓRIA (por instância). As fontes do payload já têm
 * revalidação de ~60 s; dentro dessa janela duas varreduras simultâneas montam o
 * mesmo prompt e pagariam os mesmos tokens duas vezes. Em memória porque o ganho
 * é na concorrência (instâncias quentes atendem várias requisições) e porque
 * gravar respostas no banco custaria escrita por análise — mais caro que o que
 * economiza enquanto o tráfego não existir. Perder o cache (instância nova) só
 * significa pagar a chamada, como antes.
 *
 * ⚠️ Só guarda resposta COMPLETA: erro, timeout ou cliente que desconectou no
 * meio não entram (ver a rota).
 */
import { createHash } from "node:crypto";
import type { ZionOp } from "@/lib/zion/mode-prompts";

export const TTL_DO_CACHE_MS = 60_000;
const MAX_ENTRADAS = 64;
const MAX_BYTES = 2_000_000;

/** Os modos cuja varredura AUTOMÁTICA é feita só de dado público de mercado. */
const MODOS_DE_VARREDURA: ReadonlySet<ZionOp> = new Set<ZionOp>(["trading", "sniper", "arbitrage"]);

export interface ArgsDoCache {
  op: ZionOp;
  fromAddr: string;
  toAddr: string;
  walletJson: string;
  txHistorySummary: string;
  balanceContext: string;
  positionsContext: string;
  autopilotMode: boolean;
}

/** `true` só quando NADA do pedido é do usuário — ver o cabeçalho. */
export function podeUsarCache(a: ArgsDoCache): boolean {
  return MODOS_DE_VARREDURA.has(a.op)
    && !a.fromAddr && !a.toAddr
    && !a.walletJson && !a.txHistorySummary
    && !a.balanceContext && !a.positionsContext
    && !a.autopilotMode;
}

export function chaveDeResposta(model: string, system: string, user: string): string {
  return createHash("sha256").update(model).update("\u0000").update(system).update("\u0000").update(user).digest("hex");
}

interface Entrada { texto: string; expiraEm: number; bytes: number }

export class CacheDeResposta {
  private readonly mapa = new Map<string, Entrada>();
  private bytes = 0;
  acertos = 0;
  faltas = 0;

  constructor(private readonly ttlMs = TTL_DO_CACHE_MS) {}

  ler(chave: string, agoraMs: number): string | null {
    const e = this.mapa.get(chave);
    if (!e || e.expiraEm <= agoraMs) {
      if (e) this.remover(chave);
      this.faltas++;
      return null;
    }
    // LRU: o lido vai para o fim.
    this.mapa.delete(chave);
    this.mapa.set(chave, e);
    this.acertos++;
    return e.texto;
  }

  gravar(chave: string, texto: string, agoraMs: number): void {
    if (texto.length === 0) return;
    const bytes = Buffer.byteLength(texto, "utf8");
    if (bytes > MAX_BYTES) return;
    if (this.mapa.has(chave)) this.remover(chave);
    this.mapa.set(chave, { texto, expiraEm: agoraMs + this.ttlMs, bytes });
    this.bytes += bytes;
    while (this.mapa.size > MAX_ENTRADAS || this.bytes > MAX_BYTES) {
      const maisVelha = this.mapa.keys().next().value as string;
      this.remover(maisVelha);
    }
  }

  get tamanho(): number { return this.mapa.size; }

  private remover(chave: string): void {
    const e = this.mapa.get(chave);
    if (!e) return;
    this.bytes -= e.bytes;
    this.mapa.delete(chave);
  }
}

/** A instância do processo — uma por instância serverless quente. */
export const cacheDeRespostaDoZion = new CacheDeResposta();
