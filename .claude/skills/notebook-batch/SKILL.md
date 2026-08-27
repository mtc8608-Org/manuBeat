---
name: notebook-batch
description: Batch-apply one described change to many notebooks in parallel — one notebook-editor agent per target .ipynb, spawned concurrently, results collected into a per-notebook report. Use when asked to apply the same edit/refactor/rename/runConfig change across several notebooks (e.g. "add X to runConfig in all convergence notebooks", "rename this key everywhere", "region-wrap every notebook"). Not for creating new notebooks (population-notebook) or single-notebook edits (just edit it).
---

# notebook-batch — fan the same change out over N notebooks

One change description, N notebooks, one `notebook-editor` agent per notebook,
all spawned in parallel. The skill orchestrates; the agents edit. For a single
notebook, skip the skill and edit directly — the fan-out only pays off at ≥2
targets.

## 1. Parse the request

Extract two things from the invocation:

- **The change**, kept verbatim — the agents receive the user's own wording
  plus any concrete context you can add cheaply (the runConfig key, a
  reference notebook that already has the change, the exact old/new text).
- **The targets** — notebook paths or globs named in the request.

## 2. Resolve targets

- **Targets named explicitly** (paths, globs, or a folder like
  "the python/run_convergence notebooks"): resolve them with Glob and proceed
  immediately — no confirmation.
- **No targets named**: default to every `python/run_*/**/*.ipynb` in the repo,
  then CONFIRM the resolved list with AskUserQuestion before spawning
  anything (the default may sweep in notebooks the user forgot exist).
- Exclude checkpoints (`.ipynb_checkpoints/`) always.

## 3. Fan out

Spawn one `notebook-editor` agent per target notebook, ALL in a single
message so they run concurrently. Each prompt must contain:

- the absolute notebook path (its ONLY writable file);
- the change description verbatim + the concrete context from step 1;
- a reminder that "not applicable" is a valid outcome — if the notebook has
  no matching cell/key, report that rather than forcing an edit.

No worktree isolation — each agent owns a distinct file, so parallel edits
cannot conflict. Do not also edit any notebook yourself while agents run.

## 4. Collect and report

Wait for all agents, then report one line per notebook: `applied` (with the
touched cells), `not applicable` (with why), or `failed` (with the reason).
Surface failures and not-applicables prominently — a silent partial batch is
the failure mode this report exists to catch. If any agent failed, offer to
retry just those notebooks; do not auto-retry.

Do not commit, do not execute notebooks, and do not smoke-test unprompted —
the user reads the diff. If the change plausibly alters runtime behavior,
mention that a smoke test (`smoke-test` skill, Tier 0 byte-compile of the
edited notebooks) is available, and ASK rather than running it.
