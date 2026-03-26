---
name: render-diagram
description: >-
  Create dark-themed SVG/PNG architecture diagrams using the config-driven renderer.
  Triggers on: diagram, architecture diagram, onboarding diagram, render diagram,
  SVG diagram, status diagram, flow diagram, system diagram, integration map.
  Use when the user asks for any visual architecture, integration, pipeline, or
  onboarding status diagram. Produces professional dark-themed cards with logos,
  swimlanes, arrows, overlap validation, and optional PNG export.
---

# Render Diagram Skill

## What This Skill Does

Generates dark-themed architecture diagrams as SVG (+ optional PNG) using `shared/render-diagram.js`.
The renderer is config-driven — you write a JSON config describing lanes, nodes, and arrows,
then the engine handles layout, logo embedding, overlap validation, and export.

## When to Use

- User asks for a **diagram**, **architecture map**, **integration status**, **onboarding visual**
- User wants to show connected vs blocked services
- User needs a **pipeline flow**, **data flow**, or **system overview**
- Any request involving visual cards with logos representing tech services

## Workflow

### Step 1: Gather Data

Read the data source for the diagram content:
- `clients/<client>/client.yaml` → services, status, auth methods
- `clients/<client>/knowledge.json` → confirmed facts, unknowns
- `.github/copilot-instructions.md` → Connected Services table

### Step 2: Write the Config JSON

Create a JSON file following this schema:

```jsonc
[{
  "name": "diagram-name",       // → produces diagram-name.svg + .png
  "title": "Diagram Title",
  "subtitle": "Optional subtitle",
  "width": 1600,                 // canvas width px
  "height": 1100,                // canvas height px
  "nodeHeight": 100,             // card height (keep at 100)
  "gap": 32,                     // compact gap between nodes
  "padding": 20,                 // inner swimlane padding
  "org": "NFG",                  // footer org name

  "lanes": [{                    // vertical swimlanes, left to right
    "x": 20,                     // absolute X position
    "width": 400,                // lane width
    "label": "LANE TITLE",       // header text (uppercase)
    "number": "①",               // circled number prefix
    "bgColor": "#1A1520",        // optional background override
    "headerColor": "#C62828",    // optional header bar color override

    "columns": [{                // sub-columns within a lane
      "distribution": "even",    // "even" | "compact-top" | "compact-bottom"
      "arrows": true,            // draw vertical arrows between nodes
      "arrowType": "data",       // "data" (solid blue) | "auth" (dashed gray)
      "arrowLabels": ["ingest", "clean"],  // per-arrow labels
      "frame": {                 // optional dashed border group
        "label": "Group Name",
        "color": "#CC2927"
      },
      "nodes": [{                // cards top-to-bottom
        "name": "Service Name",
        "subtitle": "Description text (auto-wraps)",
        "logo": "mssql",         // key from LOGO_MAP (see below)
        "palette": "mssql",      // key from PALETTES (see below)
        "tag": "SERVICE",        // bottom-right category label
        "badge": {               // optional top-right badge
          "label": "COMPLETE",
          "bg": "#2E7D32",
          "color": "#A5D6A7"
        }
      }]
    }]
  }],

  "arrows": [{                   // cross-lane custom arrows
    "type": "data",              // "data" | "auth" | "curved"
    "x1": 310, "y1": 168,
    "x2": 530, "y2": 168,
    "label": "flow label"
  }]
}]
```

### Step 3: Size Planning

**Width formula**: Sum all lane widths + gaps between them + 40px margins.
```
totalWidth = lane1.width + gap + lane2.width + gap + ... + 40
```

**Height formula**: Based on tallest lane.
```
tallestNodes = max nodes in any column
totalHeight = 100 * tallestNodes + 32 * (tallestNodes - 1) + 170
// 170 = title (64) + legend (106)
```

### Step 4: Render

```powershell
$env:PATH = "$env:LOCALAPPDATA\Programs\node\node-v22.15.0-win-x64;$env:PATH"
node shared/render-diagram.js --config <path/to/config.json> --out <output-dir> --png
```

- `--config` — path to the JSON config (required)
- `--out` — output directory (default: current dir)
- `--png` — also render PNG via Playwright at 2x DPR

### Step 5: Embed in Markdown

Reference with relative path (same directory as the .md):
```markdown
![Diagram Title](diagram-name.png)
```

## Available Palettes (22)

| Key | Stroke Color | Best For |
|-----|-------------|----------|
| `mssql` | #CC2927 red | SQL Server, databases |
| `ingestion` | #0078D4 blue | Azure services, ADF, pipelines |
| `bronze` | #CD7F32 bronze | Bronze/raw data layer |
| `silver` | #A8B5C0 silver | Silver/clean data layer |
| `gold` | #DAA520 gold | Gold/curated data layer |
| `delta` | #00ADD8 teal | Delta Lake tables |
| `uniform` | #00ACC1 cyan | UniForm, protocol bridges |
| `api` | #4E8EE9 blue | REST APIs, endpoints |
| `auth` | #5C6BC0 indigo | Auth, security, SSO |
| `spark` | #E25A1C orange | Apache Spark |
| `pyiceberg` | #BA68C8 purple | PyIceberg, Python tools |
| `snowflake` | #29B5E8 light blue | Snowflake |
| `trino` | #DD00A1 pink | Trino, Flink |
| `duckdb` | #FFC107 yellow | DuckDB |
| `dotnet` | #512BD4 purple | .NET services |
| `react` | #61DAFB cyan | React frontend |
| `kubernetes` | #326CE5 blue | Kubernetes |
| `terraform` | #7B42BC purple | Terraform |
| `kafka` | #231F20 dark | Kafka |
| `redis` | #DC382D red | Redis |
| `postgres` | #336791 blue | PostgreSQL |
| `generic` | #546E7A gray | Default / unknown |

## Available Logos (14)

| Key | File | Badge BG |
|-----|------|----------|
| `mssql` | database.svg | #CC2927 |
| `azure` | azure.svg | #0078D4 |
| `databricks` | databricks.svg | #FF3621 |
| `delta` | delta.svg | #00ADD4 |
| `iceberg` | iceberg.png | #1e3a5f |
| `spark` | apachespark.svg | #E25A1C |
| `python` | python.svg | #3776AB |
| `snowflake` | snowflake.svg | #29B5E8 |
| `trino` | trino.svg | #DD00A1 |
| `duckdb` | duckdb.svg | #FFF000 |
| `entra` | person.svg | #0078D4 |
| `pat` | key.svg | #1a3a6e |
| `sas` | shield.svg | #0050a0 |
| `apacheflink` | apacheflink.svg | #E6526F |

### Adding a New Logo

1. Download SVG from https://simpleicons.org/ (MIT license) or draw a 40×40 viewBox icon
2. Save to `shared/logos/<name>.svg`
3. Add entry to `LOGO_MAP` in `shared/render-diagram.js`
4. Add matching palette to `PALETTES` if needed
5. PNG fallback: save as `.png` and set `type: 'png'` in LOGO_MAP

## Badge Conventions

Use badges to show status on cards:

| Status | bg | color | Example |
|--------|-----|-------|---------|
| Complete | `#2E7D32` | `#A5D6A7` | `{ "label": "COMPLETE", "bg": "#2E7D32", "color": "#A5D6A7" }` |
| Blocked | `#B71C1C` | `#EF9A9A` | `{ "label": "BLOCKED", "bg": "#B71C1C", "color": "#EF9A9A" }` |
| In Progress | `#E65100` | `#FFE0B2` | `{ "label": "IN PROGRESS", "bg": "#E65100", "color": "#FFE0B2" }` |
| Not Started | `#37474F` | `#90A4AE` | `{ "label": "NOT STARTED", "bg": "#37474F", "color": "#90A4AE" }` |

## Design Rules

- **Content-aware sizing**: Allocate lane widths proportionally to content (longest subtitle × 7.5px + 70px)
- **Overlap = build failure**: The engine validates all bounding boxes. Fix positions if it fails.
- **Card height**: Always 100px. Don't change.
- **Compact gap**: 32px between nodes in compact mode
- **Auth nodes top, consumers bottom**: Keep auth lanes packed at top, consumer lanes at bottom
- **Arrow labels**: Rendered as pill badges, not floating text
- **Section frames**: Dashed borders around groups with label on top edge
- **Footer**: Auto-generated with org name + date

## Example Reference

See `shared/example-diagram.json` for a working 2-lane, 6-node example.
See `shared/render-diagram-2d.js` for the original hardcoded OncoHealth Iceberg diagrams (reference only).

## Common Mistakes

1. **Forgetting `--png`**: SVG always renders. PNG needs the flag + Playwright installed.
2. **Lanes overlapping**: Make sure `lane[n].x + lane[n].width + gap <= lane[n+1].x`
3. **Too many nodes**: If height exceeds ~1400px, split into multiple diagrams.
4. **Missing logo**: If a logo key doesn't match LOGO_MAP, a colored placeholder renders instead.
5. **Wrong palette key**: Typos fall back to `generic` gray. Check the palette table.
6. **Center node text-over-logo (radial)**: In radial layouts, the center node stacks logo → name → subtitle → tag vertically. The renderer uses a sequential `contentY` tracker to avoid overlap. If you override `center.logoSize` to a large value without increasing `center.height`, the text may clip outside the circle. **Rule**: `center.height ≥ logoSize + 100` to leave room for name + subtitle + tag.
7. **Logo SVGs with explicit fill**: Custom SVG logos must NOT include `fill` attributes on path elements. The renderer applies fill via `wrapInBadge()`. If the SVG has its own fill matching the badge background, the icon becomes invisible (solid color block). Always use monochrome SVGs without fill, and set the fill color in the LOGO_MAP entry.
