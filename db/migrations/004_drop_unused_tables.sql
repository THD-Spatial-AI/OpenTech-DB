-- =============================================================================
-- Migration 004 – Drop unused catalogue mirror tables
-- =============================================================================
-- The `technologies` and `technology_instances` tables (created in migration
-- 002) were never used. The authoritative Technology and Instance records live
-- in the JSON catalogue under data/. Supabase stores workflow state only
-- (Candidates, Submissions, auth). See docs/adr/0003-supabase-for-workflow-not-catalogue.md.
--
-- Safe to run multiple times (IF EXISTS guards).
-- =============================================================================

DROP TABLE IF EXISTS technology_instances CASCADE;
DROP TABLE IF EXISTS technologies CASCADE;
