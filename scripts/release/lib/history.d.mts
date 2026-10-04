export interface LinhaHistorico {
  version: string; name?: string | null; statements?: string[] | null; rollback?: string[] | null;
  created_by?: string | null; idempotency_key?: string | null;
}
export interface Canonica {
  version: string; name: string | null; statements_md5: string; rollback_md5: string;
  created_by_present: boolean; idempotency_key_present: boolean;
}
export interface Comparacao {
  referencia: number; atual: number; iguais: number;
  diferentes: string[]; faltando: string[]; extras: string[]; referenciaIntegra: boolean;
}
export function canonica(r: LinhaHistorico): Canonica;
export function hashConjunto(rows: LinhaHistorico[]): string;
export function comparar(atual: LinhaHistorico[], referencia: LinhaHistorico[]): Comparacao;
export function extrasConferem(resultado: Comparacao, esperadas: string[]): boolean;
