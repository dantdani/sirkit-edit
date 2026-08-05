#!/usr/bin/env python
"""
Independent verification of a manufacturer-upload ZIP.

Maps files by their Protel extension explicitly rather than relying on a
parser's auto-detection heuristic, then re-parses every layer with `gerbonara`
and cross-checks the geometry against the verified-release archive it was
derived from. Byte equality is the property that matters: packaging must never
alter fabrication data.

A note on auto-detection: gerbonara's LayerStack autoguesser strips the longest
common filename prefix before matching layer suffixes, so an archive containing
ONLY same-prefix fabrication files (exactly what a manufacturer upload should
be) defeats it, while the same files alongside a README are recognised. That is
a quirk of that heuristic, not a property of the data — JLCPCB's own guidance
lists these Protel extensions as accepted. This checker therefore maps by
extension and does not depend on autoguess.

Usage: python scripts/verify-manufacturer-zip.py <manufacturer.zip> <verified-release.zip>
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import zipfile
from pathlib import Path

from gerbonara.rs274x import GerberFile
from gerbonara.excellon import ExcellonFile

EXT_ROLE = {
    ".GTL": "copper_top", ".GBL": "copper_bottom",
    ".GTS": "mask_top", ".GBS": "mask_bottom",
    ".GTO": "silk_top", ".GBO": "silk_bottom",
    ".GTP": "paste_top", ".GBP": "paste_bottom",
    ".GML": "outline", ".GKO": "outline",
    ".xnc": "drill", ".DRL": "drill",
    ".gbrjob": "job",
}
REQUIRED = {"copper_top", "copper_bottom", "mask_top", "mask_bottom", "outline", "drill"}

FAIL: list[str] = []


def check(ok: bool, message: str) -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {message}")
    if not ok:
        FAIL.append(message)


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main(mfg: Path, verified: Path) -> int:
    print(f"Manufacturer upload verification — {mfg.name}\n")

    with zipfile.ZipFile(mfg) as zf:
        entries = {n: zf.read(n) for n in zf.namelist()}

    print("packaging")
    check(all("/" not in n for n in entries), "all files at the archive root (single folder, no nesting)")
    check(not any(n.lower().endswith((".kicad_pcb", ".kicad_sch", ".pro", ".json", ".txt")) for n in entries),
          "no source CAD, manifest or provenance files included (fabrication authority only)")

    roles: dict[str, str] = {}
    for name in entries:
        ext = Path(name).suffix
        role = EXT_ROLE.get(ext) or EXT_ROLE.get(ext.upper()) or EXT_ROLE.get(ext.lower())
        if role:
            roles.setdefault(role, name)
    print(f"  extension mapping: {json.dumps({k: Path(v).suffix for k, v in sorted(roles.items())})}")
    for role in sorted(REQUIRED):
        check(role in roles, f"{role} present")

    print("\nbyte equality against the verified release")
    with zipfile.ZipFile(verified) as zf:
        vnames = {Path(n).name: n for n in zf.namelist()}
        manifest = json.loads(zf.read(next(n for n in zf.namelist() if n.endswith("release-manifest.json"))))
        expected = {Path(r["path"]).name: r.get("sha256") for r in manifest["files"]}
        for name, data in sorted(entries.items()):
            src = vnames.get(name)
            if src is None:
                check(False, f"{name} exists in the verified release")
                continue
            same = zf.read(src) == data
            check(same, f"{name} byte-identical to the verified release")
            if expected.get(name):
                check(sha256(data) == expected[name], f"{name} matches its release-manifest sha256")

    print("\nindependent re-parse of the delivered bytes")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name, data in entries.items():
            (root / name).write_bytes(data)
        outline_bounds = None
        for role in ("copper_top", "copper_bottom", "mask_top", "mask_bottom", "silk_top", "outline"):
            if role not in roles:
                continue
            gf = GerberFile.open(root / roles[role])
            objects = list(gf.objects)
            check(len(objects) > 0, f"{role}: {len(objects)} objects re-parsed from the delivered file")
            if role == "outline":
                outline_bounds = gf.bounding_box(unit="mm")

        drill = ExcellonFile.open(root / roles["drill"])
        holes = list(drill.objects)
        diameters = sorted({round(float(h.tool.diameter), 4) for h in holes if getattr(h, "tool", None)})
        check(len(holes) > 0, f"drill: {len(holes)} hole(s) re-parsed")
        check(len(diameters) > 0 and all(d >= 0.30 for d in diameters), f"drill diameters {diameters} mm all >= 0.300 mm")

        if outline_bounds:
            (minx, miny), (maxx, maxy) = outline_bounds
            w, h = maxx - minx - 0.1, maxy - miny - 0.1
            print(f"  nominal board size: {w:.2f} x {h:.2f} mm")
            check(w > 1 and h > 1, "outline encloses a real board")
            inside = sum(1 for hole in holes if minx <= float(hole.x) <= maxx and miny <= float(hole.y) <= maxy)
            check(inside == len(holes), f"all {len(holes)} holes inside the outline")

    print()
    if FAIL:
        print(f"MANUFACTURER UPLOAD VERIFICATION: FAIL ({len(FAIL)})")
        for f in FAIL:
            print(f"  - {f}")
        return 1
    print("MANUFACTURER UPLOAD VERIFICATION: PASS")
    print("  Upload/order still requires separate explicit owner approval.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(Path(sys.argv[1]), Path(sys.argv[2])))
