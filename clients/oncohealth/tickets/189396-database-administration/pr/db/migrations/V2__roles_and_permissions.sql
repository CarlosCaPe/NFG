-- =============================================================================
-- V2__roles_and_permissions.sql
-- Role model for newUM PostgreSQL (DBA ticket #189396)
-- =============================================================================
--
-- Three roles:
--   newum_app        - application user: DML only (SELECT/INSERT/UPDATE/DELETE)
--                      No CREATE TABLE, ALTER TABLE, DROP, TRUNCATE.
--   newum_migrations - migration runner: full DDL. Only used by the pipeline.
--   newum_readonly   - reporting / debugging: SELECT only.
--
-- The existing newum_dev / newum_test users are created by DevOps. This script
-- assigns them to the correct roles. Ask Luiyi (DevOps) to run:
--   ALTER ROLE newum_dev IN GROUP newum_app;
--   ALTER ROLE newum_test IN GROUP newum_app;
-- OR wire through Azure AD as per DBA ticket requirement.
-- =============================================================================

-- -----------------------------------------------------------------------
-- Create roles (idempotent)
-- -----------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newum_app') THEN
    CREATE ROLE newum_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newum_migrations') THEN
    CREATE ROLE newum_migrations NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newum_readonly') THEN
    CREATE ROLE newum_readonly NOLOGIN;
  END IF;
END
$$;

-- -----------------------------------------------------------------------
-- newum_app: DML on all current and future tables in public schema
-- -----------------------------------------------------------------------
GRANT CONNECT ON DATABASE newum TO newum_app;
GRANT USAGE ON SCHEMA public TO newum_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO newum_app;

GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public TO newum_app;

-- Future tables/sequences created by migrations automatically grant to app user.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO newum_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO newum_app;

-- Revoke DDL from app user (defense in depth).
REVOKE CREATE ON SCHEMA public FROM newum_app;

-- -----------------------------------------------------------------------
-- newum_migrations: full DDL for the pipeline migration runner
-- -----------------------------------------------------------------------
GRANT ALL PRIVILEGES ON DATABASE newum TO newum_migrations;
GRANT ALL PRIVILEGES ON SCHEMA public TO newum_migrations;

-- -----------------------------------------------------------------------
-- newum_readonly: SELECT only (read replicas, DataDog, reporting)
-- -----------------------------------------------------------------------
GRANT CONNECT ON DATABASE newum TO newum_readonly;
GRANT USAGE ON SCHEMA public TO newum_readonly;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO newum_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO newum_readonly;

-- -----------------------------------------------------------------------
-- Audit note (required by Onco DBA Zaki Mohammed per ADO #185412)
-- -----------------------------------------------------------------------
-- All role changes after this baseline must go through a migration script.
-- No manual GRANT/REVOKE in production. Use Flyway version V{n}__grant_*.sql.
