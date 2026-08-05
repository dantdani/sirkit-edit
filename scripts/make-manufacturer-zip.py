#!/usr/bin/env python
"""
Derive a manufacturer-upload ZIP from a Sirkit verified-release archive.

Packaging only — it must never regenerate or alter geometry. Every file is
copied byte-for-byte out of the verified archive and its SHA-256 is compared
against the release manifest; any mismatch aborts. The result contains ONLY
fabrication data (Gerbers + Excellon drill), flattened to the archive root for
maximum CAM front-end compatibility, per JLCPCB's requirement that "Gerber
files and the Drill file must be stored in the same folder/archive".

Sirkit's own manifest and README are deliberately excluded: the manufacturer
needs fabrication authority, not our provenance records.

Usage: python scripts/make-manufacturer-zip.py <verified-release.zip> [out.zip]
"""

from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

# Deterministic archive: fixed timestamp, stored (no compression variance).
FIXED_DATE = (1980, 1, 1, 0, 0, 0)

FAB_ROLES = {
    "copper_top", "copper_bottom", "mask_top", "mask_bottom",
    "silk_top", "silk_bottom", "paste_top", "paste_bottom",
    "outline", "pth_drill", "npth_drill", "gerber_job",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main(src: Path, out: Path | None) -> int:
    out = out or src.with_name(src.stem.replace("sirkit-verified-release", "manufacturer-upload") + ".zip")
    with zipfile.ZipFile(src) as zf:
        names = zf.namelist()
        manifest_name = next(n for n in names if n.endswith("release-manifest.json"))
        manifest = json.loads(zf.read(manifest_name))
        by_path = {rec["path"]: rec for rec in manifest["files"]}

        selected: list[tuple[str, bytes]] = []
        skipped: list[str] = []
        for rec in manifest["files"]:
            if rec["role"] not in FAB_ROLES:
                skipped.append(f'{rec["role"]} ({Path(rec["path"]).name})')
                continue
            data = zf.read(rec["path"])
            # Byte-for-byte fidelity against the verified release.
            actual = sha256(data)
            expected = rec.get("sha256")
            if expected and actual != expected:
                print(f"ABORT: {rec['path']} sha256 {actual} != manifest {expected}")
                return 1
            selected.append((Path(rec["path"]).name, data))

    if not selected:
        print("ABORT: no fabrication files found in the verified release")
        return 1

    # Deterministic ordering and metadata so repeated packaging is reproducible.
    selected.sort(key=lambda item: item[0])
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, data in selected:
            info = zipfile.ZipInfo(filename=name, date_time=FIXED_DATE)
            info.external_attr = (0o644 & 0xFFFF) << 16
            info.create_system = 3  # UNIX
            zf.writestr(info, data)

    out_bytes = out.read_bytes()
    print(f"manufacturer upload archive: {out}")
    print(f"  sha256: {sha256(out_bytes)}")
    print(f"  bytes : {len(out_bytes)}")
    print(f"  files ({len(selected)}), flattened to archive root:")
    for name, data in selected:
        print(f"    {name:44s} {len(data):7d} B  sha256={sha256(data)[:16]}")
    print(f"  excluded (not fabrication authority): {', '.join(skipped) or 'none'}")
    print("\n  every byte copied from the verified release and checksum-matched against its manifest")
    print("  NOTE: uploading or ordering requires separate explicit owner approval.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) == 3 else None))
