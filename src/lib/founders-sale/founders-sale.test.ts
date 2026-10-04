import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { transicionar, aceitaReserva, exigeAllowlist, type Venda, type EventoVenda } from "./maquina";
import { criarSnapshot, contem, diff, type Normalizador } from "./allowlist";
import { construir, prova, verificar } from "./merkle";
import { LivroDeReservas } from "./alocacao";
import { MintFalso } from "./mint-falso";
import { proximoEstado } from "./ciclo-tx";

const sha256 = (d: Uint8Array) => new Uint8Array(createHash("sha256").update(d).digest());
const sha512_256 = (d: Uint8Array) => new Uint8Array(createHash("sha512").update(d).digest().subarray(0, 32));
const utf8 = (s: string) => new TextEncoder().encode(s);
const minusculo: Normalizador = (a) => (/^[a-z0-9]{3,64}$/i.test(a.trim()) ? a.trim().toLowerCase() : null);

describe("máquina de estados da venda", () => {
  const seq = (eventos: EventoVenda[]) => eventos.reduce<Venda>((v, e) => {
    const r = transicionar(v, e); if (!r.ok) throw new Error(`${e}@${v.estado}:${r.erro}`); return r.venda;
  }, { estado: "rascunho" });

  it("caminho feliz: rascunho → agendada → allowlist → pública → esgotada", () => {
    expect(seq(["agendar", "abrir_allowlist", "abrir_publica", "esgotar"]).estado).toBe("esgotada");
  });

  it("pausar lembra para onde voltar; pausada não aceita reserva", () => {
    const p = seq(["agendar", "abrir_publica", "pausar"]);
    expect(p).toEqual({ estado: "pausada", antesDaPausa: "publica_aberta" });
    expect(aceitaReserva(p)).toBe(false);
    const r = transicionar(p, "retomar");
    expect(r.ok && r.venda.estado).toBe("publica_aberta");
  });

  it("transições proibidas e estados terminais", () => {
    expect(transicionar({ estado: "rascunho" }, "abrir_publica")).toEqual({ ok: false, erro: "transicao_proibida" });
    expect(transicionar({ estado: "agendada" }, "retomar")).toEqual({ ok: false, erro: "transicao_proibida" });
    for (const t of ["esgotada", "encerrada", "cancelada"] as const) {
      expect(transicionar({ estado: t }, "agendar")).toEqual({ ok: false, erro: "estado_terminal" });
    }
    expect(transicionar({ estado: "publica_aberta" }, "cancelar").ok).toBe(false); // cancelar com venda aberta exige pausar antes
  });

  it("allowlist só é exigida na fase de allowlist", () => {
    expect(exigeAllowlist({ estado: "allowlist_aberta" })).toBe(true);
    expect(exigeAllowlist({ estado: "publica_aberta" })).toBe(false);
  });
});

describe("snapshot da allowlist", () => {
  it("determinístico: mesma lista (qualquer ordem, duplicatas, caixa) → mesmo id", () => {
    const a = criarSnapshot(1, ["AAA111", "bbb222", "aaa111"], minusculo);
    const b = criarSnapshot(1, ["bbb222", "aaa111"], minusculo);
    expect(a.id).toBe(b.id);
    expect(a.enderecos).toEqual(["aaa111", "bbb222"]);
  });

  it("versão e conteúdo mudam o id; recusados são contados, não guardados", () => {
    const a = criarSnapshot(1, ["aaa111", "x!"], minusculo);
    expect(a.recusados).toBe(1);
    expect(criarSnapshot(2, ["aaa111"], minusculo).id).not.toBe(a.id);
    expect(criarSnapshot(1, ["aaa111", "ccc333"], minusculo).id).not.toBe(a.id);
    expect(JSON.stringify(a)).not.toContain("x!");
  });

  it("contem e diff", () => {
    const v1 = criarSnapshot(1, ["aaa111", "bbb222"], minusculo);
    const v2 = criarSnapshot(2, ["bbb222", "ccc333"], minusculo);
    expect(contem(v1, "AAA111", minusculo)).toBe(true);
    expect(contem(v1, "ccc333", minusculo)).toBe(false);
    expect(diff(v1, v2)).toEqual({ entraram: ["ccc333"], sairam: ["aaa111"] });
  });

  it("snapshot é imutável", () => {
    const s = criarSnapshot(1, ["aaa111"], minusculo);
    expect(() => { (s.enderecos as string[]).push("zzz999"); }).toThrow();
  });
});

describe("Merkle com hash injetado", () => {
  const itens = Array.from({ length: 13 }, (_, i) => `carteira${i}`); // ímpar de propósito
  for (const [nome, h] of [["sha256", sha256], ["sha512/256", sha512_256]] as const) {
    it(`${nome}: toda folha prova; item fora, item trocado e raiz errada não provam`, () => {
      const t = construir(itens, h, utf8);
      itens.forEach((it_, i) => expect(verificar(t.raiz, it_, prova(t, i), h, utf8)).toBe(true));
      expect(verificar(t.raiz, "intruso", prova(t, 0), h, utf8)).toBe(false);
      expect(verificar(t.raiz, itens[1], prova(t, 0), h, utf8)).toBe(false);
      const outra = construir([...itens, "extra"], h, utf8);
      expect(verificar(outra.raiz, itens[0], prova(t, 0), h, utf8)).toBe(false);
    });
  }
  it("hash diferente → raiz diferente (a escolha da chain não está travada aqui)", () => {
    expect(Buffer.from(construir(itens, sha256, utf8).raiz).equals(Buffer.from(construir(itens, sha512_256, utf8).raiz))).toBe(false);
  });
  it("árvore vazia e índice inválido são recusados", () => {
    expect(() => construir([], sha256, utf8)).toThrow("arvore_vazia");
    expect(() => prova(construir(itens, sha256, utf8), 99)).toThrow("indice_invalido");
  });
});

describe("livro de reservas — oversell, teto, idempotência, expiração", () => {
  const base = { vendaAberta: true, elegivel: true };

  it("CORRIDA: 500 pedidos concorrentes de 1 unidade com supply 100 → exatamente 100 aceitos", async () => {
    const livro = new LivroDeReservas({ supply: 100, maxPorCarteira: 5, validadeMs: 60_000 });
    const rs = await Promise.all(Array.from({ length: 500 }, (_, i) =>
      livro.reservar({ ...base, chave: `k${i}`, carteira: `w${i}`, unidades: 1 })));
    expect(rs.filter((r) => r.ok).length).toBe(100);
    expect(rs.filter((r) => !r.ok && r.erro === "esgotado").length).toBe(400);
    expect(livro.progresso()).toMatchObject({ reservadas: 100, restantes: 0 });
  });

  it("CORRIDA na mesma carteira: teto por carteira nunca é ultrapassado", async () => {
    const livro = new LivroDeReservas({ supply: 1000, maxPorCarteira: 3, validadeMs: 60_000 });
    const rs = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      livro.reservar({ ...base, chave: `c${i}`, carteira: "mesma", unidades: 1 })));
    expect(rs.filter((r) => r.ok).length).toBe(3);
    expect(rs.filter((r) => !r.ok && r.erro === "teto_da_carteira").length).toBe(47);
  });

  it("REPLAY / duplo envio: mesma chave em paralelo reserva uma vez só", async () => {
    const livro = new LivroDeReservas({ supply: 10, maxPorCarteira: 10, validadeMs: 60_000 });
    const rs = await Promise.all(Array.from({ length: 20 }, () =>
      livro.reservar({ ...base, chave: "mesma-chave", carteira: "w", unidades: 2 })));
    const ids = new Set(rs.map((r) => (r.ok ? r.reserva.id : "x")));
    expect(ids.size).toBe(1);
    expect(rs.filter((r) => r.ok && !r.replay).length).toBe(1);
    expect(livro.progresso().reservadas).toBe(2);
  });

  it("venda fechada (pausa) e inelegível recusam; recusa por fechamento não queima a chave", async () => {
    const livro = new LivroDeReservas({ supply: 10, maxPorCarteira: 10, validadeMs: 60_000 });
    expect(await livro.reservar({ chave: "k", carteira: "w", unidades: 1, vendaAberta: false, elegivel: true })).toEqual({ ok: false, erro: "venda_fechada" });
    expect((await livro.reservar({ chave: "k", carteira: "w", unidades: 1, vendaAberta: true, elegivel: true })).ok).toBe(true);
    expect(await livro.reservar({ chave: "k2", carteira: "w2", unidades: 1, vendaAberta: true, elegivel: false })).toEqual({ ok: false, erro: "nao_elegivel" });
  });

  it("expiração libera unidades; confirmar expirada falha; confirmar duas vezes falha", async () => {
    let t = 0;
    const livro = new LivroDeReservas({ supply: 1, maxPorCarteira: 1, validadeMs: 1000 }, () => t);
    const a = await livro.reservar({ ...base, chave: "a", carteira: "w1", unidades: 1 });
    expect((await livro.reservar({ ...base, chave: "b", carteira: "w2", unidades: 1 }))).toEqual({ ok: false, erro: "esgotado" });
    t = 1000;
    expect(a.ok && (await livro.confirmar(a.reserva.id))).toEqual({ ok: false, erro: "expirada" });
    const b = await livro.reservar({ ...base, chave: "b", carteira: "w2", unidades: 1 });
    expect(b.ok).toBe(true);
    expect(b.ok && (await livro.confirmar(b.reserva.id))).toEqual({ ok: true });
    expect(b.ok && (await livro.confirmar(b.reserva.id))).toEqual({ ok: false, erro: "ja_confirmada" });
    expect(livro.progresso()).toMatchObject({ confirmadas: 1, restantes: 0, esgotado: true });
  });

  it("parâmetros e configuração inválidos são recusados", async () => {
    expect(() => new LivroDeReservas({ supply: 0, maxPorCarteira: 1, validadeMs: 1 })).toThrow("config_invalida:supply");
    const livro = new LivroDeReservas({ supply: 5, maxPorCarteira: 5, validadeMs: 1000 });
    expect(await livro.reservar({ ...base, chave: "z", carteira: "w", unidades: 0 })).toEqual({ ok: false, erro: "parametro_invalido" });
    expect(await livro.reservar({ ...base, chave: "z2", carteira: "w", unidades: 1.5 })).toEqual({ ok: false, erro: "parametro_invalido" });
  });
});

describe("mint falso determinístico", () => {
  it("idempotente e marcado como falso", async () => {
    const m = new MintFalso();
    const a = await m.mintar({ chave: "k", carteira: "w", unidades: 1 });
    const b = await m.mintar({ chave: "k", carteira: "w", unidades: 1 });
    expect(a.ok && a.txId.startsWith("fake-")).toBe(true);
    expect(b).toEqual({ ...a, replay: true });
    expect(m.rede).toBe("FAKE_LOCAL_ONLY");
  });
  it("falha transitória N vezes e depois conclui; permanente nunca conclui", async () => {
    const m = new MintFalso({ transitorias: new Map([["t", 2]]), permanentes: new Set(["p"]) });
    expect((await m.mintar({ chave: "t", carteira: "w", unidades: 1 })).ok).toBe(false);
    expect((await m.mintar({ chave: "t", carteira: "w", unidades: 1 })).ok).toBe(false);
    expect((await m.mintar({ chave: "t", carteira: "w", unidades: 1 })).ok).toBe(true);
    for (let i = 0; i < 3; i++) expect(await m.mintar({ chave: "p", carteira: "w", unidades: 1 })).toMatchObject({ ok: false, codigo: "permanente" });
    expect(m.tentativasDe("t")).toBe(3);
  });
});

describe("ciclo de transação (estados de UI)", () => {
  it("caminho feliz e eventos fora de ordem ignorados", () => {
    let s = proximoEstado("ocioso", "finalizada");
    expect(s).toBe("ocioso");
    for (const e of ["iniciar", "assinou", "transmitida", "incluida", "finalizada"] as const) s = proximoEstado(s, e);
    expect(s).toBe("confirmada");
    expect(proximoEstado("confirmada", "reiniciar")).toBe("confirmada");
  });
  it("recusa de assinatura, erro e tempo esgotado voltam a ocioso só por reiniciar", () => {
    expect(proximoEstado("assinando", "recusou_assinar")).toBe("rejeitada");
    expect(proximoEstado("enviada", "tempo_esgotado")).toBe("expirada");
    expect(proximoEstado("expirada", "reiniciar")).toBe("ocioso");
  });
});
