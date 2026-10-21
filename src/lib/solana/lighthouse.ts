/** Restricted read-only Lighthouse suffix. Upstream: Jac0xb/lighthouse@4c579479.
 * Never accept MemoryWrite/Close, arbitrary programs, new permissions or modified ALTs.
 * Lookup entries are compared as exact (table,index,privilege) references: no RPC is
 * needed to compare unchanged tables; any lookup change fails closed.
 */
import type { MessageV0 } from "@solana/web3.js";

export const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/** Borsh subset: AccountInfo(5/6) and TokenAccount(9/10), single or multi.
 * Reject unknown variants, unsupported logging, trailing bytes and noncanonical lengths.
 * These processors only evaluate account state; they perform no CPI or writes.
 */
export function assercaoLighthouse(data: Uint8Array, accounts: number): boolean {
  if (accounts !== 1 || data.length < 3 || data.length > 512) return false;
  let at = 0;
  const read = () => { if (at >= data.length) throw new Error("truncated"); return data[at++]; };
  const skip = (n: number) => { if (at + n > data.length) throw new Error("truncated"); at += n; };
  const op = (max: number) => { if (read() > max) throw new Error("operator"); };
  try {
    const kind = read();
    if (![5, 6, 9, 10].includes(kind) || read() > 2) return false;
    const multi = kind === 6 || kind === 10;
    // Bounded single-byte canonical LEB128 count (upstream LEB128Vec).
    const count = multi ? read() : 1;
    if (count < 1 || count > 16) return false;
    for (let i = 0; i < count; i++) {
      const variant = read();
      if (kind === 5 || kind === 6) {
        if ([0, 1, 4].includes(variant)) { skip(8); op(7); }
        else if (variant === 2) { skip(32); op(1); }
        else if ([5, 6, 7].includes(variant)) { op(1); op(1); }
        else return false; // KnownOwner/Datahash deliberately unsupported.
      } else {
        if (variant === 0 || variant === 1) { skip(32); op(1); }
        else if (variant === 2 || variant === 6) { skip(8); op(7); }
        else if (variant === 3 || variant === 5 || variant === 7) {
          const some = read(); if (some > 1) return false;
          if (some) skip(variant === 5 ? 8 : 32);
          op(1);
        } else if (variant === 4) { op(2); op(7); }
        else if (variant !== 8) return false;
      }
    }
    return at === data.length;
  } catch { return false; }
}

/** Full preservation of the original message except a bounded assertion suffix and
 * a single readonly, nonsigning Lighthouse program key. No financial field is ignored.
 */
export function extensaoLighthouse(original: MessageV0, signed: MessageV0): boolean {
  try {
    if (signed.staticAccountKeys.length + signed.numAccountKeysFromLookups > 64) return false;
    if (original.recentBlockhash !== signed.recentBlockhash) return false;
    if (original.staticAccountKeys[0]?.toBase58() !== signed.staticAccountKeys[0]?.toBase58()) return false;
    const lookup = (m: MessageV0) => m.addressTableLookups.map(t => [t.accountKey.toBase58(), [...t.writableIndexes], [...t.readonlyIndexes]]);
    if (JSON.stringify(lookup(original)) !== JSON.stringify(lookup(signed))) return false;
    const keys = (m: MessageV0) => m.staticAccountKeys.map((k,i) => ({key:k.toBase58(), signer:m.isAccountSigner(i), writable:m.isAccountWritable(i)}));
    const before = keys(original), after = keys(signed);
    if (new Set(before.map(k=>k.key)).size !== before.length || new Set(after.map(k=>k.key)).size !== after.length) return false;
    for (const k of before) {
      const other = after.find(x=>x.key === k.key);
      if (!other || other.signer !== k.signer || other.writable !== k.writable) return false;
    }
    for (const k of after.filter(k=>!before.some(x=>x.key===k.key))) {
      if (k.key !== LIGHTHOUSE || k.signer || k.writable) return false;
    }
    const lh = after.find(k=>k.key===LIGHTHOUSE);
    if (!lh || lh.signer || lh.writable) return false;
    const ref = (m: MessageV0, index: number): string => {
      if (index < m.staticAccountKeys.length) return `key:${m.staticAccountKeys[index].toBase58()}`;
      let n = index - m.staticAccountKeys.length;
      for (const writable of [true, false]) for (const t of m.addressTableLookups) {
        const indices = writable ? t.writableIndexes : t.readonlyIndexes;
        if (n < indices.length) return `alt:${t.accountKey.toBase58()}:${indices[n]}:${writable}`;
        n -= indices.length;
      }
      throw new Error("account index");
    };
    const instruction = (m: MessageV0, i: number) => {
      const ix=m.compiledInstructions[i];
      // Invocation through lookup tables is not supported by the server guard.
      if (!m.staticAccountKeys[ix.programIdIndex]) throw new Error("program in ALT");
      return JSON.stringify([ref(m,ix.programIdIndex), ix.accountKeyIndexes.map(k=>ref(m,k)), [...ix.data]]);
    };
    const n = original.compiledInstructions.length;
    const extra = signed.compiledInstructions.length - n;
    if (extra < 1 || extra > 8) return false;
    for (let i=0;i<n;i++) if (instruction(original,i)!==instruction(signed,i)) return false;
    const originalRefs = new Set(before.map(k=>`key:${k.key}`));
    for (let i=0;i<original.numAccountKeysFromLookups;i++) originalRefs.add(ref(original,original.staticAccountKeys.length+i));
    for (const ix of signed.compiledInstructions.slice(n)) {
      if (signed.staticAccountKeys[ix.programIdIndex]?.toBase58() !== LIGHTHOUSE || !assercaoLighthouse(ix.data,ix.accountKeyIndexes.length)) return false;
      if (!ix.accountKeyIndexes.every(k=>originalRefs.has(ref(signed,k)))) return false;
    }
    return true;
  } catch { return false; }
}
