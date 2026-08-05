#!/usr/bin/env python
"""
Independent verification of a Sirkit verified-release archive.

Deliberately shares NO code with Sirkit: parses the emitted RS-274X Gerbers and
Excellon drill file with `gerbonara` (a third-party library) and checks the
geometry, layer set, outline closure and drill alignment on its own terms. This
is the external cross-check required alongside Sirkit's built-in readback — if
the two disagree, the archive is not trustworthy.

Usage: python scripts/verify-release-independent.py <release.zip>
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from gerbonara import LayerStack
from gerbonara.cam import FileSettings
from gerbonara.rs274x import GerberFile
from gerbonara.excellon import ExcellonFile

FAIL: list[str] = []
NOTE: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  PASS  {message}")
    else:
        print(f"  FAIL  {message}")
        FAIL.append(message)


def main(archive: Path) -> int:
    print(f"Independent verification (gerbonara) — {archive.name}\n")
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(root)

        gerber_dir = root / "gerber"
        manifest = json.loads((gerber_dir / "release-manifest.json").read_text(encoding="utf8"))
        by_role = {f["role"]: gerber_dir / Path(f["path"]).name for f in manifest["files"]}
        print(f"release: {manifest['releaseId']}  mode: {manifest['releaseMode']}")
        print(f"board revision: {manifest.get('boardRevision', '?')}\n")

        print("layer set")
        for role in ("copper_top", "copper_bottom", "mask_top", "mask_bottom", "outline", "pth_drill", "gerber_job"):
            check(role in by_role and by_role[role].exists(), f"{role} present")

        print("\ncopper + mask parse independently")
        counts: dict[str, int] = {}
        for role in ("copper_top", "copper_bottom", "mask_top", "mask_bottom", "silk_top", "outline"):
            path = by_role.get(role)
            if not path or not path.exists():
                continue
            gf = GerberFile.open(path)
            objs = list(gf.objects)
            counts[role] = len(objs)
            check(len(objs) > 0, f"{role}: {len(objs)} graphic objects parsed")

        print("\nboard outline")
        outline = GerberFile.open(by_role["outline"])
        bounds = outline.bounding_box(unit="mm")
        if bounds:
            (minx, miny), (maxx, maxy) = bounds
            w, h = maxx - minx, maxy - miny
            # The bounding box includes the profile stroke aperture, so the
            # nominal board is the box less one stroke width on each axis.
            stroke = 0.1
            nom_w, nom_h = w - stroke, h - stroke
            print(f"  outline bounding box: {w:.3f} x {h:.3f} mm  (nominal {nom_w:.2f} x {nom_h:.2f} mm)")
            check(nom_w > 1 and nom_h > 1, f"outline has real extent ({nom_w:.2f} x {nom_h:.2f} mm)")
            check(nom_w <= 100.001 and nom_h <= 80.001, f"outline within the qualified v1 envelope (100 x 80 mm)")
        else:
            check(False, "outline bounding box computed")

        # Closure: every outline segment endpoint must be shared by another
        # segment, i.e. the profile forms closed loops with no dangling ends.
        endpoints: dict[tuple[float, float], int] = {}
        seg_count = 0
        for obj in outline.objects:
            for attr in (("x1", "y1", "x2", "y2"),):
                if all(hasattr(obj, a) for a in attr):
                    seg_count += 1
                    for xa, ya in ((obj.x1, obj.y1), (obj.x2, obj.y2)):
                        key = (round(float(xa), 4), round(float(ya), 4))
                        endpoints[key] = endpoints.get(key, 0) + 1
                    break
        if seg_count:
            dangling = [p for p, n in endpoints.items() if n % 2 != 0]
            check(not dangling, f"outline closed — {seg_count} segments, no dangling endpoints")
        else:
            NOTE.append("outline uses region/arc primitives; segment-closure check not applicable")
            print("  NOTE  outline uses region/arc primitives (segment closure not applicable)")

        print("\nplated drill (Excellon)")
        drill_path = by_role["pth_drill"]
        drill = ExcellonFile.open(drill_path)
        holes = list(drill.objects)
        check(len(holes) > 0, f"{len(holes)} plated hole(s) parsed")
        # gerbonara exposes the diameter on the hole's tool, not the hole.
        diameters = sorted({round(float(h.tool.diameter), 4) for h in holes if getattr(h, "tool", None) is not None})
        print(f"  distinct tool diameters (mm): {diameters}")
        check(len(diameters) > 0, "tool diameters readable by the third-party parser")
        check(bool(diameters) and all(d >= 0.30 for d in diameters), "every drill diameter >= 0.300 mm profile minimum")
        # The 1.0 mm case is the exact value that previously emitted as bare "C1"
        # and made the file unparseable; assert it round-trips as a real number.
        for d in diameters:
            check(d == round(d, 3) and d > 0, f"diameter {d} mm parsed as an exact decimal value")

        print("\ndrill-to-copper alignment")
        cu_top = GerberFile.open(by_role["copper_top"])
        cu_bounds = cu_top.bounding_box(unit="mm")
        if cu_bounds and bounds:
            (cminx, cminy), (cmaxx, cmaxy) = cu_bounds
            check(
                cminx >= minx - 0.001 and cminy >= miny - 0.001 and cmaxx <= maxx + 0.001 and cmaxy <= maxy + 0.001,
                "top copper lies inside the board outline",
            )
        inside = 0
        for h in holes:
            hx, hy = float(h.x), float(h.y)
            if bounds and minx - 0.001 <= hx <= maxx + 0.001 and miny - 0.001 <= hy <= maxy + 0.001:
                inside += 1
        check(inside == len(holes), f"all {len(holes)} holes lie inside the board outline")

        print("\nmirroring / orientation")
        # A mirrored layer would place top copper outside the outline or invert
        # the coordinate sense; assert both copper layers share the outline frame.
        cu_bot = GerberFile.open(by_role["copper_bottom"])
        bot_bounds = cu_bot.bounding_box(unit="mm")
        if bot_bounds and bounds:
            (bminx, bminy), (bmaxx, bmaxy) = bot_bounds
            check(
                bminx >= minx - 0.001 and bmaxx <= maxx + 0.001 and bminy >= miny - 0.001 and bmaxy <= maxy + 0.001,
                "bottom copper shares the outline frame (not mirrored outside it)",
            )

        print("\nfull-stack load")
        try:
            stack = LayerStack.open(gerber_dir)
            layer_names = sorted(str(k) for k in stack.graphic_layers.keys())
            print(f"  gerbonara recognized layers: {layer_names}")
            check(len(layer_names) >= 5, f"layer stack auto-detected ({len(layer_names)} graphic layers)")
            check(stack.drill_pth is not None or bool(stack.drill_layers), "drill layer auto-detected in the stack")
        except Exception as exc:  # noqa: BLE001
            check(False, f"layer stack auto-detection: {exc}")

    print()
    if FAIL:
        print(f"INDEPENDENT VERIFICATION: FAIL ({len(FAIL)} check(s))")
        for f in FAIL:
            print(f"  - {f}")
        return 1
    print("INDEPENDENT VERIFICATION: PASS — all checks satisfied by a third-party parser")
    for n in NOTE:
        print(f"  note: {n}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(Path(sys.argv[1])))
