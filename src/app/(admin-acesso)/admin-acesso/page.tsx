import { notFound } from "next/navigation";
import { lerConfigCorp } from "@/lib/admin/corp/config";
import { caixa, botao } from "./estilo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acesso", robots: { index: false, follow: false } };

const NOMES = { google: "Google Workspace", azure: "Microsoft" } as const;

/**
 * /admin-acesso — entrada do login corporativo (R1, design §4.2 passo 1). 404 sem configuração R1
 * (inclui o modo `legacy`, padrão). Âncoras, não formulário: a CSP tem `form-action 'self'`.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ erro?: string; volta?: string }> }) {
  const c = lerConfigCorp();
  if (!c.ok) notFound();
  const sp = await searchParams;
  const volta = typeof sp.volta === "string" ? sp.volta : "/admin";
  return (
    <main style={caixa}>
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Acesso administrativo</h1>
      {sp.erro && <p role="alert" style={{ color: "#ff8080" }}>Não foi possível entrar.</p>}
      {c.cfg.provedores.map((p) => (
        <a key={p} style={botao} href={`/api/admin-auth/start?provider=${p}&volta=${encodeURIComponent(volta)}`}>Entrar com {NOMES[p]}</a>
      ))}
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 16 }}>Só contas convidadas. Depois do provedor, o código do autenticador (TOTP) é obrigatório.</p>
    </main>
  );
}
