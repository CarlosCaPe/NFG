# Closure Note — Investigate Iceberg REST Catalog API Feasibility

**ADO Ticket**: TBD
**Area**: newUM\Data Team
**Sprint**: TBD
**Priority**: P2

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    Azure Databricks Workspace                    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Unity Catalog                          │   │
│  │                                                          │   │
│  │  ┌─────────────┐    ┌─────────────────────────────────┐ │   │
│  │  │ Delta Table  │───>│ UniForm (IcebergCompatV2)        │ │   │
│  │  │ (source of   │    │ - Async metadata generation      │ │   │
│  │  │  truth)      │    │ - Parquet data files shared       │ │   │
│  │  └─────────────┘    │ - Iceberg metadata layer added    │ │   │
│  │                      └──────────────┬──────────────────┘ │   │
│  └─────────────────────────────────────┼────────────────────┘   │
│                                        │                         │
│  ┌─────────────────────────────────────▼────────────────────┐   │
│  │  Iceberg REST Catalog API                                │   │
│  │  /api/2.1/unity-catalog/iceberg-rest                     │   │
│  │  Auth: OAuth M2M (service principal) or PAT              │   │
│  │  Credential Vending: SAS tokens for ADLS access          │   │
│  └─────────────────────────────────────┬────────────────────┘   │
└────────────────────────────────────────┼────────────────────────┘
                                         │ HTTPS
                    ┌────────────────────┼────────────────────┐
                    │                    │                     │
              ┌─────▼─────┐     ┌───────▼───────┐    ┌───────▼───────┐
              │ PyIceberg  │     │ Spark+Iceberg │    │  Snowflake    │
              │ (Python)   │     │ (JVM)         │    │ (Catalog-     │
              │            │     │               │    │  linked DB)   │
              └────────────┘     └───────────────┘    └───────────────┘
                         External Services (read-only for Delta)
```

**Data flow**: Writes go through Databricks (Delta) → UniForm generates Iceberg metadata async →
External clients read via REST Catalog API → Credential vending provides temporary ADLS SAS tokens.

## Cost Estimation

| Component | Cost Impact |
|-----------|-------------|
| Iceberg metadata generation | Runs on same compute as Delta writes — marginal increase in driver resource usage |
| Storage | Iceberg metadata files stored alongside Delta metadata — negligible (~KB per version) |
| API calls | REST Catalog API calls — included in Databricks pricing, no extra charge |
| Service principal | No additional licensing cost |
| Network | If Private Link required — Azure Private Link charges apply |
| **Total incremental cost** | **Near-zero** — no new compute or storage required |

## Repo Link

- Investigation: `clients/oncohealth/tickets/XXXXXX-iceberg-rest-catalog/output.md`
- Repo: `https://github.com/CarlosCaPe/NFG` (private)

## Pros

- **Zero data duplication** — Iceberg reads use same Parquet files as Delta; only metadata is generated
- **Native Azure Databricks support** — endpoint is built-in, no external infrastructure needed
- **Broad client compatibility** — PyIceberg, Spark, Snowflake, Trino, Flink, DuckDB all supported
- **Credential vending** — temporary SAS tokens issued automatically, no need to share storage keys
- **Low operational overhead** — metadata generation is automatic and async
- **Standards-based** — uses official Apache Iceberg REST Catalog specification
- **Public Preview (DBR 16.4+)** — on GA track, production-viable with preview caveats

## Cons

- **Read-only for Delta+UniForm tables** — external clients cannot write; writes must go through Databricks
- **Metadata lag** — Iceberg metadata generated asynchronously; may lag behind latest Delta version
- **Irreversible protocol upgrade** — enabling IcebergCompatV2 and column mapping cannot be undone
- **Deletion vectors incompatible** — tables with deletion vectors need `REORG` before enabling
- **Public Preview status** — not yet GA; breaking changes possible (low risk given timeline)
- **Snowflake+Entra requires public networking** — cannot use Private Link for Entra OAuth

## Risks & Open Questions

| # | Risk/Question | Severity | Mitigation |
|---|---------------|----------|------------|
| 1 | **No workspace access** — cannot validate endpoint or tables | HIGH | Obtain TEST workspace URL from DevOps (ticket #0035611) |
| 2 | **Metadata staleness** — Iceberg metadata may lag Delta writes | MEDIUM | Monitor `converted_delta_version`; use `MSCK REPAIR TABLE` if needed |
| 3 | **Target tables unknown** — which tables need UniForm? | MEDIUM | Coordinate with Michal (Data Team Lead) for table selection |
| 4 | **Network restrictions** — external service may not reach workspace | MEDIUM | Validate firewall/VNet/Private Link configuration |
| 5 | **External data access not enabled** — metastore may need admin config | MEDIUM | Requires UC Admin to enable metastore setting |
| 6 | **Protocol upgrade irreversible** — IcebergCompatV2 cannot be removed | LOW | Test on non-prod table first; protocol is forward-compatible |
| 7 | **Deletion vectors on existing tables** — need REORG (table rewrite) | LOW | Schedule during maintenance window; REORG is idempotent |
| 8 | **Write via Iceberg not supported for Delta UniForm** — confirmed | INFO | Out of scope per ticket; writes stay in Databricks |

### Recommended Next Steps

1. **Obtain TEST workspace URL** — reply to DevOps ticket #0035611
2. **List UC catalogs/tables** — identify candidates for UniForm enablement
3. **POC on test table** — enable UniForm, validate PyIceberg read from external network
4. **Create service principal** — with `USE CATALOG`, `USE SCHEMA`, `SELECT`, `EXTERNAL USE SCHEMA`
5. **Enable external data access** on metastore (admin action)
6. **Document network path** — confirm external service can reach workspace endpoint
