# Investigation: Exposing Unity Catalog Tables via Iceberg REST Catalog API

> **ADO Ticket**: TBD (link after creation)
> **Author**: Carlos Carrillo (`ccarrillo@oncologyanalytics.com`)
> **Date**: 2026-03-23
> **Status**: DRAFT — requires TEST workspace access to validate

---

## 1. Executive Summary

**Go/No-Go: Conditionally GO** — The Iceberg REST Catalog API is viable for exposing UC tables
to external services. Azure Databricks natively supports the endpoint at
`/api/2.1/unity-catalog/iceberg-rest`. The primary requirements are:
enabling Delta UniForm on target tables, configuring a service principal with
appropriate UC privileges, and validating network connectivity.

**Key Blocker**: We currently only have TEST workspace access (ticket #0035611).
DEV workspace (`adb-2393860672770324`) is network-blocked. Investigation findings
below are based on official Microsoft documentation (last updated 2026-03-19)
and must be validated against our actual workspace configuration.

---

## 2. Acceptance Criteria Results

### 2.1 Iceberg REST Catalog Endpoint Accessibility

| Criteria | Status | Notes |
|----------|--------|-------|
| Endpoint exists | YES | `/api/2.1/unity-catalog/iceberg-rest` |
| Public Preview | YES | DBR 16.4 LTS+ (GA path) |
| Legacy read-only endpoint | EXISTS | `/api/2.1/unity-catalog/iceberg` (deprecated) |

**Endpoint URL format**:
```
https://<workspace-url>/api/2.1/unity-catalog/iceberg-rest
```

> **CRITICAL**: The workspace URL MUST include the workspace ID.
> Without it, API requests return a `303` redirect to a login page.
> Format: `https://adb-XXXXXXXXX.X.azuredatabricks.net`
>
> Source: [Access Azure Databricks tables from Apache Iceberg clients](https://learn.microsoft.com/en-us/azure/databricks/external-access/iceberg)

**Validation command** (run when workspace access is available):
```bash
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
- Deletion vectors **cannot** be enabled (use `REORG` to purge first)

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

### 2.4 Network Connectivity Validation

**Current status**: BLOCKED — DEV workspace network-restricted for our account.

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
| **PAT** | Dev/test, quick validation | Generate in Databricks UI → Settings → Developer → PATs | Configurable (max 365d) |
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
| DuckDB | YES | NO | CHECK | Via Iceberg extension |

> **Write clarification**: The new Iceberg REST Catalog API (DBR 16.4+ Public Preview)
> supports writes for **managed Iceberg tables**. Delta tables with UniForm enabled
> remain **read-only** via Iceberg clients — writes must go through Databricks.

---

## 4. Limitations & Constraints

1. **Delta UniForm tables are read-only** via Iceberg clients (writes must use Databricks)
2. **Deletion vectors incompatible** with IcebergCompatV2 — must purge via `REORG` before enabling
3. **No VOID types** in UniForm-enabled tables
4. **No materialized views or streaming tables** via UniForm
5. **Table must be accessed by name** (not path) to trigger auto metadata generation
6. **IcebergCompatV2 is irreversible** — protocol upgrade cannot be undone
7. **Column mapping cannot be dropped** once enabled
8. **Metadata generation uses write cluster resources** — may increase driver memory usage
9. **Snowflake + Entra OAuth requires public networking** — no Private Link support

---

## 5. Action Items (Blocked on Workspace Access)

| # | Action | Owner | Status |
|---|--------|-------|--------|
| 1 | Obtain TEST workspace URL from DevOps (reply to ticket #0035611) | Carlos | PENDING |
| 2 | List UC catalogs/schemas/tables in workspace | Carlos | BLOCKED |
| 3 | Identify target tables for UniForm enablement | Data Team lead (Michal) | NOT STARTED |
| 4 | Test `DESCRIBE EXTENDED` on a target table to check current properties | Carlos | BLOCKED |
| 5 | Enable UniForm on a non-prod test table | Carlos + Michal | NOT STARTED |
| 6 | Validate Iceberg REST endpoint with curl + PAT | Carlos | BLOCKED |
| 7 | Test PyIceberg read from external network | Carlos | BLOCKED |
| 8 | Create service principal for production use | DevOps | NOT STARTED |
| 9 | Grant `EXTERNAL USE SCHEMA` on target schemas | UC Admin | NOT STARTED |
| 10 | Enable external data access on metastore | UC Admin | NOT STARTED |

---

## 6. References

All findings sourced from official Microsoft/Databricks documentation:

1. [Read Delta tables with Iceberg clients (UniForm)](https://learn.microsoft.com/en-us/azure/databricks/delta/uniform) — Last updated: 2026-03-06
2. [Access Azure Databricks tables from Apache Iceberg clients](https://learn.microsoft.com/en-us/azure/databricks/external-access/iceberg) — Last updated: 2026-03-19
3. [Enable external data access on the metastore](https://learn.microsoft.com/en-us/azure/databricks/external-access/admin#external-data-access)
4. [Databricks service principals](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/)
5. [PyIceberg REST catalog configuration](https://py.iceberg.apache.org/configuration/#rest-catalog)
6. [Iceberg REST API spec (Apache)](https://github.com/apache/iceberg/blob/master/open-api/rest-catalog-open-api.yaml)
