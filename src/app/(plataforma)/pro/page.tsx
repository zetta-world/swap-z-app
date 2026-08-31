import ProTerminal from "@/components/pro/ProTerminal";
import TierGate from "@/components/auth/TierGate";

export default function Page() {
  return (
    /* ⚠️ COMENTÁRIO CORRIGIDO (31/08) — ele dizia o INVERSO e me enganou numa
       auditoria. `gatesEnabled()` é `process.env.TIER_GATES_ENABLED !== "false"`:
       o portão está LIGADO por padrão, e só abre se alguém escrever "false".
       Produção confirma — `/api/tier` responde `gatesEnabled: true`.
       Um comentário que inverte o sentido de uma trava é pior que nenhum: eu
       reportei "/pro está aberto a todos" lendo daqui, e estava errado. */
    <TierGate required="pro">
      <ProTerminal />
    </TierGate>
  );
}
