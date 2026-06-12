import { spawn } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicToSpice, type SpiceAnalysis } from "@/app/lib/netlist";

// ─── ASCII raw-file parser ────────────────────────────────────────────────────

interface SimResult {
  analysis: string;
  variables: string[];
  points: Record<string, number>[];
}

function parseAsciiRaw(raw: string): SimResult {
  const lines = raw.split(/\r?\n/);
  let plotname = "Unknown";
  let flags    = "real";
  let numVars  = 0;
  const variables: string[] = [];
  let i = 0;

  // Header
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("Plotname:")) {
      plotname = line.slice("Plotname:".length).trim();
    } else if (line.startsWith("Flags:")) {
      flags = line.slice("Flags:".length).trim();
    } else if (line.startsWith("No. Variables:")) {
      numVars = parseInt(line.slice("No. Variables:".length).trim(), 10);
    } else if (line.trimEnd() === "Variables:") {
      i++;
      for (; i < lines.length; i++) {
        const vl = lines[i];
        if (vl.trimEnd() === "Values:") break;
        const parts = vl.trim().split(/\s+/);
        // format: "  idx  varname  type"
        if (parts.length >= 2) variables.push(parts[1]);
      }
      break;
    }
  }

  // Skip to "Values:" line
  for (; i < lines.length; i++) {
    if (lines[i].trimEnd() === "Values:") { i++; break; }
  }

  const isComplex  = flags.toLowerCase().includes("complex");
  const valsPerVar = isComplex ? 2 : 1;
  const stride     = 1 + numVars * valsPerVar; // sequential index + per-var values

  // Tokenize numbers across all remaining lines. Split on whitespace and commas;
  // ngspice ASCII complex pairs use "re,im" or whitespace-separated forms.
  const tokens: number[] = [];
  for (; i < lines.length; i++) {
    for (const part of lines[i].split(/[\s,]+/)) {
      if (part === "") continue;
      const n = Number(part);
      if (!isNaN(n)) tokens.push(n);
    }
  }

  const points: Record<string, number>[] = [];
  for (let t = 0; t + stride <= tokens.length; t += stride) {
    const point: Record<string, number> = {};
    for (let k = 0; k < variables.length && k < numVars; k++) {
      const name   = variables[k];
      const valIdx = t + 1 + k * valsPerVar;
      if (isComplex) {
        const re = tokens[valIdx];
        const im = tokens[valIdx + 1];
        if (k === 0 && /freq/i.test(name)) {
          // The swept variable in AC: take real part (imag is always 0).
          point[name] = re;
        } else {
          const mag    = Math.sqrt(re * re + im * im);
          const magDb  = 20 * Math.log10(mag === 0 ? 1e-30 : mag);
          const phase  = (Math.atan2(im, re) * 180) / Math.PI;
          point[`${name}.mag`]   = magDb;
          point[`${name}.phase`] = phase;
        }
      } else {
        point[name] = tokens[valIdx];
      }
    }
    points.push(point);
  }

  // Build the variable list reported to the client. For AC, replace each
  // non-frequency variable with its derived .mag / .phase signals.
  let finalVars: string[];
  if (isComplex) {
    finalVars = [];
    for (let k = 0; k < variables.length; k++) {
      const name = variables[k];
      if (k === 0 && /freq/i.test(name)) finalVars.push(name);
      else finalVars.push(`${name}.mag`, `${name}.phase`);
    }
  } else {
    finalVars = variables;
  }

  return { analysis: plotname, variables: finalVars, points };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: { state: SchematicState; analysis?: SpiceAnalysis };
  try {
    body = (await req.json()) as { state: SchematicState; analysis?: SpiceAnalysis };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { state, analysis } = body;

  // Validate
  if (!state?.components?.length) {
    return Response.json({ error: "Schematic has no components" }, { status: 400 });
  }
  const hasSrc = state.components.some(
    (c) => c.type === "voltage-source" || c.type === "current-source",
  );
  if (!hasSrc) {
    return Response.json(
      { error: "Schematic must have at least one voltage or current source" },
      { status: 400 },
    );
  }
  // A ground reference can be the ground component OR a ground net label
  // ("ground"-kind, or named GND/0).
  const hasGroundLabel = (state.netLabels ?? []).some((l) => {
    const name = l.name.trim().toUpperCase();
    return l.kind === "ground" || name === "GND" || name === "0";
  });
  if (!state.components.some((c) => c.type === "ground") && !hasGroundLabel) {
    return Response.json(
      { error: "Schematic must have at least one ground component or GND label" },
      { status: 400 },
    );
  }

  const uuid        = randomUUID();
  const netlistPath = join(tmpdir(), `${uuid}.cir`);
  const rawPath     = join(tmpdir(), `${uuid}.raw`);

  // Generate netlist
  let netlist: string;
  let nodeMap: Record<string, string>;
  let pinNodes: Record<string, string>;
  try {
    ({ netlist, nodeMap, pinNodes } = schematicToSpice(state, { analysis, rawOutputPath: rawPath }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Netlist generation failed: ${msg}` }, { status: 400 });
  }

  console.error("[simulate] netlist:\n" + netlist);
  await writeFile(netlistPath, netlist, "utf8");

  try {
    // Run NGSpice
    const { code, stdout, stderr } = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      let stdout = "", stderr = "";
      let timedOut = false;

      const child = spawn(
        "ngspice",
        ["-b", netlistPath],
        { stdio: "pipe" },
      );

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") reject(new Error("ENOENT"));
        else reject(err);
      });

      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 10_000);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) reject(new Error("TIMEOUT"));
        else resolve({ code, stdout, stderr });
      });
    });

    if (code !== 0) {
      console.error("[simulate] NGSpice failed (exit code " + String(code) + ")");
      console.error("[simulate] netlist:\n" + netlist);
      console.error("[simulate] stderr:\n" + stderr);
      console.error("[simulate] stdout:\n" + stdout);
      return Response.json(
        {
          ok: false,
          error: stderr.slice(-5000) || stdout.slice(-5000) || `NGSpice exited with code ${String(code)}`,
          netlist,
        },
        { status: 500 },
      );
    }

    // Read raw file
    let rawText: string;
    try {
      rawText = await readFile(rawPath, "utf8");
    } catch {
      return Response.json(
        { error: "NGSpice produced no output file" },
        { status: 500 },
      );
    }

    // Parse
    let result: SimResult;
    try {
      result = parseAsciiRaw(rawText);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[simulate] parse error:", msg, "\nraw:", rawText.slice(0, 2000));
      return Response.json(
        { ok: false, error: "Could not parse simulation output", raw: rawText.slice(0, 5000) },
        { status: 500 },
      );
    }

    if (result.variables.length === 0 || result.points.length === 0) {
      console.error("[simulate] empty result — variables:", result.variables.length, "points:", result.points.length);
      console.error("[simulate] netlist:\n" + netlist);
      console.error("[simulate] raw output:\n" + rawText.slice(0, 3000));
      console.error("[simulate] stdout:\n" + stdout);
      return Response.json(
        { ok: false, error: "Simulation produced no data points. Check the netlist and analysis settings.", netlist },
        { status: 500 },
      );
    }

    console.log("[simulate] ok — variables:", result.variables.join(", "), "| points:", result.points.length);
    return Response.json({
      ok:           true,
      analysis:     result.analysis,
      analysisType: analysis?.type ?? "tran",
      variables:    result.variables,
      points:       result.points,
      netlist,
      nodeMap,
      pinNodes,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ENOENT") {
      return Response.json(
        { error: "NGSpice executable not found on PATH" },
        { status: 500 },
      );
    }
    if (e instanceof Error && e.message === "TIMEOUT") {
      return Response.json(
        { error: "Simulation timed out after 10 seconds" },
        { status: 504 },
      );
    }
    throw e;
  } finally {
    await Promise.all([
      unlink(netlistPath).catch(() => {}),
      unlink(rawPath).catch(() => {}),
    ]);
  }
}
