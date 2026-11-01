"use client";

/**
 * Fronteira de rota do Admin (R3): se algo FORA dos painéis lança (shell,
 * navegação), a tela diz isso em vez de cair no erro global do site.
 * Cada painel já tem a própria `FronteiraDePainel`.
 */
export default function ErroDoAdmin({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" style={{ padding: 24, fontSize: 13, lineHeight: 1.7, color: "var(--adm-ink-2, #ccc)" }}>
      <div style={{ color: "var(--adm-red, #f55)", letterSpacing: "0.1em" }}>⚠ O PAINEL ADMIN FALHOU AO DESENHAR</div>
      <div>Nenhum estado foi alterado por esta falha. Código: <code>{error.digest ?? "sem digest"}</code></div>
      <button className="adm-toggle" style={{ marginTop: 10 }} onClick={reset}>tentar de novo</button>
    </div>
  );
}
