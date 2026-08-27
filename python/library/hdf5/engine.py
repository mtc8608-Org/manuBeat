"""
Generic HDF5 engine: read, write, introspect, mutate, repack.

This is the manuBeat-compatible core. The schema modules (schema_sim,
schema_pop, schema_calib) build their typed artifacts on top of these
primitives. Keep this layer free of any project-specific knowledge so it can be
copied verbatim into the manuBeat web-app.

Conventions
-----------
* Config / provenance: JSON via ``json.dumps`` into attrs or string datasets
  (never the legacy ``.replace('"', "'")`` hack).
* Compression: lossless ``gzip`` level 4 for ML / array data; lossy
  ``scaleoffset=5`` only when the caller passes ``lossy=True`` (bulky traces).
* Strings: vlen UTF-8 on write, ``asstr()`` on read.
* Models only get stored as raw byte blobs; scalers are stored as arrays.
"""
from __future__ import annotations

import os
import subprocess

import h5py as h5
import numpy as np

try:                                # pandas only needed for the DataFrame helpers
    import pandas as pd
except Exception:                   # pragma: no cover - optional at import time
    pd = None


# ── Compression policy ──────────────────────────────────────────────────────────

def _compress_kwargs(arr: np.ndarray, compress: bool, lossy: bool) -> dict:
    """Return create_dataset kwargs implementing the compression policy."""
    if not compress or arr.ndim < 1 or arr.size <= 1:
        return {}
    kwargs = {'chunks': True, 'compression': 'gzip', 'compression_opts': 4}
    if lossy and arr.dtype.kind == 'f':
        kwargs['compression_opts'] = 9
        kwargs['scaleoffset'] = 5
    return kwargs


# ── Introspection / typed read ──────────────────────────────────────────────────

def get_tree(path: str) -> dict:
    """Return the recursive group/dataset hierarchy as a JSON-serializable dict."""
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
    """Load a dataset as a JSON-serializable dict.

    numeric  -> {"type": "numeric", "shape": [...], "data": [...]}
    string   -> {"type": "string", "data": "..."}
    compound -> {"type": "compound", "fields": [...], "data": {field: [...]}}
    """
    with h5.File(path, 'r') as f:
        ds = f[dataset_path]

        if h5.check_vlen_dtype(ds.dtype) == str or h5.check_string_dtype(ds.dtype):
            raw = ds[()]
            if isinstance(raw, bytes):
                return {'type': 'string', 'data': raw.decode('utf-8')}
            return {'type': 'string', 'data': str(raw)}

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

        slc = slice(start, end) if (start is not None or end is not None) else slice(None)
        arr = ds[slc]
        return {'type': 'numeric', 'shape': list(arr.shape), 'data': arr.tolist()}


def get_attrs(path: str, node_path: str) -> dict:
    with h5.File(path, 'r') as f:
        return {k: _to_python(v) for k, v in f[node_path].attrs.items()}


# ── Write / mutate ───────────────────────────────────────────────────────────────

def write_dataset(path: str, dataset_path: str, data,
                  dtype=None, compress: bool = True, lossy: bool = False) -> None:
    with h5.File(path, 'a') as f:
        _write_dataset(f, dataset_path, data, dtype=dtype, compress=compress, lossy=lossy)


def _write_dataset(f: h5.File, dataset_path: str, data,
                   dtype=None, compress: bool = True, lossy: bool = False):
    """Open-file variant: idempotent (delete-if-exists), policy-aware compression."""
    if dataset_path in f:
        del f[dataset_path]
    arr = np.asarray(data)
    return f.create_dataset(dataset_path, data=arr, dtype=dtype,
                            **_compress_kwargs(arr, compress, lossy))


def write_string_dataset(path: str, dataset_path: str, text: str) -> None:
    with h5.File(path, 'a') as f:
        _write_string_dataset(f, dataset_path, text)


def _write_string_dataset(f: h5.File, dataset_path: str, text: str):
    if dataset_path in f:
        del f[dataset_path]
    dt = h5.string_dtype(encoding='utf-8')
    return f.create_dataset(dataset_path, data=text.encode('utf-8'), dtype=dt)


def write_str_array(f: h5.File, path: str, data) -> None:
    """Write a 1-D string array (vlen UTF-8), replacing any existing dataset."""
    if path in f:
        del f[path]
    dt = h5.string_dtype(encoding='utf-8')
    arr = np.array(list(data), dtype=dt)
    f.create_dataset(path, shape=arr.shape, dtype=dt, data=arr,
                     chunks=True if arr.size > 1 else None)


def write_attrs(path: str, node_path: str, attrs: dict) -> None:
    with h5.File(path, 'a') as f:
        for k, v in attrs.items():
            f[node_path].attrs[k] = v


def create_group(path: str, group_path: str) -> None:
    with h5.File(path, 'a') as f:
        if group_path not in f:
            f.create_group(group_path)


def delete_dataset(path: str, dataset_path: str) -> None:
    """Unlink a node (bytes persist until repack is called)."""
    with h5.File(path, 'a') as f:
        if dataset_path in f:
            del f[dataset_path]


def repack(path: str) -> None:
    """Rewrite the file in-place to reclaim space from unlinked datasets."""
    tmp = path + '.repack.tmp'
    try:
        subprocess.run(['h5repack', path, tmp], check=True, capture_output=True)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


# ── Compound datasets ────────────────────────────────────────────────────────────

def type_converter(dtype_map: dict) -> np.dtype:
    """Convert a {name: 'string'|'integer'|'float'} dict to a NumPy compound dtype."""
    mapping = {
        'string':  h5.string_dtype(encoding='utf-8'),
        'integer': np.int32,
        'float':   np.float64,
    }
    return np.dtype([(k, mapping[v]) for k, v in dtype_map.items() if v in mapping])


def write_compound(f: h5.File, path: str, columns: dict,
                   dtype_map: dict | None = None) -> None:
    """Write a column dict ``{field: 1-D sequence}`` as a compound dataset.

    ``dtype_map`` (optional) is a {field: 'float'|'integer'|'string'} map; when
    omitted, float64 is assumed for every column. Replaces any existing dataset.
    """
    fields = list(columns)
    if dtype_map is None:
        dtype_map = {k: 'float' for k in fields}
    dt = type_converter(dtype_map)
    n = len(next(iter(columns.values())))
    rows = np.zeros(n, dtype=dt)
    for field in fields:
        rows[field] = np.asarray(columns[field])
    if path in f:
        del f[path]
    f.create_dataset(path, data=rows)


def read_compound(f: h5.File, path: str) -> dict:
    """Read a compound dataset into ``{field: np.ndarray | list[str]}``."""
    ds = f[path]
    out = {}
    for name in ds.dtype.names:
        col = ds[name]
        if col.dtype.kind in ('S', 'O'):
            out[name] = [v.decode('utf-8') if isinstance(v, bytes) else str(v)
                         for v in col]
        else:
            out[name] = col[()]
    return out


def compound_to_array(f: h5.File, path: str) -> tuple[np.ndarray, list]:
    """Read a numeric compound dataset as a dense ``(N, F)`` float array + names."""
    ds = f[path]
    names = list(ds.dtype.names)
    arr = np.zeros((len(ds), len(names)), dtype=np.float64)
    raw = ds[()]
    for j, name in enumerate(names):
        arr[:, j] = raw[name]
    return arr, names


# ── DataFrame round-trip ─────────────────────────────────────────────────────────

def write_df(f: h5.File, group: str, df) -> None:
    """Write each DataFrame column as a dataset under ``group`` (string-aware)."""
    if group in f:
        del f[group]
    f.create_group(group)
    for col in df.columns:
        arr = df[col].to_numpy()
        if arr.dtype.kind in ('U', 'O', 'S'):
            write_str_array(f, f'{group}/{col}', arr.astype(str))
        else:
            _write_dataset(f, f'{group}/{col}', arr)


def read_group_as_df(f: h5.File, group: str):
    """Read every dataset under ``group`` back into a DataFrame."""
    if pd is None:
        raise RuntimeError('pandas is required for read_group_as_df')
    if group not in f:
        return pd.DataFrame()
    cols = {}
    for col in f[group].keys():
        ds = f[f'{group}/{col}']
        cols[col] = ds.asstr()[:] if ds.dtype == object else ds[:]
    return pd.DataFrame(cols)


# ── Binary blobs (models only — never scalers) ───────────────────────────────────

def write_blob(f: h5.File, path: str, raw_bytes: bytes) -> None:
    if path in f:
        del f[path]
    f.create_dataset(path, data=np.frombuffer(raw_bytes, dtype=np.uint8))


def read_blob(f: h5.File, path: str) -> bytes:
    return f[path][:].tobytes()


# ── Internal helpers ─────────────────────────────────────────────────────────────

def _to_python(val):
    """Convert numpy scalars, bytes, and arrays to Python-native types."""
    if isinstance(val, bytes):
        return val.decode('utf-8')
    if isinstance(val, np.generic):
        return val.item()
    if isinstance(val, np.ndarray):
        return val.tolist()
    return val
