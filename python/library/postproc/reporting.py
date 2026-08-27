"""Population scope / rejection reporting.

The shared post-processing report that every population/sweep driver notebook
prints after loading its artifact: which runs were dropped and *why* (sentinel /
NaN / out-of-scope), before the error summary works on the survivors. It lives
here (not pasted inline per notebook) so `run_convergence/{batch,serial}`,
`run_test/solver_compare` and `run_sepsis/gen_population` all call ONE function
and cannot drift apart.

The report's core classification (`good_run_mask`, `BAD_RUN_SENTINEL`) is reused
verbatim from :mod:`library.hdf5.schema_pop` — this module only tabulates and
renders. `rawObs` is passed in by the caller (its source varies: a rebuilt
tensor slice for the batched/sepsis stacks, `obsMatrix` directly for the serial
per-run-group stacks), so the function never rebuilds it.
"""

import collections

import numpy as np
import pandas as pd

from library.hdf5 import schema_pop

# Rich HTML tables in a notebook; plain print anywhere else (scripts, tests).
try:
    from IPython.display import display
except ImportError:  # pragma: no cover - only hit outside a notebook kernel
    display = print


ScopeReport = collections.namedtuple("ScopeReport", ["keep", "offenders", "diverged", "counts"],
                                     defaults=(None,))


def scopeRejectionReport(rawObs, paramMatrix, observations, paramNames, *, lim=1e6,
                         verbose=True):
    """Print the scope/rejection report for a population and return its tables.

    ``rawObs`` ``(N, nObs)`` are the un-blanked, offset-corrected observation
    values; ``paramMatrix`` ``(N, nParam)`` the run-end swept/calibrated
    parameter values; ``observations`` / ``paramNames`` label their columns.
    ``lim`` is the divergence limit (``runConfig.analysis.divergenceLimit``).

    Recomputes the good-run mask from ``rawObs`` via
    :func:`schema_pop.good_run_mask`, prints the kept/dropped summary plus the
    per-reason counts (a run can trip more than one), renders the ``offenders``
    table (every signal with >=1 out-of-scope run, worst run-end magnitude) and
    the ``diverged`` table (genuine non-sentinel blow-ups only), and returns
    ``ScopeReport(keep, offenders, diverged, counts)`` so callers can reuse
    ``keep`` (e.g. the sepsis per-phenotype breakdown).

    ``verbose=False`` computes and returns everything but prints nothing, for a
    caller that loads several populations in one cell and wants one digest line
    each instead of the full report per population. ``counts`` carries the same
    numbers the printed summary shows (total / kept / dropped / sentinel / nan /
    obsScope / parScope), so a quiet caller can still report every drop.
    """
    rawObs      = np.asarray(rawObs)
    paramMatrix = np.asarray(paramMatrix)
    keep = schema_pop.good_run_mask(rawObs, lim, param_matrix=paramMatrix)

    sentinelRun = np.any(rawObs <= schema_pop.BAD_RUN_SENTINEL + 1.0, axis=1)
    nanRun      = np.any(np.isnan(rawObs), axis=1) | np.any(np.isnan(paramMatrix), axis=1)
    obsScopeRun = np.any(np.abs(rawObs) >= lim, axis=1)
    parScopeRun = np.any(np.abs(paramMatrix) >= lim, axis=1)
    dropped     = ~keep

    counts = {"total": int(rawObs.shape[0]), "kept": int(keep.sum()),
              "dropped": int(dropped.sum()), "sentinel": int(sentinelRun.sum()),
              "nan": int(nanRun.sum()), "obsScope": int(obsScopeRun.sum()),
              "parScope": int(parScopeRun.sum())}

    if verbose:
        print(f"scope limit: |value| < {lim:g}  (applied to {rawObs.shape[1]} observations "
              f"+ {paramMatrix.shape[1]} parameters)")
        print(f"  total runs            : {counts['total']}")
        print(f"  kept (in scope)       : {counts['kept']}")
        print(f"  dropped               : {counts['dropped']}")
        print(f"    sentinel-stamped    : {counts['sentinel']}")
        print(f"    NaN / Inf lane      : {counts['nan']}")
        print(f"    observation >= limit: {counts['obsScope']}")
        print(f"    parameter   >= limit: {counts['parScope']}")

    # which signals drove the out-of-scope drops (count of runs where each leaves scope)
    offRows  = [("obs", o, int(np.sum(np.abs(rawObs[:, j]) >= lim)),
                 float(np.nanmax(np.abs(rawObs[:, j])))) for j, o in enumerate(observations)]
    offRows += [("param", p, int(np.sum(np.abs(paramMatrix[:, j]) >= lim)),
                 float(np.nanmax(np.abs(paramMatrix[:, j])))) for j, p in enumerate(paramNames)]
    offenders = (pd.DataFrame(offRows, columns=["kind", "signal", "runs_out_of_scope", "max_abs"])
                 .query("runs_out_of_scope > 0")
                 .sort_values("runs_out_of_scope", ascending=False).reset_index(drop=True))
    if verbose:
        print(f"\nsignals leaving scope ({len(offenders)} of "
              f"{len(observations) + len(paramNames)}):")
        display(offenders)

    # genuine divergence drivers: exclude sentinel-stamped runs (whose ALL lanes read
    # BAD_RUN_SENTINEL and so trip every observation) to isolate the observations that
    # actually blew up past the limit on a run that otherwise solved cleanly.
    genuine = obsScopeRun & ~sentinelRun
    divMask = (np.abs(rawObs) >= lim) & genuine[:, None]
    divRows = [(o, int(divMask[:, j].sum()),
                float(np.nanmax(np.abs(rawObs[genuine, j]))) if genuine.any() else np.nan)
               for j, o in enumerate(observations) if divMask[:, j].any()]
    diverged = (pd.DataFrame(divRows, columns=["observation", "runs_over_limit", "max_abs"])
                .sort_values("runs_over_limit", ascending=False).reset_index(drop=True))
    if verbose:
        print(f"\ngenuine divergence drivers "
              f"({int(genuine.sum())} non-sentinel run(s) past |value| >= {lim:g}):")
        display(diverged)

    return ScopeReport(keep=keep, offenders=offenders, diverged=diverged, counts=counts)
