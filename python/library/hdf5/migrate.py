"""
Readers for the legacy HDF5 layout so existing data files don't need regenerating.

Legacy population (Pop__*.hdf5 / NNtrain_*.hdf5):
    modelStructure, parameters, problem_startingParameters  -> JSON strings stored
        with the ``.replace('"', "'")`` hack (un-hacked here with the reverse)
    startingParameters  (N×P)        -> sampled_params
    finalStates         compound     -> the training table
    data_processed/{v}  + attrs

Legacy NN training (NNTrain_*_processed.hdf5):
    X_train/X_val/X_test, y_train/y_val/y_test  compound
    x_scaler / y_scaler  -> PICKLED sklearn scalers (uint8 blobs)

The migrate_* helpers re-emit the new schema (scalers as arrays, real JSON).
"""
from __future__ import annotations

import json
import pickle

import h5py as h5
import numpy as np

from . import engine, schema_calib, schema_pop
from .bundles import PopulationBundle


def _unhack_json(raw: bytes | str) -> dict:
    """Reverse the legacy ``.replace('"', "'")`` JSON serialization."""
    s = raw.decode('utf-8') if isinstance(raw, (bytes, bytearray)) else str(raw)
    return json.loads(s.replace("'", '"'))


# ── Population ───────────────────────────────────────────────────────────────────

def read_legacy_population(path: str) -> PopulationBundle:
    with h5.File(path, 'r') as f:
        fs_arr, state_names = engine.compound_to_array(f, 'finalStates')
        final = {n: fs_arr[:, j] for j, n in enumerate(state_names)}

        sampled = f['startingParameters'][()] if 'startingParameters' in f \
            else np.empty((fs_arr.shape[0], 0))

        problem = _unhack_json(f['problem_startingParameters'][()]) \
            if 'problem_startingParameters' in f else {}
        conf = _unhack_json(f['parameters'][()]) if 'parameters' in f else {}
        ms = _unhack_json(f['modelStructure'][()]) if 'modelStructure' in f else None

        param_names = list(problem.get('names', []))
    return PopulationBundle(
        param_names=param_names, state_names=state_names, observation_names=[],
        sampled_params=sampled, final_states=final, conf=conf, meta={},
        problem=problem, model_structure=ms)


def migrate_population(in_path: str, out_path: str) -> None:
    """Read a legacy population file and re-emit it in the new schema.

    Note: legacy files do not store observation_names (they were derived from the
    run config), so that list is left empty; set it later if needed for training.
    """
    b = read_legacy_population(in_path)
    schema_pop.init_population(
        out_path,
        param_names=b.param_names, state_names=b.state_names,
        observation_names=b.observation_names,
        sampled_params=b.sampled_params,
        model_structure=b.model_structure or {},
        problem=b.problem, conf=b.conf, meta=b.meta)
    # Re-emit final_states rows (legacy kept no per-run traces in this view).
    n = next(iter(b.final_states.values())).shape[0] if b.final_states else 0
    with h5.File(out_path, 'a') as f:
        fs = f['final_states']
        fs.resize((n,))
        for i in range(n):
            fs[i] = tuple(float(b.final_states[s][i]) for s in b.state_names)
        engine.write_str_array(f, 'run_ids', [str(i) for i in range(n)])


# ── NN training set ──────────────────────────────────────────────────────────────

def _scaler_to_arrays(blob: bytes) -> dict:
    """Unpickle a legacy sklearn scaler and extract mean/scale arrays."""
    s = pickle.loads(blob)
    if hasattr(s, 'mean_') and hasattr(s, 'scale_'):
        return {'mean': np.asarray(s.mean_), 'scale': np.asarray(s.scale_)}
    # MinMax-style fallback: x' = x*scale_ + min_  ->  store as affine params
    if hasattr(s, 'scale_') and hasattr(s, 'min_'):
        return {'mean': -np.asarray(s.min_) / np.asarray(s.scale_),
                'scale': 1.0 / np.asarray(s.scale_)}
    raise TypeError(f'unsupported legacy scaler type: {type(s)}')


def read_legacy_training(path: str) -> dict:
    """Read legacy NN training file into the dict shape build_training_set emits."""
    with h5.File(path, 'r') as f:
        splits = {}
        names_X, names_y = [], []
        for key in ('X_train', 'X_val', 'X_test', 'y_train', 'y_val', 'y_test'):
            if key not in f:
                continue
            arr, names = engine.compound_to_array(f, key)
            splits[key] = arr.astype(np.float32)
            if key == 'X_train':
                names_X = names
            elif key == 'y_train':
                names_y = names

        scalers = {}
        if 'x_scaler' in f:
            scalers['x'] = _scaler_to_arrays(engine.read_blob(f, 'x_scaler'))
        if 'y_scaler' in f:
            scalers['y'] = _scaler_to_arrays(engine.read_blob(f, 'y_scaler'))

    return {'observation_names': names_X, 'param_names': names_y,
            'splits': splits, 'scalers': scalers}


def migrate_training(in_path: str, out_path: str) -> None:
    """Read a legacy NN training file and re-emit it as a calibration run."""
    data = read_legacy_training(in_path)
    schema_calib.save_calibration_run(out_path, **data)
