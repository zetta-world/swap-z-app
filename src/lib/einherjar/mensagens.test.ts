import { describe, it, expect } from "vitest";
import { estadoDa, faz, interlocutorValido } from "@/lib/einherjar/mensagens";

/**
 * ⚠️ O QUE ESTES TESTES PROTEGEM (docs/PLANO-EINHERJAR.md).
 *
 * Esta tela existe para o dono perguntar a agentes que NÃO respondem na hora —
 * uma página web não interrompe uma sessão do Claude Code. O estado de leitura
 * é a única coisa que separa "ele não respondeu" de "ele nem viu", e sem essa
 * distinção o dono fica esperando alguém que não sabe que foi chamado.
 */

describe("estadoDa — três estados, não dois", () => {
  it("sem leitura e sem resposta: o agente NEM VIU", () => {
    expect(estadoDa({ lido_em: null, resposta: null })).toBe("nao_lida");
  });

  it("lida e sem resposta é DIFERENTE de não lida", () => {
    // ⚠️ A confusão entre os dois é o defeito que a tela existe para evitar:
    // um pede paciência, o outro pede cobrança.
    expect(estadoDa({ lido_em: "2026-08-23T12:00:00Z", resposta: null }))
      .toBe("lida_sem_resposta");
  });

  it("com resposta é respondida, mesmo que a leitura não tenha sido gravada", () => {
    // Responder implica ter lido. Se o `lido_em` se perdeu, a resposta manda —
    // ausência de um carimbo não apaga o fato que está na frente.
    expect(estadoDa({ lido_em: null, resposta: "porque o teto era 4,32M/dia" }))
      .toBe("respondida");
  });

  it("resposta vazia NÃO conta como respondida", () => {
    expect(estadoDa({ lido_em: null, resposta: "" })).toBe("nao_lida");
  });
});

describe("faz — quanto a espera já custou", () => {
  const t0 = Date.parse("2026-08-23T12:00:00Z");

  it("mostra minutos, horas e dias na escala certa", () => {
    expect(faz("2026-08-23T11:58:00Z", t0)).toBe("há 2 min");
    expect(faz("2026-08-23T09:00:00Z", t0)).toBe("há 3h");
    expect(faz("2026-08-21T12:00:00Z", t0)).toBe("há 2d");
  });

  it("menos de um minuto é 'agora', não 'há 0 min'", () => {
    expect(faz("2026-08-23T11:59:40Z", t0)).toBe("agora");
  });

  it("data no futuro ou ilegível não vira número negativo na tela", () => {
    // ⚠️ "há -3 min" seria a tela afirmando algo impossível. Prefere-se o
    // conservador: "agora".
    expect(faz("2026-08-23T12:05:00Z", t0)).toBe("agora");
    expect(faz("não-é-data", t0)).toBe("agora");
  });
});

describe("interlocutorValido — o destinatário é lista fechada", () => {
  it("aceita os conhecidos", () => {
    for (const v of ["dono", "nuvem", "vscode", "todos"]) {
      expect(interlocutorValido(v)).toBe(true);
    }
  });

  it("recusa qualquer outro, inclusive vazio e nulo", () => {
    for (const v of ["", "alguem", null, undefined, "DONO"]) {
      expect(interlocutorValido(v as string)).toBe(false);
    }
  });
});
