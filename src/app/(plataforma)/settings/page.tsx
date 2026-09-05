import SettingsView from "@/components/settings/SettingsView";
import { modeloDaVitrine } from "@/lib/ai/vitrine";

export default function Page() {
/**
 * ⚠️ O nome do modelo vem de `modeloDaVitrine()`, no servidor — a mesma
 * `aiAtivo()` que a rota do ZION usa. Nenhuma tela escreve o nome à mão.
 */
  return <SettingsView modelo={modeloDaVitrine().nome} />;
}
