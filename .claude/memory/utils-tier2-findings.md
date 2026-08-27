---
name: utils-tier2-findings
description: "deferred (tier-2) dedup candidates found during the utils audit — domain-coupled duplicates that belong in run/ or hdf5/, NOT utils.py"
metadata: 
  node_type: memory
  type: project
  originSessionId: 00c1f08a-ddca-4d8d-bb48-00f8a70a5a15
  modified: 2026-08-23T10:03:33.790Z
---

Deferred cleanup backlog from the 2026-07-09 utils audit (see the `.claude/rules/utils-helpers.md` rule
for what was actually done — tier 1). These are duplicated/misplaced bits of code that
are **domain-coupled**, so they must NOT go into `python/library/utils.py`; each belongs in its
proper subpackage. Verify line numbers before acting (code moves).

**Re-verified 2026-08-23:** one item done, the rest still open, and two of them have grown
since the audit as new notebooks were cloned from old ones.

- **[✅ DONE 2026-07-09]** **"Result Handling" region** (`_runPath` / `saveRun` / `saveConfig` /
  `saveProcessed` / `processResults` / `plotResults`) was byte-identical in `python/run_test/hr.ipynb`
  and `python/run_cpet/run.ipynb` → extracted to `python/library/run/runIO.py` (wraps hdf5.schema_sim +
  postproc.resultsEngine + viz.plots). `python/run_test/hr.ipynb` was deleted 2026-08-10, so
  `python/run_cpet/run.ipynb` is now the only caller.
- **`obsTarget` / `clinicalToTargets`** (twin-target convention) → **decided home: a new
  `python/library/run/targets.py`** (`progress.py` imports from it; its `obsTargetArrays` inner
  `target()` is the same lookup). Notebooks keep a one-line wrapper closing over
  twin/volumeDistribution (like the obsOffset pattern). **NOT BUILT — `targets.py` does not
  exist**, and `def obsTarget` now appears in **six** notebooks (`python/run_convergence/{serial,batch,
  gd,mcmc_emcee}`, `python/run_test/{solver_compare,inductance_sweep}`) plus `python/library/run/progress.py`.
  `clinicalToTargets` is still only in `python/run_sepsis/gen_population.ipynb`.
- **`rawWriterFactory` + batched-population block** → **decided home:
  `python/library/hdf5/raw_stream.py`** (next to `RawTraceStreamWriter`; supersedes the earlier
  runnerBatchSI suggestion). **NOT BUILT**, and it is now in **three** notebooks:
  `python/run_convergence/batch.ipynb`, `python/run_test/inductance_sweep.ipynb`,
  `python/run_test/volume_ladder.ipynb`.
- **`decodeStates` / `encodeStates` / `_stateNameOf`** still duplicated verbatim across
  `python/library/model/modelClass.py` and `python/library/model/modelClassSI.py` (encodeStates differs
  only in float64 dtype policy) → one shared model module. Callers: runner.py, runnerBatchSI.py.
  Blocked behind [[si-default-migration-plan]], which deletes `modelClass.py` outright.
- **HDF5 type converters**: `HDF5API.hdf5TypeConverter` / `hdf5TypeConverter2D`
  (`python/library/hdf5/HDF5API.py`) duplicate `engine.type_converter` (`python/library/hdf5/engine.py`).
  Consolidate into `engine`; blocked on `python/library/model/modelGen.py` `getHdf5Data` call
  (only remaining HDF5API consumer besides hdf5Test). **Still open.**
- **HDF5 `json.dumps(conf or {})` attr idiom** repeated across schema_sim/schema_pop/
  schema_calib → an `engine.write_json_attr` / `read_json_attr` helper. **Still open**, no
  such helper exists.
- **`viz/plots.py:_disp`** — redundant sugar over `utils.labelFor(name,'latex',default)`;
  kept in tier 1, and now at 28 call sites with load-bearing fallbacks. Leave it.
- **`python/run_sepsis/analysis.ipynb` obsOffset** is still a raw local def rather than the
  `utils.obsOffset(name, ATM)` wrapper; convert next time that cell is touched.
