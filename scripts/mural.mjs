#!/usr/bin/env node
/**
 * O MURAL — o canal entre agentes que trabalham neste repositório.
 * (tabela `ulfhednar_mensagens`, aba ÚLFHÉÐNAR do admin)
 *
 * ⚠️⚠️ POR QUE ISTO EXISTE, E O QUE ELE NÃO RESOLVE.
 *
 * O `ListAgents` do Claude Code só enxerga sessões na MESMA MÁQUINA. Uma
 * sessão no Windows do dono e outra num contêiner remoto não se veem — e isso
 * NÃO tem conserto neste repositório: é do arcabouço, não do código.
 *
 * O que tem conserto é o alcance do canal que JÁ existe. As mensagens moram no
 * Supabase, que os dois lados alcançam. Faltava um jeito de ler e escrever sem
 * abrir a tela do admin — que um agente de terminal não abre.
 *
 * ⚠️ LER MARCA COMO LIDO, de propósito. O estado de leitura é o que separa "o
 * agente não respondeu" de "o agente nem viu", e é a razão da tela existir.
 * Ler e não marcar deixaria o dono esperando alguém que já leu.
 *
 * USO
 *   node scripts/mural.mjs ler [--para vscode|nuvem|dono|todos]
 *   node scripts/mural.mjs escrever --de nuvem --para vscode --assunto "..." --corpo "..."
 *   node scripts/mural.mjs responder --id <uuid> --texto "..."
 *
 * PRECISA de SUPABASE_SERVICE_ROLE_KEY e NEXT_PUBLIC_SUPABASE_URL. O script lê
 * `.env.local` sozinho — Next.js faz isso, `node` puro não.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

/**
 * ⚠️ A RAIZ DO REPO, e não o diretório de onde você chamou.
 *
 * A primeira versão lia `.env.local` por caminho RELATIVO, então funcionava só
 * se você estivesse na raiz. De qualquer subpasta ela dizia "falta
 * configuração" com o arquivo existindo dois níveis acima — mensagem
 * verdadeira e enganosa, que manda procurar credencial quando o erro é o `cd`.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const INTERLOCUTORES = ["dono", "nuvem", "vscode", "todos"];

/** Carrega `.env.local` sem dependência. Não sobrescreve o que já veio do shell. */
function carregarEnv() {
  for (const nome of [".env.local", ".env"]) {
    const arquivo = join(RAIZ, nome);
    if (!existsSync(arquivo)) continue;
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
      if (!m) continue;
      const valor = m[2].replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
    }
  }
}

function cliente() {
  carregarEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // ⚠️ Diz QUAL falta e ONDE procurar. "erro de configuração" manda a pessoa
    // adivinhar, e adivinhar em volta de credencial é como se cola chave errada.
    console.error(
      "Falta configuração:\n"
      + `  NEXT_PUBLIC_SUPABASE_URL   ${url ? "ok" : "AUSENTE"}\n`
      + `  SUPABASE_SERVICE_ROLE_KEY  ${key ? "ok" : "AUSENTE"}\n`
      + `\nProcurei em: ${join(RAIZ, ".env.local")}\n`
      + `             ${join(RAIZ, ".env")}\n`
      + "e no ambiente. Copie os valores do painel da Vercel (Settings → "
      + "Environment Variables) ou do Supabase (Settings → API).",
    );
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function faz(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "agora";
  const min = Math.floor(ms / 60_000);
  if (min < 1)  return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)}d`;
}

async function ler(db) {
  const para = arg("para");
  let q = db.from("ulfhednar_mensagens").select("*").order("criado_em", { ascending: false }).limit(50);
  // `todos` é endereço de broadcast: quem filtra por um nome também recebe.
  if (para) q = q.in("para", [para, "todos"]);

  const { data, error } = await q;
  if (error) { console.error("erro ao ler:", error.message); process.exit(1); }
  if (!data?.length) {
    // ⚠️ Diz que o vazio é REAL. Invariante nº 33: vazio-por-ausência tem de
    // ser distinguível de vazio-por-falha.
    console.log("Nenhuma mensagem. (A consulta funcionou — a caixa está vazia mesmo.)");
    return;
  }

  for (const m of data) {
    const estado = m.resposta ? "RESPONDIDA" : m.lido_em ? "lida" : "NÃO LIDA";
    console.log(`\n─── ${m.de} → ${m.para}  ·  ${faz(m.criado_em)}  ·  ${estado}`);
    console.log(`id: ${m.id}`);
    console.log(`${m.assunto}\n`);
    console.log(m.corpo);
    if (m.resposta) console.log(`\n  ↳ resposta (${faz(m.respondido_em ?? m.criado_em)}): ${m.resposta}`);
  }

  /**
   * ⚠️ MARCA COMO LIDO DEPOIS DE IMPRIMIR, e só o que não estava lido.
   *
   * Depois: se a impressão falhar, a mensagem continua não lida — melhor
   * relê-la do que perdê-la. E o `lido_em` de quem já tinha sido lido não é
   * mexido, senão "lido há 3 dias" viraria "lido agora" a cada consulta.
   */
  const naoLidas = data.filter((m) => !m.lido_em).map((m) => m.id);
  if (naoLidas.length) {
    const { error: e2 } = await db.from("ulfhednar_mensagens")
      .update({ lido_em: new Date().toISOString() }).in("id", naoLidas);
    console.log(e2
      ? `\n⚠️ li mas NÃO consegui marcar como lido (${e2.message}) — o dono vai continuar vendo "não lido"`
      : `\n(${naoLidas.length} marcada(s) como lida(s))`);
  }
}

async function escrever(db) {
  const de = arg("de"), para = arg("para");
  const assunto = arg("assunto"), corpo = arg("corpo");
  const { data, error } = await db.from("ulfhednar_mensagens")
    .insert({ de, para, assunto: assunto.slice(0, 200), corpo: corpo.slice(0, 4000) })
    .select("id").single();
  if (error) { console.error("NÃO gravou:", error.message); process.exit(1); }
  console.log(`ok — id ${data.id}`);
}

async function responder(db) {
  const id = arg("id"), texto = arg("texto");
  const { data, error } = await db.from("ulfhednar_mensagens")
    .update({ resposta: texto.slice(0, 4000), respondido_em: new Date().toISOString(), lido_em: new Date().toISOString() })
    .eq("id", id).select("id").single();
  if (error || !data) { console.error("NÃO gravou:", error?.message ?? "id não encontrado"); process.exit(1); }
  console.log(`ok — respondida ${data.id}`);
}

const acao = process.argv[2];
const ACOES = { ler, escrever, responder };

// ⚠️ A AJUDA NÃO EXIGE CREDENCIAL. A primeira versão criava o cliente antes de
// olhar a ação, então `node scripts/mural.mjs` sem argumento cuspia "falta
// configuração" em vez de dizer como se usa — que é justamente o que alguém
// perdido precisa ler.
/**
 * ⚠️ ARGUMENTO ERRADO SE RECLAMA ANTES DA CREDENCIAL.
 *
 * Sem isto, quem digitasse `--para ninguem` sem `.env.local` recebia "falta
 * configuração" — mensagem verdadeira e INÚTIL, porque manda arrumar o
 * ambiente quando o erro é o argumento. Erro tem de apontar para a causa mais
 * próxima de quem pode consertá-la.
 */
function validar(acao) {
  const nomes = [["de", acao === "escrever"], ["para", false]];
  for (const [n, obrigatorio] of nomes) {
    const v = arg(n);
    if (v === null) {
      if (obrigatorio) return `--${n} é obrigatório`;
      continue;
    }
    if (!INTERLOCUTORES.includes(v)) return `--${n} tem de ser um de: ${INTERLOCUTORES.join(", ")}`;
  }
  if (acao === "escrever" && (!arg("assunto") || !arg("corpo"))) return "--assunto e --corpo são obrigatórios";
  if (acao === "escrever" && arg("para") === null) return "--para é obrigatório";
  if (acao === "responder" && (!arg("id") || !arg("texto")))     return "--id e --texto são obrigatórios";
  return null;
}

if (ACOES[acao]) {
  const problema = validar(acao);
  if (problema) { console.error(problema); process.exit(1); }
  await ACOES[acao](cliente());
} else {
  console.log(`O MURAL — canal entre agentes deste repositório.

  node scripts/mural.mjs ler [--para vscode|nuvem|dono|todos]
  node scripts/mural.mjs escrever --de <quem> --para <quem> --assunto "..." --corpo "..."
  node scripts/mural.mjs responder --id <uuid> --texto "..."

⚠️ O ListAgents do Claude Code NÃO vê sessões de outra máquina. Este é o canal
que funciona entre elas — e é o mesmo que a aba ÚLFHÉÐNAR do admin mostra.`);
}
