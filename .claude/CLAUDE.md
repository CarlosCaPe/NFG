# NFG (NewFire Global) — Project Context

> Universal constraints are in `~/.claude/CLAUDE.md`. This file covers repo-specific context only.
> **Single source of truth.** `.github/copilot-instructions.md` is auto-synced from this file.
> Run `sync-ai-docs NFG` to propagate changes.

## Project Overview
NewFire Global **multi-client** umbrella. Each sub-client is a separate engagement under NFG staffing.
- **Chain**: dataqbs → NewFire Global (NFG) → [sub-client]
- **Role**: AI-Leveraged Documenter — project docs & specs, automated via Python/Node
- **Structure**: Monorepo with per-client folders under `clients/`
- **NFG email**: `carlos.carrillo@newfireglobal.com` (Google Workspace — shared across all clients)

## Repo Structure
```
NFG/
├── .claude/CLAUDE.md           ← this file (NFG-level)
├── shared/                     ← reusable scrapers & tools
│   ├── scrape-okta-auto.js
│   ├── scrape-sharepoint-download.js
│   ├── scrape-teams-calendar.js
│   ├── miro-api.js
│   ├── graph-api.js
│   └── analyze-image.js
├── clients/
│   ├── _template/              ← copy for new sub-clients
│   │   ├── client.yaml
│   │   └── knowledge.json
│   ├── oncohealth/             ← sub-client #1 (active)
│   │   ├── client.yaml         ← URLs, auth, team, services
│   │   ├── knowledge.json      ← confirmed facts & unknowns
│   │   ├── .env                ← credentials (gitignored)
│   │   └── output/             ← all captured content
│   └── <next-client>/          ← sub-client #2 (upcoming)
├── package.json
└── .gitignore
```

### Adding a New Sub-Client
```bash
cp -r clients/_template clients/<client-name>
# Edit client.yaml with URLs, emails, services
# Create .env with credentials
# Run shared scripts: node shared/scrape-teams-calendar.js --client <client-name>
```

## Conventions
- Follow patterns established in sibling repos (dataqbs_IA, FSH, memo, HXW)
- Config-first: behavior in YAML, wired in code
- Idempotent scripts, dry-run by default
- Per-client `.env` files — never committed
- Per-client `knowledge.json` — committed (no secrets)
- **NEVER disclose the repo URL** — this is a private repository. Never include the GitHub URL in ADO comments, emails, Teams messages, client-facing documents, or any external communication. Treat the repo URL as a secret.

## Active Sub-Clients

### OncoHealth (Oncology Analytics Inc)
- **Project**: newUM (New Utilization Management) — healthcare/oncology
- **Purpose**: Replace end-of-life MATIS monolith with modern configurable UM case management engine
- **Config**: `clients/oncohealth/client.yaml`
- **Knowledge**: `clients/oncohealth/knowledge.json` (v1.4.0)
- **Auth**: `ccarrillo@oncologyanalytics.com` / `ccarrillo@oncohealth.us` → Okta SSO
- **VPC**: CPC-ccarr-RY8W8 via https://windows365.microsoft.com

#### Key Environments
- **Azure DevOps**: https://dev.azure.com/oncologyanalytics/newUM
- **Databricks (dev)**: https://adb-2393860672770324.4.azuredatabricks.net/
- **Atlassian**: https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM
- **Databases**: oadb, DrugsMS, EligibilityMS, ProviderMS — all **MS-SQL**
- **Comms**: Teams (OncoHealth_NewFire), Slack (NFG), SharePoint, Miro

#### Connected Services
| Service | Auth Method | Status | Script |
|---------|-------------|--------|--------|
| Google Docs | Public link | COMPLETE (47.5K chars) | `shared/scrape-gdoc-export.js` |
| Miro (NewFire) | REST API (NFG-Reader app) | COMPLETE (131K) — stale assessment board | `shared/miro-api.js` |
| Miro (Onco) | Onco email invite | BLOCKED — Rachel requesting access (2026-03-20) | `shared/miro-api.js` |
| Azure DevOps | Okta SSO + MFA | PARTIAL (wiki denied) | `shared/scrape-okta-auto.js` |
| SharePoint | Okta SSO + download | COMPLETE (68K chars: RAID + CR + Access Inventory) | `shared/scrape-sharepoint-download.js` |
| Atlassian | Separate SSO | BLOCKED | needs Atlassian credentials |
| Databricks | Entra ID | BLOCKED | needs admin provisioning |
| Teams | Okta SSO + MFA | COMPLETE (98K chars) | `shared/scrape-teams-calendar.js` |
| Calendar (Outlook) | Okta SSO + MFA | COMPLETE (3.8K chars) | `shared/scrape-teams-calendar.js` |
| Calendar (Google) | NFG Google | NOT STARTED | — |
| Graph API | Device code flow | BLOCKED (admin consent) | `shared/graph-api.js` |

#### Key Team (from RAID + Teams + Calendar)
- **Erik Hjortshoj** — SVP Engineering / Consulting CPTO
- **Rachel Collier** — PM / Onboarding Coordinator
- **Jack Hall** — Architecture Lead
- **Michal Mucha** — Data Team Lead
- **Vika Nobis** — Sprint Demo & Planning organizer
- **Sandy Gress** — Product / Client Strategy
- **Arben Osmani** — Provider Discussion Lead

#### Tech Stack
- **Backend**: .NET 10, MS-SQL, Azure Service Bus, Okta, Kubernetes, NUnit
- **Frontend**: React, MUI/MUI X, Vite, TanStack Query, Vitest + RTL, Playwright (E2E)
- **DevOps**: Azure DevOps, Databricks Asset Bundles (DAB), Kubernetes, SonarQube, DataDog
- **Data**: Databricks, Unity Catalog (Bronze/Silver/Gold), Delta Live Tables, Great Expectations, Airflow, MS-SQL (OADB), Azure Blob Storage
- **AI Coding**: Claude Code provisioned, Cursor on request

## QueryMaster — Database Query Agent

Global CLI for running queries against any database engine. Dry-run by default.

```bash
PYTHONPATH=~/.local/bin python3 -m querymaster --engine <engine> --conn <name> "<SQL>"
```

### Available connections for this project
No direct database connections configured yet.
See `~/.config/querymaster/connections.json` for all available connections.

### Config
- Connections: `~/.config/querymaster/connections.json`
- History: `~/.local/share/querymaster/history/`
