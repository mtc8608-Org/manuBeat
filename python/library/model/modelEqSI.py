####################################################################################################
# modelEqSI.py  —  step-INDEPENDENT equation layer (Stage 1 fork)
#
# Companion to modelEq.py. The array stack today integrates a set of "step
# operators" whose derivative is `(target - X)/self.step`; under fixed-step Euler
# with `self.step == dt` that is exact algebraic assignment with a one-step lag
# (see the `step-operator-equations` / `step-independence-hr-test` memos). Those
# states only exist to fit the integrate-everything framework and they pin the
# solver to `dt == step`.
#
# This module does NOT redefine the equations. It re-exports every class from
# modelEq unchanged (so modelGen-built objects keep working and `isinstance`
# checks resolve to the same class identities) and adds the small SI layer that
# modelClassSI uses to PROMOTE a chosen subset of those states to algebraic
# outputs (computed fresh every RHS eval, never integrated, no `/step`).
#
# Two SI mechanisms live here:
#  (1) ALGEBRAIC PROMOTION — P1 states whose `dP = (target - X)/step` is just a
#      lagged algebraic assignment are emitted directly (no state, no /step):
#        * pressure capacitors  -> `pressure(t, y)`   (NOT ConstantPressure)
#        * SubstactStates       -> `state1 - state2`
#        * PolynomialController -> the polynomial of its target
#  (2) SI EQUATION SUBCLASSES — the "step appears only at the cycle reset"
#      operators (PeriodicTrigger, CycleIntegrator/Keeper/Max/Min). These STAY
#      integrated states, but their `/step` reset/snap branches are replaced by
#      step-free methods that the integrator calls: a continuous derivative, an
#      explicit `resets()` jump, and (Max/Min) a `project()` running update. The
#      step-free equation logic lives HERE, not inline in modelClassSI.
####################################################################################################

# Re-export the entire equation library unchanged (classes, resolveEquation,
# describeEquation, CONST_REF_FIELDS, OPERATOR_CLASSES, ...). modelClassSI imports
# THIS module as `eq`, so everything it needs from modelEq is available here.
from library.model.modelEq import *          # noqa: F401,F403
import library.model.modelEq as _eq
import dataclasses as _dataclasses
import jax.numpy as jnp


####################################################################################################
# region SI classification — which states get promoted to algebraic outputs
####################################################################################################

# Pressure capacitors whose `dP` is the P1 relaxation `(pressure - P)/step`. Their
# `pressure()` is a pure function of *other* states (volumes / elastance inputs),
# never of their own pressure state, so emitting `pressure()` directly is exact.
# ConstantPressure is deliberately EXCLUDED: its `pressure()` returns its own state
# (`y[pressureName]`) and its `dP` is 0 — it is already step-independent and must
# stay a state to avoid a self-referential algebraic slot.
PRESSURE_ALG_CLASSES = (
    _eq.Capacitor,
    _eq.CapacitorSelfBreathingThorax,
    _eq.ElastanceInputCapacitor,
    _eq.ElastanceCapacitor,
    _eq.SigmoidCapacitor,
    _eq.DoubleSigmoidCapacitor,
    _eq.VentilatorPressure,
    _eq.FilePressure,
)

# Scalar P1 helpers whose algebraic target is a closed-form function of other states.
SCALAR_ALG_CLASSES = (
    _eq.SubstactStates,
    _eq.PolynomialController,
)

ALG_CLASSES = PRESSURE_ALG_CLASSES + SCALAR_ALG_CLASSES


def isAlgebraic(o) -> bool:
    """True if equation object `o` should be promoted from an integrated state to
    an algebraic output under the SI reformulation (Stage 1)."""
    return isinstance(o, ALG_CLASSES)


def isPressureAlg(o) -> bool:
    return isinstance(o, PRESSURE_ALG_CLASSES)


def algebraicValue(o, t, y, constants):
    """The algebraic value an SI-promoted equation emits (its P1 *target*), read
    from the live extended vector `y`. Field names are already int-resolved by
    resolveEquation. Mirrors the numerator of each class's `(target - X)/step`.

    Evaluation-order contract (enforced by the caller, modelClassSI RHS):
      polynomial controllers  ->  pressures  ->  substractions
    so an ElastanceCapacitor reading a promoted `t_Sys_HC` sees the fresh value.
    """
    if isinstance(o, PRESSURE_ALG_CLASSES):
        return o.pressure(t, y)
    if isinstance(o, _eq.SubstactStates):
        return y[o.state1] - y[o.state2]
    if isinstance(o, _eq.PolynomialController):
        varTarget = y[o.varTargetIdx]
        return (constants[o.dcFactor]
                + varTarget * constants[o.linearFactor]
                + varTarget ** 2 * constants[o.quadraticFactor])
    raise TypeError(f"algebraicValue: {type(o).__name__} is not an SI-algebraic class")

# endregion
####################################################################################################


####################################################################################################
# region SI cycle operators — step-free subclasses (continuous + reset/project)
#
# These STAY integrated states (genuine ODE between beats). The `/step` branches of
# the originals are split into step-free pieces the integrator (modelClassSI's Euler
# scan) calls each step:
#   * continuousDerivative(y)  — the between-beats ODE (no /step)
#   * project(y)               — Max/Min running update applied AFTER the Euler step
#   * triggered(t, y)          — the beat condition  (t + T0) - Trig >= 0
#   * resets(y)                — the discrete jumps applied AT the beat
# `y` is the full extended vector. Subclasses add no fields, so resolveEquation and
# the static-jit hashing behave exactly as for the base classes.
#
# Per operator:
#   PeriodicTrigger : dTim=1, dTrig=0 ;            reset Tim->0, Trig->Trig+period
#   CycleIntegrator : dInt=input ;                 reset Int->0
#   CycleKeeper     : dKeep=0 ;                     reset Keep->input (latched)
#   CycleMax        : dMax=0, project max ;         reset Max->0
#   CycleMin        : dMin=0, project min ;         reset Min->input
####################################################################################################


def _triggered(o, t, y):
    """Beat condition shared by every cycle operator: (t + T0) - Trig >= 0."""
    return (t + y[o.initialTimeIdx] - y[o.triggerIdx]) >= 0.0


class PeriodicTriggerSI(_eq.PeriodicTrigger):
    def dTrigger(self):           return 0.0
    def dTimer(self):             return 1.0
    def triggered(self, t, y):    return _triggered(self, t, y)
    def resets(self, y):
        return ((self.timerIdx,   0.0),
                (self.triggerIdx, y[self.triggerIdx] + y[self.cyclePeriodIdx]))


class CycleIntegratorSI(_eq.CycleIntegrator):
    def continuousDerivative(self, y):  return y[self.varToProcessIdx]
    def triggered(self, t, y):          return _triggered(self, t, y)
    def resets(self, y):                return ((self.processedIdx, 0.0),)


class CycleKeeperSI(_eq.CycleKeeper):
    def continuousDerivative(self, y):  return 0.0
    def triggered(self, t, y):          return _triggered(self, t, y)
    def resets(self, y):                return ((self.processedIdx, y[self.varToProcessIdx]),)


class CycleMaxSI(_eq.CycleMax):
    def continuousDerivative(self, y):  return 0.0
    def project(self, y):
        return (self.processedIdx, jnp.maximum(y[self.processedIdx], y[self.varToProcessIdx]))
    def triggered(self, t, y):          return _triggered(self, t, y)
    def resets(self, y):                return ((self.processedIdx, 0.0),)


class CycleMinSI(_eq.CycleMin):
    def continuousDerivative(self, y):  return 0.0
    def project(self, y):
        return (self.processedIdx, jnp.minimum(y[self.processedIdx], y[self.varToProcessIdx]))
    def triggered(self, t, y):          return _triggered(self, t, y)
    def resets(self, y):                return ((self.processedIdx, y[self.varToProcessIdx]),)


# Map each base class to its step-free SI subclass.
_SI_SUBCLASS = {
    _eq.PeriodicTrigger: PeriodicTriggerSI,
    _eq.CycleIntegrator: CycleIntegratorSI,
    _eq.CycleKeeper:     CycleKeeperSI,
    _eq.CycleMax:        CycleMaxSI,
    _eq.CycleMin:        CycleMinSI,
}

RESET_OPERATOR_CLASSES = tuple(_SI_SUBCLASS.keys())
PROJECT_OPERATOR_CLASSES = (_eq.CycleMax, _eq.CycleMin)


def isResetOperator(o) -> bool:
    return isinstance(o, RESET_OPERATOR_CLASSES)


def isProjectOperator(o) -> bool:
    return isinstance(o, PROJECT_OPERATOR_CLASSES)


def wrapSI(o):
    """Return `o` re-typed as its step-free SI subclass (same fields), or `o`
    unchanged if it has no SI variant. Builds the instance by copying fields onto
    a fresh subclass instance (bypassing __init__, the same way resolveEquation
    rebuilds frozen equinox modules)."""
    cls = _SI_SUBCLASS.get(type(o))
    if cls is None:
        return o
    new = cls.__new__(cls)
    for f in _dataclasses.fields(o):
        object.__setattr__(new, f.name, getattr(o, f.name))
    return new

# endregion
####################################################################################################
