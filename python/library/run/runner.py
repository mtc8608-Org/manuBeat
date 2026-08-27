####################################################################################################
# runner.py  —  run orchestration for the array-mode CardioPulmonary stack
#
# Moved out of the CPET_Run notebook so the notebook only handles files + outputs and
# this orchestration can be driven by a web request (POST /simulate) just as easily.
#
# One entry point:  run(simulationParams) -> (states, modelObjects, modelStructure,
#                                              results, structures)
# It dispatches on the baseline/control/calibration mode flags. Each mode follows the
# same pipeline:
#     initialiseModel -> stateSetup.configureStates -> (prepareModel ->
#     CardioPulmonaryModelArray -> runSimulationArray), iterating the scenario stage
#     stack for control/calibration.
#
# buildSimulationParams is the slim runConfig + scenario JSON -> legacy simulationParams
# adapter (the library still consumes that shape).
####################################################################################################

import copy
import numpy as np
import library.utils as utils
import library.run.stateSetup as stateSetup
import library.run.progress as progressLib
import library.model.modelClass as modelClass

# Controller-gain cap (mirrors My-ICU-Twin's updateControllerWeights): the cubic gain is
# clamped to +/-maxCubicFactor so the multiplierC schedule can never drive an unstable
# gain. Configurable per scenario via calibration.maxCubicFactor (default 1.0), or per
# notebook via runConfig["calibration"] (see buildSimulationParams).
#
# The calibration controller law is selectable via calibration.controllerLaw:
#   * "cubic" (default): adjustment = error^3 * cubicFactor (linearFactor held at 0.0) —
#     the existing behaviour.
#   * "linear": adjustment = error * linearFactor (cubicFactor held at 0.0). The linear
#     gain is seeded per-parameter in the model JSON's linearFactor and clamped to
#     +/-maxLinearFactor (default 1.0). Used by the cubic-vs-linear comparison notebook.
_DEFAULT_MAX_CUBIC_FACTOR = 1.0
_DEFAULT_MAX_LINEAR_FACTOR = 1.0

####################################################################################################
# region runConfig + scenario -> simulationParams
####################################################################################################

def buildSimulationParams(cfg, scenario):
    """Expand the slim runConfig + scenario JSON into the legacy simulationParams dict
    the library expects. `mode` drives the baseline/control/calibration flags.

    Everything that defines the run lives in the scenario: shared.integration holds
    dt / dtDense / runTime / gasExchange / useEquilibriumStates; baseline.runs holds
    the baseline run counts (control/calibration stages override them per stage). The
    notebook runConfig only carries file references, the mode, and output/presentation."""
    mode = cfg["mode"]
    pp = cfg.get("postProcessing")
    integration = scenario["shared"]["integration"]
    baselineRuns = scenario.get("baseline", {}).get("runs", {"ignore": 1, "save": 20})
    # Solver config: scenario's shared.integration.solver is canonical; an optional
    # runConfig["solver"] overrides per-key (quick notebook experiments). Default euler.
    # projDt: projection-sampling grid for the adaptive path's cycle Max/Min fold across a
    # beat segment (defaults to the integrator dt0); ignored by the fixed-step euler/rk4 paths.
    solver = {"type": "euler", "rtol": 1e-6, "atol": 1e-9,
              "maxSteps": 8192, "eventTol": 1e-10, "dtMax": None, "projDt": None}
    solver.update(integration.get("solver") or {})
    solver.update(cfg.get("solver") or {})
    # progressEvery: emit a live convergence line every N SIMULATED seconds of an EFC calibration
    # (0 = off). Top-level runConfig["progressEvery"] is a convenience alias that folds into the
    # solver; an explicit solver["progressEvery"] wins. `debugEvery` is the deprecated former name
    # and is still honoured as a fallback so old runConfigs keep working.
    if "progressEvery" not in (cfg.get("solver") or {}):
        if "progressEvery" in cfg:
            solver["progressEvery"] = cfg["progressEvery"]
        elif "debugEvery" in cfg and "debugEvery" not in (cfg.get("solver") or {}):
            solver["progressEvery"] = cfg["debugEvery"]
    solver.setdefault("progressEvery", 10)   # definition-site default: a line every 10 sim-seconds
    # Live-progress targets: for an EFC calibration over a scenario that declares its convergence
    # observations, precompute the (gauge target, atm offset) arrays the calibration _tick uses to
    # report obs-space |rel err| vs twin targets. logProgress toggles persistence of the trace.
    progressCfg = {"logProgress": (cfg.get("output") or {}).get("logProgress", True)}
    convObs = (scenario.get("convergence") or {}).get("observations")
    if mode == "calibration" and convObs:
        twin = scenario["shared"]["twin"]
        tArr, oArr = progressLib.obsTargetArrays(
            convObs, twin["twinTargets"], twin["volumeDistribution"],
            (cfg.get("analysis") or {}).get("atm", 760.0))
        progressCfg.update({"observations": convObs, "targetArr": tArr, "offsetArr": oArr})
    # Calibration config: the scenario's calibration section is canonical; an optional
    # runConfig["calibration"] overrides per-key (quick notebook experiments, e.g.
    # maxCubicFactor or adaptive.maxLoops). Dict values merge one level deep so a single
    # nested key can be overridden without restating the rest of that sub-dict. The merge
    # happens on a copy — the caller's scenario dict is never mutated.
    calOverride = cfg.get("calibration") or {}
    if calOverride:
        calibration = dict(scenario.get("calibration") or {})
        for key, val in calOverride.items():
            if isinstance(val, dict) and isinstance(calibration.get(key), dict):
                calibration[key] = {**calibration[key], **val}
            else:
                calibration[key] = val
        scenario = {**scenario, "calibration": calibration}
    # Integration numerics: the scenario's shared.integration is canonical; optional
    # runConfig["runTime"|"dt"|"dtDense"] override per-run (quick notebook sweeps), each
    # falling back to the scenario value. Same pattern as solver/calibration above.
    return {
        "readFromFile": False,
        "runTime": cfg.get("runTime", integration["runTime"]),
        "solver": solver,
        "runsToIgnore": baselineRuns["ignore"],     # baseline only; stages override
        "runsToSave": baselineRuns["save"],
        "baseline": mode == "baseline",
        "control": mode == "control",
        "calibration": mode == "calibration",
        "statesEquilibrium": {"use": integration["useEquilibriumStates"]},
        "simulationType": "calibrate" if mode == "calibration" else "control",
        "simulationConf": scenario,
        "gasExchange": {"enabled": integration["gasExchange"],
                        "method": integration.get("gasExchangeMethod", "new")},
        "dt": cfg.get("dt", integration["dt"]),
        "dtDense": cfg.get("dtDense", integration["dtDense"]),
        "saveToHDF5": cfg["output"]["save"],
        "hdf5File": {"filePath": cfg["output"]["path"], "fileName": cfg["output"]["name"]},
        # Integration stack: "legacy" (modelClass, diffrax.Euler only — default, unchanged
        # behaviour) or "SI" (modelClassSI, honours solver["type"] euler/rk4/adaptive). The
        # serial convergence sweep sets "SI" so the per-sample runner can pick the solver.
        "stack": cfg.get("stack", "legacy"),
        "modelFileName": cfg["model"],
        "postProcessing": {"enabled": pp is not None, "filePath": pp},
        "plotResults": bool(cfg["plots"]),
        "plots": cfg["plots"],
        "printStatus": cfg["printStatus"],
        "progress": progressCfg,
    }

# endregion
####################################################################################################


####################################################################################################
# region per-stage updaters
####################################################################################################

def controllerUpdater(stage, calibrationStruct, otherStruct, states):
    for parameter, value in calibrationStruct.items():
        if parameter in stage['controlSensitivities'].keys():
            for sens in stage['controlSensitivities'][parameter].keys():
                if 'value' in sens:
                    states[parameter] = stage['controlSensitivities'][parameter][sens]
                else:
                    value['params'][sens] = stage['controlSensitivities'][parameter][sens]

    for parameter, value in otherStruct.items():
        if parameter in stage['controlSensitivities'].keys():
            for sens in stage['controlSensitivities'][parameter].keys():
                if 'value' in sens:
                    states[parameter] = stage['controlSensitivities'][parameter][sens]
                else:
                    value['params'][sens] = stage['controlSensitivities'][parameter][sens]



def calibratorUpdater(stage, i, calibrationStruct, modelStruct,
                      maxCubicFactor=_DEFAULT_MAX_CUBIC_FACTOR,
                      maxLinearFactor=_DEFAULT_MAX_LINEAR_FACTOR,
                      controllerLaw="cubic"):
    # Twin per-stage gains: multiplierC scales the model's cubicFactor seed, multiplierL the
    # linearFactor seed, each clamped independently. cube() sums both terms, so a stage is
    # cubic (mL=0) / linear (mC=0) / hybrid (both) purely by which multiplier is nonzero, all
    # from the scenario JSON. The model is the source of truth (it seeds both factors).
    multiplierC = stage.get('multiplierC', 0.0)
    multiplierL = stage.get('multiplierL', None)   # None -> legacy default via controllerLaw
    for parameter, value in calibrationStruct.items():
        if parameter in stage['parameters']:
            seed = modelStruct['calibration'][parameter]['params']
            k = seed['k']

            # An explicit per-stage multiplierL selects the twin-multiplier path. Otherwise a
            # bare multiplierC feeds the cubic term, or the linear term when the scenario
            # declares controllerLaw="linear" -- keeping existing single-law scenarios intact.
            if multiplierL is not None:
                mC, mL = multiplierC, multiplierL
            elif controllerLaw == "linear":
                mC, mL = 0.0, multiplierC
            else:
                mC, mL = multiplierC, 0.0

            value['params']['cubicFactor'] = utils.clamp(
                mC * seed['cubicFactor'], -maxCubicFactor, maxCubicFactor)
            value['params']['linearFactor'] = utils.clamp(
                mL * seed.get('linearFactor', 0.0), -maxLinearFactor, maxLinearFactor)
            value['params']['k'] = k

            if parameter in stage['targets']:
                value['params']['targetValue'] = stage['targets'][parameter]
            else:
                value['params']['targetValue'] = modelStruct['calibration'][parameter]['params']['targetValue']

        else:
            if i == 0:
                value['params']['cubicFactor'] = 0.0
                value['params']['linearFactor'] = 0.0
                value['params']['k'] = 0.0

# endregion
####################################################################################################

####################################################################################################
# region calibration strategy selector
####################################################################################################
# Two calibration weight schedules, selectable per scenario via calibration.strategy:
#   * "staged"   (default): the hand-authored calibration.stages[] list (existing behaviour).
#   * "adaptive": a geometric doubling ramp ported from My-ICU-Twin's updateControllerWeights.
#                 Each loop doubles the base cubic gain (loop k -> multiplierC = initialMultiplier
#                 * 2^(k-1)), which is exactly what calibratorUpdater applies + clamps. So the
#                 strategy is just a generated stage list; the runCalibration / batch loops are
#                 unchanged. Upstream's error-gated early stop is dropped (it can't vmap across the
#                 batched population's shared loop count) — instead we run the full maxLoops to
#                 completion. Converged params sit still under further doubling (error^3 ~ 0), and
#                 maxCubicFactor bounds the gain, so the extra loops are harmless.
####################################################################################################


def buildAdaptiveStages(calibrationConf):
    """Generate the adaptive doubling stage list from calibrationConf['adaptive'].

    Layout: a controllers-off warm-up (the upstream "run uncalibrated first"), maxLoops doubling
    stages, then a controllers-off hold-and-measure stage at the converged parameters."""
    adaptive = calibrationConf["adaptive"]
    parameters = adaptive["parameters"]
    initialMultiplier = adaptive.get("initialMultiplier", 1.0)
    maxLoops = adaptive["maxLoops"]
    ignorePerLoop = adaptive.get("runsToIgnorePerLoop", 1)
    savePerLoop = adaptive.get("runsToSavePerLoop", 0)

    # Each loop stage integrates (runsToIgnore + runsToSave) runs; with both 0 the doubled gain
    # is baked into the model but the model is never stepped, so parameters never move and the
    # whole ramp is a silent no-op. Require >=1 integrated run per loop.
    if maxLoops > 0 and (ignorePerLoop + savePerLoop) == 0:
        raise ValueError(
            "calibration.adaptive needs runsToIgnorePerLoop + runsToSavePerLoop >= 1, otherwise "
            "each doubling loop integrates zero runs and no calibration happens. Set "
            "runsToIgnorePerLoop to at least 1.")

    def _stage(description, multiplierC, params, runsToIgnore, runsToSave):
        return {
            "description": description,
            "runsToIgnore": runsToIgnore,
            "runsToSave": runsToSave,
            "multiplier": 0.0,
            "multiplierC": multiplierC,
            "parameters": params,
            "targets": {},
            "states": {},
        }

    stages = [_stage(
        "Settle uncalibrated (controllers off)", 0.0, [],
        adaptive.get("warmupRunsToIgnore", 5), 0)]

    for k in range(1, maxLoops + 1):
        stages.append(_stage(
            f"Adaptive loop {k} (multiplierC = {initialMultiplier * 2 ** (k - 1)})",
            initialMultiplier * 2 ** (k - 1), parameters, ignorePerLoop, savePerLoop))

    stages.append(_stage(
        "Hold and measure (controllers off, steady-state capture)", 0.0, parameters,
        0, adaptive.get("holdRunsToSave", 20)))
    return stages


def resolveStages(calibrationConf):
    """Return the calibration stage list for the configured strategy. Defaults to the existing
    hand-authored 'staged' schedule so behaviour is unchanged when strategy is absent."""
    if calibrationConf.get("strategy") == "adaptive":
        return buildAdaptiveStages(calibrationConf)
    return calibrationConf["stages"]

# endregion
####################################################################################################


####################################################################################################
# region runners
####################################################################################################

def runBaseline(simulationParams):
    """Single-run passive model from the equilibrium init (no ANS, no stages)."""
    print("Running Baseline (array mode)")
    modelStructure = modelClass.initialiseModel(simulationParams)
    states, modelStructure = stateSetup.configureStates(simulationParams, modelStructure, "baseline")

    eqDict, namesDict, mdd = modelClass.prepareModel(simulationParams, modelStructure)
    cpModel = modelClass.CardioPulmonaryModelArray(eqDict, namesDict, modelStructure)

    if not simulationParams["statesEquilibrium"]["use"]:
        states = dict(mdd["states"])            # raw generator init instead of equilibrium

    y0 = modelClass.encodeStates({**mdd["states"], **states}, namesDict)
    runsRes, finalY = modelClass.runSimulationArray(
        y0, cpModel, simulationParams, {}, mdd["structures"], mdd["constantList"])
    states = modelClass.decodeStates(finalY, namesDict)
    return states, mdd["modelObjects"], modelStructure, runsRes, mdd["structures"]


def runControl(simulationParams):
    """Multi-stage control (active ANS): configure once, then iterate the stack."""
    print("Running Control (array mode)")
    modelStructure = modelClass.initialiseModel(simulationParams)
    states, modelStructure = stateSetup.configureStates(simulationParams, modelStructure, "control")

    stack = simulationParams["simulationConf"]["control"]["stages"]
    controlStruct = modelStructure["control"]
    otherStruct = modelStructure["other"]

    runsRes, modelObjects, structures = {}, None, None
    try:
        for stage in stack:
            controllerUpdater(stage, controlStruct, otherStruct, states)
            for state in stage["states"]:
                states[state] = stage["states"][state]

            simulationParams["runsToIgnore"] = stage["runsToIgnore"]
            simulationParams["runsToSave"] = stage["runsToSave"]

            eqDict, namesDict, mdd = modelClass.prepareModel(simulationParams, modelStructure)
            cpModel = modelClass.CardioPulmonaryModelArray(eqDict, namesDict, modelStructure)
            modelObjects, structures = mdd["modelObjects"], mdd["structures"]

            y0 = modelClass.encodeStates({**mdd["states"], **states}, namesDict)
            runsRes, finalY = modelClass.runSimulationArray(
                y0, cpModel, simulationParams, runsRes, structures, mdd["constantList"])
            states = modelClass.decodeStates(finalY, namesDict)
    except Exception as e:
        print(e)
        print("Solver exception at T=", states.get("T"))
        return states, modelObjects, modelStructure, runsRes, structures

    return states, modelObjects, modelStructure, runsRes, structures


def runCalibration(simulationParams, stateOverrides=None):
    """Multi-stage calibration: set targets from twinTargets, iterate the stack.

    stateOverrides (optional) is a {stateName: value} dict applied once to the
    initial states after configureStates and before the stage loop — the seam the
    convergence-population study uses to inject a per-sample parameter draw (the
    swept calibration parameters are state initial values; the controllers then
    evolve them). The model's controllers carry these forward across stages.
    """
    print("Running Calibration (array mode)")
    modelStructure = modelClass.initialiseModel(simulationParams)
    twinTargets = simulationParams["simulationConf"]["shared"]["twin"]["twinTargets"]
    states, modelStructure = stateSetup.configureStates(
        simulationParams, modelStructure, "calibration", twinTargets=twinTargets)
    if stateOverrides:
        states.update(stateOverrides)

    calibrationConf = simulationParams["simulationConf"]["calibration"]
    stack = resolveStages(calibrationConf)
    maxCubicFactor = calibrationConf.get("maxCubicFactor", _DEFAULT_MAX_CUBIC_FACTOR)
    maxLinearFactor = calibrationConf.get("maxLinearFactor", _DEFAULT_MAX_LINEAR_FACTOR)
    controllerLaw = calibrationConf.get("controllerLaw", "cubic")
    modelStructureOriginal = copy.deepcopy(modelStructure)
    calibrationStruct = modelStructure["calibration"]

    runsRes, modelObjects, structures = {}, None, None
    for i, stage in enumerate(stack):
        calibratorUpdater(stage, i, calibrationStruct, modelStructureOriginal,
                          maxCubicFactor=maxCubicFactor, maxLinearFactor=maxLinearFactor,
                          controllerLaw=controllerLaw)
        for state in stage["states"]:
            states[state] = stage["states"][state]

        simulationParams["runsToIgnore"] = stage["runsToIgnore"]
        simulationParams["runsToSave"] = stage["runsToSave"]

        eqDict, namesDict, mdd = modelClass.prepareModel(simulationParams, modelStructure)
        cpModel = modelClass.CardioPulmonaryModelArray(eqDict, namesDict, modelStructure)
        modelObjects, structures = mdd["modelObjects"], mdd["structures"]

        y0 = modelClass.encodeStates({**mdd["states"], **states}, namesDict)
        runsRes, finalY = modelClass.runSimulationArray(
            y0, cpModel, simulationParams, runsRes, structures, mdd["constantList"])
        states = modelClass.decodeStates(finalY, namesDict)

    return states, modelObjects, modelStructure, runsRes, structures


def runCalibrationSI(simulationParams, stateOverrides=None):
    """Serial, single-sample calibration on the step-independent (SI) stack.

    The solver-selectable counterpart to runCalibration: same per-sample method (one
    sample, walk the calibration stack stage by stage), but the integrator is the SI
    stack's solveModelArray, which honours simulationParams["solver"]["type"]
    (euler / rk4 / adaptive) instead of legacy modelClass's hard-wired diffrax.Euler.

    Reuses runnerBatchSI.prepare() for the scalar (sample-independent) setup — the
    canonical state layout, base init dict and per-stage cpModels with their controller
    gains baked in — then runs the stages WITHOUT vmap (one sample). Returns the same
    (states, modelObjects, modelStructure, results, structures) contract as
    runCalibration, with `results` the identical name-keyed dense-trace dict (algebraic
    outputs first, integrated states win on collision) the legacy path produces, so the
    convergence notebook's per-sample loop is unchanged.
    """
    print("Running Calibration (SI stack, serial)")
    # Local imports: runnerBatchSI imports from this module, so importing it at module
    # scope would be a cycle; modelClassSI/jax are only needed on the SI path.
    from library.run import runnerBatchSI
    import library.model.modelClassSI as modelClassSI
    import jax.numpy as jnp
    import time

    sp = simulationParams
    solver = sp.get("solver", {"type": "euler"})
    dt0, runTime = sp["dt"], sp["runTime"]
    # progressEvery: emit a live convergence line every N SIMULATED seconds of the calibration
    # (0 = off). Timing is host-side, so the finest granularity is one run (runTime s); a smaller
    # progressEvery just prints every run. `debugEvery` is the deprecated former name (fallback).
    progressEvery = float(solver.get("progressEvery", solver.get("debugEvery")) or 0)

    prep = runnerBatchSI.prepare(sp)
    canonNames, nameIdx = prep["canonNames"], prep["nameIdx"]
    baseStates, modelStructure, stages = prep["baseStates"], prep["modelStructure"], prep["stages"]
    outNames = list(stages[-1]["cpModel"].outputNames)
    outIdx = {n: i for i, n in enumerate(outNames)}
    dtype = jnp.zeros(0).dtype                      # active default float (precision toggle)

    # Live-progress metrics: when the scenario declares its convergence observations (via
    # buildSimulationParams -> sp["progress"]), the tick reports obs-space |rel err| vs twin
    # targets for this single sample; otherwise it falls back to the bare wall-clock line.
    prog = sp.get("progress") or {}
    progObs, tArr, oArr = prog.get("observations"), prog.get("targetArr"), prog.get("offsetArr")
    metricsOn = bool(progressEvery) and progObs is not None and tArr is not None
    reporter = (progressLib.ProgressReporter(logEnabled=prog.get("logProgress", True),
                                             onEmit=prog.get("onEmit"))
                if metricsOn else None)

    # base init vector overlaid with the per-sample parameter draw (params ARE state names)
    y = np.array(modelClassSI.encodeStates(baseStates, {"stateNames": canonNames}), dtype=float)
    if stateOverrides:
        for name, val in stateOverrides.items():
            if name not in nameIdx:
                raise KeyError(f"stateOverride {name!r} is not a state name")
            y[nameIdx[name]] = float(val)
    y = jnp.asarray(y, dtype=dtype)

    # Warm-up (ignored) runs only need the carried final state, so use the final-state-only
    # solver (no dense trajectory stacked) for the vmappable fixed-step solvers. Its carry is
    # bit-identical to solveModelArray's (same sub-steps + same T0=T latch). Adaptive solvers
    # have no final-only variant, so they fall back to the dense solve.
    finalOnly = solver.get("type", "euler") in ("euler", "rk4")

    # Simulated-time progress: total sim seconds across every run of every stage, and a
    # host-side wall clock. `_tick` advances the sim clock by one run and, once it has
    # crossed the next progressEvery boundary, emits either the obs-space convergence line
    # (metricsOn) or the bare "sim A-B of TOTAL s -> Ws wall" line. block_until_ready() forces
    # the async solve to finish so the wall time is real, not just dispatch latency.
    simTotal = sum(s["runsToIgnore"] + s["runsToSave"] for s in stages) * runTime
    _clk = {"done": 0.0, "printed": 0.0, "tPrev": time.time(), "t0": time.time()}

    def _tick(yDev, outsRow):
        _clk["done"] += runTime
        if not progressEvery:
            return
        if _clk["done"] - _clk["printed"] >= progressEvery - 1e-9:
            if hasattr(yDev, "block_until_ready"):
                yDev.block_until_ready()
            now = time.time()
            if reporter is not None:
                yh = np.asarray(yDev)
                orow = np.asarray(outsRow) if outsRow is not None else None
                obs = np.array([yh[nameIdx[o]] if o in nameIdx
                                else (orow[outIdx[o]] if orow is not None and o in outIdx else np.nan)
                                for o in progObs])
                stats = progressLib.relErrorStats(obs - oArr, tArr)
                reporter.emit(kind="sim",
                              label=f"sim {_clk['printed']:.0f}-{_clk['done']:.0f}/{simTotal:.0f}s",
                              done=_clk["done"], total=simTotal, elapsedWall=now - _clk["t0"],
                              stats=stats, prefix="")
            else:
                print(f"sim {_clk['printed']:.0f}-{_clk['done']:.0f} of {simTotal:.0f} s "
                      f"-> {now - _clk['tPrev']:.2f}s wall")
            _clk["tPrev"] = now
            _clk["printed"] = _clk["done"]

    runsRes = {}
    for stage in stages:
        cpModel = stage["cpModel"]
        constants = jnp.asarray(stage["constantList"], dtype=dtype)
        for idx, val in stage["overrides"]:            # stage["states"] wins over the draw
            y = y.at[idx].set(jnp.asarray(val, dtype=dtype))

        for _ in range(stage["runsToIgnore"]):         # warm-up runs: integrate, carry, drop
            if finalOnly:
                y, outsRow = modelClassSI.solveFinalArray(cpModel, runTime, y, constants, dt0, 0.0, solver)
            else:
                _, _, outs, y = modelClassSI.solveModelArray(cpModel, runTime, y, constants, dt0, 0.0, solver)
                outsRow = outs[-1]
            _tick(y, outsRow)

        saveBlocks, outBlocks = [], []                 # saved runs: keep dense trajectory
        for _ in range(stage["runsToSave"]):
            _, ys, outs, sts = modelClassSI.solveModelArray(cpModel, runTime, y, constants, dt0, 0.0, solver)
            saveBlocks.append(np.asarray(ys[1:]))      # drop first row (matches legacy value[1:])
            outBlocks.append(np.asarray(outs[1:]))
            y = sts
            _tick(y, outs[-1])
        if saveBlocks:
            merged = np.concatenate(saveBlocks, axis=0)
            mergedOut = np.concatenate(outBlocks, axis=0)
            block = {key: mergedOut[:, i] for i, key in enumerate(outNames)}      # flows first
            block.update({key: merged[:, i] for i, key in enumerate(canonNames)})  # states win
            runsRes = block if runsRes == {} else {
                key: np.concatenate((runsRes[key], block[key]), axis=0) for key in block}

    if progressEvery and _clk["done"] > _clk["printed"] and reporter is None:
        now = time.time()                                  # bare wall-clock final partial block
        print(f"sim {_clk['printed']:.0f}-{_clk['done']:.0f} of {simTotal:.0f} s "
              f"-> {now - _clk['tPrev']:.2f}s wall")
    if reporter is not None:                               # expose the trace to the caller/notebook
        sp["progress"].setdefault("records", []).extend(reporter.records)

    states = {n: float(v) for n, v in zip(canonNames, np.asarray(y))}
    return states, None, modelStructure, runsRes, None


_RUNNERS = {"baseline": runBaseline, "calibration": runCalibration, "control": runControl}


def run(simulationParams, stateOverrides=None):
    """Dispatch on the mode flags and run. Returns
    (states, modelObjects, modelStructure, results, structures).

    stateOverrides is forwarded to calibration mode only (the convergence-population
    per-sample parameter injection); baseline/control ignore it."""
    if simulationParams["baseline"]:
        mode = "baseline"
    elif simulationParams["calibration"]:
        mode = "calibration"
    else:
        mode = "control"
    if mode == "calibration":
        if simulationParams.get("stack") == "SI":
            return runCalibrationSI(simulationParams, stateOverrides=stateOverrides)
        return runCalibration(simulationParams, stateOverrides=stateOverrides)
    return _RUNNERS[mode](simulationParams)

# endregion
####################################################################################################
