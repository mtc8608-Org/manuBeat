---
name: sibling-apps
description: Pointers to the apps forked from manuSpine (manuHunter, manuBeat) and where their memory lives, for cross-app reference and reuse
metadata:
  node_type: memory
  type: reference
---

# Forks of manuSpine and their memory

manuSpine is the upstream framework (see [[manulab-context]]); these apps fork it via the `upstream`-remote merge workflow (CLAUDE.md "Framework downstream"). Their detailed memory lives in their own repos, not here. Consult it before designing framework features that overlap something a fork has already solved — their generic patterns are port candidates, not things to reinvent.

## manuHunter (job-search app — most active fork)
- Repo: `/home/cabsman/Documents/projects/manuHunter`, domain: jobs, applications, LaTeX CV builder.
- Memory: `manuHunter/.claude/memory/`. Key files: `framework-upstream-candidates.md` (mirrored here as [[framework-upstream-candidates]] — the port list), `user-secrets-keychain.md` (mirrored here), `cv-builder-plan.md` + phases (domain, stays there).
- Source of the tier/roles auth model, user_profile/user_secrets keychain, SinglePanelLayout, PdfViewer, and the `.claude/` rules/skills layout this repo imported (2026-07-02).

## manuBeat (cardio / bedside telemetry app)
- Repo: `/home/cabsman/Documents/projects/manuBeat`. Same fork/merge workflow.
- Memory: `manuBeat/.claude/memory/`. Rich, mostly domain-specific, but useful as a worked example of extending the framework. Key files there:
  - `project_cardio_port` : porting `CardioRespiratoryModelV2` (branch `V2.3`) into manuBeat as the cardio domain (Python compute).
  - `project_bedside_domain` : the `bedside` admin domain, where a patient IS a survey answer (survey `f000`), augmented via `bedside_nodes`/`beds`/`bed_assignments`/`patient_files`. Good example of adding a domain on top of the survey + component-tree framework and reusing the shell components. **Merge hazard (2026-07-04):** upstream reseeded `f000` as a User Feedback survey and made `survey_answers.owner_id NOT NULL` (owner-scoped resolvers) — manuBeat's bedside domain collides head-on; see the survey-reframe merge note in [[framework-upstream-candidates]] before its next pull-upstream.
  - `project_bedside_server` / `project_bedside_pi` / `project_bedside_hardware` : edge-telemetry system (Raspberry Pi agents streaming device data to the manuBeat server). The Pi agent lives in a separate repo, **manuEdge** (`git@github.com:mtc8608/manuEdge.git`, `/home/cabsman/Documents/projects/manuEdge`, native systemd Python agent). Hardware BOMs and Pi flashing details are there too.

## Framework takeaways
- New domains in forks follow the same recipe (manuBeat's `bedside`, manuHunter's `jobs`): `init-scripts/02-init-<domain>.sql`, `routes/<domain>/`, `resolvers/<domain>/`, frontend pages, reusing the shell components.
- After the tier/roles port lands here, GraphQL queries and mutations are enforced identically by `permissions.js` + `schema/index.js` (no public tier) — the old "queries are not admin-gated" caveat from manuBeat's era no longer applies.
- New generic shell components built in a fork (manuBeat's `DetailList`, manuHunter's `PdfViewer`) belong here in manuSpine so all apps get them — track via [[framework-upstream-candidates]].
