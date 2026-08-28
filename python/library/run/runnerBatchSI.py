####################################################################################################
# runnerBatchSI.py  —  batched (vmapped) population calibration on the step-independent stack
#
# The serial Convergence_Run loops over N sampled models one-by-one (runner.runCalibration
# per sample), so the GPU is never filled and there is no parallelism. This module integrates
# the population as BATCHED solves (jax.vmap over the initial-state matrix) — the
# embarrassingly-parallel lever the BATCH_PLAN identifies.
#
# It mirrors runner.runCalibration's stage logic exactly, but:
#   * carries the population state in ARRAY/INDEX space (chunk, nState) on-device across
#     stages, replacing the serial path's per-stage name-keyed decode/encode round-trip;
#   * loops OVER SAMPLE CHUNKS on the outside (bounds VRAM) and over stages on the inside
#     (samples are independent, so each chunk runs the whole calibration on its own);
#   * integrates ignored (warm-up) runs with the cheap final-state-only SI solvers and saved
#     runs with the dense solver, so memory is bounded yet full traces are available;
#   * optionally STREAMS every saved run's dense block (chunk, nDense, C) straight to disk via
#     an async writer (hdf5.raw_stream) — so the full (N, T_total, C) raw tensor (tens of GB)
#     is never held in RAM/VRAM, and the disk write overlaps the next chunk's GPU compute;
#   * has no per-sample try/except: diverged lanes propagate NaN/Inf and the caller masks them.
#
# Per-sample variation is purely y0 (the swept calibration params ARE state names); the stage
# stack, controllers, per-stage stage["states"] overrides and model constants are identical
# across samples, so the per-stage cpModels are built ONCE (scalar) and reused for every chunk.
#
# Entry point: batchedCalibration(simulationParams, sampled_params, param_names, observations)
####################################################################################################

import copy
import time

import numpy as np
import jax
import jax.numpy as jnp

import library.model.modelClassSI as mc
import library.run.stateSetup as stateSetup
import library.run.progress as progressLib
from library.run.runner import calibratorUpdater   # per-stage gain updater (reused)


def _floatDtype():
    """The active JAX default float dtype (float64 when jax_enable_x64, else float32) — so the
    batch follows the notebook's precision toggle without hard-coding float64."""
    return jnp.zeros(0).dtype


def _prepareStages(sp):
    """Scalar (sample-independent) setup. Builds the canonical state layout, the base initial
    state dict, and one resolved cpModel per calibration stage (with that stage's controller
    gains/targets baked in). Returns everything the chunk loop needs.

    The per-stage cpModels are built here ONCE and reused for every sample chunk — only the
    integrate is vmapped, so nothing recompiles per chunk."""
    modelStructure = mc.initialiseModel(sp)
    twinTargets = sp["simulationConf"]["shared"]["twin"]["twinTargets"]
    states, modelStructure = stateSetup.configureStates(
        sp, modelStructure, "calibration", twinTargets=twinTargets)

    calibrationConf = sp["simulationConf"]["calibration"]
    stack = calibrationConf["stages"]
    maxCubicFactor = calibrationConf.get("maxCubicFactor", 1.0)
    maxLinearFactor = calibrationConf.get("maxLinearFactor", 1.0)
    modelStructureOriginal = copy.deepcopy(modelStructure)
    calibrationStruct = modelStructure["calibration"]

    # canonical layout + base init vector (stateNames is calibration-gain-independent)
    _, namesDict0, mdd0 = mc.prepareModel(sp, modelStructure)
    canonNames = namesDict0["stateNames"]
    nameIdx = {n: i for i, n in enumerate(canonNames)}
    baseStates = {**mdd0["states"], **states}     # matches serial encode({**mdd["states"], **states})

    stages = []
    for i, stage in enumerate(stack):
        # mutates calibrationStruct in place — reads from the frozen Original, so building the
        # stages in order reproduces the inline runCalibration loop's per-stage cpModels.
        calibratorUpdater(stage, i, calibrationStruct, modelStructureOriginal,
                          maxCubicFactor=maxCubicFactor, maxLinearFactor=maxLinearFactor)
        eqDict, namesDict, mdd = mc.prepareModel(sp, modelStructure)
        cpModel = mc.CardioPulmonaryModelArray(eqDict, namesDict, modelStructure)
        assert namesDict["stateNames"] == canonNames, (
            "stateNames drifted between calibration stages; array-space carry needs a "
            "reorder map (see runnerBatchSI design).")
        overrides = [(nameIdx[s], float(v)) for s, v in stage["states"].items()]
        stages.append({
            "cpModel": cpModel,
            "constantList": mdd["constantList"],
            "overrides": overrides,                    # stage["states"] -> constant scatter
            "runsToIgnore": int(stage["runsToIgnore"]),
            "runsToSave": int(stage["runsToSave"]),
        })
    return canonNames, nameIdx, baseStates, modelStructure, stages


def prepare(simulationParams):
    """Run the scalar setup once (build per-stage cpModels + layout). Returned dict can be
    passed back to batchedCalibration as `prepared=` to avoid re-preparing, and to rawLayout
    so the caller can size/create the HDF5 file before the run (init_population needs the
    canonical state names up front)."""
    canonNames, nameIdx, baseStates, modelStructure, stages = _prepareStages(simulationParams)
    return {"canonNames": canonNames, "nameIdx": nameIdx, "baseStates": baseStates,
            "modelStructure": modelStructure, "stages": stages}


def rawLayout(simulationParams, prepared=None):
    """Raw-tensor layout for the streaming writer / file setup: column names (all states +
    algebraic outputs), total saved-time length, per-run window length, and the time axis."""
    sp = simulationParams
    prep = prepared or prepare(sp)
    stages, canonNames = prep["stages"], prep["canonNames"]
    outNames = list(stages[-1]["cpModel"].outputNames)
    signalNames = list(canonNames) + outNames
    dtDense = float(stages[-1]["cpModel"].dtDense)
    nDense = int(round(sp["runTime"] / dtDense))
    totalSavedPoints = sum(s["runsToSave"] for s in stages) * nDense
    return {"stateNames": canonNames, "signalNames": signalNames,
            "totalSavedPoints": totalSavedPoints, "nDense": nDense,
            "globalT": np.arange(totalSavedPoints) * dtDense}


def batchedCalibration(simulationParams, sampled_params, param_names, observations,
                       chunkSize=256, printStatus=True, printEveryPct=None, traceNames=None,
                       rawWriterFactory=None, prepared=None):
    """Run the multi-stage calibration for a whole population as batched, chunked solves.

    Args:
        simulationParams: the buildSimulationParams dict (mode must be calibration).
        sampled_params:   (N, P) LHS sample matrix; columns map to param_names.
        param_names:      list of P swept calibration parameter names (== state names).
        observations:     list of observation names to read at convergence.
        chunkSize:        samples per vmap (VRAM bound); also the streaming granularity.
        printEveryPct:    print progress every this % of chunks (last chunk always prints).
                          None = every chunk.
        traceNames:       optional signals to keep as an in-memory converged window (for the
                          calibration plot). None = no window.
        rawWriterFactory: optional callable (signalNames, totalPoints, time, nDense) -> a
                          RawTraceStreamWriter. When given, EVERY saved run is solved densely
                          and streamed to disk as a (chunk, nDense, C) block (C = all states +
                          algebraic outputs). When None, saved runs use the cheap final-only
                          solver and nothing dense is written.
        prepared:         optional dict from prepare() to skip re-preparing (the notebook uses
                          it so file setup + the run share one prep).

    Returns dict with:
        rawObs (N,nObs), finalStates (N,nState), stateNames, modelStructure,
        traceT (nT,) / traces {name:(N,nT)} (converged window, or None),
        signalNames (raw column order) and totalSavedPoints (raw time length).
    """
    sp = simulationParams
    N, P = sampled_params.shape
    assert P == len(param_names), "sampled_params columns must match param_names"
    solver = sp.get("solver", {"type": "euler"})
    dt0 = sp["dt"]
    runTime = sp["runTime"]
    dtype = _floatDtype()
    step = N if (chunkSize is None or chunkSize <= 0) else int(chunkSize)
    # progressEvery: emit a live convergence line every N SIMULATED seconds while a chunk
    # integrates (0 = off). Host-side timing, so granularity is one run (runTime s). The sim
    # clock restarts per chunk. `debugEvery` is the deprecated former name (fallback).
    progressEvery = float(solver.get("progressEvery", solver.get("debugEvery")) or 0)

    prep = prepared or prepare(sp)
    canonNames, nameIdx = prep["canonNames"], prep["nameIdx"]
    baseStates, modelStructure, stages = prep["baseStates"], prep["modelStructure"], prep["stages"]
    nState = len(canonNames)
    simTotalChunk = sum(s["runsToIgnore"] + s["runsToSave"] for s in stages) * runTime  # sim-time progress

    # raw layout: columns = all states then all algebraic outputs; rows = saved runs * nDense
    outNames = list(stages[-1]["cpModel"].outputNames)
    outIdx = {n: i for i, n in enumerate(outNames)}

    # Live-progress metrics: when the scenario declares its convergence observations (via
    # buildSimulationParams -> sp["progress"]), each tick reports population obs-space |rel err|
    # vs twin targets; otherwise it falls back to the bare wall-clock line. Targets/offsets are
    # aligned by name to THIS call's `observations`, and the trace is returned as result["progress"].
    prog = sp.get("progress") or {}
    metricsOn = bool(progressEvery) and prog.get("targetArr") is not None
    reporter = progressLib.ProgressReporter(logEnabled=prog.get("logProgress", True),
                                            onEmit=prog.get("onEmit")) if metricsOn else None
    if metricsOn:
        tgtByObs = dict(zip(prog["observations"], prog["targetArr"]))
        offByObs = dict(zip(prog["observations"], prog["offsetArr"]))
        progTgt = np.array([tgtByObs.get(o, np.nan) for o in observations])
        progOff = np.array([offByObs.get(o, 0.0) for o in observations])

    def _obsMatrix(Yh, fohH):
        """(M, nObs) population observations read from states (win) then algebraic outputs,
        mirroring the end-of-chunk observation read."""
        out = np.full((Yh.shape[0], len(observations)), np.nan)
        for j, o in enumerate(observations):
            if o in nameIdx:
                out[:, j] = Yh[:, nameIdx[o]]
            elif fohH is not None and o in outIdx:
                out[:, j] = fohH[:, outIdx[o]]
        return out

    def _emitProgress(yDev, foh, tag, simClk):
        """block, read obs, and emit the convergence line (or bare wall-clock fallback)."""
        if hasattr(yDev, "block_until_ready"):
            yDev.block_until_ready()
        now = time.time()
        if reporter is not None:
            gauge = _obsMatrix(np.asarray(yDev),
                               np.asarray(foh) if foh is not None else None) - progOff
            reporter.emit(kind="sim",
                          label=f"{tag}sim {simClk['printed']:.0f}-{simClk['done']:.0f}/{simTotalChunk:.0f}s",
                          done=simClk["done"], total=simTotalChunk, elapsedWall=now - simClk["t0"],
                          stats=progressLib.relErrorStats(gauge, progTgt), prefix="")
        else:
            print(f"{tag}sim {simClk['printed']:.0f}-{simClk['done']:.0f} of "
                  f"{simTotalChunk:.0f} s -> {now - simClk['tPrev']:.2f}s wall")
        simClk["tPrev"] = now
        simClk["printed"] = simClk["done"]
    signalNames = list(canonNames) + outNames
    sigIdx = {n: i for i, n in enumerate(signalNames)}
    dtDense = float(stages[-1]["cpModel"].dtDense)
    nDense = int(round(runTime / dtDense))
    totalSavedRuns = sum(s["runsToSave"] for s in stages)
    totalSavedPoints = totalSavedRuns * nDense
    windowT = np.linspace(0.0, runTime, nDense + 1)[1:]            # one saved-run window (s)
    globalT = np.arange(totalSavedPoints) * dtDense               # continuous saved clock (s)

    # ---- build Y0 (N, nState): base overlaid with per-sample draws -----------------------
    baseVec = np.asarray(mc.encodeStates(baseStates, {"stateNames": canonNames}))
    Y0 = np.tile(baseVec, (N, 1))
    for j, p in enumerate(param_names):
        if p not in nameIdx:
            raise KeyError(f"swept param {p!r} is not a state name")
        Y0[:, nameIdx[p]] = sampled_params[:, j]

    # ---- vmapped solvers (map over the chunk's rows; cpModel/constants shared) ------------
    def finalOnly(cpModel, constants):
        return jax.vmap(lambda y: mc.solveFinalArray(cpModel, runTime, y, constants, dt0, 0.0, solver))

    def dense(cpModel, constants):
        return jax.vmap(lambda y: mc.solveModelArray(cpModel, runTime, y, constants, dt0, 0.0, solver))

    streaming = rawWriterFactory is not None and totalSavedPoints > 0
    writer = (rawWriterFactory(signalNames, totalSavedPoints, globalT, nDense)
              if streaming else None)

    finalStates = np.empty((N, nState))
    rawObs = np.full((N, len(observations)), np.nan)
    traces = {n: np.full((N, nDense), np.nan) for n in (traceNames or [])} or None

    nChunks = (N + step - 1) // step
    printEvery = (max(1, round(nChunks * printEveryPct / 100))
                  if printEveryPct else 1)

    t0 = time.time()
    tPrev = t0
    try:
        for k, cs0 in enumerate(range(0, N, step)):
            cs1 = min(cs0 + step, N)
            Y = jnp.asarray(Y0[cs0:cs1], dtype=dtype)
            constsByStage = [jnp.asarray(s["constantList"], dtype=dtype) for s in stages]
            tCursor = 0
            finalOutsChunk = None
            lastBlock = None                      # (cs, nDense, C) of the final converged run

            # per-chunk simulated-time progress clock (see progressEvery above)
            simClk = {"done": 0.0, "printed": 0.0, "tPrev": time.time(), "t0": time.time()}
            tag = f"[chunk {k}] " if nChunks > 1 else ""

            def _tick(yDev, foh):
                simClk["done"] += runTime
                if progressEvery and simClk["done"] - simClk["printed"] >= progressEvery - 1e-9:
                    _emitProgress(yDev, foh, tag, simClk)

            for s, stage in enumerate(stages):
                cpModel, constants = stage["cpModel"], constsByStage[s]
                for idx, val in stage["overrides"]:           # stage["states"] wins over draw
                    Y = Y.at[:, idx].set(jnp.asarray(val, dtype=dtype))

                solveFinal = finalOnly(cpModel, constants)
                for _ in range(stage["runsToIgnore"]):        # warm-up: cheap, not saved
                    Y, finalOutsChunk = solveFinal(Y)
                    _tick(Y, finalOutsChunk)

                if stage["runsToSave"] and streaming:
                    solveDense = dense(cpModel, constants)
                    for _ in range(stage["runsToSave"]):
                        _, ys, outs, sts = solveDense(Y)      # ys (cs,nDense+1,nState)
                        block = jnp.concatenate([ys[:, 1:, :], outs[:, 1:, :]], axis=2)
                        writer.submit(cs0, tCursor, block)    # host copy here, disk write async
                        tCursor += int(block.shape[1])
                        lastBlock = np.asarray(block)
                        finalOutsChunk = outs[:, -1, :]
                        Y = sts
                        _tick(Y, finalOutsChunk)
                else:
                    for _ in range(stage["runsToSave"]):      # not streaming -> final-only
                        Y, finalOutsChunk = solveFinal(Y)
                        _tick(Y, finalOutsChunk)

            if progressEvery and simClk["done"] > simClk["printed"]:   # final partial block
                _emitProgress(Y, finalOutsChunk, tag, simClk)

            # ---- chunk done: final states + observations -----------------------------
            Yh = np.asarray(Y)
            finalStates[cs0:cs1] = Yh
            foh = np.asarray(finalOutsChunk) if finalOutsChunk is not None else None
            for k, o in enumerate(observations):
                if o in nameIdx:                              # states win on name collision
                    rawObs[cs0:cs1, k] = Yh[:, nameIdx[o]]
                elif foh is not None and o in outIdx:
                    rawObs[cs0:cs1, k] = foh[:, outIdx[o]]

            # ---- converged window for the plot -------------------------------------------
            if traces is not None:
                if lastBlock is not None:                     # streaming: reuse final block
                    for name in traces:
                        if name in sigIdx:
                            traces[name][cs0:cs1] = lastBlock[:, :, sigIdx[name]]
                else:                                         # else one extra dense window
                    _, ys, outs, _ = dense(stages[-1]["cpModel"], constsByStage[-1])(Y)
                    ysH, outsH = np.asarray(ys), np.asarray(outs)
                    for name in traces:
                        if name in nameIdx:
                            traces[name][cs0:cs1] = ysH[:, 1:, nameIdx[name]]
                        elif name in outIdx:
                            traces[name][cs0:cs1] = outsH[:, 1:, outIdx[name]]

            if printStatus and ((k + 1) % printEvery == 0 or k == nChunks - 1):
                now = time.time()
                print(f"{np.round(now - tPrev, 4)} -> Chunk:{k} of {nChunks - 1} completed! "
                      f"({cs0}:{cs1}/{N}, {now - t0:.1f}s total)"
                      + (f", streamed {tCursor} pts/sample" if streaming else ""))
                tPrev = now
    finally:
        if writer is not None:
            writer.close()

    if printStatus and streaming:
        print(f"  raw streamed: ({N}, {totalSavedPoints}, {len(signalNames)}) {dtype}")

    return {
        "rawObs": rawObs,
        "finalStates": finalStates,
        "stateNames": canonNames,
        "modelStructure": modelStructure,
        "traceT": windowT if traces is not None else None,
        "traces": traces,
        "signalNames": signalNames,
        "totalSavedPoints": totalSavedPoints,
        "progress": reporter.records if reporter is not None else [],
    }


def prepareBaseline(simulationParams):
    """Scalar (sample-independent) setup for a batched BASELINE forward solve on the SI stack.

    Mirrors runner.runBaseline's build — initialiseModel + configureStates("baseline") +
    prepareModel — but on the SI stack (modelClassSI) so the batched solve uses the same
    solveFinalArray core the calibration path vmaps. Built ONCE and reused for every chunk.

    Returns (cpModel, constants, y0, stateNames): the resolved SI model, its constant list,
    the equilibrium baseline initial-state vector (nState,), and the canonical state names.
    """
    sp = simulationParams
    modelStructure = mc.initialiseModel(sp)
    states, modelStructure = stateSetup.configureStates(sp, modelStructure, "baseline")
    eqDict, namesDict, mdd = mc.prepareModel(sp, modelStructure)
    cpModel = mc.CardioPulmonaryModelArray(eqDict, namesDict, modelStructure)
    if not sp.get("statesEquilibrium", {}).get("use", True):
        states = dict(mdd["states"])              # raw generator init instead of equilibrium
    y0 = np.asarray(mc.encodeStates({**mdd["states"], **states}, namesDict))
    return cpModel, mdd["constantList"], y0, namesDict["stateNames"]


def batchedBaselineSI(simulationParams, nrModels, chunkSize=-1, prepared=None):
    """Solve a single `runTime`-second BASELINE forward window for `nrModels` identical lanes
    as a chunked jax.vmap on the SI stack, and block until the device is done.

    This is the batched counterpart of runner.runBaseline used for the wall-clock/scaling
    timing comparison (R1-C8 / R2-m2): the unit of work is one forward solve, run N ways.
    Lanes are identical baseline copies — wall-clock is parameter-independent, so this measures
    pure parallel-solve throughput (the scaling quantity). The serial leg of the comparison is
    just this function called at nrModels=1 in a loop; the batch/GPU legs call it at nrModels=N.

    Reuses solveFinalArray (final-state-only, memory-bounded) — the euler/rk4 vmappable SI
    solvers, dispatched from simulationParams["solver"]; adaptive solvers don't vmap.
    chunkSize<=0 runs all N in one vmap; else it tiles by chunkSize exactly like
    batchedCalibration (VRAM bound). Returns finalStates (N, nState) as a host numpy array
    (device is blocked before return, so the caller can time the call).
    """
    sp = simulationParams
    N = int(nrModels)
    solver = sp.get("solver", {"type": "euler"})
    dt0, runTime = sp["dt"], sp["runTime"]
    dtype = _floatDtype()

    cpModel, constantList, y0, stateNames = prepared or prepareBaseline(sp)
    nState = len(stateNames)
    constants = jnp.asarray(constantList, dtype=dtype)

    solveFinal = jax.vmap(
        lambda y: mc.solveFinalArray(cpModel, runTime, y, constants, dt0, 0.0, solver))

    step = N if (chunkSize is None or chunkSize <= 0) else int(chunkSize)
    finalStates = np.empty((N, nState))
    Y0row = jnp.asarray(y0, dtype=dtype)
    for cs0 in range(0, N, step):
        cs1 = min(cs0 + step, N)
        Y = jnp.broadcast_to(Y0row, (cs1 - cs0, nState))
        Yf, _ = solveFinal(Y)
        Yf.block_until_ready()                    # make the returned timing real (JAX is async)
        finalStates[cs0:cs1] = np.asarray(Yf)
    return finalStates
