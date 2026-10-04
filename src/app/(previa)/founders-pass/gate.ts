/** Única porta da prévia local da venda Founders: variável do SERVIDOR, desligada por padrão (ausente = 404). */
export function previaHabilitada(): boolean {
  return process.env.FOUNDERS_SALE_PREVIEW === "1";
}
