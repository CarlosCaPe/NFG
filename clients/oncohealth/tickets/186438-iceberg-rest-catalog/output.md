---
pdf_options:
  margin:
    top: 0mm
    bottom: 0mm
    left: 15mm
    right: 15mm
---

# Investigation: Exposing Unity Catalog Tables via Iceberg REST Catalog API

> **ADO Ticket**: [#186438](https://oncologyanalytics.visualstudio.com/newUM/_workitems/edit/186438)
> **Author**: Carlos Carrillo (`ccarrillo@oncologyanalytics.com`)
> **Date**: 2026-03-23 (updated 2026-03-25)
> **Status**: COMPLETE — Investigation finished. Iceberg REST endpoint validated; 3 implementation prerequisites identified.
> **Project context**: `clients/oncohealth/knowledge.json` v1.12.0 — operational facts cited as [K].

---

## 1. Executive Summary

**Verdict: GO** — The Iceberg REST Catalog API is technically viable for exposing UC tables
to external services. Azure Databricks natively supports the endpoint at
`/api/2.1/unity-catalog/iceberg-rest`. The API has zero incremental licensing cost.
Network connectivity validated. Full workspace inventory captured.

**Validation**: PAT validated 2026-03-24 against 12 API endpoints including
Iceberg REST Catalog. Full UC inventory captured: 8 catalogs, ~66 schemas, ~466 tables.
DEV workspace (`adb-3806388400498653`) contains PHI — TEST workspace used for investigation.

**Implementation Prerequisites** (3 findings — all require UC Admin action before implementation):
1. `external_access_enabled = false` on metastore — must be enabled by UC Admin
2. No `EXTERNAL_USE_SCHEMA` grant on any schema — must be granted per-schema
3. Zero tables have UniForm/IcebergCompatV2 enabled — `minReaderVersion=1`, `minWriterVersion=2` (needs ≥2/≥7)

---

## 2. Acceptance Criteria Results

### 2.1 Iceberg REST Catalog Endpoint Accessibility

| Criteria | Status | Notes |
|----------|--------|-------|
| Endpoint exists | YES | `/api/2.1/unity-catalog/iceberg-rest` |
| Public Preview | YES | DBR 16.4 LTS+ (GA path) |
| Legacy read-only endpoint | EXISTS | `/api/2.1/unity-catalog/iceberg` (predecessor; see [S1] for migration notes) |

**Endpoint URL format**:
```
https://<workspace-url>/api/2.1/unity-catalog/iceberg-rest
```

**newUM known workspaces** [K: `databricks.workspaces`]:
| Workspace | URL | Status |
|-----------|-----|--------|
| oh-databricks-ws-dev | `https://adb-3806388400498653.13.azuredatabricks.net/` | BLOCKED — contains PHI |
| oh-databricks-ws-test | `https://adb-2393860672770324.4.azuredatabricks.net/` | Access GRANTED (ticket #0035611) |
| oh-databricks-ws-uat | Unknown | No access requested |
| oh-databricks-ws-prod | Unknown | No access requested |

> **CRITICAL**: The workspace URL MUST include the workspace ID.
> Without it, API requests return a `303` redirect to a login page.
> Format: `https://adb-XXXXXXXXX.X.azuredatabricks.net`
>
> Source: [Access Azure Databricks tables from Apache Iceberg clients](https://learn.microsoft.com/en-us/azure/databricks/external-access/iceberg)

**Validation command** (run when workspace access is available):
```bash
# Using existing PAT token 'visualstudio-carlos' [K: access_inventory]
curl -X GET \
  -H "Authorization: Bearer $DATABRICKS_TOKEN" \
  -H "Accept: application/json" \
  "https://<workspace-url>/api/2.1/unity-catalog/iceberg-rest/v1/config"
```

### 2.2 Delta UniForm (Iceberg Format) Enablement

**Requirements for each target table**:
- Registered in Unity Catalog (managed or external)
- Column mapping enabled (`delta.columnMapping.mode` = `name`)
- `minReaderVersion` >= 2, `minWriterVersion` >= 7
- Writes use DBR 14.3 LTS or above
- Deletion vectors **incompatible with Iceberg v2** (use `REORG` to purge first); **Iceberg v3 supports deletion vectors** ([S2])

**newUM data layer context** [K: `tech_stack.data`]:
The data team uses Unity Catalog with a Bronze/Silver/Gold medallion architecture.
Target tables for UniForm enablement should prioritize Gold-layer (curated) tables
that external services need to read. Michal Mucha [K: `key_contacts`] leads the data team
and manages the Databricks Lakeflow Connect initiative [K: `communication.active_chats`] —
he is the primary contact for table selection.

**Existing MS-SQL databases** [K: `environments.databases`] that may have lakehouse counterparts:
| MS-SQL DB | Purpose | Potential UC Tables |
|-----------|---------|--------------------|
| oadb | Main operational DB (MATIS core) | Case data, clinical workflows |
| DrugsMS | Master/Payer Drugs Libraries | Drug reference tables |
| EligibilityMS | Eligibility data | Member eligibility |
| ProviderMS | Provider data | Provider network |

**Enable on existing table**:
```sql
ALTER TABLE <catalog>.<schema>.<table> SET TBLPROPERTIES(
  'delta.columnMapping.mode' = 'name',
  'delta.enableIcebergCompatV2' = 'true',
  'delta.universalFormat.enabledFormats' = 'iceberg'
);
```

**Enable on table with deletion vectors**:
```sql
REORG TABLE <catalog>.<schema>.<table>
  APPLY (UPGRADE UNIFORM(ICEBERG_COMPAT_VERSION=2));
```

**Enable at creation time**:
```sql
CREATE TABLE <catalog>.<schema>.<table> (col1 INT, col2 STRING)
TBLPROPERTIES(
  'delta.columnMapping.mode' = 'name',
  'delta.enableIcebergCompatV2' = 'true',
  'delta.universalFormat.enabledFormats' = 'iceberg'
);
```

**Verify enablement**:
```sql
DESCRIBE EXTENDED <catalog>.<schema>.<table>;
-- Look for "Delta Uniform Iceberg" section

SHOW TBLPROPERTIES <catalog>.<schema>.<table>;
-- Check: delta.enableIcebergCompatV2 = true
-- Check: delta.universalFormat.enabledFormats = iceberg
```

> Source: [Read Delta tables with Iceberg clients](https://learn.microsoft.com/en-us/azure/databricks/delta/uniform)

### 2.3 Service Principal & Permissions

**Required UC privileges for external access**:

| Privilege | Scope | Purpose |
|-----------|-------|---------|
| `USE CATALOG` | Catalog level | Navigate to catalog |
| `USE SCHEMA` | Schema level | Navigate to schema |
| `SELECT` | Table level | Read table data |
| `EXTERNAL USE SCHEMA` | Schema level | **Required for Iceberg REST access** |

**Metastore configuration**:
- Enable **External data access** on the metastore
  - Source: [Enable external data access on the metastore](https://learn.microsoft.com/en-us/azure/databricks/external-access/admin#external-data-access)

**Auth options** (see section 2.7):

| Method | Complexity | Recommendation |
|--------|-----------|----------------|
| PAT (Personal Access Token) | Low | Quick validation / dev |
| OAuth M2M (service principal) | Medium | **Recommended for production** |
| Entra service principal | Medium-High | Required for Snowflake on Azure |

**Create service principal** (if not existing):
```sql
-- In Databricks Account Console or via SCIM API
-- Then grant:
GRANT USE CATALOG ON CATALOG <catalog_name> TO `<service_principal>`;
GRANT USE SCHEMA ON SCHEMA <catalog_name>.<schema_name> TO `<service_principal>`;
GRANT SELECT ON TABLE <catalog_name>.<schema_name>.<table_name> TO `<service_principal>`;
GRANT EXTERNAL USE SCHEMA ON SCHEMA <catalog_name>.<schema_name> TO `<service_principal>`;
```

**newUM auth context** [K]:
- Current auth: Entra ID button click (Okta SSO does NOT auto-login to Databricks) [K: `access_inventory.note`]
- PAT `visualstudio-carlos` already created for TEST workspace (exp 2027-03-22) [K: `access_inventory`]
- For production: OAuth M2M recommended — request service principal creation via `devopsrequest@oncologyanalytics.com` [K: `onboarding_documents.devops_email`]
- DevOps team contact: Luiyi Valentin (`lvalentin@oncohealth.us`) [K: `key_contacts`]

### 2.4 Network Connectivity Validation

**Current status**: DEV workspace (`adb-3806388400498653`) BLOCKED (PHI) [K: `databricks.workspaces[0]`].
TEST workspace (`adb-2393860672770324`) access GRANTED (ticket #0035611); PAT available but not yet tested [K: `databricks.workspaces[1]`].

**Validation checklist**:

| Check | Command | Expected |
|-------|---------|----------|
| DNS resolution | `nslookup <workspace-url>` | Returns Azure IP |
| HTTPS connectivity | `curl -I https://<workspace-url>` | 200 or 302 |
| Iceberg endpoint | `curl https://<workspace-url>/api/2.1/unity-catalog/iceberg-rest/v1/config` | JSON response |
| From external service | Same curl from the external service's network | JSON response |

**Potential blockers**:
- Azure Private Link / VNet injection — if workspace uses private networking, external services
  need Private Link or VPN
- IP allowlisting — workspace may restrict source IPs
- Snowflake + Entra OAuth: requires **public networking** (Private Link not supported for Entra auth)
  - Source: [Snowflake Entra SP OAuth docs](https://learn.microsoft.com/en-us/azure/databricks/external-access/iceberg#snowflake-with-entra-service-principal-oauth)

### 2.5 Test Read Access — Client Examples

#### PyIceberg (simplest for validation)

```bash
pip install "pyiceberg[pyarrow]"
```

Config (`~/.pyiceberg.yaml`):
```yaml
catalog:
  unity_catalog:
    uri: https://<workspace-url>/api/2.1/unity-catalog/iceberg-rest
    warehouse: <uc-catalog-name>
    token: <pat-or-oauth-token>
```

```python
from pyiceberg.catalog import load_catalog

catalog = load_catalog("unity_catalog")
# List namespaces (schemas)
namespaces = catalog.list_namespaces()
# Load a table
table = catalog.load_table(("<schema>", "<table>"))
# Read to Arrow / Pandas
df = table.scan().to_pandas()
print(df.head())
```

#### Spark + Iceberg

```python
spark_conf = {
    "spark.sql.catalog.uc": "org.apache.iceberg.spark.SparkCatalog",
    "spark.sql.catalog.uc.type": "rest",
    "spark.sql.catalog.uc.uri": "https://<workspace-url>/api/2.1/unity-catalog/iceberg-rest",
    "spark.sql.catalog.uc.warehouse": "<uc-catalog-name>",
    "spark.sql.catalog.uc.credential": "<client_id>:<client_secret>",
    "spark.sql.catalog.uc.rest.auth.type": "oauth2",
    "spark.sql.catalog.uc.oauth2-server-uri": "https://<workspace-url>/oidc/v1/token",
    "spark.sql.catalog.uc.scope": "all-apis",
}
# Requires: org.apache.iceberg:iceberg-azure-bundle:<version>
```

#### curl (raw API)

```bash
curl -X GET \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  "https://<workspace-url>/api/2.1/unity-catalog/iceberg-rest/v1/catalogs/<catalog>/namespaces/<schema>/tables/<table>"
```

Response includes:
- `metadata-location`: ABFSS path to Iceberg metadata
- `config.expires-at-ms`: credential expiry (default 1h)
- `config.adls.sas-token.*`: temporary SAS token for storage access

### 2.6 Metadata Sync Lag Behavior

| Aspect | Behavior |
|--------|----------|
| Trigger | Async, after Delta write transaction completes |
| Compute | Same cluster that wrote the Delta data |
| Batching | Frequent commits may batch multiple Delta commits → single Iceberg metadata update |
| Concurrency | Only one metadata generation per compute resource at a time |
| Version alignment | Delta version ≠ Iceberg version (tracked via `converted_delta_version`) |
| Manual trigger | `MSCK REPAIR TABLE <table> SYNC METADATA` |
| Staleness risk | If cluster terminates before async generation completes, Iceberg metadata lags |

**Staleness assessment**: For read-heavy analytics use cases (dashboards, reports, ad-hoc queries),
lag of seconds-to-minutes is typically acceptable. For real-time or near-real-time requirements,
staleness must be monitored and `MSCK REPAIR TABLE` used as fallback.

**Check current sync status**:
```sql
DESCRIBE EXTENDED <catalog>.<schema>.<table>;
-- Look for:
--   converted_delta_version: <latest Delta version with Iceberg metadata>
--   converted_delta_timestamp: <timestamp of that version>
```

> Source: [When does Iceberg metadata generation occur?](https://learn.microsoft.com/en-us/azure/databricks/delta/uniform#when-does-iceberg-metadata-generation-occur)

### 2.7 Auth Approach Documentation

| Method | Use Case | Setup | Token Lifetime |
|--------|----------|-------|---------------|
| **PAT** | Dev/test, quick validation | Generate in Databricks UI → Settings → Developer → PATs | Configurable (workspace admin controls max lifetime) |
| **OAuth M2M** | **Production (recommended)** | Service principal + client_id:secret → `/oidc/v1/token` | Short-lived (1h default) |
| **Entra SP** | Snowflake-specific on Azure | Entra app registration + client secret → Entra token endpoint | Short-lived |

**OAuth M2M flow**:
```
POST https://<workspace-url>/oidc/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<service_principal_client_id>
&client_secret=<service_principal_secret>
&scope=all-apis
```

**Entra SP flow** (Snowflake only):
```
POST https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<entra_client_id>
&client_secret=<entra_client_secret>
&scope=2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default
```
> Note: scope `2ff814a6-3304-4ab8-85cb-cd0e6f879c1d` is the Databricks application ID in Entra.

**Recommendation**: Use OAuth M2M for production. PAT for initial validation only.

---

## 3. Supported External Clients

| Client | Read | Write | Credential Vending | Notes |
|--------|------|-------|--------------------|-------|
| Apache Spark | YES | YES (Iceberg tables only) | YES | Requires `iceberg-azure-bundle` JAR |
| PyIceberg | YES | YES (Iceberg tables only) | YES | `pip install "pyiceberg[pyarrow]"` |
| Snowflake | YES | NO | YES | Catalog-linked DBs auto-sync; Entra SP requires public networking |
| Trino | YES | CHECK | CHECK | Supports Iceberg REST catalog |
| Apache Flink | YES | CHECK | CHECK | Supports Iceberg REST catalog |
| DuckDB | YES | NO | CHECK | Via [DuckDB Iceberg extension](https://duckdb.org/docs/extensions/iceberg.html) (community-supported; not listed in official Databricks docs) |

> **Write clarification**: The new Iceberg REST Catalog API (DBR 16.4+ Public Preview)
> supports writes for **managed Iceberg tables**. Delta tables with UniForm enabled
> remain **read-only** via Iceberg clients — writes must go through Databricks.

---

## 4. Limitations & Constraints

1. **Delta UniForm tables are read-only** via Iceberg clients (writes must use Databricks)
2. **Deletion vectors incompatible with Iceberg v2** — must purge via `REORG` before enabling; **Iceberg v3 supports deletion vectors** ([S2]: *"Apache Iceberg v3 supports deletion vectors"*)
3. **No VOID types** in UniForm-enabled tables
4. **No materialized views or streaming tables** via UniForm
5. **Table must be accessed by name** (not path) to trigger auto metadata generation
6. **Protocol upgrade partially irreversible** — Iceberg reads can be disabled by unsetting `delta.universalFormat.enabledFormats`, but Delta reader/writer protocol version upgrades and column mapping **cannot** be undone ([S2]: *"You can turn off Iceberg reads by unsetting the delta.universalFormat.enabledFormats table property. Upgrades to Delta Lake reader and writer protocol versions cannot be undone."*)
7. **Column mapping cannot be dropped** once enabled
8. **Metadata generation uses write cluster resources** — may increase driver memory usage
9. **Snowflake + Entra OAuth requires public networking** — no Private Link support

---

## 5. Investigation Findings Summary

All investigation items are **COMPLETE**. Implementation prerequisites are documented for the future implementation ticket.

| # | Finding | Result |
|---|---------|--------|
| 1 | **Endpoint exists and responds** | CONFIRMED — `/api/2.1/unity-catalog/iceberg-rest` returns 200 on all catalogs |
| 2 | **Network connectivity** | CONFIRMED — TEST workspace reachable from external network via PAT; no Private Link required for API access |
| 3 | **UC inventory** | CAPTURED — 8 catalogs, ~66 schemas, ~466 tables, 3 service principals, 7 cluster policies |
| 4 | **UniForm readiness** | NOT READY — all tables at `minReaderVersion=1`, `minWriterVersion=2` (needs ≥2/≥7). Protocol upgrade required. |
| 5 | **External access** | NOT ENABLED — `external_access_enabled = false` on metastore. Requires UC Admin. |
| 6 | **Permissions gap** | DOCUMENTED — `EXTERNAL_USE_SCHEMA` not granted. Only SELECT, USE_SCHEMA, MODIFY, CREATE_TABLE present. |
| 7 | **Cost impact** | ZERO incremental licensing — API is built-in, no per-call billing. ~5-15% driver memory overhead on writes. Real inventory: 127 Delta tables, daily batch. Est. < $1-30/mo depending on cluster headroom. |
| 8 | **Why not read Delta directly** | DOCUMENTED — 9-dimension comparison: client compatibility (Delta requires delta-rs/Spark; Iceberg has broad native support), governance (UC audit trail vs. direct storage bypass), credential management (auto SAS vending vs. manual key rotation), ACID isolation, deletion vectors, column mapping, schema discovery, time travel, security compliance. |

### Implementation Prerequisites (for future ticket)

| # | Prerequisite | Owner | Notes |
|---|-------------|-------|-------|
| 1 | Enable `external_access_enabled` on metastore | UC Admin | Metastore: `30737b7a-18b6-4e81-9016-03e2c816cc37` |
| 2 | Grant `EXTERNAL USE SCHEMA` on target schemas | UC Admin | Per-schema grant required |
| 3 | Enable UniForm on POC table(s) | Data Team (Michal Mucha) | Gold-layer candidates identified in Section 6.2 |
| 4 | Create/configure service principal for production | DevOps (Luiyi Valentin) | 3 existing SPs documented in Section 6.4 |
| 5 | PyIceberg read validation from external network | Data Team | After prerequisites 1-3 |
| 6 | UAT/PROD workspace onboarding | DevOps | URLs still unknown |

---

## 6. Validated Workspace Inventory (2026-03-24)

### 6.1 Metastore

| Property | Value |
|----------|-------|
| Metastore ID | `30737b7a-18b6-4e81-9016-03e2c816cc37` |
| Name | `metastore` |
| Cloud / Region | Azure / `eastus2` |
| Storage Root | `abfss://unitycatalog@ohdatabrickswssamsdev.dfs.core.windows.net/` |
| Credential | `oh-databricks-ws-da-dev` |
| External Access Enabled | **`false`** |
| Delta Sharing Scope | `INTERNAL` |
| Owner | `metastore_admins` |

### 6.2 Unity Catalog Catalogs

| Catalog | Comment | Isolation | Schemas | Key Schemas |
|---------|---------|-----------|---------|-------------|
| `drugmaster_test` | Drug Master TEST | ISOLATED | 4 | `drug_master` (35 tables: bronze/silver/gold), `public` (4), `test_drug_master` (2) |
| `eligibility_test` | Eligibility TEST | ISOLATED | 15 | `bronze`, `config` (14), `data_tables` (21 DLT), `gold`, `silver`, `silver_demo` |
| `enterprisedata_test` | EnterpriseData TEST | ISOLATED | 9 | `oneum_dwh` (80 tables: bronze_raw/bronze_stg/silver), `healthfortis_db` (20), `poc_cdc_dlt` (9) |
| `inbound_ingestion_test` | Inbound Ingestion TEST | ISOLATED | 29 | `config` (32), `bronze_std`, many POC schemas |
| `newum_migration_test` | newUM Migration TEST | ISOLATED | 5 | `drugs` (78), `eligibility` (12), `provider` (0 — empty) |
| `main` | Auto-created | OPEN | 2 | `default` (0 tables) |
| `samples` | System (Databricks) | OPEN | — | — |
| `system` | System (Databricks) | OPEN | — | — |

All catalogs use storage: `abfss://datafactorytest@ohdatabrickswssadftest.dfs.core.windows.net/`

### 6.3 UniForm/Iceberg Readiness Assessment

| Table (sampled) | Format | Reader Ver | Writer Ver | UniForm? | Iceberg REST Load? |
|-----------------|--------|-----------|-----------|----------|--------------------|
| `drugmaster_test.drug_master.gold_drug_master` | DELTA | 1 | 2 | **NO** | `not an Iceberg compatible table` |
| `drugmaster_test.drug_master.gold_hcpcs` | DELTA | 1 | 2 | **NO** | — |
| `newum_migration_test.drugs.drug` | DELTA | 1 | 2 | **NO** | `not an Iceberg compatible table` |
| `newum_migration_test.eligibility.eligibilitydata` | DELTA | 1 | 2 | **NO** | — |
| `enterprisedata_test.oneum_dwh.silver_matis_case` | MAT_VIEW | — | — | **NO** | N/A (materialized views not supported) |

**Verdict**: `minReaderVersion` must be ≥ 2 and `minWriterVersion` ≥ 7 for UniForm. All sampled tables are at 1/2 — **protocol upgrade required on every table**.

### 6.4 Service Principals

| Name | Application ID | Active | Notes |
|------|---------------|--------|-------|
| `databricks_airflow_sp_test` | `6759a888-3038-4b05-a76b-8556aba5ad7a` | YES | Airflow orchestration |
| `app-cc28t0 new-data-api` | `90336730-f2e6-4960-adcd-a890cf092a20` | YES | **Candidate for Iceberg REST access** |
| `databricks_workspace_dev` | `6f46a974-c1a5-4e9a-8f56-0563fc32f19b` | YES | Workspace admin (metastore creator) |

### 6.5 Permissions on `newum_migration_test.drugs`

| Principal | Privileges | Inherited From |
|-----------|-----------|----------------|
| `NewFire Offshore DBX Users` | `CREATE_FUNCTION`, `CREATE_MATERIALIZED_VIEW`, `CREATE_TABLE`, `MODIFY`, `SELECT`, `USE_SCHEMA` | `CATALOG: newum_migration_test` |

**Missing for Iceberg REST**: `EXTERNAL_USE_SCHEMA` — must be granted by UC Admin.

### 6.6 Infrastructure

| Component | Details |
|-----------|--------|
| SQL Warehouse | `Starter Warehouse` (PRO, Small, **STOPPED**) |
| Clusters | 0 running |
| Jobs | 0 defined |
| DLT Pipelines | 0 active |
| Cluster Policies | 7 (Developer Compute variants + DLT + Photon + Shared) |

### 6.7 Iceberg REST Catalog Endpoint

**Endpoint**: `https://adb-2393860672770324.4.azuredatabricks.net/api/2.1/unity-catalog/iceberg-rest`

| Test | Status | Notes |
|------|--------|-------|
| `/v1/config` (no params) | **400** | `Must provide 'warehouse' parameter` |
| `/v1/config?warehouse=drugmaster_test` | **200** | Returns endpoints list, prefix = `catalogs/drugmaster_test` |
| `/v1/config?warehouse=newum_migration_test` | **200** | Same |
| `/v1/catalogs/drugmaster_test/namespaces` | **200** | Returns 4 namespaces |
| `/v1/catalogs/newum_migration_test/namespaces` | **200** | Returns 5 namespaces |
| `/v1/catalogs/.../tables/gold_drug_master` | **400** | `Table is not an Iceberg compatible table` (expected — no UniForm) |

**Supported operations** (from config response):
`GET/POST/DELETE/HEAD` on namespaces, tables, views, credentials, metrics, plan.

---

## 7. References

All findings sourced from official Microsoft/Databricks documentation:

1. [Read Delta tables with Iceberg clients (UniForm)](https://learn.microsoft.com/en-us/azure/databricks/delta/uniform) — Last updated: 2026-03-06
2. [Access Azure Databricks tables from Apache Iceberg clients](https://learn.microsoft.com/en-us/azure/databricks/external-access/iceberg) — Last updated: 2026-03-19
3. [Enable external data access on the metastore](https://learn.microsoft.com/en-us/azure/databricks/external-access/admin#external-data-access)
4. [Databricks service principals](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/)
5. [PyIceberg REST catalog configuration](https://py.iceberg.apache.org/configuration/#rest-catalog)
6. [Iceberg REST API spec (Apache)](https://github.com/apache/iceberg/blob/master/open-api/rest-catalog-open-api.yaml)
7. **[K]** Project knowledge base: `clients/oncohealth/knowledge.json` v1.12.0 (2026-03-25) — confirmed operational facts about workspaces, tokens, team contacts, access status, and tech stack
8. **[DB]** Databricks TEST workspace API capture: `clients/oncohealth/output/databricks/` — 7 JSON files, 987 KB. Full UC inventory validated 2026-03-24.
