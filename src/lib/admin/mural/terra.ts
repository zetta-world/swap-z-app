/**
 * A TERRA — silhueta em caixas de latitude/longitude.
 *
 * ⚠️ POR QUE NÃO UM GEOJSON: o mural não busca nada de fora (a casa não usa
 * CDN), e um contorno real seriam centenas de quilobytes para desenhar, num
 * mapa de PONTOS, a mesma silhueta que estas caixas produzem. O custo estaria
 * no lugar errado.
 *
 * Isto é CENÁRIO. Nenhuma decisão sai daqui — o que é medido (a posição de
 * cada acesso) vem do `platform_events` e é desenhado POR CIMA, com precisão
 * de verdade. Se alguém um dia quiser medir fronteira ou área nesta tela, a
 * resposta é que ela não serve para isso.
 *
 * Cada caixa é [oeste, sul, leste, norte] em graus.
 */
type Caixa = readonly [number, number, number, number];

const TERRA: readonly Caixa[] = [
  // ── AMÉRICA DO NORTE ──────────────────────────────────────────────
  [-168, 54, -141, 71], [-141, 60, -62, 71], [-134, 49, -58, 60],
  [-125, 31, -70, 49],  [-115, 23, -97, 31],  [-106, 16, -88, 23],
  [-92, 8, -78, 17],    [-84, 18, -66, 23],
  [-55, 60, -20, 82],                                   // Groenlândia
  // ── AMÉRICA DO SUL ────────────────────────────────────────────────
  [-79, 1, -52, 12],  [-81, -16, -35, 1],  [-74, -33, -39, -16],
  [-73, -52, -54, -33],
  // ── EUROPA ────────────────────────────────────────────────────────
  [-10, 36, 28, 45],  [-5, 45, 30, 55],  [-8, 50, 2, 59],
  [4, 55, 31, 62],    [5, 62, 30, 70],
  // ── ÁFRICA ────────────────────────────────────────────────────────
  [-17, 14, 34, 32],  [-17, 5, 47, 14],  [8, -13, 42, 5],
  [11, -34, 40, -13], [43, -25, 50, -12],
  // ── ÁSIA ──────────────────────────────────────────────────────────
  [28, 40, 60, 55],   [30, 55, 180, 71],  [60, 40, 140, 55],
  [44, 12, 60, 32],   [60, 25, 78, 40],   [68, 8, 90, 30],
  [95, 20, 122, 40],  [95, 8, 110, 20],   [122, 33, 130, 43],
  [130, 31, 146, 45],                                   // Japão
  [95, -9, 141, 6],   [117, 5, 126, 19],                // Indonésia, Filipinas
  // ── OCEANIA ───────────────────────────────────────────────────────
  [113, -35, 154, -11], [166, -47, 179, -34],
  // ── ANTÁRTICA ─────────────────────────────────────────────────────
  [-180, -90, 180, -65],
];

/** Há terra nesta coordenada? */
export function ehTerra(lon: number, lat: number): boolean {
  for (const [o, s, l, n] of TERRA) {
    if (lon >= o && lon <= l && lat >= s && lat <= n) return true;
  }
  return false;
}

export interface PontoGrade { x: number; y: number }

/**
 * A grade de pontos que desenha o mapa, em coordenadas 0..1.
 *
 * ⚠️ PROJEÇÃO EQUIRRETANGULAR, e a escolha tem motivo: Mercator infla a
 * Groenlândia até ela parecer maior que a África. Num mural sobre alcance
 * global, distorcer o tamanho do mundo é o tipo de mentira silenciosa que esta
 * casa não deixa passar nos números — não vai passar no mapa.
 */
export function gradeDaTerra(passo = 2.5): PontoGrade[] {
  const pontos: PontoGrade[] = [];
  for (let lat = 78; lat >= -78; lat -= passo) {
    for (let lon = -180; lon <= 180; lon += passo) {
      if (ehTerra(lon, lat)) pontos.push({ x: projX(lon), y: projY(lat) });
    }
  }
  return pontos;
}

/** Longitude → 0..1. */
export const projX = (lon: number): number => (lon + 180) / 360;
/** Latitude → 0..1, recortada em ±78° (onde a grade termina). */
export const projY = (lat: number): number => (78 - lat) / 156;
