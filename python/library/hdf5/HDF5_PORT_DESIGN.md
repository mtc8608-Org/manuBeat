# HDF5 Port Design — CardioPulmonaryModel → manuBeat

**Status:** all five modules built (`engine`, `schema_sim`, `schema_pop`,
`schema_calib`, `migrate`) and unit-tested with synthetic data — `python -m
hdf5.test_hdf5` passes 36 checks (run with the `.venv` python; h5py only lives
there). Only `schema_sim` is validated on **real** data so far. See §8 for the
tested-vs-untested breakdown and what remains before the manuBeat port.
**Goal:** Define a single HDF5 layer for the simulation → population → NN-calibration
pipeline that is byte-for-byte compatible with the manuBeat web-app's
`hdf5_engine.py` conventions, so the eventual port into
`manuBeat/python/api/domains/medical/` is a copy-paste rather than a rewrite.

This repo is the staging ground: code lands here under manuBeat naming/conventions,
then moves into the manuBeat repo unchanged.

---

## 1. Source material

Three reference implementations were compared:

| File | Role | Reusable parts |
|---|---|---|
| `hdf5/HDF5API.py` (this repo, legacy) | ventilator I/O + streaming writers + plotting | streaming queue writers, compound writers |
| manuBeat `medical/hdf5_engine.py` | **generic engine + simulation-run schema** | the whole engine; `write/read_run_result`, `append_processed`, `repack`, `get_tree`, `get_dataset` |
| manuBeat `medical/cardio/hdf5_api.py` | cleaned twin of our legacy file | context-manager idioms only |
| SAX_ECG `hdf5/HDF5API.py` | **ML single-file run artifact** | dataclass bundles, blob storage, DataFrame↔group, registry, schema resolver |

**Key realization:** manuBeat's `write_run_result` already *is* our simulation-run
artifact, and SAX_ECG's `save_run`/`load_run` already *is* our calibration-result
artifact. The port is mostly renaming existing structures onto these two schemas,
plus adding a population schema in between.

---

## 2. Current (legacy) schema audit

Reconstructed from `codeArchive/run_batchSimulation.py`, `run_Twinanizer.py`,
`runCPET.py`, and `NeuralNetwork_Final.ipynb`.

### 2a. Population / base file (`NNtrain_Base.hdf5`, `Pop__*.hdf5`)
```
/ (root)
├─ modelStructure                 # JSON string, .replace('"',"'") hacked
├─ parameters                     # JSON string (simulationParams), hacked
├─ problem_startingParameters     # JSON string (SALib problem: names+bounds), hacked
├─ startingParameters   (N×P)     # float array, the sampled parameter sets
├─ finalStates          compound  # rows=runs, fields=state names  ← TRAINING TABLE
├─ data_processed/{var}           # attrs: units, prefix, name
└─ data/ or starting_parameters_{i}/{var}   # time series, gzip-9 + scaleoffset=5
```
Written via the streaming queue writers (`writeToFileAsDataAvailableGroups`),
with NaN / divergence guards replacing bad runs with `-99999.9`.

### 2b. NN training file (`NNTrain_240k_processed.hdf5`)
```
/ (root)
├─ finalStates            compound   # merged from many population files
├─ X_train / X_val / X_test  compound  # X = observations
├─ y_train / y_val / y_test  compound  # y = parameters  (inverse problem)
├─ x_scaler                  uint8 blob  # pickled sklearn scaler
└─ y_scaler                  uint8 blob  # pickled sklearn scaler
```
Build steps (NN notebook): merge `finalStates` → split columns into observations(X)
and params(y) → IQR outlier removal (`iqr_bounds`, k=3) → train/val/test split →
fit scalers → store. Training is `tf.keras`; calibration = predict params from
observations; comparison computes `error_rel` / `error_abs` vs Sepsis paper pop.

### 2c. Twinanizer single run
```
/ (root)
├─ data/{var}            # raw time series, gzip-9 + scaleoffset=5
├─ data_processed/{var}  # attrs: units, prefix, name
└─ states               # str(states) dataset
```

### Problems to fix in the port
- **`.replace('"',"'")` JSON hack** corrupts any JSON containing apostrophes.
- **Pickled scalers** are Python-only — a JS/web app cannot load them.
- **keras blob** is Python-only — web app needs a portable export.
- `scaleoffset=5` (lossy, ~5 decimals) applied indiscriminately, incl. ML arrays.
- Hand-rolled compound build/read loops (`writeArrayCompoundDataset`, `row.tolist()`).
- File handles leaked in legacy `readDataset`/`readFile` (no context managers).
- Space never reclaimed after population merges.

---

## 3. Target architecture

One generic engine + four schema helpers + payload/bundle readers.

```
hdf5/
├─ engine.py        # generic, lifted from manuBeat hdf5_engine.py
├─ schema_sim.py    # simulation run  (manuBeat write/read_run_result)
├─ schema_pop.py    # population
├─ schema_calib.py  # NN training set + calibration result (SAX_ECG save/load_run)
└─ bundles.py       # dataclasses (SAX_ECG style)
```

### 3a. Generic engine (`engine.py`) — port verbatim from manuBeat
- `get_tree(path)` / `_walk_node` — JSON-serializable hierarchy for the web UI.
- `get_dataset(path, dataset_path, start, end)` — typed, sliced, JSON-serializable.
- `get_attrs` / `write_attrs`.
- `write_dataset(path, dataset_path, data, dtype, compress)` — idempotent
  (delete-if-exists), size-aware compression.
- `write_string_dataset`, `create_group`, `delete_dataset`, `repack` (h5repack).
- `_to_python` — numpy/bytes/array → native.

Add two helpers SAX_ECG has and manuBeat lacks:
- `write_compound(f, path, df_or_dict, dtype)` — single compound writer.
- `read_group_as_df(f, group)` / `read_compound_as_df` — DataFrame round-trip.
- `write_blob(f, path, raw_bytes)` / `read_blob` — uint8 blob (models, *not* scalers).

### 3b. Simulation run (`schema_sim.py`) = manuBeat schema, unchanged
```
run.h5
├─ attrs: job_id, config_id, run_time, dt, return_frequency
├─ model_structure       # string dataset, real JSON (no quote hack)
├─ time                  (T,)
├─ state_names           vlen-str
├─ raw/{var}             (T,)  lossy gzip ok (bulky traces)
├─ final_states          compound (1 row)
└─ processed/{name}/{out}   # attrs: unit, prefix, name + proc provenance
```
`write_run_result`, `read_run_result` (web payload), `append_processed` —
copy from manuBeat. **This is the unit the web app already understands.**

### 3c. Population (`schema_pop.py`) — new, bridges manuBeat conventions
```
population.h5
├─ attrs: conf(json), meta(json), problem(json)   # SALib bounds; json.dumps direct
├─ model_structure          # string dataset, real JSON
├─ param_names              vlen-str
├─ state_names              vlen-str
├─ observation_names        vlen-str
├─ sampled_params  (N×P)    # lossless gzip-4  (was startingParameters)
├─ final_states    compound # the training table  (was finalStates)
├─ processed/{name}/...     # manuBeat append_processed schema
└─ runs/{id}/raw/{var}      # OPTIONAL kept traces (manuBeat raw/ schema)
```
- `init_population(path, problem, model_structure, conf)`
- streaming writer reused from legacy (`writeToFileAsDataAvailableGroups`) but
  writing into `runs/{id}/raw/` and accumulating `final_states`.
- `merge_populations(out_path, in_paths)` — concat `final_states`, then `repack`.
- `read_population(path)` → `PopulationBundle`.

### 3d. NN training + calibration (`schema_calib.py`) = SAX_ECG schema
```
calibration_run.h5
├─ attrs: conf(json), meta(json)
├─ observation_names, param_names   vlen-str
├─ splits/{X,y}_{train,val,test}    compound   # lossless
├─ scalers/x/{mean, scale}          arrays      # NOT pickle — see §4
├─ scalers/y/{mean, scale}          arrays
├─ predictions/{y_raw, y_pred, y_true, error_rel, error_abs}
├─ training/epoch_metrics/{col}     # DataFrame↔group
├─ bootstrap/{col}                  # DataFrame↔group
├─ model/best                       blob (.keras, Python-only)
└─ model/web                        # OPTIONAL portable export (tf.js/ONNX) — see §4
```
- `build_training_set(...)` — IQR filter (`iqr_bounds`), split, fit scalers, write.
- `save_calibration_run(...)` / `load_calibration_run(...)` (SAX_ECG `save/load_run`).
- `load_keras_from_run(...)` (SAX_ECG, temp-file round-trip).

---

## 4. Web-app portability rules

Anything stored only for Python breaks the eventual JS/web port. Rules:

1. **Config/provenance** → JSON via `json.dumps` (no quote hack). Web reads with
   `JSON.parse`.
2. **Scalers** → store `mean_` / `scale_` as plain float arrays, never pickle.
   Browser normalizes with `(x - mean) / scale`. (Keep a Python convenience that
   rebuilds an sklearn scaler from these arrays if needed.)
3. **Model** → keep `.keras` blob for the Python side, but add a `model/web`
   slot for a portable export (TensorFlow.js or ONNX) the browser can run.
   Flag: web inference is blocked until this export exists.
4. **Compression** → lossless `gzip` level 4 (no `scaleoffset`) for all ML arrays
   (`sampled_params`, `splits`, `predictions`, scaler params). Lossy
   `scaleoffset=5` only for bulky `raw/` time-series traces.
5. **Strings** → `asstr()` on read; vlen UTF-8 on write. No manual decode loops.

---

## 5. Old → new mapping

| Legacy | New | Notes |
|---|---|---|
| `modelStructure` (hacked JSON str) | `model_structure` string dataset | real JSON |
| `parameters` (hacked JSON str) | `attrs['conf']` | `json.dumps` |
| `problem_startingParameters` | `attrs['problem']` | SALib bounds |
| `startingParameters` (N×P) | `sampled_params` | lossless gzip-4 |
| `finalStates` compound | `final_states` compound | unchanged shape |
| `data_processed/{v}` + attrs | `processed/{name}/{v}` + attrs | manuBeat schema |
| `data/{v}` traces | `runs/{id}/raw/{v}` | manuBeat raw/ |
| `X_*`/`y_*` compound | `splits/{X,y}_*` | unchanged shape |
| `x_scaler`/`y_scaler` pickle blob | `scalers/{x,y}/{mean,scale}` arrays | portable |
| (keras saved separately) | `model/best` blob + `model/web` export | |
| `states` = `str(states)` | `final_states` compound | drop `str()` form |

---

## 6. Phased implementation plan

1. **Engine** ✅ built — manuBeat `hdf5_engine.py` → `hdf5/engine.py` + compound /
   DataFrame / blob helpers; unit-tested.
2. **Sim schema** ✅ built & wired — `write/read_run_result` + `append_processed`
   (+ `append_config`/`read_config` for the self-contained run recipe); payload
   shape mirrors `libraryV2_1.postproc.resultsEngine.toPayload()`. CPET_Run.ipynb
   writes this format.
3. **Population schema** ✅ built — `schema_pop.py` (`init_population`, `add_run`
   into `runs/{id}/raw/` + `final_states`, `merge_populations`, `repack`).
   ⚠ untested on real population data (runner not rewired — see §8).
4. **Calib schema** ✅ built — `schema_calib.py` (`build_training_set` with IQR +
   split + array scalers, `save/load_calibration_run`, `make_scaler`/`apply_scaler`).
   ⚠ untested on real training data (NN notebook not rewired — see §8).
5. **Migration shim** ✅ built — `migrate.py` (`read_legacy_population`,
   `migrate_population`, `read_legacy_training`, `migrate_training`).
   ⚠ only tested against synthetic legacy files, not real `Pop__*.hdf5` /
   `NNTrain_*.hdf5` (see §8).
6. **Web export** ❌ stub — `schema_calib.export_model_for_web` raises
   `NotImplementedError` (tf.js vs ONNX undecided). Web app round-trip of
   `get_tree` / `get_dataset` / `read_run_result` not yet confirmed against manuBeat.

---

## 7. Open questions

- Keep full `runs/{id}/raw/` traces in population files, or only `final_states`?
  (120k models × full traces is large; legacy kept traces only for small runs.)
- Single self-contained artifact per calibration run (SAX_ECG style) vs separate
  population / training / result files? Recommend: population.h5 separate (huge,
  shared), calibration_run.h5 self-contained per NN run.
- Web model format: TensorFlow.js vs ONNX — depends on the web-app's runtime.

---

## 8. Tested vs. still to test

**Tested**
- `engine`, `schema_sim`, `schema_pop`, `schema_calib`, `migrate` — all pass the
  synthetic unit suite `python -m hdf5.test_hdf5` (36 checks; needs `.venv` python).
- `schema_sim` end-to-end on a **real** run: CPET_Run.ipynb executed headless writes
  `write_run_result` + `append_processed` + `append_config`; `engine.get_tree`
  validated against real `data/results_CPET`.

**Built but NOT yet tested on real data**
- `schema_pop` — never fed a real SALib-sampled population. Blocked on rewiring the
  population runner (`codeArchive/run_batchSimulation.py` / `run_Twinanizer.py`) to
  `init_population` + `add_run` + `merge_populations`. Need to confirm: streaming
  writer fills `runs/{id}/raw/` + `final_states` correctly at scale, NaN/divergence
  guard still replaces bad runs, and `merge_populations` + `repack` reclaim space.
- `schema_calib` — `build_training_set` / `save_calibration_run` only seen synthetic
  arrays. Blocked on rewiring the NN notebook (`NeuralNetwork_Final.ipynb`). Need to
  confirm: IQR filter + split sizes match the legacy pipeline, and array scalers give
  the same normalization as the old pickled sklearn scalers.
- `migrate` — only round-trips synthetic legacy files the test constructs. Need to run
  `migrate_population` / `migrate_training` against the **actual archived**
  `Pop__*.hdf5` / `NNTrain_*.hdf5` (un-hack JSON, unpickle old scalers once) and
  diff the re-emitted `final_states` / splits against the originals.

**Not built**
- `model/web` portable export (tf.js / ONNX) — `export_model_for_web` is a stub;
  browser inference is blocked until this exists and a format is chosen.
- `initialiseModel`-from-`/config` variant that mounts a run from the embedded
  `/config` group instead of disk paths — needed to truly "run from file alone".
- manuBeat round-trip: confirm the web app reads `get_tree` / `get_dataset` /
  `read_run_result` unchanged once the modules move into
  `manuBeat/python/api/domains/medical/`.
