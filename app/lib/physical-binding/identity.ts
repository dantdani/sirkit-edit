import { physicalBindingId } from "./stable";
import type { PhysicalBindingScope, StableComponentIdentity } from "./types";

function required(value: string, code: string): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(code);
  return normalized;
}

export function nativeComponentIdentity(scope: PhysicalBindingScope): StableComponentIdentity {
  return {
    identityKind: "schematic_component_instance",
    componentInstanceId: required(scope.componentInstanceId, "PHYSICAL_COMPONENT_ID_INVALID"),
    projectId: required(scope.projectId, "PHYSICAL_PROJECT_ID_INVALID"),
    branchId: required(scope.branchId, "PHYSICAL_BRANCH_ID_INVALID"),
    boardInstanceId: required(scope.boardInstanceId, "PHYSICAL_BOARD_ID_INVALID"),
    hierarchyPath: scope.hierarchyPath.map((part) => required(part, "PHYSICAL_HIERARCHY_PATH_INVALID")),
    origin: { kind: "native", sourceInstanceId: scope.componentInstanceId },
  };
}

export function reconcileLegacyComponentIdentity(input: Omit<PhysicalBindingScope, "componentInstanceId"> & { sourceLocator: string; sourceStableId?: string }): StableComponentIdentity {
  const sourceLocator = required(input.sourceLocator, "PHYSICAL_LEGACY_LOCATOR_INVALID");
  const reconciliationKey = physicalBindingId("legacy-component", {
    projectId: input.projectId,
    branchId: input.branchId,
    boardInstanceId: input.boardInstanceId,
    hierarchyPath: input.hierarchyPath,
    sourceLocator,
    sourceStableId: input.sourceStableId,
  });
  return {
    identityKind: "schematic_component_instance",
    componentInstanceId: input.sourceStableId?.trim() || reconciliationKey,
    projectId: required(input.projectId, "PHYSICAL_PROJECT_ID_INVALID"),
    branchId: required(input.branchId, "PHYSICAL_BRANCH_ID_INVALID"),
    boardInstanceId: required(input.boardInstanceId, "PHYSICAL_BOARD_ID_INVALID"),
    hierarchyPath: input.hierarchyPath.map((part) => required(part, "PHYSICAL_HIERARCHY_PATH_INVALID")),
    origin: { kind: "legacy_reconciled", reconciliationKey, sourceLocator },
  };
}

export function copiedComponentIdentity(source: StableComponentIdentity, newComponentInstanceId: string, copyOperationId: string): StableComponentIdentity {
  const next = required(newComponentInstanceId, "PHYSICAL_COPY_COMPONENT_ID_INVALID");
  if (next === source.componentInstanceId) throw new Error("PHYSICAL_COPY_REQUIRES_NEW_IDENTITY");
  return { ...source, componentInstanceId: next, origin: { kind: "copied", sourceComponentInstanceId: source.componentInstanceId, copyOperationId: required(copyOperationId, "PHYSICAL_COPY_OPERATION_INVALID") } };
}
