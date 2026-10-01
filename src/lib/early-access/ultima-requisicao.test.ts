/**
 * F-07 — "só a última requisição escreve", provado com a corrida real:
 * abrir A, abrir B, e a resposta de A chegar DEPOIS da de B.
 */
import { describe, it, expect } from "vitest";
import { UltimaRequisicao } from "./ultima-requisicao";

/** Simula o carregarEventos do painel: espera a resposta e só escreve se ainda vale. */
async function carregar(
  u: UltimaRequisicao, id: string, resposta: Promise<string[]>, tela: { eventos: string[]; escritas: number },
) {
  const signal = u.nova();
  const dados = await resposta;
  if (signal.aborted) return;
  tela.eventos = dados.map((e) => `${id}:${e}`);
  tela.escritas++;
}

function adiada<T>() {
  let resolver!: (v: T) => void;
  const p = new Promise<T>((r) => { resolver = r; });
  return { p, resolver };
}

describe("UltimaRequisicao", () => {
  it("⚠️⚠️ resposta atrasada de A NÃO aparece quando B está aberto", async () => {
    const u = new UltimaRequisicao();
    const tela = { eventos: [] as string[], escritas: 0 };
    const a = adiada<string[]>();
    const b = adiada<string[]>();
    const ca = carregar(u, "A", a.p, tela);
    const cb = carregar(u, "B", b.p, tela);
    b.resolver(["criado"]);
    await cb;
    a.resolver(["criado", "aprovado"]); // A chega por ÚLTIMO
    await ca;
    expect(tela.eventos).toEqual(["B:criado"]);
    expect(tela.escritas).toBe(1);
  });

  it("cancelar() (fechar a linha / desmontar) impede qualquer escrita posterior", async () => {
    const u = new UltimaRequisicao();
    const tela = { eventos: [] as string[], escritas: 0 };
    const a = adiada<string[]>();
    const ca = carregar(u, "A", a.p, tela);
    u.cancelar();
    a.resolver(["x"]);
    await ca;
    expect(tela.escritas).toBe(0);
  });

  it("nova() cancela só a anterior: a corrente segue válida", () => {
    const u = new UltimaRequisicao();
    const s1 = u.nova();
    const s2 = u.nova();
    expect(s1.aborted).toBe(true);
    expect(s2.aborted).toBe(false);
  });
});
