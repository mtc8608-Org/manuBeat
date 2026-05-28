"""
Generic HDF5 engine: read, write, delete, repack.
Run-specific helpers (write_run_result, read_run_result, append_processed)
sit on top of the generic layer.
"""
import json
import os
import subprocess
import tempfile

import h5py as h5
import numpy as np


# ── Generic tree / read ────────────────────────────────────────────────────────

def get_tree(path: str) -> dict:
    """Return recursive group/dataset hierarchy as a JSON-serializable dict."""
    with h5.File(path, 'r') as f:
        return _walk_node(f['/'])


def _walk_node(node) -> dict:
    out = {
        'name':  node.name.split('/')[-1] or '/',
        'path':  node.name,
        'attrs': {k: _to_python(v) for k, v in node.attrs.items()},
    }
    if isinstance(node, h5.Group):
        out['type']     = 'group'
        out['children'] = [_walk_node(node[k]) for k in node]
    else:
        out['type']  = 'dataset'
        out['shape'] = list(node.shape)
        out['dtype'] = str(node.dtype)
        if node.dtype.names:
            out['fields'] = list(node.dtype.names)
    return out


def get_dataset(path: str, dataset_path: str,
                start: int | None = None, end: int | None = None) -> dict:
    """
    Load a dataset and return a JSON-serializable dict:
      float/int arrays  → {"type": "numeric", "shape": [...], "data": [...]}
      vlen string scalar → {"type": "string", "data": "..."}
      compound          → {"type": "compound", "fields": [...], "data": {field: [...]}}
    Slices 1-D numeric arrays with start/end when provided.
    """
    with h5.File(path, 'r') as f:
        ds = f[dataset_path]

        # vlen / fixed-length string
        if h5.check_vlen_dtype(ds.dtype) == str or h5.check_string_dtype(ds.dtype):
            raw = ds[()]
            if isinstance(raw, bytes):
                return {'type': 'string', 'data': raw.decode('utf-8')}
            return {'type': 'string', 'data': str(raw)}

        # compound
        if ds.dtype.names:
            arr = ds[()]
            data = {}
            for field in ds.dtype.names:
                col = arr[field]
                if col.dtype.kind in ('S', 'O'):
                    data[field] = [
                        v.decode('utf-8') if isinstance(v, bytes) else str(v)
                        for v in col
                    ]
                else:
                    data[field] = col.tolist()
            return {'type': 'compound', 'fields': list(ds.dtype.names), 'data': data}

        # numeric
        slc = slice(start, end) if (start is not None or end is not None) else slice(None)
        arr = ds[slc]
        return {'type': 'numeric', 'shape': list(arr.shape), 'data': arr.tolist()}


def get_attrs(path: str, node_path: str) -> dict:
    with h5.File(path, 'r') as f:
        return {k: _to_python(v) for k, v in f[node_path].attrs.items()}


# ── Write / mutate ─────────────────────────────────────────────────────────────

def write_dataset(path: str, dataset_path: str, data,
                  dtype=None, compress: bool = True) -> None:
    with h5.File(path, 'a') as f:
        if dataset_path in f:
            del f[dataset_path]
        arr = np.asarray(data)
        kwargs: dict = {}
        if compress and arr.ndim >= 1 and arr.size > 1:
            kwargs = {'chunks': True, 'compression': 'gzip',
                      'compression_opts': 9, 'scaleoffset': 5}
        f.create_dataset(dataset_path, data=arr, dtype=dtype, **kwargs)


def write_string_dataset(path: str, dataset_path: str, text: str) -> None:
    with h5.File(path, 'a') as f:
        if dataset_path in f:
            del f[dataset_path]
        dt = h5.string_dtype(encoding='utf-8')
        f.create_dataset(dataset_path, data=text.encode('utf-8'), dtype=dt)


def write_attrs(path: str, node_path: str, attrs: dict) -> None:
    with h5.File(path, 'a') as f:
        for k, v in attrs.items():
            f[node_path].attrs[k] = v


def create_group(path: str, group_path: str) -> None:
    with h5.File(path, 'a') as f:
        if group_path not in f:
            f.create_group(group_path)


def delete_dataset(path: str, dataset_path: str) -> None:
    """Unlink the dataset (bytes persist in the file until repack is called)."""
    with h5.File(path, 'a') as f:
        if dataset_path in f:
            del f[dataset_path]


def repack(path: str) -> None:
    """Rewrite the HDF5 file in-place to reclaim space from unlinked datasets."""
    tmp = path + '.repack.tmp'
    try:
        subprocess.run(['h5repack', path, tmp], check=True, capture_output=True)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


# ── Run-specific helpers ───────────────────────────────────────────────────────

def write_run_result(tmp_path: str, job_id: str, config_id: str,
                     runsRes: dict, t_axis, state_names: list,
                     final_states, model_structure_json: str,
                     run_params: dict) -> None:
    """Write a complete simulation run to tmp_path as HDF5."""
    with h5.File(tmp_path, 'w') as f:
        f.attrs['job_id']           = job_id
        f.attrs['config_id']        = config_id or ''
        f.attrs['run_time']         = float(run_params.get('runTime', 0))
        f.attrs['dt']               = float(run_params.get('dt', 0))
        f.attrs['return_frequency'] = int(run_params.get('returnFrequency', 100))

        dt_str = h5.string_dtype(encoding='utf-8')
        f.create_dataset('model_structure',
                         data=model_structure_json.encode('utf-8'), dtype=dt_str)

        t_arr = np.asarray(t_axis, dtype='float64')
        f.create_dataset('time', data=t_arr, dtype='float64',
                         chunks=True, compression='gzip',
                         compression_opts=9, scaleoffset=5)

        f.create_dataset('state_names',
                         data=np.array(state_names, dtype=object),
                         dtype=dt_str)

        raw_grp = f.create_group('raw')
        for name, arr in runsRes.items():
            data = np.asarray(arr, dtype='float64')
            raw_grp.create_dataset(name, data=data, dtype='float64',
                                   chunks=True, compression='gzip',
                                   compression_opts=9, scaleoffset=5)

        dt = np.dtype([(name, np.float64) for name in state_names])
        row = np.zeros(1, dtype=dt)
        for i, name in enumerate(state_names):
            row[name][0] = float(final_states[i])
        f.create_dataset('final_states', data=row)

        f.create_group('processed')


def read_run_result(tmp_path: str) -> dict:
    """
    Read run HDF5 and return the same payload shape as the old JSON format
    so Simulator.tsx needs no changes.
    """
    with h5.File(tmp_path, 'r') as f:
        state_names = [
            s.decode('utf-8') if isinstance(s, bytes) else s
            for s in f['state_names'][()]
        ]
        t_axis      = f['time'][()].tolist()
        ys          = {k: f['raw'][k][()].tolist() for k in f['raw']}
        fs = f['final_states']
        if isinstance(fs, h5.Group):
            final_states = {k: float(fs[k][()]) for k in fs}
        else:
            arr = fs[()]
            final_states = {name: float(arr[name][0]) for name in arr.dtype.names}
        meta        = {k: _to_python(v) for k, v in f.attrs.items()}
    return {
        'stateNames':  state_names,
        't':           t_axis,
        'ys':          ys,
        'finalStates': final_states,
        'metadata':    meta,
    }


def append_processed(tmp_path: str, proc_name: str, proc_config_id: str,
                     proc_output: dict, proc_config_json: str,
                     proc_config_name: str = "") -> None:
    """
    Append post-processing results into /processed/{proc_name}/.
    proc_name is the user-given label for this processing run (HDF5 group key).
    proc_config_id is stored as an attribute for provenance.
    proc_output: {output_key: {'data': np.array, 'metadata': {unit, prefix, ...}}}
    Overwrites any previous result with the same proc_name.
    """
    with h5.File(tmp_path, 'a') as f:
        grp_path = f'processed/{proc_name}'
        if grp_path in f:
            del f[grp_path]

        grp = f.create_group(grp_path)
        dt_str = h5.string_dtype(encoding='utf-8')
        grp.attrs['proc_config_id']   = proc_config_id
        grp.attrs['proc_config_name'] = proc_config_name
        grp.attrs['proc_config']      = proc_config_json.encode('utf-8')

        for key, result in proc_output.items():
            data = np.asarray(result['data'], dtype='float64')
            ds = grp.create_dataset(key, data=data, dtype='float64',
                                    chunks=True, compression='gzip',
                                    compression_opts=9, scaleoffset=5)
            for attr_k, attr_v in result.get('metadata', {}).items():
                if isinstance(attr_v, str):
                    ds.attrs[attr_k] = attr_v.encode('utf-8')
                else:
                    ds.attrs[attr_k] = attr_v


# ── Internal helpers ───────────────────────────────────────────────────────────

def _to_python(val):
    """Convert numpy scalars, bytes, and arrays to Python-native types."""
    if isinstance(val, bytes):
        return val.decode('utf-8')
    if isinstance(val, np.generic):
        return val.item()
    if isinstance(val, np.ndarray):
        return val.tolist()
    return val
