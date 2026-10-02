/**
 * [B22-A3] Test support (not a suite): a FAKE ngspice install pinned for the diagnostic runner. A temporary tree holds a stand-in
 * `bin/ngspice_con.exe` (a text file, never executed) and a spinit with a random marker (so no two suites share a digest); its
 * install-tree digest goes into `SIRKIT_NGSPICE_INSTALL_SHA256` and its path into `SIRKIT_NGSPICE_INSTALL_ROOT`, and the runner is
 * made to read a win32-x64 host with a fake Windows directory, so a suite whose `node:child_process` is a fake exercises the runner's
 * real path on any host (CI runs on Linux). Nothing is started; every value is a fake assembled at run time.
 *
 * [B22-A3 review] tests-8: this file is not a `*.test.ts`, so the B11.5 write gate (`b11-5-capture-exactness` case 12) never reads
 * it. Its confinement is asserted instead by `b22-a3-diagnostic-runner` case 9: every write primitive below takes its path through
 * `confined`, which refuses anything outside the OS temporary directory before any write.
 */
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { __setDiagnosticRunnerHostForTests } from "@/app/lib/computation/diagnostic-runner";
import { installTreeDigest } from "@/app/lib/computation/runtime-profile";

/** The Windows directory the fake host reports (a fake; nothing is read there). */
export const FAKE_SYSTEM_ROOT = ["C:", "Windows"].join(String.fromCharCode(92));

export interface FakeNgspiceInstall {
  readonly root: string;
  /** The install-tree digest's 64 hex characters. */
  readonly digest: string;
  readonly executable: string;
  readonly binDir: string;
}

/** `path` itself when it lies under the OS temporary directory (resolved, so `..` cannot leave it); otherwise a refusal, before any write. */
function confined(path: string): string {
  const temporary = resolve(tmpdir());
  if (!resolve(path).startsWith(`${temporary}${sep}`)) throw new Error("b22-a3 test support writes nothing outside the OS temporary directory");
  return path;
}

/** A fresh fake install tree and its digest. */
export async function createFakeNgspiceInstall(): Promise<FakeNgspiceInstall> {
  const root = mkdtempSync(confined(join(tmpdir(), "sirkit-b22-a3-install-")));
  mkdirSync(confined(join(root, "bin")));
  mkdirSync(confined(join(root, "share", "ngspice", "scripts")), { recursive: true });
  writeFileSync(confined(join(root, "bin", "ngspice_con.exe")), "b22-a3 stand-in: a text file, never executed\n");
  writeFileSync(confined(join(root, "share", "ngspice", "scripts", "spinit")), `* b22-a3 fixture ${randomUUID()}\nset num_threads=8\n`);
  const digest = (await installTreeDigest(root)).sha256;
  return { root, digest, executable: join(root, "bin", "ngspice_con.exe"), binDir: join(root, "bin") };
}

/** The fixture writes a suite needs, kept here and confined to the OS temporary directory (no test writes under app/, lib/, scripts/
 *  or artifacts/ - the B11.5 rule): replace one file's bytes, copy the tree with a directory link inside it, remove a tree. */
export function replaceFakeInstallFile(install: FakeNgspiceInstall, relativePath: string, bytes: Buffer): void {
  writeFileSync(confined(join(install.root, ...relativePath.split("/"))), bytes);
}
/** A copy of `install` (beside it in the OS temp directory) holding a directory link - a junction on Windows - under `bin/`. */
export function linkedCopyOfFakeInstall(install: FakeNgspiceInstall): string {
  const copy = mkdtempSync(confined(join(tmpdir(), "sirkit-b22-a3-linked-")));
  cpSync(confined(install.root), confined(copy), { recursive: true });
  mkdirSync(confined(join(copy, "elsewhere")));
  symlinkSync(confined(join(copy, "elsewhere")), confined(join(copy, "bin", "redirect")), "junction");
  return copy;
}
/** Removes a fixture tree this module created (under the OS temp directory only). */
export function removeFakeTree(root: string): void {
  rmSync(confined(root), { recursive: true, force: true });
}

/** Pins `install` in the server settings and makes the runner read a win32-x64 host. */
export function pinFakeNgspiceInstall(install: FakeNgspiceInstall): void {
  vi.stubEnv("SIRKIT_NGSPICE_INSTALL_ROOT", install.root);
  vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", install.digest);
  __setDiagnosticRunnerHostForTests({ platform: () => "win32-x64", systemRoot: () => FAKE_SYSTEM_ROOT });
}

/** Registers the hooks a suite needs: one fake install for the file, pinned before every test, removed after the file. */
export function pinFakeNgspiceForSuite(): () => FakeNgspiceInstall {
  let install: FakeNgspiceInstall | null = null;
  beforeAll(async () => {
    install = await createFakeNgspiceInstall();
  });
  beforeEach(() => {
    pinFakeNgspiceInstall(install!);
  });
  afterAll(() => {
    __setDiagnosticRunnerHostForTests(null);
    if (install) removeFakeTree(install.root);
  });
  return () => install!;
}
