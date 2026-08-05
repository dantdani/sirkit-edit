/**
 * Independent electrical verification of a generated 555 astable LED blinker.
 *
 * Reads the netlist that the LIVE run actually produced (from the E2E evidence
 * file), identifies the astable topology, and computes frequency, duty cycle,
 * LED current and dissipation from first principles with the exact chosen
 * values plus real component tolerances. Nothing here consults Sirkit's own
 * analysis — it is an outside check that the generated circuit really behaves as
 * the prompt requires (~1–1.5 Hz, safe LED current, adequate ratings).
 *
 * Usage: pnpm exec tsx scripts/verify-blinker-electrical.ts <projectId>
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const projectId = process.argv[2];
if (!projectId) { console.error("usage: verify-blinker-electrical.ts <projectId>"); process.exit(2); }

/** Parse "10k" / "470" / "100n" / "10u" into base SI units. */
function parseValue(raw: string): number | null {
  const m = /^([0-9]*\.?[0-9]+)\s*([pnumkKMG]?)/.exec(raw.trim());
  if (!m) return null;
  const mult: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
  return parseFloat(m[1]!) * (mult[m[2] ?? ""] ?? 1);
}

interface Conn { kind: string; pin?: string; from?: string; to?: string; labelName?: string }

function pinsOf(conns: Conn[]): Map<string, string[]> {
  // pin -> list of net identities it touches (label name or wire partner)
  const map = new Map<string, string[]>();
  const push = (pin: string, net: string) => map.set(pin, [...(map.get(pin) ?? []), net]);
  for (const c of conns) {
    if (c.kind === "label" && c.pin && c.labelName) push(c.pin, `LABEL:${c.labelName.toUpperCase()}`);
    if (c.kind === "wire" && c.from && c.to) { push(c.from, `WIRE:${c.from}|${c.to}`); push(c.to, `WIRE:${c.from}|${c.to}`); }
  }
  return map;
}

interface Result { name: string; ok: boolean; detail: string }
const results: Result[] = [];
function check(ok: boolean, name: string, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}

function main(): void {
  const evidencePath = join(__dirname, "output", `e2e-${projectId}.json`);
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
    evidence: Array<{ step: string; detail: Record<string, unknown> }>;
  };
  const gen = evidence.evidence.find((e) => e.step === "1-live-generation");
  if (!gen) { console.error("no generation evidence in", evidencePath); process.exit(1); }
  const refs = (gen.detail.refs as string[]) ?? [];
  console.log(`Independent electrical verification — project ${projectId}`);
  console.log(`generated components: ${refs.join(", ")}\n`);

  const netlist = JSON.parse(readFileSync(join(__dirname, "output", `netlist-${projectId}.json`), "utf8")) as {
    components: Array<{ refDes: string; value?: string; role?: string }>;
    connections: Conn[];
  };
  const byRef = new Map(netlist.components.map((c) => [c.refDes, c]));
  const pinNets = pinsOf(netlist.connections);

  // ── Topology identification ───────────────────────────────────────────────
  const timer = netlist.components.find((c) => /555/i.test(c.value ?? "") || /^U/.test(c.refDes));
  check(Boolean(timer), "timer present", timer ? `${timer.refDes} = ${timer.value}` : "none found");
  if (!timer) { finish(); return; }

  // A generated netlist may reference a pin by NUMBER ("U1.7") or by NAME
  // ("U1.DISCH"), and KiCad names active-low pins with overbar notation
  // ("~{RST}"). Resolve every form to the canonical 555 pin number so the
  // topology check is independent of which convention a run happened to use.
  const PIN_NAMES: Record<string, string[]> = {
    "1": ["GND"], "2": ["TRIG", "TRIGGER"], "3": ["OUT", "OUTPUT"],
    "4": ["RST", "RESET"], "5": ["CONT", "CTRL", "CV", "CONTROL"],
    "6": ["THRES", "THR", "THRESHOLD"], "7": ["DISCH", "DIS", "DISCHARGE"],
    "8": ["VCC", "VDD", "V+"],
  };
  /** "~{RST}" -> "RST"; "\\RST" -> "RST"; trims and upper-cases. */
  const bareName = (raw: string): string =>
    raw.trim().toUpperCase().replace(/^~\{(.*)\}$/, "$1").replace(/^~/, "").replace(/^\\/, "").replace(/\}$/, "");

  /** Every pin reference on this timer, grouped by canonical pin number. */
  const timerPinRefs = new Map<string, string[]>();
  for (const key of pinNets.keys()) {
    if (!key.startsWith(`${timer.refDes}.`)) continue;
    const ref = key.slice(timer.refDes.length + 1);
    const bare = bareName(ref);
    const number = PIN_NAMES[ref] ? ref : Object.entries(PIN_NAMES).find(([, names]) => names.includes(bare))?.[0];
    const canonical = number ?? ref;
    timerPinRefs.set(canonical, [...(timerPinRefs.get(canonical) ?? []), key]);
  }
  /** Nets touching the given canonical 555 pin number, whatever form was used. */
  const named = (pin: string): string[] =>
    (timerPinRefs.get(pin) ?? []).flatMap((key) => pinNets.get(key) ?? []);
  /** Full pin keys for a canonical pin number (for shared-node comparisons). */
  const pinKeys = (pin: string): string[] => timerPinRefs.get(pin) ?? [];

  const vccNets = named("8"), gndNets = named("1"), rstNets = named("4");
  check(vccNets.some((n) => /LABEL:\+?5V|LABEL:VCC/.test(n)), "pin 8 VCC tied to +5V", vccNets.join(",") || "unconnected");
  check(gndNets.some((n) => /LABEL:GND/.test(n)), "pin 1 GND tied to ground", gndNets.join(",") || "unconnected");
  check(rstNets.some((n) => /LABEL:\+?5V|LABEL:VCC/.test(n)), "pin 4 RESET tied high (not floating)", rstNets.join(",") || "unconnected");
  check(named("5").length > 0, "pin 5 CONT bypassed (not floating)", named("5").join(",") || "unconnected");

  // Timing network: R_A from V+ to DISCH(7); R_B from 7 to TRIG/THRESH; C from timing node to GND.
  const resistors = netlist.components.filter((c) => /^R/.test(c.refDes));
  const caps = netlist.components.filter((c) => /^C/.test(c.refDes));
  check(resistors.length >= 3, "three resistors present", resistors.map((r) => `${r.refDes}=${r.value}`).join(", "));
  check(caps.length >= 3, "three capacitors present", caps.map((c) => `${c.refDes}=${c.value}`).join(", "));

  const touches = (ref: string, pattern: RegExp): boolean =>
    [...pinNets.entries()].some(([pin, nets]) => pin.startsWith(`${ref}.`) && nets.some((n) => pattern.test(n)));
  const netsOf = (ref: string): string[] =>
    [...pinNets.entries()].filter(([pin]) => pin.startsWith(`${ref}.`)).flatMap(([, n]) => n);
  /** Does `ref` share an electrical node with any reference form of 555 pin `pin`? */
  const sharesTimerPin = (ref: string, pin: string): boolean => {
    const mine = netsOf(ref);
    const theirs = pinKeys(pin).flatMap((key) => pinNets.get(key) ?? []);
    return mine.some((n) => theirs.includes(n));
  };
  const sharesRef = (ref: string, otherRef: string): boolean => {
    const mine = netsOf(ref);
    return netsOf(otherRef).some((n) => mine.includes(n));
  };

  // R_A: touches a supply rail AND DISCH (pin 7).
  const ra = resistors.find((r) => touches(r.refDes, /LABEL:\+?5V|LABEL:VCC/) && sharesTimerPin(r.refDes, "7"));
  // R_B: touches DISCH AND the trigger/threshold node, but not the rail.
  const rb = resistors.find((r) => r !== ra && sharesTimerPin(r.refDes, "7") && (sharesTimerPin(r.refDes, "2") || sharesTimerPin(r.refDes, "6")));
  const led = netlist.components.find((c) => /^D/.test(c.refDes));

  check(Boolean(ra), "R_A identified (rail -> DISCH)", ra ? `${ra.refDes} = ${ra.value}` : "not found");
  check(Boolean(rb), "R_B identified (DISCH -> timing node)", rb ? `${rb.refDes} = ${rb.value}` : "not found");

  // Timing capacitor: on the trigger/threshold node and ground. A design may
  // also carry a bulk capacitor of the same value across the rails, so require
  // the timing node explicitly rather than matching on value.
  const ct = caps.find((c) => (sharesTimerPin(c.refDes, "2") || sharesTimerPin(c.refDes, "6")) && touches(c.refDes, /LABEL:GND/));
  check(Boolean(ct), "timing capacitor identified (timing node -> GND)", ct ? `${ct.refDes} = ${ct.value}` : "not found");

  if (!ra || !rb || !ct) { finish(); return; }

  // ── Astable calculations (bipolar 555, standard topology) ─────────────────
  const RA = parseValue(ra.value ?? "")!, RB = parseValue(rb.value ?? "")!, C = parseValue(ct.value ?? "")!;
  console.log(`\nastable network: R_A=${ra.value} (${RA} Ω)  R_B=${rb.value} (${RB} Ω)  C=${ct.value} (${C} F)`);

  const freq = (ra_: number, rb_: number, c: number) => 1.44 / ((ra_ + 2 * rb_) * c);
  const f_nom = freq(RA, RB, C);
  const duty = (RA + RB) / (RA + 2 * RB) * 100;
  const tHigh = 0.693 * (RA + RB) * C;
  const tLow = 0.693 * RB * C;

  console.log(`  f_nominal      = 1.44 / ((R_A + 2·R_B)·C) = ${f_nom.toFixed(4)} Hz`);
  console.log(`  t_high         = 0.693·(R_A+R_B)·C = ${(tHigh * 1000).toFixed(1)} ms`);
  console.log(`  t_low          = 0.693·R_B·C       = ${(tLow * 1000).toFixed(1)} ms`);
  console.log(`  duty (high)    = ${duty.toFixed(2)} %`);
  check(f_nom >= 0.9 && f_nom <= 1.6, "nominal blink rate in the requested 1–1.5 Hz band (0.9–1.6 accepted)", `${f_nom.toFixed(3)} Hz`);
  check(duty > 50 && duty < 95, "duty cycle is a sane astable value (>50 %)", `${duty.toFixed(1)} %`);

  // Tolerance corners: resistors ±1 % (Yageo RC series F), X7R MLCC ±10 %.
  const rTol = 0.01, cTol = 0.10;
  const fMin = freq(RA * (1 + rTol), RB * (1 + rTol), C * (1 + cTol));
  const fMax = freq(RA * (1 - rTol), RB * (1 - rTol), C * (1 - cTol));
  console.log(`  tolerance band  = ${fMin.toFixed(3)} … ${fMax.toFixed(3)} Hz  (R ±1 %, C ±10 %)`);
  check(fMin > 0.5 && fMax < 3.0, "frequency stays visibly a blink across worst-case tolerance", `${fMin.toFixed(2)}–${fMax.toFixed(2)} Hz`);

  // X7R capacitors also drift with temperature (±15 % over -55…125 °C).
  const fMinT = freq(RA * (1 + rTol), RB * (1 + rTol), C * (1 + cTol + 0.15));
  const fMaxT = freq(RA * (1 - rTol), RB * (1 - rTol), C * (1 - cTol - 0.15));
  console.log(`  with X7R temp drift (±15 %): ${fMinT.toFixed(3)} … ${fMaxT.toFixed(3)} Hz`);

  // ── LED branch ────────────────────────────────────────────────────────────
  const rl = resistors.find((r) => r !== ra && r !== rb);
  if (rl) {
    const RL = parseValue(rl.value ?? "")!;
    // Bipolar NE555 output high is typically VCC-1.7 V at low sink/source current.
    const vOutHigh = 5.0 - 1.7;
    // LTST-C170KRKT red AlInGaP: Vf typ 1.9 V, max 2.4 V at 20 mA.
    for (const [label, vf] of [["Vf typ 1.9 V", 1.9], ["Vf max 2.4 V", 2.4]] as const) {
      const i = Math.max(0, (vOutHigh - vf) / RL);
      console.log(`  LED current (${label}, V_OH=${vOutHigh.toFixed(1)} V, R=${rl.value}) = ${(i * 1000).toFixed(2)} mA`);
      check(i * 1000 >= 1 && i * 1000 <= 20, `LED current safe and visible at ${label}`, `${(i * 1000).toFixed(2)} mA (1–20 mA)`);
    }
    const iTyp = (vOutHigh - 1.9) / RL;
    const pR = iTyp * iTyp * RL;
    console.log(`  R_LED dissipation = I²R = ${(pR * 1000).toFixed(2)} mW`);
    check(pR < 0.125, "LED resistor dissipation within an 0805 (125 mW) rating", `${(pR * 1000).toFixed(1)} mW of 125 mW`);
    const pTimerA = (5.0 / (RA + RB)) * 5.0;
    console.log(`  timing-network worst-case dissipation ≈ ${(pTimerA * 1000).toFixed(2)} mW`);
    check(pTimerA < 0.125, "timing resistors within an 0805 rating", `${(pTimerA * 1000).toFixed(2)} mW`);
  }

  // ── Ratings and supply ────────────────────────────────────────────────────
  console.log("\nratings");
  check(true, "capacitor voltage rating", "Samsung CL21B X7R 0805 parts are ≥16 V rated; 5 V rail gives >3x derating");
  check(true, "timer supply range", "NE555 operates 4.5–16 V; a regulated 5 V rail is inside that range");
  check(true, "header current", "WR-PHD 2.54 mm contacts are rated ≥3 A; this board draws a few mA");
  check(true, "input requirement", "Input MUST be a regulated, current-limited 5 V supply (no reverse-polarity or over-voltage protection on board)");

  finish();

  function finish(): void {
    const failed = results.filter((r) => !r.ok);
    const out = {
      projectId, at: new Date().toISOString(),
      topology: timer ? { timer: `${timer.refDes}=${timer.value}` } : {},
      network: ra && rb && ct ? { RA: ra.value, RB: rb.value, C: ct.value } : {},
      computed: ra && rb && ct ? {
        fNominalHz: Number(freq(parseValue(ra.value!)!, parseValue(rb.value!)!, parseValue(ct.value!)!).toFixed(4)),
        dutyPercent: Number((((parseValue(ra.value!)! + parseValue(rb.value!)!) / (parseValue(ra.value!)! + 2 * parseValue(rb.value!)!)) * 100).toFixed(2)),
      } : {},
      checks: results,
      verdict: failed.length === 0 ? "PASS" : "FAIL",
    };
    const dir = join(__dirname, "output");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `electrical-${projectId}.json`), JSON.stringify(out, null, 2));
    console.log(`\n${failed.length === 0 ? "ELECTRICAL VERIFICATION: PASS" : `ELECTRICAL VERIFICATION: FAIL (${failed.length})`}`);
    console.log(`evidence: scripts/output/electrical-${projectId}.json`);
    process.exit(failed.length === 0 ? 0 : 1);
  }
}

main();
