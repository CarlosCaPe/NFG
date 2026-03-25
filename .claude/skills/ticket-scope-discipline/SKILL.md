---
name: ticket-scope-discipline
description: 'Enforce investigation-vs-implementation scope on ticket deliverables. Use when writing closure notes, output docs, ADO comments, or any ticket documentation. Prevents scope leakage: items outside the ticket type (e.g., implementation tasks in an investigation ticket) must be separated or excluded. Triggers on: ticket, closure note, investigation, output.md, action items, next steps, blockers, findings, scope.'
---

# Ticket Scope Discipline

## Problem This Solves

Investigation tickets bleed into implementation territory. The deliverable ends up with "BLOCKER" and "WAITING" items that are actually findings — making a 100% complete investigation look 85% complete. This confuses stakeholders and blocks ticket closure.

## Core Rule

**Every item in a ticket deliverable must match the ticket's scope.** If the ticket says "investigate," every action item, risk, and next step must be an investigation activity. Implementation items are findings to hand off, not work to track.

## Scope Classification

| Ticket Type | In Scope | Out of Scope |
|-------------|----------|-------------|
| **Investigation** | Research, validate, document, capture inventory, identify prerequisites, analyze cost, compare alternatives | Enable features, create service principals, run POCs, configure production, onboard environments |
| **Implementation** | Build, configure, deploy, test, validate end-to-end | Research feasibility (should be a prior investigation ticket) |
| **Review** | Read, analyze, list findings, grade, recommend | Fix the issues found (that's a separate ticket) |

## Vocabulary Rules

### Investigation Tickets

**Use these words:**
- FINDING — a discovered fact
- CONFIRMED / VALIDATED — something tested and verified
- DOCUMENTED — captured for handoff
- PREREQUISITE — something needed for future implementation
- CAPTURED — data/inventory collected

**Never use these words (they imply ongoing work):**
- BLOCKER — implies the investigation is stuck (it's not; you found the blocker, that's the deliverable)
- WAITING — implies you need something to finish (you don't; the investigation documented the current state)
- NOT STARTED — implies you plan to do it (you don't; it's out of scope)
- TODO — implies remaining work

### Reframing Examples

| Wrong (leaks implementation) | Right (investigation finding) |
|------------------------------|-------------------------------|
| "BLOCKER: external_access_enabled = false" | "FINDING: `external_access_enabled = false` — prerequisite for implementation" |
| "WAITING on Michal for table selection" | "DOCUMENTED: Gold-layer candidates identified (Section 6.2); Data Team selects table during implementation" |
| "NOT STARTED: Enable UniForm on POC table" | (Remove — this is implementation, not investigation) |
| "Action Item: Create service principal" | "Implementation prerequisite: Service principal needed (3 existing SPs documented in Section 6.4)" |

## Document Structure for Investigation Tickets

### Executive Summary
- **Verdict**: GO / NO-GO / CONDITIONAL (with clear reason)
- **What was validated**: list of confirmed items
- **Implementation prerequisites**: numbered list of things the implementation team needs to do

### Findings Table
Every investigation deliverable must have a findings summary:

```markdown
| # | Finding | Result |
|---|---------|--------|
| 1 | Endpoint accessible | CONFIRMED — tested 12 endpoints |
| 2 | Permissions gap | DOCUMENTED — missing GRANT X |
| 3 | Cost impact | ZERO incremental licensing |
```

### Implementation Prerequisites (separate section)
Prerequisites go in their own section, clearly labeled as **handoff items** — not action items for this ticket:

```markdown
### Implementation Prerequisites (for future ticket)
| # | Prerequisite | Owner | Notes |
|---|-------------|-------|-------|
| 1 | Enable feature X | Admin Team | Currently disabled |
```

### What NOT to include
- "Next Steps" with WAITING/NOT STARTED items
- Action item tables with mixed investigation + implementation rows
- Risk tables where mitigations are implementation tasks

## Completion Assessment

An investigation ticket is **100% complete** when:
1. All questions the ticket asked are answered (with evidence)
2. All findings are documented with sources
3. Implementation prerequisites are listed (but not started)
4. Cost/tradeoff analysis is done (if applicable)
5. The document can be handed to another engineer for implementation without further research

It is NOT blocked by:
- Waiting for someone to confirm they'll do an implementation task
- Not having run a POC (that's implementation)
- Not having production credentials (that's implementation)

## Checklist (run before marking ticket complete)

- [ ] Every "BLOCKER" reframed as "FINDING" or "PREREQUISITE"
- [ ] Every "WAITING" either resolved or reframed as "DOCUMENTED — handoff to implementation"
- [ ] Every "NOT STARTED" item either completed or moved to "Implementation Prerequisites"
- [ ] Status says COMPLETE, not VALIDATED or IN PROGRESS
- [ ] No action items with implementation scope in the main action table
- [ ] Verdict is clear: GO / NO-GO / CONDITIONAL
- [ ] All sources cited