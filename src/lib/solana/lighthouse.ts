/**
 * ⚠️⚠️ ASSERÇÕES LIGHTHOUSE QUE A CARTEIRA ACRESCENTA (Phantom) — v2, 24/10/2026.
 *
 * A Phantom acrescenta instruções do programa Lighthouse às transações que assina: checagens SOMENTE
 * LEITURA do estado on-chain ("o pagador continua uma conta do System sem dados", "o saldo de token é
 * ≥ X"). Se a checagem falhar, a transação inteira falha; ela não move fundos.
 *
 * v1 (#449) aceitava só um subconjunto escolhido SEM captura real: log level 0–2 e sem `KnownOwner`. A
 * instrução da Phantom decodificada de uma tx real de mainnet (16/09/2026) é
 *   06 04 02 03 00 00 01 0000000000000000 00
 *   = AssertAccountInfoMulti, log level 4 (FailedPlaintextMessage), [KnownOwner == System, DataLength == 0]
 * → recusada pelos DOIS cortes, que é exatamente o `lighthouse_instrucao_nao_permitida` da produção.
 *
 * Esta versão decodifica TODAS as asserções do upstream, campo a campo, e recusa só o que pode escrever
 * estado ou chamar outro programa por conta própria. Fonte: Jac0xb/lighthouse@4c579479 (= tag v2.0.0),
 * programs/lighthouse/src/instruction.rs:16-94 e types/assert/*.rs; borsh =0.10.3 (tag de enum = ÍNDICE
 * da declaração, não o `= valor` do Rust); vetores `*Multi` = LEB128Vec (contagem em LEB128 sem sinal).
 *
 *   0  MemoryWrite      ✗ escreve conta de memória e faz CPI no System
 *   1  MemoryClose      ✗ move lamports e reatribui conta
 *   2–15, 17 Assert*    ✓ somente leitura
 *   16 AssertMerkleTree ✗ SEMPRE faz CPI no spl-account-compression
 *
 * LogLevel no fio é 0..6. Os níveis 3 (EncodedNoop) e 6 (FailedEncodedNoop) fazem CPI para o SPL Noop, um
 * programa inerte (não lê nem escreve conta): aceitos. Bytes 0x10–0x12 (o `repr` do Rust) NÃO são válidos.
 */
import type { MessageV0 } from "@solana/web3.js";

export const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
/** Teto do runtime para SetComputeUnitLimit. */
export const CU_LIMITE_MAXIMO = 1_400_000;
/** Mais do que isso num swap não é proteção de carteira; é outra coisa. Observado: 1–4. */
export const MAX_ASSERCOES_ACRESCENTADAS = 8;
/** Itens por vetor `*Multi`: generoso para o que a carteira manda, curto o bastante para não virar laço. */
const MAX_ITENS_MULTI = 64;

class FimInesperado extends Error {}
class Invalido extends Error {}

/** Leitor estrito de Borsh 0.10.3 + LEB128 sem sinal (o mesmo que o programa usa). */
class Leitor {
  at = 0;
  constructor(private readonly d: Uint8Array) {}
  u8(): number { if (this.at >= this.d.length) throw new FimInesperado(); return this.d[this.at++]; }
  pular(n: number) { if (this.at + n > this.d.length) throw new FimInesperado(); this.at += n; }
  tag(max: number): number { const t = this.u8(); if (t > max) throw new Invalido(`tag ${t}>${max}`); return t; }
  /** Operador de inteiro (0..7) ou de igualdade (0..1). */
  op(max: 1 | 7) { this.tag(max); }
  bool() { this.tag(1); }
  opcional(tamanho: number) { if (this.tag(1) === 1) this.pular(tamanho); }
  /** LEB128 sem sinal até u64 (gimli leb128 0.2.5: erro só em overflow ou fim). */
  leb128(): bigint {
    let r = 0n, shift = 0n;
    for (let i = 0; i < 10; i++) {
      const b = this.u8();
      r |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        if (r > 0xffff_ffff_ffff_ffffn) throw new Invalido("leb128 overflow");
        return r;
      }
      shift += 7n;
    }
    throw new Invalido("leb128 longo demais");
  }
  contagem(): number {
    const n = this.leb128();
    if (n > BigInt(MAX_ITENS_MULTI)) throw new Invalido(`multi com ${n} itens`);
    return Number(n);
  }
  fim(): boolean { return this.at === this.d.length; }
}

const PUBKEY = 32;
type Decodificador = (r: Leitor) => void;
/** `{ value: <n bytes>, operator }` — `max` é 7 (IntegerOperator) ou 1 (EquatableOperator). */
const valor = (n: number, max: 1 | 7): Decodificador => r => { r.pular(n); r.op(max); };
const variante = (casos: Decodificador[]): Decodificador => r => casos[r.tag(casos.length - 1)](r);

// types/assert/account_data.rs — DataValueAssertion
const dataValue = variante([
  r => { r.bool(); r.op(1); },                                        // Bool
  valor(1, 7), valor(1, 7), valor(2, 7), valor(2, 7), valor(4, 7),    // U8 I8 U16 I16 U32
  valor(4, 7), valor(8, 7), valor(8, 7), valor(16, 7), valor(16, 7),  // I32 U64 I64 U128 I128
  r => { const n = r.leb128(); if (n > 1232n) throw new Invalido("bytes"); r.pular(Number(n)); r.op(1); }, // Bytes
  valor(PUBKEY, 1),                                                   // Pubkey
]);
const accountData: Decodificador = r => { r.leb128(); dataValue(r); }; // AccountDataAssertion {offset, assertion}

// types/assert/account_delta.rs
const accountInfoDelta = variante([valor(16, 7), valor(16, 7), r => r.op(1), valor(16, 7)]);
const dataValueDelta = variante([
  valor(2, 7), valor(2, 7), valor(4, 7), valor(4, 7), valor(8, 7), valor(8, 7), valor(16, 7), valor(16, 7),
  valor(2, 1),                                                        // Bytes { length: u16, EqOp }
]);
const accountDelta = variante([
  r => { r.leb128(); accountInfoDelta(r); },                          // AccountInfo { a_offset, … }
  r => { r.leb128(); r.leb128(); dataValueDelta(r); },                // Data { a_offset, b_offset, … }
]);

// types/assert/account_info.rs (KnownProgram 0..8 em known_program.rs)
const accountInfo = variante([
  valor(8, 7), valor(8, 7), valor(PUBKEY, 1),
  r => { r.tag(8); r.op(1); },                                        // KnownOwner
  valor(8, 7),
  r => { r.bool(); r.op(1); }, r => { r.bool(); r.op(1); }, r => { r.bool(); r.op(1); }, // IsSigner IsWritable Executable
  r => { r.pular(32); r.leb128(); r.leb128(); },                     // VerifyDatahash (sem operador)
]);
// types/assert/mint_account.rs
const mintAccount = variante([
  r => { r.opcional(PUBKEY); r.op(1); }, valor(8, 7), valor(1, 7), r => { r.bool(); r.op(1); },
  r => { r.opcional(PUBKEY); r.op(1); },
]);
// types/assert/token_account.rs
const tokenAccount = variante([
  valor(PUBKEY, 1), valor(PUBKEY, 1), valor(8, 7), r => { r.opcional(PUBKEY); r.op(1); },
  valor(1, 7),                                                        // State { u8 cru, IntOp }
  r => { r.opcional(8); r.op(1); }, valor(8, 7), r => { r.opcional(PUBKEY); r.op(1); },
  () => {},                                                           // TokenAccountOwnerIsDerived
]);
// types/assert/stake_account.rs
const stakeAccount = variante([
  r => { r.tag(3); r.op(1); },                                        // State { StakeStateType 0..3 }
  variante([valor(8, 7), valor(PUBKEY, 1), valor(PUBKEY, 1), valor(8, 7), valor(8, 7), valor(PUBKEY, 1)]), // Meta
  variante([valor(PUBKEY, 1), valor(8, 7), valor(8, 7), valor(8, 7), valor(8, 7)]),                        // Stake
  valor(1, 7),                                                        // StakeFlags
]);
// types/assert/upgradable_loader_state.rs
const upgradeableLoader = variante([
  r => { r.tag(3); r.op(1); },                                        // State
  variante([r => { r.opcional(PUBKEY); r.op(1); }]),                  // Buffer { Authority }
  variante([valor(PUBKEY, 1)]),                                       // Program { ProgramDataAddress }
  variante([r => { r.opcional(PUBKEY); r.op(1); }, valor(8, 7)]),     // ProgramData { UpgradeAuthority, Slot }
]);
// types/assert/clock.rs
const sysvarClock = variante([valor(8, 7), valor(8, 7), valor(8, 7), valor(8, 7), valor(8, 7)]);
// types/assert/bubblegum_tree_config.rs
const bubblegum = variante([valor(PUBKEY, 1), valor(PUBKEY, 1), valor(8, 7), valor(8, 7), r => { r.bool(); r.op(1); }, valor(1, 1)]);

const multi = (item: Decodificador): Decodificador => r => { const n = r.contagem(); for (let i = 0; i < n; i++) item(r); };

/** opcode → [decodificador do corpo, contas mínimas que o programa lê]. Ausente = proibido. */
const ASSERCOES: Record<number, [Decodificador, number]> = {
  2: [accountData, 1], 3: [multi(accountData), 1],
  4: [accountDelta, 2],
  5: [accountInfo, 1], 6: [multi(accountInfo), 1],
  7: [mintAccount, 1], 8: [multi(mintAccount), 1],
  9: [tokenAccount, 1], 10: [multi(tokenAccount), 1],
  11: [stakeAccount, 1], 12: [multi(stakeAccount), 1],
  13: [upgradeableLoader, 1], 14: [multi(upgradeableLoader), 1],
  15: [sysvarClock, 0],
  17: [bubblegum, 1],
};

/** Motivo curto e SEM dados da carteira (só inteiros pequenos) — vai para o log e ajuda a casar com o upstream. */
export function diagnosticoLighthouse(data: Uint8Array, contas: number): string | null {
  if (data.length < 2 || data.length > 1232) return `tamanho:${data.length}`;
  const opcode = data[0];
  const regra = ASSERCOES[opcode];
  if (!regra) return `opcode:${opcode}`;
  if (data[1] > 6) return `log:${data[1]}`;
  if (contas < regra[1]) return `contas:${opcode}:${contas}`;
  const r = new Leitor(data);
  try {
    r.u8(); r.u8();
    regra[0](r);
    return r.fim() ? null : `sobra:${opcode}:${data.length - r.at}`;
  } catch (e) {
    if (e instanceof FimInesperado) return `truncada:${opcode}:${data.length}`;
    if (e instanceof Invalido) return `campo:${opcode}:${r.at}`;
    return `erro:${opcode}`;
  }
}

/** A instrução Lighthouse é uma asserção somente leitura, bem formada segundo o upstream? */
export function assercaoLighthouse(data: Uint8Array, contas: number): boolean {
  return diagnosticoLighthouse(data, contas) === null;
}

export type ResultadoExtensao = { ok: true; cuElevado: boolean; assercoes: number } | { ok: false; regra: string };

/** Lê `SetComputeUnitLimit` (discriminador 2, u32 LE). */
function limiteDeCu(programa: string, contas: number, data: Uint8Array): number | null {
  if (programa !== COMPUTE_BUDGET || contas !== 0 || data.length !== 5 || data[0] !== 2) return null;
  return Buffer.from(data).readUInt32LE(1);
}

/**
 * A mensagem ASSINADA é a ORIGINAL (autenticada pelo HMAC da cotação) mais apenas asserções Lighthouse?
 *
 * Preserva, sem exceção: pagador; blockhash; o conjunto de assinantes; o privilégio de toda conta original;
 * as tabelas ALT originais com os MESMOS índices graváveis; e TODAS as instruções originais, idênticas
 * (programa, contas resolvidas, bytes) e na MESMA ordem — taxa, conta de taxa, rota, valor, slippage e
 * destino estão nelas. Única mudança aceita numa instrução original: `SetComputeUnitLimit` MAIOR (até o
 * teto do runtime), que a carteira usa para pagar o custo das próprias asserções.
 *
 * Aceita a mais: até 8 asserções em QUALQUER posição; contas novas só se somente-leitura, não assinantes e
 * usadas APENAS pelas asserções (chave estática nova ou índice só-leitura novo numa ALT original).
 */
export function compararExtensao(original: MessageV0, signed: MessageV0): ResultadoExtensao {
  try {
    if (signed.staticAccountKeys.length + signed.numAccountKeysFromLookups > 64) return { ok: false, regra: "contas_demais" };
    if (original.recentBlockhash !== signed.recentBlockhash) return { ok: false, regra: "blockhash" };
    if (original.staticAccountKeys[0]?.toBase58() !== signed.staticAccountKeys[0]?.toBase58()) return { ok: false, regra: "pagador" };
    if (original.header.numRequiredSignatures !== signed.header.numRequiredSignatures) return { ok: false, regra: "assinantes" };

    // Contas estáticas: as originais com o mesmo privilégio; as novas, só leitura e sem assinatura.
    const chaves = (m: MessageV0) => m.staticAccountKeys.map((k, i) => ({ key: k.toBase58(), signer: m.isAccountSigner(i), writable: m.isAccountWritable(i) }));
    const antes = chaves(original), depois = chaves(signed);
    if (new Set(antes.map(k => k.key)).size !== antes.length || new Set(depois.map(k => k.key)).size !== depois.length) return { ok: false, regra: "chave_duplicada" };
    for (const k of antes) {
      const outra = depois.find(x => x.key === k.key);
      if (!outra) return { ok: false, regra: "conta_original_sumiu" };
      if (outra.signer !== k.signer || outra.writable !== k.writable) return { ok: false, regra: "privilegio_alterado" };
    }
    const novasRefs = new Set<string>();
    for (const k of depois) {
      if (antes.some(x => x.key === k.key)) continue;
      if (k.signer || k.writable) return { ok: false, regra: "conta_nova_com_privilegio" };
      novasRefs.add(`key:${k.key}`);
    }

    // ALT: as mesmas tabelas, os mesmos índices graváveis; só índices SÓ-LEITURA podem ser acrescentados.
    if (signed.addressTableLookups.length !== original.addressTableLookups.length) return { ok: false, regra: "alt_tabelas" };
    for (const t of original.addressTableLookups) {
      const u = signed.addressTableLookups.find(x => x.accountKey.equals(t.accountKey));
      if (!u) return { ok: false, regra: "alt_tabelas" };
      const w0 = [...t.writableIndexes].sort((a, b) => a - b).join(","), w1 = [...u.writableIndexes].sort((a, b) => a - b).join(",");
      if (w0 !== w1) return { ok: false, regra: "alt_gravavel" };
      if (!t.readonlyIndexes.every(i => u.readonlyIndexes.includes(i))) return { ok: false, regra: "alt_leitura_sumiu" };
      for (const i of u.readonlyIndexes) if (!t.readonlyIndexes.includes(i)) novasRefs.add(`alt:${u.accountKey.toBase58()}:${i}:false`);
    }

    // Referência canônica de uma conta: chave estática pelo endereço; ALT por (tabela, índice, gravável).
    const ref = (m: MessageV0, index: number): string => {
      if (index < m.staticAccountKeys.length) return `key:${m.staticAccountKeys[index].toBase58()}`;
      let n = index - m.staticAccountKeys.length;
      for (const gravavel of [true, false]) for (const t of m.addressTableLookups) {
        const indices = gravavel ? t.writableIndexes : t.readonlyIndexes;
        if (n < indices.length) return `alt:${t.accountKey.toBase58()}:${indices[n]}:${gravavel}`;
        n -= indices.length;
      }
      throw new Error("indice de conta");
    };
    const instrucoes = (m: MessageV0) => m.compiledInstructions.map(ix => {
      const programa = m.staticAccountKeys[ix.programIdIndex];
      if (!programa) throw new Error("programa em ALT");
      const contas = ix.accountKeyIndexes.map(k => ref(m, k));
      return { programa: programa.toBase58(), contas, data: ix.data, canon: JSON.stringify([programa.toBase58(), contas, Buffer.from(ix.data).toString("hex")]) };
    });
    const orig = instrucoes(original), ass = instrucoes(signed);

    let j = 0, assercoes = 0, cuElevado = false;
    const usadasPorAssercao = new Set<string>();
    for (let i = 0; i < ass.length; i++) {
      const s = ass[i];
      const o = orig[j];
      if (o && s.canon === o.canon) { j++; continue; }
      if (o) {
        const antesCu = limiteDeCu(o.programa, o.contas.length, o.data);
        const depoisCu = limiteDeCu(s.programa, s.contas.length, s.data);
        if (antesCu !== null && depoisCu !== null) {
          if (depoisCu <= antesCu || depoisCu > CU_LIMITE_MAXIMO) return { ok: false, regra: "cu_limite" };
          cuElevado = true; j++; continue;
        }
      }
      if (s.programa !== LIGHTHOUSE) return { ok: false, regra: o ? `original_alterada:${j}` : `instrucao_extra:${i}` };
      const motivo = diagnosticoLighthouse(s.data, s.contas.length);
      if (motivo) return { ok: false, regra: `assercao:${motivo}` };
      if (++assercoes > MAX_ASSERCOES_ACRESCENTADAS) return { ok: false, regra: "assercoes_demais" };
      usadasPorAssercao.add(`key:${LIGHTHOUSE}`);
      for (const c of s.contas) usadasPorAssercao.add(c);
    }
    if (j !== orig.length) return { ok: false, regra: `original_faltando:${j}` };
    if (assercoes === 0 && !cuElevado) return { ok: false, regra: "sem_extensao" };
    if (assercoes === 0) return { ok: false, regra: "cu_sem_assercao" };

    // Toda conta nova existe POR CAUSA de uma asserção; nenhuma sobra solta.
    for (const r of novasRefs) if (!usadasPorAssercao.has(r)) return { ok: false, regra: "conta_nova_sem_uso" };
    return { ok: true, cuElevado, assercoes };
  } catch {
    return { ok: false, regra: "estrutura" };
  }
}

/** Compatibilidade com o #449: só o veredito. */
export function extensaoLighthouse(original: MessageV0, signed: MessageV0): boolean {
  return compararExtensao(original, signed).ok;
}
