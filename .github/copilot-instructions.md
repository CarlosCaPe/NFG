# NFG (NewFire Global) — Project Context

> Universal constraints are in `~/.claude/CLAUDE.md`. This file covers repo-specific context only.
> **Single source of truth.** `.github/copilot-instructions.md` is auto-synced from this file.
> Run `sync-ai-docs NFG` to propagate changes.

## Project Overview
NewFire Global client project. Operates as a dataqbs contract (under dataqbs umbrella).
- **Chain**: dataqbs → NewFire Global (NFG) → OncoHealth (Oncology Analytics Inc)
- **Project**: newUM (New Utilization Management) — healthcare/oncology domain
- **Role**: AI-Leveraged Documenter — project docs & specs, automated via Python/Node
- **Identity file**: `knowledge.json` — confirmed facts, unknowns, and access status

## Conventions
- Follow patterns established in sibling repos (dataqbs_IA, FSH, memo, HXW)
- Config-first: behavior in YAML, wired in code
- Idempotent scripts, dry-run by default

## Key Environments
- **Azure DevOps**: https://dev.azure.com/oncologyanalytics/newUM
- **Databricks (dev)**: https://adb-2393860672770324.4.azuredatabricks.net/
- **Atlassian**: https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM
- **Databases**: oadb, DrugsMS, EligibilityMS, ProviderMS (engine TBD)
- **Comms**: Teams (OncoHealth_NewFire), Slack (NFG), SharePoint, Miro

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
