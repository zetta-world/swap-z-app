/** Estilo único das telas de acesso do Admin (neutras, sem marca do app público). */
export const caixa = {
  maxWidth: 420, margin: "12vh auto", padding: 24, borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)", background: "rgba(8,11,34,0.9)", color: "#F2F4FF",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14, lineHeight: 1.6,
} as const;
export const botao = {
  display: "block", width: "100%", padding: "10px 12px", marginTop: 10, borderRadius: 8, textAlign: "center",
  border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "#F2F4FF",
  textDecoration: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14,
} as const;
export const campo = {
  display: "block", width: "100%", padding: "8px 10px", marginTop: 6, borderRadius: 6, boxSizing: "border-box",
  border: "1px solid rgba(255,255,255,0.2)", background: "#050714", color: "#F2F4FF", fontFamily: "inherit", fontSize: 16,
} as const;
