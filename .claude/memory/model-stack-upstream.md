---
name: model-stack-upstream
description: python/library is a verbatim port of CardioPulmonaryModel's library/ — the three deliberate divergences, the sync recipe, and the work that stayed behind
metadata:
  node_type: memory
  type: project
---

`python/library/` and `python/config/` came verbatim from
`/home/cabsman/Documents/projects/CardioPulmonaryModel` (`library/`, `config/`) on
2026-08-27. The source repo's 14 driver notebooks came across with it and were
**removed again on 2026-08-28** — manuBeat keeps only the library; the notebooks
live on in CardioPulmonaryModel. That repo remains the source of truth for the model
stack — manuBeat is a **second** consumer of it, not its owner.

**Why verbatim matters:** every intra-package import is absolute (`import
library.utils as utils`) and `utils.PROJECT_ROOT` is derived as the parent of the
package, which is why `library/` and `config/` sit side by side under `python/`
rather than inside `api/domains/medical/`. Keeping the tree byte-identical makes the
next sync an rsync instead of a merge.

**How to sync:** rsync `library/` and `config/` (minus `archive/`) from the source
repo over `python/`, then re-apply the four divergences below, re-run
`scripts/gen-physiology-seed.py`, and re-run the smoke-test skill. Do **not** bring the
source repo's notebooks across — they were deliberately dropped (see
[[project-file-tree]]).

## The four deliberate divergences — port these back upstream

1. **`modelClass.initialiseModel` / `modelClassSI.initialiseModel`** accept an
   optional `simulationParams['modelStructure']`: a pre-loaded model dict used in
   place of reading `config/models/<modelFileName>`. The web route holds the model
   JSON in Postgres, not on disk. The source repo already had this on its own
   deferred list ("an `initialiseModel` variant that mounts a run from an in-memory
   `/config` group").
2. **`ProgressReporter(onEmit=...)`** in `run/progress.py`, threaded through
   `run/runner.py` and `run/runnerBatchSI.py`. Fires per emitted convergence line so
   a web UI polling a minutes-long calibration can show progress; `records` alone is
   only handed over when the run finishes. Exceptions in the callback are swallowed.
3. **`config/models/cvModel_*.json` (all five) have `configurations`, `modelParams`
   and `savedd` stripped** (2026-08-28), leaving the structure-only shape `cpet.json`
   already had. All three are dead: `modelClass.initialiseModel` overwrites
   `configurations` wholesale from the scenario before the generator runs;
   `volumeDistribution` is read from `shared.twin`, never from the model's
   `modelParams` (`modelGen`'s `modelParams` is an unrelated internal bucket); and
   `savedd` has no reader anywhere and held stale `L_*` values that disagree with the
   connections' own `params.L`. Removing them is behaviour-neutral and lets the Model
   Sandbox present one shape. **Re-apply after every rsync** — the disk configs are the
   canonical source and `init-scripts/seed-physiology.sql` is generated from them.
   `pwa/src/pages/models/modelSchema.test.ts` reads these files directly, so a re-sync
   that restores the keys fails that suite immediately.
4. Nothing else. If a fix is needed in `python/library/`, make it in
   CardioPulmonaryModel first and re-sync — a local patch becomes a permanent
   conflict, exactly as with manuSpine ([[project_framework_upstream]]).

## What the port covers, and what it does not

Landed: the HDF5 layer (`engine` + `schema_sim`/`schema_pop`/`schema_calib`/`migrate`
/`raw_stream`/`bundles`), the full model + run + postproc + viz stack, and all six
model / six scenario / two processing / nine plot configs, seeded into Postgres by
`scripts/gen-physiology-seed.py`. `library/hdf5/HDF5_PORT_DESIGN.md` travelled with
the code and is the spec for that layer; its "manuBeat port" section is now history.

`library/run/runIO.py` and `library/viz/plots.py` have **no caller left in manuBeat**
(the notebooks were their only consumers) and `matplotlib` is not in the python image, so
they are not importable here. They stay because the tree is kept byte-identical to
upstream — do not delete them to "clean up".

Still open, inherited from the source repo:

- `schema_pop` and `schema_calib` have never been exercised on real population /
  training data — only the synthetic suite (`python -m library.hdf5.test_hdf5`).
- `schema_calib.export_model_for_web` is a `NotImplementedError` stub; the `.keras`
  blob is Python-only, so browser inference is blocked until a tf.js/ONNX export
  exists. `tensorflow` is deliberately absent from both images until then.
- The SI-as-default migration ([[si-default-migration-plan]]) is 0% built, and the
  utils dedup backlog it inherited is untouched. Both are upstream work — do them
  there.

Left behind on purpose: `config/archive/` (35 pre-scenario JSONs), the 130 GB
`data/` tree, the driver notebooks, the
`codeArchive/` directory, and the entire `EFC_Paper/` manuscript with its LaTeX
rules, skills and memories. Calibration-method verdicts from that work
(emcee burn-in fix, NUTS parked, per-parameter MCMC rejected) stay in the source
repo's own idea ledger.
