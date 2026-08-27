####################################################################################################
# modelClass.py  —  ARRAY-mode orchestration for the CardioPulmonary model
#
# This is the array-mode counterpart of models.py. It runs the model on a single
# flat jnp vector (integer indexing, jit-friendly) instead of a name-keyed dict,
# while reproducing models.py's behaviour term-for-term.
#
# The stack:
#     modelClass.initialiseModel  -> load JSON + metadata          (== models.initialiseModel)
#     modelClass.prepareModel     -> JSON model -> flat array model (the "array compiler")
#     modelClass.CardioPulmonaryModelArray -> the jitted RHS        (mirror of models.CardioPulmonaryModel)
#     modelClass.runSimulationArray        -> fixed-step Euler loop (mirror of models.runSimulation)
#
# Why this works on the dict equations: every equation method indexes y[self.x] /
# constants[self.x]. prepareModel resolves self.x from a name to an int once, so
# the *same* method body runs over a flat array. See modelEq.resolveEquation.
#
# Layout discovered from the CPET model (model_CPETtest_1.json):
#   * 439 INTEGRATED states  (capacitors, inductors, parameterVariation,
#     concentrations, reactions, connections, timekeeping, other, T, T0).
#   * 42 ALGEBRAIC intermediates that the dict RHS keeps transiently in yTmp
#     (10 resistor flows, 14 membrane flows, 9 multi-flow gas flows, 9 multi-flow
#     partial pressures). These are NOT integrated; they are recomputed every RHS
#     call. We give them appended slots so equations can index them by int.
#   => extended vector length = 439 + 42 = 481. The integrator only advances the
#      first 439; the RHS pads to 481, fills the algebraic slots, then reads them.
####################################################################################################

import os
import time
import copy
import math
from functools import partial

import numpy as np
import jax
import jax.numpy as jnp
import equinox as eqx
import diffrax


import library.model.modelGen as modelGen
import library.model.modelEq as eq
import library.utils as utils


####################################################################################################
# region Initialise & createModel  (parity copies of models.py)
####################################################################################################

def initialiseModel(simulationParams):
    """Load metadata + model JSON into a modelStructure. Identical to models.initialiseModel."""
    metadata = utils.loadJSONfile(utils.configPath('metadata.json'))

    modelStructure = utils.loadJSONfile(
        utils.configPath('models', simulationParams['modelFileName']))

    modelStructure['data'] = metadata['data']
    modelStructure['gasRegions'] = metadata['gasRegions']

    # Run/integration parameters are no longer baked into the model JSON (which now
    # holds model *structure* only). We build modelStructure['configurations'] here
    # from simulationParams + the scenario, keeping the internal shape every
    # downstream reader expects.
    #   dt      — integration step. The notebook override (simulationParams['dt'])
    #             wins; otherwise the scenario's shared.integration.dt (the reaction
    #             dt the model was tuned at) is used.
    #   dtDense — the save/output grid (formerly the _DT_DENSE module constant).
    dt = simulationParams.get('dt')
    if dt is None:
        dt = simulationParams['simulationConf']['shared']['integration']['dt']
    modelStructure['configurations'] = {
        'simulationParameters': {
            'dt': dt,
            'dtDense': simulationParams.get('dtDense', _DT_DENSE_DEFAULT),
            'control': simulationParams['control'],
            'calibration': simulationParams['calibration'],
            'gasExchange': simulationParams['gasExchange']['enabled'],
        }
    }

    return modelStructure


def createModel(simulationParams, modelStructure):
    """Build the (name-keyed) equation objects via the single modelGen route
    initModelObjectsNewGasExchange, which branches internally on the gasExchange
    flag: gas enabled -> Cabeleira gas build, disabled -> its no-gas (initModelObjects)
    fallback. Both produce modelEq objects that prepareModel resolves for array mode.
    Only the legacy 'Lu1998' gas method is unsupported here."""
    enabled = simulationParams['gasExchange']['enabled'] is True
    if enabled and simulationParams['gasExchange'].get('method') != 'new':
        raise ValueError(
            "modelClass (array mode) supports only gasExchange.method == 'new'. "
            f"Got {simulationParams['gasExchange'].get('method')!r}."
        )
    modelStructure['configurations']['simulationParameters']['gasExchange'] = enabled
    states, modelObjects, structures = modelGen.initModelObjectsNewGasExchange(modelStructure)
    return states, modelObjects, structures

# endregion
####################################################################################################


####################################################################################################
# region prepareModel  —  JSON model -> flat-array model ("the array compiler")
#
# Produces three dicts consumed by CardioPulmonaryModelArray and the runners:
#   eqDict          : resolved equation objects, bucketed.
#   namesDict       : the flat layout (stateNames/extNames, name2idx, const2idx),
#                     per-bucket output-slot index lists, and the multi-flow maps.
#   modelDataDict   : initial flat state vector, constants vector, raw structures.
#
# CANONICAL STATE ORDER (single source of truth, defined here once):
#   capacitors -> inductors -> parameterVariation -> concentrations -> reactions
#   -> connections -> timekeeping(trigger,timer per obj) -> other -> T -> T0
# followed by the appended ALGEBRAIC slots:
#   resistor flows -> membrane flows -> multi-flow gas flows -> multi-flow partial pressures
####################################################################################################

# The output state-name of an equation depends on its bucket (mirrors how
# models.CardioPulmonaryModel.__call__ keys each derivative dict).
def _stateNameOf(bucket, key, eqObj):
    if bucket == 'inductors':
        return eqObj.flowIdx
    if bucket == 'parameterVariation':
        return eqObj.varToControlIdx
    # capacitors / concentrations / reactions / connections / other are keyed by
    # the generator's dict key, which is the state name.
    return key


def prepareModel(simulationParams, modelStructure):
    # ---- 1. Build the name-keyed model (proven dict generator, array equations) ----
    states, modelObjects, structures = createModel(simulationParams, modelStructure)
    dt = modelStructure['configurations']['simulationParameters']['dt']

    #############################################################
    # region Build the canonical STATE ordering + output buckets
    #############################################################
    # Each entry: (bucketKey, equationObject, outputStateName). Order == canonical.
    stateBuckets = ['capacitors', 'inductors', 'parameterVariation', 'concentrations',
                    'reactions', 'connections']

    orderedEq = {}      # bucket -> [equationObject, ...]   (RHS evaluation order)
    orderedOut = {}     # bucket -> [outputStateName, ...]  (where each output is scattered)
    stateNames = []     # the 439 integrated-state names, in canonical order

    for bucket in stateBuckets:
        orderedEq[bucket] = []
        orderedOut[bucket] = []
        for key, eqObj in modelObjects[bucket].items():
            name = _stateNameOf(bucket, key, eqObj)
            orderedEq[bucket].append(eqObj)
            orderedOut[bucket].append(name)
            stateNames.append(name)

    # timekeeping: each PeriodicTrigger owns TWO states (trigger then timer).
    orderedEq['timekeeping'] = []
    timekeepingOut = []   # [(triggerName, timerName), ...]
    for key, eqObj in modelObjects['timekeeping'].items():
        orderedEq['timekeeping'].append(eqObj)
        timekeepingOut.append((eqObj.triggerIdx, eqObj.timerIdx))
        stateNames.append(eqObj.triggerIdx)
        stateNames.append(eqObj.timerIdx)

    # other
    orderedEq['other'] = []
    orderedOut['other'] = []
    for key, eqObj in modelObjects['other'].items():
        orderedEq['other'].append(eqObj)
        orderedOut['other'].append(key)
        stateNames.append(key)

    # T / T0 always last (the timekeeping rounding convention depends on it).
    stateNames.append('T')
    stateNames.append('T0')

    nState = len(stateNames)
    assert set(stateNames) == set(states.keys()), (
        "canonical stateNames != generator states: "
        f"missing={set(states.keys()) - set(stateNames)}, extra={set(stateNames) - set(states.keys())}"
    )
    assert len(stateNames) == len(set(stateNames)), "duplicate state name in canonical order"
    # endregion

    #############################################################
    # region Enumerate ALGEBRAIC intermediate names (appended slots)
    #############################################################
    resistorFlowNames = [r.flowIdx for r in modelObjects['resistors'].values()]
    membraneFlowNames = [m.flowIdx for m in modelObjects['membraneResistors'].values()]

    multiflowQNames = []
    multiflowPNames = []
    # Reproduce the dict RHS's constructed names (models.py:414-415):
    #   flow name  = 'Q_' + volume[2:4] + '_' + flowIdx[2:]
    #   pp   name  = 'P_' + volume[2:]
    for mf in modelObjects['multiFlowResistors'].values():
        for volume in mf.volumes['out']:
            multiflowQNames.append('Q_' + volume[2:4] + '_' + mf.flowIdx[2:])
            multiflowPNames.append('P_' + volume[2:])

    algebraicNames = resistorFlowNames + membraneFlowNames + multiflowQNames + multiflowPNames
    # The subset of the algebraic tail that the dict oracle exposes as result
    # outputs (models.py: out = concentrations | flow | membraneFlow). These are
    # the flow keys absent from the integrated state vector — resistor, membrane
    # and multi-flow gas flows — and they sit FIRST in algebraicNames (before the
    # multi-flow partial pressures, which the dict path does not output).
    flowOutputNames = resistorFlowNames + membraneFlowNames + multiflowQNames
    extNames = stateNames + algebraicNames
    nExt = len(extNames)
    name2idx = {n: i for i, n in enumerate(extNames)}
    # endregion

    #############################################################
    # region Constants table
    #############################################################
    constantNames = list(modelObjects['constants'].keys())
    constantValues = [modelObjects['constants'][n] for n in constantNames]
    const2idx = {n: i for i, n in enumerate(constantNames)}
    constantList = jnp.asarray([float(v) for v in constantValues], dtype=jnp.float64)
    # endregion

    #############################################################
    # region Resolve every equation's name fields -> int indices
    #############################################################
    resolvedEq = {b: [eq.resolveEquation(o, name2idx, const2idx) for o in objs]
                  for b, objs in orderedEq.items()}
    resistorsR = [eq.resolveEquation(r, name2idx, const2idx) for r in modelObjects['resistors'].values()]
    membranesR = [eq.resolveEquation(m, name2idx, const2idx) for m in modelObjects['membraneResistors'].values()]
    multiflowR = [eq.resolveEquation(m, name2idx, const2idx) for m in modelObjects['multiFlowResistors'].values()]
    # endregion

    #############################################################
    # region Output-slot index lists (where each bucket scatters its derivative)
    #############################################################
    # NOTE: slots are kept as plain Python int lists (NOT jnp arrays). cpModel is
    # passed to jax.jit as a STATIC argument and equinox must hash it; jnp arrays
    # in fields are unhashable. jnp indexing (y[list], x.at[list].set) accepts
    # Python int lists directly, so this costs nothing at runtime.
    def slots(names):
        return [name2idx[n] for n in names]

    capSlots  = slots(orderedOut['capacitors'])
    indSlots  = slots(orderedOut['inductors'])
    pvSlots   = slots(orderedOut['parameterVariation'])
    concSlots = slots(orderedOut['concentrations'])
    rxnSlots  = slots(orderedOut['reactions'])
    connSlots = slots(orderedOut['connections'])
    otherSlots = slots(orderedOut['other'])
    trigSlots  = [name2idx[t] for (t, _) in timekeepingOut]
    timerSlots = [name2idx[tm] for (_, tm) in timekeepingOut]
    TSlot  = name2idx['T']
    T0Slot = name2idx['T0']

    resFlowSlots = slots(resistorFlowNames)
    memFlowSlots = slots(membraneFlowNames)
    # endregion

    #############################################################
    # region Multi-flow index maps (replace dict-RHS string surgery)
    #############################################################
    # For each multi-flow resistor we precompute the integer slots it writes:
    #   outFlowSlots  : algebraic Q slot per out-volume
    #   ppSlots       : algebraic partial-pressure slot per out-volume
    #   parentPpSlots : 'P_' + volume[5:]  (parent compartment total pressure)
    #   volSlots      : 'V_' + volume[2:]  (partial volume state) == the volume name
    multiFlowMaps = []
    for mf in modelObjects['multiFlowResistors'].values():
        outFlow, pp, parentPp, vol = [], [], [], []
        for volume in mf.volumes['out']:
            outFlow.append(name2idx['Q_' + volume[2:4] + '_' + mf.flowIdx[2:]])
            pp.append(name2idx['P_' + volume[2:]])
            parentPp.append(name2idx['P_' + volume[5:]])
            vol.append(name2idx['V_' + volume[2:]])
        multiFlowMaps.append({
            'outFlowSlots': outFlow,
            'ppSlots': pp,
            'parentPpSlots': parentPp,
            'volSlots': vol,
        })
    # endregion

    #############################################################
    # region Assemble outputs
    #############################################################
    initialStates = jnp.asarray([float(states[n]) for n in stateNames], dtype=jnp.float64)

    eqDict = {
        'capacitors': resolvedEq['capacitors'],
        'inductors': resolvedEq['inductors'],
        'parameterVariation': resolvedEq['parameterVariation'],
        'concentrations': resolvedEq['concentrations'],
        'reactions': resolvedEq['reactions'],
        'connections': resolvedEq['connections'],
        'timekeeping': resolvedEq['timekeeping'],
        'other': resolvedEq['other'],
        'resistors': resistorsR,
        'membraneResistors': membranesR,
        'multiFlowResistors': multiflowR,
    }

    namesDict = {
        'dt': dt,
        'nState': nState,
        'nExt': nExt,
        'stateNames': stateNames,
        'extNames': extNames,
        'outputNames': flowOutputNames,
        'name2idx': name2idx,
        'constantNames': constantNames,
        'const2idx': const2idx,
        'slots': {
            'cap': capSlots, 'ind': indSlots, 'pv': pvSlots, 'conc': concSlots,
            'rxn': rxnSlots, 'conn': connSlots, 'other': otherSlots,
            'trig': trigSlots, 'timer': timerSlots, 'T': TSlot, 'T0': T0Slot,
            'resFlow': resFlowSlots, 'memFlow': memFlowSlots,
        },
        'multiFlowMaps': multiFlowMaps,
    }

    modelDataDict = {
        'initialStates': initialStates,
        'constantList': constantList,
        'modelObjects': modelObjects,
        'modelStructure': modelStructure,
        'structures': structures,
        'states': states,        # original name-keyed dict (handy for re-encode/debug)
    }
    # endregion

    return eqDict, namesDict, modelDataDict

# endregion
####################################################################################################


####################################################################################################
# region CardioPulmonaryModelArray  —  the jitted array RHS
#
# Term-for-term mirror of models.CardioPulmonaryModel.__call__, but on a flat
# extended vector. cpModel is passed to jax.jit as a STATIC argument, so all the
# equation objects and index lists below are baked constants; only y/constants
# are traced.
####################################################################################################

class CardioPulmonaryModelArray(eqx.Module):
    # equation buckets (lists of resolved eqx modules)
    capacitors: list
    inductors: list
    parameterVariation: list
    concentrations: list
    reactions: list
    connections: list
    timekeeping: list
    other: list
    resistors: list
    membraneResistors: list
    multiFlowResistors: list

    # static layout
    multiFlowMaps: list
    slots: dict
    stateNames: list
    outputNames: list
    nState: int
    nExt: int
    dt: float
    dtDense: float

    def __init__(self, eqDict, namesDict, modelStructure):
        self.capacitors = eqDict['capacitors']
        self.inductors = eqDict['inductors']
        self.parameterVariation = eqDict['parameterVariation']
        self.concentrations = eqDict['concentrations']
        self.reactions = eqDict['reactions']
        self.connections = eqDict['connections']
        self.timekeeping = eqDict['timekeeping']
        self.other = eqDict['other']
        self.resistors = eqDict['resistors']
        self.membraneResistors = eqDict['membraneResistors']
        self.multiFlowResistors = eqDict['multiFlowResistors']

        self.multiFlowMaps = namesDict['multiFlowMaps']
        self.slots = namesDict['slots']
        self.stateNames = namesDict['stateNames']
        self.outputNames = namesDict['outputNames']
        self.nState = namesDict['nState']
        self.nExt = namesDict['nExt']
        self.dt = modelStructure['configurations']['simulationParameters']['dt']
        # Save/output grid resolution (notebook-editable; default 1e-2). Carried on
        # the static cpModel so solveModelArray reads it without a new arg.
        self.dtDense = modelStructure['configurations']['simulationParameters'].get(
            'dtDense', _DT_DENSE_DEFAULT)

    def __call__(self, t, y, args, return_outputs: bool = False):
        constants = args
        s = self.slots
        # Slot lists are stored as Python ints (so cpModel stays hashable for the
        # static jit arg). JAX scatter/gather no longer accept Python lists, so we
        # materialise them as constant int arrays here (constant-folded under jit).
        I = lambda L: jnp.asarray(L, dtype=jnp.int32)
        capI, indI, pvI = I(s['cap']), I(s['ind']), I(s['pv'])
        concI, rxnI, connI = I(s['conc']), I(s['rxn']), I(s['conn'])
        otherI, trigI, timerI = I(s['other']), I(s['trig']), I(s['timer'])
        resFlowI, memFlowI = I(s['resFlow']), I(s['memFlow'])

        # yRaw: the integrated states padded out to the extended length. The
        # algebraic tail starts at zero and is never read before it is written.
        yRaw = jnp.concatenate([y, jnp.zeros(self.nExt - self.nState, dtype=y.dtype)])

        # ---- yTmp = y | pressures | allFlows  (built incrementally) ----
        yTmp = yRaw

        # capacitor pressures overwrite their own state slots (pressures wins)
        pressVals = jnp.stack([c.pressure(t, yRaw) for c in self.capacitors])
        yTmp = yTmp.at[capI].set(pressVals)

        # resistor flows -> algebraic slots   (flow_rate(t, y, pressures))
        if len(self.resistors) > 0:
            resVals = jnp.stack([r.flow_rate(t, yRaw, yTmp) for r in self.resistors])
            yTmp = yTmp.at[resFlowI].set(resVals)

        # multi-flow resistors: per-gas flows + recomputed partial pressures
        for mf, m in zip(self.multiFlowResistors, self.multiFlowMaps):
            outI, volI = I(m['outFlowSlots']), I(m['volSlots'])
            ppI, parentI = I(m['ppSlots']), I(m['parentPpSlots'])
            flows = mf.flow_rate(t, yRaw, yTmp)                 # array, one per out-volume
            yTmp = yTmp.at[outI].set(flows)
            totalVolume = jnp.sum(yTmp[volI])
            pp = yTmp[parentI] * (yTmp[volI] / totalVolume)
            yTmp = yTmp.at[ppI].set(pp)

        # membrane flows -> algebraic slots   (flow_rate(t, yTmp, constants))
        if len(self.membraneResistors) > 0:
            memVals = jnp.stack([mm.flow_rate(t, yTmp, constants) for mm in self.membraneResistors])
            yTmp = yTmp.at[memFlowI].set(memVals)

        # inductor flows already live in their state slots (indFlow = y[flowIdx]).

        # ---- derivatives ----
        x = jnp.zeros(self.nState, dtype=y.dtype)

        # capacitors (dP) — uses raw y, like models.py
        dPcomp = jnp.stack([c.dP(t, yRaw) for c in self.capacitors])
        x = x.at[capI].set(dPcomp)

        # inductors (flow_rate_deriv)
        if len(self.inductors) > 0:
            dQ = jnp.stack([i.flow_rate_deriv(t, yRaw, yTmp) for i in self.inductors])
            x = x.at[indI].set(dQ)

        # parameterVariation controllers (derivative(yTmp, constants))
        if len(self.parameterVariation) > 0:
            dPV = jnp.stack([p.derivative(yTmp, constants) for p in self.parameterVariation])
            x = x.at[pvI].set(dPV)

        # connections (dV) — also assembled into a position-indexed array for gas
        dVvals = jnp.stack([c.derivative(yTmp, constants, t) for c in self.connections])
        x = x.at[connI].set(dVvals)
        dVArr = jnp.zeros(self.nExt, dtype=y.dtype).at[connI].set(dVvals)

        # concentrations (gas dP) — allFlows live in yTmp; dV via dVArr
        if len(self.concentrations) > 0:
            dP = jnp.stack([g.dP(yTmp, yTmp, dVArr) for g in self.concentrations])
            x = x.at[concI].set(dP)

        # reactions (dP) — reaction states are untouched in yTmp, so yTmp == raw y here
        if len(self.reactions) > 0:
            dRx = jnp.stack([rx.dP(yTmp) for rx in self.reactions])
            x = x.at[rxnI].set(dRx)

        # timekeeping (trigger, timer) — uses raw y
        if len(self.timekeeping) > 0:
            dTrig = jnp.stack([k.trigger(yRaw, t) for k in self.timekeeping])
            dTimer = jnp.stack([k.timer(yRaw, t) for k in self.timekeeping])
            x = x.at[trigI].set(dTrig)
            x = x.at[timerI].set(dTimer)

        # other integrators (derivative(yTmp, constants, t))
        if len(self.other) > 0:
            dOther = jnp.stack([o.derivative(yTmp, constants, t) for o in self.other])
            x = x.at[otherI].set(dOther)

        # time: dT/dt = 1, dT0/dt = 0
        x = x.at[s['T']].set(1.0)
        x = x.at[s['T0']].set(0.0)

        if not return_outputs:
            return x

        # Debug/plot outputs: the algebraic tail (flows + partial pressures).
        return x, yTmp[self.nState:]

# endregion
####################################################################################################


####################################################################################################
# region Integrators  —  fixed-step Euler (matches the diffrax.Euler dict oracle)
####################################################################################################

# Saved-output resolution. The model integrates at the (tiny) reaction dt, e.g.
# dt0 = 2.5e-4 -> 40000 steps for a 10 s run. The dict oracle (models.solveModel)
# integrates at the same dt0 but SAVES only on a dt_dense = 1e-2 grid (~100 Hz),
# i.e. 1/40 of the points. We must downsample identically: it keeps memory bounded
# AND keeps parity (same save grid). Carrying the FULL last step forward is exact.
#
# This is the DEFAULT only — the live value is notebook-editable and travels on
# cpModel.dtDense (set from simulationParams['dtDense'] in initialiseModel). Used
# here as the fallback when a model is built without that key.
_DT_DENSE_DEFAULT = 1e-2

@partial(jax.jit, static_argnames=['cpModel', 'runTime', 'dt0'])
def solveModelArray(cpModel, runTime: float, states, constants, dt0: float, startTime: float = 0.0):
    # Integrate with the SAME solver the dict oracle uses (models.solveModel):
    # diffrax.Euler + ConstantStepSize. With the array RHS already matching the
    # dict RHS exactly, same-solver+same-RHS tracks the oracle bit-for-bit — a
    # hand-rolled lax.scan Euler diverges by ~1e-14/step which, near a cycle
    # trigger, flips a discrete event and blows the trajectory up over many runs.
    term = diffrax.ODETerm(cpModel)
    solver = diffrax.Euler()
    max_steps = int(runTime / dt0) + 2

    # Save only on the dt_dense (~100 Hz) grid: bounded memory, parity with the
    # dict path's t_dense, and downsampled output for storage. dtDense rides on the
    # static cpModel, so it is a compile-time constant here (notebook-editable).
    nDense = int(round(runTime / cpModel.dtDense))
    t_dense = jnp.linspace(startTime, runTime, nDense + 1)

    res = diffrax.diffeqsolve(
        term, solver, startTime, runTime, dt0, states,
        args=constants,
        stepsize_controller=diffrax.ConstantStepSize(),
        max_steps=max_steps,
        saveat=diffrax.SaveAt(ts=t_dense),
    )
    ys = res.ys                      # (nDense+1, nState)
    ts = res.ts

    # Algebraic outputs on the same dense grid — the dict oracle re-evaluates the
    # RHS with return_outputs=True over t_dense to recover the flows that are NOT
    # integrated states (resistor / membrane / multi-flow gas flows). Mirror that
    # here so results carry the flow trajectories, not just the 439 states.
    nOut = len(cpModel.outputNames)
    def _outputs(tt, yy):
        _, alg = cpModel(tt, yy, constants, return_outputs=True)
        return alg[:nOut]            # flow block sits first in the algebraic tail
    outs = jax.vmap(_outputs)(t_dense, ys)   # (nDense+1, nOut)

    # carry: last row -> next run's initial state; T already = T_init+runTime, set T0=T.
    sts = ys[-1]
    statenames = cpModel.stateNames
    iT0 = statenames.index('T0')
    sts = sts.at[iT0].set(sts[statenames.index('T')])
    return ts, ys, outs, sts


def runSolverArray(cpModel, states, constants, simParameters, runsRes, trun,
                   totalRuns=1, runTime=1, save=True, printTime=True):
    """Mirror of models.runSolver but on the flat array; results decoded back to
    name-keyed dict so downstream processing/plotting is unchanged.

    Memory discipline (the dict-path's per-run `np.concatenate` is O(N^2) and, on
    JAX device arrays, also retains buffers): we (a) pull each run's trajectory to
    host immediately, free the device array, and stash the host block, then
    (b) concatenate ONCE at the end. Peak memory stays ~O(total saved data).
    """
    statenames = cpModel.stateNames
    outputnames = cpModel.outputNames
    dt0 = simParameters['dt']
    saveBlocks = []   # list of host arrays, each (steps, nState)
    outBlocks = []    # matching algebraic-flow arrays, each (steps, nOut)
    for nruns in range(totalRuns):
        ts, ys, outs, sts = solveModelArray(cpModel, runTime, states, constants, dt0)

        if save:
            # drop the first row (matches models.runSolver's value[1:]) and copy to host
            saveBlocks.append(np.asarray(ys[1:]))
            outBlocks.append(np.asarray(outs[1:]))

        # carry final state forward as a fresh host->device array, then release the
        # large device trajectory so its buffer is not held across iterations.
        states = jnp.asarray(np.asarray(sts))
        ys.delete(); ts.delete(); outs.delete(); sts.delete()

        if printTime:
            now = time.time()
            tag = 'Run' if save else 'Ignored Run'
            msg = f"{np.round(now - trun, 4)} -> {tag}:{nruns} of {totalRuns - 1} completed!"
            print(msg if (nruns == 0 or nruns == totalRuns - 1) else msg, end=('\n' if (nruns == 0 or nruns == totalRuns - 1) else '\r'))
        trun = time.time()

    if save and saveBlocks:
        merged = np.concatenate(saveBlocks, axis=0)      # (totalSteps, nState)
        mergedOut = np.concatenate(outBlocks, axis=0)    # (totalSteps, nOut)
        # Build this batch's name-keyed block. Algebraic flows first, then the
        # integrated states overwrite on any key collision — matching the dict
        # path's `results = pressureRes | runsRes` (states win).
        block = {key: mergedOut[:, i] for i, key in enumerate(outputnames)}
        block.update({key: merged[:, i] for i, key in enumerate(statenames)})
        if runsRes == {}:
            runsRes = block
        else:
            runsRes = {key: np.concatenate((runsRes[key], block[key]), axis=0)
                       for key in block}
        del saveBlocks, outBlocks, merged, mergedOut, block

    return runsRes, trun, states


def runSimulationArray(states, cpModel, simulationParams, runsRes, structures, constants):
    """Mirror of models.runSimulation. Returns (results-by-name, final flat states)."""
    trun = time.time()
    runTime = simulationParams['runTime']
    totalRunsToIgnore = simulationParams['runsToIgnore']
    totalRuns = simulationParams['runsToSave']
    printStatus = simulationParams.get('printStatus', True)
    modelSimulationParameters = structures['modelStructure']['simulationParameters']

    if totalRunsToIgnore > 0:
        runsRes, trun, states = runSolverArray(
            cpModel, states, constants, modelSimulationParameters,
            runsRes, trun, totalRunsToIgnore, runTime, save=False, printTime=printStatus,
        )

    runsRes, trun, states = runSolverArray(
        cpModel, states, constants, modelSimulationParameters,
        runsRes, trun, totalRuns, runTime, save=True, printTime=printStatus,
    )

    return runsRes, states

# endregion
####################################################################################################


####################################################################################################
# region Decode / debug helpers  —  flat array <-> named states
#
# Load-bearing for calibration/control: those modes update states by NAME between
# stages, so each stage does  array -> decodeStates -> mutate -> encodeStates.
####################################################################################################

def decodeStates(y, namesDict):
    """Flat 439-vector -> {stateName: float}. Inverse of the canonical ordering."""
    names = namesDict['stateNames']
    yHost = np.asarray(y)
    return {names[i]: float(yHost[i]) for i in range(len(names))}


def encodeStates(stateDict, namesDict):
    """{stateName: value} -> flat 439-vector in canonical order."""
    names = namesDict['stateNames']
    return jnp.asarray([float(stateDict[n]) for n in names], dtype=jnp.float64)


def dumpResolvedModel(eqDict, namesDict, buckets=None, limit=None):
    """Human-readable dump of resolved equation objects with int indices mapped
    back to names — for debugging the JSON->array compilation."""
    idx2name = namesDict['extNames']
    idx2const = namesDict['constantNames']
    out = {}
    for bucket, objs in eqDict.items():
        if buckets is not None and bucket not in buckets:
            continue
        rows = []
        for o in (objs[:limit] if limit else objs):
            rows.append({'class': type(o).__name__,
                         'fields': eq.describeEquation(o, idx2name, idx2const)})
        out[bucket] = rows
    return out

# endregion
####################################################################################################
