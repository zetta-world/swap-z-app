"use client";

/**
 * A BANCADA — a tela do cliente.
 *
 * ⚠️⚠️ ELA NÃO É O NOSSO LABORATÓRIO COM OUTRA PINTURA. O `/admin` tem 29 mesas,
 * seis a nove colunas por painel e três avisos em âmbar; funciona para quem
 * construiu. Aqui a régua é outra: **uma pergunta por vez, e o custo sempre à
 * vista**.
 *
 * ⚠️ O BLOCO DO PEDÁGIO APARECE ANTES DO BOTÃO e reage a cada tecla. Quem
 * digitar alvo de 0,6% lê *"você precisaria acertar 83%"* sem gastar rodada
 * nenhuma. Metade das ideias ruins morre ali, de graça — e é o melhor negócio
 * possível para os dois lados: ele não perde dinheiro e nós não gastamos CPU.
 *
 * ⚠️ E O VEREDITO VEM ANTES DO PLACAR. Número grande primeiro faz retorno
 * parecer aprovação: foi assim que a grade apareceu VERDE tendo perdido metade
 * do capital.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { Loader2, AlertTriangle, Info, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useUI } from "@/lib/store/ui";
import { shouldTint } from "@/lib/admin/sample";
import {
  identidadeDaMesa, identidadeDaPropria, type Identidade, type Contexto,
} from "@/lib/bancada/identidade";
import { medidaDoPost, medidaDoHistorico, acertoPct, type Medida } from "@/lib/bancada/resposta";
import Agentes from "@/components/bancada/Agentes";
import { oPedagioAntesDeRodar } from "@/lib/bancada/custo";
import { PRACAS, rotuloDaPraca, type EstrategiaDoCliente, type Praca, type Papel } from "@/lib/bancada/vocabulario";
import { classificarResultado } from "@/lib/admin/cor-resultado";
import { corDoNumero } from "@/components/bancada/CorDoCliente";
import type { ChaveNaoMedido } from "@/lib/bancada/veredito";
import { ESTRATEGIAS_DA_CASA, type EstrategiaDaCasa } from "@/lib/bancada/casa";
import { ressalvasComuns, ressalvasSoDeste, mesaPodeRodar, ordenarVitrine, type CartaoDaMesa, type ChaveDeRessalva } from "@/lib/bancada/mesas-da-casa";
import type { MessageKey } from "@/lib/i18n";

const SIMBOLOS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOT", "MATIC"];
const INTERVALOS = ["1h", "4h", "1d"];

interface Vivo {
  mesasLigadas: Array<{
    id: string; nome: string; desde: string | null;
    simbolos: string[]; intervalo: string; abertas: number;
  }>;
  abertas: Array<{
    id: string; estrategiaId: string; simbolo: string; lado: "long" | "short";
    entrada: number; tamanhoUsd: number;
    alvoPct: number | null; stopPct: number | null;
    expiraEm: string | null; abertaEm: string;
  }>;
}

interface Salva {
  id: string; nome: string; arquivada: boolean;
  papelAdiante: boolean; papelDesde: string | null;
}

/** Uma operação do extrato — a mesma forma vindo do POST ou do histórico. */
interface Op {
  simbolo?: string; abriuEm: number; fechouEm: number;
  entrada: number; saida: number;
  desfecho: "alvo" | "stop" | "expirada";
  brutoPct: number; liquidoPct: number; playbook?: string | null;
}

/**
 * UMA RODADA NA TELA — com nome, contexto e hora.
 *
 * ⚠️⚠️ ELA É UM ITEM DE LISTA, NÃO UM ESTADO ÚNICO. Até 07/09 a bancada tinha
 * `const [r, setR]`: a segunda rodada apagava a primeira, e o dono via um
 * `+2,14%` sem dono. *"cada teste que rodo sobrepõe o outro, e não mostra qual
 * agente está rodando"*. Uma lista não sobrepõe nada, e cada item se apresenta.
 *
 * ⚠️ E O CARTÃO NASCE ANTES DA RESPOSTA. É com `estado: "rodando"` que a tela
 * consegue dizer QUAL mesa está rodando enquanto ela roda — o pedido literal.
 */
interface Corrida {
  /** Chave local e estável. ⚠️ Nunca o índice: a lista cresce pela frente. */
  chave: string;
  /** O id no banco — nulo enquanto a resposta não chegou. */
  rodadaId: string | null;
  quando: string;
  identidade: Identidade;
  contexto: Contexto;
  estado: "rodando" | "pronta" | "recusada" | "falhou";
  /** O motivo, palavra por palavra do SERVIDOR — ele carrega o número exato. */
  porque: string | null;
  upgradeUrl: string | null;
  medida: Medida | null;
  /** ⚠️ `null` = ainda não buscadas; `[]` = buscadas e não houve nenhuma. */
  ops: Op[] | null;
  opsCarregando: boolean;
  aberta: boolean;
}

export default function Bancada() {
  const t = useT();

  const [capital, setCapital] = useState(1000);
  const [simbolos, setSimbolos] = useState<string[]>(["BTC"]);
  const [tipo, setTipo] = useState<"media" | "canal" | "rsi">("media");
  const [n, setN] = useState(20);
  const [nivel, setNivel] = useState(30);
  const [direcao, setDirecao] = useState<"compra" | "venda">("compra");
  const [alvoPct, setAlvo] = useState(2.5);
  const [stopPct, setStop] = useState(2.5);
  const [horasLimite, setHoras] = useState(48);
  const [praca, setPraca] = useState<Praca>("spot_gate");
  const [papel, setPapel] = useState<Papel>("taker");
  const [intervalo, setIntervalo] = useState("1d");
  const [janelaDias, setJanela] = useState(365);

  const [rodando, setRodando] = useState(false);
  /**
   * ⚠️⚠️ AS RODADAS SÃO UMA LISTA, DA MAIS NOVA PARA A MAIS VELHA. Ver `Corrida`.
   */
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [restamHoje, setRestamHoje] = useState<number | null>(null);
  const [historicoFalhou, setHistoricoFalhou] = useState(false);
  /**
   * ⚠️ Um contador, não um booleano: contratar dois agentes seguidos precisa
   * disparar DUAS recargas, e `true → true` não é uma mudança que o `useEffect`
   * enxergue.
   */
  const [recarregarAgentes, setRecarregarAgentes] = useState(0);
  /**
   * ⚠️⚠️ QUAIS MESAS JÁ TÊM INSTÂNCIA — para o botão não criar gêmeas.
   *
   * Sem isto, "Contratar" fica aceso depois de contratado e um segundo clique
   * cria uma instância indistinguível da primeira: mesmo nome, mesmo sigilo,
   * dois números diferentes e nenhuma forma de saber qual é qual. O `<Agentes>`
   * informa aqui o que ele carregou — uma fonte só, e ela é a que o servidor
   * devolveu.
   */
  const [jaContratadas, setJaContratadas] = useState<string[]>([]);
  /**
   * ⚠️ A ABA ABRE EM "AGENTES" SÓ QUANDO EXISTE ALGUM. Abrir sempre ali daria a
   * quem nunca contratou uma tela vazia como primeira impressão do produto; e
   * abrir sempre em "contratar" esconderia, de quem já paga, exatamente o que
   * ele paga para ver. O estado inicial é `null` e a decisão espera a resposta
   * do servidor — chutar antes seria trocar de aba na cara do cliente.
   */
  const [abaEscolhida, setAba] = useState<"agentes" | "contratar" | "testar" | "rodadas" | null>(null);
  const [temAgentes, setTemAgentes] = useState<boolean | null>(null);
  const aba = abaEscolhida ?? (temAgentes ? "agentes" : "contratar");
  const [contratando, setContratando] = useState<string | null>(null);
  const [erroDeContratar, setErroDeContratar] = useState<string | null>(null);
  /** ⚠️ QUAL card falhou. O erro renderizado longe do botão que o causou faz o
   *  cliente clicar de novo sem nunca ver o motivo. */
  const [contratarErrouEm, setContratarErrouEm] = useState<string | null>(null);

  const [verCasa, setVerCasa] = useState(false);
  const [mesas, setMesas] = useState<CartaoDaMesa[]>([]);
  const [rodandoMesa, setRodandoMesa] = useState<string | null>(null);
  const [vivo, setVivo] = useState<Vivo | null>(null);
  const [nome, setNome] = useState("");
  const [salvas, setSalvas] = useState<Salva[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [avisoSalvar, setAviso] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const res = await fetch("/api/bancada/estrategias");
      const j = await res.json();
      if (j?.ok) setSalvas(j.estrategias ?? []);
    } catch { /* melhor-esforço: a bancada funciona sem a lista */ }
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);

  /**
   * ⚠️ O QUE ESTÁ RODANDO AGORA. Reconsultado a cada 60s — as mesas tickam com
   * o cron de 30 minutos, então pedir mais rápido só gastaria requisição sem
   * trazer número novo. A tela diz isso ao cliente em vez de fingir cotação
   * ao vivo.
   */
  const recarregarVivo = useCallback(async () => {
    try {
      const res = await fetch("/api/bancada/posicoes");
      const j = await res.json();
      if (j?.ok) setVivo({ mesasLigadas: j.mesasLigadas ?? [], abertas: j.abertas ?? [] });
    } catch { /* melhor-esforço: a bancada funciona sem esta seção */ }
  }, []);
  useEffect(() => {
    void recarregarVivo();
    const id = setInterval(() => { void recarregarVivo(); }, 60_000);
    return () => clearInterval(id);
  }, [recarregarVivo]);

  useEffect(() => {
    // ⚠️ Melhor-esforço: a bancada funciona sem a vitrine. Falhar aqui não
    // pode impedir alguém de rodar um teste.
    (async () => {
      try {
        const res = await fetch("/api/bancada/mesas-da-casa");
        const j = await res.json();
        if (j?.ok && Array.isArray(j.cartoes)) setMesas(j.cartoes);
      } catch { /* silêncio: a seção some, o resto fica */ }
    })();
  }, []);

  /**
   * ⚠️ CARREGAR UMA DA CASA É SÓ PREENCHER O FORMULÁRIO — nada roda sozinho.
   *
   * O cliente vê os parâmetros mudarem, o bloco do pedágio reagir na hora, e
   * decide. Se o botão disparasse a rodada, a estratégia morta gastaria cota
   * para ensinar o que o portão ensina de graça.
   */
  function carregar(e: EstrategiaDaCasa) {
    setTipo(e.params.entrada.tipo);
    setN(e.params.entrada.n);
    if (e.params.entrada.tipo === "rsi") setNivel(e.params.entrada.nivel);
    setDirecao(e.params.direcao);
    setAlvo(e.params.alvoPct);
    setStop(e.params.stopPct);
    setHoras(e.params.horasLimite);
    setPraca(e.params.praca);
    setPapel(e.params.papel);
    // ⚠️ NÃO limpa as rodadas. Carregar um exemplo é mudar o formulário; apagar
    // o que já foi medido seria destruir trabalho do cliente por um clique que
    // ele deu para COMPARAR.
  }

  const estrategia: EstrategiaDoCliente = useMemo(() => ({
    entrada: tipo === "rsi" ? { tipo, n, nivel } : { tipo, n },
    direcao, alvoPct, stopPct, horasLimite, praca, papel,
  }), [tipo, n, nivel, direcao, alvoPct, stopPct, horasLimite, praca, papel]);

  /**
   * ⚠️ O PEDÁGIO É CALCULADO AQUI, NO CLIENTE, pela MESMA função do servidor —
   * a tabela de taxas é literal e idêntica dos dois lados. O que NÃO se decide
   * aqui é a recusa: quem tem a palavra final é a rota, e a resposta dela é que
   * vira mensagem. Uma UI que negasse por conta própria poderia divergir do
   * servidor sem ninguém perceber.
   */
  const pedagio = useMemo(() => oPedagioAntesDeRodar(estrategia), [estrategia]);

  async function salvar() {
    setOcupado(true); setAviso(null);
    try {
      const res = await fetch("/api/bancada/estrategias", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estrategia, nome, simbolos, intervalo }),
      });
      const j = await res.json();
      // ⚠️ O motivo vem do SERVIDOR como veio: ele carrega o número exato (o
      // teto do plano, o alvo mínimo) que uma frase genérica apagaria.
      if (!j?.ok) setAviso(j?.porque ?? t("bancada.errorTitle"));
      else { setNome(""); await recarregar(); }
    } catch { setAviso(t("bancada.errorTitle")); }
    finally { setOcupado(false); }
  }

  async function alternarPapel(e: Salva) {
    setOcupado(true); setAviso(null);
    try {
      const res = await fetch("/api/bancada/estrategias", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, papelAdiante: !e.papelAdiante }),
      });
      const j = await res.json();
      if (!j?.ok) setAviso(j?.porque ?? t("bancada.papelSo"));
      await recarregar();
      await recarregarVivo();   // ⚠️ ligar a mesa tem de aparecer na hora
    } catch { setAviso(t("bancada.errorTitle")); }
    finally { setOcupado(false); }
  }

  /**
   * ⚠️⚠️ O HISTÓRICO ENTRA NA TELA — e é a metade do conserto que não se vê.
   *
   * Sem isto, recarregar a página apagava a tarde inteira de testes: as
   * rodadas continuavam no banco (`bancada_rodada` desde a fase 1) e nenhuma
   * tela as lia de volta. É o mesmo defeito que `bancada_posicao` teve — a peça
   * existe, é testada, e está desligada do caminho que o cliente enxerga.
   *
   * ⚠️ ELAS CHEGAM FECHADAS. Trinta cartões abertos seriam uma tela de rolagem
   * sem hierarquia; o que o cliente quer ao chegar é reconhecer a rodada, não
   * reler o extrato dela.
   */
  const carregarHistorico = useCallback(async () => {
    try {
      const res = await fetch("/api/bancada/rodadas");
      const j = await res.json();
      if (!j?.ok || !Array.isArray(j.rodadas)) { setHistoricoFalhou(true); return; }
      setHistoricoFalhou(false);
      setCorridas(j.rodadas.map((r: Record<string, unknown>): Corrida => {
        const st = r.status;
        return {
          chave: `db:${String(r.id)}`,
          rodadaId: String(r.id),
          quando: String(r.quando ?? ""),
          identidade: r.identidade as Identidade,
          contexto: r.contexto as Contexto,
          estado: st === "recusada" ? "recusada"
            : st === "falhou" ? "falhou"
            // ⚠️ `rodando` no banco é uma rodada que nunca fechou (deploy no
            // meio, timeout). Ela NÃO volta com giro eterno na tela: isso
            // prometeria um resultado que não vem mais.
            : st === "rodando" ? "falhou"
            : "pronta",
          porque: typeof r.porque === "string" ? r.porque : null,
          upgradeUrl: null,
          medida: medidaDoHistorico(r.resultado),
          ops: null, opsCarregando: false, aberta: false,
        };
      }));
    } catch { setHistoricoFalhou(true); }
  }, []);
  useEffect(() => { void carregarHistorico(); }, [carregarHistorico]);

  /** Troca UMA corrida pela chave, sem tocar nas outras. */
  const atualizar = useCallback((chave: string, mudanca: Partial<Corrida>) => {
    setCorridas((atual) => atual.map((c) => (c.chave === chave ? { ...c, ...mudanca } : c)));
  }, []);

  /**
   * Abre (ou fecha) o extrato de uma rodada.
   *
   * ⚠️ AS OPERAÇÕES DA RODADA RELIDA SÃO BUSCADAS SOB DEMANDA. Uma rodada de
   * mesa sobre quatro pares passa de 300 linhas; mandar isso trinta vezes só
   * para desenhar uma lista de títulos seria pagar o extrato inteiro de todo
   * mundo para mostrar um nome.
   */
  const alternarExtrato = useCallback(async (c: Corrida) => {
    if (c.aberta) { atualizar(c.chave, { aberta: false }); return; }
    atualizar(c.chave, { aberta: true });
    if (c.ops != null || c.rodadaId == null || c.opsCarregando) return;
    atualizar(c.chave, { opsCarregando: true });
    try {
      const res = await fetch(`/api/bancada/rodadas?id=${encodeURIComponent(c.rodadaId)}`);
      const j = await res.json();
      // ⚠️ Falha vira `[]`? NÃO. `[]` afirma "não houve operação"; deixar em
      // `null` mantém o botão tentando de novo, que é a verdade.
      atualizar(c.chave, {
        ops: j?.ok && Array.isArray(j.operacoes) ? (j.operacoes as Op[]) : null,
        opsCarregando: false,
      });
    } catch { atualizar(c.chave, { opsCarregando: false }); }
  }, [atualizar]);

  /**
   * ⚠️⚠️ O CARTÃO NASCE ANTES DA RESPOSTA — e é isto que responde ao *"não
   * mostra qual agente está rodando"*. A identidade e o contexto são conhecidos
   * no instante do clique; esperar o servidor para exibi-los seria esconder por
   * trinta segundos a única coisa que o cliente precisa ver enquanto espera.
   */
  function abrirCartao(identidade: Identidade, ctx: Contexto): string {
    /**
     * ⚠️⚠️ LEVA O CLIENTE ATÉ O RESULTADO. Com o histórico em aba própria, quem
     * aperta "Rodar teste" ficaria olhando o formulário enquanto a resposta
     * chega numa porta que ele não está vendo — o mesmo defeito que a auditoria
     * achou na rolagem única ("os botões primários entregam o resultado fora da
     * tela"), só que pior, porque agora a distância é uma aba inteira.
     */
    setAba("rodadas");
    const chave = `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    /**
     * ⚠️ A NOVA NASCE ABERTA, E AS ANTERIORES FECHAM.
     *
     * O bloco "NÃO medido" tem quatro itens e é reimpresso por rodada aberta;
     * como toda rodada da sessão nascia aberta, três testes seguidos empilhavam
     * três cópias do mesmo aviso — a mesma repetição que o dono viu nos cards
     * das mesas. O que ele quer ver aberto é o que acabou de rodar; o resto
     * continua a um clique.
     */
    setCorridas((atual) => [{
      chave, rodadaId: null, quando: new Date().toISOString(),
      identidade, contexto: ctx, estado: "rodando",
      porque: null, upgradeUrl: null, medida: null,
      ops: null, opsCarregando: false, aberta: true,
    }, ...atual.map((c) => (c.aberta ? { ...c, aberta: false } : c))]);
    return chave;
  }

  /**
   * ⚠️ Uma resposta do POST fecha o cartão que a pediu — pela CHAVE, nunca pela
   * posição. Duas rodadas podem estar no ar ao mesmo tempo (a mesa e a própria),
   * e a segunda a responder não pode escrever no cartão da primeira.
   */
  function fecharCartao(chave: string, j: Record<string, unknown> | null) {
    if (!j || j.ok !== true) {
      atualizar(chave, {
        estado: "recusada",
        porque: typeof j?.porque === "string" ? j.porque : null,
        upgradeUrl: typeof j?.upgradeUrl === "string" ? j.upgradeUrl : null,
      });
      return;
    }
    if (typeof j.restamHoje === "number") setRestamHoje(j.restamHoje);
    atualizar(chave, {
      estado: "pronta",
      rodadaId: typeof j.rodadaId === "string" ? j.rodadaId : null,
      medida: medidaDoPost(j),
      // ⚠️ O POST já traz o extrato: não há segunda volta a dar.
      ops: Array.isArray(j.operacoes) ? (j.operacoes as Op[]) : [],
    });
  }

  /**
   * ⚠️⚠️ CONTRATAR É DIFERENTE DE TESTAR, e as duas coisas convivem no card.
   *
   *   · **testar no passado** — o backtest: a mesma regra sobre a janela que
   *     ele escolheu. Passado obedecendo. Custa uma vez.
   *   · **contratar** — nasce uma INSTÂNCIA dele, que passa a tickar a cada 30
   *     minutos e a acumular o resultado DELE, do zero. Presente discordando.
   *     Custa para sempre, e por isso está atrás do portão do `trader`.
   *
   * ⚠️ Os símbolos e a praça saem do FORMULÁRIO abaixo — os mesmos que ele
   * usaria para testar. Um agente contratado com símbolos que ele não escolheu
   * seria uma instância dele com uma pergunta nossa.
   */
  async function contratar(m: CartaoDaMesa) {
    setContratando(m.source);
    setErroDeContratar(null);
    setContratarErrouEm(null);
    try {
      const res = await fetch("/api/bancada/agentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mesa: m.source, simbolos, praca, papel }),
      });
      const j = await res.json();
      if (!j?.ok) {
        // ⚠️ O motivo vem do SERVIDOR e é mostrado como veio: ele carrega o
        // número exato (o teto do plano, o símbolo que falta).
        setErroDeContratar(typeof j?.porque === "string" ? j.porque : t("bancada.errorTitle"));
        setContratarErrouEm(m.source);
        return;
      }
      setRecarregarAgentes((n) => n + 1);
      // ⚠️ E contratar leva para "meus agentes": a instância acabou de nascer,
      // e é lá que ela vive. Ficar na vitrine deixaria o cliente sem saber se
      // deu certo — a não ser voltando a clicar no botão que já foi.
      setAba("agentes");
    } catch {
      setErroDeContratar(t("bancada.errorTitle"));
      setContratarErrouEm(m.source);
    } finally {
      setContratando(null);
    }
  }

  /**
   * ⚠️ Roda o SELETOR REAL da mesa sobre a janela do cliente — não uma
   * tradução dela para o formulário. Manda `mesa`, e a rota não aceita alvo
   * nem stop neste modo: eles saem do playbook.
   */
  async function rodarMesa(m: CartaoDaMesa) {
    setRodandoMesa(m.source);
    // ⚠️ `1h` porque é assim que a mesa CAMINHA, qualquer que seja o intervalo
    // marcado no formulário — a rota faz o mesmo, e o cartão tem de dizer a
    // verdade sobre o que rodou.
    const chave = abrirCartao(identidadeDaMesa(m.source, m.nome), {
      simbolos, intervalo: "1h", janelaDias, praca, papel, capitalUsd: capital,
    });
    try {
      const res = await fetch("/api/bancada/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mesa: m.source, simbolos, capitalUsd: capital, janelaDias,
          praca, papel,
        }),
      });
      fecharCartao(chave, await res.json());
    } catch {
      atualizar(chave, { estado: "falhou", porque: null });
    } finally {
      setRodandoMesa(null);
    }
  }

  async function rodar() {
    setRodando(true);
    const chave = abrirCartao(identidadeDaPropria(estrategia), {
      simbolos, intervalo, janelaDias, praca, papel, capitalUsd: capital,
    });
    try {
      const res = await fetch("/api/bancada/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estrategia, simbolos, intervalo, capitalUsd: capital, janelaDias }),
      });
      fecharCartao(chave, await res.json());
    } catch {
      atualizar(chave, { estado: "falhou", porque: null });
    } finally {
      setRodando(false);
    }
  }

  /**
   * ⚠️ A INTERSEÇÃO É CALCULADA SOBRE OS CARDS QUE A TELA MOSTRA, não sobre uma
   * lista fixa: uma ressalva nova, ou um card que fuja do padrão, muda o corte
   * sozinho. Não há literal a envelhecer em silêncio.
   */
  const comuns = ressalvasComuns(mesas);
  /**
   * ⚠️⚠️ AS QUE PAGAM NA FRENTE, O RESTO RECOLHIDO — E A CONTAGEM À MOSTRA.
   *
   * O dono pediu *"só as verdes, nada vermelho ou cinza"*. O pedido por trás é
   * legítimo: a tela virava um cemitério. Mas EXCLUIR pelo resultado é viés de
   * sobrevivência — e esta base já nomeou a armadilha um nível abaixo, na nota
   * de `/api/bancada/mesas-da-casa`: *"incluir o passado ruim é o que impede a
   * vitrine de escolher a própria sorte"*.
   *
   * Então a separação é VISUAL. Ele ganha a tela limpa; o investidor continua
   * podendo ver quantas mesas existem e quantas perderam. Esconder o número é
   * a mentira; recolher dizendo quantas são, não é.
   */
  const vitrine = ordenarVitrine(mesas);
  const [mostrarOResto, setMostrarOResto] = useState(false);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{t("bancada.title")}</h1>
        <p className="mt-1 text-sm text-ink-3">{t("bancada.subtitle")}</p>
      </header>

      {/* ── OS TRÊS TRABALHOS, SEPARADOS ────────────────────────────── */}
      {/* ⚠️⚠️ NOVE SEÇÕES NUMA ROLAGEM SÓ, TODAS COM O MESMO PESO (07/09).
          O dono: *"está uma bagunça horrível... jogando informações em cima de
          informações deixando tudo misturado"*.

          Quem chega aqui está fazendo UMA de três coisas — acompanhar o que já
          contratou, escolher o que contratar, ou experimentar uma ideia — e as
          três estavam intercaladas. Pior: o trabalho PRIMÁRIO (acompanhar) era
          uma seção entre nove, e o resultado dos dois botões principais caía
          fora da tela, em direções opostas.

          ⚠️ NADA FOI APAGADO: as mesmas seções, em três portas. E a aba abre em
          "meus agentes" QUANDO EXISTE algum — quem já pagou vê primeiro o que
          pagou; quem ainda não tem nada cai em "contratar", que é o próximo
          passo dele. */}
      <nav className="flex gap-1 rounded-xl border border-white/5 bg-bg-1/40 p-1">
        {([
          ["agentes",   jaContratadas.length > 0
            ? t("bancada.abaAgentesN", { n: jaContratadas.length })
            : t("bancada.abaAgentes")],
          ["contratar", t("bancada.abaContratar")],
          ["testar",    t("bancada.abaTestar")],
          ["rodadas",   corridas.length > 0
            ? t("bancada.abaRodadasN", { n: corridas.length })
            : t("bancada.abaRodadas")],
        ] as const).map(([id, rotulo]) => (
          <button key={id} type="button" onClick={() => setAba(id)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs transition ${
              aba === id ? "bg-bg-2 text-ink" : "text-ink-3 hover:text-ink-2"}`}>
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === "agentes" && (<>
      {/* ── OS AGENTES DELE, ANTES DOS NOSSOS ───────────────────────── */}
      {/* ⚠️⚠️ A ORDEM É A CORREÇÃO. O que o investidor contratou vem PRIMEIRO,
          com o número dele; o placar da nossa mesa vem depois, rotulado como
          nosso. Invertido, a primeira coisa que ele lê é o nosso resultado — e
          foi assim que a bancada acabou "pegando os resultados das mesas do
          painel e Admin e repetindo para o investidor". */}
      <Agentes recarregar={recarregarAgentes} onMesas={(m) => { setJaContratadas(m); setTemAgentes(m.length > 0); }} />

      </>)}

      {aba === "contratar" && (<>
      {/* ── O QUE A CASA DE FATO RODA ──────────────────────────────── */}
      {/* ⚠️⚠️ VITRINE, NÃO CLONE — e a diferença é honestidade, não preguiça.
          Estas mesas usam bracket por VOLATILIDADE (stop = ATR×1,5, alvo
          limitado a ATR×√horas×2) e escolhem entre 10 playbooks por regime de
          mercado. O formulário abaixo fala `média|canal|RSI` com percentual
          fixo. Aproximar uma mesa nisso e pôr o nome dela em cima seria o
          cliente rodando uma coisa achando que é outra — com a nossa marca, e
          com números que vieram da regra REAL, não da aproximação. */}
      {mesas.length > 0 && (
        <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5">
          <p className="text-sm font-medium text-ink">{t("bancada.mesasTitulo")}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{t("bancada.mesasSub")}</p>
          {/* ⚠️⚠️ DITO UMA VEZ, NA SEÇÃO — não em dez cards dourados. O rótulo
              "o que a NOSSA mesa fez" é verdade sobre TODOS os números desta
              lista, e repeti-lo em cada um treinava o olho a pular a linha. */}
          <p className="mt-2 text-[11px] leading-relaxed text-gold/80">{t("bancada.mesasDaCasaNumero")}</p>
          {/* ⚠️ A EXPLICAÇÃO DOS DOIS NÚMEROS, uma vez, antes deles. "Bem
              explicado" era metade do pedido — e um número sem a régua ao lado
              é a metade que engana. */}
          <p className="mt-2 text-[11px] leading-relaxed text-ink-4">{t("bancada.mesasDoisNumeros")}</p>
          <ul className="mt-3 space-y-2">
            {vitrine.verdes.map((m) => (
              <MesaDaCasa key={m.source} m={m} rodando={rodandoMesa === m.source}
                contratando={contratando === m.source}
                jaContratada={jaContratadas.includes(m.source)}
                soDeste={ressalvasSoDeste(m, comuns)}
                comOQue={{ simbolos, praca: rotuloDaPraca(praca), papel }}
                erro={contratarErrouEm === m.source ? erroDeContratar : null}
                onRodar={() => rodarMesa(m)}
                onContratar={() => void contratar(m)} />
            ))}
          </ul>

          {/* ⚠️⚠️ O RESTO, RECOLHIDO MAS CONTADO. O botão diz quantas são e
              quantas PERDERAM — antes de qualquer clique. É esta linha que
              separa "a tela está limpa" de "a vitrine escolheu a própria
              sorte": o investidor sabe que elas existem sem precisar abrir. */}
          {vitrine.oResto.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setMostrarOResto((v) => !v)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/5 bg-bg-2/60 px-3 py-2 text-xs text-ink-3 transition hover:border-white/15 hover:text-ink-2">
                <span>{mostrarOResto
                  ? t("bancada.mesasEsconderResto")
                  : t("bancada.mesasVerOResto", { n: vitrine.oResto.length, neg: vitrine.quantasNegativas })}</span>
                <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${mostrarOResto ? "rotate-180" : ""}`} />
              </button>
              {mostrarOResto && (
                <>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-4">{t("bancada.mesasPorqueOResto")}</p>
                  <ul className="mt-2 space-y-2">
                    {vitrine.oResto.map((m) => (
                      <MesaDaCasa key={m.source} m={m} rodando={rodandoMesa === m.source}
                        contratando={contratando === m.source}
                        jaContratada={jaContratadas.includes(m.source)}
                        soDeste={ressalvasSoDeste(m, comuns)}
                        comOQue={{ simbolos, praca: rotuloDaPraca(praca), papel }}
                        erro={contratarErrouEm === m.source ? erroDeContratar : null}
                        onRodar={() => rodarMesa(m)}
                        onContratar={() => void contratar(m)} />
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {/* ⚠️⚠️ A NOTA DE RODAPÉ DA SEÇÃO — o que vale para TODOS os cards.
              Medido: 4 frases × 10 cards = ~4.000 caracteres idênticos numa
              rolagem de celular. O corte é por INTERSEÇÃO (`ressalvasComuns`),
              então nada some: o que distingue um card continua NELE. */}
          {comuns.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-white/5 pt-3 text-[11px] leading-relaxed text-ink-4">
              {comuns.map((r) => <li key={r}>· {t(r as MessageKey)}</li>)}
            </ul>
          )}
          {/* ⚠️ E o motivo de uma mesa não ter botão, dito uma vez em vez de
              oito. A AUSÊNCIA do botão já é o sinal; isto é a legenda dele. */}
          {mesas.some((m) => !m.podeRodar) && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-4">{t("bancada.mesasSoVitrine")}</p>
          )}
        </section>
      )}

      </>)}

      {aba === "testar" && (<>
      {/* ── AS ESTRATÉGIAS DA CASA, INCLUSIVE AS MORTAS ─────────────── */}
      {/* ⚠️ RECOLHIDA POR PADRÃO. Sete entradas com descrição e lápide somam
          uma tela inteira, e no celular empurravam a FERRAMENTA para fora da
          primeira dobra — quem chega via um catálogo, não uma bancada. Ela
          continua a um toque, e o rótulo diz quantas são. */}
      <section className="rounded-2xl border border-white/5 bg-bg-1/40">
        <button type="button" onClick={() => setVerCasa((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
          <span>
            <span className="block text-sm font-medium text-ink">
              {t("bancada.casaVer", { n: ESTRATEGIAS_DA_CASA.length })}
            </span>
            <span className="mt-0.5 block text-xs text-ink-3">{t("bancada.casaSub")}</span>
          </span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 text-ink-3 transition-transform ${verCasa ? "rotate-180" : ""}`} />
        </button>

        {verCasa && (
          <ul className="space-y-2 px-5 pb-5">
            {ESTRATEGIAS_DA_CASA.map((e) => (
              <li key={e.id} className="rounded-xl border border-white/5 bg-bg-2/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">
                      {t(e.nomeKey as MessageKey)}{" "}
                      {/* ⚠️ A morta NÃO some e NÃO fica vermelha: ela é o material
                          didático mais barato que temos. Cinza + rótulo. */}
                      <span className={`ml-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${
                        e.viva ? "border-cyan/30 text-cyan" : "border-white/10 text-ink-3"}`}>
                        {e.viva ? t("bancada.casaViva") : t("bancada.casaMorta")}
                      </span>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-3">{t(e.comoFuncionaKey as MessageKey)}</p>
                    {e.medicao && (
                      <p className="mt-1.5 text-xs leading-relaxed">
                        {/* ⚠️ O NÚMERO NUNCA SAI SEM A JANELA. Medição sem data é
                            propaganda, e o resultado da casa não é previsão para
                            a janela do cliente. */}
                        <span className="font-medium text-gold">{e.medicao.resultado}</span>
                        <span className="text-ink-4"> · </span>
                        <span className="text-ink-4">{t("bancada.casaMedidoEm", { quando: e.medicao.quando })}</span>
                        <br />
                        <span className="text-ink-3">{t(e.medicao.porqueKey as MessageKey)}</span>
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => carregar(e)}
                    className={`flex-shrink-0 ${CHIP} ${CHIP_OFF}`}>
                    {t("bancada.casaUsar")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── MONTE SEU TESTE ─────────────────────────────────────────── */}
      {/* ⚠️ AGRUPADO, e não um campo por bloco. A versão anterior dava uma
          linha inteira a cada pergunta: no celular virava uma coluna de
          rolagem sem hierarquia, em que "capital" e "intervalo da vela" tinham
          o mesmo peso visual. §2.4 do plano pede UMA PERGUNTA POR VEZ — o que
          não é o mesmo que um campo por tela. */}
      <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 space-y-5">

        {/* dinheiro e janela: os três números que emolduram o teste */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="col-span-2 block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-ink-3">{t("bancada.capital")}</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-4">$</span>
              <input type="number" min={1} value={capital} onChange={(e) => setCapital(Number(e.target.value))}
                className={`${INPUT} pl-7`} />
            </div>
          </label>
          <Escolha rotulo={t("bancada.window")} valor={janelaDias} set={setJanela}
            opcoes={[90, 365, 730].map((d) => ({ v: d, r: `${d}${t("bancada.days").slice(0, 1)}` }))} />
          <Escolha rotulo="—" valor={intervalo} set={setIntervalo}
            opcoes={INTERVALOS.map((i) => ({ v: i, r: i }))} />
        </div>

        <Campo rotulo={t("bancada.symbols")}>
          <div className="flex flex-wrap gap-1.5">
            {SIMBOLOS.map((sim) => (
              <button key={sim} type="button"
                onClick={() => setSimbolos((atual) => atual.includes(sim) ? atual.filter((x) => x !== sim) : [...atual, sim])}
                className={`${CHIP} ${simbolos.includes(sim) ? CHIP_ON : CHIP_OFF}`}>
                {sim}
              </button>
            ))}
          </div>
        </Campo>

        {/* ⚠️ O GATILHO EM TRÊS FICHAS CURTAS, com a frase inteira EMBAIXO.
            Antes cada opção era um botão de largura total com a frase dentro
            ("Fechamento cruza a média de 20 períodos"), e três parágrafos
            empilhados não se leem como um seletor — se leem como uma lista. */}
        <Campo rotulo={t("bancada.trigger")}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex gap-1.5">
              {(["media", "canal", "rsi"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setTipo(k)}
                  className={`${CHIP} ${tipo === k ? CHIP_ON : CHIP_OFF}`}>
                  {k === "media" ? t("bancada.triggerMediaCurto")
                    : k === "canal" ? t("bancada.triggerCanalCurto") : t("bancada.triggerRsiCurto")}
                </button>
              ))}
            </div>
            <Mini rotulo={t("bancada.period")} valor={n} set={setN} min={2} max={400} estreito />
            {tipo === "rsi" && <Mini rotulo={t("bancada.level")} valor={nivel} set={setNivel} min={5} max={95} estreito />}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-4">
            {tipo === "media" ? t("bancada.triggerMedia", { n })
              : tipo === "canal" ? t("bancada.triggerCanal", { n }) : t("bancada.triggerRsi", { n, nivel })}
          </p>
        </Campo>

        {/* direção, alvo, stop e tempo: as quatro que definem a operação */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo rotulo={t("bancada.direction")}>
            <div className="flex gap-1.5">
              {(["compra", "venda"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDirecao(d)}
                  className={`${CHIP} flex-1 ${direcao === d ? CHIP_ON : CHIP_OFF}`}>
                  {d === "compra" ? t("bancada.buy") : t("bancada.sell")}
                </button>
              ))}
            </div>
          </Campo>
          <Mini rotulo={`${t("bancada.target")} %`} valor={alvoPct} set={setAlvo} min={0.05} max={100} passo={0.1} />
          <Mini rotulo={`${t("bancada.stop")} %`} valor={stopPct} set={setStop} min={0.05} max={100} passo={0.1} />
          <Mini rotulo={`${t("bancada.horizon")} · h`} valor={horasLimite} set={setHoras} min={1} max={2160} />
        </div>

        {/* ⚠️ PRAÇA E PAPEL SEPARADOS. Como seis botões combinados eles
            quebravam em três linhas, e o cliente tinha de procurar a
            combinação certa em vez de escolher duas coisas. */}
        <Campo rotulo={t("bancada.venue")}>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRACAS.map((pr) => (
              <button key={pr} type="button" onClick={() => setPraca(pr)}
                className={`${CHIP} ${praca === pr ? CHIP_ON : CHIP_OFF}`}>
                {rotuloDaPraca(pr)}
              </button>
            ))}
            <span className="mx-1 text-ink-5">·</span>
            {(["maker", "taker"] as const).map((pa) => (
              <button key={pa} type="button" onClick={() => setPapel(pa)}
                className={`${CHIP} ${papel === pa ? CHIP_ON : CHIP_OFF}`}>
                {pa}
              </button>
            ))}
          </div>
        </Campo>
      </section>

      {/* ── O PEDÁGIO, ANTES DO BOTÃO ───────────────────────────────── */}
      <section className={`rounded-2xl border p-5 ${
        pedagio.severidade === "grave" ? "border-red/30 bg-red/5"
        : pedagio.severidade === "atencao" ? "border-gold/30 bg-gold/5"
        : "border-white/5 bg-bg-1/40"}`}>
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-ink-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("bancada.tollTitle")}
        </div>
        <p className="mt-2 text-sm text-ink">
          {t("bancada.tollRoundTrip", {
            pct: pedagio.idaEVoltaPct.toFixed(3),
            fatia: pedagio.fatiaDoAlvo == null ? "—" : (pedagio.fatiaDoAlvo * 100).toFixed(0),
          })}
        </p>
        {pedagio.equilibrio && (
          <p className={`mt-1 text-sm ${pedagio.equilibrio.alcancavel ? "text-ink-2" : "text-red"}`}>
            {pedagio.equilibrio.alcancavel
              ? t("bancada.tollBreakeven", { pct: pedagio.equilibrio.acertoParaEmpatarPct.toFixed(1) })
              : t("bancada.tollImpossible")}
          </p>
        )}

        <button type="button" onClick={rodar} disabled={rodando || simbolos.length === 0}
          className="mt-4 w-full rounded-xl bg-grad-cyan px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-40">
          {rodando ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{t("bancada.running")}</span> : t("bancada.run")}
        </button>
        {restamHoje != null && (
          <p className="mt-2 text-center text-xs text-ink-3">
            {restamHoje === 1 ? t("bancada.quotaLeftUm") : t("bancada.quotaLeft", { n: restamHoje })}
          </p>
        )}
      </section>

      {/* ── SALVAR, E AS MESAS VIVAS ────────────────────────────────── */}
      <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 space-y-3">
        <div className="flex gap-2">
          <input value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder={t("bancada.nomePlaceholder")} className={INPUT} />
          <button type="button" onClick={salvar} disabled={ocupado}
            className="flex-shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs text-ink-2 hover:border-cyan/40 hover:text-cyan transition disabled:opacity-40">
            {t("bancada.salvar")}
          </button>
        </div>
        {avisoSalvar && <p className="text-xs text-gold">{avisoSalvar}</p>}

        <div>
          <p className="text-xs text-ink-3">{t("bancada.minhasTitulo")}</p>
          {salvas.length === 0 ? (
            <p className="mt-1 text-xs text-ink-4">{t("bancada.minhasVazio")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {salvas.filter((e) => !e.arquivada).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-bg-2/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink">{e.nome}</p>
                    {/* ⚠️ A mesa viva mostra DESDE QUANDO: resultado de papel
                        adiante sem o tempo decorrido é número sem amostra. */}
                    {e.papelAdiante && e.papelDesde && (
                      <p className="text-[11px] text-green">
                        {t("bancada.papelLigado", { desde: e.papelDesde.slice(0, 10) })}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => alternarPapel(e)} disabled={ocupado}
                    className={`flex-shrink-0 rounded-lg border px-2.5 py-1 text-xs transition disabled:opacity-40 ${
                      e.papelAdiante ? "border-green/30 text-green" : "border-white/10 text-ink-3 hover:border-cyan/40 hover:text-cyan"}`}>
                    {e.papelAdiante ? t("bancada.papelDesligar") : t("bancada.papelLigar")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      </>)}

      {/* ⚠️⚠️ AS PRÓPRIAS VIVAS VÃO PARA "ACOMPANHAR", junto dos agentes:
          é o mesmo trabalho — ver o que está trabalhando por mim agora. Elas
          estavam na aba do construtor porque nasceram ali, não porque
          pertencem ali. */}
      {aba === "agentes" && (<>
      {/* ── O QUE ESTÁ RODANDO AGORA ────────────────────────────────── */}
      {/* ⚠️ `bancada_posicao` era escrita pelo cron desde a fase 6 e NENHUMA
          tela a lia: a mesa tickava, abria e fechava, e o dono dela não tinha
          como ver. A peça existia, era testada, e estava desligada do caminho
          que decide — do lado do cliente desta vez. */}
      {vivo && (vivo.mesasLigadas.length > 0 || vivo.abertas.length > 0) && (
        <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5">
          <p className="text-sm font-medium text-ink">{t("bancada.vivoTitulo")}</p>

          <ul className="mt-3 space-y-2">
            {vivo.mesasLigadas.map((m) => {
              const suas = vivo.abertas.filter((p) => p.estrategiaId === m.id);
              return (
                <li key={m.id} className="rounded-xl border border-white/5 bg-bg-2/60 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-ink">
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green align-middle" />
                      {m.nome}
                    </span>
                    {m.desde && (
                      <span className="text-[11px] text-ink-4">
                        {t("bancada.vivoDesde", { desde: m.desde.slice(0, 10) })}
                      </span>
                    )}
                  </div>

                  {/* ⚠️ "Ligada e ainda sem setup" NÃO é o mesmo que "desligada",
                      e uma tela vazia confundiria os dois. */}
                  {suas.length === 0 ? (
                    <p className="mt-1 text-xs text-ink-3">{t("bancada.vivoLigadaSemPos")}</p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {suas.map((p) => (
                        <li key={p.id} className="rounded-lg border border-white/5 bg-bg/40 px-2.5 py-1.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-ink">{p.simbolo} · {p.lado}</span>
                            <span className="text-[11px] text-ink-3">
                              {t("bancada.vivoAberta", { desde: p.abertaEm.slice(0, 10) })}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-4">
                            {t("bancada.vivoEntrada", { preco: p.entrada.toFixed(4) })}
                            {p.alvoPct != null && p.stopPct != null && (
                              <> · {t("bancada.vivoAlvoStop", { alvo: p.alvoPct, stop: p.stopPct })}</>
                            )}
                            {p.expiraEm && <> · {t("bancada.vivoExpira", { quando: p.expiraEm.slice(0, 10) })}</>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {/* ⚠️ DIZER A CADÊNCIA É PARTE DA HONESTIDADE: chamar de "tempo real"
              algo que anda de 30 em 30 minutos criaria a expectativa errada. */}
          <p className="mt-3 border-t border-white/5 pt-2 text-[11px] leading-relaxed text-ink-4">
            {t("bancada.vivoTick")}
          </p>
        </section>
      )}

      {vivo && vivo.mesasLigadas.length === 0 && vivo.abertas.length === 0 && salvas.some((e) => !e.arquivada) && (
        <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5">
          <p className="text-sm font-medium text-ink">{t("bancada.vivoTitulo")}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">{t("bancada.vivoNenhuma")}</p>
        </section>
      )}

      </>)}

      {/* ⚠️⚠️ O HISTÓRICO GANHA PORTA PRÓPRIA (07/09). O dono: *"o primeiro
          erro é ele estar na mesma tela onde o cliente pode montar sua própria
          estratégia"*. Consultar o que já rodou e montar algo novo são
          trabalhos diferentes, e o histórico empurrava o construtor para fora
          da tela — sete cartões de consulta sempre montados embaixo da
          ferramenta. */}
      {aba === "rodadas" && (<>
      {/* ── AS RODADAS, EMPILHADAS ──────────────────────────────────── */}
      {/* ⚠️⚠️ UMA LISTA, DA MAIS NOVA PARA A MAIS VELHA. Antes de 07/09 aqui
          havia um estado único: a segunda rodada apagava a primeira, e o
          número que sobrava não dizia de onde veio. O dono: *"cada teste que
          rodo sobrepõe o outro, e não mostra qual agente está rodando... cadê a
          experiência Premium?"*. Comparar duas ideias é o trabalho inteiro
          desta tela — e não dá para comparar o que foi apagado. */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">{t("bancada.histTitulo")}</p>
            <p className="mt-0.5 text-xs text-ink-3">{t("bancada.histSub")}</p>
            {/* ⚠️⚠️ DITO NO TOPO DA SEÇÃO, e é a correção de um rótulo meu.
                O card de uma rodada de mesa dizia "mesa da casa", descrevendo a
                origem da REGRA — e o dono leu, com razão, como a origem do
                NÚMERO: *"ele está com os dados e resultados da mesa do torneio e
                não do teste do cliente"*. O número sempre foi dele; era a
                etiqueta que afirmava o contrário. */}
            <p className="mt-1 text-[11px] leading-relaxed text-cyan/70">{t("bancada.histTudoSeu")}</p>
          </div>
          {corridas.length > 0 && (
            <span className="flex-shrink-0 text-xs tabular-nums text-ink-4">{corridas.length}</span>
          )}
        </div>

        {/* ⚠️ A FALHA DE LEITURA TEM NOME. Uma lista vazia por erro de rede e
            uma lista vazia por nunca ter rodado nada são a mesma imagem e
            coisas opostas — e a primeira faria o cliente achar que perdeu o
            trabalho dele. */}
        {historicoFalhou && corridas.length === 0 && (
          <p className="rounded-2xl border border-gold/30 bg-gold/5 p-4 text-xs leading-relaxed text-gold">
            {t("bancada.histFalha")}
          </p>
        )}

        {!historicoFalhou && corridas.length === 0 && (
          <p className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 text-xs text-ink-3">
            {t("bancada.histVazio")}
          </p>
        )}

        {corridas.map((c) => (
          <CartaoDeRodada key={c.chave} c={c} onAlternar={() => void alternarExtrato(c)} />
        ))}
      </section>
      </>)}
    </div>
  );
}

/**
 * ⚠️ A HORA NO IDIOMA DE QUEM LÊ. Uma pilha de rodadas sem hora é uma pilha
 * sem ordem legível — "a de antes" e "a de ontem" viram a mesma coisa.
 */
const BCP47: Record<string, string> = { pt: "pt-BR", es: "es-ES", zh: "zh-CN", en: "en-US" };

function useQuando() {
  const lang = useUI((st) => st.lang);
  return useCallback((iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(BCP47[lang] ?? "en-US", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }, [lang]);
}

/** O nome do gatilho de uma estratégia própria, curto — `Média(20)`. */
function useRotuloDaIdentidade() {
  const t = useT();
  return useCallback((id: Identidade): string => {
    if (id.tipo === "mesa") return id.nome;
    const curto = id.entrada.tipo === "media" ? t("bancada.triggerMediaCurto")
      : id.entrada.tipo === "canal" ? t("bancada.triggerCanalCurto") : t("bancada.triggerRsiCurto");
    const gatilho = id.entrada.tipo === "rsi"
      ? `${curto}(${id.entrada.n}) ${id.entrada.nivel}`
      : `${curto}(${id.entrada.n})`;
    return t("bancada.propriaResumo", {
      gatilho,
      direcao: id.direcao === "compra" ? t("bancada.buy") : t("bancada.sell"),
      alvo: id.alvoPct, stop: id.stopPct, horas: id.horasLimite,
    });
  }, [t]);
}

/**
 * UM CARTÃO DE RODADA — e ele SEMPRE diz quem é.
 *
 * ⚠️⚠️ O CABEÇALHO VEM ANTES DO NÚMERO, e não é diagramação: é a correção de
 * 07/09. Um `+2,14%` sozinho na tela não diz se saiu da FREYJA sobre BTC em
 * 365 dias ou de um RSI(14) sobre SOL em 90 — e o dono tinha exatamente isso na
 * frente dele, duas vezes, sem conseguir distinguir.
 *
 * ⚠️ E O VEREDITO CONTINUA VINDO ANTES DO PLACAR. Número grande primeiro faz
 * retorno parecer aprovação: foi assim que a grade apareceu VERDE tendo perdido
 * metade do capital.
 */
function CartaoDeRodada({ c, onAlternar }: { c: Corrida; onAlternar: () => void }) {
  const t = useT();
  const quando = useQuando();
  const rotulo = useRotuloDaIdentidade();
  const m = c.medida;

  /**
   * ⚠️ A CLASSIFICAÇÃO VEM DA REGRA DO ADMIN (`classificarResultado`), a COR vem
   * da paleta do cliente. É a regra que atravessa, nunca o CSS.
   *
   * ⚠️ E `shouldTint` decide a cor NOS DOIS CAMINHOS — o do POST e o do
   * histórico. Confiar num `pinta` que só a resposta fresca traz faria a mesma
   * rodada mudar de cor depois de um F5.
   */
  const classe = m == null ? "sem_dado" : classificarResultado(
    m.n > 0 ? m.liquidoPct : null,
    m.competidorPct == null ? null : m.liquidoPct - m.competidorPct,
  );
  const cor = corDoNumero(classe, m != null && shouldTint(m.n));

  const titulo = m == null ? ""
    : m.n === 0 ? t("bancada.verdictNoTrades")
    : m.veredito === "perdeu" ? t("bancada.verdictLost")
    : m.veredito === "ganhou" ? t("bancada.verdictWon")
    : m.veredito === "ganhou_perdendo_do_indice" ? t("bancada.verdictBehind")
    : t("bancada.verdictNoise");

  const NM: Record<ChaveNaoMedido, string> = {
    derrapagem: t("bancada.nmSlippage"),
    gas:        t("bancada.nmGas"),
    liquidez:   t("bancada.nmLiquidity"),
    competidor: t("bancada.nmCompetitor"),
    bracketVariavel: t("bancada.nmBracket"),
  };

  /**
   * ⚠️⚠️ ESTA RODADA CARREGA O NOME DE UMA MESA QUE AQUELE CÓDIGO NÃO RODAVA.
   *
   * Até 07/09 o botão "rodar esta mesa" oferecia dez mesas e por baixo havia um
   * seletor só: a ULLR e a FREYJA do histórico do dono devolveram
   * `+2,140788280112371%` — idêntico à VÖLUNDR, até a última casa decimal, com
   * o mesmo playbook (`trend_continuation`).
   *
   * As linhas ficaram no banco, e apagá-las seria pior: o cliente pediu aquele
   * teste e o número é real. O que é falso é o NOME em cima dele. Então a
   * rodada é marcada, e a marca diz exatamente isso.
   *
   * ⚠️ A REGRA É DERIVADA, não uma data no código: qualquer rodada de mesa que
   * a bancada não reproduz HOJE recebe a marca. Se uma mesa sair da lista
   * amanhã, o histórico dela se marca sozinho.
   */
  const nomeNaoConfere = c.identidade.tipo === "mesa" && !mesaPodeRodar(c.identidade.mesa);

  const borda = c.estado === "rodando" ? "border-cyan/30"
    : c.estado === "recusada" || c.estado === "falhou" ? "border-gold/30"
    : "border-white/5";

  return (
    <article className={`overflow-hidden rounded-2xl border ${borda} bg-bg-1/40`}>
      {/* ── QUEM RODOU ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${
              c.identidade.tipo === "mesa" ? "border-cyan/30 text-cyan" : "border-white/10 text-ink-3"}`}>
              {c.identidade.tipo === "mesa" ? t("bancada.etiquetaMesa") : t("bancada.etiquetaPropria")}
            </span>
            {c.estado === "rodando" && (
              <span className="inline-flex items-center gap-1 text-[10px] text-cyan">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("bancada.histEmAndamento")}
              </span>
            )}
          </div>
          <p className="mt-1 break-words text-[13px] font-medium text-ink">{rotulo(c.identidade)}</p>
          {nomeNaoConfere && (
            <p className="mt-1 rounded-lg border border-gold/30 bg-gold/5 px-2 py-1 text-[10px] leading-relaxed text-gold">
              {t("bancada.histRegraAntiga")}
            </p>
          )}
          {/* ⚠️ O CONTEXTO ANDA COLADO NO NOME. Um número sem os símbolos, a
              janela e a praça é um número sem pergunta: a mesma mesa rende
              coisas opostas em 90 e em 730 dias, e paga o dobro na DEX. */}
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-4">
            {c.contexto.simbolos.join(" · ") || "—"}
            {" · "}{c.contexto.janelaDias}{t("bancada.days").slice(0, 1)}
            {" · "}{c.contexto.intervalo}
            {" · "}{rotuloDaPraca(c.contexto.praca)} {c.contexto.papel}
            {c.quando && <> · {quando(c.quando)}</>}
          </p>
        </div>

        <div className="flex-shrink-0 text-right">
          {c.estado === "rodando" ? (
            <Loader2 className="ml-auto h-5 w-5 animate-spin text-cyan" />
          ) : m != null ? (
            <>
              <span className={`block text-xl font-semibold tabular-nums ${cor}`}>
                {m.liquidoPct >= 0 ? "+" : ""}{m.liquidoPct.toFixed(2)}%
              </span>
              <span className="block text-[10px] text-ink-4">{t("bancada.net")}</span>
            </>
          ) : null}
        </div>
      </div>

      {/* ── O QUE ACONTECEU ────────────────────────────────────────── */}
      {(c.estado === "recusada" || c.estado === "falhou") && (
        <div className="px-5 pb-5">
          <p className="text-xs font-medium text-gold">
            {c.estado === "recusada" ? t("bancada.histRecusada") : t("bancada.histFalhou")}
          </p>
          {/* ⚠️ O motivo vem do SERVIDOR e é mostrado como veio: ele carrega o
              número exato (o alvo mínimo, o teto do plano) que uma tradução
              genérica apagaria. */}
          {c.porque && <p className="mt-1 text-xs leading-relaxed text-ink-2">{c.porque}</p>}
          {c.upgradeUrl && (
            <a href={c.upgradeUrl} className="mt-2 inline-block text-xs text-cyan underline">{t("bancada.upgrade")}</a>
          )}
        </div>
      )}

      {c.estado === "pronta" && m != null && (
        <div className="space-y-4 px-5 pb-5">
          <p className={`text-base font-semibold ${cor}`}>{titulo}</p>

          {/* ⚠️⚠️ O LÍQUIDO SAIU DAQUI — ele já está grande no cabeçalho deste
              mesmo card, com o mesmo rótulo e o mesmo número. Eram 14
              impressões em 7 rodadas: o olho lê duas vezes e não ganha nada,
              e a repetição rouba o contraste de BRUTO e TAXA, que são a
              informação nova desta linha (quanto a taxa comeu). */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Numero rotulo={t("bancada.gross")} valor={m.brutoPct} />
            <Numero rotulo={t("bancada.fees")} valor={m.taxaPct} />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            {/* ⚠️ "1 operações" era o que estava na tela. Singular tem chave
                própria nos quatro idiomas — o plural interpolado não é
                gramática, é um descuido que o cliente lê como desleixo. */}
            <span>{m.n === 1 ? t("bancada.sampleUm") : t("bancada.sample", { n: m.n })}</span>
            {acertoPct(m) != null && m.equilibrioPct != null && (
              <span>{t("bancada.hitRate", {
                pct: acertoPct(m)!.toFixed(0), alvo: m.equilibrioPct.toFixed(1),
              })}</span>
            )}
            {/* ⚠️ `null` é CINZA e diz "—", nunca 0%: não medimos ≠ ficou parado. */}
            <span>{t("bancada.holding")}: {m.competidorPct == null ? "—" : `${m.competidorPct.toFixed(2)}%`}</span>
          </div>

          <button type="button" onClick={onAlternar}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/5 bg-bg-2/60 px-3 py-2 text-xs text-ink-3 transition hover:border-white/15 hover:text-ink-2">
            <span>{c.aberta ? t("bancada.histFechar") : t("bancada.histVer")}</span>
            <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${c.aberta ? "rotate-180" : ""}`} />
          </button>

          {c.aberta && (
            <>
              <div className="rounded-xl border border-white/5 bg-bg-2/60 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                  <Info className="h-3 w-3" />
                  {t("bancada.notMeasured")}
                </div>
                <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-ink-3">
                  {m.naoMedidoChaves.map((k) => <li key={k}>· {NM[k]}</li>)}
                  {/* ⚠️ OS PROBLEMAS DE LEITURA NÃO TÊM CHAVE — "BTC 1h: só
                      chegaram 66% da janela" só existe como frase, e escondê-la
                      deixaria o cartão mais bonito e menos verdadeiro. Quem
                      separa prosa-de-chave de problema é o SERVIDOR: a tabela
                      `NAO_MEDIDO` mora lá, e duplicá-la aqui seria uma segunda
                      cópia para sair de sincronia. */}
                  {m.naoMedidoTexto.map((x) => <li key={x}>· {x}</li>)}
                </ul>
              </div>
              <Operacoes ops={c.ops} carregando={c.opsCarregando} />
            </>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * ⚠️⚠️ `bg-bg-2`, NUNCA `bg-bg-0` — o defeito que o dono viu na tela (06/09).
 *
 * A escala de fundo do tema é `bg` (DEFAULT), `bg-1`…`bg-4`. **`bg-0` não
 * existe.** Uma classe do Tailwind que não resolve simplesmente não vira CSS —
 * ela não avisa, não quebra o build e não aparece em teste nenhum. O `<input>`
 * então caiu no branco padrão do navegador, e a tela inteira ficou com quatro
 * retângulos brancos gritando contra o tema escuro.
 *
 * ⚠️ É a mesma família de "duas fontes, uma silenciosa" que esta base persegue:
 * o token existia na minha cabeça e não no `tailwind.config.ts`.
 */
/** Um cartão de mesa da casa: o que ela é, o que mediu, e o que o número NÃO prova. */
function MesaDaCasa({ m, rodando, contratando, jaContratada, soDeste, comOQue, erro, onRodar, onContratar }: {
  m: CartaoDaMesa; rodando: boolean; contratando: boolean;
  /** ⚠️ Já existe instância desta mesa — o botão não pode criar uma gêmea. */
  jaContratada: boolean;
  /** ⚠️ SÓ o que distingue este card — o comum já foi dito na seção. */
  soDeste: ChaveDeRessalva[];
  /** ⚠️ COM O QUE ele vai contratar — ver a nota no corpo. */
  comOQue: { simbolos: string[]; praca: string; papel: string };
  /** ⚠️ O erro deste card, renderizado NELE. */
  erro: string | null;
  onRodar: () => void; onContratar: () => void;
}) {
  const t = useT();
  /**
   * ⚠️ A REGRA DE COR É A DO ADMIN, e a amostra tem precedência: abaixo de 100
   * decididas o número sai SEM cor de veredito, por mais bonito que seja.
   */
  const classe = classificarResultado(m.liquidoPorOpPct);
  const cor = corDoNumero(classe, m.sustentacao === "sustenta");

  return (
    <li className="rounded-xl border border-white/5 bg-bg-2/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-ink">
            <span className="mr-1.5 text-ink-3">{m.sigilo}</span>{m.nome}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">{m.subtitulo}</p>
          <p className="mt-1 text-xs italic leading-relaxed text-ink-4">{m.testa}</p>
          {/* ⚠️⚠️ O BOTÃO SÓ APARECE EM QUEM A RODADA REPRODUZ. Em 07/09 ele
              aparecia nas dez, e por baixo havia um seletor só: ULLR e FREYJA
              devolveram o mesmo número até a última decimal. Uma mesa sem o
              botão não está escondida — ela diz por que não roda. */}
          {m.podeRodar ? (
            <>
              {/* ⚠️⚠️ O QUE O BOTÃO VAI USAR, DITO AO LADO DELE.
                  Um clique aqui lia símbolos e praça do construtor que fica
                  CENTENAS de linhas ABAIXO, fora da tela: o cliente contratava
                  com valores que nunca viu. A dependência não sumiu — ela ficou
                  visível, que é o mínimo honesto enquanto o construtor não
                  subir para dentro do card. */}
              <p className="mt-2 text-[10px] leading-relaxed text-ink-4">
                {t("bancada.agComOQue", {
                  simbolos: comOQue.simbolos.join(" · ") || "—",
                  praca: comOQue.praca, papel: comOQue.papel,
                })}
                {" · "}{t("bancada.agMudarAbaixo")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {/* ⚠️⚠️ CONTRATAR VEM PRIMEIRO, e é o botão em destaque: é ele
                    que faz o agente TRABALHAR na conta do investidor a partir
                    dali. O backtest ao lado é a outra pergunta — o que essa
                    regra teria feito no passado — e ele não gera resultado
                    nenhum para ele. */}
                {/* ⚠️ Contratado NÃO reabre o botão: um segundo clique criaria
                    uma instância indistinguível da primeira — mesmo nome, mesmo
                    sigilo, dois números, e nenhuma forma de saber qual é qual. */}
                {jaContratada ? (
                  <span className={`${CHIP} border-green/30 text-green`}>{t("bancada.agJaContratado")}</span>
                ) : (
                  <button type="button" onClick={onContratar} disabled={contratando}
                    className={`${CHIP} border-cyan/40 text-cyan hover:border-cyan hover:bg-cyan/5 disabled:opacity-40`}>
                    {contratando ? t("bancada.agContratando") : t("bancada.agContratar")}
                  </button>
                )}
                <button type="button" onClick={onRodar} disabled={rodando}
                  className={`${CHIP} ${CHIP_OFF} disabled:opacity-40`}>
                  {rodando ? t("bancada.mesasRodando") : t("bancada.agTestarPassado")}
                </button>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-4">{t("bancada.mesasSuaJanela")}</p>
              {/* ⚠️ O MOTIVO DA RECUSA FICA NO CARD QUE FALHOU. Ele era
                  desenhado duas seções acima, fora da vista — o cliente clicava
                  de novo sem nunca ver por quê. */}
              {erro && (
                <p className="mt-2 rounded-lg border border-gold/30 bg-gold/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-gold">
                  {erro}
                </p>
              )}
            </>
          ) : null}
        </div>
        {/* ⚠️⚠️ DOIS NÚMEROS, E MAIS NADA (07/09) — pedido do dono: *"deixa
            apenas a taxa de acerto e lucro obtido, e deixa bem explicado"*.
            Antes eram cinco: líquido, acerto, decididas, expiradas e a janela
            inteira com datas. Cinco números do mesmo tamanho não são cinco
            informações — são uma sopa em que nenhum é lido. */}
        <div className="flex-shrink-0 text-right">
          {m.liquidoPorOpPct == null || m.acertoPct == null ? (
            <span className="text-xs text-ink-4">{t("bancada.mesasSemMedida")}</span>
          ) : (
            <>
              <span className={`block text-base font-semibold ${cor}`}>
                {m.liquidoPorOpPct >= 0
                  ? t("bancada.mesasLucroSo", { pct: m.liquidoPorOpPct.toFixed(2) })
                  : t("bancada.mesasPrejuizoSo", { pct: m.liquidoPorOpPct.toFixed(2) })}
              </span>
              <span className="mt-0.5 block text-[11px] text-ink-2">
                {t("bancada.mesasAcertoSo", { pct: m.acertoPct.toFixed(0) })}
              </span>
              {/* ⚠️ A AMOSTRA FICA COLADA NOS DOIS NÚMEROS, sempre. Um acerto de
                  79% sem o "de quantas" é a mesma armadilha do painel do
                  Valhalla — e é o único contexto que estes dois números não
                  carregam sozinhos. */}
              {m.medicao && (
                <span className="block text-[10px] text-ink-4">
                  {t("bancada.mesasDeQuantas", { n: m.medicao.decididos })}
                </span>
              )}
              {m.sustentacao !== "sustenta" && (
                <span className="mt-0.5 block max-w-[10rem] text-[10px] leading-tight text-ink-4">
                  {t("bancada.mesasSemAmostraSo")}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ⚠️ SÓ AS RESSALVAS QUE DISTINGUEM ESTE CARD. As comuns a todos foram
          ditas uma vez, no rodapé da seção — ver `ressalvasComuns`. Nada some:
          a soma das duas listas é sempre o conjunto original. */}
      {soDeste.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-white/5 pt-2">
          {soDeste.map((r) => (
            <li key={r} className="text-[11px] leading-relaxed text-ink-4">· {t(r as MessageKey)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A lista de operações de uma rodada — o extrato que sustenta o veredito.
 *
 * ⚠️ TRÊS ESTADOS, NÃO DOIS. `carregando`, `[]` e `null` são coisas diferentes:
 * "estou buscando", "busquei e não houve nenhuma" e "não consegui buscar". As
 * três desenham a mesma caixa vazia se ninguém as separar — e a terceira faria
 * o cliente ler "esta rodada não operou" sobre uma rodada que operou.
 */
function Operacoes({ ops, carregando }: { ops: Op[] | null; carregando: boolean }) {
  const t = useT();
  if (carregando) {
    return (
      <p className="inline-flex items-center gap-2 text-xs text-ink-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />{t("bancada.histCarregando")}
      </p>
    );
  }
  if (ops == null) return <p className="text-xs text-gold">{t("bancada.errorTitle")}</p>;
  if (ops.length === 0) {
    // ⚠️ "Nenhuma posição aberta" é uma RESPOSTA, não uma tela vazia.
    return <p className="text-xs text-ink-3">{t("bancada.histSemOps")}</p>;
  }

  const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-ink-2">{t("bancada.opsTitulo")}</p>
        {/* ⚠️ "1 operações" era o que estava na tela — singular tem chave. */}
        <span className="text-xs text-ink-4">
          {ops.length === 1 ? t("bancada.opsUma") : t("bancada.opsQuantas", { n: ops.length })}
        </span>
      </div>

      <ul className="mt-2 space-y-1.5">
        {ops.map((o: Op, i: number) => {
          /**
           * ⚠️ A COR SEGUE O DESFECHO, não o sinal do número: uma EXPIRADA no
           * lucro continua cinza. Ela não é ganho nem perda — contá-la como
           * vitória infla a borda, e é cicatriz do flywheel.
           */
          const cor = o.desfecho === "alvo" ? "text-green"
            : o.desfecho === "stop" ? "text-red" : "text-ink-3";
          const rotulo = o.desfecho === "alvo" ? t("bancada.opsAlvo")
            : o.desfecho === "stop" ? t("bancada.opsStop") : t("bancada.opsExpirada");
          return (
            <li key={`${o.abriuEm}-${i}`} className="rounded-lg border border-white/5 bg-bg-2/60 px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink-2">
                  {o.simbolo && <span className="mr-1.5 text-ink">{o.simbolo}</span>}
                  {dia(o.abriuEm)} → {dia(o.fechouEm)}
                </span>
                <span className={`text-xs font-medium ${cor}`}>
                  {o.liquidoPct >= 0 ? "+" : ""}{o.liquidoPct.toFixed(2)}% · {rotulo}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-ink-4">
                {t("bancada.opsEntrada")} {o.entrada.toFixed(4)} · {t("bancada.opsSaida")} {o.saida.toFixed(4)}
                {/* ⚠️ Qual playbook abriu — só existe no modo mesa. Sem ele,
                    "a mesa operou" e "a mesa operou por reversão de faixa" são
                    indistinguíveis. */}
                {o.playbook && <> · {t("bancada.opsPorPlaybook", { playbook: o.playbook })}</>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const INPUT = "w-full rounded-lg border border-white/10 bg-bg-2/80 px-3 py-2 text-sm text-ink placeholder:text-ink-4 outline-none focus:border-cyan/40";
const CHIP = "rounded-lg border px-2.5 py-1.5 text-xs transition";
const CHIP_ON = "border-cyan/40 bg-cyan/10 text-cyan";
const CHIP_OFF = "border-white/10 text-ink-3 hover:border-white/25 hover:text-ink-2";

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-ink-3">{rotulo}</span>
      {children}
    </label>
  );
}

function Mini({ rotulo, valor, set, min, max, passo = 1, estreito = false }: {
  rotulo: string; valor: number; set: (n: number) => void;
  min: number; max: number; passo?: number; estreito?: boolean;
}) {
  return (
    <label className={estreito ? "block w-20" : "block"}>
      <span className="mb-1 block text-[11px] text-ink-3">{rotulo}</span>
      <input type="number" value={valor} min={min} max={max} step={passo}
        onChange={(e) => set(Number(e.target.value))} className={INPUT} />
    </label>
  );
}

/** Um seletor curto de valor fixo — janela e intervalo, que só têm 3 opções. */
function Escolha<T extends string | number>({ rotulo, valor, set, opcoes }: {
  rotulo: string; valor: T; set: (v: T) => void; opcoes: Array<{ v: T; r: string }>;
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] text-ink-3">{rotulo}</span>
      <div className="flex gap-1">
        {opcoes.map((o) => (
          <button key={String(o.v)} type="button" onClick={() => set(o.v)}
            className={`${CHIP} flex-1 px-1.5 ${valor === o.v ? CHIP_ON : CHIP_OFF}`}>
            {o.r}
          </button>
        ))}
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, destaque = false, cor }: {
  rotulo: string; valor: number; destaque?: boolean; cor?: string;
}) {
  return (
    <div>
      <span className="block text-[11px] text-ink-3">{rotulo}</span>
      <span className={`${destaque ? `text-base font-semibold ${cor ?? "text-ink"}` : "text-ink-2"}`}>
        {valor >= 0 ? "+" : ""}{valor.toFixed(2)}%
      </span>
    </div>
  );
}
