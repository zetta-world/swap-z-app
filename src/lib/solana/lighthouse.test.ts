import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressLookupTableAccount, type MessageV0, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { LIGHTHOUSE, assercaoLighthouse, extensaoLighthouse } from "./lighthouse";
import { emitirVinculo, conferirVinculo } from "./vinculo";
import { validarTransacaoAssinada } from "./transmissao";

const owner = Keypair.generate(), recipient=Keypair.generate().publicKey, fee=Keypair.generate().publicKey;
const jup=new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const block=Keypair.generate().publicKey.toBase58();
const amount=Buffer.from([9,0,2,100,0,0,0,0,0,0,0,0]); // Token Amount(100, Equal)
const base = () => new TransactionInstruction({programId:jup,keys:[{pubkey:owner.publicKey,isSigner:true,isWritable:true},{pubkey:recipient,isSigner:false,isWritable:true},{pubkey:fee,isSigner:false,isWritable:true}],data:Buffer.from([1,10,25,50])});
const assertion = (data=amount) => new TransactionInstruction({programId:new PublicKey(LIGHTHOUSE),keys:[{pubkey:recipient,isSigner:false,isWritable:true}],data});
function tx(ixs=[base()], tables: AddressLookupTableAccount[]=[]) {
 const t=new VersionedTransaction(new TransactionMessage({payerKey:owner.publicKey,recentBlockhash:block,instructions:ixs}).compileToV0Message(tables));t.sign([owner]);return t;
}
const bytes=(t:VersionedTransaction)=>Buffer.from(t.message.serialize()).toString('base64');
const wire=(t:VersionedTransaction)=>Buffer.from(t.serialize()).toString('base64');
function bind(t:VersionedTransaction){return emitirVinculo({mensagem:t.message.serialize(),owner:owner.publicKey.toBase58(),bps:25,feeAccount:fee.toBase58(),validoAteBloco:9999})!;}
beforeEach(()=>vi.stubEnv('TX_VINCULO_SECRET','fixture-only-lighthouse-32-chars-secret'));
afterEach(()=>vi.unstubAllEnvs());
describe('restricted Lighthouse and authenticated original',()=>{
 it('keeps unmodified Jupiter and its exact binding',()=>{const a=tx();expect(validarTransacaoAssinada(wire(a),owner.publicKey.toBase58()).ok).toBe(true);expect(conferirVinculo(bind(a),a).ok).toBe(true);});
 it('accepts validated assertion suffix with original HMAC, including reordered compiled keys',()=>{const a=tx(),b=tx([base(),assertion()]);expect(validarTransacaoAssinada(wire(b),owner.publicKey.toBase58()).ok).toBe(true);expect(conferirVinculo(bind(a),b,Date.now(),bytes(a)).ok).toBe(true);});
 it('rejects extension without authenticated original and rejects forged HMAC',()=>{const a=tx(),b=tx([base(),assertion()]);expect(conferirVinculo(bind(a),b).ok).toBe(false);expect(conferirVinculo(bind(a)+'x',b,Date.now(),bytes(a)).ok).toBe(false);expect(conferirVinculo(bind(a),b,Date.now(),bytes(b)).ok).toBe(false);});
 it.each(['recipient','fee','remove fee','amount','token','slippage','permissions'])('rejects changed %s even re-signed',what=>{
 const a=tx(),ix=base();
 if(what==='recipient')ix.keys[1].pubkey=Keypair.generate().publicKey;
 else if(what==='fee')ix.keys[2].pubkey=Keypair.generate().publicKey;
 else if(what==='remove fee')ix.keys.pop();
 else if(what==='permissions')ix.keys[2].isWritable=false;
 else ix.data[{'amount':1,'token':2,'slippage':3}[what]!]++;
 const b=tx([ix,assertion()]);expect(conferirVinculo(bind(a),b,Date.now(),bytes(a)).ok).toBe(false);
 });
 it('rejects extra non-Lighthouse instruction, preprended assertion and altered blockhash',()=>{
 const a=tx();for(const b of [tx([base(),base(),assertion()]),tx([assertion(),base()])])expect(extensaoLighthouse(a.message as MessageV0,b.message as MessageV0)).toBe(false);
 const b=tx([base(),assertion()]);b.message.recentBlockhash=Keypair.generate().publicKey.toBase58();expect(conferirVinculo(bind(a),b,Date.now(),bytes(a)).ok).toBe(false);
 });
 it('rejects invalid signatures and payer',()=>{const a=tx(),b=tx([base(),assertion()]);b.signatures[0][0]^=1;expect(validarTransacaoAssinada(wire(b),owner.publicKey.toBase58()).ok).toBe(false);expect(validarTransacaoAssinada(wire(a),recipient.toBase58()).ok).toBe(false);});
 it('rejects unknown programs and writable added accounts',()=>{const ix=assertion();ix.programId=Keypair.generate().publicKey;expect(validarTransacaoAssinada(wire(tx([base(),ix])),owner.publicKey.toBase58()).ok).toBe(false);const bad=assertion();bad.keys[0].pubkey=Keypair.generate().publicKey;const a=tx(),b=tx([base(),bad]);expect(conferirVinculo(bind(a),b,Date.now(),bytes(a)).ok).toBe(false);});
 it('compares unchanged ALT entries without trusting caller-supplied resolved addresses',()=>{
 const table=new AddressLookupTableAccount({key:Keypair.generate().publicKey,state:{deactivationSlot:BigInt('18446744073709551615'),lastExtendedSlot:1,lastExtendedSlotStartIndex:0,addresses:[recipient,fee]}});
 const a=tx([base()],[table]),b=tx([base(),assertion()],[table]);expect(conferirVinculo(bind(a),b,Date.now(),bytes(a)).ok).toBe(true);
 b.message.addressTableLookups[0].writableIndexes.reverse();expect(conferirVinculo(bind(a),b,Date.now(),bytes(a)).ok).toBe(false);
 });
 it('rejects added signer and Lighthouse privilege elevation',()=>{const a=tx(),ix=assertion();ix.keys.push({pubkey:new PublicKey(LIGHTHOUSE),isSigner:false,isWritable:true});expect(conferirVinculo(bind(a),tx([base(),ix]),Date.now(),bytes(a)).ok).toBe(false);});
 it('rejects a valid extra signer even when every signature verifies',()=>{
 const a=tx(), other=Keypair.generate(), ix=base();ix.keys.push({pubkey:other.publicKey,isSigner:true,isWritable:false});
 const b=new VersionedTransaction(new TransactionMessage({payerKey:owner.publicKey,recentBlockhash:block,instructions:[ix,assertion()]}).compileToV0Message());b.sign([owner,other]);
 expect(validarTransacaoAssinada(wire(b),owner.publicKey.toBase58()).ok).toBe(true);
 expect(conferirVinculo(bind(a),b,Date.now(),bytes(a)).ok).toBe(false);
 });
 it('preserves approved zero-fee binding' ,()=>{const a=tx(),b=tx([base(),assertion()]);const token=emitirVinculo({mensagem:a.message.serialize(),owner:owner.publicKey.toBase58(),bps:0,feeAccount:null,validoAteBloco:9999});const r=conferirVinculo(token,b,Date.now(),bytes(a));expect(r.ok&&r.dados.b).toBe(0);});
});
describe('Lighthouse structure, no write instructions',()=>{
 it('accepts single amount and canonical multi assertion',()=>{expect(assercaoLighthouse(amount,1)).toBe(true);expect(assercaoLighthouse(Buffer.from([10,0,1,...amount.subarray(2)]),1)).toBe(true);});
 it.each([0,1,2,3,4,7,8,11,12,13,14,15,16,17,255])('rejects unsupported opcode %i',op=>{expect(assercaoLighthouse(Buffer.from([op,0,2,...amount.subarray(3)]),1)).toBe(false);});
 it('rejects trailing/truncated bytes, bad operators, account counts and multi counts',()=>{
 for(const b of [amount.subarray(0,amount.length-1),Buffer.concat([amount,Buffer.from([0])]),Buffer.from([9,0,2,0,0,0,0,0,0,0,0,9]),Buffer.from([10,0,0]),Buffer.from([10,0,129,0,...amount.subarray(2)])])expect(assercaoLighthouse(b,1)).toBe(false);
 expect(assercaoLighthouse(amount,2)).toBe(false);
 });
});
