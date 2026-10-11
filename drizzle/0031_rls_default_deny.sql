-- [B24-A4] D24-3 offline, OD-192 - default-deny row security on every table but `project_members`.
--
-- FORWARD. Not applied to any live database by the builder; an operator applies it deliberately, after the owner's pre-apply
-- step below.
--
-- Before this migration only `project_members` had row security (0027). Through the hosted platform's Data API a role holding
-- table grants read and wrote every other table (INFERRED: the platform's documented defaults grant the API roles every table
-- in `public`; the real project's grants and exposure are UNKNOWN, LB-14). This migration enables row security, with NO
-- policy, on the 142 other tables and on the runner's own ledger, `sirkit_schema_migrations`, which the runner creates before
-- any migration runs (runner.ts): a role that is neither a table's owner nor a superuser nor BYPASSRLS now reads zero rows of
-- it and writes none. It adds no policy, no FORCE, no role, no GRANT and no REVOKE (b24-a4-rls-default-deny refuses each).
-- `project_members` keeps 0027's row security and its one self-select policy, unchanged.
--
-- The owning server role is unaffected: PostgreSQL applies row security to a table's owner only when the table is FORCED, and
-- nothing here forces one (the owner bypass; INFERRED for the real platform, LB-14).
--
-- THE OWNER'S PRE-APPLY STEP, never the builder's (discovery section 8 item 3: which role production's database URL names is
-- UNKNOWN). On the target, connected as the server's own database role, one of these must hold, or 0031 is not applied -
-- otherwise every server read returns zero rows and every insert fails:
--   SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
--     AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user);   -- returns no row (the role owns every table)
--   SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user;   -- returns true
--
-- THE WAY BACK: the lossless DOWN, drizzle/rollback/0031_rls_default_deny.down.sql (the same list, DISABLE ROW LEVEL SECURITY),
-- run by `pnpm run db:migrate -- --rollback 0031_rls_default_deny --confirm <the typed confirmation>` (B24-A4b, OD-193).
-- The list is static and reviewed (no loop over the catalog): schema.ts's tables but `project_members`, then the ledger.

ALTER TABLE "alternates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_comparisons" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_selection_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_cad_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_exact_parts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_families" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_generic_devices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_guidance" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_licenses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_manufacturers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_mapping_certificates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_offer_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_part_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_raw_objects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_revision_status_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_selections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_source_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_supplier_parts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "authoritative_boms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "autonomous_hardware_design_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bom_notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bom_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_graphs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_registry_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_upstream_signoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_findings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_knowledge_pcb_foundation_signoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_knowledge_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_knowledge_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_knowledge_upstream_signoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_oracle_parity_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_oracle_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_readiness_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_recipe_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_recipe_libraries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_recipe_source_bundles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_rule_denominators" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_rule_registries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_verification_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_verification_project_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_verification_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_verification_upstream_signoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_waivers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compiled_circuit_recipes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_alternatives" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_catalog_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_evaluations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_offer_observations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_sourcing_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_upstream_signoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_evaluations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_program_activations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_programs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_set_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_waivers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "design_capability_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "design_requirement_packages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "durable_workflow_heads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "durable_workflow_outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "durable_workflow_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "durable_workflow_replays" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_coverage_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_packages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_project_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_readiness_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_candidate_graphs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_final_verdicts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_project_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_replay_bundles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_run_contexts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_run_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_stage_invocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hardware_release_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_pin_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_pin_fact_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_planning_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_planning_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_selection_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_upstream_signoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "libraries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "manufacturing_artifact_manifests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "model_simulation_project_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "part_offers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parts_atomic_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pcb_footprints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_binding_audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_binding_migration_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_binding_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_binding_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_readiness_assessments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_architecture_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_architecture_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_selection_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_upstream_signoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "procurement_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "programmable_device_evidence_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "release_engineering_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "release_engineering_project_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "release_level_assessments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "release_manifests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "requirement_source_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "requirement_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_artifact_manifests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_compilation_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_compiler_upstream_signoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_completeness_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_diagram_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_pcb_sync_contracts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_round_trip_certificates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_semantic_diffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_semantic_graphs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_transaction_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_campaigns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_coverage_denominators" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_coverage_matrices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_model_registries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_readiness_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_testbench_registries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_verification_problems" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_waveform_artifacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sirkit_schema_migrations" ENABLE ROW LEVEL SECURITY;
