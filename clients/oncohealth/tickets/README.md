# OncoHealth — Assigned Tickets

Tracking folder for ADO work items assigned to Carlos Carrillo (`ccarrillo@oncologyanalytics.com`).

## Conventions

### Folder Naming
```
<ADO-ID>-<slug>/
```
- `ADO-ID`: numeric work item ID from Azure DevOps (e.g., `185594`)
- `slug`: kebab-case summary (e.g., `review-the-doc`, `iceberg-rest-catalog`)
- Use `XXXXXX` as placeholder if ADO ID not yet assigned

### Contents (per ticket)
| File | Purpose |
|------|---------|
| `output.*` | Single idempotent deliverable — `.sql`, `.md`, `.py`, `.sh`, etc. |
| `closure-note.md` | ADO closure note following the submit template |

### Closure Note Template (ADO Submit)
```markdown
# Closure Note — <Ticket Title>

## Architecture Overview
<diagrams, data flow, component interactions>

## Cost Estimation
<compute, storage, licensing — or "N/A" if pure investigation>

## Repo Link
<PR, branch, or folder link>

## Pros
- ...

## Cons
- ...

## Risks & Open Questions
- ...
```

### Workflow
1. Ticket assigned in ADO → create folder here
2. Research / implement → produce `output.*`
3. Write `closure-note.md` following submit template
4. Update ADO ticket with closure note content
5. Mark ticket as Resolved/Closed in ADO

### Current Tickets
| ADO ID | Title | Sprint | Status |
|--------|-------|--------|--------|
| 185594 | review the doc | 26.03.31 | Active |
| 186438 | Iceberg REST Catalog investigation | TBD | Active |
