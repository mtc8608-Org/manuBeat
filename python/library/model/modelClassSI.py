####################################################################################################
# modelClassSI.py  —  step-INDEPENDENT array-mode orchestration (Stage 1 fork)
#
# Fork of modelClass.py. Same flat-vector array stack, but a chosen subset of P1
# "step operator" states is PROMOTED to algebraic outputs (modelEqSI.ALG_CLASSES):
# pressure capacitors, SubstactStates and PolynomialController. Those values are
# computed fresh every RHS eval into the algebraic tail (no `/step`, never
# integrated), removing their dependence on `dt == step`. ConstantPressure,
# PeriodicTrigger (P2) and the cycle accumulators (P3) stay integrated states for
# now. modelClass.py is left untouched; the SI drivers (run_test/solver_compare,
# run_convergence/mcmc_*, run_sepsis/*) drive THIS module.
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
import optimistix as optx


import library.model.modelGen as modelGen
import library.model.modelEqSI as eq          # SI layer: re-exports modelEq + ALG_CLASSES
import library.utils as utils


####################################################################################################
# region Initialise & createModel  (parity copies of models.py)
####################################################################################################

def initialiseModel(simulationParams):
    """Load metadata + model JSON into a modelStructure. Identical to models.initialiseModel."""
    metadata = utils.loadJSONfile(utils.configPath('metadata.json'))

    # manuBeat divergence from CardioPulmonaryModel — port this back upstream.
    # Parity copy of the modelClass.initialiseModel branch: an optional
    # simulationParams['modelStructure'] (the model JSON straight from Postgres)
    # replaces the disk read. Deep-copied because the runners mutate it in place.
    preloaded = simulationParams.get('modelStructure')
    modelStructure = copy.deepcopy(preloaded) if preloaded is not None else \
        utils.loadJSONfile(utils.configPath('models', simulationParams['modelFileName']))

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
            # Solver config (type + adaptive tolerances). Rides on simulationParameters
            # alongside dt/dtDense, so it reaches runSolverArray via structures.
            'solver': simulationParams.get('solver', {'type': 'euler'}),
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
    stateNames = []     # the integrated-state names, in canonical order

    # SI: P1 states promoted to algebraic outputs (modelEqSI.ALG_CLASSES). Collected
    # by kind so the RHS evaluates them in dependency order: polynomial controllers
    # (e.g. t_Sys_HC) -> pressures (an ElastanceCapacitor may read t_Sys_HC) ->
    # substractions. Each promoted object is diverted out of the state buckets.
    siPolyEq,  siPolyNames  = [], []
    siPressEq, siPressNames = [], []
    siSubEq,   siSubNames   = [], []

    def _routeAlgebraic(eqObj, name):
        """Divert an SI-promoted equation to its algebraic bucket. Returns True if
        diverted (caller then skips adding it as a state)."""
        if eq.isPressureAlg(eqObj):
            siPressEq.append(eqObj); siPressNames.append(name); return True
        if isinstance(eqObj, eq.PolynomialController):
            siPolyEq.append(eqObj);  siPolyNames.append(name);  return True
        if isinstance(eqObj, eq.SubstactStates):
            siSubEq.append(eqObj);   siSubNames.append(name);   return True
        return False

    for bucket in stateBuckets:
        orderedEq[bucket] = []
        orderedOut[bucket] = []
        for key, eqObj in modelObjects[bucket].items():
            name = _stateNameOf(bucket, key, eqObj)
            if _routeAlgebraic(eqObj, name):
                continue
            orderedEq[bucket].append(eqObj)
            orderedOut[bucket].append(name)
            stateNames.append(name)

    # timekeeping: each PeriodicTrigger owns TWO states (trigger then timer).
    # (P2 deferred — PeriodicTrigger stays an integrated state for now.)
    orderedEq['timekeeping'] = []
    timekeepingOut = []   # [(triggerName, timerName), ...]
    for key, eqObj in modelObjects['timekeeping'].items():
        orderedEq['timekeeping'].append(eqObj)
        timekeepingOut.append((eqObj.triggerIdx, eqObj.timerIdx))
        stateNames.append(eqObj.triggerIdx)
        stateNames.append(eqObj.timerIdx)

    # other: stays a set of integrated states, but split by SI treatment. The cycle
    # operators are re-typed to their step-free SI subclasses (modelEqSI.wrapSI);
    # the integrator calls their continuousDerivative / project / resets methods.
    #   - CycleIntegrator -> dInt/dt = input ;  reset Int->0 at the beat
    #   - CycleKeeper     -> dKeep/dt = 0 ;     latch Keep->input at the beat
    #   - CycleMax/Min    -> dProc/dt = 0 ;     running max/min projection ; reset
    #   - everything else (MovingAverage, ...) -> original `.derivative` (step-free)
    # SubstactStates is still diverted to the algebraic tail.
    otherStdEq,  otherStdNames  = [], []
    otherIntEq,  otherIntNames  = [], []
    otherKeepEq, otherKeepNames = [], []
    otherProjEq, otherProjNames = [], []
    for key, eqObj in modelObjects['other'].items():
        if _routeAlgebraic(eqObj, key):
            continue
        stateNames.append(key)
        if isinstance(eqObj, eq.CycleIntegrator):
            otherIntEq.append(eqObj);  otherIntNames.append(key)
        elif isinstance(eqObj, eq.CycleKeeper):
            otherKeepEq.append(eqObj); otherKeepNames.append(key)
        elif eq.isProjectOperator(eqObj):           # CycleMax / CycleMin
            otherProjEq.append(eqObj); otherProjNames.append(key)
        else:
            otherStdEq.append(eqObj);  otherStdNames.append(key)

    # T / T0 always last (the timekeeping rounding convention depends on it).
    stateNames.append('T')
    stateNames.append('T0')

    nState = len(stateNames)

    # SI promoted names, in RHS evaluation order (poly -> pressure -> substract).
    siAlgEq    = siPolyEq + siPressEq + siSubEq
    siAlgNames = siPolyNames + siPressNames + siSubNames

    # stateNames + promoted names must partition the generator's states exactly.
    siSet = set(siAlgNames)
    assert siSet.isdisjoint(stateNames), "SI promoted name collides with a state name"
    assert (set(stateNames) | siSet) == set(states.keys()), (
        "stateNames+SI != generator states: "
        f"missing={set(states.keys()) - set(stateNames) - siSet}, "
        f"extra={(set(stateNames) | siSet) - set(states.keys())}"
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

    # SI: promoted P1 states (pressures, substractions, poly) join the algebraic
    # tail, inserted as a contiguous block BEFORE the multi-flow partial pressures
    # so the whole output prefix stays contiguous from slot nState.
    algebraicNames = (resistorFlowNames + membraneFlowNames + multiflowQNames
                      + siAlgNames + multiflowPNames)
    # The subset of the algebraic tail that the dict oracle exposes as result
    # outputs (models.py: out = concentrations | flow | membraneFlow): resistor,
    # membrane and multi-flow gas flows. They sit FIRST in algebraicNames (before
    # the multi-flow partial pressures, which the dict path does not output). SI
    # appends the promoted states here too — the dict path emitted them as state
    # signals, so they must still appear in `results` (now sourced algebraically).
    flowOutputNames = (resistorFlowNames + membraneFlowNames + multiflowQNames
                       + siAlgNames)
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
    constantList = jnp.asarray([float(v) for v in constantValues])   # follows jax_enable_x64 (f64/f32)
    # endregion

    #############################################################
    # region Resolve every equation's name fields -> int indices
    #############################################################
    resolvedEq = {b: [eq.resolveEquation(o, name2idx, const2idx) for o in objs]
                  for b, objs in orderedEq.items()}
    resistorsR = [eq.resolveEquation(r, name2idx, const2idx) for r in modelObjects['resistors'].values()]
    membranesR = [eq.resolveEquation(m, name2idx, const2idx) for m in modelObjects['membraneResistors'].values()]
    multiflowR = [eq.resolveEquation(m, name2idx, const2idx) for m in modelObjects['multiFlowResistors'].values()]
    # SI promoted (algebraic) equations, resolved per kind.
    siPolyR  = [eq.resolveEquation(o, name2idx, const2idx) for o in siPolyEq]
    siPressR = [eq.resolveEquation(o, name2idx, const2idx) for o in siPressEq]
    siSubR   = [eq.resolveEquation(o, name2idx, const2idx) for o in siSubEq]
    # SI 'other' sub-buckets, resolved then re-typed to their step-free SI subclass.
    # (timekeeping PeriodicTriggers are wrapped too.) otherStd (MovingAverage, ...)
    # keeps its base class — its `.derivative` is already step-free.
    timekeepingR = [eq.wrapSI(o) for o in resolvedEq['timekeeping']]
    otherStdR  = [eq.resolveEquation(o, name2idx, const2idx) for o in otherStdEq]
    otherIntR  = [eq.wrapSI(eq.resolveEquation(o, name2idx, const2idx)) for o in otherIntEq]
    otherKeepR = [eq.wrapSI(eq.resolveEquation(o, name2idx, const2idx)) for o in otherKeepEq]
    otherProjR = [eq.wrapSI(eq.resolveEquation(o, name2idx, const2idx)) for o in otherProjEq]

    # The integrator applies, each step: project() (Max/Min running update) then,
    # at the beat (op.triggered), op.resets(). resetOps spans every cycle operator;
    # projOps is just the Max/Min running updates. Both are lists of resolved SI
    # objects (hashable -> fine as static cpModel fields).
    resetOps = timekeepingR + otherIntR + otherKeepR + otherProjR
    projOps  = otherProjR
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
    # Only std (MovingAverage) and integrators write a non-zero derivative in the
    # RHS; keepers (dKeep=0) and Max/Min (dProc=0, updated by projection) don't.
    otherStdSlots  = slots(otherStdNames)
    otherIntSlots  = slots(otherIntNames)
    trigSlots  = [name2idx[t] for (t, _) in timekeepingOut]
    timerSlots = [name2idx[tm] for (_, tm) in timekeepingOut]
    TSlot  = name2idx['T']
    T0Slot = name2idx['T0']

    resFlowSlots = slots(resistorFlowNames)
    memFlowSlots = slots(membraneFlowNames)

    # SI: algebraic-tail slots for the promoted equations (same order as siPolyR /
    # siPressR / siSubR — i.e. siPolyNames / siPressNames / siSubNames).
    siPolySlots  = slots(siPolyNames)
    siPressSlots = slots(siPressNames)
    siSubSlots   = slots(siSubNames)
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
    initialStates = jnp.asarray([float(states[n]) for n in stateNames])   # follows jax_enable_x64

    eqDict = {
        'capacitors': resolvedEq['capacitors'],
        'inductors': resolvedEq['inductors'],
        'parameterVariation': resolvedEq['parameterVariation'],
        'concentrations': resolvedEq['concentrations'],
        'reactions': resolvedEq['reactions'],
        'connections': resolvedEq['connections'],
        'timekeeping': timekeepingR,        # wrapped PeriodicTriggerSI (dTrig=0, dTim=1)
        # SI 'other' split: std uses .derivative; integrators emit dInt=input.
        # Keepers (dKeep=0) and Max/Min (dProc=0) write no RHS derivative.
        'otherStd': otherStdR,
        'otherInt': otherIntR,
        'resistors': resistorsR,
        'membraneResistors': membranesR,
        'multiFlowResistors': multiflowR,
        # SI promoted (algebraic) equations.
        'siPoly': siPolyR,
        'siPress': siPressR,
        'siSub': siSubR,
        # SI cycle operators for the integrator: projections (Max/Min) then resets.
        'resetOps': resetOps,
        'projOps': projOps,
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
            'rxn': rxnSlots, 'conn': connSlots,
            'otherStd': otherStdSlots, 'otherInt': otherIntSlots,
            'trig': trigSlots, 'timer': timerSlots, 'T': TSlot, 'T0': T0Slot,
            'resFlow': resFlowSlots, 'memFlow': memFlowSlots,
            'siPoly': siPolySlots, 'siPress': siPressSlots, 'siSub': siSubSlots,
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
    # SI 'other' split (see prepareModel). Keepers carry no RHS eq (dKeep=0).
    otherStd: list
    otherInt: list
    resistors: list
    membraneResistors: list
    multiFlowResistors: list
    # SI promoted (algebraic) equations — evaluated into the algebraic tail, not
    # integrated. Eval order is poly -> press -> sub (dependency contract).
    siPoly: list
    siPress: list
    siSub: list
    # SI cycle operators (resolved step-free SI objects) used by the integrator:
    # projOps run a running max/min projection each step; resetOps apply the beat
    # jumps (timer/trigger reset, integrator reset, keeper latch, max/min reset).
    resetOps: list
    projOps: list

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
        self.otherStd = eqDict['otherStd']
        self.otherInt = eqDict['otherInt']
        self.resistors = eqDict['resistors']
        self.membraneResistors = eqDict['membraneResistors']
        self.multiFlowResistors = eqDict['multiFlowResistors']
        self.siPoly = eqDict['siPoly']
        self.siPress = eqDict['siPress']
        self.siSub = eqDict['siSub']
        self.resetOps = eqDict['resetOps']
        self.projOps = eqDict['projOps']

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
        otherStdI, otherIntI = I(s['otherStd']), I(s['otherInt'])
        trigI, timerI = I(s['trig']), I(s['timer'])
        resFlowI, memFlowI = I(s['resFlow']), I(s['memFlow'])
        siPolyI, siPressI, siSubI = I(s['siPoly']), I(s['siPress']), I(s['siSub'])

        # yRaw: the integrated states padded out to the extended length. The
        # algebraic tail starts at zero and is never read before it is written.
        yRaw = jnp.concatenate([y, jnp.zeros(self.nExt - self.nState, dtype=y.dtype)])

        # ---- yTmp = y | SI-algebraic | pressures | allFlows  (built incrementally) ----
        yTmp = yRaw

        # SI promoted states -> algebraic tail, in dependency order:
        #   (1) polynomial controllers (e.g. t_Sys_HC) read only true states,
        #   (2) pressures may read a promoted poly output (ElastanceCapacitor.tSys),
        #   (3) substractions read only true states.
        # These were `(target - X)/step` states; we write `target` directly (no /step).
        if len(self.siPoly) > 0:
            polyVals = jnp.stack([eq.algebraicValue(o, t, yRaw, constants) for o in self.siPoly])
            yTmp = yTmp.at[siPolyI].set(polyVals)
        if len(self.siPress) > 0:
            # read yTmp so a promoted poly output (set above) is visible.
            pressAlg = jnp.stack([o.pressure(t, yTmp) for o in self.siPress])
            yTmp = yTmp.at[siPressI].set(pressAlg)
        if len(self.siSub) > 0:
            subVals = jnp.stack([eq.algebraicValue(o, t, yTmp, constants) for o in self.siSub])
            yTmp = yTmp.at[siSubI].set(subVals)

        # remaining (non-promoted) capacitor pressures overwrite their own state
        # slots — for hr_test this is only ConstantPressure (Atm), a no-op overwrite.
        if len(self.capacitors) > 0:
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

        # capacitors (dP) — only the non-promoted state caps remain (e.g. the
        # ConstantPressure Atm, dP == 0). Promoted pressures are algebraic, no dP.
        if len(self.capacitors) > 0:
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

        # timekeeping — SI continuous clock (PeriodicTriggerSI): dTrig=0, dTim=1.
        # The resets (Tim->0, Trig->Trig+period) are discrete jumps applied at the
        # beat by the integrator (op.resets), so they no longer divide by step.
        if len(self.timekeeping) > 0:
            x = x.at[trigI].set(jnp.stack([k.dTrigger() for k in self.timekeeping]))
            x = x.at[timerI].set(jnp.stack([k.dTimer() for k in self.timekeeping]))

        # other (std: MovingAverage, ...) — original step-free `.derivative`.
        if len(self.otherStd) > 0:
            dStd = jnp.stack([o.derivative(yTmp, constants, t) for o in self.otherStd])
            x = x.at[otherStdI].set(dStd)
        # other (CycleIntegratorSI) — SI continuous: dInt/dt = input. Reset to 0 at
        # the beat is a discrete jump (op.resets).
        if len(self.otherInt) > 0:
            dInt = jnp.stack([o.continuousDerivative(yTmp) for o in self.otherInt])
            x = x.at[otherIntI].set(dInt)
        # CycleKeeperSI (dKeep=0) and CycleMax/MinSI (dProc=0, updated by projection)
        # write no derivative here — handled entirely by project()/resets().

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

def applyProjections(yPreFull, yState, projOps):
    """Running max/min update (CycleMax/MinSI) applied after the Euler step.
    `yPreFull` is the PRE-step extended vector (states | algebraic tail) — proc and
    input are read from it (matching the original caseFalse, which uses the pre-step
    values); the new proc is written into the post-step state vector `yState`."""
    y = yState
    for op in projOps:
        slot, val = op.project(yPreFull)
        y = y.at[slot].set(val)
    return y


def applyResets(t, yReadFull, yState, resetOps):
    """SI cycle-boundary jumps. Each op decides `triggered(t, yReadFull)` and, at the
    beat, returns `resets(yReadFull)` = [(slot, newValue)]. `yReadFull` is the
    POST-projection extended vector (so a keeper latches the running max/integral
    just produced), and the trigger/T0 it reads are unchanged by the step. Reset
    values come from the frozen `yReadFull` snapshot, so keeper-latch and the
    integrator/max reset that follow it don't depend on op ordering."""
    y = yState
    for op in resetOps:
        cond = op.triggered(t, yReadFull)
        for slot, val in op.resets(yReadFull):
            y = y.at[slot].set(jnp.where(cond, val, y[slot]))
    return y


def solveModelArray(cpModel, runTime, states, constants, dt0, startTime=0.0, solver=None):
    """Integrate one run and return (ts, ys, outs, sts) on the dtDense grid.

    Dispatches on solver['type']: 'euler'/'rk4' -> a jitted fixed-step lax.scan
    (compiles once, no per-run recompilation); anything else (dopri5/tsit5/dopri8)
    -> the adaptive diffrax event-restart loop. All honour the same SI cycle
    operators (no /step anywhere)."""
    stype = (solver or {}).get('type', 'euler')
    if stype == 'euler':
        return _solveEuler(cpModel, runTime, states, constants, dt0, startTime)
    if stype == 'rk4':
        return _solveRK4(cpModel, runTime, states, constants, dt0, startTime)
    return _solveAdaptive(cpModel, runTime, states, constants, dt0, startTime, solver)


@partial(jax.jit, static_argnames=['cpModel', 'runTime', 'dt0'])
def _solveEuler(cpModel, runTime: float, states, constants, dt0: float, startTime: float = 0.0):
    # SI integrator: fixed-step Euler as a lax.scan. The cycle operators
    # (PeriodicTrigger / CycleIntegrator / Keeper / Max / Min) are step-free SI
    # objects: the RHS emits only their continuous derivative, then each step we
    # apply project() (Max/Min running update) and, at the beat, resets() (exact
    # jumps). No equation divides by step on the hr_test path, so the model
    # integrates and converges at any dt (dt no longer has to equal `step`).
    nSteps    = int(round(runTime / dt0))
    saveEvery = int(round(cpModel.dtDense / dt0))
    nDense    = int(round(runTime / cpModel.dtDense))
    # The nested scan below emits exactly one saved row per `saveEvery` sub-steps, so the
    # fine grid must partition evenly into the dense grid. This was always implicitly
    # required (the old stride-slice fed a fixed (nDense+1)-row output), so assert it loudly
    # rather than silently misalign.
    assert nDense * saveEvery == nSteps, (
        f"dtDense/dt0 must divide runTime/dt0 evenly: nDense({nDense})*saveEvery({saveEvery}) "
        f"!= nSteps({nSteps})")

    # One forward-Euler sub-step plus the step-free cycle operators (project() running
    # max/min, then beat resets()). Returns only the advanced carry, so the inner scan
    # stacks nothing — the fine trajectory never materialises.
    def substep(carry, _):
        t, y = carry
        x, alg = cpModel(t, y, constants, return_outputs=True)   # continuous derivs + algebraic tail
        yPost = y + dt0 * x
        yPreFull = jnp.concatenate([y, alg])                     # pre-step extended (states | tail)
        yPost = applyProjections(yPreFull, yPost, cpModel.projOps)
        yReadFull = jnp.concatenate([yPost, alg])                # post-projection states | pre-step tail
        yPost = applyResets(t, yReadFull, yPost, cpModel.resetOps)
        return (t + dt0, yPost), None

    # Outer scan: run `saveEvery` sub-steps, emit the state at that dense point. Stacked
    # output is (nDense, nState) instead of (nSteps, nState) — 1/saveEvery the memory. The
    # row after m outer steps is the state at t = startTime + m*saveEvery*dt0 = m*dtDense,
    # identical to the old ysAll[saveEvery-1::saveEvery] selection.
    def denseStep(carry, _):
        carry, _ = jax.lax.scan(substep, carry, None, length=saveEvery)
        (_, y) = carry
        return carry, y

    (_, yEnd), ys_dense = jax.lax.scan(denseStep, (startTime, states), None, length=nDense)

    # Prepend the initial row to match the dict path's (nDense+1)-row block (runSolverArray
    # then drops the first row).
    ys = jnp.concatenate([states[None, :], ys_dense], axis=0)   # (nDense+1, nState)
    ts = jnp.linspace(startTime, runTime, nDense + 1)

    # Algebraic outputs on the dense grid (flows + SI-promoted pressures/substractions).
    nOut = len(cpModel.outputNames)
    def _outputs(tt, yy):
        _, alg = cpModel(tt, yy, constants, return_outputs=True)
        return alg[:nOut]
    outs = jax.vmap(_outputs)(ts, ys)                 # (nDense+1, nOut)

    # carry: final state -> next run's init; T already = T_init+runTime, set T0=T.
    sts = yEnd
    statenames = cpModel.stateNames
    iT0 = statenames.index('T0')
    sts = sts.at[iT0].set(sts[statenames.index('T')])
    return ts, ys, outs, sts


@partial(jax.jit, static_argnames=['cpModel', 'runTime', 'dt0'])
def _solveRK4(cpModel, runTime: float, states, constants, dt0: float, startTime: float = 0.0):
    # Fixed-step classic Runge-Kutta (4th order) as a lax.scan. Same structure as
    # _solveEuler — fully jitted, so it compiles ONCE and is reused across every run
    # and notebook cell re-run (no diffrax event-restart loop, hence no per-run /
    # per-beat recompilation). Only the continuous update changes: a 4-stage RK step
    # on the smooth (step-free) dynamics replaces forward Euler, giving ~dopri5-level
    # accuracy in the smooth regions at a chosen fixed dt. The SI cycle operators
    # (project then beat-resets) are applied once per step exactly as in _solveEuler,
    # using the PRE-step algebraic tail — so the discrete cardiac-cycle behaviour is
    # identical; only the smooth integration is higher order.
    nSteps    = int(round(runTime / dt0))
    saveEvery = int(round(cpModel.dtDense / dt0))
    nDense    = int(round(runTime / cpModel.dtDense))
    # See _solveEuler: the nested scan emits one row per saveEvery sub-steps, so the fine
    # grid must divide the dense grid evenly.
    assert nDense * saveEvery == nSteps, (
        f"dtDense/dt0 must divide runTime/dt0 evenly: nDense({nDense})*saveEvery({saveEvery}) "
        f"!= nSteps({nSteps})")

    def deriv(t, y):
        x, _ = cpModel(t, y, constants, return_outputs=True)
        return x

    # One RK4 sub-step on the smooth dynamics + the SI cycle operators. Returns only the
    # advanced carry, so the inner scan stacks nothing (identical bookkeeping to _solveEuler).
    def substep(carry, _):
        t, y = carry
        # RK4 stages on the smooth dynamics. The first eval also yields the pre-step
        # algebraic tail used by the SI projections/resets (matches _solveEuler).
        k1, alg = cpModel(t, y, constants, return_outputs=True)
        k2 = deriv(t + 0.5 * dt0, y + 0.5 * dt0 * k1)
        k3 = deriv(t + 0.5 * dt0, y + 0.5 * dt0 * k2)
        k4 = deriv(t + dt0,       y + dt0 * k3)
        yPost = y + (dt0 / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)

        yPreFull = jnp.concatenate([y, alg])                     # pre-step extended (states | tail)
        yPost = applyProjections(yPreFull, yPost, cpModel.projOps)
        yReadFull = jnp.concatenate([yPost, alg])                # post-projection states | pre-step tail
        yPost = applyResets(t, yReadFull, yPost, cpModel.resetOps)
        return (t + dt0, yPost), None

    # Outer scan: saveEvery sub-steps per emitted dense row -> (nDense, nState) output.
    def denseStep(carry, _):
        carry, _ = jax.lax.scan(substep, carry, None, length=saveEvery)
        (_, y) = carry
        return carry, y

    (_, yEnd), ys_dense = jax.lax.scan(denseStep, (startTime, states), None, length=nDense)

    ys = jnp.concatenate([states[None, :], ys_dense], axis=0)   # (nDense+1, nState)
    ts = jnp.linspace(startTime, runTime, nDense + 1)

    nOut = len(cpModel.outputNames)
    def _outputs(tt, yy):
        _, alg = cpModel(tt, yy, constants, return_outputs=True)
        return alg[:nOut]
    outs = jax.vmap(_outputs)(ts, ys)                 # (nDense+1, nOut)

    sts = yEnd
    statenames = cpModel.stateNames
    iT0 = statenames.index('T0')
    sts = sts.at[iT0].set(sts[statenames.index('T')])
    return ts, ys, outs, sts


####################################################################################################
# region Final-state-only solves  —  vmap/GPU batching (no dense trajectory)
#
# Mirror _solveEuler / _solveRK4 step-for-step (same projections + beat resets, so the
# dynamics are IDENTICAL), but the lax.scan drops the per-step stacked output and returns
# only the final carry. Under jax.vmap a dense return is (N, nDense+1, nState) and blows
# 6 GB VRAM; the population study only needs the final state + final algebraic outputs
# (steadyState = last dense sample = yEnd), so per-sample memory stays (nState,)+(nOut,).
# Used by runnerBatchSI.batchedCalibration. The dense solvers above are left untouched.
####################################################################################################

def _finalOutputsAndCarry(cpModel, yEnd, constants, tEnd):
    """Shared tail for the final-only solvers: final algebraic outputs at yEnd (== the
    dense path's last `outs` row, since the last dense sample IS yEnd) and the T0-latched
    carry state for the next run/stage. T0 is never an observation, so reading the
    observation block from this carry vs the raw yEnd differs only in the unused T0 slot."""
    nOut = len(cpModel.outputNames)
    _, alg = cpModel(tEnd, yEnd, constants, return_outputs=True)
    finalOuts = alg[:nOut]
    statenames = cpModel.stateNames
    iT0 = statenames.index('T0')
    sts = yEnd.at[iT0].set(yEnd[statenames.index('T')])
    return sts, finalOuts


@partial(jax.jit, static_argnames=['cpModel', 'runTime', 'dt0'])
def _solveEulerFinal(cpModel, runTime: float, states, constants, dt0: float, startTime: float = 0.0):
    """Final-only forward Euler. Returns (sts, finalOuts) — see region header."""
    nSteps = int(round(runTime / dt0))

    def step(carry, _):
        t, y = carry
        x, alg = cpModel(t, y, constants, return_outputs=True)
        yPost = y + dt0 * x
        yPreFull = jnp.concatenate([y, alg])
        yPost = applyProjections(yPreFull, yPost, cpModel.projOps)
        yReadFull = jnp.concatenate([yPost, alg])
        yPost = applyResets(t, yReadFull, yPost, cpModel.resetOps)
        return (t + dt0, yPost), None

    (tEnd, yEnd), _ = jax.lax.scan(step, (startTime, states), None, length=nSteps)
    return _finalOutputsAndCarry(cpModel, yEnd, constants, tEnd)


@partial(jax.jit, static_argnames=['cpModel', 'runTime', 'dt0'])
def _solveRK4Final(cpModel, runTime: float, states, constants, dt0: float, startTime: float = 0.0):
    """Final-only classic RK4. Returns (sts, finalOuts) — see region header."""
    nSteps = int(round(runTime / dt0))

    def deriv(t, y):
        x, _ = cpModel(t, y, constants, return_outputs=True)
        return x

    def step(carry, _):
        t, y = carry
        k1, alg = cpModel(t, y, constants, return_outputs=True)
        k2 = deriv(t + 0.5 * dt0, y + 0.5 * dt0 * k1)
        k3 = deriv(t + 0.5 * dt0, y + 0.5 * dt0 * k2)
        k4 = deriv(t + dt0,       y + dt0 * k3)
        yPost = y + (dt0 / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
        yPreFull = jnp.concatenate([y, alg])
        yPost = applyProjections(yPreFull, yPost, cpModel.projOps)
        yReadFull = jnp.concatenate([yPost, alg])
        yPost = applyResets(t, yReadFull, yPost, cpModel.resetOps)
        return (t + dt0, yPost), None

    (tEnd, yEnd), _ = jax.lax.scan(step, (startTime, states), None, length=nSteps)
    return _finalOutputsAndCarry(cpModel, yEnd, constants, tEnd)


def solveFinalArray(cpModel, runTime, states, constants, dt0, startTime=0.0, solver=None):
    """Final-only dispatch mirroring solveModelArray: 'euler' -> _solveEulerFinal,
    'rk4' -> _solveRK4Final. Adaptive solvers are not supported here (they don't vmap)."""
    stype = (solver or {}).get('type', 'euler')
    if stype == 'euler':
        return _solveEulerFinal(cpModel, runTime, states, constants, dt0, startTime)
    if stype == 'rk4':
        return _solveRK4Final(cpModel, runTime, states, constants, dt0, startTime)
    raise ValueError(f"solveFinalArray supports only 'euler'/'rk4' (vmappable); got {stype!r}")

# endregion
####################################################################################################


_DIFFRAX_SOLVERS = {
    'dopri5': diffrax.Dopri5, 'tsit5': diffrax.Tsit5, 'dopri8': diffrax.Dopri8,
    'heun': diffrax.Heun, 'bosh3': diffrax.Bosh3,
}


def _applyBeatResets(t, yReadFull, yState, resetOps, eps=1e-9):
    """Beat resets for the adaptive path: gate each op with a small tolerance so the
    cycle whose trigger the root-finder just localized (cond ~= 0) reliably fires."""
    y = yState
    for op in resetOps:
        cond = (t + yReadFull[op.initialTimeIdx] - yReadFull[op.triggerIdx]) >= -eps
        for slot, val in op.resets(yReadFull):
            y = y.at[slot].set(jnp.where(cond, val, y[slot]))
    return y


# diffrax.diffeqsolve is internally eqx.filter_jit-wrapped and keys its compile
# cache on the IDENTITY of the ODETerm/Event/controller it is handed. Rebuilding
# those (a fresh `term` lambda + `Event`) on every _solveAdaptive call therefore
# forces a full recompile on every run. We memoise them on the (value-equal)
# cpModel + solver signature so the compiled segment-solver is reused across beats
# AND across runs (cpModel is hashable and compares by value, so even a rebuilt
# cpModel from a re-run notebook cell hits the same entry). See _solveAdaptive.
_ADAPTIVE_CACHE = {}


# Fixed length of the per-segment projection sampling grid (see _foldSegmentProjections).
# A CONSTANT shape keeps jax.vmap(ext_at) compiled once; the default covers any physiological
# beat at projDt=dt0 (a ~0.5 s beat is ~1000 points at dt0=5e-4). Overridable per run via
# solver['projMaxSteps'] (single-config-surface: default here -> scenario/runConfig solver key).
_PROJ_MAX_STEPS_DEFAULT = 2048


def _foldSegmentProjections(cpModel, sol, tStart, tEnd, y, args, projDt, projMax):
    """Reproduce the Euler path's per-step Max/Min projection across an adaptive segment.
    Between beats CycleMax/MinSI carry dProc=0, so diffrax leaves y[processedIdx] at its
    segment-start value; here we fold the segment extremum of each tracked variable
    (sampled on a projDt grid off the dense interpolant) back in. Accumulates across the
    segments within a beat; the beat resets() then latch/reset as usual. Without this the
    cycle-max/min calibration targets (keep_max_*, keep_min_*, amp_*) are captured wrong
    under any adaptive solver (they track only what the beat reset leaves)."""
    projOps = cpModel.projOps
    if not projOps or tEnd <= tStart + 1e-12:
        return y
    n = max(1, int(math.ceil((tEnd - tStart) / projDt)))
    # FIXED-length grid so jax.vmap(ext_at) compiles ONCE. A variable-length grid (n scales
    # with beat duration) retraces at every distinct length; since each calibration run's
    # beats differ, that compile cache grows unbounded across runs (a memory leak). For
    # n < projMax: the exact projDt grid padded with tEnd (already a real sample -> the
    # max/min is idempotent under the padding, so the result is unchanged). For n >= projMax
    # (rare non-beating segment that diverges/gets rejected): projMax points spanning it.
    if n >= projMax:
        grid = np.linspace(tStart, tEnd, projMax + 1)[1:]
    else:
        grid = np.concatenate([np.linspace(tStart, tEnd, n + 1)[1:],
                               np.full(projMax - n, tEnd)])
    grid = jnp.asarray(grid)                        # exclude tStart (already folded)

    def ext_at(tt):
        yy = sol.evaluate(tt)
        _, alg = cpModel(tt, yy, args, return_outputs=True)
        return jnp.concatenate([yy, alg])

    exts = jax.vmap(ext_at)(grid)                  # (projMax, nExt)
    for op in projOps:
        col = exts[:, op.varToProcessIdx]
        if isinstance(op, eq.CycleMaxSI):
            y = y.at[op.processedIdx].set(jnp.maximum(y[op.processedIdx], jnp.max(col)))
        elif isinstance(op, eq.CycleMinSI):
            y = y.at[op.processedIdx].set(jnp.minimum(y[op.processedIdx], jnp.min(col)))
    return y


def _adaptiveContext(cpModel, solver):
    key = (cpModel, tuple(sorted(solver.items())))
    ctx = _ADAPTIVE_CACHE.get(key)
    if ctx is None:
        SolverCls = _DIFFRAX_SOLVERS[solver['type']]
        diffSolver = SolverCls()
        controller = diffrax.PIDController(
            rtol=solver['rtol'], atol=solver['atol'],
            dtmax=solver.get('dtMax'))
        term = diffrax.ODETerm(lambda t, y, args: cpModel(t, y, args))
        rootFinder = optx.Bisection(rtol=solver['eventTol'], atol=solver['eventTol'])
        periodicOps = [o for o in cpModel.resetOps if isinstance(o, eq.PeriodicTriggerSI)]

        # diffrax + Bisection want a single SCALAR cond. Each cycle's (t + T0 - Trig)
        # rises from negative to 0 at its beat; the MAX over cycles reaches 0 first, so
        # it crosses 0 at the earliest pending beat. Which cycle actually fired is then
        # resolved by the per-op tolerance gate in _applyBeatResets.
        def cond_fn(t, y, args, **kw):
            return jnp.max(jnp.stack([(t + y[o.initialTimeIdx] - y[o.triggerIdx])
                                      for o in periodicOps]))
        event = diffrax.Event(cond_fn, rootFinder)
        ctx = (diffSolver, controller, term, event, periodicOps, int(solver['maxSteps']))
        _ADAPTIVE_CACHE[key] = ctx
    return ctx


def _solveAdaptive(cpModel, runTime, states, constants, dt0, startTime, solver):
    """Variable-step integration as a hybrid ODE: integrate the (now step-free) smooth
    dynamics with an adaptive diffrax solver, stop at each beat via a root-found Event,
    apply the SI resets(), and restart. The beat condition is (t + T0) - Trig per
    PeriodicTrigger; resets cover timer/trigger/integrator/keeper/max/min. Cycle Max/Min
    are additionally projected across every segment (_foldSegmentProjections) so the
    cycle-max/min targets are captured, not left to the beat reset alone."""
    diffSolver, controller, term, event, periodicOps, maxSteps = _adaptiveContext(cpModel, solver)
    projDt = float(solver.get('projDt') or dt0)    # projection-sampling grid (defaults to dt0)
    projMax = int(solver.get('projMaxSteps', _PROJ_MAX_STEPS_DEFAULT))  # fixed proj-grid length
    nDense = int(round(runTime / cpModel.dtDense))
    grid = np.linspace(startTime, runTime, nDense + 1)

    ysSeg = [np.asarray(states)[None, :]]   # the t=startTime row (dropped later by runSolverArray)
    tsDone = [startTime]
    t = startTime
    y = states
    nbeat = 0
    # diffrax.diffeqsolve is eqx.filter_jit-wrapped, so any NON-array argument is held
    # STATIC. A Python-float t0 changes at every beat restart -> a new static cache key ->
    # a fresh XLA compile per beat, and each compiled variant pins a max_steps-sized dense
    # buffer, so the jit cache grows unbounded across beats/runs (the memory leak). Pass the
    # scalar times as arrays so they are traced (dynamic): the segment solver then compiles
    # ONCE and is reused across every beat and every run. (t1/dt0 are constant but wrapped
    # too, so no static scalar remains on the hot path.)
    t1Arr  = jnp.asarray(runTime)
    dt0Arr = jnp.asarray(dt0)
    while float(t) < runTime - 1e-9 and nbeat <= 4 * nDense:
        sol = diffrax.diffeqsolve(
            term, diffSolver, jnp.asarray(t), t1Arr, dt0Arr, y, args=constants,
            stepsize_controller=controller, event=event,
            saveat=diffrax.SaveAt(t1=True, dense=True), max_steps=maxSteps)
        tEnd = float(sol.ts[-1])
        yEnd = sol.ys[-1]
        # Save this segment's dtDense grid points (those in (t, tEnd]). Evaluate the FULL
        # fixed-length dense grid CLAMPED into [t, tEnd] so jax.vmap(sol.evaluate) sees a
        # CONSTANT shape and compiles once; a variable-length segGrid retraces at every
        # distinct beat length, and since each run's beats differ that cache grows unbounded
        # (the second memory leak). Only the rows actually inside the segment are kept, so the
        # assembled trajectory and the saved values are unchanged.
        segMask = (grid > t + 1e-12) & (grid <= tEnd + 1e-12)
        if segMask.any():
            evalRows = np.asarray(jax.vmap(sol.evaluate)(jnp.asarray(np.clip(grid, t, tEnd))))
            ysSeg.append(evalRows[segMask])
            tsDone.extend(grid[segMask].tolist())
        # fold this beat's Max/Min projection into the running accumulators before the reset
        yEnd = _foldSegmentProjections(cpModel, sol, t, tEnd, yEnd, constants, projDt, projMax)
        fired = tEnd < runTime - 1e-9
        if not fired:
            y = yEnd
            break
        # apply the beat jumps, then continue from the event time
        _, alg = cpModel(tEnd, yEnd, constants, return_outputs=True)
        yReadFull = jnp.concatenate([yEnd, alg])
        y = _applyBeatResets(tEnd, yReadFull, yEnd, cpModel.resetOps)
        t = tEnd
        nbeat += 1

    ys = jnp.asarray(np.concatenate(ysSeg, axis=0))   # (nDense+1, nState)
    ts = jnp.asarray(np.asarray(tsDone))

    nOut = len(cpModel.outputNames)
    def _outputs(tt, yy):
        _, alg = cpModel(tt, yy, constants, return_outputs=True)
        return alg[:nOut]
    outs = jax.vmap(_outputs)(ts, ys)

    sts = y
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
    solver = simParameters.get('solver', {'type': 'euler'})
    saveBlocks = []   # list of host arrays, each (steps, nState)
    outBlocks = []    # matching algebraic-flow arrays, each (steps, nOut)
    for nruns in range(totalRuns):
        ts, ys, outs, sts = solveModelArray(cpModel, runTime, states, constants, dt0, solver=solver)

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
    return jnp.asarray([float(stateDict[n]) for n in names])   # follows jax_enable_x64 (f64/f32)


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
