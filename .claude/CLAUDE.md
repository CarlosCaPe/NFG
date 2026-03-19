# NFG (NewFire Global) — Project Context

> Universal constraints are in `~/.claude/CLAUDE.md`. This file covers repo-specific context only.
> **Single source of truth.** `.github/copilot-instructions.md` is auto-synced from this file.
> Run `sync-ai-docs NFG` to propagate changes.

## Project Overview
NewFire Global client project. Operates as a dataqbs contract (under dataqbs umbrella).
- **Chain**: dataqbs → NewFire Global (NFG) → OncoHealth (Oncology Analytics Inc)
- **Project**: newUM (New Utilization Management) — healthcare/oncology domain
- **Purpose**: Replace end-of-life MATIS monolith with modern configurable UM case management engine
- **Role**: AI-Leveraged Documenter — project docs & specs, automated via Python/Node
- **Identity file**: `knowledge.json` — confirmed facts, unknowns, and access status

## Conventions
- Follow patterns established in sibling repos (dataqbs_IA, FSH, memo, HXW)
- Config-first: behavior in YAML, wired in code
- Idempotent scripts, dry-run by default

## Key Environments
- **Azure DevOps**: https://dev.azure.com/oncologyanalytics/newUM (code repo, boards, pipelines)
- **Databricks (dev)**: https://adb-2393860672770324.4.azuredatabricks.net/
- **Atlassian**: https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM
- **Databases**: oadb, DrugsMS, EligibilityMS, ProviderMS — all **MS-SQL**
- **Comms**: Teams (OncoHealth_NewFire), Slack (NFG), SharePoint, Miro
- **VPC**: CPC-ccarr-RY8W8 via https://windows365.microsoft.com (Windows App VDI)

## Connected Services & Automation
| Service | Auth Method | Status | Script |
|---------|-------------|--------|--------|
| Google Docs | Public link | COMPLETE | `scrape-gdoc-export.js` |
| Miro | REST API (NFG-Reader app) | COMPLETE (NewUM), BLOCKED (Rachel) | `miro-api.js` |
| Azure DevOps | Okta SSO + MFA | PARTIAL (wiki denied) | `scrape-okta-auto.js` |
| SharePoint | Okta SSO (reused) | PARTIAL (Excel/Word canvas) | `scrape-okta-auto.js` |
| Atlassian | Separate SSO | BLOCKED | needs Atlassian password |
| Databricks | Entra ID | BLOCKED | needs admin provisioning |
| Teams | Okta SSO + MFA | COMPLETE (97K chars) | `scrape-teams-calendar.js` |
| Calendar | Okta SSO + MFA | COMPLETE (11 events) | `scrape-teams-calendar.js` |
| Graph API | Device code flow | BLOCKED (admin consent required) | `graph-api.js` |

## Key Team Members (from Teams/Calendar)
- **Michal Mucha** — Data team lead (daily standups, eligibility/payer workshops, Databricks)
- **Vika Nobis** — Sprint Demo & Planning organizer
- **Arben Osmani** — Provider Discussion lead
- **Erik Hjortshoj** — SVP Engineering / Consulting CPTO (RAID risk owner)
- **Rachel Collier** — Onboarding coordinator / Miro board owner

## Tech Stack (from onboarding doc)
- **Backend**: .NET 10, MS-SQL, Azure Service Bus, Okta, Azure Cloud Functions, Kubernetes, NUnit
- **Frontend**: React, MUI/MUI X, Vite, TanStack Query, Vitest + RTL, Playwright (E2E)
- **DevOps**: Azure DevOps, Terraform, Kubernetes, SonarQube, DataDog
- **Data**: Databricks, MS-SQL (OADB), Azure Blob Storage
- **AI Coding**: Claude Code provisioned, Cursor on request — strongly encouraged

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
