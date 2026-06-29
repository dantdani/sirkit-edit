import type {
  Point,
  SchComponent,
  SchComponentType,
  Rotation,
  Wire,
  KicadComponentInstance,
} from "@/lib/schematic-types";
import { PIN_OFFSETS } from "@/lib/schematic-types";
import type { KicadPin, PinOrientation } from "@/app/lib/kicad/types";

// The schematic snaps to a 10-unit grid. Every coordinate the user sees,
// every pin location, every wire vertex lands on a multiple of GRID.
export const GRID = 10;

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export function snapPoint(p: Point): Point {
  return { x: snap(p.x), y: snap(p.y) };
}

export function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Point, b: Point): number {
  return Math.sqrt(distanceSq(a, b));
}

// Exact equality. Callers must supply already-snapped points if they want
// "same grid cell" semantics.
export function pointEquals(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function pointKey(p: Point): string {
  return `${p.x},${p.y}`;
}

// Closest point on an axis-aligned segment to a probe point.
// Wires in sirkit are always axis-aligned (segments are either horizontal
// or vertical), which keeps this trivial: clamp along the moving axis.
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  if (a.x === b.x) {
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return { x: a.x, y: Math.max(lo, Math.min(hi, p.y)) };
  }
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  return { x: Math.max(lo, Math.min(hi, p.x)), y: a.y };
}

// True if p lies strictly inside any segment of the wire (not at any vertex).
export function pointStrictlyOnWireInterior(p: Point, wire: Wire): boolean {
  for (let i = 0; i < wire.vertices.length - 1; i++) {
    const s = wire.vertices[i];
    const e = wire.vertices[i + 1];
    if (s.y === e.y) {
      if (p.y !== s.y) continue;
      const minX = Math.min(s.x, e.x);
      const maxX = Math.max(s.x, e.x);
      if (p.x > minX && p.x < maxX) return true;
    } else {
      if (p.x !== s.x) continue;
      const minY = Math.min(s.y, e.y);
      const maxY = Math.max(s.y, e.y);
      if (p.y > minY && p.y < maxY) return true;
    }
  }
  return false;
}

// ─── Directions ──────────────────────────────────────────────────────────────

export type Direction = "north" | "south" | "east" | "west";

const DIR_ORDER: Direction[] = ["north", "east", "south", "west"];

export function rotateDirection(dir: Direction, deg: Rotation): Direction {
  return DIR_ORDER[(DIR_ORDER.indexOf(dir) + deg / 90) % 4];
}

// Pin direction in the component's LOCAL frame (before rotation).
export const LOCAL_PIN_DIRECTIONS: Record<SchComponentType, Record<string, Direction>> = {
  resistor:         { left:  "west",  right:   "east"  },
  capacitor:        { left:  "west",  right:   "east"  },
  inductor:         { left:  "west",  right:   "east"  },
  diode:            { anode: "west",  cathode: "east"  },
  "voltage-source": { "+":   "north", "-":     "south" },
  "current-source": { "+":   "north", "-":     "south" },
  ground:           { pin:   "north" },
};

function rotateOffset(p: Point, r: Rotation): Point {
  switch (r) {
    case 0:   return { x:  p.x, y:  p.y };
    case 90:  return { x: -p.y, y:  p.x };
    case 180: return { x: -p.x, y: -p.y };
    case 270: return { x:  p.y, y: -p.x };
  }
}

// World position of a component pin, accounting for the component's rotation.
// Returned point is snapped to GRID — pin sites always land on the grid.
export function pinWorldPos(component: SchComponent, pinName: string): Point {
  const off = PIN_OFFSETS[component.type]?.[pinName];
  if (!off) return { x: component.x, y: component.y };
  const rot = rotateOffset(off, component.rotation);
  return snapPoint({ x: component.x + rot.x, y: component.y + rot.y });
}

// "Exit direction" of a pin, accounting for the component's rotation.
export function pinDirection(component: SchComponent, pinName: string): Direction {
  const local = LOCAL_PIN_DIRECTIONS[component.type]?.[pinName] ?? "east";
  return rotateDirection(local, component.rotation);
}

// ─── Pin escape routing (stubs) ────────────────────────────────────────────────
//
// Auto-routed wires must travel a short straight run in the pin's exit direction
// BEFORE their first bend, so a wire never leaves a pin and immediately cuts
// across the component's own adjacent pins (the classic "+5V trace clips
// RESET/IOREF/AREF" artifact). This is standard "pin escape routing": every pin
// gets a minimum perpendicular stub. Two grid cells is long enough to clear a
// neighbouring pin column, short enough not to bloat the layout.
export const STUB_LENGTH = 2 * GRID;

// The point a wire reaches after escaping `length` px straight out of `pin` in
// its exit `dir` — i.e. the first place the route is allowed to bend. Pin sites
// are grid-snapped and STUB_LENGTH is a grid multiple, so the result stays on
// the grid without re-snapping.
export function pinStubEnd(pin: Point, dir: Direction, length: number = STUB_LENGTH): Point {
  switch (dir) {
    case "east":  return { x: pin.x + length, y: pin.y };
    case "west":  return { x: pin.x - length, y: pin.y };
    case "north": return { x: pin.x, y: pin.y - length };
    case "south": return { x: pin.x, y: pin.y + length };
  }
}

// ─── KiCad-sourced components ──────────────────────────────────────────────────

// KiCad symbol coordinates are in millimeters. Standard pin spacing is 2.54mm
// (100 mil). Scaling by 20/2.54 maps 2.54mm → 20px = 2 grid cells, so standard
// pins land on our 10px grid naturally.
export const KICAD_SCALE_PX_PER_MM = 20 / 2.54; // ≈ 7.874

// Rotate a px-space offset by a multiple of 90° (screen coords, y-down).
export function rotateXY(x: number, y: number, deg: Rotation): { x: number; y: number } {
  switch (deg) {
    case 0:   return { x,      y      };
    case 90:  return { x: -y,  y: x   };
    case 180: return { x: -x,  y: -y  };
    case 270: return { x: y,   y: -x  };
  }
}

// World position of a KiCad part pin: local mm → px (KiCad y is inverted vs the
// screen) → rotate → translate to the instance origin, snapped to GRID.
export function kicadPinWorldPos(instance: KicadComponentInstance, pin: KicadPin): Point {
  const px = pin.position.x * KICAD_SCALE_PX_PER_MM;
  const py = -pin.position.y * KICAD_SCALE_PX_PER_MM;
  const r = rotateXY(px, py, instance.rotation);
  return snapPoint({ x: instance.x + r.x, y: instance.y + r.y });
}

// Direction a wire should LEAVE a KiCad part pin, in world (screen, y-down)
// coordinates. `pin.orientation` is the raw KiCad pin angle in y-up symbol
// space, and it points from the pin's wire-attach endpoint back INTO the body —
// the OPPOSITE of where the wire exits. Turning that inward y-up angle into an
// outward y-down screen direction is a single reflection. Verified against real
// symbols: 4069's left inputs are (at -7.62 0 0) → exit west, right outputs
// (at 7.62 0 180) → exit east, VSS (at 0 -12.7 90) → exit south, VDD
// (at 0 12.7 270) → exit north. The instance rotation is then applied in screen
// space, matching kicadPinWorldPos's rotateXY.
const KICAD_LOCAL_EXIT: Record<PinOrientation, Direction> = {
  0:   "west",
  90:  "south",
  180: "east",
  270: "north",
};

export function kicadPinExitDirection(
  instance: KicadComponentInstance,
  pin: KicadPin,
): Direction {
  return rotateDirection(KICAD_LOCAL_EXIT[pin.orientation], instance.rotation);
}
