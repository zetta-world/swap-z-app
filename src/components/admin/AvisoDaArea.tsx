import type { AreaId } from "@/lib/admin/areas";

/**
 * A FAIXA DE CONTEXTO DA ÁREA.
 *
 * ⚠️ SÓ ONDE CONFUNDIR CUSTA CARO. Um aviso que aparece em toda tela é um
 * aviso que ninguém lê. Estes três existem porque o erro que eles impedem já
 * aconteceu neste painel: ler USDT simulado de carteira paper como se fosse
 * receita, e ler um backtest sob demanda como se fosse mesa operando.
 *
 * ⚠️ A COR VEM DA ÁREA, e é declarada aqui em vez de vir junto do texto: cor é
 * decisão de tela, texto é decisão de conteúdo, e misturar as duas no registro
 * faria o `areas.ts` — que é lógica pura e testável — carregar CSS.
 */
const COR: Partial<Record<AreaId, string>> = {
  mesas:    "var(--adm-gold)",
  medicoes: "var(--adm-cyan)",
  dinheiro: "var(--adm-green)",
};

export default function AvisoDaArea({ aviso, areaId }: { aviso: string | null; areaId: AreaId }) {
  if (!aviso) return null;
  return (
    <div style={{
      fontSize: 11, lineHeight: 1.6, padding: "6px 9px", borderRadius: 3,
      color: "var(--adm-ink-3)", background: "var(--adm-bg-raise)",
      borderLeft: `2px solid ${COR[areaId] ?? "var(--adm-ink-3)"}`,
    }}>
      {aviso}
    </div>
  );
}
