import { describe, it, expect, vi } from "vitest";
import { comRetentativa } from "@/lib/autopilot/positions-server";

/**
 * ⚠️ A CICATRIZ QUE ESTES TESTES PROTEGEM (auditoria do autopilot, 23/08).
 *
 * `engine.ts:492` já documenta o defeito com o valor em dólares que ele custou:
 * **o cliente do Supabase NÃO LANÇA em erro de banco — ele RESOLVE com
 * `{ data: null, error }`**. Um `await db.from(...).upsert(...)` sem conferir
 * `error` é indistinguível de sucesso.
 *
 * Lá foram US$ 450 a 1.000 em catorze carteiras de PAPEL. No autopilot é a
 * conta na corretora do cliente: a ordem executa, o upsert falha calado, e o
 * bot NUNCA MAIS sai daquele trade — o ramo de venda não acha a posição.
 */

const ok = () => Promise.resolve({ error: null });
const falha = (msg: string) => () => Promise.resolve({ error: { message: msg } });

describe("comRetentativa — o erro não pode passar por sucesso", () => {
  it("sucesso de primeira não retenta", async () => {
    const f = vi.fn(ok);
    await expect(comRetentativa(f)).resolves.toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("falha transitória: a segunda tentativa salva a gravação", async () => {
    // ⚠️ É o caso comum de verdade — um 500 do Supabase no meio de uma
    // invocação serverless. Sem a retentativa, uma piscada de rede orfanaria
    // uma posição PARA SEMPRE, porque nada reprocessa.
    const f = vi.fn()
      .mockImplementationOnce(falha("timeout"))
      .mockImplementationOnce(ok);
    await expect(comRetentativa(f)).resolves.toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falha persistente DEVOLVE o erro, e não engole", async () => {
    const f = vi.fn(falha("violação de constraint"));
    const r = await comRetentativa(f);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("constraint");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("NÃO retenta para sempre — exatamente duas tentativas", async () => {
    // O caminho do dinheiro roda dentro de um serverless com tempo limitado, e
    // o cron tem 60s para N sessões. Retentativa sem teto viraria timeout, que
    // é o defeito que o contador incremental existe para sobreviver.
    const f = vi.fn(falha("fora do ar"));
    await comRetentativa(f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a mensagem é truncada — erro de banco não vira parede de texto no alerta", async () => {
    const r = await comRetentativa(falha("x".repeat(500)));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro.length).toBeLessThanOrEqual(200);
  });
});
