import Bancada from "@/components/bancada/Bancada";

/**
 * ⚠️ SEM `TierGate` AQUI, e é decisão, não esquecimento.
 *
 * Quem separa os planos na bancada é a COTA, não o portão — `FEATURE_TIER`
 * declara `bancadaBacktest: "free"`. Um `TierGate` aqui esconderia a tela de
 * quem tem direito a dez testes por dia, que é exatamente a cicatriz do
 * Free/ZION: o card prometia cinco análises e o portão devolvia 402.
 *
 * A rota `/api/bancada/backtest` continua exigindo SESSÃO — cota por carteira
 * só faz sentido com carteira — e é ela que responde quando a cota acaba.
 */
export default function Page() {
  return <Bancada />;
}
