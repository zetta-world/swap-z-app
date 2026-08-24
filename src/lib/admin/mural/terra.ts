/**
 * A TERRA — silhueta por FAIXA de latitude.
 *
 * ⚠️ A PRIMEIRA VERSÃO ERA CAIXAS, e o dono olhou e disse "o mapa não está bem
 * definido". Estava certo: retângulos de continente inteiro davam uma África
 * quadrada e a Europa colada na Ásia num bloco só. Reconhecível, feio.
 *
 * Aqui cada faixa de 3° de latitude lista os TRECHOS de longitude com terra —
 * que é uma codificação por corrida do próprio mapa. Dá o afunilamento do
 * México, a ponta da América do Sul, o estrangulamento do Mediterrâneo e as
 * ilhas da Indonésia, com o mesmo custo de memória de antes.
 *
 * ⚠️ CONTINUA SENDO CENÁRIO. Nenhuma decisão sai daqui — o que é medido (a
 * posição de cada acesso) vem do `platform_events` e é desenhado POR CIMA, com
 * precisão de verdade. Esta tabela não serve para medir fronteira nem área.
 */

/** latitude → trechos [oeste, leste] com terra. */
const FAIXAS: ReadonlyArray<readonly [number, ReadonlyArray<readonly [number, number]>]> = [
  [ 72, [[-160,-140],[-128,-62],[-55,-20],[50,180]]],
  [ 69, [[-165,-141],[-135,-60],[-52,-22],[12,180]]],
  [ 66, [[-168,-140],[-140,-60],[-52,-25],[10,30],[35,180]]],
  [ 63, [[-166,-140],[-140,-58],[-50,-30],[5,30],[33,180]]],
  [ 60, [[-165,-138],[-138,-55],[-48,-38],[4,30],[32,180]]],
  [ 57, [[-163,-133],[-133,-55],[8,180]]],
  [ 54, [[-135,-52],[-8,-4],[9,30],[32,180]]],
  [ 51, [[-130,-55],[-10,2],[4,30],[32,145]]],
  [ 48, [[-128,-60],[-5,30],[32,142]]],
  [ 45, [[-125,-65],[-2,30],[32,135],[138,146]]],
  [ 42, [[-124,-70],[-9,-6],[0,30],[32,125],[128,143]]],
  [ 39, [[-124,-74],[-9,-6],[0,45],[48,122],[126,141]]],
  [ 36, [[-122,-76],[-9,35],[38,122],[126,140]]],
  [ 33, [[-118,-78],[-8,-1],[8,12],[20,60],[62,122]]],
  [ 30, [[-116,-82],[-10,-1],[10,35],[36,90],[95,122]]],
  [ 27, [[-114,-90],[-14,35],[38,80],[85,120]]],
  [ 24, [[-110,-93],[-17,36],[38,78],[85,120]]],
  [ 21, [[-106,-95],[-17,40],[42,78],[88,110]]],
  [ 18, [[-104,-96],[-90,-83],[-78,-70],[-17,42],[45,78],[92,110]]],
  [ 15, [[-96,-84],[-75,-70],[-17,45],[48,78],[92,110]]],
  [ 12, [[-92,-83],[-75,-60],[-17,48],[50,78],[95,110]]],
  [  9, [[-84,-77],[-78,-50],[-14,48],[75,80],[95,107],[120,127]]],
  [  6, [[-80,-45],[-10,47],[95,120]]],
  [  3, [[-80,-40],[8,45],[95,120]]],
  [  0, [[-80,-38],[9,42],[97,120]]],
  [ -3, [[-79,-35],[10,42],[100,120],[130,141]]],
  [ -6, [[-78,-35],[11,40],[100,120],[130,141]]],
  [ -9, [[-76,-34],[12,40],[112,120],[125,141]]],
  [-12, [[-74,-35],[13,40],[43,50],[128,141]]],
  [-15, [[-72,-38],[11,40],[43,50],[126,141]]],
  [-18, [[-71,-39],[11,36],[43,49],[113,148]]],
  [-21, [[-70,-40],[12,35],[43,48],[113,152]]],
  [-24, [[-70,-42],[14,33],[113,153]]],
  [-27, [[-71,-48],[15,33],[113,153]]],
  [-30, [[-72,-50],[16,31],[114,152]]],
  [-33, [[-72,-53],[17,27],[115,150],[166,178]]],
  [-36, [[-73,-56],[138,146],[166,179]]],
  [-39, [[-73,-62],[172,177]]],
  [-42, [[-74,-64],[166,175]]],
  [-45, [[-75,-66],[167,171]]],
  [-48, [[-75,-68]]],
  [-51, [[-74,-68]]],
  [-54, [[-72,-67]]],
  /** Antártica — a faixa que fecha o mapa embaixo. */
  [-69, [[-180,180]]],
  [-72, [[-180,180]]],
];

export interface PontoGrade { x: number; y: number }

/**
 * A grade de pontos que desenha a Terra, em coordenadas 0..1.
 *
 * ⚠️ PROJEÇÃO EQUIRRETANGULAR, e a escolha tem motivo: Mercator infla a
 * Groenlândia até ela parecer maior que a África. Num mural sobre alcance
 * global, distorcer o tamanho do mundo é a mentira silenciosa que esta casa
 * não deixa passar nos números — não vai passar no mapa.
 *
 * @param passo graus de longitude por ponto. Menor = silhueta mais fina e
 *              mais nós no DOM; 1,5 dá ~3.500 pontos, que uma TV desenha sem
 *              suar e um celular também.
 */
export function gradeDaTerra(passo = 1.5): PontoGrade[] {
  const pontos: PontoGrade[] = [];
  for (const [lat, trechos] of FAIXAS) {
    const y = projY(lat);
    for (const [oeste, leste] of trechos) {
      for (let lon = oeste; lon <= leste; lon += passo) {
        pontos.push({ x: projX(lon), y });
      }
    }
  }
  return pontos;
}

/** Longitude → 0..1. */
export const projX = (lon: number): number => (lon + 180) / 360;
/** Latitude → 0..1, na janela ±78° que a grade cobre. */
export const projY = (lat: number): number => (78 - lat) / 156;

/** Há terra aqui? Usado só por teste — o desenho percorre a grade direto. */
export function ehTerra(lon: number, lat: number): boolean {
  let melhor: readonly (readonly [number, number])[] | null = null;
  let dist = Infinity;
  for (const [la, trechos] of FAIXAS) {
    const d = Math.abs(la - lat);
    if (d < dist) { dist = d; melhor = trechos; }
  }
  if (!melhor || dist > 2) return false;
  return melhor.some(([o, l]) => lon >= o && lon <= l);
}
