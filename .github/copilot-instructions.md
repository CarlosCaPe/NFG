# Global AI Agent Instructions — Carlos Carrillo

These constraints apply to ALL projects, ALL repos, ALL languages. No exceptions.

## Code Change Discipline
- **Minimum viable change** — modify only what's needed. Don't refactor adjacent code unless asked.
- **Never invent data** — if you don't know, say so. Don't guess, hallucinate, or fabricate.
- **Cite sources** — every fact, metric, or claim must reference the file/line/doc it came from.
- **Idempotent by default** — scripts and changes should be safe to re-run without side effects.
- **Dry-run first** — destructive operations default to preview mode. Require explicit opt-in for live execution.
- **Test before declaring done** — build, lint, or run tests to verify changes work before marking complete.

## Security (Non-Negotiable)
- **Never commit secrets** — API keys, tokens, passwords stay in `.env` / environment variables / vault.
- **Never echo back user-provided secrets** — if a user pastes a key, don't repeat it.
- **`.env`, `.dev.vars`, `.env.local`** must be in `.gitignore`. Always verify.
- **Sanitize inputs** — never interpolate raw user data into HTML, SQL, or shell commands.

## Communication
- **Concise** — answer the question, skip the preamble. 1-3 sentences when possible.
- **No filler** — skip "Great question!", "Sure!", "Let me help you with that!", etc.
- **Structured output** — use tables, bullets, or code blocks. Wall-of-text = failure.
- **Language match** — respond in the language the user writes in unless told otherwise.

## Git & Version Control
- **Atomic commits** — one logical change per commit. Message format: `type(scope): description`.
- **Never force-push main** — use `--force-with-lease` on feature branches only if necessary.
- **Pull before push** — always sync with remote before pushing.

## File Organization
- **Config-first** — behavior belongs in YAML/JSON config, not hard-coded.
- **Never create summary/changelog markdown files** unless explicitly requested.
- **Respect project conventions** — follow existing naming, structure, and patterns.

## When Unsure
- Search the codebase first (grep, semantic search, file listing).
- Read relevant files before making assumptions.
- If still ambiguous, ask — don't guess.

## The 4D Paradigm

Every non-trivial action MUST follow these four steps:

1. **Describe** — Before acting, state what you'll do and why. No silent changes. Example: "I'll add an index on HospitalId to fix the seq scan. This is a read-only schema change."
2. **Delegate** — Use subagents for complex research. Don't guess when you can verify. Search the codebase, read docs, check history before generating output.
3. **Diligent** — Evaluate output quality. Run tests, check errors, validate results. After every change: build/lint/test. After every query: check row count, null ratios, schema match.
4. **Disclose** — Always state implications. If a change has side effects, say so before proceeding. Example: "This ALTER will lock the table for ~5 seconds during the rewrite."

### 4D Applied to Database Queries
- **Describe**: "I'll run this query against prod_fsh. It reads pg_stat_user_tables (read-only, no risk)."
- **Delegate**: For complex queries, verify schema first. Check `information_schema.columns` before referencing columns.
- **Diligent**: After query, validate results make sense. Flag if 0 rows returned unexpectedly.
- **Disclose**: "This DELETE will remove 1,247 rows. The table has no partition — VACUUM will be needed after."

## Best Tool First (MANDATORY)
- **Never settle for workarounds** — always identify the best tool/package/CLI for the task, even if it's not installed yet.
- **Ask to install** — if the best tool is not available, ask the user: "The best tool for this is `<tool>`. Want me to install it?" Never silently fall back to an inferior approach.
- **Prefer native tools** — use purpose-built CLIs and libraries over shell hacks. Examples: `playwright` for browser automation (not `curl` + regex), `pdfplumber` for PDF extraction (not `strings`), `ffmpeg` for media (not manual byte manipulation).
- **Check before giving up** — before saying "I can't do X", check: (1) Is there a skill in `~/.claude/skills/`? (2) Is there a pip/npm/apt package? (3) Can we install it in user-space (`~/.local/bin`, `pipx`, `npm -g`)? Only say "can't" after exhausting all three.
- **Installation preference order**: `pipx` > `pip install --user` > `npm install -g` > `apt install` (needs sudo — ask first) > build from source.

## Skill-First Behavior
- **Image requests** — whenever the user says "imagen", "mira la imagen", "foto", "screenshot", or references any image, **always** load and follow the `image-analyzer` skill. Never say "I can't see images."
- **Identity requests** — whenever the user asks "who am I", "my rate", "my CV", "mi perfil", "write a proposal", or needs professional context, **always** load `professional-identity` skill. This is the single source of truth for Carlos's professional profile across all projects.
- **CV sync** — when `cv.ts` or `certs.ts` changes in dataqbs_IA, update `professional-identity/SKILL.md` to match. When a new technology is used significantly in a client project, suggest adding it to the CV.
- **Missing capability** — when you cannot perform a requested action (e.g., vision, audio, browser automation, API integration), **suggest creating a skill** for it. Say: "No tengo esa capacidad aún. ¿Quieres que cree un skill para esto?" Skills live at `~/.claude/skills/<name>/SKILL.md`.
- **Existing skills** — before saying you can't do something, check `~/.claude/skills/` for a relevant skill that might already solve it.

### Auto-Skill Creation Protocol
When a pattern appears 3+ times or agent encounters an unknown domain:
1. Check `~/.claude/skills/` for existing relevant skill
2. If none exists, create `~/.claude/skills/<name>/SKILL.md` with: Purpose, Triggers, Workflow, Best Practices, Error Handling, Lessons Learned
3. Prefer vendor official documentation as source material
4. Include real code examples, not generic descriptions
5. Add a `## Lessons Learned` section — this is where error patterns get captured over time

### Self-Improvement Protocol
When a query or operation fails:
1. Error is logged to history with `error_type` and `error_message`
2. Agent checks if similar error exists in engine skill's Lessons Learned section
3. If new error pattern → append to Lessons Learned: date, error pattern, root cause, fix
4. If recurring → flag for human review
5. The `--review-errors` CLI flag shows all recent failures grouped by type

## QueryMaster — Global Database Agent

CLI for running queries against any database engine. Dry-run by default.

```bash
# From any terminal:
PYTHONPATH=~/.local/bin python3 -m querymaster --engine <engine> --conn <name> "<SQL or KQL>"

# Short alias:
qm -e <engine> -c <conn> "<query>" --execute
```

- **Config**: `~/.config/querymaster/connections.json` (connection registry, no passwords)
- **History**: `~/.local/share/querymaster/history/` (auto-compress >30d, auto-delete >90d)
- **Skills**: `~/.claude/skills/querymaster*/` (master + per-engine best practices)
- **Engines**: postgresql, snowflake, sqlserver, adx (KQL), sqlite, databricks

### When a user asks to query a database
1. Read `~/.claude/skills/querymaster/SKILL.md`
2. Identify the engine → read `~/.claude/skills/querymaster-{engine}/SKILL.md`
3. Generate the query using best practices from the engine skill
4. Execute via CLI: `PYTHONPATH=~/.local/bin python3 -m querymaster -e {engine} -c {conn} "{query}" --execute`

## New Client / Project Onboarding

When creating a new client project (repo), follow this pattern:

### 1. Repository Setup
```bash
mkdir ~/Documents/github/<CLIENT_NAME>
cd ~/Documents/github/<CLIENT_NAME>
git init
```

### 2. Required Files (create these)
| File | Purpose |
|------|---------|
| `.claude/CLAUDE.md` | **Single source of truth** — project context for both Claude Code AND Copilot |
| `.github/copilot-instructions.md` | **Auto-synced copy** of `.claude/CLAUDE.md` (never edit directly) |
| `README.md` | Project overview, setup, run commands |
| `.gitignore` | Must include `.env`, `.env.*`, `.dev.vars` |
| `.env` | Secrets (DB passwords, API keys) — NEVER committed |

### 3. Project CLAUDE.md Template (single file, used by both AI systems)
```markdown
# <CLIENT> — Project Context

> Universal constraints are in `~/.claude/CLAUDE.md`. This file covers repo-specific context only.
> **Single source of truth.** `.github/copilot-instructions.md` is auto-synced from this file.
> Run `sync-ai-docs <CLIENT>` to propagate changes.

## Project Overview
<Brief description>

## Stack
- **Database**: <engine>
- **Runtime**: <language/framework>

## QueryMaster — Database Query Agent

Global CLI for running queries against any database engine. Dry-run by default.

### Available connections for this project
| Connection | Engine | Auth | Description |
|------------|--------|------|-------------|
| `<conn_name>` | <engine> | <auth_type> | <description> |

### Config
- Connections: `~/.config/querymaster/connections.json`
- History: `~/.local/share/querymaster/history/`
```

### 4. Sync to Copilot
```bash
sync-ai-docs <CLIENT>    # Copy .claude/CLAUDE.md → .github/copilot-instructions.md
sync-ai-docs             # Sync ALL projects at once
```
Script location: `~/.local/bin/sync-ai-docs`

### 5. Register Connections
Add entries to `~/.config/querymaster/connections.json` for the new project's databases.

### 6. Conventions (inherited from this file)
- All rules in this global CLAUDE.md apply automatically
- Config-first, dry-run by default, never commit secrets
- Atomic commits with `type(scope): description` format
- Each project is self-contained — dependencies, config, and docs live in the repo
- **One file rule**: edit `.claude/CLAUDE.md` only, then run `sync-ai-docs` to propagate

## Multi-Laptop Sync (AI Brain)

`~/.claude/` is a git repo (`dotclaude`). Contains global CLAUDE.md + all skills.
Shared across 4 laptops: matrix (root workspace) + client laptops.

### Architecture
```
~/.claude/                    ← git repo (dotclaude) — shared brain
├── CLAUDE.md                 ← global rules (this file)
├── skills/                   ← all skills (querymaster, image-analyzer, etc.)
└── .git/

~/Documents/github/<CLIENT>/  ← per-client git repo
├── .claude/CLAUDE.md         ← project-specific (single source of truth)
└── .github/copilot-instructions.md  ← auto-synced copy
```

### Daily Workflow
```bash
# MATRIX LAPTOP: created/updated a skill → push brain
ai-push "added skill: playwright"

# CLIENT LAPTOP: pull latest brain + sync to project
ai-pull                  # pull ~/.claude/ + sync all projects
ai-pull FSH              # pull + sync only FSH
ai-pull --status         # check if updates available
```

### Available Scripts
| Script | Location | Purpose |
|--------|----------|---------|
| `sync-ai-docs` | `~/.local/bin/` | Copy `.claude/CLAUDE.md` → `.github/copilot-instructions.md` per project |
| `ai-push` | `~/.local/bin/` | Commit + push `~/.claude/` changes, then sync all projects |
| `ai-pull` | `~/.local/bin/` | Pull `~/.claude/` from remote, then sync all projects |

### Active Projects (registered in sync-ai-docs)
dataqbs_IA, HXW, FSH, memo, aiditi, NFG

### First-Time Setup on a New Laptop
```bash
git clone git@github.com:<user>/dotclaude.git ~/.claude
cp ~/.local/bin/sync-ai-docs ~/.local/bin/   # or clone from dotfiles
cp ~/.local/bin/ai-pull ~/.local/bin/
cp ~/.local/bin/ai-push ~/.local/bin/
chmod +x ~/.local/bin/{sync-ai-docs,ai-pull,ai-push}
ai-pull   # sync everything
```
