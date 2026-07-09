// Browser-side KiCad export trigger (PCB Stage 13): POST the current board +
// netlist to /api/pcb/export/kicad-pcb and hand the response to the browser
// as a file download. Never throws — the toolbar has no error UI (MVP).

import type { PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";

export async function downloadKicadPcb(
  board: PcbBoard,
  netlist: PcbNetlist | null,
  boardName = "sirkit-board",
): Promise<boolean> {
  try {
    const res = await fetch("/api/pcb/export/kicad-pcb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        board,
        ...(netlist ? { netlist } : {}),
        options: { boardName },
      }),
    });
    if (!res.ok) throw new Error(`export failed (HTTP ${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${boardName}.kicad_pcb`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (e) {
    console.error("KiCad export failed:", e);
    return false;
  }
}
