---
paths:
  - "pwa/src/**"
---

# Forms conventions

## The invariant

Every data-entry UI (add/edit modals, detail editors, fill-in forms) is a **seeded component tree rendered by `FormRenderer`** — never bespoke `useState`-per-field + `IonInput` JSX in a page. `code-reuse.md` says *which* component; this rule says *how* the form system works.

## Tree shape

A form is a `form` root node with field children in the `components` table (`survey_components` for surveys):

- Field key = `options.label` — **name it exactly after the DB column / mutation arg it feeds** (`{"label": "job_url"}`), so `FormRenderer`'s output object maps straight onto the GraphQL mutation's args with no translation layer.
- Display text = `data.text`.
- `select` fields get `option` children; an option's stored value is its `options.label`, display text `data.text`.
- Order = `components_relationships.position` (1-based).

Field types in app forms: `input`, `textarea`, `check`, `select`+`option`, `date`, `color`, `richtext`, `filepicker`. Survey trees add `text`, `number`, `scale` etc. (see `SURVEY_TYPE`).

## Modes

- `mode='app'` — values keyed by `options.label` as dot-paths resolved against `defaultValues` (config forms, add/edit modals).
- `mode='survey'` — values keyed by node UUID, making answers cross-survey queryable.

Both modes consume the same `ComponentResults` tree from GraphQL; the DB tables differ but the contract is identical — keep it that way.

## Wiring a form into a page

- Forms are fetched **by name** (`componentByName` via `Api.ts`), with the name in a `constants.ts` group (`FORM_ID`, `EDITOR_ID`, `CONTENT_EDITOR_ID`, …; forks add their own groups) whose comment names the init script that seeds it as source of truth.
- Runtime-only select choices (e.g. a list fetched from the DB) go through the `injectedOptions` prop keyed by field key — never by mutating the fetched tree.
- Prefill with `defaultValues`; submit handler receives the collected values object and passes it to the mutation.

Creating a new form (seed + constants + page wiring) is the `new-form` skill.
