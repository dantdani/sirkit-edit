/**
 * [PR-J, 2026-10-22] Runbook section J increment 2 (J.5; OD-255 items 2, 3, 5): GOLDEN byte identity of every whole-project
 * consumer for a document WITHOUT sheets. Every digest below was computed at 5bf1e599 plus builder A's sheet library, with the
 * consumers still unmodified (their own legacy unions), BEFORE they moved onto `resolveProjectConnectivity`; the moved consumers
 * must reproduce them byte for byte. Fixtures: the fixture blinker, the fixture drone (41 instances), the LED dimmer the M1 / M4
 * journeys open, the same dimmer with two different ground-kind names (AGND / DGND: the legacy collapse to one GND net and one ERC
 * ground node is KEPT for single-sheet documents, OD-255 item 3), and a Theory design with AGND / DGND labels.
 *
 * Consumers pinned: the PCB netlist and its hash, the publication graph (bytes and source digest), the ERC's logical netlist, the
 * ERC report, the drawn-netlist validation, the design checks, the AI review input, the missing-parts list and the Prepare PCB
 * preflight read, the BOM rows, and the agent-delete connectivity refusal for every component.
 * Pure / in-memory: no network; the BOM's catalog reads see an empty mocked database.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db/client", () => {
  // every query chain resolves to no rows: the part catalog is empty and the BOM still builds (pricing "none": no vendor call)
  const chain: unknown = new Proxy(function query() {}, { get: (_target, key) => (key === "then" ? (resolve: (rows: unknown[]) => void) => resolve([]) : chain), apply: () => chain });
  return { getDb: () => chain };
});

import { buildBom } from "@/app/lib/bom/build";
import { agentDeleteConnectivityRefusal } from "@/app/lib/engineering/agent-delete-connectivity";
import { planSchematicDelete } from "@/app/lib/engineering/schematic-plans";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { CachedPart } from "@/app/lib/parts-cache";
import { buildNetlist, buildPcbSyncPublicationGraph, netlistHash } from "@/app/lib/pcb/netlist-bridge";
import { buildPcbSyncPreflightReport } from "@/app/lib/pcb-sync/preflight-read";
import { listUnresolvedInstances } from "@/app/lib/pcb-sync/unresolved-instances";
import { computeDesignChecks } from "@/app/lib/schematic/design-checks";
import { runErc } from "@/lib/erc";
import { buildReviewInput } from "@/lib/netlist-review";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import { validateSchematicNetlist } from "@/lib/validate-netlist";
import { blinkerFixtureState, droneFixtureState, fixturePartLookup, fixtureParts, theoryLegacyFixture } from "./_j1-fixtures";
import { dimmerFixtureState, groundKindDimmerState } from "./_j2-fixtures";

const sha = (value: unknown): string => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/** Every whole-project consumer's output for one document, as byte digests (plus the netlist hash and the publication digest). */
async function consumerOutputs(state: SchematicState): Promise<Record<string, string>> {
  const lookup = fixturePartLookup();
  const parts: Map<string, CachedPart> = fixtureParts();
  const ercParts = new Map([...parts.entries()].map(([id, part]) => [id, { name: part.name, pins: part.pins }] as const));
  const netlist = buildNetlist(state, lookup);
  // the publication refuses a document with an instance it cannot publish (the dimmer's D1 / D2): the refusal is the output
  let publication: ReturnType<typeof buildPcbSyncPublicationGraph> | { refused: string };
  try { publication = buildPcbSyncPublicationGraph(state, lookup); } catch (error) { publication = { refused: (error as Error).message }; }
  const logical = schematicToBuildNetlist(state, parts);
  const bom = await buildBom(state, "none");
  const pinsByPartId = new Map<string, readonly KicadPin[]>([...parts.entries()].map(([id, part]) => [id, part.pins] as const));
  const deletions = [
    ...state.components.map((item) => ({ family: "theory" as const, componentId: item.id, pins: undefined })),
    ...(state.kicadComponents ?? []).map((item) => ({ family: "kicad" as const, componentId: item.id, pins: parts.get(item.partId)?.pins })),
  ].map((target) => {
    const planned = planSchematicDelete(state, { family: target.family, componentId: target.componentId }, target.pins);
    return planned.ok ? `${target.componentId}:${agentDeleteConnectivityRefusal(state, [planned.plan], pinsByPartId) ?? "allowed"}` : `${target.componentId}:${planned.refusal}`;
  });
  return {
    netlist: sha(netlist),
    netlistHash: netlistHash(netlist),
    publication: sha(publication),
    publicationSourceDigest: "sourceDigest" in publication ? publication.sourceDigest : publication.refused,
    logicalNetlist: sha(logical),
    erc: sha(runErc(logical, ercParts)),
    validation: sha(validateSchematicNetlist(logical, state, parts)),
    designChecks: sha(computeDesignChecks(state, parts, "golden", "build")),
    review: sha(buildReviewInput(state, parts)),
    unresolved: sha(listUnresolvedInstances(state)),
    preflight: sha(buildPcbSyncPreflightReport(state)),
    bomRows: sha(bom.rows),
    agentDelete: sha(deletions),
  };
}

const GOLDEN: Record<string, Record<string, string>> = {
  "blinker": { netlist: "0a7ee14d0075c6236f4cab81727990996b6d77c27918bf0c88b951497cbc0d7d", netlistHash: "1doq5yp", publication: "3b9ba6003651588d58c9c3f0b6393174e754dd0b21f838b806a0192299f91ece", publicationSourceDigest: "pb1-7642e1298827e8de1b859ad6329912a64127ea51e332fc55aad32856349bd768", logicalNetlist: "db621d443479720a1fd5366a9ff97f34aa7ef5d053095e5b7664651f68340180", erc: "5511f9b9ffb9297463079f83a84b62aba69519f17da6301dd020113dbafda865", validation: "abb08c41766b01cbcfb1bf8bdb4b0575841c568999bd7e3a66b10955d2ef51ea", designChecks: "feead9c8f266ed868b1a857bf42f219d958fd9f8a27e5321831e9e3038371558", review: "82fffed0487bae250828d37477e5ffebb43f5176ab7daddff69275b263389d8a", unresolved: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", preflight: "f0a7f3814fafc417f51fc48bb525032ec3176085f49095bda7431f5da3580f10", bomRows: "c3ebe85fbdd3d2d3cf75910faef55f8dc33da3e5c72397b3e792176e6403adb2", agentDelete: "b2d72e034bd76cded7d97c5e971f90f4d571239c394d80898e5d344cb59e48d8" },
  "drone": { netlist: "55bf26f29223318903143d9e8207f0953988ec1d535e8c1a098224f1dbb6c2c1", netlistHash: "1q8sbo0", publication: "aa2918db3d2183e0742d982fcfa59e8eeb18db64600c48a105eabfa83a3b3a5b", publicationSourceDigest: "pb1-883659da1f6412a3d92f0ab23ad07a03a7e6405473a884b682ac0d38b41205d6", logicalNetlist: "39f7c5c7d3ece2f4ed5c6b4083232640a26fadf92b941acc1ab2c56778edbe0a", erc: "e1c82ed047478e9a165ae3eea967f21114f2b6941eab2564479eb8d7e9972d15", validation: "abb08c41766b01cbcfb1bf8bdb4b0575841c568999bd7e3a66b10955d2ef51ea", designChecks: "03c00796e074933eb6e04d9a1069546b3dc9266cf575022fea987e2e4c962a60", review: "0479c624c118c2a7762990d1f81175fc24159cb3715db719c34f70f5fd164d62", unresolved: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", preflight: "e90e822b7cfb935a9dc353e8a348085aa2fbdc8eea0e830c58d31d33bba38f1f", bomRows: "72659b84bd3b16d4062ce37abd2db4e249ad80e8549978fec032909250765b2e", agentDelete: "ac63b3470cfa9f1f3f0388f70de5bbcb468d4fb6d654b2eace137395b6d1f057" },
  "dimmer": { netlist: "e4eb62dde4060810cc2d464f2b5bd458b3592c0821ab15f6804b8e6f58af6272", netlistHash: "ubt5o5", publication: "75229335bb82f264634794d9937b45bfb7cec2fb762f876e33f36fa44ee21523", publicationSourceDigest: "PS_SYMBOL_ASSET_REQUIRED", logicalNetlist: "a3750021ea1b53e6d0dc782e51ada8a47282bf7dbbc3ea5f80e704aebdbbc98e", erc: "5511f9b9ffb9297463079f83a84b62aba69519f17da6301dd020113dbafda865", validation: "16b9d74f4db59232f1137e21625374e433b68be013eb617ad04eeea5fe584175", designChecks: "adb0e318238f693028d0d994e448e085afd8a2067d5299cf22513f55e072c5f0", review: "8c6246de13e593594e4159c57a27084ea5fea9346873dc14c188e096180be95f", unresolved: "7f253bd34a8ad5de1d179425604267b861bae42baa033e2487d8e279a6f42104", preflight: "310fc6185ffbd6c4ea5ddb4efd6f904de9d1d94e88bfefd11a8999e87f5d69cc", bomRows: "ca260e756bb29b64a367453c840857c2b382e0d4be4e5ea61260f6601a266391", agentDelete: "17c2e03f081463d443c83fd157938d2662f94bd8255e65a95dd56f673b7e67d8" },
  "ground-kind dimmer": { netlist: "e4eb62dde4060810cc2d464f2b5bd458b3592c0821ab15f6804b8e6f58af6272", netlistHash: "ubt5o5", publication: "75229335bb82f264634794d9937b45bfb7cec2fb762f876e33f36fa44ee21523", publicationSourceDigest: "PS_SYMBOL_ASSET_REQUIRED", logicalNetlist: "abf211fe437383ab6618b5240a02b0271ca854a4535e23803aa4acab1df0d70d", erc: "5511f9b9ffb9297463079f83a84b62aba69519f17da6301dd020113dbafda865", validation: "31fea77c4e888a10e0651077d4116465fd0762022750556dda80c0222ec7ca75", designChecks: "85e64e5cbd07a40a52abfae718042de8c07290fb931ea624fe4ba9057f19040f", review: "bd09d55991531dc38d531259ee0815e8bdb1d0028d26c7a2687de47ae7975650", unresolved: "7f253bd34a8ad5de1d179425604267b861bae42baa033e2487d8e279a6f42104", preflight: "310fc6185ffbd6c4ea5ddb4efd6f904de9d1d94e88bfefd11a8999e87f5d69cc", bomRows: "ca260e756bb29b64a367453c840857c2b382e0d4be4e5ea61260f6601a266391", agentDelete: "17c2e03f081463d443c83fd157938d2662f94bd8255e65a95dd56f673b7e67d8" },
  "theory": { netlist: "3e6e2d53303775d02c4a58fdd888a80241c7b193dd196ebe11b5fcf114c16894", netlistHash: "c9w17x", publication: "a93332652d1fbb1680c0eb1233cca985f1f0bb7f819766fc679dc5ce95488a6a", publicationSourceDigest: "pb1-69104bfd3cd8950edb43176da3d79261e40d0dc2b59200af4f1844391a1247a4", logicalNetlist: "cc7c4b2ad19ae5c567a5364730c7a6e1942147dd9565e2798f485ce6a5a67f2d", erc: "5511f9b9ffb9297463079f83a84b62aba69519f17da6301dd020113dbafda865", validation: "a0fa334af0c0d56d737e51de0ed5e34da0f45580269cc0de338d4b2120a40a0c", designChecks: "ca773179fe44beed1f4975a3dec8d76950d2ddc27f5a723e43b82c8e0b70cb7f", review: "4fe4806374650c493888ab94932dc18c1ad12814cfe8b4f690a4a944b4ba2731", unresolved: "c8d5590bf6fab17a08752058c86d7d663298c25d6be4f061ae40a21a20c879cc", preflight: "be0fd4b7722e4cd98a9f3c194205906c9f348525058541ae849bb2ab3701e2fe", bomRows: "ed7678b0c7bb6163dcb61bf8fdec03791925d85e3bb12c4efa2a0267efb3e217", agentDelete: "ee7db54e840ae0cbe67965ed09fbb7dd75a743c990d339bce8ad90e0972de683" },
};

const FIXTURES: Array<[string, () => SchematicState]> = [
  ["blinker", blinkerFixtureState],
  ["drone", droneFixtureState],
  ["dimmer", dimmerFixtureState],
  ["ground-kind dimmer", groundKindDimmerState],
  ["theory", theoryLegacyFixture],
];

describe("[PR-J J2] a document without sheets: every whole-project consumer's output is byte-identical to before section J", () => {
  it.each(FIXTURES)("%s", async (name, make) => {
    expect(await consumerOutputs(make())).toEqual(GOLDEN[name]);
  });
});
