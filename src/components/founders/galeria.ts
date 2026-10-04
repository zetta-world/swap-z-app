import type { EstadoUI } from "@/lib/founders-sale/visao";
import { ESTADOS_UI, visaoAlocacao, visaoProgresso } from "@/lib/founders-sale/visao";
import { contagem } from "@/lib/founders-sale/relogio";
import type { FoundersSalePanelProps } from "./FoundersSalePanel";

/**
 * GALERIA DETERMINÍSTICA — dados FALSOS e fixos para renderizar os 14 estados
 * do painel em teste/prévia local. Não é configuração de venda: supply, horário
 * e alocação daqui são números de exemplo, não decisões (ver
 * docs/PLANO-FOUNDERS-NFT-SALE-READINESS.md §2). Nenhuma rota usa isto.
 */
const AGORA = Date.UTC(2026, 0, 1, 12, 0, 0);           // relógio fixo do servidor (falso)
const JANELA = { inicioMs: AGORA + 2 * 86_400_000 + 3_723_000, fimMs: AGORA + 9 * 86_400_000 };

const antes   = contagem(JANELA, AGORA);
const durante = contagem({ inicioMs: AGORA - 1000, fimMs: AGORA + 3_600_000 }, AGORA);
const depois  = contagem({ inicioMs: AGORA - 7_200_000, fimMs: AGORA - 1000 }, AGORA);
const semHora = contagem({ inicioMs: null, fimMs: null }, null);

const P_OK      = visaoProgresso({ supply: 1000, mintados: 372, reservados: 41 });
const P_ESGOT   = visaoProgresso({ supply: 1000, mintados: 1000, reservados: 0 });
const P_INDISP  = visaoProgresso({ supply: null, mintados: null, reservados: null });

const A_DESC = visaoAlocacao({ alocacao: null, usado: null, elegibilidade: "desconhecida", prova: "ausente" });
const A_VERIF = visaoAlocacao({ alocacao: null, usado: null, elegibilidade: "verificando", prova: "verificando" });
const A_OK   = visaoAlocacao({ alocacao: 2, usado: 0, elegibilidade: "elegivel", prova: "valida" });
const A_USO  = visaoAlocacao({ alocacao: 2, usado: 1, elegibilidade: "elegivel", prova: "valida" });
const A_NAO  = visaoAlocacao({ alocacao: 0, usado: 0, elegibilidade: "nao_elegivel", prova: "invalida" });

export const GALERIA: Readonly<Record<EstadoUI, Omit<FoundersSalePanelProps, "estado">>> = {
  COMING_SOON:           { contagem: semHora, progresso: P_INDISP, alocacao: A_DESC },
  ALLOWLIST_CHECK:       { contagem: durante, progresso: P_OK, alocacao: A_VERIF },
  ELIGIBLE:              { contagem: durante, progresso: P_OK, alocacao: A_OK },
  NOT_ELIGIBLE:          { contagem: durante, progresso: P_OK, alocacao: A_NAO },
  SALE_NOT_STARTED:      { contagem: antes,   progresso: P_INDISP, alocacao: A_DESC },
  SALE_ACTIVE:           { contagem: durante, progresso: P_OK, alocacao: A_OK },
  PAUSED:                { contagem: durante, progresso: P_OK, alocacao: A_OK },
  SOLD_OUT:              { contagem: durante, progresso: P_ESGOT, alocacao: A_OK },
  ENDED:                 { contagem: depois,  progresso: P_OK, alocacao: A_USO },
  TRANSACTION_PREPARING: { contagem: durante, progresso: P_OK, alocacao: A_OK },
  WALLET_CONFIRMATION:   { contagem: durante, progresso: P_OK, alocacao: A_OK },
  TRANSACTION_PENDING:   { contagem: durante, progresso: P_OK, alocacao: A_OK },
  TRANSACTION_CONFIRMED: { contagem: durante, progresso: P_OK, alocacao: A_USO, txRef: "mock-tx-0001" },
  TRANSACTION_FAILED:    { contagem: durante, progresso: P_OK, alocacao: A_OK },
};

export const ESTADOS_DA_GALERIA: readonly EstadoUI[] = ESTADOS_UI;
