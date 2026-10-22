/**
 * Deterministic merge of per-subsystem netlists into one board netlist.
 *
 * Each subsystem agent designs its block independently and connects to the rest
 * of the board purely through SHARED NET LABELS (same name = same net). So the
 * merge is mostly concatenation: components + connections from every block, with
 * the one piece of real work being refDes de-collision — two blocks may both use
 * "U1"/"R1". We renumber clashes deterministically and rewrite every reference
 * (connection endpoints + parentRefDes) to match. Label net NAMES are never
 * touched, so inter-block connections (by name) survive intact.
 */

import type {
  BuildLogicalNetlist,
  BuildLogicalComponent,
  BuildLogicalConnection,
} from "@/lib/schematic-types";
import { isLabelConnection } from "@/lib/schematic-types";

type NamedBlock = { name: string; netlist: BuildLogicalNetlist };

function parseRef(refDes: string): { prefix: string; num: number | null } {
  const m = refDes.match(/^([A-Za-z]+)(\d+)$/);
  if (m) return { prefix: m[1], num: parseInt(m[2], 10) };
  return { prefix: refDes, num: null };
}

/** Next free refDes keeping the prefix: bump the number (or append _n). */
function nextFreeRef(refDes: string, used: Set<string>): string {
  const { prefix, num } = parseRef(refDes);
  if (num !== null) {
    let n = num + 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }
  let n = 2;
  while (used.has(`${refDes}_${n}`)) n++;
  return `${refDes}_${n}`;
}

/** Rewrite the refDes part of a "refDes.pin" endpoint via the remap (GND stays). */
function remapEndpoint(ep: string, remap: Map<string, string>): string {
  if (ep.trim().toUpperCase() === "GND") return ep;
  const idx = ep.indexOf(".");
  if (idx < 0) return remap.get(ep) ?? ep;
  const refDes = ep.slice(0, idx);
  const mapped = remap.get(refDes);
  return mapped ? `${mapped}${ep.slice(idx)}` : ep;
}

function remapConnection(
  conn: BuildLogicalConnection,
  remap: Map<string, string>,
): BuildLogicalConnection {
  if (isLabelConnection(conn)) {
    return { ...conn, pin: remapEndpoint(conn.pin, remap) };
  }
  return { ...conn, from: remapEndpoint(conn.from, remap), to: remapEndpoint(conn.to, remap) };
}

export function mergeBuildNetlists(
  blocks: NamedBlock[],
): { netlist: BuildLogicalNetlist; notes: string[]; /** [PR-J, 2026-10-22] J5-1: each block's own netlist with its FINAL refDes (input order) */ blocks: NamedBlock[] } {
  const used = new Set<string>();
  const components: BuildLogicalComponent[] = [];
  const connections: BuildLogicalConnection[] = [];
  const notes: string[] = [];
  const merged: NamedBlock[] = []; // [PR-J, 2026-10-22] J5-1: the per-block slices of `components` / `connections` (in place: no line moves)
  for (const block of blocks) { const start = { components: components.length, connections: connections.length };
    // Pass 1 — assign final refDes for this block (de-collide), build the remap.
    const remap = new Map<string, string>();
    for (const c of block.netlist.components) {
      let rd = c.refDes;
      if (used.has(rd)) {
        rd = nextFreeRef(rd, used);
        notes.push(`renamed ${c.refDes} → ${rd} (${block.name})`);
      }
      remap.set(c.refDes, rd);
      used.add(rd);
    }

    // Pass 2 — emit components + connections with the remap applied.
    for (const c of block.netlist.components) {
      const refDes = remap.get(c.refDes)!;
      const parentRefDes =
        c.parentRefDes !== undefined ? remap.get(c.parentRefDes) ?? c.parentRefDes : undefined;
      components.push({
        ...c,
        refDes,
        ...(parentRefDes !== undefined ? { parentRefDes } : {}),
      });
    }
    for (const conn of block.netlist.connections) {
      connections.push(remapConnection(conn, remap));
    }
    merged.push({ name: block.name, netlist: { components: components.slice(start.components), connections: connections.slice(start.connections), explanation: block.netlist.explanation } }); }

  const explanation = blocks
    .map((b) => `${b.name}: ${b.netlist.explanation || "(no notes)"}`)
    .join("\n\n");

  return { netlist: { components, connections, explanation }, notes, blocks: merged };
}
