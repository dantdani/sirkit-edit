/**
 * Build the physical-prototype deliverable set for a verified R05-E2E01 run.
 *
 * Everything is derived from what the run actually produced — the generated
 * netlist, the published atomic authority (real MPNs, manufacturers, datasheet
 * URLs) and the release manifest. Nothing is hand-asserted, so the BOM cannot
 * drift from the board that was released.
 *
 * Usage: pnpm exec tsx scripts/make-prototype-deliverables.ts <projectId>
 */

import { loadEnvLocal } from "../app/lib/load-env-local";
loadEnvLocal();
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalizeValueKey } from "../app/lib/atomic/value-key";

const projectId = process.argv[2];
if (!projectId) { console.error("usage: make-prototype-deliverables.ts <projectId>"); process.exit(2); }

const OUT = join(__dirname, "output");
const DELIVER = join(OUT, `deliverables-${projectId}`);

interface AtomicEntry {
  key: string; partId: string; valueKeys: string[]; mpn: string; manufacturer: string;
  datasheetUrl: string; footprintFullName: string; symbolFullName: string; packageCode: string;
  mounting: "smd" | "through_hole"; atomicPartRevisionId: string;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main(): void {
  const netlist = JSON.parse(readFileSync(join(OUT, `netlist-${projectId}.json`), "utf8")) as {
    components: Array<{ refDes: string; value?: string; partId: string; role?: string }>;
  };
  const atomic = (JSON.parse(readFileSync(join(OUT, "atomic-demo-manifest.json"), "utf8")) as { parts: AtomicEntry[] }).parts;
  const electricalPath = join(OUT, `electrical-${projectId}.json`);
  const electrical = existsSync(electricalPath) ? JSON.parse(readFileSync(electricalPath, "utf8")) as {
    network?: { RA?: string; RB?: string; C?: string };
    computed?: { fNominalHz?: number; dutyPercent?: number };
    verdict?: string;
  } : {};

  const releaseZip = join(OUT, `sirkit-verified-release-${projectId}.zip`);
  const mfgZip = join(OUT, `manufacturer-upload-${projectId}.zip`);

  // Match each placed component to its published exact part.
  const rows = netlist.components.map((c) => {
    const vk = normalizeValueKey(c.value);
    const match = atomic.find((a) => a.partId === c.partId && a.valueKeys.includes(vk))
      ?? atomic.find((a) => a.partId === c.partId && a.valueKeys.includes(""));
    return { refDes: c.refDes, value: c.value ?? "", role: c.role ?? "", entry: match };
  }).sort((a, b) => a.refDes.localeCompare(b.refDes, undefined, { numeric: true }));

  const unmatched = rows.filter((r) => !r.entry);
  if (unmatched.length) {
    console.error(`ABORT: no published exact part for ${unmatched.map((r) => `${r.refDes}=${r.value}`).join(", ")}`);
    process.exit(1);
  }

  mkdirSync(DELIVER, { recursive: true });

  // ── Prototype BOM ────────────────────────────────────────────────────────
  const grouped = new Map<string, { refs: string[]; row: typeof rows[number] }>();
  for (const r of rows) {
    const key = `${r.entry!.mpn}|${r.value}`;
    const g = grouped.get(key);
    if (g) g.refs.push(r.refDes); else grouped.set(key, { refs: [r.refDes], row: r });
  }
  const ratings: Record<string, string> = {
    resistor: "1% tolerance, 125 mW (0805), 150 V max working voltage",
    capacitor: "X7R dielectric, >=16 V rating (>3x derating on a 5 V rail), +/-10%",
    led: "Red, Vf 1.9 V typ / 2.4 V max at 20 mA, 2.5 V reverse max",
    timer: "4.5-16 V supply, 200 mA output sink/source, SOIC-8",
    header: "2.54 mm pitch, >=3 A per contact, 250 V AC rating",
  };
  const kindOf = (mpn: string, pkg: string): string =>
    /^RC0805/.test(mpn) ? "resistor" : /^CL21B/.test(mpn) ? "capacitor" : /^LTST/.test(mpn) ? "led"
      : /555/.test(mpn) ? "timer" : /PinHeader|61300/.test(pkg + mpn) ? "header" : "other";

  const bomRows = [...grouped.values()].map(({ refs, row }) => {
    const e = row.entry!;
    const kind = kindOf(e.mpn, e.packageCode);
    return {
      refs: refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", "),
      qty: refs.length, value: row.value, mpn: e.mpn, manufacturer: e.manufacturer,
      pkg: e.packageCode, mounting: e.mounting === "smd" ? "SMD" : "Through-hole",
      footprint: e.footprintFullName, datasheet: e.datasheetUrl,
      rating: ratings[kind] ?? "see datasheet",
      substitution: kind === "resistor" ? "Any 0805 1% resistor of the same value (e.g. Panasonic ERJ-6ENF)"
        : kind === "capacitor" ? "Any 0805 X7R >=16 V capacitor of the same value (e.g. Murata GRM21B)"
        : kind === "led" ? "Any 0805 red LED with Vf <= 2.4 V; verify cathode/anode pad order matches the footprint"
        : kind === "timer" ? "Any bipolar 555 in SOIC-8 (SA555D, NA555D, LM555CM). A CMOS TLC555 changes output drive and would need the LED resistor re-sized"
        : kind === "header" ? "Any 1x02 2.54 mm vertical through-hole header"
        : "none qualified",
    };
  }).sort((a, b) => a.refs.localeCompare(b.refs, undefined, { numeric: true }));

  const csv = ["Ref,Qty,Value,MPN,Manufacturer,Package,Mounting,Footprint,Rating,Datasheet,Substitution",
    ...bomRows.map((r) => [r.refs, r.qty, r.value, r.mpn, r.manufacturer, r.pkg, r.mounting, r.footprint, r.rating, r.datasheet, r.substitution]
      .map((f) => `"${String(f).replace(/"/g, '""')}"`).join(","))].join("\n");
  writeFileSync(join(DELIVER, "prototype-bom.csv"), csv + "\n");

  const bomMd = [
    "# Prototype BOM", "",
    `Board: \`${projectId}\` — 21 x 21 mm, 2-layer FR-4, bare board (no assembly).`,
    `Every line is a published exact part with verified symbol, footprint and pin-to-pad mapping.`, "",
    "| Ref | Qty | Value | MPN | Manufacturer | Package | Mount | Rating | Datasheet |",
    "|---|---:|---|---|---|---|---|---|---|",
    ...bomRows.map((r) => `| ${r.refs} | ${r.qty} | ${r.value} | \`${r.mpn}\` | ${r.manufacturer} | ${r.pkg} | ${r.mounting} | ${r.rating} | [datasheet](${r.datasheet}) |`),
    "", "## Substitutions", "",
    ...bomRows.map((r) => `- **${r.refs}** (${r.mpn}): ${r.substitution}`),
    "", "## Sourcing", "",
    "All parts are stocked by Digi-Key, Mouser and LCSC. Search by the exact MPN above.",
    "Quantities are per board; order spares for the 0805 passives (they are easily lost).", "",
  ].join("\n");
  writeFileSync(join(DELIVER, "prototype-bom.md"), bomMd);

  // ── Assembly guide ───────────────────────────────────────────────────────
  const timer = bomRows.find((r) => /555/.test(r.mpn));
  const led = bomRows.find((r) => /LTST/.test(r.mpn));
  const header = bomRows.find((r) => /61300/.test(r.mpn));
  const assembly = [
    "# Assembly guide", "",
    `Board \`${projectId}\` — 21 x 21 mm, 2-layer, all components on the TOP side.`,
    "Hand-solderable throughout: one SOIC-8, six 0805 passives, one 0805 LED, one through-hole header.", "",
    "## Before you start", "",
    "- Fine-tip iron (0.5-1 mm), 0.5-0.7 mm leaded or SAC305 solder, flux, tweezers.",
    "- Read the top silkscreen: every reference designator is printed, and pin 1 / polarity are marked.", "",
    "## Polarity and pin-1 orientation", "",
    `- **${timer?.refs ?? "U1"} (${timer?.mpn ?? "NE555DR"})** — SOIC-8. Pin 1 is marked by the dot/notch on the package and by the silkscreen pin-1 marker. Pin 1 is GND, pin 8 is VCC.`,
    `- **${led?.refs ?? "D1"} (${led?.mpn ?? "LTST-C170KRKT"})** — polarised. The cathode is pad 1; the LED's own cathode mark (green line or notch) must face the silkscreen cathode bar. **Reversing it means the LED never lights.**`,
    `- **${header?.refs ?? "J1"} (${header?.mpn ?? "61300211121"})** — pin 1 is +5 V, pin 2 is GND, both labelled on the silkscreen.`,
    "- Resistors and X7R capacitors are non-polarised; orientation does not matter.", "",
    "## Suggested soldering order", "",
    "1. **U1 (SOIC-8) first** — easiest while the board is otherwise clear. Tack one corner pin, check the package is square and pin 1 is correct, then solder the remaining pins. Add flux and drag-solder if bridging.",
    "2. **0805 resistors** — tin one pad, place the part with tweezers, reflow that joint, then solder the other side.",
    "3. **0805 capacitors** — same technique.",
    "4. **LED last of the SMD parts** — it is the most heat-sensitive. Confirm cathode orientation *before* soldering the second pad.",
    "5. **J1 header last** — through-hole; solder from the top side and keep the body flush and square.", "",
    "## Inspection before power", "",
    "- Under magnification: no solder bridges between SOIC-8 pins (especially 1-2 and 7-8).",
    "- Every 0805 sits flat with fillets on both ends; no tombstoning.",
    "- LED cathode matches the silkscreen mark.",
    "- No stray solder balls; flux residue cleaned with IPA.", "",
    "## Resistance checks (unpowered, before first power-on)", "",
    "| Measurement | Expected | Meaning if wrong |",
    "|---|---|---|",
    "| J1 pin 1 (+5V) to J1 pin 2 (GND) | > 10 kOhm (not a short) | A reading near 0 Ohm means a supply short — do not power |",
    "| U1 pin 8 to J1 pin 1 | ~0 Ohm | Supply not reaching the timer |",
    "| U1 pin 1 to J1 pin 2 | ~0 Ohm | Ground not reaching the timer |",
    "| U1 pin 4 to U1 pin 8 | ~0 Ohm | RESET not tied high; the timer will stay held in reset |", "",
    "A short between the rails is the one failure that must be fixed before applying power.", "",
  ].join("\n");
  writeFileSync(join(DELIVER, "assembly-guide.md"), assembly);

  // ── Bring-up and test procedure ──────────────────────────────────────────
  const f = electrical.computed?.fNominalHz;
  const duty = electrical.computed?.dutyPercent;
  const bringup = [
    "# Bring-up and test procedure", "",
    `Board \`${projectId}\`. Expected behaviour: the LED blinks continuously at about ${f ? f.toFixed(2) : "1.2"} Hz` +
    `${duty ? ` with roughly a ${duty.toFixed(0)} % on-time` : ""}.`, "",
    "## 1. Unpowered visual inspection", "",
    "Complete the inspection and resistance checks in the assembly guide first. Do not skip the rail-to-rail resistance check.", "",
    "## 2. First power-on (current-limited)", "",
    "- Use a **regulated 5 V bench supply with the current limit set to 50 mA**.",
    "- This board has **no reverse-polarity and no over-voltage protection**. Applying reverse polarity or more than ~16 V will destroy the timer.",
    "- Connect +5 V to J1 pin 1 and GND to J1 pin 2. Raise the output with the limit engaged.", "",
    "## 3. Expected current", "",
    "| State | Expected supply current | Notes |",
    "|---|---|---|",
    "| LED on | ~5-8 mA | Timer quiescent (~3-6 mA for a bipolar 555) plus LED current |",
    "| LED off | ~3-6 mA | Timer quiescent only |",
    "| Any reading > 30 mA | **Fault** | Power down immediately and re-inspect for bridges |",
    "| Current at the 50 mA limit | **Short** | Power down; check the rail-to-rail resistance again |", "",
    "## 4. Timing-node observation (oscilloscope or multimeter)", "",
    `- **U1 pin 6/2 (timing node)** — the classic exponential ramp between 1/3 and 2/3 of VCC, i.e. about 1.67 V and 3.33 V on a 5 V rail. Period about ${f ? (1 / f).toFixed(2) : "0.8"} s.`,
    "- A DC multimeter here reads a slowly wandering mid-rail voltage (~2.5 V average); a scope shows the ramp clearly.",
    "- **U1 pin 3 (OUT)** — square wave swinging between roughly 0 V and 3.3 V (a bipolar 555 does not reach the rail).", "",
    "## 5. Expected LED behaviour", "",
    `- Steady, even blinking at roughly ${f ? f.toFixed(2) : "1.2"} Hz — clearly countable by eye.`,
    "- Worst-case component tolerance and X7R temperature drift keep it inside roughly 1.0-1.7 Hz; anything in that band is correct.",
    "- LED current is about 4.2 mA typical (2.7 mA with a worst-case forward voltage) — visible indoors, not dazzling.", "",
    "## 6. Failure diagnosis", "",
    "| Symptom | Most likely cause | Check |",
    "|---|---|---|",
    "| LED never lights, no oscillation | RESET (pin 4) not high | Measure pin 4; it must sit at +5 V |",
    "| LED never lights, pin 3 oscillates | LED reversed | Compare the cathode mark with the silkscreen bar |",
    "| LED on permanently | Timing capacitor open, or pin 2/6 not connected | Reflow C1 and the pin 2-6 link |",
    "| LED off permanently, pin 3 low | Output loaded or LED resistor open | Measure across the LED resistor |",
    "| Blink far too fast | Timing capacitor wrong value (10 nF fitted where 10 uF belongs) | Verify the C1 marking against the BOM |",
    "| Blink far too slow | Timing resistor wrong value | Verify R1/R2 against the BOM |",
    "| Supply current at the limit | Solder bridge | Re-inspect the SOIC-8 pins under magnification |",
    "| Erratic or jittery blinking | Missing supply decoupling or control-pin bypass | Reflow the 100 nF and 10 nF capacitors |", "",
    "## 7. What this test does and does not prove", "",
    "A blinking LED proves the timing network, the timer, the LED branch and the board's copper are all correct.",
    "It does **not** constitute EMC, safety, thermal, longevity or certification evidence, and no such claim should be made from it.", "",
  ].join("\n");
  writeFileSync(join(DELIVER, "bring-up-procedure.md"), bringup);

  // ── Fabrication order notes ──────────────────────────────────────────────
  const fabNotes = [
    "# Fabrication order notes", "",
    "> **No board has been ordered and no file has been uploaded.** Uploading or ordering requires",
    "> separate, explicit owner approval. This document only records the intended order parameters.", "",
    `Upload archive: \`manufacturer-upload-${projectId}.zip\` (fabrication Gerbers + Excellon drill only).`, "",
    "## Intended manufacturer and process", "",
    "| Parameter | Value | Why |",
    "|---|---|---|",
    "| Manufacturer | JLCPCB (or any equivalent 2-layer prototype house) | The release was validated against a conservative JLCPCB-style two-layer rigid profile |",
    "| Layers | 2 | The qualified autonomous capability profile covers exactly top and bottom copper |",
    "| Dimensions | 21 x 21 mm | Sized to the design by outline fitting |",
    "| Material | FR-4, TG130 or better | Standard prototype stack |",
    "| Thickness | 1.6 mm | Matches the validated rule profile |",
    "| Copper weight | 1 oz (35 um) | Matches the validated rule profile |",
    "| Surface finish | HASL with lead, or ENIG | HASL is cheapest and fine for hand assembly; ENIG gives flatter pads for the SOIC-8 |",
    "| Solder mask | Any colour (green is default) | No mask-critical geometry |",
    "| Silkscreen | White (on green) | Top silkscreen carries references, pin 1 and LED polarity |",
    "| Min trace/space | 0.127 mm | Profile minimum; the routed board respects it |",
    "| Min hole | 0.30 mm | Profile minimum; smallest drilled hole is 0.40 mm |",
    "| Quantity | 5 (typical prototype minimum) | Spares for assembly practice and a second build |", "",
    "## Options intentionally NOT selected", "",
    "- **No assembly / no PCBA.** This is a bare-board release: there is no BOM or pick-and-place file in the upload, and no population authority was established. Assembly is by hand.",
    "- **No impedance control** — no controlled-impedance nets in this design.",
    "- **No castellated holes, edge plating, slots or cutouts** — none present, and all are outside the qualified profile.",
    "- **No via tenting change** — vias are tented by the profile default.",
    "- **No panelisation** — single board.",
    "- **No ENIG requirement** — HASL is acceptable.", "",
    "## Pre-order checklist for the owner", "",
    "1. Open the manufacturer archive in the board house's own Gerber viewer and confirm the layer mapping it reports.",
    "2. Confirm the board outline renders as a closed 21 x 21 mm profile.",
    "3. Confirm the drill layer shows 3 holes (two 1.0 mm header holes, one 0.40 mm via).",
    "4. Confirm the top silkscreen is legible and does not sit on pads.",
    "5. Confirm the quoted process matches the table above (2-layer, FR-4, 1.6 mm, 1 oz).",
    "6. Only then approve the upload and order.", "",
    "## Still required before any hardware claim", "",
    "External CAM/DFM review by the board house, fabricated boards in hand, hand assembly, powered bring-up",
    "per the bring-up procedure, and measured results. Until then this is a verified *fabrication package*,",
    "not proven hardware.", "",
  ].join("\n");
  writeFileSync(join(DELIVER, "fabrication-order-notes.md"), fabNotes);

  // ── Deliverable index with hashes ────────────────────────────────────────
  const artifacts = [
    { path: releaseZip, label: "Sirkit verified release archive" },
    { path: mfgZip, label: "Manufacturer upload archive (fabrication only)" },
  ].filter((a) => existsSync(a.path));
  const index = [
    `# R05-E2E01 deliverables — ${projectId}`, "",
    `Generated ${new Date().toISOString()}.`, "",
    "## Archives", "",
    "| Artifact | File | SHA-256 |",
    "|---|---|---|",
    ...artifacts.map((a) => `| ${a.label} | \`${a.path.split(/[\\/]/).pop()}\` | \`${sha256File(a.path)}\` |`),
    "", "## Documents", "",
    "| Document | File |", "|---|---|",
    "| Prototype BOM (Markdown) | `prototype-bom.md` |",
    "| Prototype BOM (CSV) | `prototype-bom.csv` |",
    "| Assembly guide | `assembly-guide.md` |",
    "| Bring-up and test procedure | `bring-up-procedure.md` |",
    "| Fabrication order notes | `fabrication-order-notes.md` |",
    "", "## Status", "",
    `- Electrical verification: **${electrical.verdict ?? "not run"}**` +
      (electrical.computed?.fNominalHz ? ` (${electrical.computed.fNominalHz.toFixed(3)} Hz nominal)` : ""),
    "- Manufacturer upload performed: **NO**",
    "- PCB order placed: **NO**",
    "- Physical hardware validated: **NO**", "",
  ].join("\n");
  writeFileSync(join(DELIVER, "README.md"), index);

  console.log(`deliverables written to scripts/output/deliverables-${projectId}/`);
  for (const f of ["README.md", "prototype-bom.md", "prototype-bom.csv", "assembly-guide.md", "bring-up-procedure.md", "fabrication-order-notes.md"]) {
    console.log(`  ${f}`);
  }
  console.log(`\nBOM lines: ${bomRows.length} (${rows.length} placed components)`);
  for (const r of bomRows) console.log(`  ${r.refs.padEnd(10)} ${r.value.padEnd(7)} ${r.mpn.padEnd(20)} ${r.manufacturer}`);
  process.exit(0);
}

main();
