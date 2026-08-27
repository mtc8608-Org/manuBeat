"""
Simulation-run artifact (manuBeat ``write_run_result`` schema).

run.h5
├─ attrs: job_id, config_id, run_time, dt, return_frequency
├─ model_structure          # JSON string dataset (real JSON, no quote hack)
│                             # = the MUTATED runtime structure that actually ran
│                             #   (incl. calibrated params): a snapshot of the run.
├─ time            (T,)
├─ state_names     vlen-str
├─ raw/{var}       (T,)      # bulky traces -> lossy compression ok
├─ final_states    compound  # 1 row
├─ processed/{name}/{out}    # attrs: unit, prefix, name + proc provenance
└─ config/                   # ADDITIVE: the SOURCE configs to re-mount from scratch
   ├─ attrs: mode, run_config(json)
   └─ {model,scenario,metadata,post_processing}  # real-JSON string datasets

``read_run_result`` returns a payload whose keys mirror
``ResultsEngine.toPayload()`` so the web app consumes one consistent shape.
"""
from __future__ import annotations

import json

import h5py as h5
import numpy as np

from . import engine
from .bundles import RunBundle


def _attr_safe(val):
    """Coerce a metadata value into something writable as an HDF5 attribute."""
    if val is None:
        return ''
    if isinstance(val, (str, bool, int, float, np.generic)):
        return val
    if isinstance(val, (list, tuple)) and all(
            isinstance(v, (str, bool, int, float, np.generic)) for v in val):
        return list(val)
    return json.dumps(val)


def write_run_result(path: str, *, runs: dict, t_axis, state_names: list,
                     final_states, model_structure: dict | str,
                     run_params: dict | None = None,
                     job_id: str = '', config_id: str = '') -> None:
    """Write a complete simulation run.

    Args:
        runs:         {var: 1-D array} raw signals to store under raw/.
        t_axis:       time vector.
        state_names:  ordered state names (columns of final_states).
        final_states: 1-D sequence aligned with state_names (the last sample).
        model_structure: dict (json-dumped) or already-serialized JSON string.
    """
    run_params = run_params or {}
    ms = model_structure if isinstance(model_structure, str) else json.dumps(model_structure)

    with h5.File(path, 'w') as f:
        f.attrs['job_id']           = job_id
        f.attrs['config_id']        = config_id or ''
        f.attrs['run_time']         = float(run_params.get('runTime', 0))
        f.attrs['dt']               = float(run_params.get('dt', 0))
        f.attrs['return_frequency'] = int(run_params.get('returnFrequency', 100))

        engine._write_string_dataset(f, 'model_structure', ms)
        engine._write_dataset(f, 'time', np.asarray(t_axis, dtype='float64'), lossy=True)
        engine.write_str_array(f, 'state_names', list(state_names))

        f.create_group('raw')
        for name, arr in runs.items():
            engine._write_dataset(f, f'raw/{name}', np.asarray(arr, dtype='float64'),
                                  lossy=True)

        engine.write_compound(f, 'final_states',
                              {name: [float(final_states[i])]
                               for i, name in enumerate(state_names)})
        f.create_group('processed')


def append_processed(path: str, proc_name: str, proc_output: dict, *,
                     proc_config: dict | str | None = None,
                     proc_config_id: str = '', proc_config_name: str = '') -> None:
    """Append post-processing results into /processed/{proc_name}/.

    proc_output: {out_key: {'data': array, 'metadata': {unit, prefix, name}}}
                 (the exact shape ResultsEngine.assembleLegacy() emits).
    Overwrites any previous result with the same proc_name.
    """
    cfg = (proc_config if isinstance(proc_config, str)
           else json.dumps(proc_config or {}))
    with h5.File(path, 'a') as f:
        grp_path = f'processed/{proc_name}'
        if grp_path in f:
            del f[grp_path]
        grp = f.create_group(grp_path)
        grp.attrs['proc_config_id']   = proc_config_id
        grp.attrs['proc_config_name'] = proc_config_name
        grp.attrs['proc_config']      = cfg

        for key, result in proc_output.items():
            ds = engine._write_dataset(grp, key, np.asarray(result['data'], dtype='float64'))
            for ak, av in result.get('metadata', {}).items():
                ds.attrs[ak] = _attr_safe(av)


def append_config(path: str, *, configs: dict, run_config: dict | str | None = None,
                  mode: str = '') -> None:
    """Store the SOURCE config JSONs needed to re-mount the run from scratch, under
    /config (additive — the manuBeat run schema above is left untouched).

    Unlike model_structure (the mutated runtime structure that actually ran), this is
    the recipe: the raw inputs the pipeline consumes. Re-running model+scenario+mode
    through the same code reproduces the run deterministically.

    Args:
        configs:    {name: dict | json-str} stored as real-JSON string datasets
                    /config/{name}. Conventionally model / scenario / metadata /
                    post_processing.
        run_config: the slim notebook runConfig (file refs + mode + output choices),
                    recorded as the /config[run_config] attr.
        mode:       baseline | calibration | control, recorded as /config[mode].
    """
    with h5.File(path, 'a') as f:
        if 'config' in f:
            del f['config']
        grp = f.create_group('config')
        grp.attrs['mode'] = mode or ''
        grp.attrs['run_config'] = (run_config if isinstance(run_config, str)
                                   else json.dumps(run_config or {}))
        for name, cfg in configs.items():
            s = cfg if isinstance(cfg, str) else json.dumps(cfg)
            engine._write_string_dataset(grp, name, s)


def read_config(path: str) -> dict:
    """Return {'mode', 'run_config', <name>: dict, ...} from /config, or {} if absent."""
    out: dict = {}
    with h5.File(path, 'r') as f:
        if 'config' not in f:
            return out
        grp = f['config']
        out['mode'] = engine._to_python(grp.attrs.get('mode', ''))
        rc = engine._to_python(grp.attrs.get('run_config', ''))
        out['run_config'] = json.loads(rc) if rc else {}
        for name in grp:
            out[name] = json.loads(grp[name][()].decode('utf-8'))
    return out


def read_run_result(path: str) -> dict:
    """Return a web-friendly payload (mirrors ResultsEngine.toPayload keys)."""
    with h5.File(path, 'r') as f:
        state_names = list(f['state_names'].asstr()[:])
        t_axis = f['time'][()].tolist()
        signals = {k: f['raw'][k][()].tolist() for k in f['raw']}

        fs = engine.read_compound(f, 'final_states')
        final_states = {k: float(np.asarray(v)[0]) for k, v in fs.items()}

        processed = {}
        units, labels = {}, {}
        if 'processed' in f:
            for pname in f['processed']:
                grp = f[f'processed/{pname}']
                processed[pname] = {}
                for out_key in grp:
                    ds = grp[out_key]
                    processed[pname][out_key] = ds[()].tolist()
                    units[out_key]  = engine._to_python(ds.attrs.get('unit', ''))
                    labels[out_key] = engine._to_python(ds.attrs.get('name', out_key))

        meta = {k: engine._to_python(v) for k, v in f.attrs.items()}

    return {
        'stateNames':  state_names,
        't':           t_axis,
        'signals':     signals,
        'finalStates': final_states,
        'processed':   processed,
        'units':       units,
        'labels':      labels,
        'metadata':    meta,
    }


def read_run_bundle(path: str) -> RunBundle:
    """Return a typed RunBundle for Python callers."""
    with h5.File(path, 'r') as f:
        state_names = list(f['state_names'].asstr()[:])
        t = f['time'][()]
        raw = {k: f['raw'][k][()] for k in f['raw']}
        fs = engine.read_compound(f, 'final_states')
        final_states = {k: float(np.asarray(v)[0]) for k, v in fs.items()}
        processed = {}
        if 'processed' in f:
            for pname in f['processed']:
                grp = f[f'processed/{pname}']
                processed[pname] = {k: grp[k][()] for k in grp}
        meta = {k: engine._to_python(v) for k, v in f.attrs.items()}
        ms = None
        if 'model_structure' in f:
            ms = json.loads(f['model_structure'][()].decode('utf-8'))
    return RunBundle(state_names=state_names, t=t, raw=raw,
                     final_states=final_states, processed=processed,
                     metadata=meta, model_structure=ms)
