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
  infra: { regiao: string; levouMs: number };
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
  const relogio = new Date(agora).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="mural">
      {/* Bordas de runa — puro cenário, e some no estreito para não roubar
          largura da informação. */}
      <div className="mural-runas esq" aria-hidden>{"ᚦᚱᚨᛁᛗᛒᛖᛚᛞᚷᚹᛟᚦᚱᚨᛁᛗ".split("").map((r, i) => <span key={i}>{r}</span>)}</div>
      <div className="mural-runas dir" aria-hidden>{"ᛟᚹᚷᛞᛚᛖᛒᛗᛁᚨᚱᚦᛟᚹᚷᛞ".split("").map((r, i) => <span key={i}>{r}</span>)}</div>
      {/* ⚠️ A LINHA DE PROMPT não é enfeite: ela responde, antes de qualquer
             número, a pergunta que todo mundo faz numa reunião — isto é ao
             vivo ou é uma apresentação? */}
      <p className="mural-prompt">
        <b>[ADMIN@NEXUS:~]$</b> z-swap --live-ops --status{" "}
        <i>[{vivo ? "ATIVO" : "AGUARDANDO"} {relogio}]</i>
        <span className="mural-sep"> || </span>
        REGIÃO: <i>[{(d?.infra.regiao ?? "—").toUpperCase()}]</i>
        <span className="mural-cursor" aria-hidden />
      </p>

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
        <Numero r="ARRECADADO · TOTAL" v={usdFino(d?.dinheiro.arrecadadoTotalUsd ?? 0)} destaque un="USD" />
        <Numero r="VOLUME · 24H"       v={usd(d?.dinheiro.volume24hUsd ?? 0)} un="USD" />
        <Numero r="OPERAÇÕES · 24H"    v={String(d?.dinheiro.operacoes24h ?? 0)} un="QTD" />
        <Numero r="PRAÇAS · 30D"       v={String(d?.pracas.length ?? 0)} un="GEO" />
        <Numero r="CARTEIRAS"          v={String(d?.pulso.usuarios ?? 0)} un="QTD" />
        {/* ⚠️ A REFERÊNCIA TINHA UMA SEXTA CAIXA VAZIA, só moldura. Moldura sem
               número é decoração ocupando o lugar mais nobre da tela — e a
               taxa efetiva é justamente o que falta ali: ela diz se a
               arrecadação bate com o plano, sem ninguém dividir de cabeça. */}
        <Numero
          r="TAXA EFETIVA"
          un="BPS"
          v={
            (d?.dinheiro.volumeTotalUsd ?? 0) > 0 && (d?.dinheiro.arrecadadoTotalUsd ?? 0) > 0
              ? `${((d!.dinheiro.arrecadadoTotalUsd / d!.dinheiro.volumeTotalUsd) * 100).toFixed(3)}%`
              : "—"
          }
        />
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
          <>
          {/* Cabeçalho de coluna: sem ele, "$9,19" e "+$0.0919" são dois
              números soltos e o leitor tem que adivinhar qual é qual. */}
          <div className="mural-cabecalho" aria-hidden>
            <span>TEMPO</span><span>TROCA</span><span>CADEIA</span>
            <span>VOLUME</span><span>TAXA</span>
          </div>
          <ul>
            {d!.trocas.slice(0, 12).map((t) => {
              const k = `${t.quando}|${t.par}`;
              return (
                <li key={k} className={novas.has(k) ? "mural-entrando" : undefined}>
                  <span className="mural-quando">{haQuanto(t.quando, agora)}</span>
                  <span className="mural-par">{`<${t.par.replace("/", "><")}>`}</span>
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
          </>
        )}
      </section>
      </div>

      {/* ⚠️ A BARRA DIZ DE ONDE O DADO VEM E QUANDO. Numa tela ligada o dia
             inteiro, a pergunta mais barata de responder é "isto congelou?" —
             o horário e a contagem de eventos respondem sem ninguém perguntar. */}
      {/* ⚠️ A REFERÊNCIA TRAZIA "NETWORK: 1GBPS" e "SYS_LOAD: 72%" — números
             inventados pela geração da imagem. Métrica falsa em barra de
             status é a mentira mais barata que existe, porque ninguém confere
             rodapé. Aqui vai o que é medido, e por acaso é mais útil: a
             REGIÃO onde esta função executou responde, na parede, a pergunta
             que a migração da Binance abriu. */}
      <footer className="mural-barra">
        <span>[SYSTEM_TIME: <b>{new Date(agora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}</b>]</span>
        <span className="sep">::</span>
        <span>[REGIÃO: <b>{(d?.infra.regiao ?? "—").toUpperCase()}</b>]</span>
        <span className="sep">::</span>
        <span>[LEITURA: <b>{d?.infra.levouMs ?? 0}ms</b>]</span>
        <span className="sep">::</span>
        <span>[PULSO: <b>{d?.pulso.eventos5min ?? 0}</b> ev/5min]</span>
        <span className="sep">::</span>
        <span>[FONTE: <b>supabase</b> · medido, sem projeção]</span>
      </footer>
    </div>
  );
}

/**
 * ⚠️ A ETIQUETA LATERAL É A UNIDADE, e não uma sigla de enfeite.
 *
 * A referência trazia `[RPM]` e `[YPM]` em todas as caixas, inclusive nas que
 * contam carteiras — siglas que a geração da imagem inventou e que não
 * querem dizer nada. Aqui ela diz o que o número É: `USD`, `24H`, `QTD`.
 * Rótulo que não informa ocupa espaço e ensina o leitor a ignorar rótulos.
 */
function Numero({ r, v, destaque, un }: {
  r: string; v: string; destaque?: boolean; un?: string;
}) {
  return (
    <div className={`mural-numero${destaque ? " destaque" : ""}`}>
      {un && <span className="mural-etiqueta">[{un}]</span>}
      <span className="mural-rotulo">{r}</span>
      <strong>{v}</strong>
    </div>
  );
}
