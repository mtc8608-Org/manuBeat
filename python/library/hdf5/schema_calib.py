"""
NN training-set + calibration-run artifact (self-contained per NN run).

calibration_run.h5
├─ attrs: conf(json), meta(json)
├─ observation_names, param_names                 # vlen-str
├─ splits/{X,y}_{train,val,test}     compound      # lossless
├─ scalers/x/{mean,scale}, scalers/y/{mean,scale}  # arrays, NOT pickle
├─ predictions/{y_raw,y_pred,y_true,error_rel,error_abs}
├─ training/epoch_metrics/{col}, bootstrap/{col}   # DataFrame <-> group
├─ model/best     blob (.keras bytes, Python-only)
└─ model/web      portable export (deferred)

Calibration is the inverse problem: X = observations, y = parameters. The model
predicts parameters from observed quantities. Scalers are stored as mean/scale
arrays so the browser can normalize without unpickling.
"""
from __future__ import annotations

import json
import os
import tempfile

import h5py as h5
import numpy as np

from . import engine
from .bundles import CalibrationBundle


# ── Outlier filtering (ported from NeuralNetwork_Final.ipynb cell 11) ────────────

def iqr_bounds(arr: np.ndarray, k: float = 3.0):
    q1 = np.percentile(arr, 25, axis=0)
    q3 = np.percentile(arr, 75, axis=0)
    iqr = q3 - q1
    return q1 - k * iqr, q3 + k * iqr


def in_bounds(X: np.ndarray, lo, hi) -> np.ndarray:
    return np.all((X >= lo) & (X <= hi), axis=1)


# ── Scalers as arrays (no pickle) ────────────────────────────────────────────────

def _fit_scaler(arr: np.ndarray) -> dict:
    """Standard-scaler params as plain arrays; scale guarded against zero."""
    mean = arr.mean(axis=0)
    scale = arr.std(axis=0)
    scale[scale == 0] = 1.0
    return {'mean': mean, 'scale': scale}


def apply_scaler(scaler: dict, arr: np.ndarray) -> np.ndarray:
    return (arr - scaler['mean']) / scaler['scale']


def inverse_scaler(scaler: dict, arr: np.ndarray) -> np.ndarray:
    return arr * scaler['scale'] + scaler['mean']


def make_scaler(scaler: dict):
    """Rebuild an sklearn StandardScaler from stored mean/scale arrays."""
    from sklearn.preprocessing import StandardScaler
    s = StandardScaler()
    s.mean_ = np.asarray(scaler['mean'])
    s.scale_ = np.asarray(scaler['scale'])
    s.var_ = s.scale_ ** 2
    s.n_features_in_ = s.mean_.shape[0]
    return s


# ── Build a training set from a population ───────────────────────────────────────

def build_training_set(final_states_array: np.ndarray, state_names: list, *,
                       observation_keys: list, param_keys: list,
                       val_frac: float = 0.15, test_frac: float = 0.15,
                       iqr_k: float = 3.0, seed: int = 0) -> dict:
    """Split a population's final-states table into scaled NN train/val/test sets.

    X = observation columns, y = parameter columns. Rows outside the IQR bounds
    (computed on the full feature matrix) are dropped before splitting.
    Returns a dict consumable by ``save_calibration_run``.
    """
    idx = {n: i for i, n in enumerate(state_names)}
    missing = [k for k in observation_keys + param_keys if k not in idx]
    if missing:
        raise KeyError(f'final_states is missing columns: {missing}')

    X = final_states_array[:, [idx[k] for k in observation_keys]].astype(np.float32)
    y = final_states_array[:, [idx[k] for k in param_keys]].astype(np.float32)

    lo, hi = iqr_bounds(np.hstack([X, y]), k=iqr_k)
    keep = in_bounds(np.hstack([X, y]), lo, hi)
    X, y = X[keep], y[keep]

    rng = np.random.default_rng(seed)
    perm = rng.permutation(len(X))
    n_test = int(len(X) * test_frac)
    n_val = int(len(X) * val_frac)
    test_i, val_i, train_i = perm[:n_test], perm[n_test:n_test + n_val], perm[n_test + n_val:]

    splits = {
        'X_train': X[train_i], 'X_val': X[val_i], 'X_test': X[test_i],
        'y_train': y[train_i], 'y_val': y[val_i], 'y_test': y[test_i],
    }
    scalers = {'x': _fit_scaler(splits['X_train']), 'y': _fit_scaler(splits['y_train'])}
    return {
        'observation_names': list(observation_keys),
        'param_names':       list(param_keys),
        'splits':            splits,
        'scalers':           scalers,
    }


# ── Save / load ──────────────────────────────────────────────────────────────────

def save_calibration_run(path: str, *, observation_names: list, param_names: list,
                         splits: dict, scalers: dict,
                         predictions: dict | None = None,
                         training_log=None, bootstrap=None,
                         model_bytes: bytes | None = None,
                         conf: dict | None = None, meta: dict | None = None) -> None:
    """Write a self-contained calibration run."""
    with h5.File(path, 'w') as f:
        f.attrs['conf'] = json.dumps(conf or {})
        f.attrs['meta'] = json.dumps(meta or {})
        engine.write_str_array(f, 'observation_names', list(observation_names))
        engine.write_str_array(f, 'param_names', list(param_names))

        f.create_group('splits')
        for key, arr in splits.items():
            names = observation_names if key.startswith('X') else param_names
            cols = {n: np.asarray(arr)[:, j] for j, n in enumerate(names)}
            engine.write_compound(f, f'splits/{key}', cols)

        for axis in ('x', 'y'):
            engine._write_dataset(f, f'scalers/{axis}/mean', np.asarray(scalers[axis]['mean']))
            engine._write_dataset(f, f'scalers/{axis}/scale', np.asarray(scalers[axis]['scale']))

        if predictions:
            f.create_group('predictions')
            for key, arr in predictions.items():
                engine._write_dataset(f, f'predictions/{key}', np.asarray(arr))

        if training_log is not None:
            engine.write_df(f, 'training/epoch_metrics', training_log)
        if bootstrap is not None:
            engine.write_df(f, 'bootstrap', bootstrap)

        if model_bytes is not None:
            engine.write_blob(f, 'model/best', model_bytes)


def load_calibration_run(path: str) -> CalibrationBundle:
    with h5.File(path, 'r') as f:
        obs_names = list(f['observation_names'].asstr()[:])
        par_names = list(f['param_names'].asstr()[:])

        splits = {}
        if 'splits' in f:
            for key in f['splits']:
                arr, _ = engine.compound_to_array(f, f'splits/{key}')
                splits[key] = arr.astype(np.float32)

        scalers = {}
        if 'scalers' in f:
            for axis in f['scalers']:
                scalers[axis] = {'mean': f[f'scalers/{axis}/mean'][()],
                                 'scale': f[f'scalers/{axis}/scale'][()]}

        predictions = {k: f['predictions'][k][()] for k in f['predictions']} \
            if 'predictions' in f else {}

        training_log = engine.read_group_as_df(f, 'training/epoch_metrics') \
            if 'training/epoch_metrics' in f else None
        bootstrap = engine.read_group_as_df(f, 'bootstrap') if 'bootstrap' in f else None

        conf = json.loads(f.attrs.get('conf', '{}'))
        meta = json.loads(f.attrs.get('meta', '{}'))

    return CalibrationBundle(
        observation_names=obs_names, param_names=par_names, splits=splits,
        scalers=scalers, predictions=predictions, training_log=training_log,
        bootstrap=bootstrap, conf=conf, meta=meta, run_path=path)


def load_keras_from_run(path: str, which: str = 'best'):
    """Load a Keras model stored as bytes inside a calibration run."""
    import tensorflow as tf
    with h5.File(path, 'r') as f:
        key = f'model/{which}'
        if key not in f:
            raise KeyError(f"No model stored under '{key}' in {path}")
        model_bytes = engine.read_blob(f, key)
    with tempfile.NamedTemporaryFile(suffix='.keras', delete=False) as tmp:
        tmp.write(model_bytes)
        tmp_path = tmp.name
    try:
        return tf.keras.models.load_model(tmp_path)
    finally:
        os.unlink(tmp_path)


def export_model_for_web(path: str, fmt: str = 'tfjs'):   # pragma: no cover
    """Export the stored model to a browser-runnable format (tf.js / ONNX).

    Deferred: depends on the web-app runtime. Leaves the model/web slot for the
    portable export once the target format is chosen.
    """
    raise NotImplementedError(
        'web model export (tfjs/onnx) is deferred until the web-app runtime is chosen')
