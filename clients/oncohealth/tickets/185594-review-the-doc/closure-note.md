# Closure Note — Review the Doc

**ADO**: [#185594](https://dev.azure.com/oncologyanalytics/newUM/_workitems/edit/185594)
**Parent**: US #185749 — Final review of technical doc - v1
**Feature**: #182327 — Architecture outline - Data Team System Design Doc
**Area**: newUM\Data Team
**Sprint**: 26.03.31
**Priority**: P2 (elevated to P1 per meeting 2026-03-24)
**Reviewer**: Carlos Carrillo — Senior Data Engineer / AI-Leveraged Documenter
**Document**: "NewUM Data Team System Design Document" (30 pp., SharePoint Phase 1 Deliverables)
**Other reviewers**: Oleksandr (#185591), Cory (#185592), Arben (#185593)

---

## Summary

The document is a **solid, comprehensive system design** covering the NewUM Data Platform's medallion architecture across Eligibility, Provider, Cases, and Drugs domains. It demonstrates mature thinking on DQ gates, CDC patterns, HIPAA compliance, DR, and scalability (500K cases/day). The risk sections are notably honest and well-structured — each risk follows a "Business impact → Working hypothesis → Unblocks → Invalidates" pattern that makes them actionable.

Overall assessment: **Ready for implementation with the findings below addressed.**

---

## Findings

### F1. Databricks workspace identity — p. 5
**Comment on**: High Level Design, paragraph referencing "Azure Databricks"
**Source**: knowledge.json `environments.databricks.workspaces[]` — DEV (`adb-3806388400498653.13`) is blocked due to PHI; TEST (`adb-2393860672770324.4`) is the primary development workspace (confirmed 2026-03-24). Document does not distinguish between them.
> The document references "Azure Databricks" as a single platform. What if a new team member targets the DEV workspace for a DAB deployment — would they hit the PHI-restricted environment? What if the High Level Design section included a workspace registry table mapping environment names to workspace IDs and access restrictions, so the CI/CD section (p. 25) and onboarding both reference a single source of truth?

### F2. Eligibility model ~85% validated — p. 11
**Comment on**: Risks section, paragraph: "~85% of the eligibility model is validated, but the remaining ~15% carries disproportionate risk"
**Source**: Document p. 11 proposes "a series of dedicated workshops [...] weekly until all three are resolved." knowledge.json `communication.channels[0].active_chats` confirms these workshops exist in Teams: "Eligibility - Person/Member workshop", "Payer taxonomy workshop", "Eligibility workshop" — with Bernice Nyanjui, Michal Mucha, and Oleksandr Nykonenko as participants.
> Have the three proposed workshops (business hierarchy mapping, manual override coexistence, person identity grain) already produced confirmed decisions? What if those outcomes replaced the "working hypothesis" language — would downstream teams (rules engine, scope determination, letters) have enough confidence to start implementation against a stable schema? What if the document captured the current status of each workshop with a concrete "decided / in progress / not started" label?

### F3. Manual eligibility override vs ETL sync — p. 11
**Comment on**: Risks section, paragraph: "If the ETL sync mechanism [...] operates as a full table replacement rather than row-level upsert, it would wipe manual records"
**Source**: Document p. 11 explicitly identifies this as a potential invalidator. knowledge.json `communication.channels[0].active_chats` lists "Databricks Lakeflow Connect" as a dedicated Teams discussion topic, suggesting the sync mechanism is under active evaluation. Databricks docs state Lakeflow Connect supports both full refresh and incremental modes ([Databricks Lakeflow Connect docs](https://docs.databricks.com/en/lakeflow-connect/index.html)). (See also F6 for the broader integration mechanism decision.)
> Has the chosen sync mechanism been validated to support row-level upsert that respects the `EligibilitySource` flag? What if Lakeflow Connect is configured in full-refresh mode by default — would it silently wipe MANUAL-flagged rows on every sync cycle? What if this dependency had a specific owner and a validation date, so the ETL team knows whether to build source-aware logic before or after the tooling decision is finalized?

### F4. ER diagram and data dictionary links — pp. 7, 12, 17
**Comment on**: Three separate sections — Eligibility Domain (p. 7: "Data model ER diagram: Link to documentation"), Provider Domain (p. 12: same), Cases Domain (p. 17: same)
**Source**: Document uses "Link to documentation" as a placeholder in all three domain sections. Teams chat from 2026-03-20 (captured in knowledge.json via `shared/scrape-teams-calendar.js`) confirms Arben updated the provider diagram and data dictionary. Microsoft's [Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/) recommends self-contained design docs with embedded or directly linked artifacts.
> These are the most critical visual aids in the document. What if a reviewer needs to validate the schema against the prose — where would they find the actual diagrams? Are they in Confluence, Miro, or SharePoint? What if the document included the actual URLs so it's reviewable without chasing external references? What if, for offline readability, we also embedded static screenshot exports alongside the links?

### F5. Medallion layer ownership boundary — p. 24
**Comment on**: Medallion Layer Design, paragraph: "the Onco Data team picks up the raw data and drives it through the medallion architecture"
**Source**: Document p. 24 describes the boundary in prose: NewUM Data Team owns Bronze ingestion, Onco Data Team owns Silver/Gold transformations, NewUM team consumes Gold. Databricks' own [Medallion Architecture guide](https://www.databricks.com/glossary/medallion-architecture) recommends explicit ownership per layer to avoid "data swamp" scenarios.
> The ownership boundary is clear in prose but buried across paragraphs. What if a new consumer team reads only this section — would they know exactly whom to contact for Bronze write issues vs Silver DQ failures vs Gold certification? What if we expressed this as a RACI-style table (layer / owner / responsibility) to make the boundary unambiguous at a glance?

### F6. Integration mechanism — "Working Hypothesis" — p. 23
**Comment on**: Section: "Working Hypothesis: batch ingestion via API exposed by Data Team"
**Source**: Document p. 23 evaluates 7 integration patterns (A-I) and selects REST API as the working hypothesis. Open Question #1 (p. 31) confirms: "Which bidirectional integration pattern(s) from the evaluation are confirmed?" knowledge.json records "Databricks Lakeflow Connect" as an active Teams chat topic, suggesting additional context may exist beyond what's captured in the document. (See also F3 for sync mechanism impact on eligibility overrides.)
> What if this document is referenced 6 months from now — would "Working Hypothesis" signal that the architecture is still unresolved? Has the REST API approach been validated in the Lakeflow Connect workshops, and could "Working Hypothesis" be promoted to "Selected Approach" with documented rationale? What if there's a decision deadline — should it be stated here so the team knows when this must be locked down?

### F7. Typo: "Medalion" — p. 24
**Comment on**: Section heading "Medalion Layer Design"
**Source**: Standard English spelling; also Databricks' official docs use "Medallion" consistently ([Databricks Medallion Architecture](https://www.databricks.com/glossary/medallion-architecture)).
> Minor: "Medalion" should be "Medallion" (double 'l').

### F8. Cases domain scope contradiction — pp. 17-21 vs p. 30
**Comment on**: Cases Domain section (p. 17, 4 pages of detailed schema) vs Scope/Constraints (p. 30: "Cases domain — ownership TBD separately")
**Source**: Document p. 17 provides detailed case schema (Core tables, CaseHistory, CaseAction, CaseMessage, CaseDocument, etc.) and p. 21 describes Databricks integration for cases. However, p. 30 lists "Cases domain" under Out of Scope. These two sections appear to contradict each other.
> The document includes 3 pages of detailed Case schema design but then lists Cases as "out of scope." What if someone reads the Scope section first and skips the Cases section entirely? What if we added a clarifying line at the top of the Cases section: "Included for integration context and data contract definition; Case schema ownership and development remain with the NewUM application team"? Would that resolve the apparent contradiction?

### F9. Network bridge partition strategy — p. 16 vs Silver design
**Comment on**: Provider Domain Risks (p. 16), paragraph: "partitioned by payer_id and Z-ordered on provider_id + network_id"
**Source**: Document p. 16 specifies partition + Z-ORDER strategy in the risk section but the Silver schema design section (p. 25) describes Silver transformations generically without table-level partition specs. Databricks [Delta Lake optimization docs](https://docs.databricks.com/en/delta/optimize.html) recommend defining OPTIMIZE + ZORDER in the schema design, not as an afterthought.
> The partition and Z-ORDER strategy for the 80M+ network bridge is documented only in the risk section. What if the engineer implementing the Silver schema follows only the Silver design section and misses this performance-critical decision? What if the partition specification (payer_id) and Z-ORDER columns (provider_id + network_id) were also stated in the Silver schema design, so implementation and risk mitigation are in one place?

### F10. Data volume estimates missing from source registry — pp. 5-6
**Comment on**: Ingestion Source Registry table (pp. 5-6)
**Source**: The registry lists 8 sources with entities, latency, and notes — but no row counts, file sizes, or growth rates. The only volume figure in the entire document is "80M+ records" for network participation (p. 16, Provider risks). knowledge.json `environments.databases[]` identifies oadb ("under strain"), DrugsMS, EligibilityMS, ProviderMS — all MS-SQL — but no volume data exists there either. Databricks' [cluster sizing guide](https://docs.databricks.com/en/clusters/cluster-config-best-practices.html) explicitly requires volume estimates for compute right-sizing.
> What if we need to size Databricks clusters, estimate DBU cost per pipeline tier, or validate SLA feasibility — where would the volume data come from? Is the daily volume for payer eligibility feeds 10K rows or 10M? What would make a volume estimate "good enough" for this phase — would current row counts from the four MS-SQL databases plus a 2-year growth projection suffice? What if we added a "Volume (current / projected)" column to the Ingestion Source Registry?

### F11. Open Questions have no owners or target dates — p. 31
**Comment on**: Glossary — Open Questions (9 items)
**Source**: Document p. 31 lists 9 open questions including: Integration Mechanism (#1), Matis API Coverage (#2), PHI tokenization scope (#8), and "30 HIGH-priority schema gaps from Feb 2026 Gap Analysis" (#9). None has an assigned owner, target sprint, or linked ADO work item. The project uses Azure DevOps for work tracking (knowledge.json `environments.azure_devops.url`); ADO supports direct linking of open questions to work items.
> What if these open questions drift as background concerns because no one is explicitly accountable? The document itself warns (p. 11): "preventing these items from drifting as background concerns" — shouldn't that same principle apply to the Open Questions section? What if each question had an owner, a target sprint, and an ADO work item ID — would that give the team visibility in sprint planning and prevent silent accumulation of unresolved architecture debt?

### F12. Assumption A1 vs Synapse legacy — p. 32
**Comment on**: Assumptions table, row A1: "No competing platforms (Snowflake, Redshift) are in scope"
**Source**: knowledge.json `tech_stack.data[]` lists "Synapse (legacy, going away)" and "SSIS (legacy, going away)" as current tech stack components. A1 excludes Snowflake and Redshift but does not mention Synapse. If Synapse workloads are being decommissioned, the migration/decommission path intersects with this document's scope.
> What if someone interprets A1 as meaning Synapse decommission is also out of scope for this document — is that the intent? What if existing Synapse workloads have dependencies on data sources listed in the Ingestion Source Registry — would those dependencies need to be addressed before or during the medallion architecture rollout? What if A1 included a note: "Synapse legacy workloads are scheduled for decommission; migration path is not addressed in this document"?

---

## Strengths

- **Risk honesty**: The "Working hypothesis → What this unblocks → What could invalidate it" pattern in every risk section is excellent. This should be a template for all NewUM design docs.
- **Layered integration analysis**: The 7-option evaluation for Databricks↔NewUM integration is thorough and well-structured.
- **HIPAA awareness**: PII tokenization, WORM storage for audit trails, BAA requirements for third-party tools — all addressed proactively.
- **Scalability design ceiling**: 10x current volume (500K cases/day) with defined mechanisms (autoscaling, Z-ORDER, partition pruning).
- **Schema evolution**: Expand-Contract pattern with explicit migration rules is mature.
- **DR strategy**: RPO/RTO targets per component with concrete recovery mechanisms.

---

## Verdict

| Category | Rating | Notes |
|----------|--------|-------|
| Medallion architecture | Strong | Clear Bronze/Silver/Gold layering with DQ gates |
| Domain coverage | Strong | Eligibility, Provider, Cases, Drugs all covered |
| Integration design | Needs decision | 7 options evaluated, none confirmed |
| Completeness | Needs links | ER diagrams and data dictionaries are placeholders |
| Risk transparency | Excellent | Honest, structured, actionable |
| Data volumes | Needs data | No volume estimates except network 80M |
| Governance | Needs owners | Open questions have no owners or deadlines |
| Editorial | Minor | One typo ("Medalion") |

**Recommendation**: Accept the document with the findings above tracked as comments in ADO. Priority items: F4 (add ER links), F6 (confirm integration mechanism), F8 (resolve Cases scope contradiction), F11 (assign owners to open questions).
