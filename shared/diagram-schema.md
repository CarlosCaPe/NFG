# Diagram Config Schema

Config-driven architecture diagram renderer. Dark-themed SVG with embedded logos,
swimlanes, auto-layout, overlap validation, and optional PNG export.

## Usage

```bash
node shared/render-diagram.js --config <diagram.json> [--png] [--out <dir>]
```

- `--config` — Path to JSON file (single diagram object or array of diagrams)
- `--png` — Also render PNG via Playwright (2x DPR)
- `--out` — Output directory (default: current directory)

## Config Structure

```jsonc
{
  "name": "diagram-architecture",    // filename prefix (produces .svg + .png)
  "title": "System Architecture",    // main heading
  "subtitle": "Team · Date · Desc",  // optional subheading
  "width": 1600,                     // canvas width (px)
  "height": 1100,                    // canvas height (px)
  "nodeHeight": 100,                 // card height (default: 100)
  "gap": 32,                         // compact gap between nodes
  "padding": 20,                     // inner swimlane padding
  "org": "NFG",                      // org name in footer

  "lanes": [                         // swimlanes (left to right)
    {
      "x": 20,                       // lane X position
      "width": 290,                  // lane width
      "label": "DATA SOURCES",       // header text
      "number": "①",                 // header prefix
      "bgColor": "#1A1520",          // optional override
      "headerColor": "#C62828",      // optional override
      "columns": [                   // sub-columns within lane
        {
          "x": 20,                   // absolute X (optional, defaults to lane.x)
          "width": 250,              // column width (optional, defaults to lane.width)
          "distribution": "even",    // "even" | "compact-top" | "compact-bottom"
          "arrows": true,            // draw vertical arrows between nodes (default: true)
          "arrowType": "data",       // "data" (solid blue) | "auth" (dashed gray)
          "arrowLabels": ["ingest", "clean", "curate"],  // label on each arrow
          "frame": {                 // optional dashed border around nodes
            "label": "MS-SQL Server",
            "color": "#CC2927"
          },
          "nodes": [                 // cards in this column (top to bottom)
            {
              "name": "oadb",                        // card title
              "subtitle": "Core operational DB",     // description (auto-wraps)
              "logo": "mssql",                       // key from LOGO_MAP
              "palette": "mssql",                    // key from PALETTES
              "tag": "SERVICE",                      // bottom-right tag
              "badge": {                             // optional top-right badge
                "label": "PROD",
                "bg": "#2E7D32",
                "color": "#A5D6A7"
              }
            }
          ]
        }
      ]
    }
  ],

  "arrows": [                        // custom cross-lane arrows
    {
      "type": "data",                // "data" | "auth" | "curved"
      "x1": 310, "y1": 168,
      "x2": 530, "y2": 168,
      "label": "batch / CDC",
      "color": "#42A5F5",           // only for curved
      "opacity": 0.6               // only for curved
    }
  ]
}
```

## Available Palettes

| Key | Fill | Stroke | Use For |
|-----|------|--------|---------|
| `mssql` | `#1E1E1E` | `#CC2927` | SQL Server databases |
| `ingestion` | `#1A2332` | `#0078D4` | Azure services, ADF |
| `bronze` | `#2A1F14` | `#CD7F32` | Bronze layer |
| `silver` | `#1E2428` | `#A8B5C0` | Silver layer |
| `gold` | `#2A2410` | `#DAA520` | Gold layer |
| `delta` | `#0E2232` | `#00ADD8` | Delta tables |
| `uniform` | `#0A2A2E` | `#00ACC1` | UniForm / bridges |
| `api` | `#0D1A30` | `#4E8EE9` | APIs, REST endpoints |
| `auth` | `#161830` | `#5C6BC0` | Auth, security |
| `spark` | `#2A1008` | `#E25A1C` | Apache Spark |
| `pyiceberg` | `#1A0A2E` | `#BA68C8` | PyIceberg, Python |
| `snowflake` | `#0A1E2C` | `#29B5E8` | Snowflake |
| `trino` | `#200A1A` | `#DD00A1` | Trino, Flink |
| `duckdb` | `#2A2410` | `#FFC107` | DuckDB |
| `dotnet` | `#1A0E2E` | `#512BD4` | .NET services |
| `react` | `#0A1E2C` | `#61DAFB` | React frontend |
| `kubernetes` | `#0A1233` | `#326CE5` | Kubernetes |
| `terraform` | `#0A1A2E` | `#7B42BC` | Terraform |
| `kafka` | `#1E1E1E` | `#231F20` | Kafka |
| `redis` | `#1E0A0A` | `#DC382D` | Redis |
| `postgres` | `#0A1A2E` | `#336791` | PostgreSQL |
| `generic` | `#1A1E24` | `#546E7A` | Default fallback |

## Available Logos (shared/logos/)

| Key | File | Badge BG | Type |
|-----|------|----------|------|
| `mssql` | database.svg | `#CC2927` | fluent |
| `azure` | azure.svg | `#0078D4` | fluent |
| `databricks` | databricks.svg | `#FF3621` | simple |
| `delta` | delta.svg | `#00ADD4` | simple |
| `iceberg` | iceberg.png | `#1e3a5f` | png |
| `spark` | apachespark.svg | `#E25A1C` | simple |
| `python` | python.svg | `#3776AB` | simple |
| `snowflake` | snowflake.svg | `#29B5E8` | simple |
| `trino` | trino.svg | `#DD00A1` | simple |
| `duckdb` | duckdb.svg | `#FFF000` | simple |
| `entra` | person.svg | `#0078D4` | fluent |
| `pat` | key.svg | `#1a3a6e` | fluent |
| `sas` | shield.svg | `#0050a0` | fluent |
| `apacheflink` | apacheflink.svg | `#E6526F` | simple |

### Adding New Logos

1. Save SVG/PNG to `shared/logos/`
2. Add entry to `LOGO_MAP` in `render-diagram.js`
3. Add matching palette entry to `PALETTES` if needed
4. Logo renders as a 36×36 badge with rounded background

## Layout Engine

### Swimlanes
Vertical lanes divided into numbered sections. Each lane has:
- Background rectangle with subtle dark color
- Colored header bar with label
- One or more columns of node cards

### Node Distribution
- **even**: Space nodes evenly within available vertical space
- **compact-top**: Pack nodes tightly starting from top
- **compact-bottom**: Pack nodes tightly against bottom

### Overlap Validation
All node positions are checked for rectangle overlap before rendering.
Build fails with error if any nodes overlap.

### Cross-Lane Arrows
Use the `arrows` array for custom connections between any positions.
Three types: `data` (solid blue), `auth` (dashed gray), `curved` (bezier).

## Tips

1. **Width planning**: Sum all lane X + width values. Add 20px margins.
2. **Height planning**: `nodeHeight * maxNodes + gap * (maxNodes-1) + 170` (header + legend + padding)
3. **Fan-out patterns**: Use curved arrows from one source to multiple targets.
4. **Frames**: Use `column.frame` to group related nodes with a dashed border.
5. **Badges**: Use for environment indicators (PROD, DEV, BETA).
6. **Tags**: Use for categorization (SERVICE, LAYER, PROTOCOL, CLIENT).
