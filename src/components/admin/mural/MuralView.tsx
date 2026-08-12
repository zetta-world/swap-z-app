"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapaMundi, { type Praca } from "./MapaMundi";
import "./mural.css";

interface Troca {
  quando: string; par: string; cadeia: string;
  volumeUsd: number | null; taxaUsd: number | null; rota: string | null;
}
interface Dados {
  pracas: Praca[];
  trocas: Troca[];
  dinheiro: {
    arrecadadoTotalUsd: number; arrecadado24hUsd: number;
    volumeTotalUsd: number; volume24hUsd: number;
    operacoes: number; operacoes24h: number;
  };
  pulso: { eventos5min: number; usuarios: number };
  agora: string;
}

const usd = (n: number, casas = 2) =>
  `$${n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
/** ⚠️ Arrecadação pequena precisa de casas, senão $0,092 vira "$0,00". */
const usdFino = (n: number) => (n > 0 && n < 1 ? `$${n.toFixed(4)}` : usd(n));

function haQuanto(iso: string, agora: number): string {
  const s = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 1000));
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * O MURAL — a tela que fica aberta.
 *
 * ⚠️ ESCRITA PARA SER LIDA A TRÊS METROS **E** NA MÃO. O mesmo componente vai
 * para uma TV de 65 polegadas e para um celular no ônibus, e a diferença não é
 * "esconder coisas no pequeno": é a mesma informação com densidade diferente.
 * Tudo que decide tamanho usa `clamp()` amarrado à largura da viewport, então
 * o texto cresce com a tela em vez de existir em dois layouts que precisam ser
 * mantidos em sincronia — dois layouts divergem, e o pequeno vira o esquecido.
 *
 * ⚠️ E ELE NÃO INVENTA MOVIMENTO. Quando não há troca, a faixa de fluxo diz
 * que não há, e o mapa mostra as praças reais esfriando. O que pulsa sempre é
 * o PULSO DA INFRAESTRUTURA — crons, medições, radar — porque isso está
 * genuinamente acontecendo a cada minuto, e é a diferença entre uma tela viva
 * e uma tela mentirosa.
 */
export default function MuralView() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  /** Os `ref` das trocas já vistas — para animar só o que ENTROU. */
  const vistas = useRef<Set<string>>(new Set());
  const [novas, setNovas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/admin/api/mural", { cache: "no-store" });
      if (!r.ok) { setErro(`HTTP ${r.status}`); return; }
      const json = await r.json() as Dados;

      /**
       * ⚠️ O DESTAQUE É PARA O QUE CHEGOU AGORA, não para o topo da lista.
       * Sem isto, a primeira linha piscaria a cada atualização mesmo sem
       * troca nova — movimento sem fato, que é ruído com cara de notícia.
       */
      const chave = (t: Troca) => `${t.quando}|${t.par}`;
      if (vistas.current.size > 0) {
        const entrantes = json.trocas.filter((t) => !vistas.current.has(chave(t))).map(chave);
        if (entrantes.length > 0) {
          setNovas(new Set(entrantes));
          window.setTimeout(() => setNovas(new Set()), 4000);
        }
      }
      json.trocas.forEach((t) => vistas.current.add(chave(t)));

      setD(json); setErro(null);
    } catch (e) { setErro(String(e).slice(0, 120)); }
  }, []);

  useEffect(() => {
    void carregar();
    const t = window.setInterval(() => void carregar(), 8000);
    return () => window.clearInterval(t);
  }, [carregar]);

  /** O relógio anda sozinho, para "há 3s" não congelar entre buscas. */
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const vivo = (d?.pulso.eventos5min ?? 0) > 0;

  return (
    <div className="mural">
      {/* ── CABEÇALHO ───────────────────────────────────────────────── */}
      <header className="mural-topo">
        <div className="mural-marca">
          <span className="mural-runa" aria-hidden>ᛉ</span>
          <div>
            <h1>Z&#8209;SWAP</h1>
            <p>liquidity nexus · operações ao vivo</p>
          </div>
        </div>
        <div className="mural-estado">
          <span className={`mural-farol ${vivo ? "vivo" : "quieto"}`} aria-hidden />
          <span>{vivo ? "SISTEMA ATIVO" : "AGUARDANDO"}</span>
          <span className="mural-relogio">
            {new Date(agora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
      </header>

      {erro && <div className="mural-erro">falha ao ler: {erro}</div>}

      {/* ── OS NÚMEROS QUE IMPORTAM ─────────────────────────────────── */}
      <section className="mural-numeros">
        <Numero r="ARRECADADO · TOTAL" v={usdFino(d?.dinheiro.arrecadadoTotalUsd ?? 0)} destaque />
        <Numero r="VOLUME · 24H"       v={usd(d?.dinheiro.volume24hUsd ?? 0)} />
        <Numero r="OPERAÇÕES · 24H"    v={String(d?.dinheiro.operacoes24h ?? 0)} />
        <Numero r="PRAÇAS · 30D"       v={String(d?.pracas.length ?? 0)} />
        <Numero r="CARTEIRAS"          v={String(d?.pulso.usuarios ?? 0)} />
      </section>

      {/* ── O PALCO: mapa à esquerda, fluxo à direita em tela larga ─── */}
      <div className="mural-palco">
      <section className="mural-globo">
        <MapaMundi pracas={d?.pracas ?? []} />
        <div className="mural-legenda-mapa">
          <span>ACESSO GLOBAL · ÚLTIMOS 30 DIAS</span>
          <span className="mural-sussurro">
            ponto brilha com o acesso recente e esfria com o tempo
          </span>
        </div>

        {/* As praças, nomeadas. Um ponto sem nome é enfeite. */}
        {(d?.pracas.length ?? 0) > 0 && (
          <ul className="mural-pracas">
            {d!.pracas.slice(0, 6).map((p) => (
              <li key={`${p.lat},${p.lon}`}>
                <b>{p.cidade}</b>
                <span className="mural-pais">{p.pais}</span>
                <span className="mural-conta">{p.acessos}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── O FLUXO ─────────────────────────────────────────────────── */}
      <section className="mural-fluxo">
        <h2>FLUXO DE TROCAS</h2>
        {(d?.trocas.length ?? 0) === 0 ? (
          <p className="mural-vazio">
            nenhuma troca registrada ainda — a faixa preenche sozinha quando a primeira acontecer
          </p>
        ) : (
          <ul>
            {d!.trocas.slice(0, 12).map((t) => {
              const k = `${t.quando}|${t.par}`;
              return (
                <li key={k} className={novas.has(k) ? "mural-entrando" : undefined}>
                  <span className="mural-quando">{haQuanto(t.quando, agora)}</span>
                  <span className="mural-par">{t.par}</span>
                  <span className="mural-cadeia">{t.cadeia}</span>
                  <span className="mural-vol">{t.volumeUsd == null ? "—" : usd(t.volumeUsd)}</span>
                  {/* ⚠️ A taxa em verde só quando ELA EXISTE. Zero e ausência
                      ficam apagados — a cor de receita em cima de nada é a
                      mentira mais barata de um mural. */}
                  <span className={t.taxaUsd ? "mural-taxa" : "mural-taxa-vazia"}>
                    {t.taxaUsd ? `+${usdFino(t.taxaUsd)}` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}

function Numero({ r, v, destaque }: { r: string; v: string; destaque?: boolean }) {
  return (
    <div className={`mural-numero${destaque ? " destaque" : ""}`}>
      <span className="mural-rotulo">{r}</span>
      <strong>{v}</strong>
    </div>
  );
}
