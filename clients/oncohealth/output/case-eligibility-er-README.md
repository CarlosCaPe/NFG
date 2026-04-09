# Case-Eligibility ER Diagram — Flow & Construction

## What It Shows

The diagram maps how **eligibility data flows into case creation** in newUM V1. It answers: *when a UM case is created, which eligibility and provider fields are consumed, validated, and snapshotted?*

## 5-Lane Flow

```
①  ELIGIBILITY         ②  SCOPE               ③  PROVIDER      ④  CASE TABLES    ⑤  DOWNSTREAM
   PRE-CHECK              VALIDATION              DOMAIN                              CONSUMERS
   ─────────►              ─────────►              ─────────►      ─────────►         ─────────►
   Member Search           6 Sequential Rules      NPI Lookup      Case (FK→Elig)     PDL / NP Rules
   Coverage Date           LOB → Product →         Network/OON     CaseDrug (×3)      Letter/Fax
                           State → CarveOut →       Product Code    KeyFieldType       Routing/Queues
                           ASO → Benefit            Site of Care    PotentialElig      TAT Config
                                                    Facility Type   CaseOfficeContact  Mid-Case Re-eval
                                                    Specialty       CasePOSCode
```

**Left-to-right data flow:**
1. **Pre-check** — Find member by plan + DOB + ID. Verify coverage dates contain the treatment window.
2. **Scope validation** — 6 sequential rules run in order. Any FAIL → case is Out of Scope. Rules 4 and 6 also feed the Provider domain (OVERLAP badges).
3. **Provider domain** — NPI lookup determines Practitioner (T1) or Organization (T2). Network check, product code, site-of-care, facility type, and specialty are resolved. Eligibility feeds into provider via Rules 4 & 6.
4. **Case tables** — PostgreSQL OLTP. Case record links to eligibility via `EligibilityVersionId` (GUID FK). KeyFieldType snapshots member data at intake (frozen — not overwritten by ETL). Provider data is also snapshotted at case level (NOPHI-D03).
5. **Downstream consumers** — PDL/NP drug rules, letter/fax service, routing queues, TAT timers all read from eligibility + case data.

## Badge System

| Badge | Meaning |
|-------|---------|
| `ELIG` (blue) | Pure eligibility concept |
| `PROV` (orange) | Pure provider concept |
| `OVERLAP` (purple) | Eligibility ↔ Provider cross-domain node |
| `BOTH` (teal) | Both domains contribute equally |
| `TABLE` (green) | Physical PostgreSQL table |
| `CONFIRMED` (green) | Previously a GAP — now confirmed by NoPHI-Data channel decisions (Apr 2026) |
| `OPEN` (orange) | Open design question |

## How It's Built

The diagram is **config-driven**, not hand-drawn:

1. **JSON config** → `case-eligibility-er-config.json` defines lanes, nodes, badges, arrows, and layout
2. **Renderer** → `shared/render-diagram.js` reads the config and produces a dark-themed SVG
3. **Layout engine** → Nodes are auto-positioned within lanes using `compact-top` distribution. Arrows are computed from coordinates
4. **No manual positioning** — Change the JSON, re-render. The SVG regenerates deterministically

To render:
```bash
node shared/render-diagram.js clients/oncohealth/output/case-eligibility-er-config.json
```

## Recent Updates (v1.25.0, Apr 9 2026)

- **T1/T2 → FHIR naming**: NPI Lookup and Specialty subtitles now use "Practitioner (T1)" / "Organization (T2)" per NOPHI-D01
- **4 GAP → CONFIRMED**: PROV-GAP-01, 03, 04, 05 all confirmed by NoPHI-Data channel decisions
- **OON scope**: Network/OON Check now notes "OON determination = R2" per NOPHI-D08
- **No structural changes**: All 12 NoPHI-Data decisions were assessed — the topology, entities, and relationships remain unchanged
