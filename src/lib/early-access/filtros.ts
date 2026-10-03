import type { Filtros } from "./store";
import { estadoValido } from "./estados";
import { paisValido } from "./paises";

/**
 * Filtros da lista admin do early access. Parâmetro inválido vira ERRO, nunca
 * é ignorado: um filtro que "não pegou" mostraria a lista inteira como se
 * fosse o recorte pedido.
 *
 * (`import type` de `./store` não carrega o módulo de servidor em runtime.)
 */
export function lerFiltros(p: URLSearchParams): Filtros | { erro: string } {
  const f: Filtros = { limit: 50, offset: 0 };

  const limit = p.get("limit");
  if (limit !== null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 200) return { erro: "limit_invalido" };
    f.limit = n;
  }
  const offset = p.get("offset");
  if (offset !== null) {
    const n = Number(offset);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return { erro: "offset_invalido" };
    f.offset = n;
  }
  const status = p.get("status");
  if (status !== null && status !== "") {
    if (!estadoValido(status)) return { erro: "status_invalido" };
    f.status = status;
  }
  const country = p.get("country");
  if (country !== null && country !== "") {
    if (!paisValido(country)) return { erro: "country_invalido" };
    f.country = country;
  }
  const hw = p.get("has_wallet");
  if (hw !== null && hw !== "") {
    if (hw !== "1" && hw !== "0") return { erro: "has_wallet_invalido" };
    f.hasWallet = hw === "1";
  }
  const ver = p.get("verified");
  if (ver !== null && ver !== "") {
    if (ver !== "1" && ver !== "0") return { erro: "verified_invalido" };
    f.verified = ver === "1";
  }
  const q = p.get("q");
  if (q !== null && q !== "") {
    const s = q.trim().toLowerCase();
    if (!/^[a-z0-9@._+-]{1,100}$/.test(s)) return { erro: "q_invalido" };
    f.q = s;
  }
  return f;
}
