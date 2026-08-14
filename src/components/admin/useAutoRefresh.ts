"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminRealtime, type RefreshScope } from "./AdminRealtimeProvider";
import { devoRodar } from "./refresh-gap";

type Options = {
  /** Rede de segurança. Nunca é desacelerada por causa do tempo real. */
  intervalMs?: number;
  onRefresh:   () => Promise<void> | void;
  /** Escopos que disparam busca imediata. Sem isto, escuta TODOS. */
  scopes?:     RefreshScope[];
  /** Intervalo mínimo entre duas buscas — estrangula a rajada de pings. */
  minGapMs?:   number;
};

type Result = {
  secondsAgo:   number;
  refreshing:   boolean;
  forceRefresh: () => void;
};

/**
 * Busca na montagem, num intervalo de segurança, a cada ping do tempo real, e
 * ao VOLTAR para a aba.
 *
 * ⚠️⚠️ POR QUE ESTE ARQUIVO FOI REESCRITO (14/08).
 *
 * A versão anterior desacelerava a sondagem quando o tempo real estava vivo —
 * *"pings cobrem as mudanças reais"*. A medição desmentiu: de **12 painéis que
 * desaceleravam, só 3 assinavam o ping**. Os outros 9 ficavam mais lentos e não
 * recebiam nada em troca:
 *
 *     PlatformEvents   vivo 180s   ·   morto  60s
 *     AuditLog         vivo 120s   ·   morto  30s
 *     Operations       vivo  60s   ·   morto  30s
 *
 * Ou seja: **quanto mais saudável a conexão, mais velha a tela.** Uma inversão
 * silenciosa — nada quebra, nada avisa, e o número que você lê é de três
 * minutos atrás enquanto o indicador diz "ao vivo".
 *
 * A regra agora é a inversa e não tem exceção: **o intervalo nunca aumenta por
 * causa do tempo real.** Ping é ganho, não troca.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ E A ABA ESCONDIDA NÃO SONDA.
 *
 * O dono usa isto de dois jeitos: aberto o dia inteiro num PC do escritório, e
 * no celular quando está viajando. São exigências opostas — a tela parada
 * precisa acompanhar sozinha, o celular precisa não queimar bateria e dado no
 * 4G enquanto está no bolso.
 *
 * Sondar escondido serve aos dois mal. Então: escondido, o relógio para; ao
 * VOLTAR, busca na hora e sem esperar o estrangulamento. Quem tira o telefone
 * do bolso quer ver o agora, não o de quando guardou.
 */
export function useAutoRefresh({
  intervalMs = 60_000,
  onRefresh,
  scopes,
  minGapMs = 15_000,
}: Options): Result {
  const [lastAt,     setLastAt]     = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const cbRef   = useRef(onRefresh);
  const lastRef = useRef(0);
  cbRef.current = onRefresh;

  const realtime = useAdminRealtime();

  const run = useCallback(async (forcado = false) => {
    if (!devoRodar(Date.now(), lastRef.current, minGapMs, forcado)) return;
    // Marca ANTES de buscar: duas chamadas concorrentes (ping + volta de aba no
    // mesmo instante) veriam o mesmo `lastRef` antigo e passariam as duas.
    lastRef.current = Date.now();
    setRefreshing(true);
    try { await cbRef.current(); } catch { /* painel decide o que mostrar */ }
    setRefreshing(false);
    setLastAt(Date.now());
  }, [minGapMs]);

  // Carga inicial + relógio de segurança, pausado enquanto a aba está escondida.
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const parar = () => { if (t) { clearInterval(t); t = null; } };
    const andar = () => { parar(); t = setInterval(() => void run(true), intervalMs); };

    const escondida = () => typeof document !== "undefined" && document.hidden;

    if (!escondida()) { void run(true); andar(); }

    const aoVoltar = () => {
      if (escondida()) { parar(); return; }
      void run(true);   // forçado: quem voltou quer o agora
      andar();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", aoVoltar);
      window.addEventListener("focus", aoVoltar);
    }
    return () => {
      parar();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", aoVoltar);
        window.removeEventListener("focus", aoVoltar);
      }
    };
  }, [run, intervalMs]);

  // Ping do tempo real → busca imediata, estrangulada e só com a aba à vista.
  useEffect(() => {
    if (!realtime) return;
    return realtime.subscribe((scope) => {
      if (scopes && !scopes.includes(scope)) return;
      if (typeof document !== "undefined" && document.hidden) return;
      void run(false);
    });
  }, [realtime, run, scopes]);

  // Contador "há quantos segundos" — é o que denuncia uma tela congelada.
  useEffect(() => {
    if (!lastAt) return;
    const tick = () => setSecondsAgo(Math.round((Date.now() - lastAt) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [lastAt]);

  return { secondsAgo, refreshing, forceRefresh: () => void run(true) };
}
