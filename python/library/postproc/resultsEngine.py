"""Lazy, DAG-based post-processing engine for simulation results.

Replaces the eager ~40-branch if/elif in dataProcessing.processVariables. Key
properties:

  * Flat signal store (name -> ndarray); no {'data','metadata'} nesting and no
    copy.deepcopy during computation.
  * Operations registered in a dispatch table (no if/elif chain).
  * Dependencies are extracted per op, so signals compute in true dependency
    order via a memoized depth-first walk -- no reliance on JSON stage ordering.
  * Lazy: evaluate(requested) computes only the transitive closure of the
    requested outputs. Default computes every configured output.
  * Errors are collected (name, op, reason) instead of silently returning zeros;
    strict=True re-raises.

The op math is reused verbatim from dataProcessing via a thin read-only view so
results stay bit-identical to the legacy engine. Cycle ops have vectorized
equivalents in dataProcessing; this engine simply dispatches to them.

`assembleLegacy()` rebuilds the old {name: {'data','metadata'}} shape that
plots.py consumes; `toPayload()` builds a JSON-friendly dict for a web server.
"""

import numpy as np
import copy
import math
import library.postproc.dataProcessing as dp
import library.utils as utils


# --- read-only view exposing the flat signal store in the legacy nested shape ---
class _Sig:
    __slots__ = ('data',)

    def __init__(self, arr):
        self.data = arr

    def __getitem__(self, k):
        if k == 'data':
            return self.data
        raise KeyError(k)


class _View:
    """Minimal Mapping over a flat {name: ndarray} dict that yields _Sig wrappers,
    so the existing dataProcessing op functions (which read results[name]['data'])
    run unchanged on the flat store."""

    def __init__(self, signals):
        self._s = signals

    def __contains__(self, k):
        return k in self._s

    def __getitem__(self, k):
        return _Sig(self._s[k])

    def keys(self):
        return self._s.keys()

    def items(self):
        return ((k, _Sig(v)) for k, v in self._s.items())

    def __len__(self):
        return len(self._s)


# Operations that need the live modelObjects (only used when signals are not
# precomputed; computeModelDerived normally fills these as plain arrays upstream).
_MODEL_OPS = {
    'thoraxUnstressedVolume': 'calculateThoraxUnstressedVolume',
    'calculateElastance': 'calculateElastance',
    'calculateCompliance': 'calculateCompliance',
    'calculateSigmoidCompliance': 'calculateSigmoidCompliance',
    'calculateSigmoidComplianceRange': 'calculateSigmoidComplianceRange',
    'calculateSigmoid': 'calculateSigmoid',
    'calculateSigmoidRange': 'calculateSigmoidRange',
    'calculateSigmoidRangeArray': 'calculateSigmoidRangeArray',
    'calculateConcentrationInGas': 'calculateConcentrationInGas',
}

# Plain (params, results) -> ndarray ops, dispatched straight to dataProcessing.
_ARRAY_OPS = {
    'sumOfArrays': dp.sumOfArrays,
    'proportion': dp.proportion,
    'constantMultiplication': dp.constantMultiplication,
    'constantSubstraction': dp.constantSubstraction,
    'absoluteValue': dp.absoluteValue,
    'integral': dp.integral,
    'minusMin': dp.minusMin,
    'minusY0': dp.minusY0,
    'difference': dp.difference,
    'range': dp.rangeArray,
    'division': dp.division,
    'pH': dp.pH,
    'oxygenSaturation': dp.oxygenSaturation,
    'movingAverage': dp.movingAverage,
    'integralOverCycle': dp.integralOverCycle,
    'variationOfIntegalValueOverCycle': dp.variationOfIntegalValueOverCycle,
    'variationOfValueOverCycle': dp.variationOfValueOverCycle,
    'valueOverCycle': dp.valueOverCycle,
    'cardiacOutput': dp.cardiacOutput,
    'heartRate': dp.heartRate,
    'volumetricFlow': dp.volumetricFlow,
    'totalBloodGasMoles': dp.totalBloodGasMoles,
    'totalTissueGasMoles': dp.totalTissueGasMoles,
    'molToVolume': dp.molToVolume,
    'volumeToMol': dp.volumeToMol,
    'concentrationToVolume': dp.concentrationToVolume,
}


def opDependencies(op, params):
    """Signal names an op reads. Scalars (constant/step/window/...) are excluded.
    Returns ([], dynamic) where dynamic=True means the op scans the whole store at
    eval time (tag / model ops) and so depends on whatever leaves already exist."""
    p = params or {}
    if op == 'sumOfArrays':
        return list(p.get('resultNames', [])), False
    if op == 'proportion':
        return [p['multiplier'], p['numerator'], p['denominator']], False
    if op in ('constantMultiplication', 'constantSubstraction', 'absoluteValue',
              'integral', 'minusMin', 'minusY0', 'movingAverage', 'unitConversion'):
        return [p['resultName']], False
    if op == 'difference':
        return [p['resultName1'], p['resultName2']], False
    if op == 'division':
        return [p['numerator'], p['denominator']], False
    if op == 'pH':
        return [p['concentration']], False
    if op == 'oxygenSaturation':
        c = p['compartment']
        return ['Y_Hb_' + c, 'Y_HbO2_' + c], False
    if op in ('integralOverCycle', 'variationOfIntegalValueOverCycle',
              'variationOfValueOverCycle', 'valueOverCycle'):
        return [p['resultName'], p['cycle']], False
    if op == 'cardiacOutput':
        return [p['SV'], p['HR']], False
    if op == 'heartRate':
        return [p['cycle']], False
    if op == 'volumetricFlow':
        return [p['pressure'], p['flow']], False
    if op == 'molToVolume':
        return [p['nmol'], p['volume']], False
    if op == 'volumeToMol':
        return [p['volume'], p['pressure']], False
    if op == 'concentrationToVolume':
        return [p['volume'], p['concentration']], False
    if op in ('range',):
        return ['T'], False
    if op in ('totalBloodGasMoles', 'totalTissueGasMoles'):
        return ['T'], True            # scans all signals matching the tag
    if op in _MODEL_OPS:
        return ['T'], True            # backed by modelObjects / precomputed array
    return ['T'], True                # unknown op: be conservative


class ResultsEngine:
    """The config is an ordered pipeline of `key = op(inputs)` assignments executed
    with in-place mutation: a name may be reassigned, and an op reading a name sees
    whatever value that name holds at its file position (raw, or an earlier output).

    We model this as a DAG over op POSITIONS (SSA-style), not names. Each input name
    resolves to the most-recent prior definition (or the raw leaf). Full evaluation
    is the file-order loop (parity-exact with the legacy engine); lazy evaluation of
    a requested output executes only the positional dependency closure, in ascending
    position order, so the in-place store always holds the correct version."""

    def __init__(self, rawSignals, config, modelStructure,
                 modelObjects=None, strict=False):
        self.signals = dict(rawSignals)          # name -> ndarray (mutated in place)
        self.raw = set(rawSignals)
        self.config = config
        self.modelStructure = modelStructure
        self.modelObjects = modelObjects
        self.strict = strict
        self.errors = []                          # list[(name, op, reason)]
        self.units = {}                           # name -> unit override (unitConversion)

        # Ordered op list (duplicates kept as distinct positions).
        self.ops = []                             # [(key, cfg)]
        for stage, ops in config.items():
            for key, cfg in ops.items():
                self.ops.append((key, cfg))

        # lastDef[name] -> highest position that (re)defines name, after a full run.
        self.lastDef = {}
        for i, (key, _cfg) in enumerate(self.ops):
            self.lastDef[key] = i
        # finalOutputs preserves first-seen order of defined names (for default eval
        # reporting / assembly ordering).
        seen = set()
        self.order = []
        for key, _cfg in self.ops:
            if key not in seen:
                seen.add(key)
                self.order.append(key)

        self._view = _View(self.signals)
        self._N = len(self.signals['T']) if 'T' in self.signals else None

    # -- public API ---------------------------------------------------------
    def evaluate(self, requested=None):
        if requested is None:
            for i, (key, cfg) in enumerate(self.ops):
                self.signals[key] = self._run(key, cfg)
            return self.signals
        # Lazy: positional closure of the requested final outputs.
        needed = self._closure(requested)
        for i in sorted(needed):
            key, cfg = self.ops[i]
            self.signals[key] = self._run(key, cfg)
        return self.signals

    def _producerBefore(self, name, pos):
        """Position that supplies `name` for an op at `pos`: the latest definition
        strictly before pos, or None (raw leaf / undefined)."""
        best = None
        for i in range(pos):
            if self.ops[i][0] == name:
                best = i
        return best

    def _closure(self, requested):
        needed = set()
        stack = []
        for name in requested:
            p = self.lastDef.get(name)
            if p is not None:
                stack.append(p)
        while stack:
            pos = stack.pop()
            if pos in needed:
                continue
            needed.add(pos)
            key, cfg = self.ops[pos]
            deps, _dyn = opDependencies(cfg['operation'], cfg.get('params', {}))
            for d in deps:
                pp = self._producerBefore(d, pos)
                if pp is not None:
                    stack.append(pp)
        return needed

    def assembleLegacy(self):
        """Rebuild {name: {'data', 'metadata'}} for plots.py / notebook."""
        return _assembleMetadata(self.signals, self.modelStructure, self.units)

    def toPayload(self, requested=None):
        """JSON-friendly payload for a web server."""
        names = list(self.signals) if requested is None else requested
        meta = self.modelStructure['data']['prefixes']
        units, labels, latex = {}, {}, {}
        for n in names:
            md = self.units.get(n) or _metaFor(n, meta)
            # Prefer config/labels.json's per-name unit; fall back to prefix metadata.
            units[n] = utils.labelFor(n, 'unit', default=md.get('unit', ''))
            labels[n] = md.get('label', n)
            latex[n] = utils.labelFor(n, 'latex')   # paper-quality name for MathJax
        return {
            'signals': {n: np.asarray(self.signals[n]).tolist() for n in names},
            'units': units,
            'labels': labels,
            'latex': latex,
            'errors': [{'name': n, 'op': o, 'reason': r} for n, o, r in self.errors],
        }

    # -- internals ----------------------------------------------------------
    def _run(self, key, cfg):
        op = cfg['operation']
        params = cfg.get('params', {})
        try:
            if op == 'unitConversion':
                data, unit = dp.unitConversion(params, self._view)
                self.units[key] = {'unit': unit}
                return np.asarray(data)
            if op in _MODEL_OPS:
                if key in self.raw:                # precomputed upstream -> passthrough
                    return self.signals[key]
                fn = getattr(dp, _MODEL_OPS[op])
                return np.asarray(fn(params, self._view, self.modelObjects))
            fn = _ARRAY_OPS.get(op)
            if fn is None:
                raise KeyError(f'unknown operation {op!r}')
            return np.asarray(fn(params, self._view))
        except Exception as e:                     # noqa: BLE001 - collected, not swallowed
            self.errors.append((key, op, str(e)))
            if self.strict:
                raise
            return np.zeros(self._N if self._N else 0)


# --- metadata assembly (vectorized NaN tag; no per-key deepcopy of data) -----
def _metaFor(name, prefixes):
    for prefix in prefixes.values():
        pre = prefix.get('prefix')
        if pre and name.startswith(pre):
            return prefix
    return prefixes['unknown']


def _assembleMetadata(signals, modelStructure, units=None):
    prefixes = modelStructure['data']['prefixes']
    nan_meta = prefixes['toAdd']
    units = units or {}
    out = {}
    for name, arr in signals.items():
        arr = np.asarray(arr)
        if arr.size and np.issubdtype(arr.dtype, np.floating) and np.isnan(arr).any():
            out[name] = {'data': np.zeros(arr.shape),
                         'metadata': copy.deepcopy(nan_meta)}
            continue
        md = units.get(name)
        if md is None:
            md = copy.deepcopy(_metaFor(name, prefixes))
        else:
            base = copy.deepcopy(_metaFor(name, prefixes))
            base.update(md)
            md = base
        out[name] = {'data': arr, 'metadata': md}
    return out


def computeModelDerived(results, modelObjects, config):
    """Materialize the model-backed signals (compliance/elastance/sigmoid/thorax
    unstressed volume/concentration-in-gas) into `results` as plain ndarrays, using
    the live `modelObjects`. Call this right after a run (where modelObjects exists);
    afterwards post-processing is pure array math and needs no modelObjects, so the
    pipeline can run from saved raw arrays alone (web/server friendly).

    Mutates and returns `results` (flat name -> ndarray).
    """
    view = _View(results)
    for stage, ops in config.items():
        for key, cfg in ops.items():
            op = cfg['operation']
            if op not in _MODEL_OPS:
                continue
            fn = getattr(dp, _MODEL_OPS[op])
            try:
                results[key] = np.asarray(fn(cfg.get('params', {}), view, modelObjects))
            except Exception as e:                 # noqa: BLE001
                print(f'computeModelDerived error [{op}] {key}: {e}')
    return results


def runEngine(rawSignals, config, modelStructure, modelObjects=None,
              requested=None, strict=False):
    """Convenience: build engine, evaluate, return legacy-shaped results + engine."""
    eng = ResultsEngine(rawSignals, config, modelStructure,
                        modelObjects=modelObjects, strict=strict)
    eng.evaluate(requested)
    return eng.assembleLegacy(), eng
