"use client";

import { Component, type ReactNode } from "react";

/**
 * ISOLAMENTO DE FALHA POR PAINEL (R3, Admin CC 2.0).
 *
 * ⚠️ Sem isto, um painel que lança no render derrubava a TELA inteira no
 * `global-error` — caso medido: `SwapAllowlistPanel` com 503 JSON fazia
 * `data?.enforcing.targets` estourar e levava junto os kill switches da mesma
 * grade (`docs/ADMIN-UI-INVENTARIO.md` §4 P1-5). Agora só aquele painel cai, e
 * diz que caiu — sem número velho, sem "✓".
 *
 * Erro de render é bug de código, não de dado: a mensagem é curta e vai para o
 * console do navegador; nada sai para servidor daqui (sem telemetria nova).
 */
export default class FronteiraDePainel extends Component<
  { id: string; children: ReactNode },
  { erro: string | null }
> {
  state = { erro: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { erro: e instanceof Error ? e.message.slice(0, 160) : "erro desconhecido" };
  }

  componentDidCatch(e: unknown) {
    console.error(`[admin] painel ${this.props.id} lançou no render`, e);
  }

  render() {
    if (this.state.erro == null) return this.props.children;
    return (
      <div role="alert" style={{
        border: "1px solid var(--adm-red)", borderRadius: 6, padding: "12px 14px",
        fontSize: 12, lineHeight: 1.6, color: "var(--adm-ink-2)",
      }}>
        <div style={{ color: "var(--adm-red)", letterSpacing: "0.1em", marginBottom: 4 }}>
          ⚠ PAINEL INDISPONÍVEL — <code>{this.props.id}</code>
        </div>
        <div>
          Este painel falhou ao desenhar ({this.state.erro}). Os outros painéis seguem valendo;
          o que este mostraria é <b>desconhecido</b>, não zero.
        </div>
        <button className="adm-toggle" style={{ marginTop: 8 }} onClick={() => this.setState({ erro: null })}>
          tentar de novo
        </button>
      </div>
    );
  }
}
