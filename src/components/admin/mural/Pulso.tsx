"use client";

/**
 * O PULSO — atividade por minuto na última hora.
 *
 * ⚠️ O NOME É O QUE O DADO É. A referência pedia "Requests / Second"; isto é
 * contagem de EVENTOS por MINUTO. Um evento não é uma requisição e a
 * granularidade não é de segundo — usar o rótulo da referência daria ao número
 * uma precisão que ele não tem, e alguém acabaria citando "requisições por
 * segundo" numa reunião com base nesta linha.
 *
 * ⚠️ E O EIXO COMEÇA EM ZERO, SEMPRE. Um gráfico que corta a base transforma
 * uma variação de 2 para 3 numa montanha — é a forma mais comum de um gráfico
 * honesto mentir, e numa tela de parede ninguém vai conferir o eixo.
 */
export default function Pulso({ serie }: { serie: number[] }) {
  const pico = Math.max(1, ...serie);
  const L = serie.length || 1;

  /** Área preenchida até a base — o zero fica visível como chão. */
  const pontos = serie.map((v, i) => `${(i / (L - 1)) * 100},${100 - (v / pico) * 100}`);
  const linha = `M${pontos.join(" L")}`;
  const area = `${linha} L100,100 L0,100 Z`;

  const total = serie.reduce((s, v) => s + v, 0);

  return (
    <figure className="pulso">
      <figcaption>
        <span>PULSO · EVENTOS POR MINUTO · ÚLTIMA HORA</span>
        <span className="pulso-num">
          <b>{total}</b> no período · pico <b>{pico}</b>/min
        </span>
      </figcaption>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label={`Atividade por minuto na última hora — ${total} eventos, pico de ${pico}`}>
        <defs>
          <linearGradient id="pulso-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--mural-vivo)" stopOpacity=".38" />
            <stop offset="100%" stopColor="var(--mural-vivo)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* A base em zero, desenhada — para o chão do gráfico ser visível. */}
        <line x1="0" y1="100" x2="100" y2="100" className="pulso-base" />
        <path d={area}  className="pulso-area" />
        <path d={linha} className="pulso-linha" vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  );
}
