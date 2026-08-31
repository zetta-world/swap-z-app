"use client";

import { Layers } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";

/**
 * O QUE /pools MOSTRA PARA QUEM NÃO É EINHERJAR.
 *
 * ⚠️⚠️ ISTO NÃO É UM PAYWALL DISFARÇADO, E A DIFERENÇA É A HONESTIDADE DO TEXTO.
 *
 * O `TierGate` sem `fallback` mostra "assine para desbloquear". Aqui isso seria
 * mentira por omissão: a página não está fechada porque vale dinheiro — está
 * fechada porque a fonte de dados **não aguenta o público**. Sem chave de API a
 * GeckoTerminal limita em 30 chamadas/min POR IP, e os IPs de saída da Vercel
 * são compartilhados; em 30/08 três das oito redes já vinham com 429 em
 * produção, sem nenhum usuário nosso envolvido.
 *
 * Então o texto diz o motivo real. Quem lê "em breve" e "acesso antecipado
 * para Einherjar" entende a ordem das coisas; quem lesse "assine para
 * desbloquear" concluiria que o recurso está pronto e sendo cobrado.
 *
 * ⚠️ E ESTA TELA NÃO CHAMA A API. É o ponto inteiro: o `PoolsView` faz
 * `refetchInterval: 60_000`, e é ele que consome a cota. O portão precisa
 * ficar ANTES do componente que busca, não dentro dele — senão a página
 * economiza pixels e continua gastando crédito.
 */
export default function PoolsSoon() {
  const t = useT();

  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-[420px] h-[420px] rounded-full bg-cyan/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-16 max-w-3xl mx-auto">
        <EmptyState
          Icon={Layers}
          title={t("pools.soonTitle")}
          tone="gold"
          body={t("pools.soonBody")}
          cta={{ label: t("pools.soonCta"), href: "/pricing" }}
        />
      </div>
    </div>
  );
}
