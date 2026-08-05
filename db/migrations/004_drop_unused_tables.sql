-- =============================================================================
-- Migration 004 – Drop unused catalogue mirror tables
-- =============================================================================
-- The `technologies` and `technology_instances` tables (created in migration
-- 002) were never used. The authoritative Technology and Instance records live
-- in the JSON catalogue under data/. Supabase stores data/workflow state only
-- (candidates and submissions), never users or authentication records.
--
-- Safe to run multiple times (IF EXISTS guards).
-- =============================================================================

DROP TABLE IF EXISTS technology_instances CASCADE;
DROP TABLE IF EXISTS technologies CASCADE;
