####################################################################################################
# progress.py  —  one shared live-progress line + record collector for the population/sweep runs
#
# Every population driver (batched calibration, serial calibration, the MCMC/optimiser baselines)
# reports the SAME convergence line as it runs:
#
#     sim 20-30/300s | 594s | +18.42s | 10% | acc 0.346 | mean|rel|   8.3% | max|rel|  31.5% | best  10.1%
#
# where `594s` is the cumulative wall time, `+18.42s` the wall time this section took (its own
# column), and `10%` the progress fraction (done/total).
#
# where rel = |gauge observation - twinTarget| / |twinTarget|, reduced over the live population.
# Rather than paste that block into each notebook (and drift), the format + the relative-error
# reduction + the twin->observation target mapping live here ONCE, and are called from:
#   * runnerBatchSI.batchedCalibration._tick  (batched EFC: population = the vmapped chunk, cadence
#     = progressEvery SIMULATED seconds),
#   * runner.runCalibrationSI._tick           (serial EFC single sample),
#   * the notebook loops (MCMC sampler step / serial per-sample), which own their own cadence.
#
# The reporter also COLLECTS one record per emitted line (`records`), so the run's progress trace
# can be persisted (hdf5.schema_pop.write_progress) and compared across runs later.
#
# This module is domain-coupled (it knows the twin schema), so it lives in run/ next to the
# orchestration it serves — NOT in utils.py (see .claude/rules/utils-helpers.md).
####################################################################################################

import numpy as np
import library.utils as utils


####################################################################################################
# region twin -> per-observation targets (the ONE definition; lifted from the MCMC baseline nb)
####################################################################################################

def obsTargetArrays(observations, twin, volumeDistribution, atm):
    """Map a list of observation names to (targetArr, offsetArr), the single source of truth for
    "where should this observable land" shared by the MCMC baseline notebook and the EFC progress
    line.

    targetArr[i] = the twin target for observations[i] in GAUGE units, or NaN if the observable is
    untargeted (EFC never fits it, so it is excluded from the convergence metric). The targeted set
    is EFC's calibration set — the observables its cubic controllers drive. Capillary means are a
    pressure DROP from the upstream arterial target, not absolute means. Not targets: Cyc_HC (cycle
    period = 60/HR, a driver INPUT) and V_Vs (the slack venous compartment; no controller targets it).

    offsetArr[i] = the atmospheric offset baked into observations[i] (gauge = raw - offset), so a
    caller holding RAW observations can recover gauge units with `raw - offsetArr`.
    """
    TBV = twin["TotalBloodVolume"]
    direct = {
        "avg_P_Vs": twin["CVP"],
        "avg_P_Cs": twin["Sys_P_As"] - twin["amp_P_As"] - twin["avg_P_Cs"],
        "avg_P_Cp": twin["Dia_P_Ap"] - twin["avg_P_Cp"],
        "keep_max_P_As": twin["Sys_P_As"], "keep_max_P_Ap": twin["Sys_P_Ap"],
        "keep_min_P_Ap": twin["Dia_P_Ap"], "amp_P_As": twin["amp_P_As"],
        # Pulmonary pulse pressure mirrors stateSetup._configureCalibration's C_Ap rule: an
        # explicit twin amp_P_Ap wins, otherwise it is systolic - diastolic.
        "amp_P_Ap": twin.get("amp_P_Ap",
                             twin.get("Sys_P_Ap", 0.0) - twin.get("Dia_P_Ap", 0.0)),
        "keep_SV_Hl": twin["CO"] / twin["HR"],
    }

    def target(name):
        if name in direct:
            return direct[name]
        if name.startswith("avg_V_"):
            return volumeDistribution[name[len("avg_V_"):]] * TBV
        return None

    targetArr = np.array([t if (t := target(o)) is not None else np.nan for o in observations],
                         dtype=float)
    offsetArr = np.array([utils.obsOffset(o, atm) for o in observations], dtype=float)
    return targetArr, offsetArr


def relErrorStats(gaugeObs, targetArr):
    """Population relative-error summary vs targets, nan-safe, in percent.

    gaugeObs : (M, nObs) or (nObs,) gauge-unit observations for a population of M members.
    targetArr: (nObs,) gauge targets with NaN in the untargeted columns (they are dropped).

    Returns {meanRel, maxRel, bestRel} (percent):
      meanRel — mean |rel err| over all (member, target) entries,
      maxRel  — mean over members of each member's WORST-target |rel err| (the ensemble max),
      bestRel — the single best member's worst-target |rel err| (the ensemble minimum).
    Mirrors the MCMC baseline's relNow / walkerMax reductions so the numbers line up across runs.
    """
    g = np.atleast_2d(np.asarray(gaugeObs, dtype=float))          # (M, nObs)
    mask = ~np.isnan(np.asarray(targetArr, dtype=float))
    if not mask.any():
        return {"meanRel": np.nan, "maxRel": np.nan, "bestRel": np.nan}
    t = np.asarray(targetArr, dtype=float)[mask]
    r = np.abs(g[:, mask] - t) / np.abs(t)                        # (M, nTargeted) |rel err|
    with np.errstate(invalid="ignore"):
        perMemberMax = np.nanmax(r, axis=1)                       # (M,) each member's worst target
        return {"meanRel": float(np.nanmean(r) * 100.0),
                "maxRel":  float(np.nanmean(perMemberMax) * 100.0),
                "bestRel": float(np.nanmin(perMemberMax) * 100.0)}

# endregion
####################################################################################################


####################################################################################################
# region the reporter (format + print + record)
####################################################################################################

class ProgressReporter:
    """Formats/prints the standard convergence line and accumulates one record per line.

    Cadence is the CALLER's job (a sim-time boundary in the EFC _tick, a step modulo in the MCMC
    loop) — the reporter only formats, prints, and records when `.emit(...)` is called. `records`
    is a list of flat dicts (JSON/HDF5-friendly) ready for schema_pop.write_progress.
    """

    #: numeric columns persisted by schema_pop.write_progress (order = dataset column order)
    FIELDS = ("done", "total", "elapsedWall", "eta", "acc", "meanRel", "maxRel", "bestRel")

    def __init__(self, logEnabled=True, onEmit=None):
        self.logEnabled = logEnabled
        # manuBeat divergence from CardioPulmonaryModel — port this back upstream.
        # onEmit(record) fires once per emitted line, as it happens. `records` is only
        # handed to the caller when the run finishes (runner.py end of runCalibrationSI),
        # which is too late for a web UI polling a job that takes minutes. Reached from
        # simulationParams["progress"]["onEmit"]; None everywhere else, so notebooks are
        # unaffected. A raising callback must never kill a run — see emit().
        self.onEmit = onEmit
        self.records = []
        self._prevWall = 0.0        # last finite elapsedWall, for the per-section (Δwall) column

    def emit(self, *, kind, label, done, total, elapsedWall, stats, acc=None, prefix="  ", show=True):
        """Print one line (unless show=False) and (if logEnabled) append its record. Returns the line.

        kind        : "step" (iteration-paced) | "sim" (simulated-time-paced) — stored on the record.
        label       : left field, e.g. "step 25/1500" or "sim 20-30/300s".
        done, total : progress fraction numerator/denominator (used for ETA and stored raw).
        elapsedWall : seconds of wall time so far (NaN when building a trace post-hoc).
        stats       : dict from relErrorStats (meanRel/maxRel/bestRel, percent).
        acc         : optional acceptance fraction (MCMC); omitted from the line when None.
        show        : False builds the record only (e.g. reconstructing a trace from saved obs).
        """
        eta = elapsedWall * (total - done) / done if done else 0.0
        pct = 100.0 * done / total if total else 0.0
        # per-section wall = Δ since the previous emit (elapsedWall resets per chunk -> guard Δ<0)
        section = (elapsedWall - self._prevWall
                   if (np.isfinite(elapsedWall) and elapsedWall >= self._prevWall) else elapsedWall)
        accStr = f" | acc {acc:.3f}" if acc is not None else ""
        line = (f"{prefix}{label} | {elapsedWall:.0f}s | +{section:.2f}s | {pct:3.0f}%{accStr} | "
                f"mean|rel| {stats['meanRel']:5.1f}% | max|rel| {stats['maxRel']:5.1f}% | "
                f"best {stats['bestRel']:5.1f}%")
        if show:
            print(line, flush=True)
            if np.isfinite(elapsedWall):
                self._prevWall = elapsedWall
        record = {
            "kind": kind, "label": label,
            "done": float(done), "total": float(total),
            "elapsedWall": float(elapsedWall), "eta": float(eta),
            "acc": float(acc) if acc is not None else np.nan,
            "meanRel": stats["meanRel"], "maxRel": stats["maxRel"], "bestRel": stats["bestRel"],
        }
        if self.logEnabled:
            self.records.append(record)
        # manuBeat divergence (see __init__): live per-line hook. Swallowed on error —
        # a broken progress consumer must not abort a calibration that has already
        # burned minutes of solve.
        if self.onEmit is not None:
            try:
                self.onEmit(record)
            except Exception:
                pass
        return line

# endregion
####################################################################################################
