-- Audit events are append-only for the application (spec §21): any UPDATE or
-- DELETE is rejected by the database itself, not just by application code.
CREATE OR REPLACE FUNCTION audit_events_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_reject_change();
