export interface ItemCadeia { name: string; severity: string; isDirect: boolean; nodes: string[]; via: string[] }
export interface Advisory { source: number; name: string; severity: string; range: string; url?: string }
export interface Excecoes {
  versao: number; status: string; revisar_antes_do_rc: boolean; decisao: string;
  excecoes: Array<{ id: string; advisory: Advisory; cadeia: ItemCadeia[]; por_que: string; corrigido: boolean }>;
  [k: string]: unknown;
}
export function itemDaCadeia(v: unknown): ItemCadeia;
export function cadeiaAtual(audit: unknown): ItemCadeia[];
export function advisoriesAltos(audit: unknown): Advisory[];
export function avaliar(audit: unknown, excecoes: unknown): { ok: boolean; falhas: string[]; avisos: string[] };
