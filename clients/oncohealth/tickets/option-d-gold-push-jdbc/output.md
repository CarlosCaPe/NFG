---
pdf_options:
  margin:
    top: 0mm
    bottom: 0mm
    left: 15mm
    right: 15mm
---

# Spike: Option D — Gold Push via Spark JDBC Write to PostgreSQL

> **Author**: Carlos Carrillo (`ccarrillo@oncologyanalytics.com`)
> **Date**: 2026-04-09
> **Status**: PROPOSAL — Not yet discussed with team. Pending review.
> **Predecessor spikes**: [#186438](../186438-iceberg-rest-catalog/) (Option A — Iceberg REST, BLOCKED), [#187526](../187526-adls-delta-reader/) (Option B — Direct ADLS, BLOCKED)
> **Project context**: `../../knowledge.json` v1.25.0 — operational facts cited as [K].

---

## 1. Executive Summary

**Verdict: PROPOSED** — A fourth approach to the Databricks → PostgreSQL data exchange
problem that inverts the direction from PULL to PUSH. Instead of PostgreSQL reaching into
Databricks (Options A, B, C), Databricks pushes Gold-layer data directly into PostgreSQL
via a scheduled Spark JDBC write.

**Key insight**: Options A/B/C all require NewUM or an intermediary to PULL data from
Databricks infrastructure. All three hit security/access blockers. Option D inverts the flow —
Databricks already has Spark JDBC built-in, Airflow on AKS can orchestrate, and Databricks
Secrets vault stores credentials. No new infrastructure. No `external_access_enabled`.
No ADLS storage credentials needed by PostgreSQL.

**Novelty verification**: Searched all captured Teams channels, NoPHI-Data (394 lines),
NewUM channel, ADO work items, and Databricks schemas. The 3 official candidates from
March 30 (Lakebase, ADLS+Airflow+COPY, Iceberg) **do not include direct Spark JDBC write**.
A legacy schema `enterprisedata_test.poc_jdbc_cdc` (April 2025, `agupta@oncologyanalytics.com`)
exists but belongs to the enterprise data team — not part of the newUM evaluation.

---

## 2. Problem Context

### Why This Spike Exists

Michal Mucha identified 3 candidates for Databricks → PostgreSQL data exchange (NoPHI-Data, 3/31) [K: `workshops_week_2026_03_16.nophi_data_channel`]:

| # | Candidate | Direction | Status |
|---|-----------|-----------|--------|
| 1 | Lakebase Synced Tables | PULL (managed sync) | Under evaluation |
| 2 | ADLS Gen2 + Airflow + PostgreSQL COPY | PULL (via intermediary) | Under evaluation |
| 3 | Apache Iceberg → PostgreSQL | PULL (pg_lake reads Iceberg) | Option A: BLOCKED (`external_access_enabled=false`). Option B: BLOCKED (ADLS SP credentials denied) |

**Common pattern**: All 3 require the consumer side (PostgreSQL / NewUM infrastructure) to
reach into Databricks-controlled storage or APIs. This creates security friction because
Databricks infrastructure is managed by the Data Team and DevOps has restricted external access.

### What Blocked Options A and B

| Option | Spike | Blocker | Who blocked it |
|--------|-------|---------|----------------|
| A — Iceberg REST Catalog | #186438 | `external_access_enabled = false` on metastore. Security will not enable it. | Alex (DevOps lead), April 8 |
| B — Direct ADLS Storage | #187526 | Azure SP credentials for ADLS reads not provided. Storage account may be on private endpoint. | Alex (DevOps lead), April 8 |
| C — SQL Warehouse JDBC | (not spiked) | Runtime dependency on warehouse. Warehouse stopped costs $0 but startup = 30-60s latency. 50s query timeout. | Evaluated and rejected — unsuitable for batch pipeline |

---

## 3. Option D — Architecture

```
┌─────────────────────────┐                          ┌──────────────────────┐
│  Databricks             │                          │  PostgreSQL (NewUM)  │
│                         │                          │                      │
│  Gold Table             │    Spark JDBC Write      │  staging_*           │
│  (Delta/UniForm)        │ ──────────────────────▸  │  (landing tables)    │
│                         │    jdbc:postgresql://...  │                      │
│  Scheduled Job          │                          │  ┌─────────────┐     │
│  (Airflow on AKS        │                          │  │ MERGE/      │     │
│   or Databricks Job)    │                          │  │ UPSERT      │     │
│                         │                          │  │ ↓           │     │
│  Databricks Secrets     │                          │  │ production  │     │
│  (PG credentials)       │                          │  │ tables      │     │
│                         │                          │  └─────────────┘     │
└─────────────────────────┘                          └──────────────────────┘

Direction: PUSH (Databricks → PostgreSQL)
Auth: Databricks Secrets vault holds PG connection string
Orchestration: Airflow on AKS (existing) or Databricks Workflows
```

### Data Flow

1. **Airflow DAG** (on AKS, already deployed [K: `tech_stack.data`]) triggers Databricks Job on schedule
2. **Databricks Job** reads Gold-layer Delta table (e.g., `newum_migration_test.eligibility.eligibilitydata`)
3. **Spark JDBC writer** connects to PostgreSQL using credentials from Databricks Secrets
4. **Writes to staging table** (`staging_eligibility`) — TRUNCATE + INSERT or append mode
5. **PostgreSQL-side** runs MERGE/UPSERT from `staging_*` → production tables (can be triggered by Airflow or PG-native `pg_cron`)
6. **Airflow marks** DAG run complete, logs metrics

### Why PUSH Avoids All 3 Blockers

| Blocker | Why it doesn't apply to Option D |
|---------|----------------------------------|
| `external_access_enabled = false` | Not needed — Databricks is writing OUT, not exposing an API for external reads IN |
| ADLS SP credentials for PostgreSQL | Not needed — PostgreSQL never touches ADLS. Databricks reads its own storage natively |
| SQL Warehouse runtime dependency | Not needed — uses a Job Cluster (ephemeral), not SQL Warehouse |

---

## 4. Comparison — All Options

| Dimension | Option A (Iceberg REST) | Option B (Direct ADLS) | Option C (SQL Warehouse) | **Option D (Gold Push JDBC)** |
|-----------|------------------------|----------------------|--------------------------|-------------------------------|
| **Direction** | PULL | PULL | PULL | **PUSH** |
| **Spike ticket** | #186438 | #187526 | (not spiked) | This document |
| **Status** | BLOCKED | BLOCKED | Rejected | **PROPOSED** |
| **Requires `external_access_enabled`** | YES ❌ | No | No | **No** ✅ |
| **Requires ADLS SP credentials** | No (SAS vending) | YES ❌ | No | **No** ✅ |
| **Requires SQL Warehouse running** | No | No | YES ❌ | **No** ✅ |
| **Who initiates** | External client | External reader | External JDBC client | **Databricks Job** ✅ |
| **Intermediary storage** | ADLS (Iceberg metadata) | ADLS (Delta files) | None | **None** ✅ |
| **Credential location** | External client config | External client config | External client config | **Databricks Secrets** ✅ |
| **Orchestration** | External scheduler | Airflow | External app | **Airflow on AKS** (existing) |
| **NewUM code changes** | New Iceberg reader | New ADLS reader | JDBC config | **None** — PG tables just appear |
| **Latency** | Near-real-time (async metadata lag) | Batch (file scan) | On-demand (30-60s startup) | **Batch** (scheduled) |
| **Compute cost** | $0 API + existing cluster | $0 storage reads | SQL Warehouse DBUs | Job Cluster DBUs (ephemeral) |
| **Security posture** | Exposes UC externally | Exposes ADLS externally | Exposes warehouse externally | **Nothing exposed** — DB writes out |

---

## 5. Spark JDBC Write — Technical Details

### PySpark Write Pattern

```python
# Databricks notebook / Job
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Read Gold table
gold_df = spark.table("newum_migration_test.eligibility.eligibilitydata")

# Connection properties from Databricks Secrets
pg_url = dbutils.secrets.get(scope="newum-pg", key="jdbc-url")
pg_user = dbutils.secrets.get(scope="newum-pg", key="username")
pg_pass = dbutils.secrets.get(scope="newum-pg", key="password")

jdbc_url = f"jdbc:postgresql://{pg_url}"
connection_props = {
    "user": pg_user,
    "password": pg_pass,
    "driver": "org.postgresql.Driver",
    "batchsize": "10000",
    "isolationLevel": "READ_COMMITTED"
}

# Write to staging table (overwrite = TRUNCATE + INSERT)
gold_df.write \
    .mode("overwrite") \
    .jdbc(jdbc_url, "staging_eligibility", properties=connection_props)
```

### PostgreSQL MERGE (run after staging load)

```sql
-- Atomic MERGE from staging to production
BEGIN;

INSERT INTO eligibility (eligibility_data_id, created_on, insurance_provider_id, ...)
SELECT eligibility_data_id, created_on, insurance_provider_id, ...
FROM staging_eligibility s
ON CONFLICT (eligibility_data_id)
DO UPDATE SET
    created_on = EXCLUDED.created_on,
    insurance_provider_id = EXCLUDED.insurance_provider_id,
    -- ... all columns
    updated_at = NOW();

COMMIT;
```

### Databricks Secrets Setup (one-time)

```bash
# Create secret scope (if not exists)
databricks secrets create-scope newum-pg

# Store PostgreSQL connection credentials
databricks secrets put-secret newum-pg jdbc-url --string-value "pg-host:5432/newum_test"
databricks secrets put-secret newum-pg username --string-value "newum_etl_writer"
databricks secrets put-secret newum-pg password --string-value "<from-vault>"
```

### Airflow DAG (conceptual)

```python
# Existing Airflow on AKS [K: tech_stack.data includes Airflow]
from airflow.providers.databricks.operators.databricks import DatabricksRunNowOperator

gold_push_task = DatabricksRunNowOperator(
    task_id="gold_push_eligibility",
    databricks_conn_id="databricks_default",
    job_id=GOLD_PUSH_JOB_ID,
    notebook_params={"table": "eligibility", "mode": "overwrite"}
)
```

---

## 6. Prerequisites

| # | Prerequisite | Owner | Complexity | Notes |
|---|-------------|-------|------------|-------|
| 1 | PostgreSQL TEST credentials (host, port, db, user, password) | DevOps (Luiyi Valentin) | Low | Ticket submitted April 6 for PG TEST access. Flexible Server already provisioned (#184587, #184589 closed) [K] |
| 2 | Databricks Secrets scope for PG credentials | Data Team (Michal Mucha) | Low | `databricks secrets create-scope newum-pg` — 1 command |
| 3 | Network path: Databricks cluster → PostgreSQL | DevOps | Medium | Must confirm PG Flexible Server allows inbound from Databricks VNet. May need VNet peering or private endpoint |
| 4 | PostgreSQL JDBC driver on Databricks cluster | Data Team | Low | `org.postgresql:postgresql:42.7.x` — add to cluster init script or Job cluster config |
| 5 | Staging table DDL in PostgreSQL | NewUM Backend (Jack Hall) | Low | Mirror of Gold table schema, one staging table per domain |
| 6 | Airflow DAG or Databricks Workflow definition | Data Team | Medium | Schedule, retry policy, alerting |
| 7 | MERGE/UPSERT stored procedure in PostgreSQL | NewUM Backend | Low | Idempotent staging → production merge |

### Prerequisites vs. Other Options

| Prerequisite | Option A | Option B | Option C | **Option D** |
|-------------|----------|----------|----------|-------------|
| UC Admin changes | YES (metastore) | YES (UniForm) | No | **No** |
| ADLS SP credentials | No | YES | No | **No** |
| PG credentials in Databricks | No | No | No | **YES** |
| Network: PG → Databricks | YES | YES | YES | **No** (reversed) |
| Network: Databricks → PG | No | No | No | **YES** |
| SQL Warehouse running | No | No | YES | **No** |
| NewUM code changes | YES | YES | YES | **No** |

---

## 7. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | **Network path not open** — Databricks VNet may not route to PG Flexible Server | HIGH | Request VNet peering or private endpoint from DevOps. Same type of ask as Options A/B but in reverse direction |
| 2 | **PG write load** — Spark JDBC writes 238K rows in parallel, could spike PG CPU/connections | MEDIUM | Use `batchsize=10000`, `numPartitions=4`, write to staging table (not production), run during off-hours |
| 3 | **Credential rotation** — PG password in Databricks Secrets must be rotated | LOW | Databricks Secrets supports rotation. Airflow can validate before each run |
| 4 | **Schema drift** — Gold table columns change, staging DDL out of sync | MEDIUM | Add pre-write schema comparison step in notebook. Alert on mismatch, don't write |
| 5 | **Partial write failure** — Spark task fails mid-write, staging has partial data | MEDIUM | Use `mode("overwrite")` = TRUNCATE + INSERT (atomic). If Spark fails, staging is empty (safe). Production untouched until MERGE runs |
| 6 | **Data Team ownership** — Writing to PostgreSQL may feel like crossing ownership boundary | MEDIUM | Frame as "Data Team delivers data to NewUM's doorstep" — PostgreSQL staging tables are the handoff point. NewUM owns MERGE to production |
| 7 | **Existing `poc_jdbc_cdc` may hold lessons** | LOW | Schema `enterprisedata_test.poc_jdbc_cdc` (April 2025, agupta) is a year-old legacy POC. May contain useful patterns — suggest asking Akshat for retrospective |

---

## 8. Cost Estimate

| Component | Cost | Notes |
|-----------|------|-------|
| Job Cluster compute | ~$0.50-2.00/run | Ephemeral cluster, auto-terminates. Small tables (238K rows) finish in < 5 min on i3.xlarge |
| PostgreSQL Flexible Server | Existing | Already provisioned (#184587) — no incremental cost |
| Airflow on AKS | Existing | Already deployed [K: `tech_stack.data`] — no incremental cost |
| Databricks Secrets | $0 | Built into Databricks — no per-secret billing |
| Network (VNet peering) | ~$0.01/GB | Standard Azure VNet pricing, negligible for batch data volumes |
| **Total incremental** | **~$1-5/day** | Assuming daily batch, single-domain (eligibility) |

### Comparison

| Option | Incremental Infra Cost | New Services Required |
|--------|----------------------|----------------------|
| A (Iceberg REST) | ~$0/run (API is free) | None — but blocked |
| B (Direct ADLS) | ~$0/run (storage reads) | None — but blocked |
| C (SQL Warehouse) | ~$2-10/run (warehouse DBUs) | None — but impractical |
| **D (Gold Push)** | **~$0.50-2.00/run** | **None** ✅ |

---

## 9. Recommendation

**Propose Option D to the team** in the next Data Team standup or NoPHI-Data channel.

### Talking Points

1. "We've been trying to PULL data from Databricks into PostgreSQL — all 3 options hit security blockers because they require our infrastructure to reach INTO Databricks storage."
2. "What if Databricks pushes TO us instead? A scheduled Databricks Job writes Gold data directly to PostgreSQL via Spark JDBC. Databricks already has the JDBC driver, Secrets vault, and Airflow."
3. "No `external_access_enabled`, no ADLS SP credentials, no SQL Warehouse. Just JDBC out."
4. "The staging table pattern means NewUM backend doesn't change — data just appears in PostgreSQL."
5. "There's a year-old `poc_jdbc_cdc` schema in enterprise_data_test by Akshat — proof the pattern has been used before at Onco, just not for newUM."

### Who To Involve

| Person | Role | Why |
|--------|------|-----|
| Michal Mucha | Data Team Lead | Owns the evaluation. Must approve adding a 4th candidate |
| Marc Gale | Architecture | Requested cost/effort/speed comparison. Option D fills a gap |
| Alex / Salin Gabriel | DevOps | Confirm network path Databricks → PG. Only prerequisite that could block |
| Jack Hall | Backend Lead | Staging table DDL + MERGE procedure. Minimal effort |
| Venky Subramaniam | SVP Engineering | Asked for "balance speed, architectural elegance, and future operational support" — Option D is the simplest |

---

## 10. References

1. [Spark JDBC DataSource — Write](https://spark.apache.org/docs/latest/sql-data-sources-jdbc.html) — Official Apache Spark docs
2. [Databricks Secrets CLI](https://docs.databricks.com/en/security/secrets/index.html) — Secrets management
3. [Azure Databricks Jobs](https://docs.databricks.com/en/workflows/jobs/create-run-jobs.html) — Job scheduling
4. [PostgreSQL COPY / MERGE](https://www.postgresql.org/docs/current/sql-merge.html) — PG 15+ MERGE syntax
5. **[K]** Project knowledge base: `../../knowledge.json` v1.25.0 (2026-04-09) — confirmed operational facts
6. **[Spike #186438]** [Iceberg REST Catalog investigation](../186438-iceberg-rest-catalog/output.md) — Option A (BLOCKED)
7. **[Spike #187526]** [Direct ADLS Delta reader](../187526-adls-delta-reader/output.md) — Option B (BLOCKED)
8. **[NoPHI-Data 3/31]** Michal Mucha's 3-candidate message — source of Options 1-3
