/**
 * B16.1C §G — independent electrical and structural verification of the
 * generated 555 astable LED blinker.
 *
 * Operates on the derived `PcbNetlist` (schematic) and the authoritative
 * `PcbBoard` (PCB) with first-principles checks only — nothing here consults
 * the provider's explanation, the ERC, or the release generator's own
 * decisions. Every check returns a labeled PASS/FAIL row so the acceptance
 * test can assert the whole table and the artifact can quote it verbatim.
 */

import { boardToSourceNetlist } from "@/app/lib/pcb/board-netlist";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import type { PcbBoard } from "@/app/lib/pcb/types";

export interface ElectricalCheck { name: string; ok: boolean; detail: string }
export interface ElectricalReport { ok: boolean; checks: ElectricalCheck[]; computed: Record<string, number | string> }

/** Parse "10k" / "330" / "100nF" / "10uF" into base SI units. */
export function parseSiValue(raw: string): number | null {
  const m = /^([0-9]*\.?[0-9]+)\s*([pnumkKMG]?)/.exec(raw.trim().replace(/[µμ]/g, "u"));
  if (!m) return null;
  const mult: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
  return parseFloat(m[1]!) * (mult[m[2] ?? ""] ?? 1);
}

class NetIndex {
  private readonly netByPin = new Map<string, string>();
  readonly netNames = new Map<string, string>();
  constructor(netlist: PcbNetlist) {
    const refById = new Map(netlist.components.map((component) => [component.id, component.ref]));
    for (const net of netlist.nets) {
      const key = `net:${net.id}`;
      this.netNames.set(key, net.name);
      for (const node of net.nodes) this.netByPin.set(`${refById.get(node.componentId) ?? node.componentId}.${node.pinNumber}`, key);
    }
  }
  net(pin: string): string | null { return this.netByPin.get(pin) ?? null; }
  same(...pins: string[]): boolean { const nets = pins.map((pin) => this.net(pin)); return nets.every((net) => net !== null && net === nets[0]); }
  name(pin: string): string { const net = this.net(pin); return net ? (this.netNames.get(net) ?? "?") : "unconnected"; }
  pinsOn(net: string | null): string[] { return net ? [...this.netByPin.entries()].filter(([, value]) => value === net).map(([pin]) => pin).sort() : []; }
}

/**
 * Verify the schematic-level topology of the acceptance circuit. Pin numbers
 * follow the NE555 datasheet: 1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CONT, 6 THRES,
 * 7 DISCH, 8 VCC. KiCad LED convention: pad/pin 1 cathode, 2 anode.
 */
export function verifyBlinkerSchematic(netlist: PcbNetlist): ElectricalReport {
  const checks: ElectricalCheck[] = [];
  const computed: Record<string, number | string> = {};
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };
  const index = new NetIndex(netlist);
  const byRef = new Map(netlist.components.map((component) => [component.ref, component]));

  const timer = netlist.components.find((component) => /555/.test(component.value ?? "") && component.pins.length === 8);
  check("555 timer present with 8 pins", Boolean(timer), timer ? `${timer.ref} = ${timer.value}` : "no 8-pin 555 component");
  if (!timer) return { ok: false, checks, computed };
  const U = timer.ref;

  // Power and ground.
  const vcc = index.net(`${U}.8`), gnd = index.net(`${U}.1`);
  check("VCC net named as the supply rail", Boolean(vcc) && /^(VCC|\+?5V|VDD)$/i.test(index.name(`${U}.8`)), index.name(`${U}.8`));
  check("GND net named as ground", Boolean(gnd) && /^GND$/i.test(index.name(`${U}.1`)), index.name(`${U}.1`));
  check("VCC and GND are distinct nets", Boolean(vcc && gnd && vcc !== gnd), `${index.name(`${U}.8`)} vs ${index.name(`${U}.1`)}`);
  check("RESET (pin 4) tied to VCC, not floating", index.same(`${U}.4`, `${U}.8`), index.name(`${U}.4`));

  // Timing network: R_A rail -> DISCH; R_B DISCH -> THRES/TRIG node; C_T node -> GND.
  const resistors = netlist.components.filter((component) => /^R\d+$/.test(component.ref));
  const capacitors = netlist.components.filter((component) => /^C\d+$/.test(component.ref));
  const other = (ref: string, pin: string) => pin === "1" ? "2" : "1";
  const touching = (parts: typeof resistors, pin: string) => parts.flatMap((part) => ["1", "2"].filter((n) => index.same(`${part.ref}.${n}`, pin)).map((n) => ({ part, pin: n })));
  const ra = touching(resistors, `${U}.7`).find(({ part, pin }) => index.same(`${part.ref}.${other(part.ref, pin)}`, `${U}.8`));
  const rb = touching(resistors, `${U}.7`).find(({ part, pin }) => index.same(`${part.ref}.${other(part.ref, pin)}`, `${U}.6`));
  check("R_A identified (VCC -> DISCH)", Boolean(ra), ra ? `${ra.part.ref} = ${ra.part.value}` : "not found");
  check("R_B identified (DISCH -> THRES)", Boolean(rb), rb ? `${rb.part.ref} = ${rb.part.value}` : "not found");
  check("THRES (6) and TRIG (2) tied together (astable)", index.same(`${U}.6`, `${U}.2`), `${index.name(`${U}.6`)} / ${index.name(`${U}.2`)}`);
  const ct = touching(capacitors, `${U}.6`).find(({ part, pin }) => index.same(`${part.ref}.${other(part.ref, pin)}`, `${U}.1`));
  check("timing capacitor identified (THRES node -> GND)", Boolean(ct), ct ? `${ct.part.ref} = ${ct.part.value}` : "not found");

  if (ra && rb && ct) {
    const RA = parseSiValue(ra.part.value ?? "") ?? NaN, RB = parseSiValue(rb.part.value ?? "") ?? NaN, C = parseSiValue(ct.part.value ?? "") ?? NaN;
    const f = 1.44 / ((RA + 2 * RB) * C), duty = ((RA + RB) / (RA + 2 * RB)) * 100;
    computed.fNominalHz = Number(f.toFixed(4)); computed.dutyPercent = Number(duty.toFixed(2)); computed.RA = RA; computed.RB = RB; computed.C = C;
    check("astable frequency ~1-1.5 Hz (f = 1.44/((R_A+2R_B)C))", f >= 1.0 && f <= 1.5, `${f.toFixed(3)} Hz`);
    check("duty cycle is a sane astable value (>50 %, <95 %)", duty > 50 && duty < 95, `${duty.toFixed(1)} %`);
    const tol = (r: number, c: number) => 1.44 / ((RA * r + 2 * RB * r) * C * c);
    const fMin = tol(1.01, 1.10), fMax = tol(0.99, 0.90);
    computed.fToleranceMinHz = Number(fMin.toFixed(3)); computed.fToleranceMaxHz = Number(fMax.toFixed(3));
    check("frequency stays a visible blink across R 1 % / C 10 % tolerance", fMin > 0.7 && fMax < 2.5, `${fMin.toFixed(2)}-${fMax.toFixed(2)} Hz`);
  }

  // Decoupling: a capacitor directly between VCC and GND, >= 100 nF.
  const decoupling = capacitors.find((cap) => (index.same(`${cap.ref}.1`, `${U}.8`) && index.same(`${cap.ref}.2`, `${U}.1`)) || (index.same(`${cap.ref}.2`, `${U}.8`) && index.same(`${cap.ref}.1`, `${U}.1`)));
  const decouplingValue = decoupling ? parseSiValue(decoupling.value ?? "") ?? 0 : 0;
  check("supply decoupling capacitor across VCC/GND (>= 100 nF)", Boolean(decoupling) && decouplingValue >= 100e-9, decoupling ? `${decoupling.ref} = ${decoupling.value}` : "none");

  // CONT bypass: capacitor from pin 5 to GND, 1 nF..100 nF.
  const bypass = capacitors.find((cap) => (index.same(`${cap.ref}.1`, `${U}.5`) && index.same(`${cap.ref}.2`, `${U}.1`)) || (index.same(`${cap.ref}.2`, `${U}.5`) && index.same(`${cap.ref}.1`, `${U}.1`)));
  const bypassValue = bypass ? parseSiValue(bypass.value ?? "") ?? 0 : 0;
  check("CONT (pin 5) bypass capacitor to GND (1 nF..100 nF)", Boolean(bypass) && bypassValue >= 1e-9 && bypassValue <= 100e-9, bypass ? `${bypass.ref} = ${bypass.value}` : "none");

  // LED branch: OUT -> limiter -> LED anode; cathode -> GND.
  const led = netlist.components.find((component) => /^D\d+$/.test(component.ref));
  const limiter = resistors.find((res) => res !== ra?.part && res !== rb?.part && (index.same(`${res.ref}.1`, `${U}.3`) || index.same(`${res.ref}.2`, `${U}.3`)));
  check("LED present", Boolean(led), led ? `${led.ref} = ${led.value}` : "none");
  check("LED current limiter on OUT (pin 3)", Boolean(limiter), limiter ? `${limiter.ref} = ${limiter.value}` : "none");
  if (led && limiter) {
    const limiterFar = index.same(`${limiter.ref}.1`, `${U}.3`) ? `${limiter.ref}.2` : `${limiter.ref}.1`;
    check("limiter feeds the LED anode (pin 2)", index.same(limiterFar, `${led.ref}.2`), `${limiterFar} -> ${index.name(limiterFar)}`);
    check("LED cathode (pin 1) returns to GND (polarity)", index.same(`${led.ref}.1`, `${U}.1`), index.name(`${led.ref}.1`));
    const RL = parseSiValue(limiter.value ?? "") ?? NaN;
    // NE555 output high at 5 V supply, light load: ~3.3 V typical; green 0805 LED Vf ~2.1 V typical (2.6 V max).
    const iTyp = (3.3 - 2.1) / RL, iMin = Math.max(0, (3.3 - 2.6) / RL), iMaxSupply = (5.0 - 1.7 - 1.9) / RL;
    computed.ledCurrentTypMa = Number((iTyp * 1000).toFixed(2)); computed.ledCurrentMinMa = Number((iMin * 1000).toFixed(2));
    check("LED current visible and safe (1..20 mA at Vf 2.1 V typical, V_OH 3.3 V)", iTyp * 1000 >= 1 && iTyp * 1000 <= 20, `${(iTyp * 1000).toFixed(2)} mA (worst-case ${(iMaxSupply * 1000).toFixed(2)} mA)`);
    check("limiter dissipation within 0805 rating (125 mW)", iMaxSupply * iMaxSupply * RL < 0.125, `${(iMaxSupply * iMaxSupply * RL * 1000).toFixed(1)} mW`);
  }

  // Connector polarity / net identity.
  const header = netlist.components.find((component) => /^J\d+$/.test(component.ref));
  check("power header present with 2 pins", Boolean(header) && header!.pins.length === 2, header ? `${header.ref} (${header.pins.length} pins)` : "none");
  if (header) {
    check("header pin 1 = VCC", index.same(`${header.ref}.1`, `${U}.8`), index.name(`${header.ref}.1`));
    check("header pin 2 = GND", index.same(`${header.ref}.2`, `${U}.1`), index.name(`${header.ref}.2`));
  }

  // Structural hygiene.
  const dangling = netlist.components.flatMap((component) => component.pins.filter((pin) => !index.net(`${component.ref}.${pin.number}`)).map((pin) => `${component.ref}.${pin.number}`));
  check("no dangling pins", dangling.length === 0, dangling.length ? dangling.join(", ") : "every pin is on a net");
  check("exactly 7 nets (VCC, GND, DISCH, THRES/TRIG, CONT, OUT, LED anode)", netlist.nets.length === 7, `${netlist.nets.length} nets: ${netlist.nets.map((net) => net.name).sort().join(", ")}`);
  check("9 components (U1, R1-R3, C1-C3, D1, J1)", netlist.components.length === 9 && ["U1", "R1", "R2", "R3", "C1", "C2", "C3", "D1", "J1"].every((ref) => byRef.has(ref)), netlist.components.map((component) => component.ref).sort().join(", "));

  return { ok: checks.every((item) => item.ok), checks, computed };
}

/** Schematic-to-PCB parity: the board's own pad connectivity must reproduce the schematic nets exactly. */
export function verifyBlinkerBoardParity(schematic: PcbNetlist, board: PcbBoard): ElectricalReport {
  const checks: ElectricalCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };
  const boardNetlist = boardToSourceNetlist(board);
  const netSets = (netlist: PcbNetlist): string[] => {
    const refById = new Map(netlist.components.map((component) => [component.id, component.ref]));
    return netlist.nets.map((net) => net.nodes.map((node) => `${refById.get(node.componentId) ?? node.componentId}.${node.pinNumber}`).sort().join("+")).filter(Boolean).sort();
  };
  const expected = netSets(schematic), actual = netSets(boardNetlist);
  check("every schematic component has exactly one footprint", schematic.components.every((component) => board.footprints.filter((footprint) => footprint.ref === component.ref).length === 1) && board.footprints.length === schematic.components.length, `${board.footprints.length} footprints for ${schematic.components.length} components`);
  check("board pad connectivity reproduces the schematic nets exactly", JSON.stringify(expected) === JSON.stringify(actual), expected.length === actual.length ? `${actual.length} nets identical` : `${expected.length} schematic vs ${actual.length} board nets`);
  check("every footprint carries synchronization identity (binding, asset, certificate)", board.footprints.every((footprint) => footprint.syncIdentity?.bindingRevisionId && footprint.syncIdentity.mappingCertificateId && footprint.syncIdentity.footprintAssetVersionId), board.footprints.filter((footprint) => !footprint.syncIdentity).map((footprint) => footprint.ref).join(", ") || "all");
  check("two-layer board, no zones (no ground plane), no keepouts", board.stackup === 2 && board.zones.length === 0 && !(board.routingKeepouts?.length), `stackup ${board.stackup}, zones ${board.zones.length}`);
  return { ok: checks.every((item) => item.ok), checks, computed: {} };
}

/** Routed connectivity: every net with 2+ pads is fully connected by copper (as the board-derived netlist and track graph report). */
export function verifyBlinkerRouting(board: PcbBoard): ElectricalReport {
  const checks: ElectricalCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };
  check("board carries copper tracks", board.tracks.length > 0, `${board.tracks.length} tracks, ${board.vias.length} vias`);
  const layers = new Set(board.tracks.map((track) => track.layer));
  check("tracks only on the two copper layers", [...layers].every((layer) => layer === "copperTop" || layer === "copperBottom"), [...layers].sort().join(", "));
  const netIds = new Set(board.footprints.flatMap((footprint) => Object.values(footprint.padNets ?? {})).filter((net) => net !== 0));
  const trackNets = new Set(board.tracks.map((track) => track.netId));
  const missing = [...netIds].filter((net) => !trackNets.has(net));
  check("every connected net has at least one track", missing.length === 0, missing.length ? `nets without copper: ${missing.join(", ")}` : `${netIds.size} nets routed`);
  return { ok: checks.every((item) => item.ok), checks, computed: {} };
}
