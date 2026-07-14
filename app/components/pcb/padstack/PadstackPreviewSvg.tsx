"use client";

/**
 * Padstack thumbnail (PCB Stage 17 Phase C) — annulus in copper teal, drill
 * punched in the canvas background, diagonal tent hatch when the via is
 * covered by solder mask. Pure SVG, sized to fit the outer diameter.
 */

import { useId } from "react";

const COPPER = "#14b8a6"; // copperTop defaultColor (layers.ts)
const BACKGROUND = "#09090b";
const MASK = "#0f766e";

export function PadstackPreviewSvg({
  outerNm,
  drillNm,
  tented,
  size = 40,
}: {
  outerNm: number;
  drillNm: number;
  tented: boolean;
  size?: number;
}) {
  const clipId = useId();
  const c = size / 2;
  const pad = 2;
  const rOuter = Math.max(size / 2 - pad, 1);
  const rDrill = Math.max(Math.min((drillNm / Math.max(outerNm, 1)) * rOuter, rOuter - 1), 0);

  const hatch: React.ReactNode[] = [];
  if (tented) {
    for (let i = -2; i <= 2; i++) {
      const off = i * (size / 4);
      hatch.push(
        <line
          key={i}
          x1={off}
          y1={size}
          x2={off + size}
          y2={0}
          stroke={MASK}
          strokeWidth={1.5}
          opacity={0.7}
        />,
      );
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <defs>
        <clipPath id={clipId}>
          <circle cx={c} cy={c} r={rOuter} />
        </clipPath>
      </defs>
      <circle cx={c} cy={c} r={rOuter} fill={COPPER} />
      <circle cx={c} cy={c} r={rDrill} fill={BACKGROUND} stroke="#27272a" strokeWidth={0.5} />
      {tented && <g clipPath={`url(#${clipId})`}>{hatch}</g>}
    </svg>
  );
}
