---
name: new-form
description: Create a seeded FormRenderer form tree (seed SQL + constants + page wiring). Use when a page needs an add/edit form, detail editor, or any new data-entry form.
---

# New form

Create a form as a seeded component tree rendered by `FormRenderer` — never bespoke field state + Ionic inputs in the page. Conventions in `.claude/rules/forms-ui.md` and `.claude/rules/db-schema.md` — read them first.

## Procedure

1. **Seed the tree** — framework forms in `init-scripts/01-init-db.sql` (clone an existing form block there); domain forms (forks) in `02-init-<domain>.sql` (worked example: manuHunter's `form_application` block in `02-init-jobs.sql`):
   - One `form` root + one child node per field, all with hardcoded UUIDs — framework forms use the `c51c1e5f-…` prefix; domain forms get a fresh stable domain prefix (manuHunter jobs style: `aaaaf00X-0000-4000-8000-…` sequential).
   - Field key = `options.label`, named **exactly** after the DB column / mutation arg it feeds; display text = `data.text`.
   - `select` fields get `option` children (stored value = `options.label`, display = `data.text`).
   - Link everything with `components_relationships(parent_id, child_id, position)`, 1-based, in display order.
2. **Constants** — add the form's *name* to the right group in `pwa/src/constants.ts` (`FORM_ID` / `EDITOR_ID` style; forks use a `// [MY DOMAIN]` region), with a comment naming the init script as source of truth.
3. **Wire the page** — fetch by name via `Api.ts` (`componentByName`), render `<FormRenderer mode='app' component={...} defaultValues={...} onSubmit={...}>` inside a `ModalShell` (per `code-reuse.md`). Runtime select choices go through `injectedOptions`, never by mutating the tree. Because field keys match mutation args, the submit handler passes the values object to the mutation with no mapping layer.
4. **Check the mutation** accepts every field key you seeded (`WRITABLE` list in the resolver) — a form field with no matching arg silently goes nowhere.
5. **Do not run the app.** Finish by telling the user to run `./run reset` (seed change; wipes DB + MinIO).
