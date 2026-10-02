// [B22-B] The bounded engine host's one worker entry (engine-host.ts; OD-140): Sirkit's CLOSED table of in-process engines, run on a
// worker thread the host stops hard at its budget. Plain JavaScript so a worker loads it without a build step; it imports
// worker_threads and nothing else, loads no module and compiles no code. Each engine takes the input the server already
// validated against the catalog (catalog.ts) and returns plain JSON, or refuses with a closed code; the server validates every
// answer again with the kind's typed output validator before anything reaches the model. Evidence, never authority.
import { parentPort, workerData } from "node:worker_threads";

class EngineRefusal extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const refuse = (code) => {
  throw new EngineRefusal(code);
};
const finiteOr = (value, code) => (typeof value === "number" && Number.isFinite(value) ? value : refuse(code));
const quantity = (name, value, unit) => ({ name, value: finiteOr(value, "ENGINE_NON_FINITE"), unit });
const PROVIDER = Object.freeze({ providerId: "provider:analytical-reference", reviewState: "unreviewed", authoritative: false });

/** The analytical reference provider's three microcases (closed-form; no solver, no iteration). */
function analytical(input) {
  const p = (name) => finiteOr(input?.[name], "ENGINE_INPUT_REFUSED");
  switch (input?.equation) {
    case "resistor-divider": {
      const vin = p("vin");
      const total = p("r1") + p("r2");
      return { equation: "resistor-divider", provider: PROVIDER, quantities: [quantity("vout", (vin * p("r2")) / total, "V"), quantity("current", vin / total, "A"), quantity("ratio", p("r2") / total, "1"), quantity("power", (vin * vin) / total, "W")] };
    }
    case "rc-step": {
      const vin = p("vin");
      const tau = p("r") * p("c");
      const fraction = 1 - Math.exp(-p("time") / tau);
      const vout = vin * fraction;
      return { equation: "rc-step", provider: PROVIDER, quantities: [quantity("tau", tau, "s"), quantity("vout", vout, "V"), quantity("fraction", fraction, "1"), quantity("current", (vin - vout) / p("r"), "A")] };
    }
    case "one-pole-lowpass": {
      const cutoff = 1 / (2 * Math.PI * p("r") * p("c"));
      const ratio = p("frequency") / cutoff;
      const magnitude = 1 / Math.sqrt(1 + ratio * ratio);
      return { equation: "one-pole-lowpass", provider: PROVIDER, quantities: [quantity("cutoff", cutoff, "Hz"), quantity("magnitude", magnitude, "1"), quantity("gainDb", 20 * Math.log10(magnitude), "dB"), quantity("phaseDeg", (-Math.atan(ratio) * 180) / Math.PI, "deg")] };
    }
    default:
      return refuse("ENGINE_INPUT_REFUSED");
  }
}

/** Two held results' quantities, field by field (the server passes each side's digest, kind, subject and quantities). */
function compare(input) {
  const side = (value) => {
    if (!value || typeof value.digest !== "string" || typeof value.kindId !== "string" || !Array.isArray(value.quantities)) refuse("ENGINE_INPUT_REFUSED");
    return value;
  };
  const left = side(input?.left);
  const right = side(input?.right);
  const fields = [];
  for (const one of left.quantities) {
    const other = right.quantities.find((candidate) => candidate.name === one.name && candidate.unit === one.unit);
    if (!other || fields.length >= 16) continue;
    const a = finiteOr(one.value, "ENGINE_NON_FINITE");
    const b = finiteOr(other.value, "ENGINE_NON_FINITE");
    const scale = Math.max(Math.abs(a), Math.abs(b));
    fields.push({ name: one.name, unit: one.unit, left: a, right: b, absoluteDifference: Math.abs(a - b), relativeDifference: scale === 0 ? null : Math.abs(a - b) / scale });
  }
  return {
    left: { digest: left.digest, kindId: left.kindId },
    right: { digest: right.digest, kindId: right.kindId },
    comparable: typeof left.subject === "string" && left.subject === right.subject && fields.length > 0,
    identical: left.digest === right.digest,
    fields,
  };
}

const segmentLength = (track) => {
  const dx = Number(track?.end?.x) - Number(track?.start?.x);
  const dy = Number(track?.end?.y) - Number(track?.start?.y);
  return finiteOr(Math.hypot(dx, dy), "ENGINE_INPUT_REFUSED");
};
const countOf = (value) => (Array.isArray(value) ? value.length : 0);

/** A closed parser over one bounded server-held artifact. */
function parse(input) {
  const artifact = input?.artifact;
  const body = input?.body;
  if (!artifact || typeof artifact.digest !== "string") refuse("ENGINE_INPUT_REFUSED");
  if (input?.parser === "board-statistics" && artifact.kind === "canonical-board") {
    if (!body || typeof body !== "object" || !Array.isArray(body.tracks)) refuse("ENGINE_INPUT_REFUSED");
    const layers = new Map();
    for (const track of body.tracks) {
      const name = typeof track?.layer === "string" ? track.layer : refuse("ENGINE_INPUT_REFUSED");
      const entry = layers.get(name) ?? { layer: name, tracks: 0, lengthNm: 0 };
      entry.tracks += 1;
      entry.lengthNm += segmentLength(track);
      layers.set(name, entry);
    }
    if (layers.size > 16) refuse("ENGINE_TOO_MANY_LAYERS");
    const nets = Array.isArray(body.nets) ? body.nets.filter((net) => net && net.id !== 0).length : 0;
    return {
      artifact: { digest: artifact.digest, kind: "canonical-board" },
      parser: "board-statistics",
      statistics: {
        copperLayers: body.stackup === 4 ? 4 : 2,
        footprints: countOf(body.footprints),
        nets,
        tracks: countOf(body.tracks),
        vias: countOf(body.vias),
        zones: countOf(body.zones),
        texts: countOf(body.texts),
        layers: [...layers.values()].sort((a, b) => (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0)),
      },
    };
  }
  if (input?.parser === "result-fields" && artifact.kind === "computation-result") {
    if (!body || typeof body.kindId !== "string") refuse("ENGINE_INPUT_REFUSED");
    const quantities = Array.isArray(body.body?.quantities) ? body.body.quantities : [];
    return {
      artifact: { digest: artifact.digest, kind: "computation-result" },
      parser: "result-fields",
      statistics: { kindId: body.kindId, fields: quantities.slice(0, 16).map((item) => quantity(String(item?.name), item?.value, String(item?.unit))) },
    };
  }
  return refuse("ENGINE_PARSER_NOT_APPLICABLE");
}

const ENGINES = Object.freeze({
  "sirkit.engine.analytical-equations/1": analytical,
  "sirkit.engine.artifact-compare/1": compare,
  "sirkit.engine.artifact-parse/1": parse,
});

const engineId = workerData?.engineId;
try {
  const engine = typeof engineId === "string" && Object.hasOwn(ENGINES, engineId) ? ENGINES[engineId] : refuse("ENGINE_UNKNOWN");
  parentPort?.postMessage({ ok: true, output: engine(workerData.input) });
} catch (error) {
  parentPort?.postMessage({ ok: false, code: error instanceof EngineRefusal ? error.code : "ENGINE_INTERNAL_ERROR" });
}
