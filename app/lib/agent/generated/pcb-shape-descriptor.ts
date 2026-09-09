/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by `scripts/generate-pcb-shape-descriptor.ts` from the TypeScript
 * type graph reachable from `app/lib/pcb/types.ts:PcbBoard`, using the
 * compiler API and type checker.
 *
 * Regenerate:  npx tsx scripts/generate-pcb-shape-descriptor.ts
 * CI gate:     npx tsx scripts/generate-pcb-shape-descriptor.ts --check
 *
 * `PCB_SHAPE_SOURCE_DIGEST` covers the exact bytes of every contributing
 * source file; `PCB_SHAPE_GRAPH_DIGEST` covers the emitted descriptor. A
 * change to any reachable PCB type moves both and fails CI until regenerated.
 */

import type { PcbShapeDescriptor } from "../pcb-shape-types";

export const PCB_SHAPE_SOURCE_DIGEST = "sha256-2e288db73b140196e5125bf2dc58b1c2" as const;
export const PCB_SHAPE_GRAPH_DIGEST = "sha256-60bb78027e4136117ba0212bc39cde1f" as const;

export const PCB_SHAPE_DESCRIPTOR: PcbShapeDescriptor = {
  "nodes": {
    "app/lib/constraints/types.ts#BoardConstraintState": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "activeEvaluation",
          "optional": true,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintEvaluationReport",
            "k": "ref"
          }
        },
        {
          "name": "activeProgram",
          "optional": true,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintProgram",
            "k": "ref"
          }
        },
        {
          "name": "documents",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#ConstraintDocument",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "history",
          "optional": false,
          "type": {
            "item": {
              "index": null,
              "k": "object",
              "props": [
                {
                  "name": "action",
                  "optional": false,
                  "type": {
                    "discriminant": null,
                    "k": "union",
                    "variants": [
                      {
                        "k": "literal",
                        "v": "activate"
                      },
                      {
                        "k": "literal",
                        "v": "revert"
                      }
                    ]
                  }
                },
                {
                  "name": "actorId",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "documentSnapshot",
                  "optional": true,
                  "type": {
                    "item": {
                      "id": "app/lib/constraints/types.ts#ConstraintDocument",
                      "k": "ref"
                    },
                    "k": "array"
                  }
                },
                {
                  "name": "fromProgramHash",
                  "optional": true,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "id",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "programSnapshot",
                  "optional": true,
                  "type": {
                    "id": "app/lib/constraints/types.ts#ConstraintProgram",
                    "k": "ref"
                  }
                },
                {
                  "name": "toProgramHash",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                }
              ]
            },
            "k": "array"
          }
        },
        {
          "name": "legacyMigration",
          "optional": false,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "sourceHash",
                "optional": false,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "version",
                "optional": false,
                "type": {
                  "k": "literal",
                  "v": 1
                }
              }
            ]
          }
        },
        {
          "name": "projectId",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "schemaVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        },
        {
          "name": "waivers",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#ConstraintWaiver",
              "k": "ref"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#CardinalityExpectation": {
      "discriminant": "kind",
      "k": "union",
      "variants": [
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "zero_or_more"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "count",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "exactly"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "count",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "at_least"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "count",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "at_most"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "exactly_two_ordered"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "one_per_member"
              }
            },
            {
              "name": "relationshipId",
              "optional": false,
              "type": {
                "k": "string"
              }
            }
          ]
        }
      ]
    },
    "app/lib/constraints/types.ts#ConditionExpression": {
      "discriminant": "kind",
      "k": "union",
      "variants": [
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "literal"
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#TruthValue",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "factId",
              "optional": false,
              "type": {
                "k": "string"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "fact_truth"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "factId",
              "optional": false,
              "type": {
                "k": "string"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "fact_equals"
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintScalar",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "factId",
              "optional": false,
              "type": {
                "k": "string"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "fact_compare"
              }
            },
            {
              "name": "operator",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "lt"
                  },
                  {
                    "k": "literal",
                    "v": "lte"
                  },
                  {
                    "k": "literal",
                    "v": "gt"
                  },
                  {
                    "k": "literal",
                    "v": "gte"
                  }
                ]
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "expression",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConditionExpression",
                "k": "ref"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "not"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "expressions",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/constraints/types.ts#ConditionExpression",
                  "k": "ref"
                },
                "k": "array"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "and"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "expressions",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/constraints/types.ts#ConditionExpression",
                  "k": "ref"
                },
                "k": "array"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "or"
              }
            }
          ]
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintConflict": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "code",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "constraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "explanation",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintKind",
            "k": "ref"
          }
        },
        {
          "name": "nextActions",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "normalizedValues",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "targetId",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintDefinition": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "condition",
          "optional": true,
          "type": {
            "discriminant": "kind",
            "k": "union",
            "variants": [
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "literal"
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#TruthValue",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "factId",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  },
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "fact_truth"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "factId",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  },
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "fact_equals"
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintScalar",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "factId",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  },
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "fact_compare"
                    }
                  },
                  {
                    "name": "operator",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "k": "literal",
                          "v": "lt"
                        },
                        {
                          "k": "literal",
                          "v": "lte"
                        },
                        {
                          "k": "literal",
                          "v": "gt"
                        },
                        {
                          "k": "literal",
                          "v": "gte"
                        }
                      ]
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "expression",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConditionExpression",
                      "k": "ref"
                    }
                  },
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "not"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "expressions",
                    "optional": false,
                    "type": {
                      "item": {
                        "id": "app/lib/constraints/types.ts#ConditionExpression",
                        "k": "ref"
                      },
                      "k": "array"
                    }
                  },
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "and"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "expressions",
                    "optional": false,
                    "type": {
                      "item": {
                        "id": "app/lib/constraints/types.ts#ConditionExpression",
                        "k": "ref"
                      },
                      "k": "array"
                    }
                  },
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "or"
                    }
                  }
                ]
              }
            ]
          }
        },
        {
          "name": "description",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "domain",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintDomain",
            "k": "ref"
          }
        },
        {
          "name": "evidenceIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintKind",
            "k": "ref"
          }
        },
        {
          "name": "lifecycle",
          "optional": false,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "state",
                "optional": false,
                "type": {
                  "id": "app/lib/constraints/types.ts#ConstraintLifecycleState",
                  "k": "ref"
                }
              },
              {
                "name": "supersedesRevisionId",
                "optional": true,
                "type": {
                  "k": "string"
                }
              }
            ]
          }
        },
        {
          "name": "lineage",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "derivedFromIds",
                "optional": true,
                "type": {
                  "item": {
                    "k": "string"
                  },
                  "k": "array"
                }
              },
              {
                "name": "extendsSetIds",
                "optional": true,
                "type": {
                  "item": {
                    "k": "string"
                  },
                  "k": "array"
                }
              },
              {
                "name": "refinesConstraintIds",
                "optional": true,
                "type": {
                  "item": {
                    "k": "string"
                  },
                  "k": "array"
                }
              },
              {
                "name": "replacesConstraintIds",
                "optional": true,
                "type": {
                  "item": {
                    "k": "string"
                  },
                  "k": "array"
                }
              }
            ]
          }
        },
        {
          "name": "name",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "origin",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintOrigin",
            "k": "ref"
          }
        },
        {
          "name": "requirement",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#TypedRequirement",
            "k": "ref"
          }
        },
        {
          "name": "revision",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "scope",
          "optional": false,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "id",
                "optional": true,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "path",
                "optional": true,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "type",
                "optional": false,
                "type": {
                  "id": "app/lib/constraints/types.ts#ConstraintObjectType",
                  "k": "ref"
                }
              }
            ]
          }
        },
        {
          "name": "selector",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#TypedSelector",
            "k": "ref"
          }
        },
        {
          "name": "severityPolicyId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "sourceLocation",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "column",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "line",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "path",
                "optional": true,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "sourceId",
                "optional": false,
                "type": {
                  "k": "string"
                }
              }
            ]
          }
        },
        {
          "name": "strength",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintStrength",
            "k": "ref"
          }
        },
        {
          "name": "waiverPolicy",
          "optional": false,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "authorizationPolicyId",
                "optional": true,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "eligible",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": true
                    },
                    {
                      "k": "literal",
                      "v": false
                    }
                  ]
                }
              },
              {
                "name": "reason",
                "optional": true,
                "type": {
                  "k": "string"
                }
              }
            ]
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintDiagnostic": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "code",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "constraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "message",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "nextActions",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "severity",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "info"
              },
              {
                "k": "literal",
                "v": "warning"
              },
              {
                "k": "literal",
                "v": "error"
              }
            ]
          }
        },
        {
          "name": "sourceLocations",
          "optional": false,
          "type": {
            "item": {
              "index": null,
              "k": "object",
              "props": [
                {
                  "name": "column",
                  "optional": true,
                  "type": {
                    "k": "number"
                  }
                },
                {
                  "name": "line",
                  "optional": true,
                  "type": {
                    "k": "number"
                  }
                },
                {
                  "name": "path",
                  "optional": true,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "sourceId",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                }
              ]
            },
            "k": "array"
          }
        },
        {
          "name": "targetIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintDocument": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "constraints",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#ConstraintDefinition",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "description",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "extendsSetIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "name",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "relationships",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#ConstraintRelationship",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "revision",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "schemaVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintDomain": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "component"
        },
        {
          "k": "literal",
          "v": "sourcing"
        },
        {
          "k": "literal",
          "v": "schematic"
        },
        {
          "k": "literal",
          "v": "application"
        },
        {
          "k": "literal",
          "v": "manufacturing"
        },
        {
          "k": "literal",
          "v": "pcb_geometry"
        },
        {
          "k": "literal",
          "v": "routing"
        },
        {
          "k": "literal",
          "v": "placement"
        },
        {
          "k": "literal",
          "v": "release"
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintEvaluationReport": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "designRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "evaluationHash",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "programHash",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "readinessState",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "stale"
              },
              {
                "k": "literal",
                "v": "verification_incomplete"
              },
              {
                "k": "literal",
                "v": "satisfied"
              },
              {
                "k": "literal",
                "v": "blocked"
              }
            ]
          }
        },
        {
          "name": "schemaVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        },
        {
          "name": "states",
          "optional": false,
          "type": {
            "item": {
              "index": null,
              "k": "object",
              "props": [
                {
                  "name": "constraintId",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "consumerId",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "state",
                  "optional": false,
                  "type": {
                    "id": "app/lib/constraints/types.ts#ConstraintEvaluationState",
                    "k": "ref"
                  }
                },
                {
                  "name": "targetIds",
                  "optional": false,
                  "type": {
                    "item": {
                      "k": "string"
                    },
                    "k": "array"
                  }
                },
                {
                  "name": "violationIds",
                  "optional": false,
                  "type": {
                    "item": {
                      "k": "string"
                    },
                    "k": "array"
                  }
                }
              ]
            },
            "k": "array"
          }
        },
        {
          "name": "violations",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#ConstraintViolation",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "waivers",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#ConstraintWaiver",
              "k": "ref"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintEvaluationState": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "unsupported"
        },
        {
          "k": "literal",
          "v": "stale"
        },
        {
          "k": "literal",
          "v": "unknown"
        },
        {
          "k": "literal",
          "v": "not_applicable"
        },
        {
          "k": "literal",
          "v": "pass"
        },
        {
          "k": "literal",
          "v": "fail"
        },
        {
          "k": "literal",
          "v": "not_run"
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintKind": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "clearance"
        },
        {
          "k": "literal",
          "v": "component_category"
        },
        {
          "k": "literal",
          "v": "approved_part"
        },
        {
          "k": "literal",
          "v": "forbidden_part"
        },
        {
          "k": "literal",
          "v": "package_restriction"
        },
        {
          "k": "literal",
          "v": "qualification"
        },
        {
          "k": "literal",
          "v": "source_freshness"
        },
        {
          "k": "literal",
          "v": "voltage_operating_range"
        },
        {
          "k": "literal",
          "v": "voltage_absolute_maximum"
        },
        {
          "k": "literal",
          "v": "current_budget"
        },
        {
          "k": "literal",
          "v": "terminal_connection"
        },
        {
          "k": "literal",
          "v": "decoupling"
        },
        {
          "k": "literal",
          "v": "exposed_pad_connection"
        },
        {
          "k": "literal",
          "v": "dnc_connection"
        },
        {
          "k": "literal",
          "v": "programming_access"
        },
        {
          "k": "literal",
          "v": "trace_width"
        },
        {
          "k": "literal",
          "v": "same_net_feature"
        },
        {
          "k": "literal",
          "v": "via_diameter"
        },
        {
          "k": "literal",
          "v": "via_drill"
        },
        {
          "k": "literal",
          "v": "annular_ring"
        },
        {
          "k": "literal",
          "v": "pth_annular_ring"
        },
        {
          "k": "literal",
          "v": "hole_clearance"
        },
        {
          "k": "literal",
          "v": "edge_clearance"
        },
        {
          "k": "literal",
          "v": "mask_clearance"
        },
        {
          "k": "literal",
          "v": "paste_rule"
        },
        {
          "k": "literal",
          "v": "silk_clearance"
        },
        {
          "k": "literal",
          "v": "courtyard_clearance"
        },
        {
          "k": "literal",
          "v": "allowed_layers"
        },
        {
          "k": "literal",
          "v": "forbidden_layers"
        },
        {
          "k": "literal",
          "v": "preferred_layers"
        },
        {
          "k": "literal",
          "v": "via_type"
        },
        {
          "k": "literal",
          "v": "via_span"
        },
        {
          "k": "literal",
          "v": "via_count"
        },
        {
          "k": "literal",
          "v": "zone_connection"
        },
        {
          "k": "literal",
          "v": "zone_thermal_gap"
        },
        {
          "k": "literal",
          "v": "zone_thermal_spokes"
        },
        {
          "k": "literal",
          "v": "zone_island_area"
        },
        {
          "k": "literal",
          "v": "keepout"
        },
        {
          "k": "literal",
          "v": "differential_pair"
        },
        {
          "k": "literal",
          "v": "target_impedance"
        },
        {
          "k": "literal",
          "v": "route_length"
        },
        {
          "k": "literal",
          "v": "pair_skew"
        },
        {
          "k": "literal",
          "v": "bus_match"
        },
        {
          "k": "literal",
          "v": "topology"
        },
        {
          "k": "literal",
          "v": "return_reference"
        },
        {
          "k": "literal",
          "v": "placement_fixed"
        },
        {
          "k": "literal",
          "v": "placement_side"
        },
        {
          "k": "literal",
          "v": "placement_orientation"
        },
        {
          "k": "literal",
          "v": "placement_region"
        },
        {
          "k": "literal",
          "v": "placement_proximity"
        },
        {
          "k": "literal",
          "v": "placement_separation"
        },
        {
          "k": "literal",
          "v": "placement_group"
        },
        {
          "k": "literal",
          "v": "critical_loop"
        },
        {
          "k": "literal",
          "v": "thermal_relation"
        },
        {
          "k": "literal",
          "v": "test_access"
        },
        {
          "k": "literal",
          "v": "require_checker"
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintLifecycleState": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "draft"
        },
        {
          "k": "literal",
          "v": "active"
        },
        {
          "k": "literal",
          "v": "deprecated"
        },
        {
          "k": "literal",
          "v": "superseded"
        },
        {
          "k": "literal",
          "v": "revoked"
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintLowerings": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "componentSelectionRules",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#EffectiveConstraintRule",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "kicadConstraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "physicalByTarget",
          "optional": false,
          "type": {
            "index": {
              "key": "string",
              "of": {
                "id": "app/lib/constraints/types.ts#LoweredPhysicalRule",
                "k": "ref"
              }
            },
            "k": "object",
            "props": []
          }
        },
        {
          "name": "placementGraph",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#LoweredRelationshipRule",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "readinessConstraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "routingGraph",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#LoweredRelationshipRule",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "schematicRules",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#EffectiveConstraintRule",
              "k": "ref"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintObjectType": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "plane"
        },
        {
          "k": "literal",
          "v": "via"
        },
        {
          "k": "literal",
          "v": "component"
        },
        {
          "k": "literal",
          "v": "keepout"
        },
        {
          "k": "literal",
          "v": "differential_pair"
        },
        {
          "k": "literal",
          "v": "organization"
        },
        {
          "k": "literal",
          "v": "catalog"
        },
        {
          "k": "literal",
          "v": "manufacturing_profile"
        },
        {
          "k": "literal",
          "v": "project"
        },
        {
          "k": "literal",
          "v": "variant"
        },
        {
          "k": "literal",
          "v": "sheet"
        },
        {
          "k": "literal",
          "v": "block"
        },
        {
          "k": "literal",
          "v": "atomic_part"
        },
        {
          "k": "literal",
          "v": "terminal"
        },
        {
          "k": "literal",
          "v": "pin"
        },
        {
          "k": "literal",
          "v": "pad"
        },
        {
          "k": "literal",
          "v": "rail"
        },
        {
          "k": "literal",
          "v": "net"
        },
        {
          "k": "literal",
          "v": "net_class"
        },
        {
          "k": "literal",
          "v": "interface"
        },
        {
          "k": "literal",
          "v": "bus"
        },
        {
          "k": "literal",
          "v": "board"
        },
        {
          "k": "literal",
          "v": "layer"
        },
        {
          "k": "literal",
          "v": "region"
        },
        {
          "k": "literal",
          "v": "footprint"
        },
        {
          "k": "literal",
          "v": "track"
        },
        {
          "k": "literal",
          "v": "zone"
        },
        {
          "k": "literal",
          "v": "hole"
        },
        {
          "k": "literal",
          "v": "diagnostic"
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintOrigin": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "actorId",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "confidence",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "user"
              },
              {
                "k": "literal",
                "v": "manufacturing_profile"
              },
              {
                "k": "literal",
                "v": "project"
              },
              {
                "k": "literal",
                "v": "organization_policy"
              },
              {
                "k": "literal",
                "v": "legacy_import"
              },
              {
                "k": "literal",
                "v": "kicad_import"
              },
              {
                "k": "literal",
                "v": "stage5_guidance"
              },
              {
                "k": "literal",
                "v": "deterministic_inference"
              },
              {
                "k": "literal",
                "v": "ai_proposal"
              }
            ]
          }
        },
        {
          "name": "reviewState",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "proposed"
              },
              {
                "k": "literal",
                "v": "approved"
              },
              {
                "k": "literal",
                "v": "rejected"
              }
            ]
          }
        },
        {
          "name": "sourceId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "sourceRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintProgram": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "activeConstraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "catalogRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "compilerVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "sirkit-constraints/1.0.0"
          }
        },
        {
          "name": "conflicts",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#ConstraintConflict",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "coverage",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#EnforcementCoverage",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "designRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "diagnostics",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#ConstraintDiagnostic",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "effectiveRules",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#EffectiveConstraintRule",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "lowerings",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintLowerings",
            "k": "ref"
          }
        },
        {
          "name": "manufacturingProfileRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "mergePolicyVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "restrictive-algebra/1.0.0"
          }
        },
        {
          "name": "programHash",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "relationshipIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "schemaVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        },
        {
          "name": "sourceSetRevisions",
          "optional": false,
          "type": {
            "item": {
              "index": null,
              "k": "object",
              "props": [
                {
                  "name": "id",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "revision",
                  "optional": false,
                  "type": {
                    "k": "number"
                  }
                }
              ]
            },
            "k": "array"
          }
        },
        {
          "name": "targetSnapshots",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/constraints/types.ts#SelectorSnapshot",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "variantRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintQuantity": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "dimension",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#QuantityDimension",
            "k": "ref"
          }
        },
        {
          "name": "unit",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "value",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintRelationship": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "evidenceIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#RelationshipKind",
            "k": "ref"
          }
        },
        {
          "name": "lifecycle",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintLifecycleState",
            "k": "ref"
          }
        },
        {
          "name": "members",
          "optional": false,
          "type": {
            "item": {
              "index": null,
              "k": "object",
              "props": [
                {
                  "name": "order",
                  "optional": true,
                  "type": {
                    "k": "number"
                  }
                },
                {
                  "name": "role",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "targetId",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "targetType",
                  "optional": false,
                  "type": {
                    "id": "app/lib/constraints/types.ts#ConstraintObjectType",
                    "k": "ref"
                  }
                }
              ]
            },
            "k": "array"
          }
        },
        {
          "name": "origin",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintOrigin",
            "k": "ref"
          }
        },
        {
          "name": "revision",
          "optional": false,
          "type": {
            "k": "number"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintScalar": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "boolean"
        },
        {
          "k": "string"
        },
        {
          "id": "app/lib/constraints/types.ts#ConstraintQuantity",
          "k": "ref"
        },
        {
          "id": "app/lib/constraints/types.ts#IntegerValue",
          "k": "ref"
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintStrength": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "hard"
        },
        {
          "k": "literal",
          "v": "soft"
        },
        {
          "k": "literal",
          "v": "advisory"
        },
        {
          "k": "literal",
          "v": "assumption"
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintViolation": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "actual",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "boolean"
              },
              {
                "k": "string"
              },
              {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              },
              {
                "id": "app/lib/constraints/types.ts#IntegerValue",
                "k": "ref"
              }
            ]
          }
        },
        {
          "name": "checkerVersion",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "constraintId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "consumerId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "evidenceIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "message",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "nextAction",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "required",
          "optional": true,
          "type": {
            "discriminant": "form",
            "k": "union",
            "variants": [
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "minimum"
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "maximum"
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "range"
                    }
                  },
                  {
                    "name": "max",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  },
                  {
                    "name": "maxInclusive",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "k": "literal",
                          "v": true
                        },
                        {
                          "k": "literal",
                          "v": false
                        }
                      ]
                    }
                  },
                  {
                    "name": "min",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  },
                  {
                    "name": "minInclusive",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "k": "literal",
                          "v": true
                        },
                        {
                          "k": "literal",
                          "v": false
                        }
                      ]
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "equals"
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintScalar",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "not_equals"
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintScalar",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "allowed_set"
                    }
                  },
                  {
                    "name": "values",
                    "optional": false,
                    "type": {
                      "item": {
                        "id": "app/lib/constraints/types.ts#ConstraintScalar",
                        "k": "ref"
                      },
                      "k": "array"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "forbidden_set"
                    }
                  },
                  {
                    "name": "values",
                    "optional": false,
                    "type": {
                      "item": {
                        "id": "app/lib/constraints/types.ts#ConstraintScalar",
                        "k": "ref"
                      },
                      "k": "array"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "required_set"
                    }
                  },
                  {
                    "name": "values",
                    "optional": false,
                    "type": {
                      "item": {
                        "id": "app/lib/constraints/types.ts#ConstraintScalar",
                        "k": "ref"
                      },
                      "k": "array"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "cardinality",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#CardinalityExpectation",
                      "k": "ref"
                    }
                  },
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "must_exist"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "must_connect"
                    }
                  },
                  {
                    "name": "relationshipId",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "must_not_connect"
                    }
                  },
                  {
                    "name": "relationshipId",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "distance"
                    }
                  },
                  {
                    "name": "referenceIds",
                    "optional": false,
                    "type": {
                      "item": {
                        "k": "string"
                      },
                      "k": "array"
                    }
                  },
                  {
                    "name": "relation",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "k": "literal",
                          "v": "minimum"
                        },
                        {
                          "k": "literal",
                          "v": "maximum"
                        }
                      ]
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "containment"
                    }
                  },
                  {
                    "name": "mode",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "k": "literal",
                          "v": "inside"
                        },
                        {
                          "k": "literal",
                          "v": "outside"
                        }
                      ]
                    }
                  },
                  {
                    "name": "regionIds",
                    "optional": false,
                    "type": {
                      "item": {
                        "k": "string"
                      },
                      "k": "array"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "ordering"
                    }
                  },
                  {
                    "name": "orderedTargetIds",
                    "optional": false,
                    "type": {
                      "item": {
                        "k": "string"
                      },
                      "k": "array"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "aggregate",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "k": "literal",
                          "v": "sum"
                        },
                        {
                          "k": "literal",
                          "v": "count"
                        }
                      ]
                    }
                  },
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "budget"
                    }
                  },
                  {
                    "name": "limit",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                          "k": "ref"
                        },
                        {
                          "id": "app/lib/constraints/types.ts#IntegerValue",
                          "k": "ref"
                        }
                      ]
                    }
                  },
                  {
                    "name": "margin",
                    "optional": true,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "target"
                    }
                  },
                  {
                    "name": "toleranceMinus",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  },
                  {
                    "name": "tolerancePlus",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  },
                  {
                    "name": "value",
                    "optional": false,
                    "type": {
                      "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                      "k": "ref"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "direction",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "k": "literal",
                          "v": "minimize"
                        },
                        {
                          "k": "literal",
                          "v": "maximize"
                        }
                      ]
                    }
                  },
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "objective"
                    }
                  },
                  {
                    "name": "metric",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  },
                  {
                    "name": "weight",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "checkerId",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  },
                  {
                    "name": "form",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "require_coverage"
                    }
                  },
                  {
                    "name": "minimumSupport",
                    "optional": false,
                    "type": {
                      "discriminant": null,
                      "k": "union",
                      "variants": [
                        {
                          "k": "literal",
                          "v": "enforced"
                        },
                        {
                          "k": "literal",
                          "v": "compiled_for_consumer"
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        },
        {
          "name": "state",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintEvaluationState",
            "k": "ref"
          }
        },
        {
          "name": "targetIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#ConstraintWaiver": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "actorId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "authorizedBy",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "constraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "createdAt",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "designRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "expiresAt",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "invalidation",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "any_semantic_change"
          }
        },
        {
          "name": "programHash",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "reason",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "releaseProfileId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "schemaVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        },
        {
          "name": "targetIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "violationIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#EffectiveConstraintRule": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "conditionStates",
          "optional": false,
          "type": {
            "index": {
              "key": "string",
              "of": {
                "id": "app/lib/constraints/types.ts#TruthValue",
                "k": "ref"
              }
            },
            "k": "object",
            "props": []
          }
        },
        {
          "name": "contributingConstraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "domain",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintDomain",
            "k": "ref"
          }
        },
        {
          "name": "evidenceIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintKind",
            "k": "ref"
          }
        },
        {
          "name": "mergeSteps",
          "optional": false,
          "type": {
            "item": {
              "index": null,
              "k": "object",
              "props": [
                {
                  "name": "constraintIds",
                  "optional": false,
                  "type": {
                    "item": {
                      "k": "string"
                    },
                    "k": "array"
                  }
                },
                {
                  "name": "operation",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "result",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                }
              ]
            },
            "k": "array"
          }
        },
        {
          "name": "requirement",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#TypedRequirement",
            "k": "ref"
          }
        },
        {
          "name": "strength",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintStrength",
            "k": "ref"
          }
        },
        {
          "name": "targetId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "waiverEligible",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "waiverPolicyIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#EnforcementCoverage": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "checkerVersion",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "constraintId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "consumerId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "laterStage",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": 7
              },
              {
                "k": "literal",
                "v": 8
              },
              {
                "k": "literal",
                "v": 9
              },
              {
                "k": "literal",
                "v": 10
              }
            ]
          }
        },
        {
          "name": "readinessImpact",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "advisory"
              },
              {
                "k": "literal",
                "v": "blocking_failure"
              },
              {
                "k": "literal",
                "v": "verification_incomplete"
              },
              {
                "k": "literal",
                "v": "none"
              }
            ]
          }
        },
        {
          "name": "requiredInputs",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "support",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#EnforcementSupport",
            "k": "ref"
          }
        },
        {
          "name": "targetIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#EnforcementSupport": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "unsupported"
        },
        {
          "k": "literal",
          "v": "stale"
        },
        {
          "k": "literal",
          "v": "unknown"
        },
        {
          "k": "literal",
          "v": "enforced"
        },
        {
          "k": "literal",
          "v": "compiled_for_consumer"
        },
        {
          "k": "literal",
          "v": "declarative_only"
        },
        {
          "k": "literal",
          "v": "not_applicable"
        }
      ]
    },
    "app/lib/constraints/types.ts#IntegerValue": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "kind",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "integer"
          }
        },
        {
          "name": "value",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#LoweredPhysicalRule": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "allowedLayerIds",
          "optional": true,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "allowedViaSpans",
          "optional": true,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "allowedViaTypes",
          "optional": true,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "clearanceNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "constraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "forbiddenLayerIds",
          "optional": true,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "maxTrackWidthNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "maxViaCount",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minAnnularRingNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minCourtyardClearanceNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minEdgeClearanceNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minHoleToHoleNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minPthAnnularRingNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minSilkPadClearanceNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minTrackWidthNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minViaDrillNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minViaOuterNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "preferredLayerIds",
          "optional": true,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "programHash",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "targetId",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#LoweredRelationshipRule": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "constraintIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#RelationshipKind",
            "k": "ref"
          }
        },
        {
          "name": "memberIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "relationshipId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "support",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#EnforcementSupport",
            "k": "ref"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#QuantityDimension": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "power"
        },
        {
          "k": "literal",
          "v": "current"
        },
        {
          "k": "literal",
          "v": "dimensionless"
        },
        {
          "k": "literal",
          "v": "voltage"
        },
        {
          "k": "literal",
          "v": "resistance"
        },
        {
          "k": "literal",
          "v": "impedance"
        },
        {
          "k": "literal",
          "v": "capacitance"
        },
        {
          "k": "literal",
          "v": "inductance"
        },
        {
          "k": "literal",
          "v": "energy"
        },
        {
          "k": "literal",
          "v": "charge"
        },
        {
          "k": "literal",
          "v": "frequency"
        },
        {
          "k": "literal",
          "v": "time"
        },
        {
          "k": "literal",
          "v": "temperature"
        },
        {
          "k": "literal",
          "v": "length"
        },
        {
          "k": "literal",
          "v": "mass"
        }
      ]
    },
    "app/lib/constraints/types.ts#RelationshipKind": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "decoupling"
        },
        {
          "k": "literal",
          "v": "differential_pair"
        },
        {
          "k": "literal",
          "v": "return_reference"
        },
        {
          "k": "literal",
          "v": "placement_group"
        },
        {
          "k": "literal",
          "v": "rail_membership"
        },
        {
          "k": "literal",
          "v": "bus_membership"
        },
        {
          "k": "literal",
          "v": "current_loop"
        },
        {
          "k": "literal",
          "v": "aggressor_victim"
        },
        {
          "k": "literal",
          "v": "connector_edge"
        },
        {
          "k": "literal",
          "v": "test_point_coverage"
        },
        {
          "k": "literal",
          "v": "termination"
        }
      ]
    },
    "app/lib/constraints/types.ts#SelectorPredicate": {
      "discriminant": "kind",
      "k": "union",
      "variants": [
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "all"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "ids",
              "optional": false,
              "type": {
                "item": {
                  "k": "string"
                },
                "k": "array"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "ids"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "member_of"
              }
            },
            {
              "name": "parentId",
              "optional": false,
              "type": {
                "k": "string"
              }
            },
            {
              "name": "parentType",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintObjectType",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "tag"
              }
            },
            {
              "name": "tag",
              "optional": false,
              "type": {
                "k": "string"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "field",
              "optional": false,
              "type": {
                "k": "string"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "attribute"
              }
            },
            {
              "name": "operator",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "eq"
                  },
                  {
                    "k": "literal",
                    "v": "neq"
                  },
                  {
                    "k": "literal",
                    "v": "contains"
                  },
                  {
                    "k": "literal",
                    "v": "one_of"
                  }
                ]
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "boolean"
                  },
                  {
                    "k": "string"
                  },
                  {
                    "item": {
                      "k": "string"
                    },
                    "k": "array"
                  }
                ]
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "name_glob"
              }
            },
            {
              "name": "pattern",
              "optional": false,
              "type": {
                "k": "string"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "all_of"
              }
            },
            {
              "name": "predicates",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/constraints/types.ts#SelectorPredicate",
                  "k": "ref"
                },
                "k": "array"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "any_of"
              }
            },
            {
              "name": "predicates",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/constraints/types.ts#SelectorPredicate",
                  "k": "ref"
                },
                "k": "array"
              }
            }
          ]
        }
      ]
    },
    "app/lib/constraints/types.ts#SelectorSnapshot": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "constraintId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "designRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "reasons",
          "optional": false,
          "type": {
            "index": {
              "key": "string",
              "of": {
                "k": "string"
              }
            },
            "k": "object",
            "props": []
          }
        },
        {
          "name": "selector",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#TypedSelector",
            "k": "ref"
          }
        },
        {
          "name": "state",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "resolved"
              },
              {
                "k": "literal",
                "v": "empty"
              },
              {
                "k": "literal",
                "v": "ambiguous"
              },
              {
                "k": "literal",
                "v": "unresolved"
              }
            ]
          }
        },
        {
          "name": "targetIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "targetSetHash",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/constraints/types.ts#TruthValue": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "true"
        },
        {
          "k": "literal",
          "v": "false"
        },
        {
          "k": "literal",
          "v": "unknown"
        }
      ]
    },
    "app/lib/constraints/types.ts#TypedRequirement": {
      "discriminant": "form",
      "k": "union",
      "variants": [
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "minimum"
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "maximum"
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "range"
              }
            },
            {
              "name": "max",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            },
            {
              "name": "maxInclusive",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": true
                  },
                  {
                    "k": "literal",
                    "v": false
                  }
                ]
              }
            },
            {
              "name": "min",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            },
            {
              "name": "minInclusive",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": true
                  },
                  {
                    "k": "literal",
                    "v": false
                  }
                ]
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "equals"
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintScalar",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "not_equals"
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintScalar",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "allowed_set"
              }
            },
            {
              "name": "values",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/constraints/types.ts#ConstraintScalar",
                  "k": "ref"
                },
                "k": "array"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "forbidden_set"
              }
            },
            {
              "name": "values",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/constraints/types.ts#ConstraintScalar",
                  "k": "ref"
                },
                "k": "array"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "required_set"
              }
            },
            {
              "name": "values",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/constraints/types.ts#ConstraintScalar",
                  "k": "ref"
                },
                "k": "array"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "cardinality",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#CardinalityExpectation",
                "k": "ref"
              }
            },
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "must_exist"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "must_connect"
              }
            },
            {
              "name": "relationshipId",
              "optional": false,
              "type": {
                "k": "string"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "must_not_connect"
              }
            },
            {
              "name": "relationshipId",
              "optional": false,
              "type": {
                "k": "string"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "distance"
              }
            },
            {
              "name": "referenceIds",
              "optional": false,
              "type": {
                "item": {
                  "k": "string"
                },
                "k": "array"
              }
            },
            {
              "name": "relation",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "minimum"
                  },
                  {
                    "k": "literal",
                    "v": "maximum"
                  }
                ]
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "containment"
              }
            },
            {
              "name": "mode",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "inside"
                  },
                  {
                    "k": "literal",
                    "v": "outside"
                  }
                ]
              }
            },
            {
              "name": "regionIds",
              "optional": false,
              "type": {
                "item": {
                  "k": "string"
                },
                "k": "array"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "ordering"
              }
            },
            {
              "name": "orderedTargetIds",
              "optional": false,
              "type": {
                "item": {
                  "k": "string"
                },
                "k": "array"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "aggregate",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "sum"
                  },
                  {
                    "k": "literal",
                    "v": "count"
                  }
                ]
              }
            },
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "budget"
              }
            },
            {
              "name": "limit",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                    "k": "ref"
                  },
                  {
                    "id": "app/lib/constraints/types.ts#IntegerValue",
                    "k": "ref"
                  }
                ]
              }
            },
            {
              "name": "margin",
              "optional": true,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "target"
              }
            },
            {
              "name": "toleranceMinus",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            },
            {
              "name": "tolerancePlus",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            },
            {
              "name": "value",
              "optional": false,
              "type": {
                "id": "app/lib/constraints/types.ts#ConstraintQuantity",
                "k": "ref"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "direction",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "minimize"
                  },
                  {
                    "k": "literal",
                    "v": "maximize"
                  }
                ]
              }
            },
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "objective"
              }
            },
            {
              "name": "metric",
              "optional": false,
              "type": {
                "k": "string"
              }
            },
            {
              "name": "weight",
              "optional": false,
              "type": {
                "k": "string"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "checkerId",
              "optional": false,
              "type": {
                "k": "string"
              }
            },
            {
              "name": "form",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "require_coverage"
              }
            },
            {
              "name": "minimumSupport",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "enforced"
                  },
                  {
                    "k": "literal",
                    "v": "compiled_for_consumer"
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    "app/lib/constraints/types.ts#TypedSelector": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "cardinality",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#CardinalityExpectation",
            "k": "ref"
          }
        },
        {
          "name": "objectType",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#ConstraintObjectType",
            "k": "ref"
          }
        },
        {
          "name": "predicate",
          "optional": false,
          "type": {
            "id": "app/lib/constraints/types.ts#SelectorPredicate",
            "k": "ref"
          }
        }
      ]
    },
    "app/lib/pcb/geometry.ts#BBox": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "maxX",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "maxY",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minX",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "minY",
          "optional": false,
          "type": {
            "k": "number"
          }
        }
      ]
    },
    "app/lib/pcb/geometry.ts#PadShape": {
      "discriminant": "kind",
      "k": "union",
      "variants": [
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "circle"
              }
            },
            {
              "name": "radius",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "height",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "rect"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "cornerRadius",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "height",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "roundrect"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "height",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "oval"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "polygon"
              }
            },
            {
              "name": "points",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/pcb/geometry.ts#Vec2",
                  "k": "ref"
                },
                "k": "array"
              }
            }
          ]
        }
      ]
    },
    "app/lib/pcb/geometry.ts#Vec2": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "x",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "y",
          "optional": false,
          "type": {
            "k": "number"
          }
        }
      ]
    },
    "app/lib/pcb/layers.ts#LayerId": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "copperTop"
        },
        {
          "k": "literal",
          "v": "in1"
        },
        {
          "k": "literal",
          "v": "in2"
        },
        {
          "k": "literal",
          "v": "copperBottom"
        },
        {
          "k": "literal",
          "v": "silkTop"
        },
        {
          "k": "literal",
          "v": "silkBottom"
        },
        {
          "k": "literal",
          "v": "maskTop"
        },
        {
          "k": "literal",
          "v": "maskBottom"
        },
        {
          "k": "literal",
          "v": "pasteTop"
        },
        {
          "k": "literal",
          "v": "pasteBottom"
        },
        {
          "k": "literal",
          "v": "edge"
        },
        {
          "k": "literal",
          "v": "courtyardTop"
        },
        {
          "k": "literal",
          "v": "courtyardBottom"
        },
        {
          "k": "literal",
          "v": "fabTop"
        },
        {
          "k": "literal",
          "v": "fabBottom"
        }
      ]
    },
    "app/lib/pcb/netclass.ts#BoardNetClassing": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "assignments",
          "optional": false,
          "type": {
            "index": {
              "key": "number",
              "of": {
                "id": "app/lib/pcb/netclass.ts#NetClassAssignment",
                "k": "ref"
              }
            },
            "k": "object",
            "props": []
          }
        },
        {
          "name": "base",
          "optional": true,
          "type": {
            "index": {
              "key": "number",
              "of": {
                "id": "app/lib/pcb/netclass.ts#NetClassAssignment",
                "k": "ref"
              }
            },
            "k": "object",
            "props": []
          }
        },
        {
          "name": "ruleDeltas",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/netclass.ts#RuleDelta",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "version",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        }
      ]
    },
    "app/lib/pcb/netclass.ts#NetClassAssignment": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "classId",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/netclass.ts#NetClassId",
            "k": "ref"
          }
        },
        {
          "name": "explanation",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "override",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "clearance",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "constraintIds",
                "optional": true,
                "type": {
                  "item": {
                    "k": "string"
                  },
                  "k": "array"
                }
              },
              {
                "name": "constraintProgramHash",
                "optional": true,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "trackWidth",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "viaDrill",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "viaSize",
                "optional": true,
                "type": {
                  "k": "number"
                }
              }
            ]
          }
        }
      ]
    },
    "app/lib/pcb/netclass.ts#NetClassId": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "Default"
        },
        {
          "k": "literal",
          "v": "Power"
        },
        {
          "k": "literal",
          "v": "HighCurrent"
        }
      ]
    },
    "app/lib/pcb/netclass.ts#RuleDelta": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "brief",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "changes",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/netclass.ts#RuleDeltaChange",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "createdAt",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "explanation",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "source",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "ai-brief"
              },
              {
                "k": "literal",
                "v": "manual"
              }
            ]
          }
        }
      ]
    },
    "app/lib/pcb/netclass.ts#RuleDeltaChange": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "appliesTo",
          "optional": false,
          "type": {
            "discriminant": "kind",
            "k": "union",
            "variants": [
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "classId",
                    "optional": false,
                    "type": {
                      "id": "app/lib/pcb/netclass.ts#NetClassId",
                      "k": "ref"
                    }
                  },
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "class"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "nets"
                    }
                  },
                  {
                    "name": "netIds",
                    "optional": false,
                    "type": {
                      "item": {
                        "k": "number"
                      },
                      "k": "array"
                    }
                  }
                ]
              },
              {
                "index": null,
                "k": "object",
                "props": [
                  {
                    "name": "kind",
                    "optional": false,
                    "type": {
                      "k": "literal",
                      "v": "namePattern"
                    }
                  },
                  {
                    "name": "regex",
                    "optional": false,
                    "type": {
                      "k": "string"
                    }
                  }
                ]
              }
            ]
          }
        },
        {
          "name": "className",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "Default"
              },
              {
                "k": "literal",
                "v": "Power"
              },
              {
                "k": "literal",
                "v": "HighCurrent"
              }
            ]
          }
        },
        {
          "name": "clearanceNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "trackWidthNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "viaDrillNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "viaSizeNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        }
      ]
    },
    "app/lib/pcb/padstack/types.ts#Padstack": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "drillNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "via"
          }
        },
        {
          "name": "name",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "outerNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "tented",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "zoneConnect",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "thermal"
              },
              {
                "k": "literal",
                "v": "solid"
              }
            ]
          }
        }
      ]
    },
    "app/lib/pcb/silk/types.ts#SilkCircleItem": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "center",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "filled",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "circle"
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/silk/types.ts#SilkLayer",
            "k": "ref"
          }
        },
        {
          "name": "radiusNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "strokeWidthNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        }
      ]
    },
    "app/lib/pcb/silk/types.ts#SilkItem": {
      "discriminant": "kind",
      "k": "union",
      "variants": [
        {
          "id": "app/lib/pcb/silk/types.ts#SilkTextItem",
          "k": "ref"
        },
        {
          "id": "app/lib/pcb/silk/types.ts#SilkLineItem",
          "k": "ref"
        },
        {
          "id": "app/lib/pcb/silk/types.ts#SilkRectItem",
          "k": "ref"
        },
        {
          "id": "app/lib/pcb/silk/types.ts#SilkCircleItem",
          "k": "ref"
        }
      ]
    },
    "app/lib/pcb/silk/types.ts#SilkLayer": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "silkTop"
        },
        {
          "k": "literal",
          "v": "silkBottom"
        }
      ]
    },
    "app/lib/pcb/silk/types.ts#SilkLineItem": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "from",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "line"
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/silk/types.ts#SilkLayer",
            "k": "ref"
          }
        },
        {
          "name": "strokeWidthNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "to",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        }
      ]
    },
    "app/lib/pcb/silk/types.ts#SilkRectItem": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "corner1",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "corner2",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "filled",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "rect"
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/silk/types.ts#SilkLayer",
            "k": "ref"
          }
        },
        {
          "name": "strokeWidthNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        }
      ]
    },
    "app/lib/pcb/silk/types.ts#SilkTextItem": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "anchor",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "right"
              },
              {
                "k": "literal",
                "v": "left"
              },
              {
                "k": "literal",
                "v": "center"
              }
            ]
          }
        },
        {
          "name": "heightNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "text"
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/silk/types.ts#SilkLayer",
            "k": "ref"
          }
        },
        {
          "name": "mirror",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "position",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "rotationDeg",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "strokeWidthNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "text",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/pcb/stackup.ts#BoardStackup": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "boardThicknessMm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "copperLayers",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/stackup.ts#CopperLayer",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "profileId",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/stackup.ts#StackupProfileId",
            "k": "ref"
          }
        },
        {
          "name": "routing",
          "optional": false,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "fanout",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": true
                    },
                    {
                      "k": "literal",
                      "v": false
                    }
                  ]
                }
              },
              {
                "name": "planeViaCost",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "postroute",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": true
                    },
                    {
                      "k": "literal",
                      "v": false
                    }
                  ]
                }
              },
              {
                "name": "startRipupCost",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "viaCost",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "viasAllowed",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": true
                    },
                    {
                      "k": "literal",
                      "v": false
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    },
    "app/lib/pcb/stackup.ts#CopperLayer": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "autorouteEnabled",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "defaultTraceWidthMm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "enabled",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "copperTop"
              },
              {
                "k": "literal",
                "v": "in1"
              },
              {
                "k": "literal",
                "v": "in2"
              },
              {
                "k": "literal",
                "v": "copperBottom"
              }
            ]
          }
        },
        {
          "name": "name",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "F.Cu"
              },
              {
                "k": "literal",
                "v": "In1.Cu"
              },
              {
                "k": "literal",
                "v": "In2.Cu"
              },
              {
                "k": "literal",
                "v": "B.Cu"
              }
            ]
          }
        },
        {
          "name": "order",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "planeNetId",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "preferredDirection",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/stackup.ts#PreferredDirection",
            "k": "ref"
          }
        },
        {
          "name": "role",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/stackup.ts#CopperLayerRole",
            "k": "ref"
          }
        }
      ]
    },
    "app/lib/pcb/stackup.ts#CopperLayerRole": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "signal"
        },
        {
          "k": "literal",
          "v": "plane"
        },
        {
          "k": "literal",
          "v": "mixed"
        }
      ]
    },
    "app/lib/pcb/stackup.ts#PreferredDirection": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "horizontal"
        },
        {
          "k": "literal",
          "v": "vertical"
        },
        {
          "k": "literal",
          "v": "any"
        }
      ]
    },
    "app/lib/pcb/stackup.ts#StackupProfileId": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "simple-2"
        },
        {
          "k": "literal",
          "v": "signal-plane-4"
        },
        {
          "k": "literal",
          "v": "all-signal-4"
        },
        {
          "k": "literal",
          "v": "dense-4"
        }
      ]
    },
    "app/lib/pcb/types.ts#BoardDimension": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "a",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "b",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "kind",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/types.ts#DimensionKind",
            "k": "ref"
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "silkTop"
              },
              {
                "k": "literal",
                "v": "silkBottom"
              },
              {
                "k": "literal",
                "v": "fabTop"
              },
              {
                "k": "literal",
                "v": "fabBottom"
              }
            ]
          }
        },
        {
          "name": "offsetNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "precision",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": 0
              },
              {
                "k": "literal",
                "v": 1
              },
              {
                "k": "literal",
                "v": 2
              },
              {
                "k": "literal",
                "v": 4
              },
              {
                "k": "literal",
                "v": 3
              }
            ]
          }
        },
        {
          "name": "strokeWidthNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "textHeightNm",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "unit",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "mm"
              },
              {
                "k": "literal",
                "v": "in"
              }
            ]
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#BoardOutline": {
      "discriminant": "kind",
      "k": "union",
      "variants": [
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "height",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "rect"
              }
            },
            {
              "name": "origin",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "cornerRadius",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "height",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "roundrect"
              }
            },
            {
              "name": "origin",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "polygon"
              }
            },
            {
              "name": "points",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/pcb/geometry.ts#Vec2",
                  "k": "ref"
                },
                "k": "array"
              }
            }
          ]
        }
      ]
    },
    "app/lib/pcb/types.ts#BoardText": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "at",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/layers.ts#LayerId",
            "k": "ref"
          }
        },
        {
          "name": "rotationDeg",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "sizeX",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "sizeY",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "text",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "thickness",
          "optional": false,
          "type": {
            "k": "number"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#DimensionKind": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "horizontal"
        },
        {
          "k": "literal",
          "v": "vertical"
        },
        {
          "k": "literal",
          "v": "aligned"
        }
      ]
    },
    "app/lib/pcb/types.ts#FilledRegion": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "areaNm2",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "boundingBox",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#BBox",
            "k": "ref"
          }
        },
        {
          "name": "holes",
          "optional": false,
          "type": {
            "item": {
              "item": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              },
              "k": "array"
            },
            "k": "array"
          }
        },
        {
          "name": "outer",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/geometry.ts#Vec2",
              "k": "ref"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#FootprintDef": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "attributes",
          "optional": false,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "excludeFromBom",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": true
                    },
                    {
                      "k": "literal",
                      "v": false
                    }
                  ]
                }
              },
              {
                "name": "excludeFromPos",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": true
                    },
                    {
                      "k": "literal",
                      "v": false
                    }
                  ]
                }
              },
              {
                "name": "smd",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": true
                    },
                    {
                      "k": "literal",
                      "v": false
                    }
                  ]
                }
              },
              {
                "name": "throughHole",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": true
                    },
                    {
                      "k": "literal",
                      "v": false
                    }
                  ]
                }
              }
            ]
          }
        },
        {
          "name": "bodyBBox",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#BBox",
            "k": "ref"
          }
        },
        {
          "name": "courtyardBBox",
          "optional": true,
          "type": {
            "id": "app/lib/pcb/geometry.ts#BBox",
            "k": "ref"
          }
        },
        {
          "name": "description",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "graphics",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#FpGraphic",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "libName",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "models",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#FootprintModelRef",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "name",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "pads",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#Pad",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "rawSexpr",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "tags",
          "optional": true,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#FootprintInstance": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "at",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "bodyMayOverhang",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "boolean"
              }
            ]
          }
        },
        {
          "name": "def",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/types.ts#FootprintDef",
            "k": "ref"
          }
        },
        {
          "name": "footprintId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "footprintPadClassifications",
          "optional": true,
          "type": {
            "index": {
              "key": "string",
              "of": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "intentional-no-connect"
                  },
                  {
                    "k": "literal",
                    "v": "mechanical"
                  }
                ]
              }
            },
            "k": "object",
            "props": []
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "locked",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "boolean"
              }
            ]
          }
        },
        {
          "name": "padNets",
          "optional": false,
          "type": {
            "index": {
              "key": "string",
              "of": {
                "k": "number"
              }
            },
            "k": "object",
            "props": []
          }
        },
        {
          "name": "pinPadMappings",
          "optional": true,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#ResolvedPinPadMapping",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "placementConstraints",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "allowSideChange",
                "optional": true,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "boolean"
                    }
                  ]
                }
              },
              {
                "name": "allowedRotations",
                "optional": true,
                "type": {
                  "item": {
                    "discriminant": null,
                    "k": "union",
                    "variants": [
                      {
                        "k": "literal",
                        "v": 0
                      },
                      {
                        "k": "literal",
                        "v": 90
                      },
                      {
                        "k": "literal",
                        "v": 180
                      },
                      {
                        "k": "literal",
                        "v": 270
                      }
                    ]
                  },
                  "k": "array"
                }
              },
              {
                "name": "criticalRole",
                "optional": true,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": "connector"
                    },
                    {
                      "k": "literal",
                      "v": "power"
                    },
                    {
                      "k": "literal",
                      "v": "clock"
                    },
                    {
                      "k": "literal",
                      "v": "analog"
                    },
                    {
                      "k": "literal",
                      "v": "rf"
                    },
                    {
                      "k": "literal",
                      "v": "thermal"
                    }
                  ]
                }
              },
              {
                "name": "edgeConnector",
                "optional": true,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": "top"
                    },
                    {
                      "k": "literal",
                      "v": "bottom"
                    },
                    {
                      "k": "literal",
                      "v": "right"
                    },
                    {
                      "k": "literal",
                      "v": "left"
                    }
                  ]
                }
              },
              {
                "name": "fixedPosition",
                "optional": true,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "boolean"
                    }
                  ]
                }
              },
              {
                "name": "mechanical",
                "optional": true,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "boolean"
                    }
                  ]
                }
              }
            ]
          }
        },
        {
          "name": "ref",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "rotationDeg",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "side",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "top"
              },
              {
                "k": "literal",
                "v": "bottom"
              }
            ]
          }
        },
        {
          "name": "syncIdentity",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "bindingRevisionId",
                "optional": false,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "componentInstanceId",
                "optional": false,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "footprintAssetVersionId",
                "optional": false,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "footprintContentDigest",
                "optional": false,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "mappingCertificateId",
                "optional": false,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "symbolAssetVersionId",
                "optional": false,
                "type": {
                  "k": "string"
                }
              },
              {
                "name": "syncPlanId",
                "optional": false,
                "type": {
                  "k": "string"
                }
              }
            ]
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#FootprintModelRef": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "offset",
          "optional": true,
          "type": {
            "items": [
              {
                "k": "number"
              },
              {
                "k": "number"
              },
              {
                "k": "number"
              }
            ],
            "k": "tuple"
          }
        },
        {
          "name": "path",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "rotate",
          "optional": true,
          "type": {
            "items": [
              {
                "k": "number"
              },
              {
                "k": "number"
              },
              {
                "k": "number"
              }
            ],
            "k": "tuple"
          }
        },
        {
          "name": "scale",
          "optional": true,
          "type": {
            "items": [
              {
                "k": "number"
              },
              {
                "k": "number"
              },
              {
                "k": "number"
              }
            ],
            "k": "tuple"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#FpGraphic": {
      "discriminant": "kind",
      "k": "union",
      "variants": [
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "end",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "line"
              }
            },
            {
              "name": "layer",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/layers.ts#LayerId",
                "k": "ref"
              }
            },
            {
              "name": "start",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "end",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "arc"
              }
            },
            {
              "name": "layer",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/layers.ts#LayerId",
                "k": "ref"
              }
            },
            {
              "name": "mid",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "start",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "center",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "end",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "fill",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": true
                  },
                  {
                    "k": "literal",
                    "v": false
                  }
                ]
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "circle"
              }
            },
            {
              "name": "layer",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/layers.ts#LayerId",
                "k": "ref"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "end",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "fill",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": true
                  },
                  {
                    "k": "literal",
                    "v": false
                  }
                ]
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "rect"
              }
            },
            {
              "name": "layer",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/layers.ts#LayerId",
                "k": "ref"
              }
            },
            {
              "name": "start",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "fill",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": true
                  },
                  {
                    "k": "literal",
                    "v": false
                  }
                ]
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "poly"
              }
            },
            {
              "name": "layer",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/layers.ts#LayerId",
                "k": "ref"
              }
            },
            {
              "name": "points",
              "optional": false,
              "type": {
                "item": {
                  "id": "app/lib/pcb/geometry.ts#Vec2",
                  "k": "ref"
                },
                "k": "array"
              }
            },
            {
              "name": "width",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        },
        {
          "index": null,
          "k": "object",
          "props": [
            {
              "name": "at",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/geometry.ts#Vec2",
                "k": "ref"
              }
            },
            {
              "name": "kind",
              "optional": false,
              "type": {
                "k": "literal",
                "v": "text"
              }
            },
            {
              "name": "layer",
              "optional": false,
              "type": {
                "id": "app/lib/pcb/layers.ts#LayerId",
                "k": "ref"
              }
            },
            {
              "name": "rotationDeg",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "sizeX",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "sizeY",
              "optional": false,
              "type": {
                "k": "number"
              }
            },
            {
              "name": "text",
              "optional": false,
              "type": {
                "k": "string"
              }
            },
            {
              "name": "textKind",
              "optional": false,
              "type": {
                "discriminant": null,
                "k": "union",
                "variants": [
                  {
                    "k": "literal",
                    "v": "reference"
                  },
                  {
                    "k": "literal",
                    "v": "value"
                  },
                  {
                    "k": "literal",
                    "v": "user"
                  }
                ]
              }
            },
            {
              "name": "thickness",
              "optional": false,
              "type": {
                "k": "number"
              }
            }
          ]
        }
      ]
    },
    "app/lib/pcb/types.ts#Pad": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "at",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "drill",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "diameter",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "height",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "offset",
                "optional": true,
                "type": {
                  "id": "app/lib/pcb/geometry.ts#Vec2",
                  "k": "ref"
                }
              },
              {
                "name": "width",
                "optional": true,
                "type": {
                  "k": "number"
                }
              }
            ]
          }
        },
        {
          "name": "layers",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/layers.ts#LayerId",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "number",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "plated",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "boolean"
              }
            ]
          }
        },
        {
          "name": "rotationDeg",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "shape",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#PadShape",
            "k": "ref"
          }
        },
        {
          "name": "solderMaskMarginNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "solderPasteMarginNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "solderPasteMarginRatio",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "type",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/types.ts#PadType",
            "k": "ref"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#PadType": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "smd"
        },
        {
          "k": "literal",
          "v": "thru_hole"
        },
        {
          "k": "literal",
          "v": "np_thru_hole"
        }
      ]
    },
    "app/lib/pcb/types.ts#PcbBoard": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "constraintState",
          "optional": true,
          "type": {
            "id": "app/lib/constraints/types.ts#BoardConstraintState",
            "k": "ref"
          }
        },
        {
          "name": "dimensions",
          "optional": true,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#BoardDimension",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "footprints",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#FootprintInstance",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "formatVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        },
        {
          "name": "identityVersion",
          "optional": true,
          "type": {
            "k": "literal",
            "v": 1
          }
        },
        {
          "name": "netClassing",
          "optional": true,
          "type": {
            "id": "app/lib/pcb/netclass.ts#BoardNetClassing",
            "k": "ref"
          }
        },
        {
          "name": "nets",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#PcbNet",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "outline",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/types.ts#BoardOutline",
            "k": "ref"
          }
        },
        {
          "name": "padstacks",
          "optional": true,
          "type": {
            "item": {
              "id": "app/lib/pcb/padstack/types.ts#Padstack",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "placementPolicy",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "allowBoardResize",
                "optional": true,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "boolean"
                    }
                  ]
                }
              },
              {
                "name": "outlineSource",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": "user"
                    },
                    {
                      "k": "literal",
                      "v": "generated"
                    }
                  ]
                }
              }
            ]
          }
        },
        {
          "name": "placementPreferences",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "envelopeScale",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "spacingPreset",
                "optional": false,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": "custom"
                    },
                    {
                      "k": "literal",
                      "v": "compact"
                    },
                    {
                      "k": "literal",
                      "v": "comfortable"
                    },
                    {
                      "k": "literal",
                      "v": "spacious"
                    }
                  ]
                }
              }
            ]
          }
        },
        {
          "name": "routingHistory",
          "optional": true,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#RoutingHistoryEvent",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "routingKeepouts",
          "optional": true,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#RoutingKeepout",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "routingPreferences",
          "optional": true,
          "type": {
            "id": "app/lib/pcb/types.ts#RoutingPreferences",
            "k": "ref"
          }
        },
        {
          "name": "silkItems",
          "optional": true,
          "type": {
            "item": {
              "id": "app/lib/pcb/silk/types.ts#SilkItem",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "stackup",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": 2
              },
              {
                "k": "literal",
                "v": 4
              }
            ]
          }
        },
        {
          "name": "stackupConfig",
          "optional": true,
          "type": {
            "id": "app/lib/pcb/stackup.ts#BoardStackup",
            "k": "ref"
          }
        },
        {
          "name": "texts",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#BoardText",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "tracks",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#Track",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "vias",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#Via",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "zones",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#Zone",
              "k": "ref"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#PcbNet": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "endpointKeys",
          "optional": true,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "name",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "stableId",
          "optional": true,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#PinPadMappingKind": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "electrical"
        },
        {
          "k": "literal",
          "v": "internally-common"
        },
        {
          "k": "literal",
          "v": "exposed-pad"
        },
        {
          "k": "literal",
          "v": "intentional-no-connect"
        },
        {
          "k": "literal",
          "v": "schematic-only"
        }
      ]
    },
    "app/lib/pcb/types.ts#PinPadMappingProvenance": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "exact-number"
        },
        {
          "k": "literal",
          "v": "library-explicit"
        },
        {
          "k": "literal",
          "v": "user-explicit"
        },
        {
          "k": "literal",
          "v": "legacy-inferred"
        }
      ]
    },
    "app/lib/pcb/types.ts#ResolvedPinPadMapping": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "componentInstanceId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "endpointKey",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "mappingKind",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/types.ts#PinPadMappingKind",
            "k": "ref"
          }
        },
        {
          "name": "padNumbers",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "provenance",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/types.ts#PinPadMappingProvenance",
            "k": "ref"
          }
        },
        {
          "name": "symbolPinNumber",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#RoutingHistoryEvent": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "baseWorldRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "candidateId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "direction",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "cw"
              },
              {
                "k": "literal",
                "v": "ccw"
              }
            ]
          }
        },
        {
          "name": "explanation",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/layers.ts#LayerId",
            "k": "ref"
          }
        },
        {
          "name": "mode",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "direct"
              },
              {
                "k": "literal",
                "v": "walk-around"
              }
            ]
          }
        },
        {
          "name": "netId",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "points",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/geometry.ts#Vec2",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "rules",
          "optional": false,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "clearanceNm",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "edgeClearanceNm",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "gridNm",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "trackWidthNm",
                "optional": false,
                "type": {
                  "k": "number"
                }
              }
            ]
          }
        },
        {
          "name": "schemaVersion",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        },
        {
          "name": "score",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "segmentIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "tool",
          "optional": false,
          "type": {
            "k": "literal",
            "v": "smart-route"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#RoutingKeepout": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "forbidTracks",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "forbidVias",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "layers",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/layers.ts#LayerId",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "name",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "polygon",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/geometry.ts#Vec2",
              "k": "ref"
            },
            "k": "array"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#RoutingObjectProvenance": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "actorId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "candidateId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "createdBy",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "interactive"
              },
              {
                "k": "literal",
                "v": "deterministic-router"
              },
              {
                "k": "literal",
                "v": "autorouter-import"
              },
              {
                "k": "literal",
                "v": "ai-requested"
              },
              {
                "k": "literal",
                "v": "migration"
              }
            ]
          }
        },
        {
          "name": "eventId",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "lineageObjectIds",
          "optional": false,
          "type": {
            "item": {
              "k": "string"
            },
            "k": "array"
          }
        },
        {
          "name": "operationId",
          "optional": false,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#RoutingPreferences": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "customTrackWidthNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "posture",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "orthogonal"
              },
              {
                "k": "literal",
                "v": "octilinear_a"
              },
              {
                "k": "literal",
                "v": "octilinear_b"
              },
              {
                "k": "literal",
                "v": "arbitrary"
              }
            ]
          }
        },
        {
          "name": "routeMode",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "highlight_stop"
              },
              {
                "k": "literal",
                "v": "walk_around"
              },
              {
                "k": "literal",
                "v": "shove"
              }
            ]
          }
        },
        {
          "name": "trackWidthMode",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "net-class"
              },
              {
                "k": "literal",
                "v": "custom"
              }
            ]
          }
        },
        {
          "name": "version",
          "optional": false,
          "type": {
            "k": "literal",
            "v": 1
          }
        },
        {
          "name": "viaMode",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "net-class"
              },
              {
                "k": "literal",
                "v": "padstack"
              }
            ]
          }
        },
        {
          "name": "viaPadstackId",
          "optional": true,
          "type": {
            "k": "string"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#Track": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "end",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/layers.ts#LayerId",
            "k": "ref"
          }
        },
        {
          "name": "locked",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "boolean"
              }
            ]
          }
        },
        {
          "name": "netId",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "routingProvenance",
          "optional": true,
          "type": {
            "id": "app/lib/pcb/types.ts#RoutingObjectProvenance",
            "k": "ref"
          }
        },
        {
          "name": "source",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "human"
              },
              {
                "k": "literal",
                "v": "ai"
              },
              {
                "k": "literal",
                "v": "autorouter"
              },
              {
                "k": "literal",
                "v": "imported"
              }
            ]
          }
        },
        {
          "name": "start",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "width",
          "optional": false,
          "type": {
            "k": "number"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#Via": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "at",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/geometry.ts#Vec2",
            "k": "ref"
          }
        },
        {
          "name": "drill",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "layers",
          "optional": false,
          "type": {
            "items": [
              {
                "id": "app/lib/pcb/layers.ts#LayerId",
                "k": "ref"
              },
              {
                "id": "app/lib/pcb/layers.ts#LayerId",
                "k": "ref"
              }
            ],
            "k": "tuple"
          }
        },
        {
          "name": "locked",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "boolean"
              }
            ]
          }
        },
        {
          "name": "netId",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "padstackId",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "routingProvenance",
          "optional": true,
          "type": {
            "id": "app/lib/pcb/types.ts#RoutingObjectProvenance",
            "k": "ref"
          }
        },
        {
          "name": "size",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "source",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "human"
              },
              {
                "k": "literal",
                "v": "ai"
              },
              {
                "k": "literal",
                "v": "autorouter"
              },
              {
                "k": "literal",
                "v": "imported"
              }
            ]
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#Zone": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "appearance",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "solid"
              },
              {
                "k": "literal",
                "v": "hatched"
              }
            ]
          }
        },
        {
          "name": "clearanceOverrideNm",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "connection",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "thermal"
              },
              {
                "k": "literal",
                "v": "solid"
              }
            ]
          }
        },
        {
          "name": "dirty",
          "optional": false,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": true
              },
              {
                "k": "literal",
                "v": false
              }
            ]
          }
        },
        {
          "name": "fill",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/types.ts#FilledRegion",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "fillState",
          "optional": true,
          "type": {
            "id": "app/lib/pcb/types.ts#ZoneFillState",
            "k": "ref"
          }
        },
        {
          "name": "id",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "keepUnconnectedIslands",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "boolean"
              }
            ]
          }
        },
        {
          "name": "layer",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/layers.ts#LayerId",
            "k": "ref"
          }
        },
        {
          "name": "locked",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "boolean"
              }
            ]
          }
        },
        {
          "name": "minIslandAreaNm2",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "netId",
          "optional": false,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "polygon",
          "optional": false,
          "type": {
            "item": {
              "id": "app/lib/pcb/geometry.ts#Vec2",
              "k": "ref"
            },
            "k": "array"
          }
        },
        {
          "name": "priority",
          "optional": true,
          "type": {
            "k": "number"
          }
        },
        {
          "name": "source",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "user"
              },
              {
                "k": "literal",
                "v": "stackup-plane"
              }
            ]
          }
        },
        {
          "name": "sourceLayerId",
          "optional": true,
          "type": {
            "discriminant": null,
            "k": "union",
            "variants": [
              {
                "k": "literal",
                "v": "copperTop"
              },
              {
                "k": "literal",
                "v": "in1"
              },
              {
                "k": "literal",
                "v": "in2"
              },
              {
                "k": "literal",
                "v": "copperBottom"
              },
              {
                "k": "literal",
                "v": "silkTop"
              },
              {
                "k": "literal",
                "v": "silkBottom"
              },
              {
                "k": "literal",
                "v": "maskTop"
              },
              {
                "k": "literal",
                "v": "maskBottom"
              },
              {
                "k": "literal",
                "v": "pasteTop"
              },
              {
                "k": "literal",
                "v": "pasteBottom"
              },
              {
                "k": "literal",
                "v": "edge"
              },
              {
                "k": "literal",
                "v": "courtyardTop"
              },
              {
                "k": "literal",
                "v": "courtyardBottom"
              },
              {
                "k": "literal",
                "v": "fabTop"
              },
              {
                "k": "literal",
                "v": "fabBottom"
              }
            ]
          }
        },
        {
          "name": "thermal",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "angleOffsetDeg",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "gapNm",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "spokeWidthNm",
                "optional": true,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "spokes",
                "optional": true,
                "type": {
                  "discriminant": null,
                  "k": "union",
                  "variants": [
                    {
                      "k": "literal",
                      "v": 2
                    },
                    {
                      "k": "literal",
                      "v": 4
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#ZoneFillState": {
      "index": null,
      "k": "object",
      "props": [
        {
          "name": "algorithmVersion",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "diagnostics",
          "optional": false,
          "type": {
            "item": {
              "index": null,
              "k": "object",
              "props": [
                {
                  "name": "code",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                },
                {
                  "name": "message",
                  "optional": false,
                  "type": {
                    "k": "string"
                  }
                }
              ]
            },
            "k": "array"
          }
        },
        {
          "name": "fillHash",
          "optional": true,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "sourceRevision",
          "optional": false,
          "type": {
            "k": "string"
          }
        },
        {
          "name": "stats",
          "optional": true,
          "type": {
            "index": null,
            "k": "object",
            "props": [
              {
                "name": "filledAreaNm2",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "islandsDropped",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "rawRegions",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "regions",
                "optional": false,
                "type": {
                  "k": "number"
                }
              },
              {
                "name": "thermalAccessCount",
                "optional": false,
                "type": {
                  "k": "number"
                }
              }
            ]
          }
        },
        {
          "name": "status",
          "optional": false,
          "type": {
            "id": "app/lib/pcb/types.ts#ZoneFillStatus",
            "k": "ref"
          }
        }
      ]
    },
    "app/lib/pcb/types.ts#ZoneFillStatus": {
      "discriminant": null,
      "k": "union",
      "variants": [
        {
          "k": "literal",
          "v": "dirty"
        },
        {
          "k": "literal",
          "v": "filling"
        },
        {
          "k": "literal",
          "v": "current"
        },
        {
          "k": "literal",
          "v": "failed"
        },
        {
          "k": "literal",
          "v": "unsupported"
        },
        {
          "k": "literal",
          "v": "stale"
        }
      ]
    }
  },
  "root": "app/lib/pcb/types.ts#PcbBoard",
  "schema": "sirkit.pcb-shape-descriptor.v1",
  "sources": [
    "app/lib/constraints/types.ts",
    "app/lib/pcb/geometry.ts",
    "app/lib/pcb/layers.ts",
    "app/lib/pcb/netclass.ts",
    "app/lib/pcb/padstack/types.ts",
    "app/lib/pcb/silk/types.ts",
    "app/lib/pcb/stackup.ts",
    "app/lib/pcb/types.ts"
  ]
} as const;
