"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MODULE_REGISTRY, type ModuleId } from "@/lib/admin/modules";

type AdminLayoutState = {
  enabled:  Set<ModuleId>;
  order:    ModuleId[];
  cmdOpen:  boolean;
  // actions
  toggleModule:  (id: ModuleId) => void;
  reorderModule: (id: ModuleId, newIndex: number) => void;
  setCmdOpen:    (open: boolean) => void;
  resetLayout:   () => void;
};

function defaultEnabled(): Set<ModuleId> {
  return new Set(
    MODULE_REGISTRY.filter((m) => m.defaultEnabled).map((m) => m.id),
  );
}

function defaultOrder(): ModuleId[] {
  return [...MODULE_REGISTRY]
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((m) => m.id);
}

/**
 * ⚠️ MÓDULO NOVO ENTRA ONDE FOI DECLARADO, NÃO NO FIM DA LISTA (06/08).
 *
 * A versão anterior fazia `order.push(m.id)`. O efeito: um painel novo nascia
 * no RODAPÉ do painel de quem já tinha layout salvo — ou seja, de todo mundo
 * que já usou o admin — independentemente do `defaultOrder` declarado.
 *
 * O RENDIMENTO INTEGRADO nasceu com `defaultOrder: 8.5` justamente para cair ao
 * lado do FUNDING (8), e cairia no fim de tudo. O dono perguntou "onde está o
 * botão?" e essa é metade da resposta — a outra metade é que eu nem tinha feito
 * o deploy.
 *
 * É a mesma família do `adm-btn` sem CSS e dos dois botões com o mesmo rótulo:
 * o recurso existe, funciona, e não é encontrável. Ferramenta que não se acha
 * é ferramenta que não existe.
 *
 * ⚠️ E A REORDENAÇÃO MANUAL TEM QUE SOBREVIVER. Por isso não se ordena a lista
 * inteira por `defaultOrder` — isso jogaria fora o arranjo de quem arrastou os
 * painéis. O novo é ancorado logo DEPOIS do vizinho natural dele: o módulo de
 * maior `defaultOrder` que ainda seja menor ou igual ao dele. Sem vizinho, vai
 * para o começo.
 *
 * ⚠️⚠️ O VIZINHO É DA MESMA CATEGORIA, e a primeira versão desta correção
 * errava nisso.
 *
 * `defaultOrder` NÃO é global: ele se repete entre categorias (há um `8` em
 * `lab` e outro em `controls`). Comparando o registro inteiro, o RENDIMENTO
 * (lab, 8.5) ancorava depois de um módulo de CONTROLES — consertei a posição e
 * troquei a aba. Seria o mesmo defeito de encontrabilidade com outra roupa, que
 * é literalmente o padrão que esta semana já achou seis vezes.
 *
 * A grade filtra por categoria, então posição só significa alguma coisa entre
 * irmãos da mesma aba.
 *
 * Exportada para ter teste. Reconciliador escondido dentro do `persist` é
 * lógica que só roda no navegador de alguém — e o defeito acima viveu meses
 * exatamente por isso.
 */
export function reconciliar(
  ordemSalva: ModuleId[],
  habilitadosSalvos: ModuleId[],
): { enabled: Set<ModuleId>; order: ModuleId[] } {
  const salva = Array.isArray(ordemSalva) ? ordemSalva : [];
  const enabled = new Set<ModuleId>(habilitadosSalvos);
  const order = [...salva];

  const defOf = new Map(MODULE_REGISTRY.map((m) => [m.id, m]));
  // Do menor para o maior: assim dois módulos novos seguidos se encadeiam na
  // ordem certa em vez de se empilharem invertidos.
  const novos = MODULE_REGISTRY
    .filter((m) => !salva.includes(m.id))
    .sort((a, b) => a.defaultOrder - b.defaultOrder);

  for (const m of novos) {
    let posicao = 0;
    let melhor = -Infinity;
    for (let i = 0; i < order.length; i++) {
      const vizinho = defOf.get(order[i]);
      // Só irmão da MESMA aba conta como vizinho — ver a nota acima.
      if (!vizinho || vizinho.category !== m.category) continue;
      if (vizinho.defaultOrder > m.defaultOrder) continue;
      // `>=` para que, com empate, o último vizinho válido ganhe — o novo fica
      // depois de todos os seus pares, não no meio deles.
      if (vizinho.defaultOrder >= melhor) { melhor = vizinho.defaultOrder; posicao = i + 1; }
    }
    order.splice(posicao, 0, m.id);
    // Quem o dono desligou de propósito continua desligado; só o que é novo
    // herda o `defaultEnabled`.
    if (m.defaultEnabled) enabled.add(m.id);
  }

  return { enabled, order };
}

export const useAdminLayout = create<AdminLayoutState>()(
  persist(
    (set) => ({
      enabled:  defaultEnabled(),
      order:    defaultOrder(),
      cmdOpen:  false,

      toggleModule: (id) =>
        set((s) => {
          const next = new Set(s.enabled);
          next.has(id) ? next.delete(id) : next.add(id);
          return { enabled: next };
        }),

      reorderModule: (id, newIndex) =>
        set((s) => {
          const arr = s.order.filter((x) => x !== id);
          arr.splice(newIndex, 0, id);
          return { order: arr };
        }),

      setCmdOpen: (open) => set({ cmdOpen: open }),

      resetLayout: () =>
        set({ enabled: defaultEnabled(), order: defaultOrder() }),
    }),
    {
      name: "admin-layout-v1",
      // Serialize Set as array for JSON
      storage: {
        getItem: (key) => {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed?.state?.enabled && Array.isArray(parsed.state.enabled)) {
              parsed.state.enabled = new Set(parsed.state.enabled);
            }
            return parsed;
          } catch {
            return null;
          }
        },
        setItem: (key, val) => {
          const copy = JSON.parse(JSON.stringify(val, (_k, v) =>
            v instanceof Set ? [...v] : v,
          ));
          localStorage.setItem(key, JSON.stringify(copy));
        },
        removeItem: (key) => localStorage.removeItem(key),
      },
      merge: (persisted, current) => {
        const p = persisted as { enabled?: Iterable<ModuleId>; order?: ModuleId[]; cmdOpen?: boolean } | undefined;
        if (!p) return current;
        const { enabled, order } = reconciliar(
          p.order ?? [],
          p.enabled ? [...p.enabled] : [],
        );
        return { ...current, ...p, enabled, order, cmdOpen: false };
      },
    },
  ),
);
