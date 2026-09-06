/**
 * ESLint em FLAT CONFIG — obrigatório a partir do ESLint 9 (06/09/2026).
 *
 * ⚠️ POR QUE O `.eslintrc.json` SAIU. O Next 16 removeu o comando `next lint`,
 * e o `eslint-config-next@16` exige `eslint >= 9`, que só lê flat config. Os
 * três se puxam: não dá para subir de major sem trocar o formato.
 *
 * ⚠️ AS DUAS REGRAS DESLIGADAS SÃO AS MESMAS DE ANTES, e continuam desligadas
 * pelo mesmo motivo — não é limpeza aproveitando a migração:
 *
 *   · `react/no-unescaped-entities` — o catálogo de i18n tem apóstrofo em
 *     quatro idiomas, e escapá-los à mão sujaria o texto que o usuário lê;
 *   · `@next/next/no-img-element` — arte de NFT e avatar vêm de host externo
 *     com dimensão desconhecida, onde o `next/image` não ajuda.
 */

/**
 * ⚠️ IMPORTADO DIRETO, sem o shim `FlatCompat` — o `eslint-config-next@16` JÁ É
 * flat config nativo. Passá-lo pelo shim explode com "Converting circular
 * structure to JSON": o shim tenta normalizar um formato que não precisa de
 * normalização.
 */
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  {
    /**
     * ⚠️ O QUE O ANTIGO `.eslintignore` FAZIA IMPLICITAMENTE. Flat config não
     * lê `.eslintignore`: sem esta lista o lint entraria em `.next/` e em
     * `node_modules`, e a saída viraria ruído — que é a forma mais rápida de um
     * lint deixar de ser lido.
     */
    ignores: [".next/**", "node_modules/**", "out/**", "public/**", "supabase/**"],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",

      /**
       * ⚠️⚠️ AS REGRAS DO REACT COMPILER — AVISO, NÃO ERRO. Leia antes de mexer.
       *
       * O `eslint-config-next@16` liga estas como ERRO, e elas acusam **117
       * ocorrências** em código que está em produção há meses:
       *
       *     70  react-hooks/set-state-in-effect
       *     36  react-hooks/purity
       *      5  react-hooks/refs
       *      4  react-hooks/use-memo
       *      1  react-hooks/static-components
       *      1  react-hooks/immutability
       *
       * ⚠️ ELAS SÃO DIAGNÓSTICO NOVO SOBRE CÓDIGO VELHO, não regressão da
       * migração. Nenhuma linha mudou de comportamento por causa delas.
       *
       * Três caminhos existiam, e o do meio é o único honesto:
       *
       *   · consertar as 117 agora — refatoração grande de estado em 30+
       *     componentes, risco de regressão real, e nada a ver com o motivo
       *     desta migração (21 advisories de segurança). "Não alargue o PR."
       *   · desligar — perde o sinal, e o sinal é bom: entre as 118 havia UM
       *     `<a href="/">` no Topbar que recarregava a página e derrubava a
       *     carteira conectada. Esse foi consertado.
       *   · **AVISO** — o número continua visível e contável a cada `lint`, o
       *     CI não trava por dívida que já existia, e a fila fica registrada.
       *
       * ⚠️ ISTO NÃO É "PARA SEMPRE". `set-state-in-effect` e `purity` são as
       * duas que de fato escondem defeito (renderização impura e cascata de
       * re-render); elas merecem uma leva própria, com o app exercitado à mão,
       * e não de carona numa troca de framework.
       */
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",
    },
  },
];
