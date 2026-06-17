"use client";

import { useState, useRef, useEffect, useLayoutEffect, useReducer, useMemo, type Dispatch, type SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Cable, CircuitBoard, Box, Receipt, Activity, Play, Download, Settings,
  Settings2, Search, MessageSquare, Circle, Triangle, Zap, Sigma, BatteryCharging,
  Cpu, Component, ChevronDown, ChevronRight, ChevronLeft, Check, AlertTriangle,
  FolderOpen, Package, Maximize2, Minimize2, ChevronsDown, MousePointer, Pencil,
  Scissors, Sparkles, Loader2, Move, Crosshair, GripVertical, X, CircleDot, Tag,
} from "lucide-react";
import { getKeyBindings } from "./lib/keybindings";
import { GRID, snap, pointEquals, closestPointOnSegment, distance, pinWorldPos, kicadPinWorldPos, KICAD_SCALE_PX_PER_MM, pointStrictlyOnWireInterior } from "./lib/geometry";
import { findConnectedGroup, splitWiresAtPoint, consolidateWires, type KicadPinSite } from "./lib/connectivity";
import { classifyNets, type NetRole } from "./lib/nets";
import { rangeAwareTickFormatter } from "./lib/format";
import type { SchComponent, Wire, Point, SchComponentType, SchematicState, KicadComponentInstance, BuildLogicalNetlist, NetLabel, NetLabelKind, SchematicEditOp } from "@/lib/schematic-types";
import { PIN_NAMES } from "@/lib/schematic-types";
import { generateSchematic } from "@/lib/apply-netlist";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import { BuildLibraryPanel } from "@/app/components/editor/BuildLibraryPanel";
import { BomView } from "@/app/components/bom/BomView";
import { KicadSymbolInline } from "@/app/components/schematic/KicadSymbol";
import { getCachedPart, ensurePartLoaded, subscribeToPart, type CachedPart } from "@/app/lib/parts-cache";

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = "theory" | "build";
type View = "schematic" | "pcb" | "3d" | "bom" | "sim";
type LeftPanel = "projects" | "library" | null;
type Message = { id: string; role: "user" | "assistant"; content: string };
// "kicad-place" carries no partId itself — the part to place lives in separate
// state (placementPartId), so Tool stays a simple string union. Likewise
// "netlabel-place" carries no name/kind — those live in pendingNetLabel.
type Tool =
  | "select" | "wire" | "delete" | "junction"
  | SchComponentType
  | "kicad-place"
  | "label"            // generic net-label tool: click opens a name input
  | "netlabel-place";  // quick-place of a preset label (GND, +3V3, …)

// Preset for the quick-place buttons in the toolbar.
type PendingNetLabel = { name: string; kind: NetLabelKind };

const QUICK_LABELS: PendingNetLabel[] = [
  { name: "GND",  kind: "ground" },
  { name: "+3V3", kind: "power" },
  { name: "+5V",  kind: "power" },
  { name: "VCC",  kind: "power" },
];

// Hit-test radius for net labels (delete / drag).
const NET_LABEL_HIT_RADIUS = 15;
type SimMode = "probe" | "move";

type AnalysisType = "tran" | "ac" | "dc" | "op";

type AnalysisConfig =
  | { type: "tran"; tstep: string; tstop: string }
  | { type: "ac"; sweep: "dec" | "oct" | "lin"; points: number; fstart: string; fstop: string }
  | { type: "dc"; source: string; vstart: string; vstop: string; vstep: string }
  | { type: "op" };

type SimResult = {
  analysis: string;
  analysisType: AnalysisType;
  variables: string[];
  points: Record<string, number>[];
  nodeMap: Record<string, string>;
  pinNodes: Record<string, string>;
};

type Pane = {
  id: string;
  signals: Set<string>;
};

const ANALYSIS_STORAGE_KEY = "sirkit:lastAnalysisConfig";

const DEFAULT_ANALYSIS_CONFIGS: { [K in AnalysisType]: Extract<AnalysisConfig, { type: K }> } = {
  tran: { type: "tran", tstep: "10u", tstop: "10m" },
  ac:   { type: "ac", sweep: "dec", points: 10, fstart: "1", fstop: "1Meg" },
  dc:   { type: "dc", source: "V1", vstart: "0", vstop: "10", vstep: "0.1" },
  op:   { type: "op" },
};

const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  tran: "Transient",
  ac:   "AC",
  dc:   "DC sweep",
  op:   "Op point",
};

function loadAnalysisConfig(): AnalysisConfig {
  try {
    const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY);
    if (!raw) return DEFAULT_ANALYSIS_CONFIGS.tran;
    const parsed = JSON.parse(raw) as AnalysisConfig;
    if (parsed && typeof parsed === "object" && "type" in parsed &&
        (parsed.type === "tran" || parsed.type === "ac" ||
         parsed.type === "dc"   || parsed.type === "op")) {
      return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_ANALYSIS_CONFIGS.tran;
}

function pickDefaultSignal(variables: string[], analysisType: AnalysisType): string | null {
  const sweptPattern = /^(time|frequency|v-sweep)$/i;
  const candidates = variables.filter((v) => !sweptPattern.test(v));
  if (analysisType === "ac") {
    const mags = candidates.filter((v) => v.endsWith(".mag")).sort();
    if (mags.length > 0) return mags[mags.length - 1];
  }
  const voltages = candidates.filter((v) => /^v\(.+\)$/i.test(v)).sort();
  if (voltages.length > 0) return voltages[voltages.length - 1];
  return candidates.sort()[candidates.length - 1] ?? null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const theoryParts: { icon: LucideIcon; label: string; note: string; shortcut?: string }[] = [
  { icon: Sigma,           label: "Resistor",        note: "ideal R",    shortcut: "R" },
  { icon: Circle,          label: "Capacitor",       note: "ideal C",    shortcut: "C" },
  { icon: Activity,        label: "Inductor",        note: "ideal L",    shortcut: "L" },
  { icon: BatteryCharging, label: "Voltage source",  note: "DC / AC",   shortcut: "V" },
  { icon: Zap,             label: "Current source",  note: "DC / AC",   shortcut: "I" },
  { icon: Triangle,        label: "Diode",           note: "behavioral", shortcut: "D" },
  { icon: Cpu,             label: "BJT (NPN / PNP)", note: "transistor" },
  { icon: Cpu,             label: "MOSFET (N / P)",  note: "transistor" },
  { icon: Component,       label: "Op-amp",          note: "behavioral" },
  { icon: ChevronsDown,    label: "Ground",          note: "GND",        shortcut: "G" },
];

const SCH_PART_MAP: Record<string, { type: SchComponentType; defaultValue: string } | null> = {
  Resistor:           { type: "resistor",        defaultValue: "10k" },
  Capacitor:          { type: "capacitor",       defaultValue: "100n" },
  Inductor:           { type: "inductor",        defaultValue: "10µ" },
  "Voltage source":   { type: "voltage-source",  defaultValue: "9V" },
  "Current source":   { type: "current-source",  defaultValue: "1m" },
  Diode:              { type: "diode",           defaultValue: "1N4148" },
  Ground:             { type: "ground",          defaultValue: "" },
  "BJT (NPN / PNP)":  null,
  "MOSFET (N / P)":   null,
  "Op-amp":           null,
};

const COMP_DEFAULTS: Record<SchComponentType, string> = {
  resistor: "10k", capacitor: "100n", inductor: "10µ",
  "voltage-source": "9V", "current-source": "1m",
  diode: "1N4148", ground: "",
};

const buildCategories = [
  { label: "Resistors",              count: 4823 },
  { label: "Capacitors",             count: 3210 },
  { label: "Inductors",              count: 412  },
  { label: "Transistors",            count: 1184 },
  { label: "Diodes / LEDs",          count: 967  },
  { label: "Voltage regulators",     count: 542  },
  { label: "ICs / Microcontrollers", count: 2098 },
  { label: "Connectors",             count: 1773 },
  { label: "Crystals / Oscillators", count: 287  },
];

const SCH_TYPE_LABEL: Record<SchComponentType, string> = {
  resistor: "Resistor", capacitor: "Capacitor", inductor: "Inductor",
  "voltage-source": "Voltage Source", "current-source": "Current Source",
  diode: "Diode", ground: "Ground",
};

const SCH_REF_PREFIX: Record<SchComponentType, string> = {
  resistor: "R?", capacitor: "C?", inductor: "L?",
  "voltage-source": "V?", "current-source": "I?",
  diode: "D?", ground: "GND",
};

const SPICE_PREFIX: Record<SchComponentType, string> = {
  resistor: "R", capacitor: "C", inductor: "L", diode: "D",
  "voltage-source": "V", "current-source": "I", ground: "G",
};

const PROBE_COLORS = ["#14b8a6", "#f59e0b", "#f43f5e", "#8b5cf6", "#84cc16", "#0ea5e9"];

const PROBE_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M3 17 L7 13 M5 15 L10 8 L12 10 L17 5 L19 7 L14 12 L12 10' stroke='%2314b8a6' stroke-width='1.5' fill='none' stroke-linecap='round'/><circle cx='3' cy='17' r='1.5' fill='%2314b8a6'/></svg>") 3 17, crosshair`;

// Crosshair with a small filled dot — the Junction tool cursor.
const JUNCTION_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M10 1 V6 M10 14 V19 M1 10 H6 M14 10 H19' stroke='%2314b8a6' stroke-width='1.5' stroke-linecap='round'/><circle cx='10' cy='10' r='2.5' fill='%2314b8a6'/></svg>") 10 10, crosshair`;

const PROBE_PIN_OFFSETS: Record<SchComponentType, Record<string, Point>> = {
  resistor:         { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  capacitor:        { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  inductor:         { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  diode:            { anode: { x: -30, y: 0 }, cathode: { x: 30, y: 0 } },
  "voltage-source": { "+": { x: 0, y: -30 }, "-": { x: 0, y: 30 } },
  "current-source": { "+": { x: 0, y: -30 }, "-": { x: 0, y: 30 } },
  ground:           { pin: { x: 0, y: -20 } },
};

function frontendSpiceName(comp: SchComponent): string {
  const prefix = SPICE_PREFIX[comp.type];
  const id = comp.id.toUpperCase();
  return id.startsWith(prefix) ? id : prefix + id;
}

function compProbeKey(comp: SchComponent): string | null {
  const name = frontendSpiceName(comp).toLowerCase();
  switch (comp.type) {
    case "resistor": case "capacitor": case "inductor":
      return `@${name}[i]`;
    case "diode":
      return `@${name}[id]`;
    case "voltage-source": case "current-source":
      return `i(${name})`;
    case "ground":
      // Ground reference: v(0) is always 0 but useful as a baseline trace.
      return "v(0)";
    default: return null;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

// True for any placement tool (the seven Theory types or KiCad placement).
// Used to gate pointer-events so placement clicks reach the canvas.
function isPlacementTool(t: Tool): boolean {
  return t !== "select" && t !== "wire" && t !== "delete" && t !== "junction";
}

// True only for the seven Theory placement tools (narrows to SchComponentType).
function isTheoryPlacementTool(t: Tool): t is SchComponentType {
  return isPlacementTool(t) && t !== "kicad-place" && t !== "label" && t !== "netlabel-place";
}

// Reference-designator prefix for a KiCad part, from its "Reference" property
// (e.g. "U", "R", "C"). Defaults to "U".
function kicadRefPrefix(part: CachedPart | null): string {
  const ref = part?.properties?.["Reference"];
  const letters = ref ? ref.replace(/[^A-Za-z]/g, "") : "";
  return letters || "U";
}

// Next available reference designator for a part's prefix, scanning existing
// KiCad instances (e.g. "U1", "U2", …).
function nextKicadRefDes(part: CachedPart | null, kicad: KicadComponentInstance[]): string {
  const prefix = kicadRefPrefix(part);
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const k of kicad) {
    const m = re.exec(k.refDes);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

// Default display value for a placed KiCad part: its "Value" property, else name.
function kicadDefaultValue(part: CachedPart | null): string {
  return part?.properties?.["Value"] || part?.name || "";
}

// ─── Wire-tool magnet snap ────────────────────────────────────────────────────

type SnapKind = "pin" | "wire-endpoint" | "wire-interior";
type SnapTarget = { point: Point; kind: SnapKind; wireId?: string };

// Wire-tool snap precedence: pin > wire-endpoint > wire-interior. Within
// a precedence tier the closest hit wins. Returns null if nothing is within
// radius of the cursor.
function findSnapTarget(
  cursor: Point,
  components: SchComponent[],
  wires: Wire[],
  radius: number,
  kicadPinPoints: Point[] = [],
): SnapTarget | null {
  // 1. Pins (Theory components first, then KiCad part pins)
  let best: { target: SnapTarget; d: number } | null = null;
  for (const comp of components) {
    for (const pin of PIN_NAMES[comp.type] ?? []) {
      const p = pinWorldPos(comp, pin);
      const d = distance(cursor, p);
      if (d <= radius && (best === null || d < best.d)) {
        best = { d, target: { point: p, kind: "pin" } };
      }
    }
  }
  for (const p of kicadPinPoints) {
    const d = distance(cursor, p);
    if (d <= radius && (best === null || d < best.d)) {
      best = { d, target: { point: p, kind: "pin" } };
    }
  }
  if (best) return best.target;

  // 2. Wire endpoints
  for (const w of wires) {
    const first = w.vertices[0];
    const last  = w.vertices[w.vertices.length - 1];
    for (const v of [first, last]) {
      if (!v) continue;
      const d = distance(cursor, v);
      if (d <= radius && (best === null || d < best.d)) {
        best = { d, target: { point: v, kind: "wire-endpoint", wireId: w.id } };
      }
    }
  }
  if (best) return best.target;

  // 3. Wire interiors (closest point on each segment, excluding endpoints)
  for (const w of wires) {
    for (let i = 0; i < w.vertices.length - 1; i++) {
      const s = w.vertices[i];
      const e = w.vertices[i + 1];
      const cp = closestPointOnSegment(cursor, s, e);
      if (pointEquals(cp, s) || pointEquals(cp, e)) continue;
      const d = distance(cursor, cp);
      if (d <= radius && (best === null || d < best.d)) {
        best = { d, target: { point: cp, kind: "wire-interior", wireId: w.id } };
      }
    }
  }
  return best?.target ?? null;
}

// ─── Junction tool: wire-crossing detection ──────────────────────────────────

// Crossing point of two axis-aligned segments when one is horizontal, the
// other vertical, and their INTERIORS intersect (strict — endpoint touches
// don't count, so a crossing here is always splittable on both wires).
function perpendicularCrossing(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const aH = a1.y === a2.y && a1.x !== a2.x;
  const bH = b1.y === b2.y && b1.x !== b2.x;
  let h1: Point, h2: Point, v1: Point, v2: Point;
  if (aH && !bH) { h1 = a1; h2 = a2; v1 = b1; v2 = b2; }
  else if (!aH && bH) { h1 = b1; h2 = b2; v1 = a1; v2 = a2; }
  else return null; // parallel (or degenerate) — never a single crossing point
  if (v1.x !== v2.x) return null;
  const x = v1.x;
  const y = h1.y;
  if (x <= Math.min(h1.x, h2.x) || x >= Math.max(h1.x, h2.x)) return null;
  if (y <= Math.min(v1.y, v2.y) || y >= Math.max(v1.y, v2.y)) return null;
  return { x, y };
}

// Nearest point within `radius` of the cursor where two or more wires'
// interiors cross. Wires that don't come within `radius` of the cursor are
// skipped first, which bounds the pairwise sweep to a handful of candidates
// regardless of schematic size.
function findWireCrossingNear(cursor: Point, wires: Wire[], radius: number): Point | null {
  const near: Wire[] = [];
  for (const w of wires) {
    let close = false;
    for (let i = 0; i < w.vertices.length - 1 && !close; i++) {
      const cp = closestPointOnSegment(cursor, w.vertices[i], w.vertices[i + 1]);
      if (distance(cursor, cp) <= radius) close = true;
    }
    if (close) near.push(w);
  }
  let best: { p: Point; d: number } | null = null;
  for (let a = 0; a < near.length; a++) {
    for (let b = a + 1; b < near.length; b++) {
      for (let i = 0; i < near[a].vertices.length - 1; i++) {
        for (let j = 0; j < near[b].vertices.length - 1; j++) {
          const p = perpendicularCrossing(
            near[a].vertices[i], near[a].vertices[i + 1],
            near[b].vertices[j], near[b].vertices[j + 1],
          );
          if (!p) continue;
          const d = distance(cursor, p);
          if (d <= radius && (best === null || d < best.d)) best = { p, d };
        }
      }
    }
  }
  return best?.p ?? null;
}

function screenToWorld(
  e: { clientX: number; clientY: number },
  svg: SVGSVGElement,
  pan: Point,
  zoom: number
): Point {
  const r = svg.getBoundingClientRect();
  return {
    x: snap((e.clientX - r.left - pan.x) / zoom),
    y: snap((e.clientY - r.top  - pan.y) / zoom),
  };
}

function lbend(from: Point, to: Point): Point {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx >= dy ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

// ─── Pin topology helpers ─────────────────────────────────────────────────────

// Rotates a local point by the given rotation. Used inside SVG transforms for
// component pin/probe visuals — geometry.pinWorldPos has the snapping-aware
// world-coordinate variant.
function rotatePoint(p: Point, rotation: 0 | 90 | 180 | 270): Point {
  switch (rotation) {
    case 0:   return { x:  p.x, y:  p.y };
    case 90:  return { x: -p.y, y:  p.x };
    case 180: return { x: -p.x, y: -p.y };
    case 270: return { x:  p.y, y: -p.x };
  }
}

// ─── SVG symbol sub-components ───────────────────────────────────────────────

const SK = "#a1a1aa";
const SW = 1.5;

function ResistorSymbol() {
  return <>
    <line x1="-30" y1="0" x2="-14" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <polyline points="-14,0 -10,-8 -6,8 -2,-8 2,8 6,-8 10,8 14,0"
      stroke={SK} strokeWidth={SW} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="14" y1="0" x2="30" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function CapacitorSymbol() {
  return <>
    <line x1="-30" y1="0" x2="-4" y2="0"   stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="-4"  y1="-10" x2="-4" y2="10" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="4"   y1="-10" x2="4"  y2="10" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="4"   y1="0"  x2="30" y2="0"   stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function InductorSymbol() {
  return <>
    <line x1="-30" y1="0" x2="-18" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <path d="M-18,0 A6,6 0 0,1 -6,0 A6,6 0 0,1 6,0 A6,6 0 0,1 18,0"
      stroke={SK} strokeWidth={SW} fill="none" strokeLinecap="round" />
    <line x1="18" y1="0" x2="30" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function DiodeSymbol() {
  return <>
    <line x1="-30" y1="0" x2="-10" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <polygon points="-10,-8 -10,8 10,0"
      stroke={SK} strokeWidth={SW} fill={SK} fillOpacity={0.15} strokeLinejoin="round" />
    <line x1="10" y1="-8" x2="10" y2="8"  stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="10" y1="0"  x2="30" y2="0"  stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function VoltageSourceSymbol() {
  return <>
    <line x1="0" y1="-30" x2="0" y2="-14" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <circle cx="0" cy="0" r="14" stroke={SK} strokeWidth={SW} fill="none" />
    <text x="0" y="-4" textAnchor="middle" fontSize={10} fill={SK} fontFamily="monospace">+</text>
    <text x="0" y="8"  textAnchor="middle" fontSize={10} fill={SK} fontFamily="monospace">−</text>
    <line x1="0" y1="14" x2="0" y2="30" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function CurrentSourceSymbol() {
  return <>
    <line x1="0" y1="-30" x2="0" y2="-14" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <circle cx="0" cy="0" r="14" stroke={SK} strokeWidth={SW} fill="none" />
    <line x1="0" y1="8" x2="0" y2="-8" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <polyline points="-4,-4 0,-8 4,-4"
      stroke={SK} strokeWidth={SW} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="0" y1="14" x2="0" y2="30" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function GroundSymbol() {
  return <>
    <line x1="0"   y1="-20" x2="0"  y2="-8" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="-12" y1="-8"  x2="12" y2="-8" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="-8"  y1="-2"  x2="8"  y2="-2" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="-4"  y1="4"   x2="4"  y2="4"  stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

const COMP_BBOX: Record<SchComponentType, { x: number; y: number; w: number; h: number }> = {
  resistor:         { x: -30, y: -10, w: 60, h: 20 },
  capacitor:        { x: -30, y: -12, w: 60, h: 24 },
  inductor:         { x: -30, y: -8,  w: 60, h: 16 },
  diode:            { x: -30, y: -10, w: 60, h: 20 },
  "voltage-source": { x: -16, y: -32, w: 32, h: 64 },
  "current-source": { x: -16, y: -32, w: 32, h: 64 },
  ground:           { x: -14, y: -22, w: 28, h: 30 },
};

const VALUE_LABEL: Record<SchComponentType, { x: number; y: number; anchor: string } | null> = {
  resistor:         { x: 0,  y: 22, anchor: "middle" },
  capacitor:        { x: 0,  y: 24, anchor: "middle" },
  inductor:         { x: 0,  y: 20, anchor: "middle" },
  diode:            { x: 0,  y: 22, anchor: "middle" },
  "voltage-source": { x: 22, y: 6,  anchor: "start"  },
  "current-source": { x: 22, y: 6,  anchor: "start"  },
  ground:           null,
};

// Reference designator (R1, C2, V1…), placed opposite the value. Grounds are
// conventionally unlabeled.
const REFDES_LABEL: Record<SchComponentType, { x: number; y: number; anchor: string } | null> = {
  resistor:         { x: 0,  y: -14, anchor: "middle" },
  capacitor:        { x: 0,  y: -16, anchor: "middle" },
  inductor:         { x: 0,  y: -12, anchor: "middle" },
  diode:            { x: 0,  y: -14, anchor: "middle" },
  "voltage-source": { x: 22, y: -7,  anchor: "start"  },
  "current-source": { x: 22, y: -7,  anchor: "start"  },
  ground:           null,
};

function ComponentSymbol({
  comp, selected, deleteHovered, onMouseDown, onMouseEnter, onMouseLeave,
  pointerEvents,
}: {
  comp: SchComponent;
  selected: boolean;
  deleteHovered?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  pointerEvents?: "auto" | "none";
}) {
  const bb = COMP_BBOX[comp.type];
  const vl = VALUE_LABEL[comp.type];
  const rl = REFDES_LABEL[comp.type];

  let shape: React.ReactNode;
  switch (comp.type) {
    case "resistor":        shape = <ResistorSymbol />;       break;
    case "capacitor":       shape = <CapacitorSymbol />;      break;
    case "inductor":        shape = <InductorSymbol />;       break;
    case "diode":           shape = <DiodeSymbol />;          break;
    case "voltage-source":  shape = <VoltageSourceSymbol />;  break;
    case "current-source":  shape = <CurrentSourceSymbol />; break;
    case "ground":          shape = <GroundSymbol />;         break;
  }

  return (
    <g
      transform={`translate(${comp.x},${comp.y}) rotate(${comp.rotation})`}
      style={{
        cursor: deleteHovered ? "crosshair" : "grab",
        pointerEvents: pointerEvents ?? "auto",
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <rect x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12} fill="transparent" />
      {shape}
      {selected && (
        <rect
          x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
          fill="none" stroke="#d4d4d8" strokeWidth={0.75} strokeDasharray="4 2" rx={2}
        />
      )}
      {deleteHovered && (
        <rect
          x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
          fill="#ef4444" fillOpacity={0.15} stroke="#ef4444" strokeWidth={0.75} rx={2}
        />
      )}
      {rl && comp.id && (
        <text
          x={rl.x} y={rl.y}
          textAnchor={rl.anchor as "middle" | "start"}
          fontSize={10} fontFamily="monospace" fill="#d4d4d8"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {comp.id}
        </text>
      )}
      {vl && comp.value && (
        <text
          x={vl.x} y={vl.y}
          textAnchor={vl.anchor as "middle" | "start"}
          fontSize={10} fontFamily="monospace" fill="#71717a"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {comp.value}
        </text>
      )}
    </g>
  );
}

function GhostSymbol({ type, x, y, rotation }: { type: SchComponentType; x: number; y: number; rotation: 0 | 90 | 180 | 270 }) {
  const bb = COMP_BBOX[type];
  return (
    <g transform={`translate(${x},${y}) rotate(${rotation})`} opacity={0.5} style={{ pointerEvents: "none" }}>
      <rect x={bb.x} y={bb.y} width={bb.w} height={bb.h}
        fill="none" stroke="#14b8a6" strokeWidth={0.75} strokeDasharray="3 2" rx={2} />
    </g>
  );
}

// ─── Net label rendering ──────────────────────────────────────────────────────

// Display colors for net-label glyphs/text, slightly lighter than the wire
// palette so labels read on the dark canvas.
const LABEL_ROLE_COLORS: Record<NetRole, string> = {
  power: "#f87171",   // red-400
  ground: "#71717a",  // zinc-500
  signal: "#2dd4bf",  // teal-400
  unknown: "#a1a1aa", // zinc-400
};

/**
 * A net label glyph anchored at label.position (the electrical connection
 * point sits at the local origin). Natural directions: power flags point up,
 * ground symbols hang down, generic flags extend east; `orientation` rotates
 * the glyph clockwise from there.
 */
function NetLabelGlyph({
  label, role, zoom, ghost, deleteHovered, pointerEvents,
  onMouseDown, onMouseEnter, onMouseLeave,
}: {
  label: NetLabel;
  role: NetRole;
  zoom: number;
  ghost?: boolean;
  deleteHovered?: boolean;
  pointerEvents?: "auto" | "none";
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const name = label.name.trim().toUpperCase();
  let body: React.ReactNode;

  if (label.kind === "ground") {
    const showName = name !== "GND" && name !== "0";
    body = (
      <>
        <line x1={0} y1={0} x2={0} y2={10} stroke="#a1a1aa" strokeWidth={1} strokeLinecap="round" />
        <line x1={-6} y1={10} x2={6} y2={10} stroke="#a1a1aa" strokeWidth={1} strokeLinecap="round" />
        <line x1={-4} y1={14} x2={4} y2={14} stroke="#a1a1aa" strokeWidth={1} strokeLinecap="round" />
        <line x1={-2} y1={18} x2={2} y2={18} stroke="#a1a1aa" strokeWidth={1} strokeLinecap="round" />
        {showName && (
          <text x={0} y={28} textAnchor="middle" fontSize={9} fontFamily="monospace" fill="#71717a"
            style={{ userSelect: "none" }}>
            {name}
          </text>
        )}
      </>
    );
  } else if (label.kind === "power") {
    body = (
      <>
        <line x1={0} y1={0} x2={0} y2={-10} stroke="#f87171" strokeWidth={1} strokeLinecap="round" />
        <polygon points="-5,-10 5,-10 0,-18" fill="#f87171" />
        <text x={0} y={-22} textAnchor="middle" fontSize={9} fontFamily="monospace" fill="#f87171"
          style={{ userSelect: "none" }}>
          {name}
        </text>
      </>
    );
  } else {
    const color = LABEL_ROLE_COLORS[role];
    // Flag width tracks the name so the pentagon encloses the text.
    const textW = Math.max(12, name.length * 5.6);
    const flagEnd = 12 + textW + 6;
    body = (
      <>
        <line x1={0} y1={0} x2={10} y2={0} stroke={color} strokeWidth={1} strokeLinecap="round" />
        <polygon
          points={`10,-6 ${flagEnd},-6 ${flagEnd + 6},0 ${flagEnd},6 10,6`}
          fill={color} fillOpacity={0.12} stroke={color} strokeWidth={0.75} strokeLinejoin="round"
        />
        <text x={14} y={3} textAnchor="start" fontSize={9} fontFamily="monospace" fill={color}
          style={{ userSelect: "none" }}>
          {name}
        </text>
      </>
    );
  }

  return (
    <g
      transform={`translate(${label.position.x},${label.position.y}) rotate(${label.orientation})`}
      opacity={ghost ? 0.5 : 1}
      style={{ pointerEvents: pointerEvents ?? "none", cursor: deleteHovered ? "crosshair" : "grab" }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Hit target around the anchor (15px world radius). */}
      <circle cx={0} cy={0} r={NET_LABEL_HIT_RADIUS} fill="transparent" />
      {deleteHovered && (
        <circle cx={0} cy={0} r={NET_LABEL_HIT_RADIUS} fill="#ef4444" fillOpacity={0.15}
          stroke="#ef4444" strokeWidth={0.75 / zoom} style={{ pointerEvents: "none" }} />
      )}
      {/* Anchor tick — marks the exact connection point. */}
      <circle cx={0} cy={0} r={1.5} fill="#71717a" style={{ pointerEvents: "none" }} />
      {body}
    </g>
  );
}

// ─── KiCad instance rendering ──────────────────────────────────────────────────

// Bounding box (world coords) of an instance's pin sites — drives the selection
// halo and ref/value label placement.
function kicadPinBox(instance: KicadComponentInstance, part: CachedPart) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pin of part.pins) {
    const w = kicadPinWorldPos(instance, pin);
    minX = Math.min(minX, w.x); minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x); maxY = Math.max(maxY, w.y);
  }
  if (!Number.isFinite(minX)) {
    return { minX: instance.x - 25, minY: instance.y - 25, maxX: instance.x + 25, maxY: instance.y + 25 };
  }
  return { minX, minY, maxX, maxY };
}

function KicadPlaceholder({ instance }: { instance: KicadComponentInstance }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={instance.x - 25} y={instance.y - 25} width={50} height={50}
        fill="none" stroke="#52525b" strokeWidth={1} strokeDasharray="4 3" rx={3}
      />
      <text x={instance.x} y={instance.y} textAnchor="middle" dominantBaseline="central"
        fontSize={9} fontFamily="monospace" fill="#71717a">loading…</text>
    </g>
  );
}

// Subtle, dark-theme-friendly panel tints so multi-pin ICs read as labeled
// blocks (à la a block diagram). Picked by a stable hash of the category so
// connectors, MCUs, regulators, etc. get visually distinct — but consistent —
// backgrounds.
const BLOCK_TINTS: { fill: string; stroke: string }[] = [
  { fill: "rgba(96,165,250,0.06)",  stroke: "rgba(96,165,250,0.40)" },  // blue
  { fill: "rgba(74,222,128,0.06)",  stroke: "rgba(74,222,128,0.40)" },  // green
  { fill: "rgba(167,139,250,0.06)", stroke: "rgba(167,139,250,0.40)" }, // violet
  { fill: "rgba(251,191,36,0.06)",  stroke: "rgba(251,191,36,0.40)" },  // amber
  { fill: "rgba(45,212,191,0.06)",  stroke: "rgba(45,212,191,0.40)" },  // teal
  { fill: "rgba(244,114,182,0.06)", stroke: "rgba(244,114,182,0.40)" }, // rose
];

function categoryTint(category: string): { fill: string; stroke: string } {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return BLOCK_TINTS[h % BLOCK_TINTS.length];
}

// Parts with at least this many pins render as a tinted block; 2–4-pin passives
// keep their bare symbol art.
const BLOCK_MIN_PINS = 5;

function KicadInstanceView({
  instance, part, selected, deleteHovered, zoom, pointerEvents,
  onMouseDown, onMouseEnter, onMouseLeave,
}: {
  instance: KicadComponentInstance;
  part: CachedPart | null;
  selected: boolean;
  deleteHovered: boolean;
  zoom: number;
  pointerEvents: "auto" | "none";
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  if (!part) {
    return (
      <g onMouseDown={onMouseDown} style={{ pointerEvents, cursor: "grab" }}>
        <KicadPlaceholder instance={instance} />
      </g>
    );
  }

  const box = kicadPinBox(instance, part);
  const pad = 8;
  const block = part.pins.length >= BLOCK_MIN_PINS ? categoryTint(part.mainCategory) : null;

  return (
    <g>
      {/* Block panel behind multi-pin ICs — keeps the real pin geometry (so
          wiring is unchanged) but reads as a labeled block. */}
      {block && (
        <rect
          x={box.minX - pad} y={box.minY - pad}
          width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
          rx={6} fill={block.fill} stroke={block.stroke} strokeWidth={1 / zoom}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Symbol body — the transform applies mm→px scale, rotation, and origin. */}
      <g
        transform={`translate(${instance.x},${instance.y}) rotate(${instance.rotation}) scale(${KICAD_SCALE_PX_PER_MM})`}
        style={{ cursor: deleteHovered ? "crosshair" : "grab", pointerEvents }}
        onMouseDown={onMouseDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <KicadSymbolInline symbolRaw={part.symbolRaw} />
      </g>

      {/* Pin endpoint dots (world coords, non-interactive). */}
      {part.pins.map((pin, i) => {
        const w = kicadPinWorldPos(instance, pin);
        return <circle key={i} cx={w.x} cy={w.y} r={2 / zoom} fill="#52525b" style={{ pointerEvents: "none" }} />;
      })}

      {/* Selection halo. */}
      {selected && (
        <rect
          x={box.minX - pad} y={box.minY - pad}
          width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
          fill="none" stroke="#14b8a6" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${2 / zoom}`} rx={2}
          style={{ pointerEvents: "none" }}
        />
      )}
      {deleteHovered && (
        <rect
          x={box.minX - pad} y={box.minY - pad}
          width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
          fill="#ef4444" fillOpacity={0.12} stroke="#ef4444" strokeWidth={1 / zoom} rx={2}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* RefDes above, value below — horizontal regardless of rotation. */}
      <text x={(box.minX + box.maxX) / 2} y={box.minY - pad - 4}
        textAnchor="middle" fontSize={11} fontFamily="monospace" fill="#d4d4d8"
        style={{ pointerEvents: "none", userSelect: "none" }}>{instance.refDes}</text>
      <text x={(box.minX + box.maxX) / 2} y={box.maxY + pad + 11}
        textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#71717a"
        style={{ pointerEvents: "none", userSelect: "none" }}>{instance.value}</text>
    </g>
  );
}

// ─── Schematic editor ─────────────────────────────────────────────────────────

function SchematicEditor({
  tool, setTool,
  components, setComponents,
  wires, setWires,
  selectedId, setSelectedId,
  wireDraftStart, setWireDraftStart,
  placementRotation,
  kicadComponents, setKicadComponents,
  selectedKicadId, setSelectedKicadId,
  placementPartId,
  netLabels, setNetLabels,
  pendingNetLabel, setPendingNetLabel,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  components: SchComponent[];
  setComponents: Dispatch<SetStateAction<SchComponent[]>>;
  wires: Wire[];
  setWires: Dispatch<SetStateAction<Wire[]>>;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  wireDraftStart: Point | null;
  setWireDraftStart: Dispatch<SetStateAction<Point | null>>;
  placementRotation: 0 | 90 | 180 | 270;
  kicadComponents: KicadComponentInstance[];
  setKicadComponents: Dispatch<SetStateAction<KicadComponentInstance[]>>;
  selectedKicadId: string | null;
  setSelectedKicadId: (id: string | null) => void;
  placementPartId: string | null;
  netLabels: NetLabel[];
  setNetLabels: Dispatch<SetStateAction<NetLabel[]>>;
  pendingNetLabel: PendingNetLabel | null;
  setPendingNetLabel: (p: PendingNetLabel | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan]     = useState<Point>({ x: 100, y: 80 });
  const [zoom, setZoom]   = useState(1);
  const [cursor, setCursor] = useState<Point>({ x: -9999, y: -9999 });
  const [inCanvas, setInCanvas] = useState(false);
  const [deleteHoveredId, setDeleteHoveredId] = useState<string | null>(null);
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  // Junction tool: nearest wire crossing within snap radius of the cursor.
  const [junctionHover, setJunctionHover] = useState<Point | null>(null);
  // Label tool: pending name input at a clicked canvas position. Rendering is
  // gated on the label tool being active, so switching tools hides it; commit,
  // Escape, and blur all clear it.
  const [labelDraft, setLabelDraft] = useState<{ pos: Point; text: string } | null>(null);

  const panRef  = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current  = pan;
  zoomRef.current = zoom;

  const componentsRef = useRef(components);
  componentsRef.current = components;
  const wiresRef = useRef(wires);
  wiresRef.current = wires;
  const kicadComponentsRef = useRef(kicadComponents);
  kicadComponentsRef.current = kicadComponents;
  const netLabelsRef = useRef(netLabels);
  netLabelsRef.current = netLabels;

  // Re-render when async KiCad part data arrives in the cache. `partVersion`
  // bumps on each load so derived data keyed on the cache recomputes.
  const [partVersion, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubs = kicadComponents.map((k) => subscribeToPart(k.partId, forceRender));
    for (const k of kicadComponents) {
      void ensurePartLoaded(k.partId).then(forceRender).catch(() => {});
    }
    return () => { for (const u of unsubs) u(); };
  }, [kicadComponents]);

  // Resolved KiCad pin world positions, used by snap, connectivity, and render.
  const kicadPinSites: KicadPinSite[] = kicadComponents.map((k) => {
    const part = getCachedPart(k.partId);
    return { id: k.id, pins: part ? part.pins.map((p) => kicadPinWorldPos(k, p)) : [] };
  });
  const kicadPinPoints: Point[] = kicadPinSites.flatMap((s) => s.pins);
  const kicadPinSitesRef = useRef(kicadPinSites);
  kicadPinSitesRef.current = kicadPinSites;

  // Net classification for diagram-style rendering (colored power rails, net
  // labels). Recomputed when topology changes or a KiCad part loads.
  const nets = useMemo(() => {
    void partVersion; // recompute when an async KiCad part lands in the cache
    return classifyNets(components, wires, kicadComponents, getCachedPart, netLabels);
  }, [components, wires, kicadComponents, partVersion, netLabels]);

  const dragRef = useRef<{
    type: "pan" | "group";
    startMouse: Point;
    startPan: Point;
    startWorldSnapped?: Point;
    groupCompIds?: Set<string>;
    groupWireIds?: Set<string>;
    groupKicadIds?: Set<string>;
    groupLabelIds?: Set<string>;
    initComps?: Map<string, Point>;
    initWires?: Map<string, Point[]>;
    initKicad?: Map<string, Point>;
    initLabels?: Map<string, Point>;
  } | null>(null);

  // Global mouse handlers
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current || !svgRef.current) return;
      if (dragRef.current.type === "pan") {
        const dx = e.clientX - dragRef.current.startMouse.x;
        const dy = e.clientY - dragRef.current.startMouse.y;
        setPan({ x: dragRef.current.startPan.x + dx, y: dragRef.current.startPan.y + dy });
      } else if (dragRef.current.type === "group") {
        const rect = svgRef.current.getBoundingClientRect();
        const wx = snap((e.clientX - rect.left - panRef.current.x) / zoomRef.current);
        const wy = snap((e.clientY - rect.top  - panRef.current.y) / zoomRef.current);
        const sw = dragRef.current.startWorldSnapped!;
        const dx = wx - sw.x;
        const dy = wy - sw.y;
        const initC = dragRef.current.initComps!;
        const initW = dragRef.current.initWires!;
        const gC    = dragRef.current.groupCompIds!;
        const gW    = dragRef.current.groupWireIds!;
        setComponents(componentsRef.current.map((c) => {
          if (!gC.has(c.id)) return c;
          const init = initC.get(c.id);
          return init ? { ...c, x: init.x + dx, y: init.y + dy } : c;
        }));
        setWires(wiresRef.current.map((w) => {
          if (!gW.has(w.id)) return w;
          const init = initW.get(w.id);
          return init
            ? { ...w, vertices: init.map(v => ({ x: v.x + dx, y: v.y + dy })) }
            : w;
        }));
        const gK = dragRef.current.groupKicadIds;
        const initK = dragRef.current.initKicad;
        if (gK && initK) {
          setKicadComponents(kicadComponentsRef.current.map((k) => {
            if (!gK.has(k.id)) return k;
            const init = initK.get(k.id);
            return init ? { ...k, x: init.x + dx, y: init.y + dy } : k;
          }));
        }
        const gL = dragRef.current.groupLabelIds;
        const initL = dragRef.current.initLabels;
        if (gL && initL) {
          setNetLabels(netLabelsRef.current.map((l) => {
            if (!gL.has(l.id)) return l;
            const init = initL.get(l.id);
            return init ? { ...l, position: { x: init.x + dx, y: init.y + dy } } : l;
          }));
        }
      }
    }
    function onMouseUp() { dragRef.current = null; }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [setComponents, setWires, setKicadComponents, setNetLabels]);

  // Non-passive wheel zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((z) => {
        const nz = Math.min(4, Math.max(0.2, z * factor));
        setPan((p) => ({
          x: mx - (mx - p.x) * (nz / z),
          y: my - (my - p.y) * (nz / z),
        }));
        return nz;
      });
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  function getWorld(e: React.MouseEvent): Point {
    if (!svgRef.current) return { x: 0, y: 0 };
    return screenToWorld(e, svgRef.current, pan, zoom);
  }

  function onSvgMouseMove(e: React.MouseEvent) {
    const w = getWorld(e);
    setCursor(w);
    // Magnet snap only fires for the wire tool. Compute the snap target so
    // the preview, click commit, and hover halo all reference the same point.
    if (tool === "wire") {
      // Label anchors snap like pins so wires can attach to a label's point.
      const anchorPoints = [...kicadPinPoints, ...netLabels.map((l) => l.position)];
      setSnapTarget(findSnapTarget(w, components, wires, GRID, anchorPoints));
    } else if (snapTarget !== null) {
      setSnapTarget(null);
    }
    if (tool === "junction") {
      setJunctionHover(findWireCrossingNear(w, wires, GRID * 1.5));
    } else if (junctionHover !== null) {
      setJunctionHover(null);
    }
  }

  function onSvgMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const raw = getWorld(e);
    // In wire mode the click commits at the snap-target point if there is one,
    // so landing on a wire's interior actually splits that wire.
    const w = (tool === "wire" && snapTarget) ? snapTarget.point : raw;

    if (tool === "select") {
      setSelectedId(null);
      setSelectedKicadId(null);
      dragRef.current = {
        type: "pan",
        startMouse: { x: e.clientX, y: e.clientY },
        startPan: { ...pan },
      };
    } else if (tool === "kicad-place") {
      if (!placementPartId) return;
      const part = getCachedPart(placementPartId);
      const refDes = nextKicadRefDes(part, kicadComponentsRef.current);
      setKicadComponents((ks) => [...ks, {
        id: crypto.randomUUID(),
        partId: placementPartId,
        x: w.x, y: w.y,
        rotation: placementRotation,
        refDes,
        value: kicadDefaultValue(part),
      }]);
      // Stay in kicad-place for LTspice-style repeated placement.
    } else if (tool === "wire") {
      if (!wireDraftStart) {
        // Split any wire whose interior contains the start click point.
        const splitWs = consolidateWires(splitWiresAtPoint(wires, w));
        if (selectedId !== null &&
            !splitWs.some((sw) => sw.id === selectedId) &&
            !components.some((c) => c.id === selectedId)) {
          setSelectedId(null);
        }
        setWires(splitWs);
        setWireDraftStart(w);
      } else {
        const corner = lbend(wireDraftStart, w);
        const segs: Wire[] = [];
        if (!pointEquals(corner, wireDraftStart))
          segs.push({ id: crypto.randomUUID(), vertices: [wireDraftStart, corner] });
        if (!pointEquals(corner, w))
          segs.push({ id: crypto.randomUUID(), vertices: [corner, w] });
        // Split existing wires at the corner and the endpoint, then append new segments.
        let newWires = splitWiresAtPoint(wires, corner);
        newWires = splitWiresAtPoint(newWires, w);
        newWires = consolidateWires([...newWires, ...segs]);
        if (selectedId !== null &&
            !newWires.some((sw) => sw.id === selectedId) &&
            !components.some((c) => c.id === selectedId)) {
          setSelectedId(null);
        }
        setWires(newWires);
        setWireDraftStart(w);
      }
    } else if (tool === "junction") {
      // Commit at the hovered crossing if there is one (matches the preview
      // dot), else at the grid-snapped click point.
      const p = junctionHover ?? raw;
      const crossing = wires.filter((wire) => pointStrictlyOnWireInterior(p, wire));
      // A 1-wire "junction" is pointless — require an actual crossing.
      if (crossing.length >= 2) {
        setWires((ws) => consolidateWires(splitWiresAtPoint(ws, p)));
        setJunctionHover(null);
      }
      // Stay in junction mode so the user can mark another crossing.
    } else if (tool === "label") {
      // Open the floating name input at the clicked (snapped) position.
      setLabelDraft({ pos: w, text: "" });
    } else if (tool === "netlabel-place") {
      if (!pendingNetLabel) return;
      setNetLabels((ls) => [...ls, {
        id: crypto.randomUUID(),
        position: w,
        name: pendingNetLabel.name,
        kind: pendingNetLabel.kind,
        orientation: 0,
      }]);
      // Stay in placement mode for repeated drops; Esc exits.
    } else if (tool === "delete") {
      // wire/component clicks handled by their own handlers
    } else {
      const type = tool as SchComponentType;
      setComponents((cs) => [...cs, {
        id: crypto.randomUUID(), type,
        x: w.x, y: w.y, rotation: placementRotation,
        value: COMP_DEFAULTS[type],
      }]);
    }
  }

  function onCompMouseDown(e: React.MouseEvent, comp: SchComponent) {
    if (e.button !== 0) return;

    if (tool === "delete") {
      e.stopPropagation();
      setComponents((cs) => cs.filter((c) => c.id !== comp.id));
      setDeleteHoveredId(null);
      if (selectedId === comp.id) setSelectedId(null);
      return;
    }

    if (tool === "select") {
      e.stopPropagation();
      setSelectedId(comp.id);
      setSelectedKicadId(null);
      beginGroupDrag({ kind: "component", id: comp.id }, e);
    }
    // wire / placement: let click bubble to SVG background handler
  }

  // Select a KiCad instance and start a rigid-group drag, or delete it.
  function onKicadMouseDown(e: React.MouseEvent, kicad: KicadComponentInstance) {
    if (e.button !== 0) return;
    if (tool === "delete") {
      e.stopPropagation();
      setKicadComponents((ks) => ks.filter((k) => k.id !== kicad.id));
      setDeleteHoveredId(null);
      if (selectedKicadId === kicad.id) setSelectedKicadId(null);
      return;
    }
    if (tool === "select") {
      e.stopPropagation();
      setSelectedKicadId(kicad.id);
      setSelectedId(null);
      beginGroupDrag({ kind: "kicad", id: kicad.id }, e);
    }
  }

  // Shared rigid-group drag setup for Theory components and KiCad instances.
  function beginGroupDrag(
    seed: { kind: "component"; id: string } | { kind: "kicad"; id: string },
    e: React.MouseEvent,
  ) {
    const group = findConnectedGroup(
      seed,
      componentsRef.current,
      wiresRef.current,
      kicadPinSitesRef.current,
      netLabelsRef.current,
    );
    const initComps = new Map<string, Point>();
    const initWires = new Map<string, Point[]>();
    const initKicad = new Map<string, Point>();
    const initLabels = new Map<string, Point>();
    for (const id of group.componentIds) {
      const c = componentsRef.current.find((c) => c.id === id);
      if (c) initComps.set(id, { x: c.x, y: c.y });
    }
    for (const id of group.wireIds) {
      const wire = wiresRef.current.find((w) => w.id === id);
      if (wire) initWires.set(id, wire.vertices.map(v => ({ ...v })));
    }
    for (const id of group.kicadInstanceIds) {
      const k = kicadComponentsRef.current.find((k) => k.id === id);
      if (k) initKicad.set(id, { x: k.x, y: k.y });
    }
    for (const id of group.netLabelIds) {
      const l = netLabelsRef.current.find((l) => l.id === id);
      if (l) initLabels.set(id, { ...l.position });
    }
    const rect = svgRef.current!.getBoundingClientRect();
    const wx = snap((e.clientX - rect.left - pan.x) / zoom);
    const wy = snap((e.clientY - rect.top  - pan.y) / zoom);
    dragRef.current = {
      type: "group",
      startMouse: { x: e.clientX, y: e.clientY },
      startPan: pan,
      startWorldSnapped: { x: wx, y: wy },
      groupCompIds: group.componentIds,
      groupWireIds: group.wireIds,
      groupKicadIds: group.kicadInstanceIds,
      groupLabelIds: group.netLabelIds,
      initComps,
      initWires,
      initKicad,
      initLabels,
    };
  }

  function onWireMouseDown(e: React.MouseEvent, wire: Wire) {
    e.stopPropagation();
    if (tool === "delete") {
      setWires((ws) => ws.filter((w) => w.id !== wire.id));
      setDeleteHoveredId(null);
    }
  }

  // Delete a net label, or drag it alone (a label is an annotation — moving
  // one must not drag the whole net it names).
  function onLabelMouseDown(e: React.MouseEvent, label: NetLabel) {
    if (e.button !== 0) return;
    if (tool === "delete") {
      e.stopPropagation();
      setNetLabels((ls) => ls.filter((l) => l.id !== label.id));
      setDeleteHoveredId(null);
      return;
    }
    if (tool === "select") {
      e.stopPropagation();
      const rect = svgRef.current!.getBoundingClientRect();
      const wx = snap((e.clientX - rect.left - pan.x) / zoom);
      const wy = snap((e.clientY - rect.top  - pan.y) / zoom);
      dragRef.current = {
        type: "group",
        startMouse: { x: e.clientX, y: e.clientY },
        startPan: pan,
        startWorldSnapped: { x: wx, y: wy },
        groupCompIds: new Set(),
        groupWireIds: new Set(),
        groupKicadIds: new Set(),
        groupLabelIds: new Set([label.id]),
        initComps: new Map(),
        initWires: new Map(),
        initKicad: new Map(),
        initLabels: new Map([[label.id, { ...label.position }]]),
      };
    }
  }

  // Commit the floating label-name input → a generic net label at the click
  // position. Stays in the label tool for placing more.
  function commitLabelDraft() {
    if (!labelDraft) return;
    const name = labelDraft.text.trim().toUpperCase();
    if (name !== "") {
      setNetLabels((ls) => [...ls, {
        id: crypto.randomUUID(),
        position: labelDraft.pos,
        name,
        kind: "label",
        orientation: 0,
      }]);
    }
    setLabelDraft(null);
  }

  // Effective endpoint for the wire preview: snap target if the cursor is
  // within radius of a pin / wire endpoint / wire interior, else the raw
  // GRID-snapped cursor.
  const effectiveEnd = tool === "wire" && snapTarget ? snapTarget.point : cursor;
  const previewPts: Point[] = [];
  if (wireDraftStart) {
    const corner = lbend(wireDraftStart, effectiveEnd);
    previewPts.push(wireDraftStart);
    if (corner.x !== wireDraftStart.x || corner.y !== wireDraftStart.y) previewPts.push(corner);
    previewPts.push(effectiveEnd);
  }

  // Junction dots: any point touched by 3+ wire endpoints
  const ptCount = new Map<string, number>();
  for (const w of wires) {
    const first = w.vertices[0];
    const last  = w.vertices[w.vertices.length - 1];
    for (const p of [first, last]) {
      if (!p) continue;
      const k = `${p.x},${p.y}`;
      ptCount.set(k, (ptCount.get(k) ?? 0) + 1);
    }
  }
  const junctions: Point[] = [];
  ptCount.forEach((n, k) => {
    if (n >= 3) {
      const [x, y] = k.split(",").map(Number);
      junctions.push({ x, y });
    }
  });

  const isTheoryPlacing = isTheoryPlacementTool(tool);
  const placementPart = tool === "kicad-place" && placementPartId ? getCachedPart(placementPartId) : null;
  const cursorStyle =
    tool === "select" ? "default"
    : tool === "junction" ? JUNCTION_CURSOR
    : tool === "label" ? "text"
    : "crosshair";

  const statusMsg =
    tool === "wire" && wireDraftStart
      ? "WIRE — click next point  [Esc cancel]"
      : tool === "wire"
      ? "WIRE — click to start  [Esc to exit]"
      : tool === "delete"
      ? "DELETE — click element to remove  [Esc cancel]"
      : tool === "junction"
      ? "JUNCTION — click where two wires cross  [Esc cancel]"
      : tool === "label"
      ? "LABEL — click to name a net  [Enter commit · Esc cancel]"
      : tool === "netlabel-place"
      ? `PLACE ${pendingNetLabel?.name ?? "label"}  [Esc cancel · click place]`
      : tool === "kicad-place"
      ? `PLACE ${placementPart?.name ?? "part"}  [Esc cancel · click place · R rotate]`
      : isTheoryPlacing
      ? `PLACE ${SCH_TYPE_LABEL[tool as SchComponentType]}  [Esc cancel · click place]`
      : "SELECT  [W wire · X delete · R rotate · Del delete]";

  return (
    <div className="absolute inset-0 bg-zinc-950">
      {/* Floating toolbar */}
      <div className="absolute top-3 left-3 z-10 flex gap-1 bg-zinc-900/90 border border-zinc-800 rounded-md p-1 backdrop-blur-sm shadow-lg">
        <button
          title="Select"
          onClick={() => { setTool("select"); setWireDraftStart(null); }}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "select"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <MousePointer className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">S</span>
        </button>
        <button
          title="Wire"
          onClick={() => setTool("wire")}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "wire"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Pencil className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">W</span>
        </button>
        <button
          title="Delete"
          onClick={() => setTool("delete")}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "delete"
              ? "bg-red-900/70 text-red-300"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Scissors className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">X</span>
        </button>
        <button
          title="Junction — mark a wire crossing as connected"
          onClick={() => { setTool("junction"); setWireDraftStart(null); }}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "junction"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <CircleDot className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">J</span>
        </button>
        <button
          title="Net label — name a net; same-name labels connect electrically"
          onClick={() => { setTool("label"); setWireDraftStart(null); setPendingNetLabel(null); }}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "label"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Tag className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">T</span>
        </button>
        <div className="w-px self-stretch my-1 bg-zinc-800" />
        {QUICK_LABELS.map((q) => (
          <button
            key={q.name}
            title={`Place a ${q.name} ${q.kind === "ground" ? "ground symbol" : "power port"}`}
            onClick={() => {
              setTool("netlabel-place");
              setPendingNetLabel(q);
              setWireDraftStart(null);
            }}
            className={`h-7 px-1.5 rounded font-mono text-[10px] transition ${
              tool === "netlabel-place" && pendingNetLabel?.name === q.name
                ? "bg-zinc-700 text-zinc-100"
                : q.kind === "ground"
                ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                : "text-red-400/80 hover:text-red-300 hover:bg-zinc-800"
            }`}
          >
            {q.name}
          </button>
        ))}
      </div>

      {/* Status bar */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-zinc-600 font-mono select-none">
        {statusMsg}
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ cursor: cursorStyle, display: "block" }}
        onMouseMove={onSvgMouseMove}
        onMouseDown={onSvgMouseDown}
        onMouseEnter={() => setInCanvas(true)}
        onMouseLeave={() => setInCanvas(false)}
      >
        <defs>
          <pattern
            id="dot-grid"
            x={pan.x % (20 * zoom)}
            y={pan.y % (20 * zoom)}
            width={20 * zoom}
            height={20 * zoom}
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r={Math.max(0.4, zoom * 0.7)} fill="rgba(255,255,255,0.07)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Committed wires */}
          {wires.map((wire) => {
            const pts = wire.vertices.map(v => `${v.x},${v.y}`).join(" ");
            const isDeleteHovered = tool === "delete" && deleteHoveredId === wire.id;
            const isSnapHovered   = tool === "wire" && snapTarget?.wireId === wire.id;
            // Disable wire hit-testing while drawing/placing/junctioning so
            // clicks reach the canvas — this is the headline fix for
            // wire-to-wire connection.
            const hitTargetActive = !(tool === "wire" || tool === "junction" || isPlacementTool(tool));
            return (
              <g key={wire.id}>
                {isSnapHovered && (
                  <polyline
                    points={pts} fill="none"
                    stroke="#14b8a6" strokeWidth={4 / zoom} strokeOpacity={0.3}
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {isDeleteHovered && (
                  <polyline
                    points={pts} fill="none"
                    stroke="#ef4444" strokeWidth={8 / zoom} strokeOpacity={0.3} strokeLinecap="round" strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                <polyline
                  points={pts} fill="none"
                  stroke={nets.wireColor(wire)}
                  strokeWidth={(nets.wireRole(wire) === "unknown" ? 0.75 : 1) / zoom}
                  strokeLinecap="round" strokeLinejoin="miter"
                  style={{ pointerEvents: "none" }}
                />
                {/* Fat transparent hit target — tool-gated so wire mode and
                    placement modes don't intercept clicks. */}
                <polyline
                  points={pts} fill="none"
                  stroke="transparent" strokeWidth={12 / zoom} strokeLinecap="round"
                  style={{
                    cursor: tool === "delete" ? "crosshair" : "default",
                    pointerEvents: hitTargetActive ? "stroke" : "none",
                  }}
                  onMouseDown={(e) => onWireMouseDown(e, wire)}
                  onMouseEnter={() => { if (tool === "delete") setDeleteHoveredId(wire.id); }}
                  onMouseLeave={() => setDeleteHoveredId((prev) => prev === wire.id ? null : prev)}
                />
              </g>
            );
          })}

          {/* Wire draft preview */}
          {previewPts.length >= 2 && (
            <polyline
              points={previewPts.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke="#14b8a6"
              strokeWidth={1 / zoom}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${4 / zoom} ${2 / zoom}`}
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* Junction dots */}
          {junctions.map((j, i) => (
            <circle key={i} cx={j.x} cy={j.y} r={2.5 / zoom} fill="#a1a1aa" style={{ pointerEvents: "none" }} />
          ))}

          {/* Derived rail names — power/ground nets with no explicit label. */}
          {nets.labels.map((l, i) => (
            <text
              key={i}
              x={l.point.x + 4} y={l.point.y - 4}
              textAnchor="start" fontSize={9} fontFamily="monospace" fill={l.color}
              stroke="#09090b" strokeWidth={0.6 / zoom}
              style={{ paintOrder: "stroke", pointerEvents: "none", userSelect: "none" }}
            >
              {l.name}
            </text>
          ))}

          {/* Explicit net labels — power flags, ground symbols, signal flags.
              Same-name labels are electrically one net. */}
          {netLabels.map((label) => (
            <NetLabelGlyph
              key={label.id}
              label={label}
              role={nets.roleAt(label.position)}
              zoom={zoom}
              deleteHovered={tool === "delete" && deleteHoveredId === label.id}
              pointerEvents={tool === "select" || tool === "delete" ? "auto" : "none"}
              onMouseDown={(e) => onLabelMouseDown(e, label)}
              onMouseEnter={() => { if (tool === "delete") setDeleteHoveredId(label.id); }}
              onMouseLeave={() => setDeleteHoveredId((prev) => prev === label.id ? null : prev)}
            />
          ))}

          {/* Components — pointer-events gated so wire/placement clicks
              go straight through to the canvas. */}
          {components.map((comp) => (
            <ComponentSymbol
              key={comp.id}
              comp={comp}
              selected={comp.id === selectedId}
              deleteHovered={tool === "delete" && deleteHoveredId === comp.id}
              pointerEvents={tool === "wire" || tool === "junction" || isPlacementTool(tool) ? "none" : "auto"}
              onMouseDown={(e) => onCompMouseDown(e, comp)}
              onMouseEnter={() => { if (tool === "delete") setDeleteHoveredId(comp.id); }}
              onMouseLeave={() => setDeleteHoveredId((prev) => prev === comp.id ? null : prev)}
            />
          ))}

          {/* Placed KiCad components */}
          {kicadComponents.map((kicad) => (
            <KicadInstanceView
              key={kicad.id}
              instance={kicad}
              part={getCachedPart(kicad.partId)}
              selected={kicad.id === selectedKicadId}
              deleteHovered={tool === "delete" && deleteHoveredId === kicad.id}
              zoom={zoom}
              pointerEvents={tool === "wire" || tool === "junction" || isPlacementTool(tool) ? "none" : "auto"}
              onMouseDown={(e) => onKicadMouseDown(e, kicad)}
              onMouseEnter={() => { if (tool === "delete") setDeleteHoveredId(kicad.id); }}
              onMouseLeave={() => setDeleteHoveredId((prev) => prev === kicad.id ? null : prev)}
            />
          ))}

          {/* Junction preview: teal dot at the nearest wire crossing. */}
          {tool === "junction" && junctionHover && (
            <circle
              cx={junctionHover.x} cy={junctionHover.y}
              r={4 / zoom}
              fill="rgba(20,184,166,0.35)"
              stroke="#14b8a6"
              strokeWidth={1 / zoom}
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* Snap-target indicator: a small teal dot at the exact snap point. */}
          {tool === "wire" && snapTarget && (
            <circle
              cx={snapTarget.point.x} cy={snapTarget.point.y}
              r={4 / zoom}
              fill="rgba(20,184,166,0.3)"
              stroke="#14b8a6"
              strokeWidth={1 / zoom}
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* Theory ghost preview */}
          {isTheoryPlacing && inCanvas && (
            <GhostSymbol type={tool as SchComponentType} x={cursor.x} y={cursor.y} rotation={placementRotation} />
          )}

          {/* KiCad ghost preview */}
          {tool === "kicad-place" && inCanvas && placementPart && (
            <g transform={`translate(${cursor.x},${cursor.y}) rotate(${placementRotation}) scale(${KICAD_SCALE_PX_PER_MM})`}
               opacity={0.5} style={{ pointerEvents: "none" }}>
              <KicadSymbolInline symbolRaw={placementPart.symbolRaw} />
            </g>
          )}

          {/* Net-label ghost preview */}
          {tool === "netlabel-place" && inCanvas && pendingNetLabel && (
            <NetLabelGlyph
              label={{
                id: "__ghost",
                position: cursor,
                name: pendingNetLabel.name,
                kind: pendingNetLabel.kind,
                orientation: 0,
              }}
              role={pendingNetLabel.kind === "ground" ? "ground" : pendingNetLabel.kind === "power" ? "power" : "signal"}
              zoom={zoom}
              ghost
            />
          )}
        </g>
      </svg>

      {/* Floating name input for the Label tool. */}
      {tool === "label" && labelDraft && (
        <div
          className="absolute z-20"
          style={{
            left: labelDraft.pos.x * zoom + pan.x + 8,
            top:  labelDraft.pos.y * zoom + pan.y - 12,
          }}
        >
          <input
            autoFocus
            value={labelDraft.text}
            placeholder="NET_NAME"
            onChange={(e) =>
              setLabelDraft((d) => (d ? { ...d, text: e.target.value } : d))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitLabelDraft(); }
              else if (e.key === "Escape") { e.preventDefault(); setLabelDraft(null); }
            }}
            onBlur={() => setLabelDraft(null)}
            className="h-6 w-28 bg-zinc-900 border border-teal-600 rounded px-1.5 font-mono text-[11px] uppercase text-zinc-100 placeholder:text-zinc-600 outline-none shadow-lg"
          />
        </div>
      )}
    </div>
  );
}

// ─── Properties panel ────────────────────────────────────────────────────────

function PropertiesPanel({
  comp, onValueChange, onRotationChange, onDelete,
}: {
  comp: SchComponent;
  onValueChange: (v: string) => void;
  onRotationChange: (r: 0 | 90 | 180 | 270) => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute top-4 right-4 w-52 z-10 bg-zinc-900/95 border border-zinc-800 rounded-md p-3 backdrop-blur-sm shadow-lg">
      <div className="text-xs uppercase text-zinc-500 mb-0.5 tracking-wide">
        {SCH_TYPE_LABEL[comp.type]}
      </div>
      <div className="text-[10px] text-zinc-600 mb-3">{SCH_REF_PREFIX[comp.type]}</div>

      {comp.type !== "ground" && (
        <div className="mb-3">
          <div className="text-[10px] text-zinc-500 mb-1">Value</div>
          <Input
            value={comp.value}
            onChange={(e) => onValueChange(e.target.value)}
            className="h-7 text-xs border-zinc-700 bg-zinc-800"
          />
        </div>
      )}

      <div className="mb-3">
        <div className="text-[10px] text-zinc-500 mb-1">Rotation</div>
        <div className="flex gap-1">
          {([0, 90, 180, 270] as const).map((r) => (
            <button
              key={r}
              onClick={() => onRotationChange(r)}
              className={`flex-1 text-[10px] py-0.5 rounded border transition ${
                comp.rotation === r
                  ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {r}°
            </button>
          ))}
        </div>
      </div>

      <Button size="sm" variant="destructive" className="w-full h-7 text-xs" onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
}

// Properties panel for a placed KiCad component. Fetches its static catalog
// data via the cache (subscribing so async loads refresh the metadata).
function KicadPropertiesPanel({
  instance, onRefDesChange, onValueChange, onRotate, onDelete, onReplace,
}: {
  instance: KicadComponentInstance;
  onRefDesChange: (v: string) => void;
  onValueChange: (v: string) => void;
  onRotate: () => void;
  onDelete: () => void;
  onReplace: () => void;
}) {
  const [part, setPart] = useState<CachedPart | null>(() => getCachedPart(instance.partId));
  useEffect(() => {
    setPart(getCachedPart(instance.partId));
    const unsub = subscribeToPart(instance.partId, () => setPart(getCachedPart(instance.partId)));
    void ensurePartLoaded(instance.partId).then(setPart).catch(() => {});
    return unsub;
  }, [instance.partId]);

  return (
    <div className="absolute top-4 right-4 w-60 z-10 bg-zinc-900/95 border border-zinc-800 rounded-md p-3 backdrop-blur-sm shadow-lg">
      <div className="text-xs uppercase text-zinc-500 mb-2 tracking-wide truncate">
        {part?.name ?? "KiCad part"}
      </div>

      <div className="mb-2">
        <div className="text-[10px] text-zinc-500 mb-1">Reference designator</div>
        <Input value={instance.refDes} onChange={(e) => onRefDesChange(e.target.value)}
          className="h-7 text-xs border-zinc-700 bg-zinc-800" />
      </div>
      <div className="mb-3">
        <div className="text-[10px] text-zinc-500 mb-1">Value</div>
        <Input value={instance.value} onChange={(e) => onValueChange(e.target.value)}
          className="h-7 text-xs border-zinc-700 bg-zinc-800" />
      </div>

      <div className="space-y-1 text-[10px] mb-3 border-t border-zinc-800 pt-2">
        {part?.mpn && <KicadMetaRow label="MPN" value={part.mpn} />}
        {part?.manufacturer && <KicadMetaRow label="Mfr" value={part.manufacturer} />}
        {part && <KicadMetaRow label="Library" value={part.libraryName} />}
        {part && <KicadMetaRow label="Pins" value={String(part.pins.length)} />}
        {part?.footprintHint && <KicadMetaRow label="Footprint" value={part.footprintHint} />}
        {part?.datasheet && (
          <a href={part.datasheet} target="_blank" rel="noopener noreferrer"
            className="inline-block text-teal-400 hover:text-teal-300 transition pt-0.5">Datasheet ↗</a>
        )}
      </div>

      <div className="flex gap-1">
        <Button size="sm" variant="secondary" className="flex-1 h-7 text-[11px]" onClick={onRotate}>Rotate</Button>
        <Button size="sm" variant="destructive" className="flex-1 h-7 text-[11px]" onClick={onDelete}>Delete</Button>
      </div>
      <Button size="sm" variant="ghost" className="w-full h-7 text-[11px] mt-1 text-zinc-400" onClick={onReplace}>
        Replace part…
      </Button>
    </div>
  );
}

function KicadMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-zinc-500 w-16 shrink-0">{label}</span>
      <span className="text-zinc-300 break-all">{value}</span>
    </div>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [mode, setMode]         = useState<Mode>("build");
  const [view, setView]         = useState<View>("schematic");
  const [leftPanel, setLeftPanel]           = useState<LeftPanel>(null);
  const [chatOpen, setChatOpen]             = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [chatWidth, setChatWidth]           = useState(384);
  const [leftPanelWidth, setLeftPanelWidth] = useState(240);

  // Schematic state
  const [tool, setTool]       = useState<Tool>("select");
  const [components, setComponents] = useState<SchComponent[]>([]);
  const [wires, setWires]               = useState<Wire[]>([]);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [wireDraftStart, setWireDraftStart] = useState<Point | null>(null);
  const [placementRotation, setPlacementRotation] = useState<0 | 90 | 180 | 270>(0);

  // KiCad (Build-mode) component state — parallel to Theory components.
  const [kicadComponents, setKicadComponents] = useState<KicadComponentInstance[]>([]);
  const [selectedKicadId, setSelectedKicadId] = useState<string | null>(null);
  const [placementPartId, setPlacementPartId] = useState<string | null>(null);

  // Net labels (both modes) + the preset held by the quick-place tool.
  const [netLabels, setNetLabels] = useState<NetLabel[]>([]);
  const [pendingNetLabel, setPendingNetLabel] = useState<PendingNetLabel | null>(null);

  // Begin modal placement of a KiCad part (from the Build library panel).
  function startKicadPlacement(partId: string) {
    setPlacementPartId(partId);
    setTool("kicad-place");
    setSelectedId(null);
    setSelectedKicadId(null);
    void ensurePartLoaded(partId).catch(() => {});
  }

  // AI generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing]       = useState(false);
  const [genError, setGenError]         = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{
    state: SchematicState;
    explanation: string;
    prompt: string;
  } | null>(null);

  // Simulation state
  const [simResult, setSimResult]       = useState<SimResult | null>(null);
  const [simLoading, setSimLoading]     = useState(false);
  const [simError, setSimError]         = useState<string | null>(null);
  const [panes, setPanes]               = useState<Pane[]>([]);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [simMode, setSimMode]           = useState<SimMode>("probe");
  const [chartPanelOpen, setChartPanelOpen] = useState(true);
  const [analysisConfig, setAnalysisConfig] = useState<AnalysisConfig>(
    () => DEFAULT_ANALYSIS_CONFIGS.tran,
  );

  // Hydrate analysis config from localStorage post-mount (SSR safety).
  useEffect(() => { setAnalysisConfig(loadAnalysisConfig()); }, []);
  useEffect(() => {
    try { localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(analysisConfig)); }
    catch { /* ignore */ }
  }, [analysisConfig]);

  // Panel resize
  const dragging   = useRef<"left" | "right" | null>(null);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      if (dragging.current === "right") {
        const delta = dragStartX.current - e.clientX;
        setChatWidth(Math.min(700, Math.max(240, dragStartW.current + delta)));
      } else {
        const delta = e.clientX - dragStartX.current;
        setLeftPanelWidth(Math.min(500, Math.max(180, dragStartW.current + delta)));
      }
    }
    function onMouseUp() {
      dragging.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, []);

  function startDrag(side: "left" | "right", e: React.MouseEvent) {
    dragging.current   = side;
    dragStartX.current = e.clientX;
    dragStartW.current = side === "right" ? chatWidth : leftPanelWidth;
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  // Global keyboard shortcuts — driven by the centralized binding map
  useEffect(() => {
    const PLACEMENT_TOOLS = new Set<string>([
      "resistor", "capacitor", "inductor", "diode",
      "voltage-source", "current-source", "ground",
    ]);

    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      if (active && (
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable
      )) return;

      const prefix = (e.ctrlKey || e.metaKey) ? "ctrl+" : "";
      const keyStr = prefix + e.key.toLowerCase();

      const binding = getKeyBindings()[keyStr];
      if (!binding) {
        // Junction/label tool shortcuts — handled here rather than in the
        // central binding map so users' custom keybinding files keep working
        // unchanged.
        if (keyStr === "j") {
          e.preventDefault();
          setTool("junction");
          setWireDraftStart(null);
        } else if (keyStr === "t") {
          e.preventDefault();
          setTool("label");
          setWireDraftStart(null);
          setPendingNetLabel(null);
        }
        return;
      }
      e.preventDefault();

      if (binding.action === "set-tool") {
        setTool(binding.tool as Tool);
        setWireDraftStart(null);
      } else if (binding.action === "rotate") {
        if (selectedId && tool === "select") {
          setComponents((cs) => cs.map((c) =>
            c.id === selectedId
              ? { ...c, rotation: ((c.rotation + 90) % 360) as 0 | 90 | 180 | 270 }
              : c
          ));
        } else if (selectedKicadId && tool === "select") {
          setKicadComponents((ks) => ks.map((k) =>
            k.id === selectedKicadId
              ? { ...k, rotation: ((k.rotation + 90) % 360) as 0 | 90 | 180 | 270 }
              : k
          ));
        } else if (PLACEMENT_TOOLS.has(tool) || tool === "kicad-place") {
          setPlacementRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270);
        }
      } else if (binding.action === "delete-selection") {
        if (selectedId) {
          setComponents((cs) => cs.filter((c) => c.id !== selectedId));
          setSelectedId(null);
        } else if (selectedKicadId) {
          setKicadComponents((ks) => ks.filter((k) => k.id !== selectedKicadId));
          setSelectedKicadId(null);
        }
      } else if (binding.action === "exit-tool-or-end-wire") {
        if (wireDraftStart !== null) {
          setWireDraftStart(null);
        } else if (tool !== "select") {
          setTool("select");
          setWireDraftStart(null);
          setPlacementPartId(null);
          setPendingNetLabel(null);
        } else {
          setSelectedId(null);
          setSelectedKicadId(null);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tool, wireDraftStart, selectedId, selectedKicadId]);

  // Sim-view keyboard shortcuts + reset to probe on enter
  useEffect(() => {
    if (view !== "sim") return;
    setSimMode("probe");
    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      if (e.key === "Escape" || e.key.toLowerCase() === "p") { setSimMode("probe"); e.preventDefault(); }
      else if (e.key.toLowerCase() === "m") { setSimMode("move"); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  function addComponent(type: SchComponentType) {
    setTool(type);
  }

  function toggleLeftPanel(panel: "projects" | "library") {
    setLeftPanel((prev) => (prev === panel ? null : panel));
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message      = { id: Date.now().toString(), role: "user", content: text };
    const assistantId           = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);

    try {
      const apiMessages = [...messages, userMsg].map(({ role, content }) => ({ role, content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
        );
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "Error — please try again." } : m
        )
      );
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function applySchematic(state: SchematicState, explanation: string, prompt: string) {
    setComponents(state.components);
    setWires(state.wires);
    setKicadComponents(state.kicadComponents ?? []);
    setNetLabels(state.netLabels ?? []);
    setSelectedId(null);
    setSelectedKicadId(null);
    setWireDraftStart(null);
    setTool("select");
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user",      content: prompt },
      { id: crypto.randomUUID(), role: "assistant", content: explanation },
    ]);
  }

  async function handleGenerateSchematic(prompt: string) {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      let state: SchematicState;
      let explanation: string;

      if (mode === "build") {
        const res = await fetch("/api/schematic/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const data = (await res.json()) as
          | { ok: true; netlist: BuildLogicalNetlist; explanation: string }
          | { ok: false; error: string };
        if (!data.ok) throw new Error(data.error || "Generation failed");

        // Load every referenced part before laying out (positions come from pins).
        const netlist = data.netlist;
        const partIds = [...new Set(netlist.components.map((c) => c.partId))];
        const parts = new Map<string, CachedPart>();
        await Promise.all(
          partIds.map(async (id) => {
            parts.set(id, await ensurePartLoaded(id));
          }),
        );
        const built = autoLayoutBuildValidated(netlist, parts);
        state = built.state;
        explanation = data.explanation;

        if ((state.kicadComponents?.length ?? 0) === 0) {
          setGenError("No parts produced — try a more specific prompt.");
          setTimeout(() => setGenError(null), 6000);
          return;
        }

        // Electrical validation: surface (don't silently ship) a schematic that
        // is electrically wrong by netlist after reroute attempts.
        if (!built.validation.ok) {
          const v = built.validation.violations;
          setGenError(
            `Electrical check: ${v.length} issue(s) — ${v.slice(0, 3).map((x) => x.message).join("  |  ")}${v.length > 3 ? " …" : ""}`,
          );
          setTimeout(() => setGenError(null), 12000);
        }
      } else {
        const result = await generateSchematic(prompt);
        state = result.state;
        explanation = result.netlist.explanation;
        if (state.components.length === 0) {
          setGenError("No components produced — try a more specific prompt.");
          setTimeout(() => setGenError(null), 6000);
          return;
        }

        // Surface (don't silently ship) an electrically-invalid theory schematic.
        if (!result.validation.ok) {
          const v = result.validation.violations;
          setGenError(
            `Electrical check: ${v.length} issue(s) — ${v.slice(0, 3).map((x) => x.message).join("  |  ")}${v.length > 3 ? " …" : ""}`,
          );
          setTimeout(() => setGenError(null), 12000);
        }
      }

      if (components.length > 0 || wires.length > 0 || kicadComponents.length > 0 || netLabels.length > 0) {
        setPendingReplace({ state, explanation, prompt });
      } else {
        applySchematic(state, explanation, prompt);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      setGenError(msg);
      setTimeout(() => setGenError(null), 6000);
    } finally {
      setIsGenerating(false);
    }
  }

  // Tier-1 text editing: attribute-only edits (set value / rename / delete)
  // applied directly to state. No re-layout, no netlist round-trip — so manual
  // placement is preserved and the validator isn't involved (connectivity only
  // changes on delete, which is the user's explicit intent).
  async function handleEditSchematic(prompt: string) {
    if (!prompt.trim() || isEditing) return;
    const hasSchematic = components.length > 0 || kicadComponents.length > 0;
    if (!hasSchematic) return;

    setIsEditing(true);
    setGenError(null);
    try {
      const summary = [
        ...components.map((c) => ({ refDes: c.id, kind: c.type, value: c.value || "" })),
        ...kicadComponents.map((k) => ({
          refDes: k.refDes,
          kind: getCachedPart(k.partId)?.name ?? "part",
          value: k.value || "",
        })),
      ];

      const res = await fetch("/api/schematic/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: prompt, components: summary }),
      });
      const data = (await res.json()) as
        | { ok: true; ops: SchematicEditOp[]; note: string; needsTopology: boolean }
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error || "Edit failed");

      // Tier 2 — topology edit (add / rewire / swap). Round-trips the current
      // schematic through the netlist editor, then re-lays-out + validates.
      if (data.needsTopology) {
        if (mode !== "build") {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "user", content: prompt },
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content:
                "Topology edits (adding, rewiring, or swapping parts) aren't supported in Theory mode yet — use Generate to recreate the circuit.",
            },
          ]);
          return;
        }

        const partsMap = new Map<string, CachedPart>();
        for (const k of kicadComponents) {
          const p = getCachedPart(k.partId);
          if (p) partsMap.set(k.partId, p);
        }
        const currentNetlist = schematicToBuildNetlist(
          { components, wires, kicadComponents, netLabels },
          partsMap,
        );

        const res2 = await fetch("/api/schematic/edit-build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction: prompt, netlist: currentNetlist }),
        });
        const data2 = (await res2.json()) as
          | { ok: true; netlist: BuildLogicalNetlist; explanation: string }
          | { ok: false; error: string };
        if (!data2.ok) throw new Error(data2.error || "Edit failed");

        const nl = data2.netlist;
        const ids = [...new Set(nl.components.map((c) => c.partId))];
        const loaded = new Map<string, CachedPart>();
        await Promise.all(ids.map(async (id) => loaded.set(id, await ensurePartLoaded(id))));

        const built = autoLayoutBuildValidated(nl, loaded);
        // Re-layout replaces positions (Tier 2 tradeoff). applySchematic logs the
        // instruction + explanation into the chat transcript.
        applySchematic(built.state, data2.explanation || "Updated the circuit.", prompt);
        if (!built.validation.ok) {
          const v = built.validation.violations;
          setGenError(
            `Electrical check: ${v.length} issue(s) — ${v.slice(0, 3).map((x) => x.message).join("  |  ")}${v.length > 3 ? " …" : ""}`,
          );
          setTimeout(() => setGenError(null), 12000);
        }
        return;
      }

      let comps = components;
      let kis = kicadComponents;
      let wrs = wires;
      let lbls = netLabels;
      const deletedPinKeys = new Set<string>();
      let applied = 0;

      for (const op of data.ops) {
        const tgt = op.target;
        const isTheory = comps.some((c) => c.id === tgt);
        const isKicad = kis.some((k) => k.refDes === tgt);
        if (!isTheory && !isKicad) continue;

        if (op.op === "set-value") {
          if (isTheory) comps = comps.map((c) => (c.id === tgt ? { ...c, value: op.value } : c));
          else kis = kis.map((k) => (k.refDes === tgt ? { ...k, value: op.value } : k));
          applied++;
        } else if (op.op === "rename") {
          if (isTheory) comps = comps.map((c) => (c.id === tgt ? { ...c, id: op.refDes } : c));
          else kis = kis.map((k) => (k.refDes === tgt ? { ...k, refDes: op.refDes } : k));
          applied++;
        } else if (op.op === "delete") {
          if (isTheory) {
            const c = comps.find((x) => x.id === tgt)!;
            for (const name of PIN_NAMES[c.type] ?? []) {
              const p = pinWorldPos(c, name);
              deletedPinKeys.add(`${p.x},${p.y}`);
            }
            comps = comps.filter((x) => x.id !== tgt);
          } else {
            const k = kis.find((x) => x.refDes === tgt)!;
            const part = getCachedPart(k.partId);
            if (part) for (const pin of part.pins) {
              const p = kicadPinWorldPos(k, pin);
              deletedPinKeys.add(`${p.x},${p.y}`);
            }
            kis = kis.filter((x) => x.refDes !== tgt);
          }
          applied++;
        }
      }

      // A deleted component's wires/labels would otherwise dangle — drop the ones
      // anchored to its pins.
      if (deletedPinKeys.size > 0) {
        wrs = wrs.filter((w) => {
          const a = w.vertices[0];
          const b = w.vertices[w.vertices.length - 1];
          return !(deletedPinKeys.has(`${a.x},${a.y}`) || deletedPinKeys.has(`${b.x},${b.y}`));
        });
        lbls = lbls.filter((l) => !deletedPinKeys.has(`${l.position.x},${l.position.y}`));
      }

      setComponents(comps);
      setKicadComponents(kis);
      setWires(wrs);
      setNetLabels(lbls);
      setSelectedId(null);
      setSelectedKicadId(null);

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: prompt },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.note || (applied > 0 ? `Applied ${applied} edit(s).` : "No edits applied."),
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Edit failed";
      setGenError(msg);
      setTimeout(() => setGenError(null), 6000);
    } finally {
      setIsEditing(false);
    }
  }

  async function handleRunSim() {
    if (simLoading) return;
    setSimLoading(true);
    setSimError(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: { components, wires, netLabels }, analysis: analysisConfig }),
      });
      const data = await res.json() as SimResult & { ok?: boolean; error?: string; details?: string };
      if (!res.ok || data.error) {
        setSimError(data.error ?? "Simulation failed");
        return;
      }
      setSimResult(data);
      // Only auto-create a pane when the user has none yet; otherwise keep
      // their pane layout intact across re-runs.
      if (panes.length === 0) {
        const defaultProbe = pickDefaultSignal(data.variables, data.analysisType);
        const pane: Pane = {
          id: crypto.randomUUID(),
          signals: new Set(defaultProbe ? [defaultProbe] : []),
        };
        console.log("[sim] received", data.variables.length, "variables; auto-probing:", defaultProbe ?? "(none)");
        setPanes([pane]);
        setActivePaneId(pane.id);
      }
      setChartPanelOpen(true);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setSimLoading(false);
    }
  }

  const selectedComp = selectedId
    ? components.find((c) => c.id === selectedId) ?? null
    : null;

  const selectedKicad = selectedKicadId
    ? kicadComponents.find((k) => k.id === selectedKicadId) ?? null
    : null;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* ── Header ── */}
      <header className="h-12 border-b border-zinc-800 flex items-center px-3 gap-3 shrink-0">
        <div className="flex items-center gap-2 pr-3 border-r border-zinc-800 h-12 -my-px">
          <div className="size-6 rounded bg-gradient-to-br from-teal-400 to-cyan-700" />
          <span className="font-medium text-zinc-100">sirkit</span>
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 ml-1">preview</Badge>
        </div>

        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded p-0.5">
          <button
            onClick={() => setMode("theory")}
            className={`text-xs px-3 py-1 rounded-sm transition ${
              mode === "theory" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >Theory</button>
          <button
            onClick={() => setMode("build")}
            className={`text-xs px-3 py-1 rounded-sm transition ${
              mode === "build" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >Build</button>
        </div>

        <div className="text-sm text-zinc-500">/</div>
        <div className="text-sm">LED dimmer (9V)</div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm" variant="ghost" className="gap-1.5 text-zinc-300"
            onClick={() => { setView("sim"); handleRunSim(); }}
            disabled={simLoading}
          >
            {simLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {simLoading ? "Running…" : "Run sim"}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5 text-zinc-300">
            <Download className="size-3.5" /> Export
          </Button>
          <Button
            size="sm" variant="ghost"
            onClick={() => setChatOpen((o) => !o)}
            className={`gap-1.5 ${chatOpen ? "text-teal-400" : "text-zinc-300"}`}
            title="Toggle AI chat"
          >
            <MessageSquare className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="text-zinc-300">
            <Settings className="size-3.5" />
          </Button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex min-h-0">
        {/* Activity Bar */}
        <nav className="w-12 border-r border-zinc-800 flex flex-col items-center py-2 gap-1 shrink-0 bg-zinc-950">
          <ActivityBarButton icon={FolderOpen}    label="Projects"  active={leftPanel === "projects"} onClick={() => toggleLeftPanel("projects")} />
          <ActivityBarButton icon={Package}       label={mode === "theory" ? "Theory Library" : "Build Library"} active={leftPanel === "library"}  onClick={() => toggleLeftPanel("library")} />
          <ActivityBarButton icon={MessageSquare} label="AI Chat"   active={chatOpen}                 onClick={() => setChatOpen((o) => !o)} />
        </nav>

        {/* Left Sidebar */}
        {leftPanel !== null && (
          <aside className="border-r border-zinc-800 flex flex-col shrink-0 relative z-20" style={{ width: leftPanelWidth }}>
            {leftPanel === "projects" ? (
              <>
                <div className="p-3 border-b border-zinc-800">
                  <Button variant="secondary" size="sm" className="w-full justify-start gap-2">
                    <Plus className="size-3.5" /> New project
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="px-2 pb-3">
                    <div className="text-xs text-zinc-500 px-2 py-1.5">Recent</div>
                    <ProjectTreeItem name="LED dimmer (9V)" active />
                    <ProjectTreeItem name="555 timer blinker" />
                    <ProjectTreeItem name="USB-C charger" />
                    <Separator className="my-2 bg-zinc-800" />
                    <div className="text-xs text-zinc-500 px-2 py-1.5">Pinned</div>
                    <ProjectTreeItem name="Audio preamp" />
                    <ProjectTreeItem name="Solar charger" />
                  </div>
                </ScrollArea>
              </>
            ) : mode === "build" ? (
              <BuildLibraryPanel onSelectForPlacement={startKicadPlacement} />
            ) : (
              <>
                <div className="p-3 border-b border-zinc-800">
                  <div className="text-xs text-zinc-500 mb-2">
                    {mode === "theory" ? "Theory Library" : "Build Library"}
                  </div>
                  <div className="relative">
                    <Search className="size-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
                    <Input
                      placeholder={mode === "theory" ? "Search primitives" : "Search real parts"}
                      className="pl-7 border-zinc-800 bg-zinc-900"
                    />
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  {mode === "theory" ? (
                    <div className="p-2 space-y-1">
                      {theoryParts.map((part) => {
                        const mapping = SCH_PART_MAP[part.label];
                        return (
                          <TheoryPartRow
                            key={part.label}
                            icon={part.icon}
                            label={part.label}
                            note={part.note}
                            shortcut={part.shortcut}
                            disabled={mapping === null}
                            onPlace={mapping ? () => addComponent(mapping.type) : undefined}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-2 space-y-1">
                      {buildCategories.map((item) => (
                        <BuildCategoryRow key={item.label} label={item.label} count={item.count} />
                      ))}
                    </div>
                  )}
                </ScrollArea>
                <div className="p-3 border-t border-zinc-800 bg-zinc-900/40">
                  <div className="text-xs text-zinc-500 mb-2">Design checks</div>
                  <div className="space-y-1.5 text-xs">
                    <CheckRow ok label="No floating nets" />
                    <CheckRow ok label="Supply rails connected" />
                    <CheckRow label="BOM not finalized" />
                  </div>
                </div>
              </>
            )}
          </aside>
        )}

        {/* Left panel drag handle */}
        {leftPanel !== null && (
          <div
            onMouseDown={(e) => startDrag("left", e)}
            className="w-1 shrink-0 relative flex items-center justify-center cursor-col-resize group bg-zinc-800 hover:bg-teal-500/60 transition-colors"
          >
            <div className="absolute flex flex-col items-center gap-0.5 pointer-events-none">
              <ChevronLeft  className="size-2.5 text-zinc-600 group-hover:text-teal-300 transition-colors" />
              <ChevronRight className="size-2.5 text-zinc-600 group-hover:text-teal-300 transition-colors" />
            </div>
          </div>
        )}

        {/* Main Content */}
        {!chatFullscreen && (
          <main className="flex-1 flex flex-col min-w-0">
            <div className="h-10 border-b border-zinc-800 flex items-center px-2 gap-1 shrink-0">
              <ViewTab icon={Cable}        label="Schematic" active={view === "schematic"} onClick={() => setView("schematic")} />
              <ViewTab icon={CircuitBoard} label="PCB"       active={view === "pcb"}       onClick={() => setView("pcb")} />
              <ViewTab icon={Box}          label="3D"        active={view === "3d"}        onClick={() => setView("3d")} />
              <ViewTab icon={Receipt}      label="BOM"       active={view === "bom"}       onClick={() => setView("bom")} />
              <ViewTab icon={Activity}     label="Sim"       active={view === "sim"}       onClick={() => setView("sim")} />
            </div>

            <div className="flex-1 min-h-0 relative">
              {view === "schematic" ? (
                <>
                  <SchematicEditor
                    tool={tool} setTool={setTool}
                    components={components} setComponents={setComponents}
                    wires={wires} setWires={setWires}
                    selectedId={selectedId} setSelectedId={setSelectedId}
                    wireDraftStart={wireDraftStart} setWireDraftStart={setWireDraftStart}
                    placementRotation={placementRotation}
                    kicadComponents={kicadComponents} setKicadComponents={setKicadComponents}
                    selectedKicadId={selectedKicadId} setSelectedKicadId={setSelectedKicadId}
                    placementPartId={placementPartId}
                    netLabels={netLabels} setNetLabels={setNetLabels}
                    pendingNetLabel={pendingNetLabel} setPendingNetLabel={setPendingNetLabel}
                  />
                  {/* Empty state overlay */}
                  {components.length === 0 && wires.length === 0 && kicadComponents.length === 0 && netLabels.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none select-none">
                      <Sparkles className="size-8 text-zinc-700" />
                      <p className="text-zinc-400 text-sm">Empty schematic</p>
                      <p className="text-zinc-500 text-xs text-center max-w-xs">
                        Describe a circuit above, or pick a tool from the toolbar to place components manually.
                      </p>
                    </div>
                  )}
                  {selectedComp && (
                    <PropertiesPanel
                      comp={selectedComp}
                      onValueChange={(v) =>
                        setComponents((cs) =>
                          cs.map((c) => c.id === selectedId ? { ...c, value: v } : c)
                        )
                      }
                      onRotationChange={(r) =>
                        setComponents((cs) =>
                          cs.map((c) => c.id === selectedId ? { ...c, rotation: r } : c)
                        )
                      }
                      onDelete={() => {
                        setComponents((cs) => cs.filter((c) => c.id !== selectedId));
                        setSelectedId(null);
                      }}
                    />
                  )}
                  {selectedKicad && (
                    <KicadPropertiesPanel
                      instance={selectedKicad}
                      onRefDesChange={(v) =>
                        setKicadComponents((ks) => ks.map((k) => k.id === selectedKicadId ? { ...k, refDes: v } : k))
                      }
                      onValueChange={(v) =>
                        setKicadComponents((ks) => ks.map((k) => k.id === selectedKicadId ? { ...k, value: v } : k))
                      }
                      onRotate={() =>
                        setKicadComponents((ks) => ks.map((k) =>
                          k.id === selectedKicadId
                            ? { ...k, rotation: ((k.rotation + 90) % 360) as 0 | 90 | 180 | 270 }
                            : k))
                      }
                      onDelete={() => {
                        setKicadComponents((ks) => ks.filter((k) => k.id !== selectedKicadId));
                        setSelectedKicadId(null);
                      }}
                      onReplace={() => { setMode("build"); setLeftPanel("library"); }}
                    />
                  )}
                </>
              ) : view === "sim" ? (
                <SimView
                  components={components}
                  wires={wires}
                  netLabels={netLabels}
                  setNetLabels={setNetLabels}
                  simResult={simResult}
                  simLoading={simLoading}
                  simError={simError}
                  panes={panes}
                  setPanes={setPanes}
                  activePaneId={activePaneId}
                  setActivePaneId={setActivePaneId}
                  onRunSim={handleRunSim}
                  simMode={simMode}
                  setSimMode={setSimMode}
                  setComponents={setComponents}
                  setWires={setWires}
                  chartPanelOpen={chartPanelOpen}
                  setChartPanelOpen={setChartPanelOpen}
                  analysisConfig={analysisConfig}
                  setAnalysisConfig={setAnalysisConfig}
                />
              ) : view === "bom" ? (
                <BomView components={components} kicadComponents={kicadComponents} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm select-none">
                  {view === "pcb"       && "PCB layout canvas"}
                  {view === "3d"        && "3D view"}
                </div>
              )}
            </div>
          </main>
        )}

        {/* Drag handle between main and chat */}
        {chatOpen && !chatFullscreen && (
          <div
            onMouseDown={(e) => startDrag("right", e)}
            className="w-1 shrink-0 relative flex items-center justify-center cursor-col-resize group bg-zinc-800 hover:bg-teal-500/60 transition-colors"
          >
            <div className="absolute flex flex-col items-center gap-0.5 pointer-events-none">
              <ChevronLeft  className="size-2.5 text-zinc-600 group-hover:text-teal-300 transition-colors" />
              <ChevronRight className="size-2.5 text-zinc-600 group-hover:text-teal-300 transition-colors" />
            </div>
          </div>
        )}

        {/* Confirmation dialog for replacing existing schematic */}
        <Dialog
          open={pendingReplace !== null}
          onOpenChange={(open) => { if (!open) setPendingReplace(null); }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Replace the current schematic?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-zinc-400">This will replace all existing components and wires.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingReplace(null)}>Cancel</Button>
              <Button onClick={() => {
                if (pendingReplace) {
                  applySchematic(pendingReplace.state, pendingReplace.explanation, pendingReplace.prompt);
                  setPendingReplace(null);
                }
              }}>Replace</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Right Chat Panel */}
        {chatOpen && (
          <aside
            className="border-l border-zinc-800 shrink-0 flex flex-col min-h-0"
            style={{ width: chatFullscreen ? undefined : chatWidth, flex: chatFullscreen ? "1 1 0" : undefined }}
          >
            <div className="h-10 border-b border-zinc-800 flex items-center px-3 shrink-0 gap-2">
              <span className="text-xs text-zinc-400 font-medium flex-1">AI Chat</span>
              <button
                onClick={() => setChatFullscreen((f) => !f)}
                title={chatFullscreen ? "Restore" : "Maximize"}
                className="text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                {chatFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-3 py-4 space-y-3">
                {messages.length === 0 && (
                  <p className="text-xs text-zinc-600 text-center pt-6">
                    Describe a circuit to get started.
                  </p>
                )}
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {loading && messages.at(-1)?.role === "assistant" && messages.at(-1)?.content === "" && (
                  <div className="flex justify-start">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-500">
                      Thinking…
                    </div>
                  </div>
                )}
              </div>
            </div>

            {genError && (
              <div className="px-3 py-1.5 text-xs text-red-400 border-t border-zinc-800 shrink-0">
                {genError}
              </div>
            )}
            <div className="border-t border-zinc-800 p-3">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                className="min-h-20 resize-none border-zinc-800 bg-zinc-900/60 text-sm"
                placeholder={mode === "build"
                  ? "Ask, edit (e.g. 'set R1 to 4.7k'), or describe a circuit to Generate"
                  : "Ask, edit (e.g. 'set R1 to 4.7k'), or describe a circuit to Generate"}
                disabled={loading || isGenerating || isEditing}
              />
              <div className="flex items-center justify-between mt-2 gap-2">
                <div className="text-xs text-zinc-500">Enter to ask · ⇧Enter newline</div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!input.trim() || loading || isGenerating || isEditing}
                    onClick={send}
                  >
                    {loading ? "…" : "Ask"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={components.length === 0 && kicadComponents.length === 0
                      ? "Generate a schematic first"
                      : "Apply an attribute edit (set value, rename, delete) to the current schematic"}
                    disabled={
                      !input.trim() || loading || isGenerating || isEditing ||
                      (components.length === 0 && kicadComponents.length === 0)
                    }
                    onClick={() => { const t = input; setInput(""); handleEditSchematic(t); }}
                  >
                    {isEditing ? "Editing…" : "Edit"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!input.trim() || loading || isGenerating || isEditing}
                    onClick={() => { const t = input; setInput(""); handleGenerateSchematic(t); }}
                  >
                    {isGenerating ? "Generating…" : "Generate"}
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// ─── Simulation view ──────────────────────────────────────────────────────────

function WaveformChart({
  points, variables, probedSignals, analysisType,
}: {
  points: Record<string, number>[];
  variables: string[];
  probedSignals: Set<string>;
  analysisType: AnalysisType;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 200 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pick the swept (x) variable per analysis type.
  const xVar =
    analysisType === "ac"   ? "frequency"
  : analysisType === "tran" ? "time"
  : analysisType === "dc"   ? variables[0]
  :                            null;
  const logX = analysisType === "ac";

  // Recharts-style: filter signals to ones in the result.
  const probed = [...probedSignals].filter((s) => variables.includes(s));

  const W = size.w, H = size.h;
  const ML = 56, MR = 16, MT = 12, MB = 28;
  const plotW = Math.max(1, W - ML - MR);
  const plotH = Math.max(1, H - MT - MB);

  if (!xVar || probed.length === 0 || points.length === 0) {
    return (
      <div ref={wrapRef} className="w-full h-full flex items-center justify-center text-zinc-600 text-xs select-none px-4 text-center">
        {points.length === 0
          ? "No data — re-run the simulation"
          : "Click a wire or component to probe a signal in this pane"}
      </div>
    );
  }

  // Y axis label depends on AC signal kind.
  let yLabel = "V";
  if (analysisType === "ac") {
    const hasMag   = probed.some((s) => s.endsWith(".mag"));
    const hasPhase = probed.some((s) => s.endsWith(".phase"));
    yLabel = hasMag && !hasPhase ? "Magnitude (dB)"
           : hasPhase && !hasMag ? "Phase (deg)"
           : "Mixed";
  }
  const xLabel =
    analysisType === "ac"   ? "Frequency (Hz)"
  : analysisType === "dc"   ? `Sweep: ${xVar}`
  :                            "Time (s)";

  // X range.
  const xValsAll = points.map((p) => p[xVar] ?? 0);
  let xMin: number, xMax: number;
  if (logX) {
    const pos = xValsAll.filter((v) => v > 0);
    xMin = pos.length ? Math.min(...pos) : 1;
    xMax = pos.length ? Math.max(...pos) : 10;
  } else {
    xMin = Math.min(...xValsAll);
    xMax = Math.max(...xValsAll);
  }
  if (xMin === xMax) { xMin -= 1; xMax += 1; }

  // Y range across all probed signals.
  const allY: number[] = [];
  for (const sig of probed) for (const p of points) {
    const v = p[sig];
    if (typeof v === "number" && isFinite(v)) allY.push(v);
  }
  let yMin = allY.length ? Math.min(...allY) : 0;
  let yMax = allY.length ? Math.max(...allY) : 1;
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.05;
  yMin -= yPad; yMax += yPad;

  // Coord mappers.
  const lMin = logX ? Math.log10(xMin) : xMin;
  const lMax = logX ? Math.log10(xMax) : xMax;
  function px(x: number): number {
    const v = logX ? Math.log10(Math.max(x, 1e-30)) : x;
    return ML + ((v - lMin) / (lMax - lMin || 1)) * plotW;
  }
  function py(y: number): number {
    return MT + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;
  }

  // Ticks.
  function linspace(a: number, b: number, n: number): number[] {
    return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
  }
  function logDecadeTicks(a: number, b: number): number[] {
    const ticks: number[] = [];
    const start = Math.floor(Math.log10(a));
    const end   = Math.ceil(Math.log10(b));
    for (let e = start; e <= end; e++) {
      const v = Math.pow(10, e);
      if (v >= a / 1.001 && v <= b * 1.001) ticks.push(v);
    }
    return ticks;
  }
  const xTicks = logX ? logDecadeTicks(xMin, xMax) : linspace(xMin, xMax, 5);
  const yTicks = linspace(yMin, yMax, 5);

  // Range-aware tick formatters: pick decimal count from the data domain so
  // adjacent ticks never collapse to the same string (the "12.0, 12.0, 12.0"
  // bug for tight ranges around a non-zero baseline).
  const fmtX = rangeAwareTickFormatter([xMin, xMax]);
  const fmtY = rangeAwareTickFormatter([yMin, yMax]);

  return (
    <div ref={wrapRef} className="w-full h-full">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <rect width={W} height={H} fill="#09090b" />

        {/* y grid + tick labels */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={ML} x2={W - MR} y1={py(t)} y2={py(t)} stroke="#27272a" strokeWidth={0.5} />
            <text x={ML - 6} y={py(t) + 3.5} textAnchor="end" fontSize={10} fontFamily="monospace" fill="#71717a">
              {fmtY(t)}
            </text>

          </g>
        ))}

        {/* x grid + tick labels */}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={px(t)} x2={px(t)} y1={MT} y2={H - MB} stroke="#27272a" strokeWidth={0.5} />
            <text x={px(t)} y={H - MB + 12} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#71717a">
              {fmtX(t)}
            </text>
          </g>
        ))}

        {/* axes */}
        <line x1={ML} y1={MT} x2={ML} y2={H - MB} stroke="#52525b" strokeWidth={1} />
        <line x1={ML} y1={H - MB} x2={W - MR} y2={H - MB} stroke="#52525b" strokeWidth={1} />

        {/* signal paths */}
        {probed.map((sig, si) => {
          const color = PROBE_COLORS[si % PROBE_COLORS.length];
          let d = "";
          let started = false;
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const xv = p[xVar];
            const yv = p[sig];
            if (typeof xv !== "number" || typeof yv !== "number") continue;
            if (logX && xv <= 0) continue;
            const x = px(xv).toFixed(2);
            const y = py(yv).toFixed(2);
            d += `${started ? "L" : "M"}${x},${y}`;
            started = true;
          }
          return <path key={sig} d={d} stroke={color} strokeWidth={1.5} fill="none" />;
        })}

        {/* legend */}
        {probed.map((sig, si) => {
          const color = PROBE_COLORS[si % PROBE_COLORS.length];
          const ly = MT + 14 + si * 14;
          return (
            <g key={`l-${sig}`}>
              <line x1={ML + 8} y1={ly} x2={ML + 24} y2={ly} stroke={color} strokeWidth={2} />
              <text x={ML + 28} y={ly + 3.5} fontSize={10} fontFamily="monospace" fill={color}>
                {sig}
              </text>
            </g>
          );
        })}

        {/* axis labels */}
        <text x={ML + plotW / 2} y={H - 6} textAnchor="middle"
          fontSize={10} fontFamily="monospace" fill="#52525b">
          {xLabel}
        </text>
        <text x={14} y={MT + plotH / 2} textAnchor="middle"
          fontSize={10} fontFamily="monospace" fill="#52525b"
          transform={`rotate(-90, 14, ${MT + plotH / 2})`}>
          {yLabel}
        </text>
      </svg>
    </div>
  );
}

function OpTable({
  points, variables, probedSignals,
}: {
  points: Record<string, number>[];
  variables: string[];
  probedSignals: Set<string>;
}) {
  if (points.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs select-none">
        No data
      </div>
    );
  }
  const row = points[0];
  // Empty pane → show full operating point; otherwise filter to probed.
  const rows = probedSignals.size === 0
    ? variables
    : variables.filter((v) => probedSignals.has(v));

  if (rows.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs select-none px-4 text-center">
        Click a wire or component to probe a value in this pane
      </div>
    );
  }
  return (
    <div className="w-full h-full overflow-auto">
      <table className="w-full text-xs font-mono">
        <thead className="sticky top-0 bg-zinc-900 text-zinc-500 border-b border-zinc-800">
          <tr>
            <th className="text-left  px-3 py-1.5 font-normal">Variable</th>
            <th className="text-right px-3 py-1.5 font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const cell = row[v];
            return (
              <tr key={v} className="border-b border-zinc-900/60">
                <td className="px-3 py-1 text-zinc-300">{v}</td>
                <td className="px-3 py-1 text-zinc-200 text-right">
                  {typeof cell === "number" ? cell.toExponential(6) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProbeSchematic({
  components,
  wires,
  netLabels,
  probedSignals,
  pinNodes,
  onToggleProbe,
  mode,
  setComponents,
  setWires,
  setNetLabels,
}: {
  components: SchComponent[];
  wires: Wire[];
  netLabels: NetLabel[];
  probedSignals: Set<string>;
  pinNodes: Record<string, string>;
  onToggleProbe: (signal: string) => void;
  mode: SimMode;
  setComponents: Dispatch<SetStateAction<SchComponent[]>>;
  setWires: Dispatch<SetStateAction<Wire[]>>;
  setNetLabels: Dispatch<SetStateAction<NetLabel[]>>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan]   = useState<Point>({ x: 80, y: 60 });
  const [zoom, setZoom] = useState(0.9);
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
  const [hoveredPin,    setHoveredPin]    = useState<string | null>(null);

  const panRef  = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current  = pan;
  zoomRef.current = zoom;

  const componentsRef    = useRef(components);
  const wiresRef         = useRef(wires);
  const netLabelsRef     = useRef(netLabels);
  componentsRef.current  = components;
  wiresRef.current       = wires;
  netLabelsRef.current   = netLabels;

  const setComponentsRef = useRef(setComponents);
  const setWiresRef      = useRef(setWires);
  const setNetLabelsRef  = useRef(setNetLabels);
  setComponentsRef.current = setComponents;
  setWiresRef.current      = setWires;
  setNetLabelsRef.current  = setNetLabels;

  const isPanning = useRef(false);
  const panStart  = useRef<{ mouse: Point; pan: Point }>({ mouse: { x: 0, y: 0 }, pan: { x: 0, y: 0 } });

  const moveDragRef = useRef<{
    groupCompIds: Set<string>;
    groupWireIds: Set<string>;
    groupLabelIds: Set<string>;
    initComps: Map<string, { x: number; y: number }>;
    initWires: Map<string, Point[]>;
    initLabels: Map<string, Point>;
    startWorld: Point;
  } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((z) => {
        const nz = Math.min(4, Math.max(0.2, z * factor));
        setPan((p) => ({ x: mx - (mx - p.x) * (nz / z), y: my - (my - p.y) * (nz / z) }));
        return nz;
      });
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (isPanning.current) {
        setPan({
          x: panStart.current.pan.x + (e.clientX - panStart.current.mouse.x),
          y: panStart.current.pan.y + (e.clientY - panStart.current.mouse.y),
        });
      }
      if (moveDragRef.current) {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const wx = (e.clientX - rect.left  - panRef.current.x) / zoomRef.current;
        const wy = (e.clientY - rect.top   - panRef.current.y) / zoomRef.current;
        const { groupCompIds, groupWireIds, groupLabelIds, initComps, initWires, initLabels, startWorld } = moveDragRef.current;
        const dx = Math.round((wx - startWorld.x) / 10) * 10;
        const dy = Math.round((wy - startWorld.y) / 10) * 10;
        setComponentsRef.current((prev) =>
          prev.map((c) => {
            const init = initComps.get(c.id);
            return (groupCompIds.has(c.id) && init) ? { ...c, x: init.x + dx, y: init.y + dy } : c;
          })
        );
        setWiresRef.current((prev) =>
          prev.map((w) => {
            const init = initWires.get(w.id);
            return (groupWireIds.has(w.id) && init) ? { ...w, vertices: init.map((v) => ({ x: v.x + dx, y: v.y + dy })) } : w;
          })
        );
        setNetLabelsRef.current((prev) =>
          prev.map((l) => {
            const init = initLabels.get(l.id);
            return (groupLabelIds.has(l.id) && init) ? { ...l, position: { x: init.x + dx, y: init.y + dy } } : l;
          })
        );
      }
    }
    function onUp() {
      isPanning.current = false;
      moveDragRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  function onSvgDown(e: React.MouseEvent) {
    if (e.button !== 0 || e.target !== svgRef.current) return;
    isPanning.current = true;
    panStart.current = { mouse: { x: e.clientX, y: e.clientY }, pan: { ...panRef.current } };
  }

  function onCompMoveStart(e: React.MouseEvent, comp: SchComponent) {
    e.stopPropagation();
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const wx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
    const wy = (e.clientY - rect.top  - panRef.current.y) / zoomRef.current;
    const group = findConnectedGroup(
      { kind: "component", id: comp.id },
      componentsRef.current,
      wiresRef.current,
      [],
      netLabelsRef.current,
    );
    const initComps = new Map<string, { x: number; y: number }>();
    const initWires = new Map<string, Point[]>();
    const initLabels = new Map<string, Point>();
    for (const id of group.componentIds) {
      const c = componentsRef.current.find((c) => c.id === id);
      if (c) initComps.set(id, { x: c.x, y: c.y });
    }
    for (const id of group.wireIds) {
      const w = wiresRef.current.find((w) => w.id === id);
      if (w) initWires.set(id, w.vertices.map((v) => ({ ...v })));
    }
    for (const id of group.netLabelIds) {
      const l = netLabelsRef.current.find((l) => l.id === id);
      if (l) initLabels.set(id, { ...l.position });
    }
    moveDragRef.current = {
      groupCompIds: group.componentIds,
      groupWireIds: group.wireIds,
      groupLabelIds: group.netLabelIds,
      initComps,
      initWires,
      initLabels,
      startWorld: { x: wx, y: wy },
    };
  }

  function handleBodyClick(e: React.MouseEvent, comp: SchComponent) {
    e.stopPropagation();
    const key = compProbeKey(comp);
    if (key) onToggleProbe(key);
  }

  function handlePinClick(e: React.MouseEvent, comp: SchComponent, off: Point) {
    e.stopPropagation();
    const rot = rotatePoint(off, comp.rotation);
    const nd  = pinNodes[`${Math.round(comp.x + rot.x)},${Math.round(comp.y + rot.y)}`];
    if (nd && nd !== "0") onToggleProbe(`v(${nd.toLowerCase()})`);
  }

  function handleWireClick(e: React.MouseEvent, wire: Wire) {
    e.stopPropagation();
    // Spec: clicking ANY pixel along a wire adds that net's voltage —
    // including ground (v(0) is a flat-zero reference trace).
    for (const v of wire.vertices) {
      const nd = pinNodes[`${Math.round(v.x)},${Math.round(v.y)}`];
      if (nd) { onToggleProbe(`v(${nd.toLowerCase()})`); return; }
    }
  }

  const probeList = [...probedSignals];

  // Probe number badge positions (world coords, computed before render)
  type Marker = { signal: string; x: number; y: number };
  const markers: Marker[] = [];
  const markerSeen = new Set<string>();

  for (const comp of components) {
    const key = compProbeKey(comp);
    if (key && probedSignals.has(key) && !markerSeen.has(key)) {
      markerSeen.add(key);
      const bb = COMP_BBOX[comp.type];
      markers.push({ signal: key, x: comp.x + bb.x + bb.w + 10, y: comp.y + bb.y - 6 });
    }
    for (const [, off] of Object.entries(PROBE_PIN_OFFSETS[comp.type] ?? {})) {
      const rot = rotatePoint(off, comp.rotation);
      const wx  = Math.round(comp.x + rot.x);
      const wy  = Math.round(comp.y + rot.y);
      const nd  = pinNodes[`${wx},${wy}`];
      if (!nd || nd === "0") continue;
      const sig = `v(${nd.toLowerCase()})`;
      if (probedSignals.has(sig) && !markerSeen.has(sig)) {
        markerSeen.add(sig);
        markers.push({ signal: sig, x: wx + 14, y: wy - 14 });
      }
    }
  }
  for (const wire of wires) {
    const mid = wire.vertices[Math.floor(wire.vertices.length / 2)] ?? wire.vertices[0];
    if (!mid) continue;
    for (const v of wire.vertices) {
      const nd = pinNodes[`${Math.round(v.x)},${Math.round(v.y)}`];
      if (!nd || nd === "0") continue;
      const sig = `v(${nd.toLowerCase()})`;
      if (probedSignals.has(sig) && !markerSeen.has(sig)) {
        markerSeen.add(sig);
        markers.push({ signal: sig, x: mid.x + 12, y: mid.y - 12 });
      }
      break;
    }
  }

  // Junction dots
  const ptCount = new Map<string, number>();
  for (const w of wires) {
    for (const p of [w.vertices[0], w.vertices[w.vertices.length - 1]]) {
      if (!p) continue;
      ptCount.set(`${p.x},${p.y}`, (ptCount.get(`${p.x},${p.y}`) ?? 0) + 1);
    }
  }
  const junctions: Point[] = [];
  ptCount.forEach((n, k) => {
    if (n >= 3) { const [x, y] = k.split(",").map(Number); junctions.push({ x, y }); }
  });

  console.log("[ProbeSchematic] render", { mode, componentCount: components.length, wireCount: wires.length });

  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      style={{ display: "block", cursor: mode === "move" ? "move" : PROBE_CURSOR }}
      onMouseDown={onSvgDown}
    >
      <defs>
        <pattern
          id="probe-dot-grid"
          x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)}
          width={20 * zoom} height={20 * zoom}
          patternUnits="userSpaceOnUse"
        >
          <circle cx="0" cy="0" r={Math.max(0.4, zoom * 0.7)} fill="rgba(255,255,255,0.07)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#probe-dot-grid)" />

      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
        {/* Wires */}
        {wires.map((wire) => {
          const pts = wire.vertices.map((v) => `${v.x},${v.y}`).join(" ");
          const isHov = hoveredWireId === wire.id;
          let wSig: string | null = null;
          for (const v of wire.vertices) {
            const nd = pinNodes[`${Math.round(v.x)},${Math.round(v.y)}`];
            if (nd && nd !== "0") { wSig = `v(${nd.toLowerCase()})`; break; }
          }
          const wIdx    = wSig ? probeList.indexOf(wSig) : -1;
          const wProbed = wIdx >= 0;
          const wColor  = wProbed ? PROBE_COLORS[wIdx % PROBE_COLORS.length] : "#a1a1aa";
          return (
            <g key={wire.id}>
              {isHov && (
                <polyline points={pts} fill="none" stroke="rgba(20,184,166,0.35)"
                  strokeWidth={8 / zoom} strokeLinecap="round" strokeLinejoin="round"
                  style={{ pointerEvents: "none" }} />
              )}
              <polyline points={pts} fill="none" stroke={wColor}
                strokeWidth={(wProbed ? 2 : 1) / zoom} strokeLinecap="round" strokeLinejoin="round"
                style={{ pointerEvents: "none" }} />
              <polyline points={pts} fill="none" stroke="transparent"
                strokeWidth={12 / zoom} strokeLinecap="round"
                onMouseEnter={() => { if (mode === "probe") setHoveredWireId(wire.id); }}
                onMouseLeave={() => setHoveredWireId((p) => p === wire.id ? null : p)}
                onMouseDown={(e) => { if (mode === "probe") handleWireClick(e, wire); }} />
            </g>
          );
        })}

        {/* Junction dots */}
        {junctions.map((j, i) => (
          <circle key={i} cx={j.x} cy={j.y} r={2.5 / zoom} fill="#a1a1aa" style={{ pointerEvents: "none" }} />
        ))}

        {/* Net labels (read-only in sim view) */}
        {netLabels.map((label) => (
          <NetLabelGlyph
            key={label.id}
            label={label}
            role={label.kind === "ground" ? "ground" : label.kind === "power" ? "power" : "signal"}
            zoom={zoom}
          />
        ))}

        {/* Components */}
        {components.map((comp) => {
          const compKey    = compProbeKey(comp);
          const compIdx    = compKey ? probeList.indexOf(compKey) : -1;
          const compProbed = compIdx >= 0;
          const compColor  = compProbed ? PROBE_COLORS[compIdx % PROBE_COLORS.length] : null;
          // Ground is now probeable too (toggles v(0)).
          const isBodyHov  = mode === "probe" && hoveredCompId === comp.id;
          const canProbe   = compProbeKey(comp) !== null;
          const bb = COMP_BBOX[comp.type];

          return (
            <g key={comp.id} transform={`translate(${comp.x},${comp.y}) rotate(${comp.rotation})`}>
              {/* Body hover halo */}
              {isBodyHov && (
                <rect x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
                  fill="rgba(20,184,166,0.08)" stroke="#14b8a6" strokeWidth={0.75 / zoom} rx={2}
                  style={{ pointerEvents: "none" }} />
              )}
              {/* Probed body ring */}
              {compProbed && compColor && (
                <rect x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
                  fill="none" stroke={compColor} strokeWidth={1.5 / zoom} rx={2}
                  style={{ pointerEvents: "none" }} />
              )}
              {/* Body hit area + shape */}
              <g
                style={{ cursor: mode === "move" ? "grab" : undefined }}
                onMouseEnter={() => { if (mode === "probe" && canProbe) setHoveredCompId(comp.id); }}
                onMouseLeave={() => setHoveredCompId((p) => p === comp.id ? null : p)}
                onMouseDown={
                  mode === "probe" && canProbe ? (e) => handleBodyClick(e, comp)
                  : mode === "move" ? (e) => onCompMoveStart(e, comp)
                  : undefined
                }
              >
                <rect x={bb.x - 4} y={bb.y - 4} width={bb.w + 8} height={bb.h + 8} fill="transparent" />
                {comp.type === "resistor"       && <ResistorSymbol />}
                {comp.type === "capacitor"      && <CapacitorSymbol />}
                {comp.type === "inductor"       && <InductorSymbol />}
                {comp.type === "diode"          && <DiodeSymbol />}
                {comp.type === "voltage-source" && <VoltageSourceSymbol />}
                {comp.type === "current-source" && <CurrentSourceSymbol />}
                {comp.type === "ground"         && <GroundSymbol />}
              </g>
              {/* Value label */}
              {VALUE_LABEL[comp.type] && comp.value && (
                <text x={VALUE_LABEL[comp.type]!.x} y={VALUE_LABEL[comp.type]!.y}
                  textAnchor={VALUE_LABEL[comp.type]!.anchor as "middle" | "start"}
                  fontSize={10} fontFamily="monospace" fill="#71717a"
                  style={{ pointerEvents: "none", userSelect: "none" }}>
                  {comp.value}
                </text>
              )}
              {/* Per-pin hit targets — rendered last so they sit on top of body */}
              {Object.entries(PROBE_PIN_OFFSETS[comp.type] ?? {}).map(([pinName, off]) => {
                const rot    = rotatePoint(off, comp.rotation);
                const nd     = pinNodes[`${Math.round(comp.x + rot.x)},${Math.round(comp.y + rot.y)}`];
                const pinSig = nd && nd !== "0" ? `v(${nd.toLowerCase()})` : null;
                const pinIdx = pinSig ? probeList.indexOf(pinSig) : -1;
                const pinProbed = pinIdx >= 0;
                const pinColor  = pinProbed ? PROBE_COLORS[pinIdx % PROBE_COLORS.length] : null;
                const pinHovKey = `${comp.id}:${pinName}`;
                const isPinHov  = hoveredPin === pinHovKey;
                return (
                  <g key={pinName}>
                    <circle cx={off.x} cy={off.y} r={2}
                      fill={pinProbed ? pinColor! : "#71717a"}
                      style={{ pointerEvents: "none" }} />
                    {isPinHov && (
                      <circle cx={off.x} cy={off.y} r={6 / zoom}
                        fill="none" stroke="#14b8a6" strokeWidth={1.5 / zoom}
                        style={{ pointerEvents: "none" }} />
                    )}
                    {mode === "probe" && pinSig && (
                      <circle cx={off.x} cy={off.y} r={8 / zoom} fill="transparent"
                        onMouseEnter={() => setHoveredPin(pinHovKey)}
                        onMouseLeave={() => setHoveredPin((p) => p === pinHovKey ? null : p)}
                        onMouseDown={(e) => handlePinClick(e, comp, off)} />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Probe number badges in world coords */}
        {markers.map(({ signal, x, y }) => {
          const idx   = probeList.indexOf(signal);
          if (idx < 0) return null;
          const color = PROBE_COLORS[idx % PROBE_COLORS.length];
          const r     = 6 / zoom;
          return (
            <g key={signal} style={{ pointerEvents: "none" }}>
              <circle cx={x} cy={y} r={r} fill={color} />
              <text x={x} y={y + r * 0.38} textAnchor="middle"
                fontSize={r * 1.2} fontFamily="monospace" fill="white">
                {idx + 1}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ─── FloatingPanel ─────────────────────────────────────────────────────────────

type PanelLayout = { x: number; y: number; w: number; h: number };
const PANEL_STORAGE_KEY = "sirkit:simPanel:layout";

function FloatingPanel({
  title,
  containerRef,
  children,
  onClose,
}: {
  title: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const [layout, setLayout] = useState<PanelLayout>(() => {
    try {
      const raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as PanelLayout;
    } catch { /* ignore */ }
    // Landscape default, docked bottom-left (matches LTspice's waveform pane).
    return { x: 16, y: 16, w: 720, h: 280 };
  });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useLayoutEffect(() => {
    if (localStorage.getItem(PANEL_STORAGE_KEY)) return;
    // The container ref is owned by the parent SimView; in React 19 strict mode
    // its .current can be null when this child effect first runs. Poll across
    // a few rAF ticks until the ref attaches AND the container has a height.
    let applied = false;
    let attempts = 0;
    let raf = 0;
    const tick = () => {
      if (applied) return;
      const el = containerRef.current;
      if (el) {
        const { height } = el.getBoundingClientRect();
        if (height > 0) {
          applied = true;
          setLayout((l) => ({ ...l, y: Math.max(16, height - l.h - 16) }));
          return;
        }
      }
      if (++attempts > 30) return;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [containerRef]);

  function persistLayout(l: PanelLayout) {
    setLayout(l);
    try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(l)); } catch { /* ignore */ }
  }

  const dragRef = useRef<{ startMouse: Point; startLayout: PanelLayout } | null>(null);

  function onTitleBarDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startMouse: { x: e.clientX, y: e.clientY }, startLayout: { ...layoutRef.current } };
    function onMove(mv: MouseEvent) {
      if (!dragRef.current || !containerRef.current) return;
      const { startMouse, startLayout } = dragRef.current;
      const cRect = containerRef.current.getBoundingClientRect();
      const nx = Math.max(0, Math.min(cRect.width  - startLayout.w, startLayout.x + mv.clientX - startMouse.x));
      const ny = Math.max(0, Math.min(cRect.height - startLayout.h, startLayout.y + mv.clientY - startMouse.y));
      persistLayout({ ...layoutRef.current, x: nx, y: ny });
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }

  const resizeRef = useRef<{ startMouse: Point; startLayout: PanelLayout } | null>(null);

  function onResizeDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startMouse: { x: e.clientX, y: e.clientY }, startLayout: { ...layoutRef.current } };
    function onMove(mv: MouseEvent) {
      if (!resizeRef.current) return;
      const { startMouse, startLayout } = resizeRef.current;
      const nw = Math.max(360, startLayout.w + mv.clientX - startMouse.x);
      const nh = Math.max(200, startLayout.h + mv.clientY - startMouse.y);
      persistLayout({ ...layoutRef.current, w: nw, h: nh });
    }
    function onUp() {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }

  return (
    <div
      style={{ position: "absolute", left: layout.x, top: layout.y, width: layout.w, height: layout.h, zIndex: 20 }}
      className="flex flex-col bg-zinc-900/95 border border-zinc-700 rounded-md shadow-xl backdrop-blur-sm overflow-hidden"
    >
      <div
        className="h-8 px-3 flex items-center gap-2 shrink-0 border-b border-zinc-800 cursor-move select-none"
        onMouseDown={onTitleBarDown}
      >
        <span className="text-xs text-zinc-400 font-medium flex-1 truncate">{title}</span>
        <GripVertical className="size-3 text-zinc-600 shrink-0" />
        {onClose && (
          <button
            className="ml-1 flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition"
            onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
            title="Close"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={onResizeDown}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-1 right-1 pointer-events-none">
          <path d="M10 0 L10 10 L0 10" fill="none" stroke="#52525b" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}

// ─── SimView ───────────────────────────────────────────────────────────────────

function SimView({
  components, wires, netLabels, setNetLabels, simResult, simLoading, simError,
  panes, setPanes, activePaneId, setActivePaneId,
  onRunSim, simMode, setSimMode, setComponents, setWires,
  chartPanelOpen, setChartPanelOpen,
  analysisConfig, setAnalysisConfig,
}: {
  components: SchComponent[];
  wires: Wire[];
  netLabels: NetLabel[];
  setNetLabels: Dispatch<SetStateAction<NetLabel[]>>;
  simResult: SimResult | null;
  simLoading: boolean;
  simError: string | null;
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  activePaneId: string | null;
  setActivePaneId: Dispatch<SetStateAction<string | null>>;
  onRunSim: () => void;
  simMode: SimMode;
  setSimMode: (m: SimMode) => void;
  setComponents: Dispatch<SetStateAction<SchComponent[]>>;
  setWires: Dispatch<SetStateAction<Wire[]>>;
  chartPanelOpen: boolean;
  setChartPanelOpen: Dispatch<SetStateAction<boolean>>;
  analysisConfig: AnalysisConfig;
  setAnalysisConfig: Dispatch<SetStateAction<AnalysisConfig>>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Visual probe markers reflect ONLY the active pane.
  const activePane    = panes.find((p) => p.id === activePaneId) ?? null;
  const probedSignals = activePane?.signals ?? new Set<string>();

  function toggleProbe(signal: string) {
    if (!activePaneId) {
      const pane: Pane = { id: crypto.randomUUID(), signals: new Set([signal]) };
      setPanes([pane]);
      setActivePaneId(pane.id);
      return;
    }
    setPanes((prev) => prev.map((p) => {
      if (p.id !== activePaneId) return p;
      const next = new Set(p.signals);
      if (next.has(signal)) next.delete(signal);
      else next.add(signal);
      return { ...p, signals: next };
    }));
  }

  function addPane() {
    const pane: Pane = { id: crypto.randomUUID(), signals: new Set() };
    setPanes((prev) => [...prev, pane]);
    setActivePaneId(pane.id);
  }

  function removePane(id: string) {
    const pane = panes.find((p) => p.id === id);
    if (pane && pane.signals.size > 0) {
      if (!window.confirm(`Close pane with ${pane.signals.size} signal(s)?`)) return;
    }
    setPanes((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (id === activePaneId) setActivePaneId(next[0]?.id ?? null);
      return next;
    });
  }

  const panelTitle = simResult ? simResult.analysis : "Waveforms";

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Full-canvas probe schematic — always visible across all analysis types */}
      <div style={{ position: "absolute", inset: 0 }}>
        <ProbeSchematic
          components={components}
          wires={wires}
          netLabels={netLabels}
          probedSignals={probedSignals}
          pinNodes={simResult?.pinNodes ?? {}}
          onToggleProbe={toggleProbe}
          mode={simMode}
          setComponents={setComponents}
          setWires={setWires}
          setNetLabels={setNetLabels}
        />
        {components.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-zinc-600 text-xs select-none">Add components to simulate</span>
          </div>
        )}
      </div>

      {/* Toolbar — kept above the floating panel so it stays accessible
          even if the user drags the panel over it. */}
      <div className="absolute top-2 left-2 z-30 flex items-center gap-0.5 bg-zinc-900/95 border border-zinc-800 rounded px-1 py-0.5 backdrop-blur-sm shadow">
        <button
          title="Probe mode (P)"
          onClick={() => setSimMode("probe")}
          className={`h-6 flex items-center gap-1.5 px-2 rounded text-xs transition ${
            simMode === "probe"
              ? "bg-teal-700/60 text-teal-200"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Crosshair className="size-3.5" />
          <span>Probe</span>
          <span className="bg-zinc-800/80 text-zinc-500 font-mono text-[10px] px-1 rounded">P</span>
        </button>
        <button
          title="Move mode (M)"
          onClick={() => setSimMode("move")}
          className={`h-6 flex items-center gap-1.5 px-2 rounded text-xs transition ${
            simMode === "move"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Move className="size-3.5" />
          <span>Move</span>
          <span className="bg-zinc-800/80 text-zinc-500 font-mono text-[10px] px-1 rounded">M</span>
        </button>

        <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />

        <AnalysisPicker config={analysisConfig} onChange={setAnalysisConfig} />

        <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />

        <button
          onClick={onRunSim}
          disabled={simLoading}
          title="Re-run simulation"
          className="h-6 flex items-center gap-1.5 px-2 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 transition"
        >
          {simLoading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          Re-run
        </button>

        {simError && (
          <>
            <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />
            <span className="text-xs text-red-400 max-w-[160px] truncate" title={simError}>{simError}</span>
          </>
        )}
        {!chartPanelOpen && (
          <>
            <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />
            <button
              onClick={() => setChartPanelOpen(true)}
              className="h-6 flex items-center gap-1.5 px-2 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
            >
              <Activity className="size-3" />
              Waveforms
            </button>
          </>
        )}
      </div>

      {/* Floating waveform panel */}
      {chartPanelOpen && (
        <FloatingPanel title={panelTitle} containerRef={containerRef} onClose={() => setChartPanelOpen(false)}>
          {simResult ? (
            <div className="flex flex-col h-full">
              <PaneTabBar
                panes={panes}
                activePaneId={activePaneId}
                onSelect={setActivePaneId}
                onAdd={addPane}
                onRemove={removePane}
              />
              <div className="flex-1 flex flex-col min-h-0">
                {panes.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs px-4 text-center select-none">
                    Add a pane to plot signals
                  </div>
                ) : panes.map((pane, idx) => (
                  <div
                    key={pane.id}
                    onMouseDown={() => setActivePaneId(pane.id)}
                    className={`flex-1 min-h-0 ${idx > 0 ? "border-t border-zinc-800" : ""} ${
                      pane.id === activePaneId ? "" : "opacity-90"
                    }`}
                  >
                    {simResult.analysisType === "op" ? (
                      <OpTable
                        points={simResult.points}
                        variables={simResult.variables}
                        probedSignals={pane.signals}
                      />
                    ) : (
                      <WaveformChart
                        points={simResult.points}
                        variables={simResult.variables}
                        probedSignals={pane.signals}
                        analysisType={simResult.analysisType}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-700 text-xs select-none px-4 text-center">
              {simLoading ? "Running…" : "Run a simulation to see waveforms"}
            </div>
          )}
        </FloatingPanel>
      )}
    </div>
  );
}

// ─── Multi-pane tab bar ────────────────────────────────────────────────────────

function PaneTabBar({
  panes, activePaneId, onSelect, onAdd, onRemove,
}: {
  panes: Pane[];
  activePaneId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-900/60 shrink-0">
      {panes.map((p, i) => {
        const isActive = p.id === activePaneId;
        const color    = PROBE_COLORS[i % PROBE_COLORS.length];
        return (
          <div
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`flex items-center gap-1.5 h-6 px-2 rounded text-[11px] cursor-pointer transition ${
              isActive
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
            }`}
            title={`Pane ${i + 1}${p.signals.size ? ` — ${p.signals.size} signal(s)` : ""}`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            <span className="font-mono">{i + 1}</span>
            {!isActive && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}
                className="ml-0.5 size-3.5 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                title="Close pane"
              >
                <X className="size-2.5" />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="h-6 px-1.5 rounded text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 flex items-center gap-1 transition"
        title="Add pane"
      >
        <Plus className="size-3" />
        <span>Add pane</span>
      </button>
    </div>
  );
}

// ─── Analysis picker (dropdown + settings popover) ─────────────────────────────

function AnalysisPicker({
  config, onChange,
}: {
  config: AnalysisConfig;
  onChange: (c: AnalysisConfig) => void;
}) {
  const [open, setOpen] = useState<"type" | "settings" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(null);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  function pickType(t: AnalysisType) {
    if (t !== config.type) onChange(DEFAULT_ANALYSIS_CONFIGS[t]);
    setOpen(null);
  }

  return (
    <div ref={wrapRef} className="relative flex items-center gap-0.5">
      <button
        onClick={() => setOpen(open === "type" ? null : "type")}
        className={`h-6 flex items-center gap-1 px-2 rounded text-xs transition ${
          open === "type"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        }`}
        title="Analysis type"
      >
        <span>{ANALYSIS_LABELS[config.type]}</span>
        <ChevronDown className="size-3" />
      </button>
      <button
        onClick={() => setOpen(open === "settings" ? null : "settings")}
        className={`h-6 w-6 flex items-center justify-center rounded transition ${
          open === "settings"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        }`}
        title="Analysis settings"
      >
        <Settings2 className="size-3" />
      </button>

      {open === "type" && (
        <div className="absolute top-full left-0 mt-1 z-30 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded-md shadow-xl py-1">
          {(["tran", "ac", "dc", "op"] as const).map((t) => (
            <button
              key={t}
              onClick={() => pickType(t)}
              className={`w-full text-left px-3 py-1 text-xs transition ${
                config.type === t ? "bg-zinc-800 text-teal-300" : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {ANALYSIS_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {open === "settings" && (
        <div className="absolute top-full left-0 mt-1 z-30 w-64 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl p-3">
          <div className="text-[10px] uppercase text-zinc-500 mb-2 tracking-wide">
            {ANALYSIS_LABELS[config.type]} settings
          </div>
          {config.type === "tran" && (
            <div className="space-y-2">
              <PickerField label="tstep" value={config.tstep}
                onChange={(v) => onChange({ ...config, tstep: v })} />
              <PickerField label="tstop" value={config.tstop}
                onChange={(v) => onChange({ ...config, tstop: v })} />
            </div>
          )}
          {config.type === "ac" && (
            <div className="space-y-2">
              <div>
                <div className="text-[10px] text-zinc-500 mb-1">Sweep</div>
                <div className="flex gap-1">
                  {(["dec", "oct", "lin"] as const).map((s) => (
                    <button key={s}
                      onClick={() => onChange({ ...config, sweep: s })}
                      className={`flex-1 text-[10px] py-1 rounded border transition ${
                        config.sweep === s
                          ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                          : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                      }`}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <PickerField label="points" value={String(config.points)}
                onChange={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n > 0) onChange({ ...config, points: n });
                }} />
              <PickerField label="fstart" value={config.fstart}
                onChange={(v) => onChange({ ...config, fstart: v })} />
              <PickerField label="fstop"  value={config.fstop}
                onChange={(v) => onChange({ ...config, fstop: v })} />
            </div>
          )}
          {config.type === "dc" && (
            <div className="space-y-2">
              <PickerField label="source" value={config.source}
                onChange={(v) => onChange({ ...config, source: v })} />
              <PickerField label="vstart" value={config.vstart}
                onChange={(v) => onChange({ ...config, vstart: v })} />
              <PickerField label="vstop"  value={config.vstop}
                onChange={(v) => onChange({ ...config, vstop: v })} />
              <PickerField label="vstep"  value={config.vstep}
                onChange={(v) => onChange({ ...config, vstep: v })} />
            </div>
          )}
          {config.type === "op" && (
            <p className="text-xs text-zinc-400 leading-relaxed">
              Computes the DC steady-state operating point.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PickerField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-zinc-500 w-14 shrink-0">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 text-xs border-zinc-700 bg-zinc-800 flex-1"
      />
    </div>
  );
}

// ─── Helper components ─────────────────────────────────────────────────────────

function ActivityBarButton({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon; label: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`w-9 h-9 flex items-center justify-center rounded-md transition ${
        active ? "text-zinc-100 bg-zinc-800" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
      }`}
    >
      <Icon className="size-5" />
    </button>
  );
}

function ProjectTreeItem({ name, active }: { name: string; active?: boolean }) {
  return (
    <button className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-md text-left transition ${
      active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
    }`}>
      <ChevronRight className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );
}

function ViewTab({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon; label: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 transition ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed bg-teal-700/60 text-zinc-100 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start w-full">
      <div className="w-full rounded-lg px-3 py-2.5 text-xs leading-relaxed bg-zinc-900 border border-zinc-800 overflow-hidden">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeHighlight, rehypeKatex]}
          components={{
            p:          ({ children }) => <p className="mb-2 last:mb-0 text-zinc-200 leading-relaxed">{children}</p>,
            h1:         ({ children }) => <h1 className="text-sm font-medium text-zinc-100 mt-3 mb-1.5">{children}</h1>,
            h2:         ({ children }) => <h2 className="text-sm font-medium text-zinc-100 mt-3 mb-1.5">{children}</h2>,
            h3:         ({ children }) => <h3 className="text-xs font-medium text-zinc-100 mt-2 mb-1">{children}</h3>,
            ul:         ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5 text-zinc-300">{children}</ul>,
            ol:         ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5 text-zinc-300">{children}</ol>,
            li:         ({ children }) => <li className="text-zinc-300">{children}</li>,
            strong:     ({ children }) => <strong className="font-medium text-zinc-100">{children}</strong>,
            em:         ({ children }) => <em className="text-zinc-200">{children}</em>,
            a:          ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-teal-400 hover:underline">{children}</a>,
            code:       ({ className, children, ...props }) => {
              const isInline = !className?.includes("language-");
              if (isInline) return <code className="bg-zinc-800 text-teal-300 px-1 py-0.5 rounded font-mono text-[11px]">{children}</code>;
              return <code className={`${className ?? ""} font-mono text-[11px]`} {...props}>{children}</code>;
            },
            pre:        ({ children }) => <pre className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 my-2 overflow-x-auto text-[11px] leading-relaxed">{children}</pre>,
            table:      ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full text-[11px] border border-zinc-800 rounded">{children}</table></div>,
            thead:      ({ children }) => <thead className="bg-zinc-800/40">{children}</thead>,
            th:         ({ children }) => <th className="text-left px-2 py-1 border-b border-zinc-800 font-medium text-zinc-200">{children}</th>,
            td:         ({ children }) => <td className="px-2 py-1 border-t border-zinc-900/60 text-zinc-300">{children}</td>,
            blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>,
            hr:         () => <hr className="my-3 border-zinc-800" />,
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function TheoryPartRow({ icon: Icon, label, note, onPlace, disabled, shortcut }: {
  icon: LucideIcon; label: string; note: string; onPlace?: () => void; disabled?: boolean; shortcut?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onPlace}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition ${
        disabled ? "opacity-40 cursor-not-allowed text-zinc-600" : "hover:bg-zinc-900 cursor-pointer"
      }`}
    >
      <div className="size-6 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
        <Icon className="size-3.5 text-zinc-300" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <div className="text-sm text-zinc-200 truncate">{label}</div>
        <div className="text-xs text-zinc-500 truncate">{note}</div>
      </div>
      {shortcut && (
        <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded shrink-0">{shortcut}</span>
      )}
      {!disabled && <ChevronRight className="size-3.5 text-zinc-600 shrink-0" />}
    </button>
  );
}

function BuildCategoryRow({ label, count }: { label: string; count: number }) {
  return (
    <button className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-900 transition text-sm">
      <span className="text-zinc-300 truncate">{label}</span>
      <Badge variant="outline" className="text-[10px] text-zinc-400">{count.toLocaleString()}</Badge>
    </button>
  );
}

function CheckRow({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-zinc-300">
      {ok
        ? <Check         className="size-3.5 text-emerald-400" />
        : <AlertTriangle className="size-3.5 text-amber-400" />
      }
      <span>{label}</span>
    </div>
  );
}
