# B16.0.21 §C — Firmware authority proof (CONFIRMED)

The three firmware-bringup routes create only problems, resources, and
proposals:

| Rule | Evidence |
|---|---|
| no hardware flashing / serial-JTAG-SWD / uncontrolled executables / scripts | code-only gate: no `child_process`/`spawn`/`exec`/`serialport`/`jtag`/`swd`/`openocd`/`flash` identifier in any route |
| no physical-validation claims | the problem compiler consumes evidence SNAPSHOTS; proposals carry `requiresHumanReview: true`; no route emits a "validated on hardware" claim |
| no production-readiness certification | problem output is a compiled problem (ok/409); nothing certifies readiness |
| no schematic/PCB mutation | code-only gate: no mutation authority referenced |
| human-only problem compilation | non-human → exact 403 with compile never invoked; compiled actor FORCED human |
| resources solver honestly labeled | the internal solve actor is `automated_engine`/`automation` — a deterministic engine label, not caller-supplied; the certificate is validate-only (valid 200 / invalid 422) |
| provider-output validation | n/a by construction — NO provider call exists in this family (statically gated); the propose route is a deterministic typed filter with trusted `proposedBy` |
