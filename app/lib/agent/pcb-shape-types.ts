/**
 * B11.3 §A — the descriptor IR shared by the generator
 * (`scripts/generate-pcb-shape-descriptor.ts`) and the runtime projector
 * (`pcb-shape-projection.ts`).
 *
 * This file declares the SHAPE OF THE DESCRIPTOR, not any PCB type. It is
 * deliberately tiny and PCB-agnostic: every fact about what a PCB object may
 * contain lives in the generated descriptor, which is derived from
 * `app/lib/pcb/types.ts` by the TypeScript type checker. There is no second,
 * hand-written PCB key table anywhere in replay validation.
 */

export const PCB_SHAPE_DESCRIPTOR_SCHEMA = "sirkit.pcb-shape-descriptor.v1" as const;

export type PcbShapeNode =
  | { k: "string" }
  | { k: "number" }
  | { k: "boolean" }
  | { k: "null" }
  | { k: "literal"; v: string | number | boolean }
  | { k: "array"; item: PcbShapeNode }
  | { k: "tuple"; items: readonly PcbShapeNode[] }
  | {
      k: "object";
      props: ReadonlyArray<{ name: string; optional: boolean; type: PcbShapeNode }>;
      /** Non-null ONLY where the authoritative type has an index signature or
       *  is a `Record<…>`; dynamic keys are legal nowhere else. `key: "number"`
       *  (from `Record<number, V>`) additionally requires each key to be a
       *  canonical safe-integer string, which is what such a record becomes in
       *  JSON. */
      index: { key: "string" | "number"; of: PcbShapeNode } | null;
    }
  | { k: "union"; discriminant: string | null; variants: readonly PcbShapeNode[] }
  | { k: "ref"; id: string };

export interface PcbShapeDescriptor {
  schema: typeof PCB_SHAPE_DESCRIPTOR_SCHEMA;
  /** Node id of `PcbBoard`. */
  root: string;
  /** `<repo-relative file>#<TypeName>` → node. */
  nodes: Readonly<Record<string, PcbShapeNode>>;
  /** Repo-relative files that contributed a named type. */
  sources: readonly string[];
}
