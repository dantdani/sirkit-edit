import type { ConstraintDefinition, ConstraintDocument, ConstraintRelationship, TypedRequirement } from "@/app/lib/constraints/types";
import { migrateBoardConstraintState } from "@/app/lib/constraints/legacy";
import { applyConstraintTransaction, previewConstraintTransaction } from "@/app/lib/constraints/transactions";
import type { PcbBoard } from "../../types";
import { makeBoard, makeDef, makeInstance, makePad, makeResistorDef } from "../../__tests__/autoplace-fixture";
import { mmToNm } from "../../units";

export { makeBoard, makeDef, makeInstance, makePad, makeResistorDef };

export function placementRule(input: {
  id: string;
  targetId: string;
  kind: ConstraintDefinition["kind"];
  requirement: TypedRequirement;
  strength?: ConstraintDefinition["strength"];
  domain?: ConstraintDefinition["domain"];
  objectType?: ConstraintDefinition["selector"]["objectType"];
}): ConstraintDefinition {
  return {
    id: input.id,
    revision: 1,
    name: input.id,
    domain: input.domain ?? "placement",
    kind: input.kind,
    scope: { type: "project", id: "project:stage7-test" },
    selector: { objectType: input.objectType ?? "component", predicate: { kind: "ids", ids: [input.targetId] }, cardinality: { kind: "exactly", count: 1 } },
    requirement: input.requirement,
    strength: input.strength ?? "hard",
    severityPolicyId: "severity:blocking",
    origin: { kind: "project", sourceId: "source:stage7-test", sourceRevision: "1" },
    evidenceIds: ["evidence:stage7-test"],
    lifecycle: { state: "active" },
    waiverPolicy: { eligible: false },
  };
}

export function activateConstraints(board: PcbBoard, constraints: ConstraintDefinition[], relationships: ConstraintRelationship[] = []): PcbBoard {
  const migrated = migrateBoardConstraintState(board, "stage7-test").board;
  const document: ConstraintDocument = { schemaVersion: 1, id: "constraint-set:stage7-test", revision: 1, name: "Stage 7 test", extendsSetIds: [], constraints, relationships };
  const documents = [...migrated.constraintState!.documents.filter((item) => item.id !== document.id), document];
  const preview = previewConstraintTransaction({ board: migrated, projectId: "stage7-test", documents });
  const applied = applyConstraintTransaction({ board: migrated, projectId: "stage7-test", preview, actorId: "test:stage7" });
  if (!applied.ok) throw new Error(`${applied.code}: ${applied.message}`);
  return applied.board;
}

export function crossingChannelBoard(input: { heightMm: number; nets?: number; obstacle?: boolean }): PcbBoard {
  const netCount = input.nets ?? 20;
  const chip = makeDef("CHANNEL_PIN", 0.4, 0.4, [makePad("1", 0, 0)]);
  const footprints = [];
  for (let index = 0; index < netCount; index += 1) {
    const y = 0.5 + (index % 10) * 0.4;
    footprints.push(makeInstance(`left-${index.toString().padStart(2, "0")}`, chip, { x: 2, y }, { "1": index + 1 }));
    footprints.push(makeInstance(`right-${index.toString().padStart(2, "0")}`, chip, { x: 38, y }, { "1": index + 1 }));
  }
  if (input.obstacle) {
    const obstacle = makeDef("FIXED_CHANNEL_BLOCK", 3, Math.max(1, input.heightMm - 1), []);
    footprints.push(makeInstance("fixed-obstacle", obstacle, { x: 20, y: input.heightMm / 2 }, {}, { locked: true }));
  }
  return makeBoard(40, input.heightMm, footprints, netCount);
}

export function protectedCopperBoard(): PcbBoard {
  const resistor = makeResistorDef();
  const board = makeBoard(40, 20, [
    makeInstance("a", resistor, { x: 10, y: 10 }, { "1": 1 }),
    makeInstance("b", resistor, { x: 30, y: 10 }, { "1": 1 }),
  ], 1);
  board.tracks.push({ id: "manual-a", layer: "copperTop", width: mmToNm(0.25), start: { x: mmToNm(9.1), y: mmToNm(10) }, end: { x: mmToNm(15), y: mmToNm(10) }, netId: 1, source: "human", locked: true });
  board.tracks.push({ id: "generated-b", layer: "copperTop", width: mmToNm(0.25), start: { x: mmToNm(29.1), y: mmToNm(10) }, end: { x: mmToNm(24), y: mmToNm(10) }, netId: 1, source: "autorouter" });
  board.vias.push({ id: "manual-via-a", at: { x: mmToNm(9.1), y: mmToNm(10) }, size: mmToNm(0.8), drill: mmToNm(0.4), netId: 1, layers: ["copperTop", "copperBottom"], source: "human", locked: true });
  board.vias.push({ id: "generated-via-b", at: { x: mmToNm(29.1), y: mmToNm(10) }, size: mmToNm(0.8), drill: mmToNm(0.4), netId: 1, layers: ["copperTop", "copperBottom"], source: "autorouter" });
  return board;
}
