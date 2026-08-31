import PoolsView from "@/components/pools/PoolsView";
import PoolsSoon from "@/components/pools/PoolsSoon";
import TierGate from "@/components/auth/TierGate";

/**
 * ⚠️⚠️ /pools FECHADA PARA EINHERJAR (tier `pilot`) — e o motivo é CUSTO DE
 * FONTE, não valor percebido (31/08).
 *
 * A GeckoTerminal limita em 30 chamadas/min POR IP quando não há chave de API,
 * e os IPs de saída da Vercel são compartilhados. Medido em produção em 30/08:
 * três das oito redes do seletor já vinham com `429 exceeded the Rate Limit`
 * — sem nenhum usuário nosso envolvido. Com público, a página degrada.
 *
 * ⚠️ E O PORTÃO FICA AQUI, ENVOLVENDO O `PoolsView`, não dentro dele. É o
 * `PoolsView` que tem `refetchInterval: 60_000`; um portão colocado lá dentro
 * esconderia a tabela e continuaria consumindo a cota. Fechar a porta depois
 * de deixar entrar não fecha nada.
 *
 * ⚠️ O `fallback` existe para não mentir. Sem ele o `TierGate` diz "assine
 * para desbloquear", que leria como recurso pronto e cobrado. `PoolsSoon` diz
 * o que é: em breve, com acesso antecipado para Einherjar.
 *
 * Os gates estão ATIVOS em produção (`/api/tier` responde
 * `gatesEnabled: true`) — isto vale no próximo deploy, sem mexer em env.
 */
export default function Page() {
  return (
    <TierGate required="pilot" fallback={<PoolsSoon />}>
      <PoolsView />
    </TierGate>
  );
}
