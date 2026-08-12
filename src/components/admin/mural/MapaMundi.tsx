"use client";

import { useMemo } from "react";
import { gradeDaTerra, projX, projY } from "@/lib/admin/mural/terra";

export interface Praca {
  cidade: string; pais: string;
  lat: number; lon: number; acessos: number; minAtras: number;
}

/**
 * ⚠️ O MAPA É DESENHADO COM CARACTERES, não com círculos (12/08).
 *
 * A versão de pontos lia como gráfico. Glifo lê como TERMINAL — é a mesma
 * diferença entre um mapa numa apresentação e um mapa numa sala de operações,
 * e esta tela fica ligada numa sala de operações.
 *
 * ⚠️ E O GLIFO É ESTÁVEL POR COORDENADA. Sorteá-lo a cada quadro faria a Terra
 * inteira cintilar como chuvisco, e o olho perderia o que importa: os acessos
 * pulsando por cima. O caractere sai de um hash da própria posição — o mesmo
 * lugar desenha sempre o mesmo símbolo, e o mapa fica quieto para o dado poder
 * se mexer.
 */
const GLIFOS = "ᚦᚱᚨᛁᛗᛒᛖᛚᛞᚷᚹᛟ0123456789";

/** Hash barato e determinístico: mesma coordenada, mesmo glifo, sempre. */
function glifoDe(x: number, y: number): string {
  const h = Math.abs(Math.round(x * 9973) * 31 + Math.round(y * 9973) * 17);
  return GLIFOS[h % GLIFOS.length];
}

export default function MapaMundi({
  pracas,
  compacto = false,
}: {
  pracas: Praca[];
  compacto?: boolean;
}) {
  /* ⚠️ "ALTA DENSIDADE" é pedido da referência, e no telão faz diferença: a
     1,7° a silhueta fica rala e o mapa parece um esboço. A 1,2° são ~7 mil
     glifos, que o navegador desenha uma vez e não redesenha — a grade é
     memorizada e não depende do dado. */
  const terra = useMemo(() => gradeDaTerra(compacto ? 2.4 : 1.2), [compacto]);

  const raio = (n: number) => Math.min(2.4, 0.6 + Math.sqrt(n) * 0.17);
  const idade = (min: number) => Math.min(1, Math.max(0, min / 60));

  /**
   * ⚠️ OS ARCOS SAEM DA PRAÇA MAIS ATIVA para as outras — e só existem com
   * duas praças ou mais. Um arco de um ponto para ele mesmo seria enfeite
   * puro, e enfeite que finge ser rota é a categoria de mentira visual que
   * esta tela não pode ter.
   */
  const arcos = useMemo(() => {
    if (pracas.length < 2) return [];
    const [origem, ...resto] = pracas;
    return resto.slice(0, 5).map((p) => {
      const x1 = projX(origem.lon) * 360, y1 = projY(origem.lat) * 156;
      const x2 = projX(p.lon) * 360,      y2 = projY(p.lat) * 156;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.32;
      return { d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, k: `${p.lat},${p.lon}` };
    });
  }, [pracas]);

  return (
    <svg
      viewBox="0 0 360 156"
      className="mural-mapa"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Mapa global · ${pracas.length} praça(s) com acesso nos últimos 30 dias`}
    >
      <defs>
        <radialGradient id="mural-halo">
          <stop offset="0%"   stopColor="var(--mural-vivo)" stopOpacity="0.6" />
          <stop offset="45%"  stopColor="var(--mural-vivo)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--mural-vivo)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mural-arco" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="var(--mural-vivo)" stopOpacity="0" />
          <stop offset="50%"  stopColor="var(--mural-vivo)" stopOpacity=".7" />
          <stop offset="100%" stopColor="var(--mural-vivo)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* ── CAMADA 1 · A TERRA EM GLIFOS. Cenário, e se comporta como tal. */}
      <g className="mural-terra" aria-hidden>
        {terra.map((p, i) => (
          <text key={i} x={p.x * 360} y={p.y * 156}
                fontSize={compacto ? 2.0 : 1.35} textAnchor="middle">
            {glifoDe(p.x, p.y)}
          </text>
        ))}
      </g>

      {/* ── CAMADA 2 · AS ROTAS. Só com duas praças ou mais. ───────────── */}
      <g className="mural-arcos" aria-hidden>
        {arcos.map((a) => <path key={a.k} d={a.d} />)}
      </g>

      {/* ── CAMADA 3 · OS ACESSOS. Medição, e o assunto da tela. ───────── */}
      <g>
        {pracas.map((p) => {
          const x = projX(p.lon) * 360;
          const y = projY(p.lat) * 156;
          const r = raio(p.acessos);
          const frio = idade(p.minAtras);
          return (
            <g key={`${p.lat},${p.lon}`} style={{ opacity: 1 - frio * 0.6 }}>
              {/* O halo: ESTÁTICO. É o brilho do ponto, e brilho que apaga
                  sozinho lê como defeito — ver a nota em `.mural-ping`. */}
              <circle cx={x} cy={y} r={r * 7.5} fill="url(#mural-halo)" />
              {/* A mira: dá coordenada ao ponto, como num radar. */}
              <circle cx={x} cy={y} r={r * 2.6} className="mural-mira" />
              {/* Os anéis: só no acesso RECENTE, e aditivos — some sem tirar
                  nada da tela. Dois, com atraso, para varrer em vez de piscar. */}
              {frio < 0.35 && (
                <>
                  <circle cx={x} cy={y} r={1.2} className="mural-ping" />
                  <circle cx={x} cy={y} r={1.2} className="mural-ping atras" />
                </>
              )}
              <circle cx={x} cy={y} r={r} className="mural-ponto" />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
