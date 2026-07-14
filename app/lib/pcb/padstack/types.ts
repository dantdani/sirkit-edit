// Via padstacks (PCB Stage 17) — PINNED model. Stage 17 Phase A ships the
// types (the edit-command union references them); the registry, migration and
// defaults land in Phase C. Padstacks are VIAS ONLY: pad geometry is owned by
// `FootprintDef.rawSexpr` and re-emitted verbatim on export (Stage 1/13
// invariant) — a per-instance pad padstack would silently desync the screen
// from the exported board.

export interface Padstack {
  id: string;
  name: string; // 'Via 0.6/0.3', 'Power via 0.9/0.45'
  kind: "via"; // pad kinds post-MVP — see docs/pcb-post-mvp.md
  outerNm: number; // uniform on all spanned copper layers (MVP: through vias)
  drillNm: number;
  tented: boolean; // default true
  zoneConnect: "solid" | "thermal"; // default solid (Stage 11 consumes)
}

export type PadstackInput = Omit<Padstack, "id">;
