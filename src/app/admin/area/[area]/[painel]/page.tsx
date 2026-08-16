import Link from "next/link";
import { notFound } from "next/navigation";
import { areaPorId, areaDoModulo, modulosDaArea } from "@/lib/admin/areas";
import { MODULE_BY_ID, type ModuleId } from "@/lib/admin/modules";
import PainelSozinho from "@/components/admin/PainelSozinho";
import AvisoDaArea from "@/components/admin/AvisoDaArea";

/**
 * UM PAINEL, A TELA INTEIRA — o pedido central do dono.
 *
 *   "vai abrir o item com sua UI dedicada"
 *
 * ⚠️ O QUE MUDA NÃO É SÓ O TAMANHO. Na grade, todo painel vivia numa coluna de
 * 400px porque o `auto-fill` tratava os 51 como iguais — uma tabela de torneio
 * com sete colunas e um número solto recebiam a mesma caixa. Aqui o painel tem
 * a largura toda, então tabela larga cabe, gráfico respira, e nada disputa
 * atenção com outro painel ao lado.
 *
 * ⚠️ E O CAMINHO DE VOLTA É EXPLÍCITO. Sem migalha, tela cheia vira beco: o
 * dono chega por link, lê, e não tem como voltar para a área sem o botão do
 * navegador. Ele abre isto no celular viajando — beco ali é pior que na mesa.
 *
 * ⚠️ A ÁREA NA URL TEM DE BATER COM A ÁREA REAL DO PAINEL. `/mesas/liquidez`
 * não pode renderizar a liquidez sob o rótulo de MESAS: a faixa de contexto
 * diria "dinheiro SIMULADO de carteira paper" sobre uma medição de mercado, e
 * é exatamente o tipo de rótulo errado que esta reforma existe para acabar.
 */
export default async function PainelPage({
  params,
}: {
  params: Promise<{ area: string; painel: string }>;
}) {
  const { area: areaId, painel } = await params;
  const area = areaPorId(areaId);
  if (!area) notFound();

  const m = MODULE_BY_ID[painel as ModuleId];
  // Id inexistente OU pendurado na área errada: as duas coisas são 404, e a
  // segunda de propósito — ver a nota acima.
  if (!m || areaDoModulo(m.id) !== area.id) notFound();

  const irmaos = modulosDaArea(area.id);
  const i = irmaos.indexOf(m.id);
  const anterior = i > 0 ? irmaos[i - 1] : null;
  const proximo  = i >= 0 && i < irmaos.length - 1 ? irmaos[i + 1] : null;

  return (
    <div style={{ padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Migalha — o caminho de volta, sempre visível. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, flexWrap: "wrap" }}>
        <Link href="/admin" style={{ color: "var(--adm-ink-4)", textDecoration: "none" }}>⌂</Link>
        <span style={{ color: "var(--adm-ink-4)" }}>/</span>
        <Link href={`/admin/area/${area.id}`} style={{ color: "var(--adm-cyan)", textDecoration: "none" }}>
          {area.icon} {area.label}
        </Link>
        <span style={{ color: "var(--adm-ink-4)" }}>/</span>
        <span style={{ color: "var(--adm-ink-2)" }}>{m.title}</span>

        {/* ⚠️ Vizinhos: dentro de uma área o dono compara painel com painel
            (torneio → carteira → aprendizado). Voltar à lista a cada troca
            transforma uma leitura contínua em três cliques. */}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {anterior && (
            <Link href={`/admin/area/${area.id}/${anterior}`} className="adm-toggle"
                  style={{ textDecoration: "none" }}
                  title={MODULE_BY_ID[anterior]?.title}>
              ‹ {MODULE_BY_ID[anterior]?.icon}
            </Link>
          )}
          {proximo && (
            <Link href={`/admin/area/${area.id}/${proximo}`} className="adm-toggle"
                  style={{ textDecoration: "none" }}
                  title={MODULE_BY_ID[proximo]?.title}>
              {MODULE_BY_ID[proximo]?.icon} ›
            </Link>
          )}
        </span>
      </div>

      <AvisoDaArea aviso={area.aviso} areaId={area.id} />

      <PainelSozinho id={m.id} />
    </div>
  );
}
