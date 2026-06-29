# Pin escape routing

**Date**: 2026-06-29
**Status**: Shipped

## What this changed
Auto-routed wires (both Build and Theory modes) now travel a minimum straight
stub (`STUB_LENGTH` = 2 grid cells = 20px) in each pin's natural exit direction
before any bend, and approach the destination pin head-on along its exit axis.
This stops wires from leaving a pin and immediately running along the pin column,
cutting across the component's own adjacent pins — the artifact visible on the
Arduino + barrel-jack circuit, where the +5V trace clipped RESET/IOREF/AREF.

## Modified files (only these three)
- `app/lib/geometry.ts` — added `STUB_LENGTH`, `pinStubEnd(pin, dir, len?)`, and
  `kicadPinExitDirection(instance, pin)`.
- `lib/build-auto-layout.ts` — added `WireEndpoint` + `routeWireEndpoints`;
  `resolvePinEndpoint`; `routeOrFail` and both call sites (signal + ground) now
  route between endpoints carrying an exit direction.
- `lib/auto-layout.ts` — `routeWireAvoiding` now takes the destination pin's
  direction too and escapes both pins via `pinStubEnd` before L/Z routing.

## New exports
- `STUB_LENGTH`, `pinStubEnd`, `kicadPinExitDirection` (geometry.ts)
- `WireEndpoint`, `routeWireEndpoints` (build-auto-layout.ts)

## Deviations from the brief (deliberate)
- Routing lives in top-level `lib/`, not `app/lib/`; only `geometry.ts` is under
  `app/lib/`. Adjusted paths accordingly.
- The KiCad `pin.orientation` is the RAW KiCad angle, which points from the
  wire-attach endpoint back INTO the body — the OPPOSITE of the wire's exit. The
  brief's pseudo-code (`0=east, 90=north…`) would have aimed every stub into the
  component. Verified the real mapping `{0:west,90:south,180:east,270:north}`
  against actual symbols (e.g. 4069: left inputs `(at -7.62 0 0)`→west, right
  outputs `(at 7.62 0 180)`→east, VDD `(at 0 12.7 270)`→north).
- Did NOT add `THEORY_PIN_ORIENTATIONS`: geometry already has
  `LOCAL_PIN_DIRECTIONS` + `pinDirection`, which Theory routing already used.
- Kept `routeWireInfo`/`routeWire` point-based (back-compat); the stub layer
  (`routeWireEndpoints`) wraps them.

## Known limitations
- U-turn (destination behind the source pin's exit) detours around the body —
  longer but clean (crossings 0); not optimized, per the brief.
- A stub landing inside a tightly-packed neighbour can force one extra
  fallback-to-label; safe degradation (the validator/reroute loop still holds).
- `STUB_LENGTH` may want tuning (30/40) on dense boards.

## Verification
- `npx tsc --noEmit`: clean.
- `npx tsx scripts/netlist-validation.test.ts`: 29/29 PASS (no regression).
- Throwaway unit checks (17/17) confirmed the orientation map, rotation
  composition, stub emission, head-on dest approach, no vertical run along the
  pin column, and clean U-turn detours.
- TODO (visual): regenerate the Arduino + barrel-jack circuit, open in KiCad,
  confirm the +5V trace escapes the VIN pin before turning toward the jack.
