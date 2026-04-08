# ADO #187526 — Direct ADLS Storage Access with UniForm (Option B)

**ADO Ticket**: [#187526](https://dev.azure.com/oncologyanalytics/newUM/_workitems/edit/187526)
**Area**: newUM\Data Team
**Sprint**: TBD
**Priority**: P2
**Predecessor**: [#186438](../186438-iceberg-rest-catalog/) — Iceberg REST Catalog investigation (COMPLETE, verdict GO — but security blocked Option A)
**Decision**: Alex (DevOps lead) approved Option B on April 8 — Direct ADLS storage access with UniForm.
**Project context**: `../../knowledge.json` v1.24.0

---

## Background

Ticket #186438 investigated exposing Unity Catalog tables via the Iceberg REST Catalog API (Option A).
The investigation concluded **GO** — the API works, costs $0, and was validated against the TEST workspace.

However, on April 8, Alex (DevOps lead) ruled **Option A out**: security will not enable
`external_access_enabled` on the metastore. This is a hard blocker — the REST Catalog API
cannot function without it.

**Option B was approved**: Read Delta/Iceberg data directly from ADLS Gen2 storage,
bypassing the REST Catalog endpoint entirely. This uses the workspace's existing
Service Principal for storage authentication.

## Architecture — Option B

```
┌─────────────────┐     ┌───────────────────────┐     ┌──────────────┐
│ Databricks      │     │ ADLS Gen2             │     │ PostgreSQL   │
│ (Delta writes)  │────▸│ ohdatabrickswssadftest │────▸│ (TEST)       │
│                 │     │ container:            │     │              │
│ UniForm enabled │     │   datafactorytest     │     │ eligibility  │
│ → Iceberg meta  │     │                       │     │ tables       │
└─────────────────┘     └───────────────────────┘     └──────────────┘
                              ▲
                              │ Azure SP auth
                              │ (client_id + secret)
                        ┌─────┴─────┐
                        │ POC       │
                        │ Reader    │
                        │ (Node.js) │
                        └───────────┘
```

**Data flow**: Databricks writes Delta + UniForm metadata → ADLS stores Parquet + `_delta_log/` →
POC reader authenticates via Azure SP → reads `_delta_log` JSON → identifies active Parquet files →
downloads + parses Parquet → writes to PostgreSQL.

## Target Table

| Field | Value |
|-------|-------|
| Full name | `newum_migration_test.eligibility.eligibilitydata` |
| Type | MANAGED / DELTA |
| Storage | `abfss://datafactorytest@ohdatabrickswssadftest.dfs.core.windows.net/__unitystorage/catalogs/126209e2-.../tables/fe70007a-...` |
| Columns | 109 |
| Rows | 238,887 |
| UniForm | **NOT ENABLED** — DevOps ticket submitted April 6 |
| Delta protocol | minReaderVersion=1, minWriterVersion=2 (defaults) |

### Key Columns (first 15 of 109)

| Column | Type |
|--------|------|
| EligibilityDataID | bigint |
| CreatedOn | timestamp |
| InsuranceProviderID | int |
| PlatformCode | string |
| GroupID | string |
| MemberID | string |
| SubscriberSSN | string |
| LastName | string |
| FirstName | string |
| DOB | date |
| MajorLineOfBusiness | string |
| CoverageEffectiveDate | date |
| CoverageEndDate | date |
| Address1 | string |
| City | string |

## POC Script

**File**: `shared/read-delta-adls.js`

Two modes:
1. **ADLS mode** (primary) — reads Delta table directly from ADLS storage using Azure SP credentials
2. **SQL mode** (fallback) — queries via Databricks SQL Statement API using existing PAT

### Usage

```bash
# Dry-run — show plan and prerequisites
node shared/read-delta-adls.js --client oncohealth --dry-run

# ADLS direct read (needs Azure SP credentials)
node shared/read-delta-adls.js --client oncohealth --limit 10

# SQL Statement API fallback (uses Databricks PAT, starts warehouse)
node shared/read-delta-adls.js --client oncohealth --mode sql --limit 10

# Verbose output
node shared/read-delta-adls.js --client oncohealth --mode sql --verbose
```

### Dependencies
- `@azure/storage-blob` — ADLS Gen2 client
- `@azure/identity` — Azure AD SP authentication
- `parquet-wasm` — Parquet file reader (WebAssembly)

## Prerequisites & Blockers

| # | Prerequisite | Status | Owner |
|---|-------------|--------|-------|
| 1 | UniForm enabled on `eligibilitydata` table | ⏳ DevOps ticket submitted April 6 | DevOps / Alex |
| 2 | Azure SP credentials for ADLS reads | ⏳ Waiting on Alex (Q1-Q4) | DevOps / Alex |
| 3 | PostgreSQL TEST credentials | ⏳ DevOps ticket submitted April 6 | DevOps |
| 4 | Storage account network access verified | ⏳ Q4 pending | DevOps / Alex |

### Open Questions for Alex (DevOps)

| # | Question | Context |
|---|----------|---------|
| Q1 | Which auth method for external ADLS reads? | SP client_secret, managed identity, SAS token? |
| Q2 | Which SP client_id to use? | Known SPs: `databricks_airflow_sp_test`, `app-cc28t0 new-data-api`, `databricks_workspace_dev` |
| Q3 | External location registration needed? | Does external location in UC need to be registered for managed table storage? |
| Q4 | Is storage account on private endpoint? | Determines if POC can run from local machine or only from VPC |

### Known Service Principals

| Name | Client ID | Usage |
|------|-----------|-------|
| databricks_airflow_sp_test | 6759a888-3038-4b05-a76b-8556aba5ad7a | Airflow integration |
| app-cc28t0 new-data-api | 90336730-f2e6-4960-adcd-a890cf092a20 | Data API access |
| databricks_workspace_dev | 6f46a974-c1a5-4e9a-8f56-0563fc32f19b | Dev workspace |

## POC Validation

### SQL Statement API — SUCCEEDED (April 8, 2026)

Query executed successfully via Databricks SQL Statement API using existing PAT:

```
=== Databricks → ADLS → PostgreSQL POC ===
Table: newum_migration_test.eligibility.eligibilitydata
Mode: sql | Warehouse: Starter Warehouse (RUNNING) | Limit: 5

HTTP: 200 | State: SUCCEEDED
Columns: 109 | Rows: 5

Sample row 1:
  EligibilityDataID: 1
  CreatedOn: 2023-02-10T15:12:07.763Z
  CreatedBy: adf-interop
  InsuranceProviderID: 12
  GroupID: 051470
  MemberID: OAD9AF66B660

Saved to: clients/oncohealth/output/databricks/poc-eligibility-sample.json
```

**Result**: Full schema (109 columns) and data (238K rows available) readable via SQL Statement API.
No Azure SP credentials needed for this path — only the existing Databricks PAT.

### ADLS Direct Read — BLOCKED

Azure SP authentication failed:
- `UsernamePasswordCredential` (ROPC) blocked by MFA policy
- `DeviceCodeCredential` timed out (device code flow unreliable from terminal)
- No Azure CLI installed on local machine
- Waiting on Alex (Q1-Q4) for proper SP credentials

### Approach Decision

| Approach | Auth | Status | Pros | Cons |
|----------|------|--------|------|------|
| **SQL Statement API** | Databricks PAT | **WORKING** | No extra auth, uses existing token, full SQL power | Warehouse must be running (costs DBUs), 50s timeout per query |
| **Direct ADLS read** | Azure SP | BLOCKED | No warehouse needed, direct file access | Needs SP credentials, complex Delta log parsing |

**Recommendation**: Use SQL Statement API for the POC. It's working now, requires no additional credentials, and provides full SQL query capability including JOINs, aggregations, and schema inspection.

## Next Steps

1. **Receive Azure SP credentials from Alex** → configure in `.env`
2. **UniForm enablement** → verify with `DESCRIBE EXTENDED` or API
3. **Run POC live** → `node shared/read-delta-adls.js --client oncohealth --limit 10`
4. **PostgreSQL write** → add `--write-pg` once PG credentials available
5. **Document results** → update this file with live POC output
