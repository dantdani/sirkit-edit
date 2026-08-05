import type { PcbBoard } from "@/app/lib/pcb/types";
import { getBoardStackup } from "@/app/lib/pcb/stackup";
import type { LayerId } from "@/app/lib/pcb/layers";
import type { ConstraintProgram, ConstraintQuantity, ConstraintViolation, EffectiveConstraintRule, TypedRequirement } from "./types";
import { compareQuantities, quantityToInteger } from "./quantity";
import { stableConstraintId } from "./stable";

export interface ConstraintRegionGeometry {
  id: string;
  polygon: Array<{ x: number; y: number }>;
}

function netId(board: PcbBoard, stableId: string): number | undefined {
  return board.nets.find((net) => net.stableId === stableId)?.id;
}

function routeLengthNm(board: PcbBoard, numericNetId: number): number {
  return Math.round(board.tracks.filter((track) => track.netId === numericNetId).reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0));
}

function quantity(valueNm: number): ConstraintQuantity {
  return { dimension: "length", value: String(Math.round(valueNm)), unit: "nm" };
}

function passesQuantity(actual: ConstraintQuantity, requirement: TypedRequirement): boolean | null {
  try {
    if (requirement.form === "minimum") return compareQuantities(actual, requirement.value) >= 0;
    if (requirement.form === "maximum") return compareQuantities(actual, requirement.value) <= 0;
    if (requirement.form === "range") return compareQuantities(actual, requirement.min) >= 0 && compareQuantities(actual, requirement.max) <= 0;
    if (requirement.form === "target") {
      const target = quantityToInteger(requirement.value, requirement.value.dimension);
      const minus = quantityToInteger(requirement.toleranceMinus, requirement.value.dimension);
      const plus = quantityToInteger(requirement.tolerancePlus, requirement.value.dimension);
      const actualValue = quantityToInteger(actual, requirement.value.dimension);
      return actualValue >= target - minus && actualValue <= target + plus;
    }
  } catch {
    return null;
  }
  return null;
}

function output(rule: EffectiveConstraintRule, state: ConstraintViolation["state"], message: string, actual?: ConstraintViolation["actual"]): ConstraintViolation {
  return {
    id: stableConstraintId("constraint-result", { ruleId: rule.id, state, message, actual }),
    constraintId: rule.contributingConstraintIds[0],
    targetIds: [rule.targetId],
    state,
    consumerId: rule.kind.startsWith("placement_") ? "placement-static-checker" : "post-route-static-checker",
    checkerVersion: "stage6-physical/1",
    ...(actual !== undefined ? { actual } : {}),
    required: rule.requirement,
    evidenceIds: [...rule.evidenceIds],
    message,
    nextAction: state === "pass" ? "No action required." : "Change the physical design or the explicitly authorized constraint source, then rerun the checker.",
  };
}

function normalizedLayerId(value: string): string {
  return value.replace(/^layer:/, "");
}

function pointInside(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function runPhysicalConstraintChecks(input: {
  program: ConstraintProgram;
  board: PcbBoard;
  designRevision: string;
  regions?: ConstraintRegionGeometry[];
}): ConstraintViolation[] {
  const { program, board } = input;
  if (input.designRevision !== program.designRevision) return program.effectiveRules.map((rule) => output(rule, "stale", "Physical snapshot does not match the compiled constraint target revision."));
  const results: ConstraintViolation[] = [];
  const stackup = getBoardStackup(board);
  const enabledLayers = stackup.copperLayers.filter((layer) => layer.enabled).map((layer) => layer.id);
  for (const rule of program.effectiveRules.filter((item) => item.strength === "hard")) {
    const numericNetId = netId(board, rule.targetId);
    if (rule.kind === "allowed_layers" || rule.kind === "forbidden_layers") {
      if (numericNetId === undefined || (rule.requirement.form !== "allowed_set" && rule.requirement.form !== "forbidden_set")) {
        results.push(output(rule, "unknown", "Layer constraint target or set is unavailable."));
        continue;
      }
      const specified = new Set(rule.requirement.values.filter((item): item is string => typeof item === "string").map(normalizedLayerId));
      const used = new Set<LayerId>();
      board.tracks.filter((track) => track.netId === numericNetId).forEach((track) => used.add(track.layer));
      board.vias.filter((via) => via.netId === numericNetId).forEach((via) => via.layers.forEach((layer) => used.add(layer)));
      const illegal = [...used].filter((layer) => rule.kind === "allowed_layers" ? !specified.has(layer) : specified.has(layer)).sort();
      results.push(output(rule, illegal.length === 0 ? "pass" : "fail", illegal.length === 0 ? "All routed copper uses permitted layers." : `Net uses prohibited layer(s): ${illegal.join(", ")}.`));
    } else if (rule.kind === "via_count") {
      let limit: number | undefined;
      if (rule.requirement.form === "maximum") limit = quantityToInteger(rule.requirement.value, "dimensionless");
      else if (rule.requirement.form === "equals" && typeof rule.requirement.value === "object" && "kind" in rule.requirement.value) limit = Number(rule.requirement.value.value);
      if (numericNetId === undefined || limit === undefined) results.push(output(rule, "unknown", "Via-count target/limit is unavailable."));
      else {
        const count = board.vias.filter((via) => via.netId === numericNetId).length;
        results.push(output(rule, count <= limit ? "pass" : "fail", `Net uses ${count} via(s); compiled maximum is ${limit}.`, { kind: "integer", value: String(count) }));
      }
    } else if (rule.kind === "via_type" || rule.kind === "via_span") {
      if (numericNetId === undefined || (rule.requirement.form !== "allowed_set" && rule.requirement.form !== "forbidden_set")) results.push(output(rule, "unknown", "Via type/span set is unavailable."));
      else {
        const allowed = new Set(rule.requirement.values.filter((item): item is string => typeof item === "string"));
        const vias = board.vias.filter((via) => via.netId === numericNetId);
        const first = enabledLayers[0];
        const last = enabledLayers[enabledLayers.length - 1];
        const actual = vias.map((via) => rule.kind === "via_type" ? (via.layers.includes(first) && via.layers.includes(last) ? "through" : "blind_buried") : `layer:${via.layers[0]}->layer:${via.layers[1]}`);
        const illegal = actual.filter((item) => rule.requirement.form === "allowed_set" ? !allowed.has(item) : allowed.has(item));
        results.push(output(rule, illegal.length === 0 ? "pass" : "fail", illegal.length === 0 ? "Via type/span policy passed." : `Disallowed via type/span: ${[...new Set(illegal)].join(", ")}.`));
      }
    } else if (rule.kind === "route_length") {
      if (numericNetId === undefined) results.push(output(rule, "unknown", "Route-length target net is missing."));
      else {
        const actual = quantity(routeLengthNm(board, numericNetId));
        const pass = passesQuantity(actual, rule.requirement);
        results.push(output(rule, pass === null ? "unknown" : pass ? "pass" : "fail", `Routed length is ${actual.value} nm.`, actual));
      }
    } else if (rule.kind === "pair_skew") {
      const relation = program.lowerings.routingGraph.find((item) => item.relationshipId === rule.targetId && item.kind === "differential_pair");
      if (!relation || relation.memberIds.length !== 2 || rule.requirement.form !== "maximum") results.push(output(rule, "unknown", "Differential pair membership or skew limit is unavailable."));
      else {
        const ids = relation.memberIds.map((id) => netId(board, id));
        if (ids.some((id) => id === undefined)) results.push(output(rule, "unknown", "Differential pair member net is missing."));
        else {
          const skew = Math.abs(routeLengthNm(board, ids[0]!) - routeLengthNm(board, ids[1]!));
          const actual = quantity(skew);
          results.push(output(rule, compareQuantities(actual, rule.requirement.value) <= 0 ? "pass" : "fail", `Differential pair skew is ${skew} nm.`, actual));
        }
      }
    } else if (rule.kind === "placement_fixed" || rule.kind === "placement_side" || rule.kind === "placement_orientation") {
      const id = rule.targetId.replace(/^component:/, "");
      const footprint = board.footprints.find((item) => item.id === id);
      if (!footprint) results.push(output(rule, "unknown", "Placement target component is missing."));
      else if (rule.kind === "placement_fixed") {
        const required = rule.requirement.form === "equals" && rule.requirement.value === true;
        results.push(output(rule, required === (footprint.locked === true || footprint.placementConstraints?.fixedPosition === true) ? "pass" : "fail", "Fixed-placement state checked."));
      } else {
        const actual = rule.kind === "placement_side" ? footprint.side : String(footprint.rotationDeg);
        const allowed = rule.requirement.form === "allowed_set" ? rule.requirement.values : rule.requirement.form === "equals" ? [rule.requirement.value] : [];
        results.push(output(rule, allowed.includes(actual) ? "pass" : "fail", `${rule.kind} actual value is ${actual}.`, actual));
      }
    } else if (rule.kind === "placement_region" && rule.requirement.form === "containment") {
      const id = rule.targetId.replace(/^component:/, "");
      const footprint = board.footprints.find((item) => item.id === id);
      const regions = rule.requirement.regionIds.map((id) => input.regions?.find((region) => region.id === id)).filter((item): item is ConstraintRegionGeometry => Boolean(item));
      if (!footprint || regions.length !== rule.requirement.regionIds.length) results.push(output(rule, "unknown", "Placement target or exact region geometry is unavailable."));
      else {
        const inside = regions.some((region) => pointInside(footprint.at, region.polygon));
        const pass = rule.requirement.mode === "inside" ? inside : !inside;
        results.push(output(rule, pass ? "pass" : "fail", pass ? "Placement region constraint passed." : "Component origin violates the placement region constraint."));
      }
    }
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}
