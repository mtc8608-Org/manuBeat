#!/usr/bin/env python3
"""[MEDICAL] Compare a web run artifact against a notebook reference artifact.

    python3 scripts/verify-run-vs-reference.py <run_id> [reference_path]

The web run is read through the python service's own HDF5 endpoints (no MinIO
credentials, no docker); the reference is read with h5py from disk. Run it with an
interpreter that has h5py — e.g. CardioPulmonaryModel/.venv/bin/python.

Equality is only meaningful when the run was launched with the SAME settings the
notebook used: same model, same scenario, same mode, and the same output grid
(the reference's return_frequency attr = 1/dtDense).

Exit code 0 = equal within tolerance, 1 = differences found.
"""
import json
import sys
import urllib.request

import h5py
import numpy as np

SERVICE = "http://localhost:5000"

# Both artifacts are written with scaleoffset=5 (engine._write_dataset lossy=True), so
# every stored value is already rounded to 5 decimal places — 1e-5 is the storage
# quantum and nothing below it is meaningful. The two stacks also run different jax /
# XLA versions (0.6 in the notebook venv, 0.11 in the container), which can reorder
# floating-point ops, so expect agreement to be close but not bit-exact.
RTOL, ATOL = 1e-6, 1e-5
WORST_N = 10


def get(path):
    with urllib.request.urlopen(f"{SERVICE}{path}", timeout=300) as r:
        return json.load(r)


def web_result(run_id):
    """The same payload the Simulator plots — {t, signals, stateNames, ...}."""
    return get(f"/cardio/result-by-run/{run_id}")


def compare(run_id, ref_path):
    web = web_result(run_id)
    t_web = np.asarray(web["t"], dtype=float)
    sig_web = {k: np.asarray(v, dtype=float) for k, v in web["signals"].items()}

    with h5py.File(ref_path, "r") as f:
        t_ref = f["time"][()]
        sig_ref = {k: f[f"raw/{k}"][()] for k in f["raw"]}
        ref_attrs = {k: f.attrs[k] for k in f.attrs}

    problems = []
    print(f"reference : {ref_path}")
    print(f"web run   : {run_id}")
    print(f"            ref dt={ref_attrs.get('dt')} runTime={ref_attrs.get('run_time')} "
          f"returnFrequency={ref_attrs.get('return_frequency')}")
    print()

    # ── time axis ────────────────────────────────────────────────────────────
    print(f"/time      ref n={t_ref.size} distinct={np.unique(t_ref).size} "
          f"[{t_ref.min()} .. {t_ref.max()}]")
    print(f"           web n={t_web.size} distinct={np.unique(t_web).size} "
          f"[{t_web.min() if t_web.size else float('nan')} .. "
          f"{t_web.max() if t_web.size else float('nan')}]")
    if np.unique(t_web).size <= 1 and t_web.size > 1:
        problems.append("web time vector is CONSTANT — the model's T state never advanced "
                        "(float32: set JAX_ENABLE_X64=1 on the python service)")
    if t_web.shape != t_ref.shape:
        problems.append(f"sample count differs: ref {t_ref.size} vs web {t_web.size} — "
                        f"the run must use the reference's output grid "
                        f"(dtDense = 1/{ref_attrs.get('return_frequency')})")
    elif not np.allclose(t_web, t_ref, rtol=RTOL, atol=ATOL):
        problems.append(f"time values differ: max|Δ| = {np.abs(t_web - t_ref).max():.6g}")
    print()

    # ── signal coverage ──────────────────────────────────────────────────────
    missing = sorted(set(sig_ref) - set(sig_web))
    extra   = sorted(set(sig_web) - set(sig_ref))
    print(f"/raw       ref {len(sig_ref)} signals · web {len(sig_web)} signals · "
          f"missing {len(missing)} · extra {len(extra)}")
    if missing:
        problems.append(f"{len(missing)} signal(s) missing from the web run: {missing[:5]}")
    if extra:
        print(f"           extra in web: {extra[:5]}")

    # ── values ───────────────────────────────────────────────────────────────
    diffs = []
    for name in sorted(set(sig_ref) & set(sig_web)):
        a, b = sig_ref[name], sig_web[name]
        if a.shape != b.shape:
            diffs.append((np.inf, name, f"shape {a.shape} vs {b.shape}"))
            continue
        d = np.abs(a - b)
        scale = np.maximum(np.abs(a), np.abs(b))
        rel = np.where(scale > 0, d / np.where(scale > 0, scale, 1), 0.0)
        diffs.append((rel.max(), name, f"max|Δ|={d.max():.6g} max relΔ={rel.max():.3%}"))

    diffs.sort(reverse=True, key=lambda x: x[0])
    bad = [d for d in diffs if d[0] > RTOL]
    print(f"           {len(diffs) - len(bad)}/{len(diffs)} comparable signals equal "
          f"within rtol={RTOL:g}")
    if bad:
        problems.append(f"{len(bad)} signal(s) differ beyond tolerance")
        print(f"\n           worst {min(WORST_N, len(bad))}:")
        for _, name, msg in bad[:WORST_N]:
            print(f"             {name:28s} {msg}")

    print()
    if problems:
        print("VERDICT: NOT equal to the reference")
        for p in problems:
            print(f"  · {p}")
        return 1
    print("VERDICT: equal to the reference within tolerance")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ref = (sys.argv[2] if len(sys.argv) > 2 else
           "/home/cabsman/Documents/projects/CardioPulmonaryModel/data/cpet/results_CPET")
    sys.exit(compare(sys.argv[1], ref))
