# B16.0.17.2 §A — Pre-edit schema drift (reproduced, CONFIRMED)

## The mismatch, recorded before any edit

Schema node (pre-edit):

```
referencedSemanticObjectIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 512 }
targetObjectIds:             { type: "array", items: { type: "string", minLength: 1 }, maxItems: 32 }
```

Validator (pre-edit) — hard-coded arguments:

```
stringArray("referencedSemanticObjectIds", ..., P.referencedSemanticObjectIds.maxItems, 4096, 1);
stringArray(`proposedActions[${index}].targetObjectIds`, ..., ACTION.targetObjectIds.maxItems, 4096, 1);
```

## Runtime reproduction

```
schema referencedSemanticObjectIds.items: {"type":"string","minLength":1}
validator on 4097-char id: REFUSED (referencedSemanticObjectIds: items must be strings of 1..4096 chars)
DRIFT CONFIRMED: true
```

The provider-facing strict schema permitted arbitrarily long id strings; the
local validator refused anything over 4,096 — the two contracts disagreed, and
the B16.0.17.1 claim that every limit was schema-derived was overstated for
these two nodes. (All OTHER limits — maxItems, rationale min/max,
assumption/warning maxLength, both enums, required sets, additionalProperties —
were already schema-derived; the defect is exactly the two id-item lengths.)
