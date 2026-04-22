# DBA Role Charter — newUM PostgreSQL
**Ticket:** ADO #189396 | **Team:** NewFire Global / OncoHealth Data & Backend  
**Owner:** Carlos Carrillo (AI-Leveraged Documenter, dataqbs via NFG)  
**Date:** 2026-04-22 | **Status:** Draft v1.0

---

## Vision

The newUM PostgreSQL database is the OLTP core of a HIPAA-regulated, clinically critical
prior-authorization platform. Our DBA function is not a gatekeeper role operated from pgAdmin —
it is a **scripting-first, automation-first discipline** where every runbook, configuration
baseline, and operational procedure ships as code that can be reviewed in a pull request,
version-controlled in Git, and executed idempotently in any environment.

---

## Scope — What We Own

| Domain | We own | We do NOT own |
|--------|--------|---------------|
| Schema DDL governance | Migration scripts, review gate, Flyway config | Application feature logic inside SQL |
| Role & privilege model | Role definitions, GRANT/REVOKE scripts | Azure AD user provisioning (DevOps) |
| postgresql.conf baseline | Parameter recommendations, documentation | Azure Portal click-ops (DevOps applies) |
| Backup & recovery | Strategy, DAGs, restore runbooks, testing | Azure infrastructure provisioning |
| Performance monitoring | pg_stat_statements, slow query alerting, bloat | Application query design (backend team) |
| Incident response | DB-layer triage, runbooks, escalation path | Application-layer bugs |
| Data dictionary | Schema docs, column-level descriptions | Business rules documentation (Product) |

**Out of scope by design:**
- Analytic queries against the operational DB (all analytics run from Databricks Gold/Silver — hard constraint confirmed in System Design Doc)
- Direct JDBC/SQL access to newUM DB from Databricks (Lakeflow Connect is the approved path)
- Azure infrastructure provisioning — that belongs to Luiyi Valentin (DevOps)
- MATIS legacy databases (`oadb`, `DrugsMS`, `EligibilityMS`, `ProviderMS`) — MS-SQL, separate team, not newUM scope

---

## Philosophy: Scripting-First DBA

Old-school DBA: log into pgAdmin, run commands manually, write a Word doc.  
Our approach:

1. **Every change is a migration script** — no DDL outside of `db/migrations/V{n}__*.sql`. (Migration runner: Flyway proposed — pending team decision, see Section 2.)
2. **Every runbook is a script** — shell, Python, or SQL. If it can't be re-run safely, it's wrong.
3. **Every config recommendation ships as code** — `postgresql.conf` parameters documented in a versioned `.conf` file, applied via ADO pipeline or Ansible, never by hand.
4. **Every alert is defined in code** — DataDog monitors and thresholds live in Terraform/YAML, not set via UI.
5. **Every access change goes through a migration** — `V{n}__grant_*.sql` files, not ad-hoc `GRANT` statements.

---

## 1. Instance & Configuration

### What we're working with
- **Engine:** Azure Database for PostgreSQL Flexible Server (managed, not self-hosted)
- **Host:** `fcc9bae56d16.privatelink.postgres.database.azure.com` (Private Link — only reachable from inside Azure / windows365 CPC)
- **Environments:** dev, test, UAT, prod (dev and test confirmed active; UAT/prod provisioning TBD)
- **Access:** Via windows365 CPC (VDI). Local connections from outside Azure will fail — by design.

### Our responsibilities

**postgresql.conf baseline** — Deliver a documented parameter file per environment tier. Key areas:

```conf
# Memory (adjust per SKU — values below for 4-core / 16 GB baseline)
shared_buffers = 4GB                  # 25% of RAM
effective_cache_size = 12GB           # 75% of RAM
work_mem = 32MB                       # per sort/hash; watch for parallel queries
maintenance_work_mem = 512MB          # VACUUM, CREATE INDEX

# Connections
max_connections = 100                 # use PgBouncer in front; not a free resource
# PgBouncer pool_size = 20 per service; max_connections headroom for migrations user

# WAL / replication
wal_level = logical                   # REQUIRED: Lakeflow Connect (Databricks CDC)
max_replication_slots = 5             # 1 per Lakeflow pipeline + buffer
max_wal_senders = 5
wal_keep_size = 1GB                   # prevent slot starvation under backpressure

# Autovacuum baseline (tune after first 60 days of production load)
autovacuum = on
autovacuum_max_workers = 4
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02
autovacuum_vacuum_cost_delay = 2ms

# Logging (feeds DataDog + pgBadger)
log_min_duration_statement = 500      # log queries > 500ms
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_temp_files = 0
```

**Delivery format:** A `db/config/postgresql-baseline.conf.md` document (annotated with rationale)
submitted as a PR for review by Jack Hall's replacement and Michal Mucha before DevOps applies.

**pg_hba.conf** — On Azure Flexible Server, client auth is managed via the Azure Portal firewall
rules and SSL enforcement toggle, not a raw `pg_hba.conf` file. Our deliverable is a documented
access matrix (which CIDR ranges, which users, which auth method) that DevOps implements.

**PgBouncer** — newUM runs on AKS where each pod can open independent connections. Without pooling,
100 pods x 5 connections = 500 connections, which exhausts PostgreSQL well before max_connections.

Recommended setup:
- PgBouncer deployed as a sidecar or shared deployment inside AKS cluster
- `pool_mode = transaction` (compatible with Dapper's connection-per-query pattern)
- Pool size: 20 connections per service type to PostgreSQL; unlimited from app side
- Config shipped as a Kubernetes ConfigMap, managed by DevOps with DBA-provided parameters

**Naming conventions** — Enforced via migration script validation, not guidelines:

| Object | Convention | Example |
|--------|------------|---------|
| Schema | `snake_case` | `eligibility`, `case_management` |
| Table | `snake_case`, singular | `benefit_plan`, `case_drug` |
| Column | `snake_case` | `coverage_effective_date` |
| PK | `id` (BIGINT GENERATED ALWAYS) | `id` |
| FK | `{referenced_table}_id` | `benefit_plan_id` |
| Index | `ix_{table}_{columns}` | `ix_eligibility_person_id` |
| Unique index | `uq_{table}_{columns}` | `uq_payer_external_code` |
| Sequence | managed by IDENTITY columns; no manual sequences | |
| Migration file | `V{n}__{verb}_{object}.sql` | `V5__add_eligibility_end_date.sql` |

---

## 2. Schema & Object Management

### Migration tool: Flyway (proposed)

> ⚠️ **PENDING DECISION:** Ticket #189396 lists Alembic/SQLAlchemy and Liquibase as migration tooling options. DBA proposes **Flyway** because: (1) backend is .NET — no Python dependency in the pipeline, (2) plain SQL that Zaki Mohammed can audit without SQLAlchemy knowledge, (3) `cleanDisabled=true` protects production from accidental schema wipe, (4) checksum validation prevents tampering. Needs explicit sign-off from Erik Hjortshoj or Jack Hall's replacement before this PR merges.

**What is already in place** (PR skeleton at `clients/oncohealth/tickets/189396-database-administration/pr/`):
- `db/flyway.conf` — safety settings: `cleanDisabled=true`, `validateOnMigrate=true`, `outOfOrder=false`
- `db/migrations/V1__baseline_schema.sql` — placeholder; must be filled via `pg_dump --schema-only` from CPC
- `db/migrations/V2__roles_and_permissions.sql` — role model (newum_app, newum_migrations, newum_readonly)
- `scripts/migrate-local.sh` — developer-facing CLI wrapper
- `azure-pipelines/db-migrate.yml` — ADO pipeline (gated execution, owned by DevOps)

**Domain schemas confirmed** (from Miro + schema workshops as of 2026-04-21):

| Schema | Core tables | Owner |
|--------|-------------|-------|
| `public` (OLTP default) | Case, CaseDrug, CaseOfficeContact, CaseProviderSelection | BE Team |
| Eligibility domain | Eligibility, Person, RelatedPerson, Address, Payer, BenefitPlan, BusinessGrouping, BusinessGrain, EmployerGroup | Data Team / BE |
| Provider domain | Provider, ProviderVersion, NPI | BE + Arben Osmani |
| Payer domain | Payer, payer-specific rules, payer configuration codes | Data Team / Product |
| Supporting | ICD codes, reference tables | Data Team |

Note: Domain schemas are currently colocated in `public`. Domain-level schema separation
(`eligibility.*`, `case.*`, etc.) is a future migration — not in V1 scope. All current
objects live in `public`.

**Migration review process:**

```
Developer writes V{n}__*.sql
  → PR opened in ADO
  → DBA review (idempotency, naming, impact radius, rollback strategy)
  → 1 approval required (standard); 2 approvals for schema-breaking changes
  → ADO pipeline runs flyway info (dry-run) on PR branch
  → Merge → pipeline runs flyway migrate against dev automatically
  → Manual approval gate before test/UAT/prod
```

**DDL privileges in production:**
- `newum_app` has `REVOKE CREATE ON SCHEMA public` — confirmed in V2 migration
- Only `newum_migrations` (used exclusively by the ADO pipeline) can run DDL
- No developer has direct DDL access to production — access request goes through Jakub Chabik (Manager)

**Schema change request process for backend team:**
1. Open ADO task under Epic "Database Administration" (parent: #189396)
2. Describe: table/column affected, reason, expected cardinality change
3. DBA drafts migration SQL and shares for review
4. PR follows the standard process above

---

## 3. Security

### Role model (implemented in V2__roles_and_permissions.sql)

| Role | Login | Privileges | Used by |
|------|-------|------------|---------|
| `newum_app` | No (login via named user) | SELECT, INSERT, UPDATE, DELETE on all tables/sequences. No DDL. | .NET application pods |
| `newum_migrations` | No (login via pipeline service principal) | Full DDL + DML. Only used by ADO pipeline. | Flyway migration runner |
| `newum_readonly` | No (login via named user) | SELECT only. No DML. | DataDog agent, reporting queries, debugging |

Named login users (`newum_dev`, `newum_test`, production equivalents) are provisioned by DevOps
(Luiyi Valentin) and assigned to these roles. Role assignments happen in migration scripts,
not manually.

**SSL/TLS:** Azure Database for PostgreSQL enforces TLS 1.2+ by default. `ssl=require` must be
set in all connection strings. Application connection string template:

```
Host=fcc9bae56d16.privatelink.postgres.database.azure.com;
Port=5432;
Database=newum_{env};
Username=newum_app_{env};
Password=${DB_APP_PASSWORD};
SSL Mode=Require;
```

**pgAudit:** Not available natively on Azure Flexible Server without the `pgaudit` extension.
Enable via Azure Portal → Server Parameters → set `azure.extensions = pgaudit` and add `pgaudit` to `shared_preload_libraries`.
Once enabled, our configuration target:

```conf
pgaudit.log = 'ddl, role, connection'
pgaudit.log_catalog = off        # reduce noise from catalog queries
pgaudit.log_relation = on        # log table-level access in DDL events
```

Audit logs feed into Azure Monitor → DataDog for retention and alerting.
HIPAA audit trail retention: 10 years (ADLS Gen2 WORM storage, per operational_practices in System Design Doc).

**Secrets management:**
- Database passwords live in Azure Key Vault (managed by DevOps)
- ADO pipelines pull credentials from variable group `newum-db-{env}` at runtime
- No credentials in `flyway.conf`, no credentials in Git
- Local dev uses `.env` file (gitignored). Template: `.env.example` (credentials redacted)
- Rotation cadence: 90 days for application users; immediate on any suspected leak

**Row-level security (RLS):**
- Not in V1 scope. Future consideration if multi-tenant payer data requires isolation within
  a single table (e.g., payer-scoped eligibility reads). Flag for architecture review before implementing.

**Access review process:**
- Quarterly: review all login roles against current team roster (coordinate with Rachel Collier)
- Offboarding trigger: immediate revocation within 1 business day (Jack Hall departure 2026-04-10 is reference case)
- All access changes produce a migration script for audit trail

---

## 4. Backup & Recovery

### Targets
| Metric | Target | Rationale |
|--------|--------|-----------|
| RPO | 1 hour | Lakeflow Connect CDC + WAL archiving provides ~minute-level recovery points |
| RTO | 2 hours | Confirmed in System Design Doc DR targets for Airflow (same tier) |
| Backup retention | 7 years | HIPAA minimum for PHI-adjacent operational data |

### Strategy

> **Note on pg_basebackup/pgBackRest/WAL-G:** Ticket #189396 mentions `pg_basebackup + WAL archiving (pgBackRest/WAL-G)`. On Azure Flexible Server (managed PaaS), direct `pg_basebackup` access is not exposed — Azure's built-in backup subsystem replaces it. WAL-G remains relevant for WAL archiving beyond the 35-day PITR window (V2 operational scope).

Azure Database for PostgreSQL Flexible Server provides:
- **Automated backups:** Full backup weekly + transaction logs every 5 minutes (built-in, no action required)
- **PITR (Point-in-Time Restore):** Up to 35 days via Azure Portal (short-term)
- **Long-term retention:** Azure Backup vault for 7-year HIPAA compliance (DevOps configures vault; DBA defines policy)

For self-managed WAL archiving beyond Azure's 35-day window, we evaluate **WAL-G** as the
archiving agent to Azure Blob Storage (ADLS Gen2). This is a V2 operational concern once
the platform is live.

**Airflow DAGs for backup verification:**

```python
# dag: verify_db_backup.py
# Schedule: daily 06:00 UTC
# Purpose: validate last backup is recent and restorable
#
# Tasks:
#   1. Query Azure Backup API → assert last backup < 6 hours ago
#   2. Restore to ephemeral test instance (weekly only, not daily)
#   3. Run schema validation query: check table count matches baseline
#   4. Assert row count in canary table (non-PHI reference table) matches expected range
#   5. Drop ephemeral instance
#   6. Emit DataDog metric: backup_verified=1 / backup_failed=1
```

The DAG is the runbook. If it fails, it pages. If a human has to manually verify backups,
we've already failed.

**Restore procedure (scripted):**

```bash
# scripts/restore-pitr.sh
# Restores newUM DB to a point-in-time via Azure CLI
# Usage: ./restore-pitr.sh --env test --target-time "2026-04-20T14:30:00Z"
#
# Requires: az CLI logged in, contributor role on RG
# NOTE: restores to a NEW server instance — never overwrites the source.

az postgres flexible-server restore \
  --resource-group newum-rg \
  --name newum-${ENV}-restore-$(date +%Y%m%d%H%M) \
  --source-server newum-${ENV} \
  --restore-time "${TARGET_TIME}"
```

All restore procedures are tested quarterly. Test results are logged as ADO task comments.

---

## 5. High Availability & Replication

### Azure-managed HA (primary path)
Azure Database for PostgreSQL Flexible Server with **Zone Redundant HA** provides:
- Synchronous standby in a paired availability zone (same region)
- Automatic failover: RTO ~60-120 seconds
- No Patroni required — this is a managed PaaS service, not a self-hosted cluster

> **Note on Patroni:** Ticket #189396 lists Patroni as an HA option. Patroni is a HA manager for self-hosted PostgreSQL deployments. On Azure Flexible Server (managed PaaS), Zone Redundant HA provides equivalent functionality natively — Patroni is not applicable and would conflict with the managed service model.

Our deliverables are:
- Documented failover test runbook (planned + unplanned)
- Replication lag monitoring via DataDog (Azure exposes `azure.postgresql.replication_lag_seconds`)
- Alert threshold: lag > 30 seconds = warning; lag > 120 seconds = P2

### Logical replication for Databricks (Lakeflow Connect)
Active workspace for Lakeflow validation: `oh-databricks-ws-test` (test; dev workspace `oh-databricks-ws-dev` is blocked — contains PHI).

This is a DBA-owned configuration concern, not a managed-service default:

```sql
-- Must be set in postgresql.conf (via Azure Portal parameter):
-- wal_level = logical
-- max_replication_slots = 5
-- max_wal_senders = 5

-- Replication user (created in a migration script, not manually):
CREATE ROLE newum_replication REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD}';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO newum_replication;

-- Slot management script (run to check for orphaned slots):
-- SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn))
-- FROM pg_replication_slots;
```

**WAL bloat risk:** If Lakeflow Connect pipeline is paused or deleted without dropping the
replication slot, WAL accumulates unboundedly. Monitoring rule:
- Alert if any replication slot is inactive for > 4 hours
- Alert if WAL size > 5 GB
- Runbook: `scripts/drop-orphaned-slots.sh` (lists + optionally drops inactive slots)

**Failover runbooks:**
- Planned switchover (maintenance): Azure Portal → Primary/Standby swap → update connection string in Key Vault → restart pods
- Unplanned failover: Azure initiates automatically → verify app reconnects → check replication slot status → notify Data team (Michal Mucha) to verify Lakeflow Connect resumes

---

## 6. Performance Monitoring & Tuning

### pg_stat_statements
Required extension. Enable via Azure Portal (`shared_preload_libraries = pg_stat_statements`).

```sql
-- Weekly slow query report (pipe to DataDog or export to ADO):
SELECT
  round((total_exec_time / calls)::numeric, 2) AS avg_ms,
  calls,
  round(total_exec_time::numeric, 2) AS total_ms,
  left(query, 120) AS query_sample
FROM pg_stat_statements
WHERE calls > 50
ORDER BY avg_ms DESC
LIMIT 20;
```

This query ships as an Airflow DAG task (`analyze_slow_queries`) that runs weekly and posts
results as a DataDog event. No manual pgAdmin required.

### Slow query logging
`log_min_duration_statement = 500` (in postgresql.conf baseline above). Logs ship to Azure
Monitor via the Flexible Server diagnostic settings; DataDog agent picks them up.

### Autovacuum tuning
Baseline settings are in Section 1. Tuning process:

```bash
# scripts/check-bloat.py
# Queries pg_stat_user_tables for dead tuple ratios.
# Run weekly via Airflow; alert if dead_tuple_ratio > 20% on any table.

import psycopg2, os
conn = psycopg2.connect(os.environ["DB_URL"])
cur = conn.cursor()
cur.execute("""
    SELECT relname,
           n_dead_tup,
           n_live_tup,
           round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
           last_vacuum,
           last_autovacuum
    FROM pg_stat_user_tables
    WHERE n_live_tup + n_dead_tup > 10000
    ORDER BY dead_pct DESC NULLS LAST
    LIMIT 20;
""")
for row in cur.fetchall():
    print(row)
```

### Index review process
We do not design indexes for backend team queries — we own the tools and process:

1. Weekly: run `check-bloat.py` extended to include `pg_stat_user_indexes` (unused indexes)
2. Monthly: coordinate with backend team on pg_stat_statements top-10 slow queries
3. All new indexes proposed by the backend team go through a migration script review
4. Index creation in production uses `CREATE INDEX CONCURRENTLY` — never blocking

### Lock contention monitoring
```sql
-- Alert query: locks held > 5 seconds
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
JOIN pg_locks ON pg_stat_activity.pid = pg_locks.pid
WHERE pg_locks.granted = false
  AND now() - pg_stat_activity.query_start > interval '5 seconds';
```

DataDog custom check runs this every 60 seconds. Alert threshold: any lock > 30 seconds = P2.

---

## 7. Capacity Planning

### Baseline metrics to establish (Day 1 of production)
| Metric | Tooling | Alert threshold |
|--------|---------|-----------------|
| Disk usage | DataDog `azure.postgresql.storage_percent` | 75% warning, 85% critical |
| CPU | DataDog `azure.postgresql.cpu_percent` | 80% sustained 5min = warning |
| Active connections | DataDog `azure.postgresql.active_connections` | 80% of max_connections |
| Replication lag | DataDog `azure.postgresql.replication_lag_seconds` | 30s warning |
| WAL size | pg_stat_replication | 5 GB = P2 |
| Dead tuple ratio | `check-bloat.py` | 20% = warning |

### Forecasting process
Once 30 days of production data exists:
- Monthly: export DataDog metrics to CSV, plot growth trend per domain (eligibility, case, provider)
- Key growth driver: eligibility data volume tied to payer onboarding cadence (first client: Geisinger, EOY 2026)
- Coordination: Michal Mucha (Data team) owns payer onboarding schedule → DBA translates to capacity projections
- Output: quarterly capacity review shared with Erik Hjortshoj

---

## 8. Tooling & Stack

| Tool | Role | Owner |
|------|------|-------|
| Flyway CLI | Migration execution | DBA (config), DevOps (ADO pipeline) |
| Azure Database for PostgreSQL Flexible Server | Managed engine | DevOps provisions, DBA configures |
| PgBouncer | Connection pooling | DBA designs config, DevOps deploys on AKS |
| DataDog Postgres integration | Monitoring, alerting | DevOps enables agent; DBA defines monitors |
| Airflow on AKS | Backup DAGs, maintenance DAGs, bloat checks | DBA authors DAGs, Data team owns Airflow infra |
| Azure Key Vault | Secrets management | DevOps manages vault; DBA defines rotation policy |
| pgBadger | Slow query log analysis (optional, on-demand) | DBA, run locally against log exports |
| psycopg2 + Python | Maintenance scripts (`check-bloat.py`, etc.) | DBA |

**Data access layer (application side — not DBA-owned but relevant):**
- Backend team uses **Dapper** (confirmed in System Design Doc / Confluence NewUM Engineering space). No EF ORM.
- This means no ORM-generated migrations — all schema changes come through Flyway. Good.
- Python scripts (Airflow DAGs, maintenance) use `psycopg2`. SQLAlchemy Core is acceptable
  for Python tooling but not mandated.

**What we do NOT use:**
- EF Core migrations (ORM generates SQL — conflicts with Flyway ownership)
- pgAdmin for production changes (all changes are scripted)
- Liquibase (proposed to exclude in favor of Flyway — pending decision, see Section 2)
- Alembic/SQLAlchemy (proposed to exclude — .NET backend, no Python in migration pipeline — pending decision, see Section 2)
- ADF for DB orchestration (Airflow is the sole orchestrator — hard constraint from System Design Doc)

---

## 9. Documentation & Governance

### Data dictionary
- Maintained as a set of migration comments: `COMMENT ON COLUMN table.column IS '...'`
- These survive `pg_dump` and are the authoritative machine-readable dictionary
- Human-readable version generated via script and published to Confluence (NewUM Engineering space)
- ADO task #186617 ("Make a data dictionary for Case Schema") was assigned to Jack Hall (departed 2026-04-10) — this is a DBA handoff item

### Runbooks (maintained as scripts, not Word docs)
| Runbook | Location | Trigger |
|---------|----------|---------|
| Restore from PITR | `scripts/restore-pitr.sh` | Incident P1 |
| Drop orphaned replication slots | `scripts/drop-orphaned-slots.sh` | Lakeflow pipeline deleted |
| Emergency connection kill | `scripts/kill-idle-connections.sh` | Connection exhaustion |
| Force VACUUM on bloated table | `scripts/force-vacuum.sh` | bloat > 30%, autovacuum not keeping up |
| Failover test | `scripts/failover-test.sh` | Quarterly DR test |

### Change management for DDL
1. No DDL outside of a Flyway migration script
2. Breaking changes (DROP COLUMN, type change, rename) require 2-approver review + notification to backend team (at minimum 1 sprint in advance)
3. All migrations use **Expand-Contract** pattern: add nullable column first; apply constraint in a subsequent migration after all consumers have deployed (confirmed pattern from operational_practices in System Design Doc)
4. Emergency hotfix migrations: 2-engineer approval + post-incident review same day

### SLAs
| Metric | Target |
|--------|--------|
| Database availability (prod) | 99.9% (Azure SLA) |
| Migration deployment (test) | Same day as merge to main |
| Migration deployment (prod) | Next business day with manual approval gate (approver: Zaki Mohammed, per `db-migrate.yml`) |
| Incident response (P1 DB) | 15 min acknowledgment, 2 hour resolution target |
| Access revocation (offboarding) | 1 business day |

---

## 10. Incident Response

### On-call ownership
- Primary: Carlos Carrillo (DBA / documenter role, NFG)
- Escalation: Jakub Chabik (Manager, OncoHealth) → Erik Hjortshoj (SVP Engineering)
- DevOps assist: Luiyi Valentin (infrastructure, connection to Azure Portal)
- Data impact: Michal Mucha (if incident affects Lakeflow Connect or Airflow pipelines)

### Runbook index

**Connection exhaustion**
```bash
# 1. Identify top connection consumers
SELECT client_addr, usename, count(*) FROM pg_stat_activity GROUP BY 1,2 ORDER BY 3 DESC;
# 2. Kill idle connections older than 10 minutes
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE state = 'idle' AND now() - state_change > interval '10 minutes';
# 3. If PgBouncer is deployed: check pool saturation, restart pool if needed
# 4. If persistent: raise max_connections (requires restart — coordinate with DevOps)
```

**Deadlocks**
```sql
-- Find blocking queries
SELECT pid, usename, pg_blocking_pids(pid) AS blocked_by, query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;
-- Kill blocker (confirm with backend team first)
SELECT pg_terminate_backend(<blocking_pid>);
```

**Disk full / WAL bloat**
```bash
# Check WAL size
du -sh $(psql -t -c "SHOW data_directory")/pg_wal
# Check replication slots consuming WAL
SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots ORDER BY 3 DESC;
# Drop orphaned inactive slot (ONLY after confirming pipeline is down)
SELECT pg_drop_replication_slot('<slot_name>');
```

**Migration failure (Flyway)**
```bash
# Check what Flyway thinks failed
flyway info -configFiles=db/flyway.conf

# If migration is partially applied and marked FAILED:
# 1. Fix the SQL error
# 2. Run flyway repair (resets checksum, marks failed migration as deleted)
flyway repair -configFiles=db/flyway.conf
# 3. Re-run
flyway migrate -configFiles=db/flyway.conf
```

### Post-incident review
- P1/P2 incidents: blameless post-mortem within 48 hours
- Output: ADO task under #189396 with timeline, root cause, corrective action
- Corrective action that involves a config change → migration script or documented postgresql.conf update
- Corrective action that involves a runbook → update the relevant script in `scripts/`

---

## Team Interfaces

| Team | Point of contact | Our interface |
|------|-----------------|---------------|
| DevOps | Luiyi Valentin | Provide postgresql.conf parameters + PgBouncer config → DevOps applies in Azure |
| Backend (.NET) | Backend lead (post-Jack Hall) | Review DDL migration PRs; provide index guidance; define schema change request process |
| Data (Databricks) | Michal Mucha | Maintain `wal_level=logical`, replication slot health; coordinate on schema evolution for Lakeflow |
| Product / BA | Rachel Collier, Vika Nobis | Document schema decisions in ADO task comments; publish data dictionary to Confluence |
| Security / Audit | Jakub Chabik (Manager) | Quarterly access review; pgAudit log retention; HIPAA evidence |

---

## Open Items (as of 2026-04-22)

| # | Item | Owner | Priority | Blocker? |
|---|------|-------|----------|----------|
| 1 | Fill `V1__baseline_schema.sql` — run `pg_dump --schema-only --no-owner --no-acl` from windows365 CPC against `newum_dev` | Carlos (DBA) | High | Yes — blocks Flyway PR merge |
| 2 | **Self-assign ADO #189396** in Azure DevOps — currently UNASSIGNED | Carlos | High | Yes — ticket has no owner |
| 3 | **Flyway vs Alembic decision** — get explicit sign-off from Erik Hjortshoj or Jack Hall's replacement | Carlos raises, Erik/lead decides | High | Yes — blocks PR merge |
| 4 | **airflow-dna repo access** — email `devopsrequest@oncologyanalytics.com`: "Need contributor access to airflow-dna repo for DBA ticket #189396" | Carlos | High | Yes — blocks PR submission |
| 5 | **Zaki Mohammed first contact** — share `V2__roles_and_permissions.sql` and `db-migrate.yml` approval gate for his review; contact via Alexander Rodriguez or Luiyi | Carlos | High | No (but needed before prod) |
| 6 | Data dictionary for Case schema (ADO #186617 — Jack Hall departed 2026-04-10, currently unassigned) | **TBD** | High | No |
| 7 | Enable `pgaudit` extension via Azure Portal — open child ADO task under #189396 | Luiyi (DevOps) | High | No |
| 8 | Set `wal_level=logical` in Azure Portal (required for Lakeflow Connect) — open child ADO task under #189396 | Luiyi (DevOps) + DBA confirms | High | No |
| 9 | UAT/prod environments — provisioning not yet confirmed; coordinate with Luiyi once dev/test pipeline is stable | DevOps + DBA | Medium | No |
| 10 | PgBouncer deployment in AKS | DBA designs config, DevOps deploys | Medium | No |
| 11 | Azure Backup vault long-term retention policy (7yr HIPAA) | DevOps + DBA policy | Medium | No |
| 12 | Airflow DAGs: backup verification, bloat check, slow query report | DBA authors (Airflow infra = Data team) | Medium | No |
| 13 | DataDog Postgres integration + custom monitors | DevOps enables, DBA defines monitors | Medium | No |
| 14 | Quarterly failover test runbook | DBA authors, DevOps executes | Low (pre-prod) | No |
| 15 | RLS evaluation for multi-payer data isolation | DBA + Architecture | Low (V2 scope) | No |

---

## Next Steps (Immediate — This Sprint)

### This week (unblocking actions)

1. **ADO self-assign** — Go to [#189396](https://dev.azure.com/oncologyanalytics/newUM/_workitems/edit/189396) and assign to Carlos Carrillo.
2. **pg_dump from CPC** — From windows365 CPC terminal:
   ```bash
   pg_dump \
     --host=fcc9bae56d16.privatelink.postgres.database.azure.com \
     --port=5432 --username=newum_dev --dbname=newum_dev \
     --schema-only --no-owner --no-acl \
     --file=V1__baseline_schema.sql
   ```
   Paste output into `pr/db/migrations/V1__baseline_schema.sql` (replaces the `SELECT 1` placeholder).
3. **airflow-dna access request** — Email `devopsrequest@oncologyanalytics.com`:
   > Subject: Repo access request — airflow-dna  
   > Body: "Need contributor access to the airflow-dna repo for DBA work on ticket [#189396](https://dev.azure.com/oncologyanalytics/newUM/_workitems/edit/189396). Scope: adding Flyway migration pipeline (`azure-pipelines/db-migrate.yml`) and role scripts."
4. **Flyway decision** — Raise in next standup or async Teams message to Erik/Jack's replacement. Reference: [#189396](https://dev.azure.com/oncologyanalytics/newUM/_workitems/edit/189396) currently lists Alembic; DBA proposes Flyway (reasons in Section 2). Need written confirmation in ADO comment or Teams.

### Before prod

5. **Zaki Mohammed review** — Share `V2__roles_and_permissions.sql` (role model) and `db-migrate.yml` (approval gate) for sign-off. Zaki is the manual approver gate in the ADO pipeline for prod deployments. Contact via Luiyi Valentin or Alexander Rodriguez.
6. **Open child ADO tasks** — Create child tasks under #189396 for items #7 (pgaudit) and #8 (wal_level=logical) so Luiyi can pick them up in the next sprint.
7. **Scope alignment with Arben/Cory** — Confirm DDL (ADO) vs data movement (Airflow) split. Draft Teams message ready — see session notes.
