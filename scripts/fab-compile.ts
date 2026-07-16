#!/usr/bin/env tsx

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PcbBoard } from "../app/lib/pcb/types";
import type { PcbNetlist } from "../app/lib/pcb/netlist-bridge";
import { netlistFromBoard } from "../app/lib/pcb/kicad/write-pcb";
import { getFabPreset } from "../app/lib/pcb/fab/presets";
import { getPreset } from "../app/lib/pcb/drc/presets";
import type { DrcPresetId } from "../app/lib/pcb/drc/types";
import { BROAD_NATIVE_RECIPE, STRICT_NATIVE_RECIPE } from "../app/lib/pcb/fab/native/recipe";
import { compileNativeFabPackage } from "../app/lib/pcb/fab/native/compiler";
import { NativeFabBlockedError } from "../app/lib/pcb/fab/native/types";

interface InputDocument {
  board: PcbBoard;
  netlist?: PcbNetlist;
  boardName?: string;
  fabPresetId?: string;
  drcPresetId?: DrcPresetId;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): never {
  console.error(
    "Usage: npm run fab:compile -- --input board.json [--output package.zip] [--fab jlcpcb-2l] [--drc jlcpcb-2l] [--name board] [--mode strict|broad]",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const inputPath = argument("--input");
  if (!inputPath) usage();
  const document = JSON.parse(await readFile(resolve(inputPath), "utf8")) as InputDocument;
  if (!document.board || document.board.formatVersion !== 1) throw new Error("Input JSON must contain board: PcbBoard");

  const fabPreset = getFabPreset(argument("--fab") ?? document.fabPresetId ?? "jlcpcb-2l");
  const drcPreset = getPreset((argument("--drc") ?? document.drcPresetId ?? fabPreset.drcPresetId) as DrcPresetId);
  const mode = argument("--mode") ?? "strict";
  if (mode !== "strict" && mode !== "broad") throw new Error("--mode must be strict or broad");
  const result = await compileNativeFabPackage({
    board: document.board,
    netlist: document.netlist ?? netlistFromBoard(document.board),
    fabPreset,
    drcPreset,
    boardName: argument("--name") ?? document.boardName ?? "sirkit-board",
    recipe: mode === "strict" ? STRICT_NATIVE_RECIPE : BROAD_NATIVE_RECIPE,
  });

  const outputPath = resolve(argument("--output") ?? result.filename);
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, result.zipBytes);
    await rename(temporary, outputPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  console.log(JSON.stringify({
    output: outputPath,
    packageId: result.manifest.packageId,
    packageSha256: result.packageSha256,
    files: result.files.length,
    signoff: result.manifest.signoff,
  }, null, 2));
}

main().catch((error: unknown) => {
  if (error instanceof NativeFabBlockedError) {
    console.error(JSON.stringify({ error: error.message, diagnostics: error.diagnostics }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
