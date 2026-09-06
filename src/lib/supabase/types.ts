/**
 * Hand-written DB types mirroring supabase/migrations/0001_auth.sql.
 * Kept narrow on purpose — only the columns the app reads/writes. If the
 * schema grows, regenerate with `supabase gen types typescript`.
 */
import type { Tier, TierSource } from "@/lib/tier/types";
import type { LabStatus } from "@/lib/lab/registry";

export type WalletChain = "evm" | "solana";

// NB: these MUST be `type` aliases, not `interface`s. supabase-js constrains
// each table's Row/Insert/Update to `Record<string, unknown>`, and interfaces
// don't satisfy that constraint (no implicit index signature) — which would
// silently degrade every query's row type to `never`.
/**
 * QUAL PISCINA O TERMINAL DEVE MOSTRAR — ver 0035_pro_piscina_medicao.sql.
 *
 * ⚠️ TODA MÉTRICA É `number | null`, e o `null` é informação. NULL = a
 * GeckoTerminal recusou (`porque_nao_leu` diz o quê); 0 = ela respondeu e o
 * valor era zero. Tipar como `number` obrigaria a rota a inventar um zero, e
 * "piscina morta" ficaria idêntico a "piscina não medida".
 */
/**
 * AS VELAS QUE SÓ SE BUSCA UMA VEZ — ver 0036_mercado_velas.sql.
 *
 * ⚠️ Estas duas são DADO DE MERCADO, não dado de cliente: preço público de BTC
 * não tem dono. As tabelas da bancada (fase 1) são o oposto e vão precisar de
 * policy de verdade.
 */
export type MercadoVelaRow = {
  simbolo:    string;
  intervalo:  string;
  /** Instante em que a vela ABRIU, unix ms. Só vela FECHADA entra aqui. */
  abriu_em:   number;
  high:       number;
  low:        number;
  close:      number;
  volume:     number;
  gravada_em: string;
};

/** ⚠️ A faixa PERGUNTADA, não a que veio — ver a nota na migration. */
export type MercadoCoberturaRow = {
  simbolo:       string;
  intervalo:     string;
  coberto_de:    number;
  coberto_ate:   number;
  /** A fonte não tem histórico antes de `coberto_de`. Impede a re-busca eterna. */
  fonte_esgotou: boolean;
  atualizada_em: string;
};

/**
 * ── A BANCADA DO CLIENTE ────────────────────────────────────────────
 *
 * ⚠️⚠️ AS PRIMEIRAS TABELAS COM DONO. Tudo acima é NOSSO — velas, medições,
 * agentes — e a service key bastava porque não havia de quem separar. Estas
 * guardam a estratégia que o CLIENTE escreveu.
 *
 * ⚠️ `dono` É UM `string` AQUI porque é o que o Postgres devolve; o tipo MARCADO
 * `Dono`, que a rota não consegue construir a partir do corpo da requisição,
 * vive em `lib/bancada/dono.ts`. Não afrouxar um pelo outro: este descreve a
 * linha, aquele descreve a procedência.
 */
export type BancadaEstrategiaRow = {
  id:            string;
  dono:          string;
  chain:         WalletChain;
  nome:          string;
  params:        Record<string, unknown>;
  praca:         "spot_gate" | "futuros_gate" | "dex";
  papel:         "maker" | "taker";
  /** ⚠️ Arquiva, não apaga: uma rodada aponta para ela e viraria órfã. */
  arquivada_em:  string | null;
  /** ⚠️ O interruptor da mesa viva (0039). Nasce DESLIGADO. */
  papel_adiante: boolean;
  /** Símbolos que a mesa acompanha. Vazio = o cron ignora. */
  simbolos:      string[];
  intervalo:     string;
  /** Quando a mesa foi ligada. Resultado sem tempo decorrido é número sem amostra. */
  papel_desde:   string | null;
  criada_em:     string;
  atualizada_em: string;
};

/** ⚠️ `params` aqui é CÓPIA CONGELADA — editar a estratégia depois não pode
 *  reescrever o passado. Mesma disciplina de `lab_runs.startRun`. */
export type BancadaRodadaRow = {
  id:            string;
  dono:          string;
  chain:         WalletChain;
  estrategia_id: string | null;
  origem:        "propria" | "casa";
  capital_usd:   number;
  simbolos:      string[];
  intervalo:     string;
  janela_de:     number;
  janela_ate:    number;
  praca:         "spot_gate" | "futuros_gate" | "dex";
  papel:         "maker" | "taker";
  params:        Record<string, unknown>;
  /** `símbolos × velas`: o custo REAL, que é trabalho e não contagem. */
  custo_velas:   number;
  /** ⚠️ `recusada` é DESFECHO (o portão do pedágio), não erro. */
  status:        "rodando" | "concluida" | "recusada" | "falhou";
  porque:        string | null;
  criada_em:     string;
  terminada_em:  string | null;
};

/** ⚠️ bruto/taxa/derrapagem SEPARADOS do líquido: todo backtester do mercado
 *  mostra bruto, e é por isso que todo backtester do mercado mente. */
export type BancadaResultadoRow = {
  rodada_id:              string;
  dono:                   string;
  bruto_pct:              number;
  taxa_pct:               number;
  /** ⚠️ NULO = não medido, nunca 0 — migration 0038. */
  derrapagem_pct:         number | null;
  liquido_pct:            number;
  n:                      number;
  acertos:                number;
  equilibrio_exigido_pct: number | null;
  /** Três estados + ruído — ver `admin/cor-resultado.ts` e `admin/sample.ts`. */
  veredito:               "perdeu" | "ganhou" | "ganhou_perdendo_do_indice" | "ruido";
  /** ⚠️ O que NÃO foi medido tem nome. Vazio = medimos tudo. */
  nao_medido:             string[];
  criado_em:              string;
};

/** ⚠️ `expirada` não é ganho nem perda — cicatriz do flywheel. */
export type BancadaPosicaoRow = {
  id:            string;
  dono:          string;
  estrategia_id: string;
  simbolo:       string;
  lado:          "long" | "short";
  entrada:       number;
  tamanho_usd:   number;
  alvo_pct:      number | null;
  stop_pct:      number | null;
  expira_em:     string | null;
  /** ⚠️ De qual VELA veio o sinal (0040). Não confundir com `aberta_em`. */
  vela_em:       number | null;
  status:        "aberta" | "ganhou" | "perdeu" | "expirada";
  saida:         number | null;
  resultado_pct: number | null;
  aberta_em:     string;
  fechada_em:    string | null;
};

export type ProPiscinaMedicaoRow = {
  id:                  string;
  rodada:              string;
  medida_em:           string;
  par:                 string;
  rede:                string;
  piscina:             string;
  rotulo:              string;
  atual:               boolean;
  janela_min:          number;
  velas_lidas:         number | null;
  velas_paradas:       number | null;
  minutos_com_vela:    number | null;
  cobertura_pct:       number | null;
  amplitude_media_pct: number | null;
  atraso_min:          number | null;
  tvl_usd:             number | null;
  volume24h_usd:       number | null;
  trocas24h:           number | null;
  preco_usd:           number | null;
  porque_nao_leu:      string | null;
};

/** ⚠️ Dois vencedores separados de propósito — ver a nota na migration. */
export type ProPiscinaVereditoRow = {
  id:                    string;
  rodada:                string;
  julgado_em:            string;
  par:                   string;
  rede:                  string;
  melhor_para_o_grafico: string | null;
  maior_liquidez:        string | null;
  atual:                 string | null;
  veredito:              string;
  porque:                string;
  lidas:                 number;
  candidatas:            number;
};

export type UserRow = {
  id:                string;
  wallet_address:    string;
  wallet_chain:      WalletChain;
  email:             string | null;
  email_verified_at: string | null;
  created_at:        string;
  last_seen_at:      string;
};

export type AuthNonceRow = {
  wallet_address: string;
  nonce:          string;
  issued_at:      string;
  expires_at:     string;
};

export type TierCacheRow = {
  wallet_address: string;
  tier:           Tier;
  source:         TierSource;
  checked_at:     string;
  expires_at:     string;
};

export type AutopilotRiskMode  = "conservador" | "moderado" | "agressivo";
export type AutopilotMarketType = "spot" | "futures" | "margin";

export type AutopilotSessionRow = {
  id:                  string;
  wallet_address:      string;
  exchange_id:         string;
  risk_mode:           AutopilotRiskMode;
  market_type:         AutopilotMarketType;
  max_trade_usd:       number;
  daily_loss_stop_usd: number;
  max_trades_per_day:  number;
  allowed_symbols:     string[];
  lang:                string;
  creds_cipher:        string;
  /**
   * ⚠️ O elo com o COFRE (`cex_conexoes`), NULÁVEL durante a virada.
   *
   * T1: criado e preenchido por backfill. T2 (agora): a leitura prefere o
   * cofre quando isto existe e cai em `creds_cipher` quando não, contando qual
   * caminho serviu. T3: só com o contador em 100% no caminho novo, o
   * `creds_cipher` sai. Ver §2 de `docs/PLANO-DCA-AUTOMATICO.md`.
   */
  conexao_id:          string | null;
  is_active:           boolean;
  expires_at:          string;
  trades_today:        number;
  pnl_today:           number;
  last_reset_day:      string;
  frozen_until_day:    string | null;
  last_scan_at:        string | null;
  last_error:          string | null;
  /** Advisory lock (A2): the cron holds this until `now()` passes it. */
  locked_until:        string | null;
  /**
   * Veredito da chave no momento do armar (0021). NULL = sessão anterior à
   * verificação — ausência de medição, NÃO "segura".
   */
  key_permission:        "so_negocia" | "pode_sacar" | "nao_verificavel" | null;
  key_permission_detail: string | null;
  key_checked_at:        string | null;
  created_at:          string;
  updated_at:          string;
};

export type AutopilotRunRow = {
  id:             string;
  session_id:     string | null;
  wallet_address: string;
  exchange_id:    string;
  ran_at:         string;
  symbol:         string | null;
  side:           string | null;
  order_type:     string | null;
  amount:         number | null;
  price:          number | null;
  notional_usd:   number | null;
  status:         string;
  order_id:       string | null;
  card_kind:      string | null;
  reason:         string | null;
};

export type AutopilotPositionStatus = "open" | "exit_armed" | "closed";

export type AutopilotPositionRow = {
  id:             string;
  session_id:     string;
  wallet_address: string;
  exchange_id:    string;
  base:           string;
  pair:           string;
  entry_price:    number;
  base_amount:    number;
  cost_usd:       number;
  reasoning:      string | null;
  entry_label:    string | null;
  status:         AutopilotPositionStatus;
  exit_order_id:  string | null;
  exit_armed_at:  string | null;
  entry_ts:       string;
  updated_at:     string;
};

export type ZionSuggestionRow = {
  id:             string;
  symbol:         string;
  kind:           string;
  side:           "buy" | "sell";
  ref_price:      number;
  entry_price:    number | null;
  target_price:   number | null;
  stop_price:     number | null;
  probability:    number | null;
  regime:         string | null;
  source:         string;
  horizon_hours:  number;
  status:         string;
  outcome_pct:    number | null;
  resolved_price: number | null;
  created_at:     string;
  resolved_at:    string | null;
  /** Origem DEX (0019): quando presentes, o preço vem do pool via
   *  GeckoTerminal em vez de klines da Binance. Nulos = linha de CEX. */
  chain:          string | null;
  pool_address:   string | null;
  /**
   * Sugestão retirada da medição viva, sem ser apagada.
   *
   * ⚠️ MESMO BURACO DA `PaperPositionRow`, e ainda mais caro. A coluna existe
   * no banco desde o primeiro arquivamento e MUITA leitura já filtrava por ela
   * (`.is("archived_at", null)` em `cull.ts`, no torneio, no `retro.ts`) — só a
   * declaração faltava. Filtrar por campo não declarado passa batido; SELECIONAR
   * não compila, e é por isso que só apareceu em 16/08, quando o torneio
   * precisou LER a coluna para separar rodada viva de vida inteira.
   *
   * Enquanto ninguém lia, o filtro escondia 2.114 decididos e ninguém via.
   */
  archived_at:    string | null;
};

export type PaperAccountRow = {
  id:               string;
  source:           string;
  label:            string;
  exchange:         string;
  starting_usd:     number;
  cash_usd:         number;
  realized_pnl_usd: number;
  wins:             number;
  losses:           number;
  created_at:       string;
  updated_at:       string;
};

export type PaperPositionRow = {
  id:            string;
  account_id:    string;
  suggestion_id: string;
  source:        string;
  symbol:        string;
  side:          "buy" | "sell";
  qty:           number;
  entry_price:   number;
  cost_usd:      number;
  target_price:  number | null;
  stop_price:    number | null;
  horizon_hours: number;
  status:        string;
  exit_price:    number | null;
  exit_reason:   string | null;
  pnl_usd:       number | null;
  pnl_pct:       number | null;
  opened_at:     string;
  closed_at:     string | null;
  /** Origem DEX (0019) — herdado da suggestion; define de onde vem o candle. */
  chain:         string | null;
  pool_address:  string | null;
  /**
   * Posição retirada da medição viva, sem ser apagada.
   *
   * A coluna existe no banco desde o primeiro zeramento de ledger e TODA
   * leitura já filtrava por ela (`.is("archived_at", null)`) — só a declaração
   * de tipo estava faltando, o que só apareceu quando alguém foi ESCREVER nela.
   * Ler campo não declarado passa batido; escrever não compila.
   */
  archived_at:   string | null;
};

/** Auto-Retro lesson ledger (migration 0018) — one row per reflection; the
 *  ACTIVE lessons for an agent are its newest row. */
export type AgentLessonsRow = {
  id:            string;
  source:        string;
  lessons:       string[];
  decided_count: number;
  created_at:    string;
};

export type OperationRow = {
  id:             string;
  wallet_address: string | null;
  kind:           string;
  chain:          string | null;
  pair:           string | null;
  side:           string | null;
  volume_usd:     number | null;
  pnl_usd:        number | null;
  status:         string;
  route:          string | null;
  ref:            string | null;
  /**
   * ⚠️ O QUE A PLATAFORMA RECEBEU — não o que o usuário pagou (migração 0024).
   *
   * `pnl_usd` é resultado do cliente; estes quatro são receita nossa. O CHECK
   * do banco recusa negativo: taxa retida é entrada, e um negativo aqui seria
   * custo disfarçado de receita.
   */
  platform_fee_usd:    number | null;
  platform_fee_amount: string | null;
  platform_fee_token:  string | null;
  platform_fee_bps:    number | null;
  created_at:     string;
};

export type PlatformEventRow = {
  id:             string;
  event_type:     string;
  wallet_address: string | null;
  path:           string | null;
  metadata:       Record<string, unknown> | null;
  created_at:     string;
};

export type AdminKvRow = {
  key:        string;
  value:      string;
  updated_at: string;
};

export type MarketBrainRow = {
  symbol:       string;
  regime:       string | null;
  regime_since: string | null;
  prev_regime:  string | null;
  atr_pct:      number | null;
  vol_avg:      number | null;
  range_pct:    number | null;
  updated_at:   string;
};

export type PlatformAdminRow = {
  wallet_address: string;
  granted_by:     string | null;
  note:           string | null;
  granted_at:     string;
};

export type AdminAuditLogRow = {
  id:           string;
  actor_wallet: string;
  action:       string;
  target:       string | null;
  payload:      Record<string, unknown> | null;
  created_at:   string;
};

/**
 * ── LABORATÓRIO DE ESTRATÉGIAS (migração 0020) ────────────────────────────
 *
 * Uma linha por estratégia, uma por execução, uma por resultado. A separação
 * entre `run` e `result` é o que permite gravar uma rodada que FALHOU: numa
 * tabela só, execução sem resultado não teria onde existir, e "rodou e deu
 * erro" voltaria a ser idêntico a "nunca clicou".
 */
export type LabStrategyRow = {
  id:                   string;
  slug:                 string;
  name:                 string;
  subtitle:             string;
  family:               string;
  capital_required_usd: number;
  capital_why:          string;
  /** ⚠️ Seis estados desde a Fase 10 — ver `LabStatus`, que é a fonte. */
  status:               LabStatus;
  hypothesis:           string | null;
  killed_why:           string | null;
  /** Obrigatório quando `status = 'nao_mensuravel'` (CHECK na migração 0023). */
  not_measurable_why:   string | null;
  /** Onde a medição vive, quando não vive no `lab_runs`. */
  measured_elsewhere:   string | null;
  /** Por que o registro discorda do livro, DE PROPÓSITO (migração 0025). */
  disagrees_with_ledger_why: string | null;
  created_at:           string;
  updated_at:           string;
};

export type LabRunRow = {
  id:             string;
  strategy_id:    string;
  /** Gravado no MOMENTO da rodada — não é lookup na estratégia. */
  capital_usd:    number;
  window_days:    number;
  window_end:     string;
  params:         Record<string, unknown>;
  status:         "ok" | "falhou" | "rodando";
  failure_reason: string | null;
  /** O detalhe acionável. "Falhou" sem isto é a parte inútil do registro. */
  failure_detail: string | null;
  started_at:     string;
  finished_at:    string | null;
  took_ms:        number | null;
};

export type LabResultRow = {
  id:                 string;
  run_id:             string;
  net_pct:            number | null;
  /** Independe do tamanho da janela — o `net_pct` não. Os dois viajam juntos. */
  net_annualized_pct: number | null;
  gross_pct:          number | null;
  cost_pct:           number | null;
  /** Amostra é coluna de primeira classe, não metadado. */
  sample_n:           number;
  effective_n:        number | null;
  correlation_rho:    number | null;
  max_drawdown_pct:   number | null;
  win_rate_pct:       number | null;
  trades:             number | null;
  exposure_pct:       number | null;
  /** Comprar-e-segurar na MESMA janela — sem ele "+18%" não diz nada. */
  benchmark_pct:      number | null;
  verdict:            LabStatus | null;
  verdict_text:       string | null;
  per_symbol:         unknown[];
  not_measured:       string[];
  created_at:         string;
};

export type LabCapitalLogRow = {
  id:          string;
  strategy_id: string;
  from_usd:    number | null;
  to_usd:      number;
  reason:      string;
  changed_at:  string;
};

export interface Database {
  public: {
    Tables: {
      users:       { Row: UserRow;      Insert: Partial<UserRow> & { wallet_address: string; wallet_chain: WalletChain }; Update: Partial<UserRow>;   Relationships: [] };
      auth_nonces: { Row: AuthNonceRow; Insert: AuthNonceRow;                                                            Update: Partial<AuthNonceRow>; Relationships: [] };
      tier_cache:  { Row: TierCacheRow; Insert: TierCacheRow;                                                            Update: Partial<TierCacheRow>; Relationships: [] };
      admin_audit_log: { Row: AdminAuditLogRow; Insert: Omit<AdminAuditLogRow, "id" | "created_at"> & { id?: string; created_at?: string }; Update: never; Relationships: [] };
      platform_events: { Row: PlatformEventRow; Insert: Omit<PlatformEventRow, "id" | "created_at"> & { id?: string; created_at?: string }; Update: never; Relationships: [] };
      admin_kv: { Row: AdminKvRow; Insert: AdminKvRow; Update: Partial<AdminKvRow>; Relationships: [] };
      lab_strategies: { Row: LabStrategyRow; Insert: Partial<LabStrategyRow> & { slug: string; name: string; subtitle: string; family: string; capital_required_usd: number; capital_why: string }; Update: Partial<LabStrategyRow>; Relationships: [] };
      lab_runs: { Row: LabRunRow; Insert: Partial<LabRunRow> & { strategy_id: string; capital_usd: number; window_days: number }; Update: Partial<LabRunRow>; Relationships: [] };
      lab_results: { Row: LabResultRow; Insert: Partial<LabResultRow> & { run_id: string; sample_n: number }; Update: never; Relationships: [] };
      lab_capital_log: { Row: LabCapitalLogRow; Insert: Partial<LabCapitalLogRow> & { strategy_id: string; to_usd: number; reason: string }; Update: never; Relationships: [] };
      platform_admins: { Row: PlatformAdminRow; Insert: Partial<PlatformAdminRow> & { wallet_address: string }; Update: Partial<PlatformAdminRow>; Relationships: [] };
      market_brain: { Row: MarketBrainRow; Insert: Partial<MarketBrainRow> & { symbol: string }; Update: Partial<MarketBrainRow>; Relationships: [] };
      operations: { Row: OperationRow; Insert: Partial<OperationRow> & { kind: string; status: string }; Update: Partial<OperationRow>; Relationships: [] };
      zion_suggestions: {
        Row: ZionSuggestionRow;
        Insert: Partial<ZionSuggestionRow> & { symbol: string; kind: string; side: "buy" | "sell"; ref_price: number };
        Update: Partial<ZionSuggestionRow>;
        Relationships: [];
      };
      autopilot_sessions: {
        Row: AutopilotSessionRow;
        Insert: Partial<AutopilotSessionRow> & {
          wallet_address: string; exchange_id: string; risk_mode: AutopilotRiskMode;
          max_trade_usd: number; daily_loss_stop_usd: number; max_trades_per_day: number;
          creds_cipher: string; expires_at: string; last_reset_day: string;
        };
        Update: Partial<AutopilotSessionRow>;
        Relationships: [];
      };
      autopilot_runs: {
        Row: AutopilotRunRow;
        Insert: Partial<AutopilotRunRow> & { wallet_address: string; exchange_id: string; status: string };
        Update: Partial<AutopilotRunRow>;
        Relationships: [];
      };
      autopilot_positions: {
        Row: AutopilotPositionRow;
        Insert: Partial<AutopilotPositionRow> & {
          session_id: string; wallet_address: string; exchange_id: string;
          base: string; pair: string; entry_price: number; base_amount: number; cost_usd: number;
        };
        Update: Partial<AutopilotPositionRow>;
        Relationships: [];
      };
      paper_accounts: {
        Row: PaperAccountRow;
        Insert: Partial<PaperAccountRow> & { source: string; label: string };
        Update: Partial<PaperAccountRow>;
        Relationships: [];
      };
      paper_positions: {
        Row: PaperPositionRow;
        Insert: Partial<PaperPositionRow> & {
          account_id: string; suggestion_id: string; source: string; symbol: string;
          side: "buy" | "sell"; qty: number; entry_price: number; cost_usd: number;
        };
        Update: Partial<PaperPositionRow>;
        Relationships: [];
      };
      mercado_vela: {
        Row: MercadoVelaRow;
        Insert: Partial<MercadoVelaRow> & { simbolo: string; intervalo: string; abriu_em: number; high: number; low: number; close: number; volume: number };
        Update: Partial<MercadoVelaRow>;
        Relationships: [];
      };
      mercado_cobertura: {
        Row: MercadoCoberturaRow;
        Insert: Partial<MercadoCoberturaRow> & { simbolo: string; intervalo: string; coberto_de: number; coberto_ate: number };
        Update: Partial<MercadoCoberturaRow>;
        Relationships: [];
      };
      bancada_estrategia: {
        Row: BancadaEstrategiaRow;
        Insert: Partial<BancadaEstrategiaRow> & { dono: string; chain: WalletChain; nome: string; praca: string; papel: string };
        Update: Partial<BancadaEstrategiaRow>;
        Relationships: [];
      };
      bancada_rodada: {
        Row: BancadaRodadaRow;
        Insert: Partial<BancadaRodadaRow> & { dono: string; chain: WalletChain; capital_usd: number; simbolos: string[]; intervalo: string; janela_de: number; janela_ate: number; praca: string; papel: string };
        Update: Partial<BancadaRodadaRow>;
        Relationships: [];
      };
      bancada_resultado: {
        Row: BancadaResultadoRow;
        Insert: Partial<BancadaResultadoRow> & { rodada_id: string; dono: string; bruto_pct: number; taxa_pct: number; liquido_pct: number; n: number; acertos: number; veredito: string };
        Update: Partial<BancadaResultadoRow>;
        Relationships: [];
      };
      bancada_posicao: {
        Row: BancadaPosicaoRow;
        Insert: Partial<BancadaPosicaoRow> & { dono: string; estrategia_id: string; simbolo: string; lado: string; entrada: number; tamanho_usd: number };
        Update: Partial<BancadaPosicaoRow>;
        Relationships: [];
      };
      pro_piscina_medicao: {
        Row: ProPiscinaMedicaoRow;
        Insert: Partial<ProPiscinaMedicaoRow> & { rodada: string; par: string; rede: string; piscina: string; rotulo: string; janela_min: number };
        Update: never;
        Relationships: [];
      };
      pro_piscina_veredito: {
        Row: ProPiscinaVereditoRow;
        Insert: Partial<ProPiscinaVereditoRow> & { rodada: string; par: string; rede: string; veredito: string; porque: string; lidas: number; candidatas: number };
        Update: never;
        Relationships: [];
      };
      agent_lessons: {
        Row: AgentLessonsRow;
        Insert: Partial<AgentLessonsRow> & { source: string; lessons: string[]; decided_count: number };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      consume_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window_secs: number };
        Returns: boolean;
      };
      apply_session_pnl: {
        Args: { p_id: string; p_delta: number; p_today: string };
        Returns: undefined;
      };
      bump_session_trades: {
        Args: { p_wallet: string; p_exchange: string; p_n: number };
        Returns: undefined;
      };
    };
  };
}
