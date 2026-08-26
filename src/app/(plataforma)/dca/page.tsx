import DcaPanel from "@/components/cex/DcaPanel";

/**
 * /dca — a página do DCA, SEM exigir o cofre destrancado.
 *
 * ⚠️ POR QUE ELA EXISTE, e não só a aba dentro de `/cex`.
 *
 * O modo simulado foi construído para testar o plano inteiro sem chave e sem
 * saldo. Mas a aba mora no `CexConsole`, que começa com
 * `if (!creds) return <tela de desbloqueio>` — então o modo que dispensa
 * credencial ficava atrás de uma porta que exige credencial. O dono bateu
 * nisso na primeira tentativa de usar.
 *
 * Aqui o painel roda sem cofre: simulado disponível, real desabilitado com o
 * motivo na tela. Dentro de `/cex`, com a chave em mãos, os dois modos.
 */
export default function Page() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto w-full">
      <DcaPanel />
    </div>
  );
}
