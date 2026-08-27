---
name: project_bedside_domain
description: "Data Collection (bedside) domain — schema, patient=survey-answer model, and new-UI inventory for future generic components"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4b07ae86-bff2-4c89-be4f-72abb8bd8fe3
---

The **Data Collection** admin area (code domain slug `bedside`) for managing patients, beds, and bedside Pis. Built 2026-06-30. See [[project_bedside_server.md]], [[project_bedside_pi]], [[project_bedside_hardware]].

**Core model:** a patient IS a Patient Registration survey answer (survey `f000`, component root `e000`). The domain does NOT re-store demographics — it augments a patient keyed by `survey_answers.id`. So all seeded survey answers appear as patients immediately. The survey's old "Vital Signs" section (`e013`–`e019`) was removed; physiological data is streamed into per-patient files instead.

**Schema** (`init-scripts/03-init-bedside.sql`): `bedside_nodes` (Pis, static, seeded with placeholder `pi-bedside-01`), `beds` (one Pi per bed, `node_id` UNIQUE), `bed_assignments` (patient↔bed history, partial-unique active per bed/patient), `patient_files` (per-patient HDF5 file, minted on patient creation). ⚠ The seeded Pi uses PLACEHOLDER name/IP/location — replace with real values.

**Backend:** patient create/delete + file minting in `routes/bedside/patients.js` (REST, touches MinIO; empty 0-byte `.h5` placeholder — real HDF5 init deferred to Python). Reads + bed-linking in `schema/resolvers/bedside/patients.js` (GraphQL; **every resolver calls `requireAdmin(ctx)`** because GraphQL queries are NOT admin-gated by the permissions layer — only mutations are).

**Frontend:** `pages/bedside/Patients.tsx` + `Devices.tsx`, admin-only routes in `App.tsx`. Reused existing shells heavily: SplitPageLayout, ResourcePanel, ModalShell, FormRenderer (survey mode for add-patient), DataTable (bed history), EmptyState, JsonViewer.

**New UI written (candidates to generalise further):**
- `components/shell/DetailList.tsx` — NEW generic, already reusable: read-only key/value list (`{label, value}[]`, value is any node). Used by both new pages. Good candidate to adopt elsewhere (e.g. Files detail).
- Bed-assignment control (select + Assign/Move/Discharge) — inline in Patients.tsx; domain-specific, could become a generic "single-active-relation picker" if the pattern recurs.
- Status badge color helper (`online→success/unknown→warning/else medium`) — duplicated inline in both pages; trivial, fold into a shared `statusColor` util if a third use appears.

**Reseed required after these changes** (`./run reset`) — see [[feedback_never_run]].
