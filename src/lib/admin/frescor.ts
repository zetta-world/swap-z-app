/**
 * FRESCOR "há Xs" — R3 (Admin CC 2.0). Calculado a partir do `fetchedAt` QUE A ROTA DEVOLVEU (quando o
 * dado foi lido no servidor), não de quando a tela tentou atualizar: uma atualização que FALHA não
 * pode deixar o rótulo dizendo "agora". Módulo puro (vai ao painel client).
 */
export function idadeEmSegundos(fetchedAt: string | null | undefined, agoraMs: number): number | null {
  if (!fetchedAt) return null;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((agoraMs - t) / 1000));
}

export function rotuloDeFrescor(segundos: number | null): string | null {
  if (segundos == null) return null;
  if (segundos < 5) return "agora";
  if (segundos < 60) return `há ${segundos}s`;
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)}min`;
  return `há ${Math.floor(segundos / 3600)}h`;
}
