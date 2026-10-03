import type { ConfigEmail } from "./config";
import { enviarResend } from "./resend";

/**
 * ABSTRAÇÃO DE PROVIDER DE EMAIL — o resto do early access só conhece isto.
 *
 * Um adaptador implementado: Resend (D-1). Trocar de provider = um adaptador
 * novo + o nome na lista de `config.ts`; nada fora de `email/` muda.
 *
 * ⚠️ O RESULTADO NUNCA CARREGA A RESPOSTA DO PROVIDER. Só `ok` + id da
 * mensagem, ou um CÓDIGO curto (o formato que o CHECK `eav_send_error` da
 * 0069 aceita). Corpo de erro de provider pode ecoar endereço, cabeçalho ou
 * chave — não vai para log, evento nem banco.
 */
export interface MensagemEmail {
  para:    string;
  assunto: string;
  texto:   string;
  html:    string;
}

export type CodigoFalha =
  | "config" | "rejeitado" | "rate_limited" | "provider_5xx" | "rede" | "resposta_invalida";

export type ResultadoEnvio =
  | { ok: true; id: string }
  | { ok: false; codigo: CodigoFalha; transitorio: boolean };

export interface ProvedorEmail {
  enviar(msg: MensagemEmail, chaveIdempotencia: string): Promise<ResultadoEnvio>;
}

export function provedorPara(cfg: ConfigEmail): ProvedorEmail {
  switch (cfg.provedor) {
    case "resend":
      return { enviar: (msg, chave) => enviarResend(cfg, msg, chave) };
  }
}
