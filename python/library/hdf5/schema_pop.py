"""
Population artifact: many simulation runs sharing one model + parameter sweep.

population.h5
├─ attrs: conf(json), meta(json), problem(json)   # SALib bounds
├─ model_structure              # JSON string dataset
├─ param_names, state_names, observation_names    # vlen-str
├─ sampled_params  (N×P)        # lossless  (was startingParameters)
├─ final_states    compound     # resizable, one row per run = NN training table
├─ run_ids         vlen-str     # one id per final_states row
├─ timings         (N,) float64 # per-run wall seconds (NaN for a skipped run)
├─ attrs: timing(json)          # timing aggregate + context (device/solver/total)
├─ processed/{name}/...
└─ runs/{id}/raw/{var}          # FULL per-run traces (lossy compression)

The population is written incrementally: ``init_population`` lays down the static
parts, then ``add_run`` is called once per completed simulation (the streaming
queue consumer drives this). ``merge_populations`` concatenates many files.
"""
from __future__ import annotations

import json

import h5py as h5
import numpy as np

from . import engine
from .bundles import PopulationBundle

# Sentinel value written for runs that produced NaN / diverging output.
BAD_RUN_SENTINEL = -99999.9


# ── Write ────────────────────────────────────────────────────────────────────────

def init_population(path: str, *, param_names: list, state_names: list,
                    observation_names: list, sampled_params,
                    model_structure: dict | str,
                    problem: dict | None = None,
                    conf: dict | None = None, meta: dict | None = None) -> None:
    """Create a fresh population file with all static datasets in place."""
    ms = model_structure if isinstance(model_structure, str) else json.dumps(model_structure)
    with h5.File(path, 'w') as f:
        f.attrs['conf']    = json.dumps(conf or {})
        f.attrs['meta']    = json.dumps(meta or {})
        f.attrs['problem'] = json.dumps(problem or {})

        engine._write_string_dataset(f, 'model_structure', ms)
        engine.write_str_array(f, 'param_names', list(param_names))
        engine.write_str_array(f, 'state_names', list(state_names))
        engine.write_str_array(f, 'observation_names', list(observation_names))
        engine._write_dataset(f, 'sampled_params', np.asarray(sampled_params, dtype='float64'))

        # resizable compound: one row per completed run
        dt = engine.type_converter({k: 'float' for k in state_names})
        f.create_dataset('final_states', shape=(0,), maxshape=(None,),
                         dtype=dt, chunks=True)
        engine.write_str_array(f, 'run_ids', [])
        f.create_group('runs')
        f.create_group('processed')


def _sanitize(raw: dict) -> dict:
    """Replace a run's signals with the sentinel if any signal is NaN/diverging."""
    for v in raw.values():
        a = np.asarray(v)
        if a.size and (np.isnan(a).any() or abs(float(a.flat[-1])) > 1e20):
            return {k: np.full(len(np.asarray(val)), BAD_RUN_SENTINEL)
                    for k, val in raw.items()}
    return raw


def good_run_mask(obs_matrix, divergence_limit: float = 1e6, param_matrix=None) -> np.ndarray:
    """Boolean per-run mask: True = usable run (not sentinel-marked, not NaN, not diverged).

    The single source of truth for dropping bad runs at load/analysis time — it unifies
    the serial good-mask and the batch ``finiteRow`` divergence mask. ``obs_matrix`` is
    ``(N, nObs)``. Bad runs were already stamped with :data:`BAD_RUN_SENTINEL` at save time
    (see :func:`_sanitize`); this additionally catches raw NaN/Inf lanes (the batched
    streamed tensor keeps them, by design) and blow-ups above ``divergence_limit``.

    When ``param_matrix`` ``(N, nParam)`` is given (the run-end calibrated-parameter values),
    the same ``divergence_limit`` and NaN checks apply to it too: a run whose observations *or*
    parameters leave scope is dropped. Used to gate on out-of-scope calibrated params, which a
    pure observation check misses when a param blows up but its observation stays finite.

    Criteria are *broken only*: a clean run that merely missed its error target is kept.
    """
    obs = np.asarray(obs_matrix)
    not_sentinel = ~np.any(obs <= BAD_RUN_SENTINEL + 1.0, axis=1)
    not_nan      = ~np.any(np.isnan(obs), axis=1)
    not_diverged = np.all(np.abs(obs) < divergence_limit, axis=1)
    mask = not_sentinel & not_nan & not_diverged
    if param_matrix is not None:
        par = np.asarray(param_matrix)
        par_ok = ~np.any(np.isnan(par), axis=1) & np.all(np.abs(par) < divergence_limit, axis=1)
        mask &= par_ok
    return mask


def add_run(path: str, run_id: str, raw: dict, final_state) -> None:
    """Append one completed run: full traces under runs/{id}/raw/ + a final_states row.

    ``final_state`` may be a dict {state: value} or a sequence aligned with the
    file's stored state_names.
    """
    raw = _sanitize(raw)
    with h5.File(path, 'a') as f:
        state_names = list(f['state_names'].asstr()[:])
        grp = f.require_group(f'runs/{run_id}/raw')
        for name, arr in raw.items():
            if name in grp:
                del grp[name]
            engine._write_dataset(grp, name, np.asarray(arr, dtype='float64'), lossy=True)

        if isinstance(final_state, dict):
            row_vals = [float(final_state.get(s, BAD_RUN_SENTINEL)) for s in state_names]
        else:
            row_vals = [float(v) for v in final_state]

        fs = f['final_states']
        n = fs.shape[0]
        fs.resize((n + 1,))
        fs[n] = tuple(row_vals)

        engine.write_str_array(f, 'run_ids',
                               list(f['run_ids'].asstr()[:]) + [str(run_id)])


def write_final_states(path: str, final_states, run_ids) -> None:
    """Write the whole final_states table + run_ids in one shot, WITHOUT creating any
    runs/{id} groups.

    For the streaming batched path, the full per-run traces live in the top-level `raw`
    (N, T, C) tensor (see hdf5.raw_stream), so there is no per-run raw group to populate —
    using add_run(raw={}) here would only leave misleading empty runs/{id}/raw groups.

    ``final_states`` is a sequence of dicts {state: value} or rows aligned with the file's
    stored state_names.
    """
    with h5.File(path, 'a') as f:
        state_names = list(f['state_names'].asstr()[:])
        rows = []
        for st in final_states:
            if isinstance(st, dict):
                rows.append(tuple(float(st.get(s, BAD_RUN_SENTINEL)) for s in state_names))
            else:
                rows.append(tuple(float(v) for v in st))
        fs = f['final_states']
        fs.resize((len(rows),))
        if rows:
            fs[:] = rows
        engine.write_str_array(f, 'run_ids', [str(r) for r in run_ids])


def write_timings(path: str, per_run_wall, *, meta: dict | None = None) -> None:
    """Persist per-run wall-clock timings into an existing population file.

    ``per_run_wall`` is a length-N sequence of seconds (NaN for a run that was
    skipped / not timed). ``meta`` is a small context dict (device, precision,
    solver, dt, runTime, nrModels, stack, total_wall) stored as the ``timing``
    root attr. Read back with :func:`read_timings`.
    """
    with h5.File(path, 'a') as f:
        engine._write_dataset(f, 'timings', np.asarray(per_run_wall, dtype='float64'))
        f.attrs['timing'] = json.dumps(meta or {})


# numeric columns of the progress table (order = dataset column order). Kept in sync with
# library.run.progress.ProgressReporter.FIELDS; hard-coded here so the schema has no run-module
# import dependency.
PROGRESS_COLUMNS = ("done", "total", "elapsedWall", "eta", "acc", "meanRel", "maxRel", "bestRel")


def write_progress(path: str, records, *, meta: dict | None = None) -> None:
    """Persist a run's live-progress trace (the convergence lines it printed) into its file.

    ``records`` is the list of dicts collected by library.run.progress.ProgressReporter — each a
    tick with numeric fields (PROGRESS_COLUMNS) plus ``kind``/``label`` strings. Stored under a
    ``progress`` group: a (nRecords, nCols) ``values`` table (columns attr = PROGRESS_COLUMNS),
    ``labels``/``kinds`` string arrays, and the full records as a JSON attr for fidelity. ``meta``
    is a small context dict (model, scenario, mode, solver, nrModels, timestamp) stored as the
    group ``meta`` attr. Read back with :func:`read_progress`. No-op if ``records`` is empty.
    """
    records = list(records or [])
    if not records:
        return
    values = np.array([[float(r.get(c, np.nan)) for c in PROGRESS_COLUMNS] for r in records],
                      dtype='float64')
    with h5.File(path, 'a') as f:
        if 'progress' in f:
            del f['progress']
        grp = f.create_group('progress')
        engine._write_dataset(grp, 'values', values)
        engine.write_str_array(grp, 'labels', [str(r.get('label', '')) for r in records])
        engine.write_str_array(grp, 'kinds', [str(r.get('kind', '')) for r in records])
        grp.attrs['columns'] = json.dumps(list(PROGRESS_COLUMNS))
        grp.attrs['meta'] = json.dumps(meta or {})
        grp.attrs['records'] = json.dumps(records)


# ── Read ─────────────────────────────────────────────────────────────────────────

def read_progress(path: str) -> tuple[np.ndarray, list, dict]:
    """(values, columns, meta) written by :func:`write_progress`.

    ``values`` is (nRecords, nCols); ``columns`` names them; ``meta`` is the context dict.
    Returns an empty array / ``[]`` / ``{}`` if the file has no progress trace.
    """
    with h5.File(path, 'r') as f:
        if 'progress' not in f:
            return np.empty((0, 0)), [], {}
        grp = f['progress']
        values = grp['values'][()] if 'values' in grp else np.empty((0, 0))
        columns = json.loads(grp.attrs['columns']) if 'columns' in grp.attrs else list(PROGRESS_COLUMNS)
        meta = json.loads(grp.attrs['meta']) if 'meta' in grp.attrs else {}
    return np.asarray(values, dtype='float64'), columns, meta


def read_timings(path: str) -> tuple[np.ndarray, dict]:
    """(per_run_wall, meta) written by :func:`write_timings`.

    Returns an empty array / ``{}`` if the file predates timing capture.
    """
    with h5.File(path, 'r') as f:
        wall = f['timings'][()] if 'timings' in f else np.array([], dtype='float64')
        meta = json.loads(f.attrs['timing']) if 'timing' in f.attrs else {}
    return np.asarray(wall, dtype='float64'), meta


def raw_signals(path: str) -> tuple[list, np.ndarray]:
    """(signal_names, time axis) of the streamed top-level `raw` tensor."""
    with h5.File(path, 'r') as f:
        return list(f['raw_signal_names'].asstr()[:]), f['raw_time'][:]


def raw_trace(path: str, run, signal: str) -> tuple[np.ndarray, np.ndarray]:
    """(time, values) for one run + one signal, sliced from the `raw` (N, T, C) tensor."""
    with h5.File(path, 'r') as f:
        names = list(f['raw_signal_names'].asstr()[:])
        return f['raw_time'][:], f['raw'][int(run), :, names.index(signal)]


def build_raw_coarse(path: str, *, nDense: int | None = None, rowBatch: int = 8) -> None:
    """One-time: build the small `raw_coarse` (N, nRuns, C) companion from an existing `raw`
    tensor that was written without one (one converged value per saved run = the run-end row).

    Reads `raw` once in row batches — slow on a big compressed tensor, but only once; afterwards
    the per-run convergence plot reads `raw_coarse` instantly instead of decompressing `raw`.
    nDense (points per saved run) is taken from the run conf if not given."""
    with h5.File(path, 'a') as f:
        N, T, C = f['raw'].shape
        if nDense is None:
            nDense = int(f['raw'].attrs.get('nDense', 0)) or None
        if not nDense:
            raise ValueError(
                "nDense (points per saved run = runTime/dtDense) not stored on `raw`; "
                "pass nDense= explicitly for this older file.")
        nDense = int(nDense)
        nRuns = T // nDense
        if 'raw_coarse' in f:
            del f['raw_coarse']
        coarse = f.create_dataset('raw_coarse', shape=(N, nRuns, C), dtype=f['raw'].dtype)
        end = np.arange(1, nRuns + 1) * nDense - 1          # run-end indices on the time axis
        for s in range(0, N, rowBatch):
            e = min(s + rowBatch, N)
            coarse[s:e] = f['raw'][s:e, :, :][:, end, :]     # decompress batch once, take ends
        if 'raw_time' in f:
            if 'raw_coarse_time' in f:
                del f['raw_coarse_time']
            f.create_dataset('raw_coarse_time', data=f['raw_time'][:][end])



def read_population(path: str) -> PopulationBundle:
    with h5.File(path, 'r') as f:
        param_names = list(f['param_names'].asstr()[:])
        state_names = list(f['state_names'].asstr()[:])
        obs_names   = list(f['observation_names'].asstr()[:])
        sampled     = f['sampled_params'][()]
        final       = engine.read_compound(f, 'final_states')
        run_ids     = list(f['run_ids'].asstr()[:]) if 'run_ids' in f else []
        conf    = json.loads(f.attrs.get('conf', '{}'))
        meta    = json.loads(f.attrs.get('meta', '{}'))
        problem = json.loads(f.attrs.get('problem', '{}'))
        ms = (json.loads(f['model_structure'][()].decode('utf-8'))
              if 'model_structure' in f else None)
    return PopulationBundle(
        param_names=param_names, state_names=state_names, observation_names=obs_names,
        sampled_params=sampled, final_states=final, conf=conf, meta=meta,
        problem=problem, model_structure=ms, run_ids=run_ids)


def final_states_array(path: str) -> tuple[np.ndarray, list]:
    """Dense ``(N, S)`` array of final states + the state-name order."""
    with h5.File(path, 'r') as f:
        return engine.compound_to_array(f, 'final_states')


# ── Merge ────────────────────────────────────────────────────────────────────────

def merge_populations(out_path: str, in_paths: list, *, repack: bool = True) -> None:
    """Concatenate several population files into one (final_states + runs/), repack.

    The first input seeds the static datasets (names, model_structure, attrs).
    sampled_params are concatenated in input order; run ids are re-namespaced by
    source index to avoid collisions.
    """
    if not in_paths:
        raise ValueError('merge_populations needs at least one input file')

    base = read_population(in_paths[0])
    sampled = [np.asarray(base.sampled_params)]
    for p in in_paths[1:]:
        sampled.append(np.asarray(read_population(p).sampled_params))

    init_population(
        out_path,
        param_names=base.param_names, state_names=base.state_names,
        observation_names=base.observation_names,
        sampled_params=np.vstack(sampled),
        model_structure=base.model_structure or {},
        problem=base.problem, conf=base.conf, meta=base.meta)

    with h5.File(out_path, 'a') as out:
        out_fs = out['final_states']
        out_runs = out['runs']
        ids: list = []
        for src_idx, p in enumerate(in_paths):
            with h5.File(p, 'r') as src:
                src_fs = src['final_states'][()]
                n0 = out_fs.shape[0]
                out_fs.resize((n0 + src_fs.shape[0],))
                out_fs[n0:] = src_fs
                if 'runs' in src:
                    for rid in src['runs']:
                        new_id = f's{src_idx}_{rid}'
                        src.copy(src[f'runs/{rid}'], out_runs, name=new_id)
                        ids.append(new_id)
        engine.write_str_array(out, 'run_ids', ids)

    if repack:
        try:
            engine.repack(out_path)
        except Exception:
            pass   # repack is best-effort; file is already valid
