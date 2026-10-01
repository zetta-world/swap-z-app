/**
 * Utilidades de borda da rota pública de early access — sem banco.
 */

/**
 * Lê o corpo com TETO DE BYTES, sem confiar no `Content-Length`.
 *
 * ⚠️ `req.text()` leria um corpo de qualquer tamanho para a memória antes de
 * a rota poder recusar. Aqui a leitura para no primeiro byte acima do teto.
 * `Content-Length` declarado acima do teto recusa sem ler nada.
 */
export async function lerCorpoLimitado(
  req: Request, limite: number,
): Promise<{ ok: true; texto: string } | { ok: false; motivo: "grande_demais" | "ilegivel" }> {
  const declarado = req.headers.get("content-length");
  if (declarado !== null) {
    const n = Number(declarado);
    if (!Number.isFinite(n) || n < 0) return { ok: false, motivo: "ilegivel" };
    if (n > limite) return { ok: false, motivo: "grande_demais" };
  }
  if (!req.body) return { ok: true, texto: "" };
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > limite) {
        await leitor.cancel().catch(() => undefined);
        return { ok: false, motivo: "grande_demais" };
      }
      partes.push(value);
    }
  } catch {
    return { ok: false, motivo: "ilegivel" };
  }
  const junto = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { junto.set(p, pos); pos += p.byteLength; }
  try {
    return { ok: true, texto: new TextDecoder("utf-8", { fatal: true }).decode(junto) };
  } catch {
    return { ok: false, motivo: "ilegivel" };
  }
}

/**
 * O POST veio da própria origem?
 *
 * Aceita a origem da própria requisição e, se configurada, a de
 * `NEXT_PUBLIC_SITE_URL`. `Origin` ausente é recusado: todo navegador moderno
 * envia `Origin` em POST, e um formulário legítimo sempre vem de um.
 */
export function origemPermitida(req: Request, siteUrl = process.env.NEXT_PUBLIC_SITE_URL): boolean {
  const origem = req.headers.get("origin");
  if (!origem) return false;
  const permitidas = new Set<string>();
  try { permitidas.add(new URL(req.url).origin); } catch { /* sem URL: só o site */ }
  if (siteUrl) {
    try { permitidas.add(new URL(siteUrl).origin); } catch { /* valor inválido: ignora */ }
  }
  return permitidas.has(origem);
}

export function ehJson(req: Request): boolean {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  return ct.split(";")[0].trim() === "application/json";
}
