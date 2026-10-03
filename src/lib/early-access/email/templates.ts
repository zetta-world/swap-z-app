/**
 * EMAIL DE CONFIRMAÇÃO — 4 idiomas (en/pt/es/zh), sem PII além do link.
 *
 * ⚠️ SEM NOME, SEM DADO DA INSCRIÇÃO. O nome foi digitado por quem enviou o
 * formulário — que pode não ser o dono da caixa. Repetir esse texto num email
 * do nosso domínio daria a um terceiro um canal para escrever na caixa de
 * alguém. Os dados aparecem só na PÁGINA, para quem tem o link.
 *
 * ⚠️ SEM IMAGEM EXTERNA, SEM PIXEL, SEM URL além do link (que é escapado).
 * ⚠️ A mensagem diz o que fazer se não foi você — e não confirmar nada é
 * seguro: a inscrição não verificada some em 7 dias.
 */
export const LOCALES = ["en", "pt", "es", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export function localeValido(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

interface Textos { assunto: string; intro: string; botao: string; prazo: string; naoFui: string; aviso: string }

const T: Record<Locale, Textos> = {
  en: {
    assunto: "Confirm your email for the Z-SWAP early access list",
    intro:   "Someone asked to add this email address to the Z-SWAP early access list. To confirm that the address is yours, open the link below and review the request.",
    botao:   "Review and confirm",
    prazo:   "The link works once and expires in 24 hours.",
    naoFui:  "If this wasn't you, you can ignore this email or open the link and choose \"This wasn't me\": the request is deleted. Unconfirmed requests are deleted after 7 days.",
    aviso:   "This list is not an investment, a purchase or a reservation of any asset.",
  },
  pt: {
    assunto: "Confirme seu email na lista de early access da Z-SWAP",
    intro:   "Alguém pediu para incluir este endereço na lista de early access da Z-SWAP. Para confirmar que o endereço é seu, abra o link abaixo e revise o pedido.",
    botao:   "Revisar e confirmar",
    prazo:   "O link funciona uma vez e expira em 24 horas.",
    naoFui:  "Se não foi você, ignore este email ou abra o link e escolha \"Não fui eu\": o pedido é apagado. Pedidos não confirmados são apagados em 7 dias.",
    aviso:   "Esta lista não é investimento, compra nem reserva de nenhum ativo.",
  },
  es: {
    assunto: "Confirma tu email en la lista de acceso anticipado de Z-SWAP",
    intro:   "Alguien pidió agregar esta dirección a la lista de acceso anticipado de Z-SWAP. Para confirmar que la dirección es tuya, abre el enlace de abajo y revisa la solicitud.",
    botao:   "Revisar y confirmar",
    prazo:   "El enlace funciona una vez y vence en 24 horas.",
    naoFui:  "Si no fuiste tú, ignora este email o abre el enlace y elige \"No fui yo\": la solicitud se elimina. Las solicitudes no confirmadas se eliminan en 7 días.",
    aviso:   "Esta lista no es una inversión, una compra ni una reserva de ningún activo.",
  },
  zh: {
    assunto: "确认您在 Z-SWAP 抢先体验名单中的邮箱",
    intro:   "有人请求将此邮箱地址加入 Z-SWAP 抢先体验名单。要确认该地址属于您，请打开下面的链接并查看该请求。",
    botao:   "查看并确认",
    prazo:   "该链接仅可使用一次，24 小时后失效。",
    naoFui:  "如果不是您本人操作，可以忽略此邮件，或打开链接并选择“不是我”：该请求将被删除。未确认的请求会在 7 天后删除。",
    aviso:   "此名单不是投资、购买或任何资产的预订。",
  },
};

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function linkConfirmacao(baseUrl: string, token: string): string {
  // ⚠️ FRAGMENTO, não query: o navegador não envia `#…` ao servidor, então o
  // token não aparece em log de acesso, `Referer` nem cache intermediário.
  return `${baseUrl}/early-access/confirm#t=${token}`;
}

export function mensagemConfirmacao(locale: Locale, link: string): { assunto: string; texto: string; html: string } {
  const t = T[locale] ?? T.en;
  const texto = [t.intro, "", link, "", t.prazo, "", t.naoFui, "", t.aviso].join("\n");
  const l = escaparHtml(link);
  const html =
    `<!doctype html><html lang="${locale}"><body style="font-family:sans-serif;line-height:1.5">`
    + `<p>${escaparHtml(t.intro)}</p>`
    + `<p><a href="${l}">${escaparHtml(t.botao)}</a></p>`
    + `<p style="word-break:break-all">${l}</p>`
    + `<p>${escaparHtml(t.prazo)}</p><p>${escaparHtml(t.naoFui)}</p>`
    + `<p style="color:#666;font-size:12px">${escaparHtml(t.aviso)}</p>`
    + `</body></html>`;
  return { assunto: t.assunto, texto, html };
}
