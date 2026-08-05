DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM physical_binding_revisions WHERE
      btrim(revision_id) = '' OR btrim(binding_id) = '' OR btrim(lineage_id) = '' OR
      btrim(tenant_id) = '' OR btrim(project_id) = '' OR btrim(branch_id) = '' OR
      btrim(board_instance_id) = '' OR btrim(component_instance_id) = '' OR
      btrim(variant_scope_digest) = '' OR btrim(technical_digest) = '' OR
      btrim(record_digest) = '' OR btrim(created_by) = ''
  ) OR EXISTS (
    SELECT 1 FROM physical_binding_sets WHERE
      btrim(set_id) = '' OR btrim(tenant_id) = '' OR btrim(project_id) = '' OR
      btrim(branch_id) = '' OR btrim(board_instance_id) = '' OR
      btrim(component_instance_id) = '' OR btrim(variant_scope_digest) = '' OR
      btrim(record_digest) = ''
  ) OR EXISTS (
    SELECT 1 FROM physical_binding_audit_events WHERE
      btrim(event_id) = '' OR btrim(tenant_id) = '' OR btrim(project_id) = '' OR
      btrim(branch_id) = '' OR btrim(component_instance_id) = '' OR
      btrim(binding_id) = '' OR btrim(idempotency_key) = '' OR btrim(event_digest) = ''
  ) OR EXISTS (
    SELECT 1 FROM physical_binding_migration_records WHERE
      btrim(migration_key) = '' OR btrim(tenant_id) = '' OR btrim(project_id) = '' OR
      btrim(branch_id) = '' OR btrim(component_instance_id) = '' OR
      btrim(source_schema_version) = '' OR btrim(candidate_revision_id) = '' OR
      btrim(record_digest) = ''
  ) OR EXISTS (
    SELECT 1 FROM physical_readiness_assessments WHERE
      btrim(assessment_id) = '' OR btrim(binding_revision_id) = '' OR
      btrim(binding_record_digest) = '' OR btrim(policy_version) = '' OR
      btrim(assessment_digest) = ''
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PB0025_IDENTITY_BLANK';
  END IF;

  IF EXISTS (SELECT 1 FROM physical_binding_revisions WHERE revision <= 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PB0025_REVISION_NUMBER_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM physical_binding_sets WHERE revision <= 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PB0025_SET_REVISION_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM physical_binding_revisions WHERE
      lifecycle_state NOT IN ('draft','candidate','selected','superseded','withdrawn','orphaned','obsolete') OR
      approval_state NOT IN ('unreviewed','pending','approved','rejected','expired','revoked') OR
      technical_state NOT IN ('pending','valid','invalid','unsupported') OR
      freshness_state NOT IN ('current','stale','unknown','missing_source') OR
      conflict_state NOT IN ('none','present') OR
      applicability_state NOT IN ('applicable','not_applicable','unknown')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PB0025_REVISION_STATE_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM physical_binding_audit_events WHERE action NOT IN (
      'submit_candidate','select','request_approval','approve','reject','revoke','mark_stale',
      'revalidate','supersede','orphan','withdraw','create_candidate','legacy_migrate','mapping_update'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PB0025_AUDIT_ACTION_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM physical_binding_migration_records WHERE status NOT IN ('migrated','skipped','ambiguous','failed')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PB0025_MIGRATION_STATUS_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM physical_readiness_assessments WHERE
      layout_state NOT IN ('ready','not_ready','not_applicable') OR
      manufacturing_state NOT IN ('ready','not_ready','not_applicable')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PB0025_READINESS_STATE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM physical_binding_sets s
    LEFT JOIN physical_binding_revisions r ON
      r.revision_id = s.effective_selected_revision_id AND
      r.tenant_id = s.tenant_id AND r.project_id = s.project_id AND r.branch_id = s.branch_id AND
      r.board_instance_id = s.board_instance_id AND r.component_instance_id = s.component_instance_id AND
      r.variant_scope_digest = s.variant_scope_digest
    WHERE s.effective_selected_revision_id IS NOT NULL AND r.revision_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'PB0025_SELECTED_REVISION_OWNER_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM physical_binding_audit_events WHERE
      COALESCE(btrim(event->>'aggregateSetId'), '') = '' OR
      COALESCE(btrim(event->>'fromRevisionId'), '') = '' OR
      COALESCE(btrim(event->>'toRevisionId'), '') = ''
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PB0025_AUDIT_OWNER_METADATA_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM physical_binding_audit_events a
    LEFT JOIN physical_binding_sets s ON
      s.set_id = a.event->>'aggregateSetId' AND
      s.tenant_id = a.tenant_id AND s.project_id = a.project_id AND s.branch_id = a.branch_id AND
      s.component_instance_id = a.component_instance_id
    WHERE s.set_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'PB0025_AUDIT_SET_OWNER_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM physical_binding_audit_events a
    LEFT JOIN physical_binding_revisions source ON
      source.revision_id = a.event->>'fromRevisionId' AND source.binding_id = a.binding_id AND
      source.tenant_id = a.tenant_id AND source.project_id = a.project_id AND source.branch_id = a.branch_id AND
      source.component_instance_id = a.component_instance_id
    LEFT JOIN physical_binding_revisions target ON
      target.revision_id = a.event->>'toRevisionId' AND target.binding_id = a.binding_id AND
      target.tenant_id = a.tenant_id AND target.project_id = a.project_id AND target.branch_id = a.branch_id AND
      target.component_instance_id = a.component_instance_id
    WHERE source.revision_id IS NULL OR target.revision_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'PB0025_AUDIT_REVISION_OWNER_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM physical_binding_migration_records m
    LEFT JOIN physical_binding_revisions r ON
      r.revision_id = m.candidate_revision_id AND
      r.tenant_id = m.tenant_id AND r.project_id = m.project_id AND r.branch_id = m.branch_id AND
      r.component_instance_id = m.component_instance_id
    WHERE r.revision_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'PB0025_MIGRATION_REVISION_OWNER_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM physical_readiness_assessments a
    LEFT JOIN physical_binding_revisions r ON
      r.revision_id = a.binding_revision_id AND r.record_digest = a.binding_record_digest
    WHERE r.revision_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'PB0025_ASSESSMENT_REVISION_OWNER_INVALID';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE physical_binding_audit_events ADD COLUMN aggregate_set_id text;
ALTER TABLE physical_binding_audit_events ADD COLUMN from_revision_id text;
ALTER TABLE physical_binding_audit_events ADD COLUMN to_revision_id text;
UPDATE physical_binding_audit_events SET
  aggregate_set_id = event->>'aggregateSetId',
  from_revision_id = event->>'fromRevisionId',
  to_revision_id = event->>'toRevisionId';
ALTER TABLE physical_binding_audit_events ALTER COLUMN aggregate_set_id SET NOT NULL;
ALTER TABLE physical_binding_audit_events ALTER COLUMN from_revision_id SET NOT NULL;
ALTER TABLE physical_binding_audit_events ALTER COLUMN to_revision_id SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX physical_binding_revision_selected_owner_uniq ON physical_binding_revisions
  (revision_id, tenant_id, project_id, branch_id, board_instance_id, component_instance_id, variant_scope_digest);
CREATE UNIQUE INDEX physical_binding_revision_audit_owner_uniq ON physical_binding_revisions
  (revision_id, binding_id, tenant_id, project_id, branch_id, component_instance_id);
CREATE UNIQUE INDEX physical_binding_revision_migration_owner_uniq ON physical_binding_revisions
  (revision_id, tenant_id, project_id, branch_id, component_instance_id);
CREATE UNIQUE INDEX physical_binding_revision_assessment_owner_uniq ON physical_binding_revisions
  (revision_id, record_digest);
CREATE UNIQUE INDEX physical_binding_set_audit_owner_uniq ON physical_binding_sets
  (set_id, tenant_id, project_id, branch_id, component_instance_id);
--> statement-breakpoint

ALTER TABLE physical_binding_revisions ADD CONSTRAINT physical_binding_revision_number_check CHECK (revision > 0);
ALTER TABLE physical_binding_revisions ADD CONSTRAINT physical_binding_revision_lifecycle_check CHECK (lifecycle_state IN ('draft','candidate','selected','superseded','withdrawn','orphaned','obsolete'));
ALTER TABLE physical_binding_revisions ADD CONSTRAINT physical_binding_revision_approval_check CHECK (approval_state IN ('unreviewed','pending','approved','rejected','expired','revoked'));
ALTER TABLE physical_binding_revisions ADD CONSTRAINT physical_binding_revision_technical_check CHECK (technical_state IN ('pending','valid','invalid','unsupported'));
ALTER TABLE physical_binding_revisions ADD CONSTRAINT physical_binding_revision_freshness_check CHECK (freshness_state IN ('current','stale','unknown','missing_source'));
ALTER TABLE physical_binding_revisions ADD CONSTRAINT physical_binding_revision_conflict_check CHECK (conflict_state IN ('none','present'));
ALTER TABLE physical_binding_revisions ADD CONSTRAINT physical_binding_revision_applicability_check CHECK (applicability_state IN ('applicable','not_applicable','unknown'));
ALTER TABLE physical_binding_revisions ADD CONSTRAINT physical_binding_revision_identity_check CHECK (
  btrim(revision_id) <> '' AND btrim(binding_id) <> '' AND btrim(lineage_id) <> '' AND
  btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND btrim(branch_id) <> '' AND
  btrim(board_instance_id) <> '' AND btrim(component_instance_id) <> '' AND
  btrim(variant_scope_digest) <> '' AND btrim(technical_digest) <> '' AND
  btrim(record_digest) <> '' AND btrim(created_by) <> ''
);
ALTER TABLE physical_binding_sets ADD CONSTRAINT physical_binding_set_revision_number_check CHECK (revision > 0);
ALTER TABLE physical_binding_sets ADD CONSTRAINT physical_binding_set_identity_check CHECK (
  btrim(set_id) <> '' AND btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND
  btrim(branch_id) <> '' AND btrim(board_instance_id) <> '' AND
  btrim(component_instance_id) <> '' AND btrim(variant_scope_digest) <> '' AND btrim(record_digest) <> ''
);
ALTER TABLE physical_binding_audit_events ADD CONSTRAINT physical_binding_audit_action_check CHECK (action IN (
  'submit_candidate','select','request_approval','approve','reject','revoke','mark_stale',
  'revalidate','supersede','orphan','withdraw','create_candidate','legacy_migrate','mapping_update'
));
ALTER TABLE physical_binding_audit_events ADD CONSTRAINT physical_binding_audit_identity_check CHECK (
  btrim(event_id) <> '' AND btrim(aggregate_set_id) <> '' AND btrim(from_revision_id) <> '' AND
  btrim(to_revision_id) <> '' AND btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND
  btrim(branch_id) <> '' AND btrim(component_instance_id) <> '' AND btrim(binding_id) <> '' AND
  btrim(idempotency_key) <> '' AND btrim(event_digest) <> ''
);
ALTER TABLE physical_binding_migration_records ADD CONSTRAINT physical_binding_migration_status_check CHECK (status IN ('migrated','skipped','ambiguous','failed'));
ALTER TABLE physical_binding_migration_records ADD CONSTRAINT physical_binding_migration_identity_check CHECK (
  btrim(migration_key) <> '' AND btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND
  btrim(branch_id) <> '' AND btrim(component_instance_id) <> '' AND
  btrim(source_schema_version) <> '' AND btrim(candidate_revision_id) <> '' AND btrim(record_digest) <> ''
);
ALTER TABLE physical_readiness_assessments ADD CONSTRAINT physical_readiness_layout_state_check CHECK (layout_state IN ('ready','not_ready','not_applicable'));
ALTER TABLE physical_readiness_assessments ADD CONSTRAINT physical_readiness_manufacturing_state_check CHECK (manufacturing_state IN ('ready','not_ready','not_applicable'));
ALTER TABLE physical_readiness_assessments ADD CONSTRAINT physical_readiness_identity_check CHECK (
  btrim(assessment_id) <> '' AND btrim(binding_revision_id) <> '' AND
  btrim(binding_record_digest) <> '' AND btrim(policy_version) <> '' AND btrim(assessment_digest) <> ''
);
--> statement-breakpoint

ALTER TABLE physical_binding_sets ADD CONSTRAINT physical_binding_set_selected_revision_fk
  FOREIGN KEY (effective_selected_revision_id, tenant_id, project_id, branch_id, board_instance_id, component_instance_id, variant_scope_digest)
  REFERENCES physical_binding_revisions (revision_id, tenant_id, project_id, branch_id, board_instance_id, component_instance_id, variant_scope_digest)
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE physical_binding_audit_events ADD CONSTRAINT physical_binding_audit_set_owner_fk
  FOREIGN KEY (aggregate_set_id, tenant_id, project_id, branch_id, component_instance_id)
  REFERENCES physical_binding_sets (set_id, tenant_id, project_id, branch_id, component_instance_id)
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE physical_binding_audit_events ADD CONSTRAINT physical_binding_audit_from_revision_owner_fk
  FOREIGN KEY (from_revision_id, binding_id, tenant_id, project_id, branch_id, component_instance_id)
  REFERENCES physical_binding_revisions (revision_id, binding_id, tenant_id, project_id, branch_id, component_instance_id)
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE physical_binding_audit_events ADD CONSTRAINT physical_binding_audit_to_revision_owner_fk
  FOREIGN KEY (to_revision_id, binding_id, tenant_id, project_id, branch_id, component_instance_id)
  REFERENCES physical_binding_revisions (revision_id, binding_id, tenant_id, project_id, branch_id, component_instance_id)
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE physical_binding_migration_records ADD CONSTRAINT physical_binding_migration_revision_owner_fk
  FOREIGN KEY (candidate_revision_id, tenant_id, project_id, branch_id, component_instance_id)
  REFERENCES physical_binding_revisions (revision_id, tenant_id, project_id, branch_id, component_instance_id)
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE physical_readiness_assessments ADD CONSTRAINT physical_readiness_revision_owner_fk
  FOREIGN KEY (binding_revision_id, binding_record_digest)
  REFERENCES physical_binding_revisions (revision_id, record_digest)
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
