"use client";

import { useMemo } from "react";
import { gradeDaTerra, projX, projY } from "@/lib/admin/mural/terra";

export interface Praca {
  cidade: string; pais: string;
  lat: number; lon: number; acessos: number; minAtras: number;
}

/**
 * O MAPA — a Terra em pontos, com os acessos reais brilhando por cima.
 *
 * ⚠️ DUAS CAMADAS COM PESOS OPOSTOS, e isso é o desenho inteiro:
 *
 *   · a TERRA é cenário — apagada, fria, sem movimento. Ela orienta e cala.
 *   · o ACESSO é medição — quente, pulsando, com halo. Ele é o assunto.
 *
 * Se as duas tivessem o mesmo peso, o olho leria "mapa bonito". Com a terra
 * recuada, o olho lê "isto aqui está acontecendo" — que é a verdade, e é o que
 * uma tela de parede tem meio segundo para comunicar a quem passa.
 *
 * ⚠️ O BRILHO É O TEMPO. Um acesso de agora é branco e pulsa; um de ontem é
 * uma brasa fria. Ponto que não decai transformaria "esteve aqui uma vez" em
 * "está aqui" — a mentira mais fácil de um mapa ao vivo.
 */
export default function MapaMundi({
  pracas,
  compacto = false,
}: {
  pracas: Praca[];
  compacto?: boolean;
}) {
  /** A silhueta não muda; calcular a cada respiro seria desperdício puro. */
  const terra = useMemo(() => gradeDaTerra(compacto ? 3.2 : 2.2), [compacto]);

  /** Escala do ponto pelo volume de acessos — raiz, para 1000 não virar disco. */
  const raio = (n: number) => Math.min(2.2, 0.5 + Math.sqrt(n) * 0.16);
  /** 0 = agora, 1 = frio. Uma hora é o horizonte do "ao vivo". */
  const idade = (min: number) => Math.min(1, Math.max(0, min / 60));

  return (
    <svg
      viewBox="0 0 360 156"
      className="mural-mapa"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Mapa global · ${pracas.length} praça(s) com acesso nos últimos 30 dias`}
    >
      <defs>
        {/* O halo do ponto quente. Um só, reaproveitado — cada acesso com o
            seu filtro derrubaria a taxa de quadros numa tela de 65". */}
        <radialGradient id="mural-halo">
          <stop offset="0%"   stopColor="var(--mural-vivo)" stopOpacity="0.55" />
          <stop offset="45%"  stopColor="var(--mural-vivo)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--mural-vivo)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── CAMADA 1 · A TERRA. Cenário, e se comporta como cenário. ───── */}
      <g className="mural-terra">
        {terra.map((p, i) => (
          <circle key={i} cx={p.x * 360} cy={p.y * 156} r={compacto ? 0.42 : 0.34} />
        ))}
      </g>

      {/* ── CAMADA 2 · OS ACESSOS. Medição, e o assunto da tela. ───────── */}
      <g>
        {pracas.map((p) => {
          const x = projX(p.lon) * 360;
          const y = projY(p.lat) * 156;
          const r = raio(p.acessos);
          const frio = idade(p.minAtras);
          /** Quanto mais recente, mais opaco e mais rápido o pulso. */
          const op = 1 - frio * 0.62;
          return (
            <g key={`${p.lat},${p.lon}`} style={{ opacity: op }}>
              <circle cx={x} cy={y} r={r * 7} fill="url(#mural-halo)"
                      className={frio < 0.35 ? "mural-pulso" : undefined} />
              <circle cx={x} cy={y} r={r} className="mural-ponto" />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
