####################################################################################################
# stateSetup.py  —  unified initial-state setup for baseline / calibration / control
#
# Replaces the three notebook functions reuseStates / reuseStatesCalibration /
# reuseStatesControl with one layered design:
#
#   Layer 1  resetStates(states, resetTable)         — pure, shared core.
#            deepcopy of modelStructure['states'] + table-driven reset of the
#            transient/derived states (lactate + gas compartments, + per-mode
#            concentration inits). Same logic all three modes shared by hand.
#
#   Layer 2  _configure<Mode>(...)                   — mode-specific configuration.
#            Maps a config source (twinTargets / controlParams) onto the model's
#            controller params. The regular parts (ANS ramp sensitivities) run
#            through the _applyRamp data table; the irregular parts stay as small
#            named helpers (_localWiring, valueUpdater) instead of inlined chains.
#
#   Layer 3  configureStates(simulationParams, modelStructure, mode, ...)
#            single entry point. (modelStructure, mode, config) -> (states,
#            modelStructure): a clean request/response boundary for the future
#            web-app (POST /simulate) — no notebook dependency.
#
# Behavioural notes vs the legacy notebook functions:
#   * Gas-compartment reset is unified to the calibration/control values (2.0e8 …).
#     The legacy baseline path used values 10x smaller (2.0e7 …); that was a bug.
#   * The legacy functions mutated modelStructure['states'] in place during reset;
#     here we deepcopy first, so the source dict is left untouched. The returned
#     state dict is identical.
#   * Debug print() calls in the legacy control path are dropped.
#
# WEB-APP TODO: the _RAMP_LOCAL / _RAMP_GLOBAL tables and the calibration target
# map are the data-driven seam. Externalising them to JSON under config/ (with
# the handler names below as the only Python) makes the physiology editable
# without redeploying — the intended end state.
####################################################################################################

import copy

import numpy as np


####################################################################################################
# region Layer 1 — pure shared core: state init + reset
####################################################################################################

# Transient/derived states that must be reset to known sentinels at the start of a
# run, regardless of mode. Substring/prefix match against every state name.
_RESET_GASES_LACTATE = [
    {'contains': 'Y_C3H5O3-', 'value': 1e-8},
    {'contains': 'V_O2_Comp0', 'value': 200000150.148589697},
    {'contains': 'V_C2_Comp0', 'value': 263190.303378143988},
    {'contains': 'V_N2_Comp0', 'value': 799737580.84357335},
]

RESET_BASELINE = list(_RESET_GASES_LACTATE)
RESET_CONTROL = list(_RESET_GASES_LACTATE)
RESET_CALIBRATION = _RESET_GASES_LACTATE + [
    {'startswith': 'Y_Hb_', 'value': 0.5},
    {'startswith': 'Y_HbO2_', 'value': 9.0},
    {'startswith': 'Y_HCO3-_', 'value': 24.4},
]


def _matches(name, rule):
    if 'contains' in rule:
        return rule['contains'] in name
    if 'startswith' in rule:
        return name.startswith(rule['startswith'])
    if 'equals' in rule:
        return name == rule['equals']
    return False


def resetStates(states, resetTable):
    """Overwrite every state whose name matches a reset rule with the rule's value.
    Pure: mutates and returns the passed dict."""
    for rule in resetTable:
        for name in states:
            if _matches(name, rule):
                states[name] = rule['value']
    return states


def initStates(modelStructure, resetTable):
    """Layer-1 core: deepcopy the JSON-loaded states and apply the reset table."""
    states = copy.deepcopy(modelStructure['states'])
    resetStates(states, resetTable)
    return states

# endregion
####################################################################################################


####################################################################################################
# region Layer 2 — baseline
####################################################################################################

def _configureBaseline(modelStructure):
    # Baseline does no controller configuration: init + reset only.
    return initStates(modelStructure, RESET_BASELINE)

# endregion
####################################################################################################


####################################################################################################
# region Layer 2 — calibration (configure calibration targets from twinTargets)
####################################################################################################

def resolveCalibrationBounds(modelCalibration, calibrationConf, paramNames):
    """The single source of truth for a calibration parameter's [minValue, maxValue].

    Defaults to the model-JSON clamp (``modelCalibration[p]['params']['minValue' /
    'maxValue']``) and overlays an optional per-param ``calibrationConf['bounds']`` map
    (scenario/runConfig override). Used BOTH to build the solve-time controller clamp
    (see ``_configureCalibration``) and the notebook LHS-seeding / MCMC-prior box, so the
    two can never diverge. Returns a ``(len(paramNames), 2)`` float array aligned to
    ``paramNames``."""
    override = (calibrationConf or {}).get('bounds', {})
    rows = []
    for p in paramNames:
        params = modelCalibration[p]['params']
        lo, hi = override.get(p, [params['minValue'], params['maxValue']])
        rows.append([lo, hi])
    return np.array(rows, dtype=float)


def _configureCalibration(simulationParams, modelStructure, twinTargets):
    statesFile = copy.deepcopy(modelStructure['states'])

    twin = simulationParams['simulationConf']['shared']['twin']
    flowDistribution = twin['flowDistribution']
    volumeDistribution = twin['volumeDistribution']
    totalBloodVolume = twinTargets['TotalBloodVolume']

    # Initial compartment volumes from the volume distribution.
    for compartment, proportion in volumeDistribution.items():
        statesFile['V_' + compartment] = totalBloodVolume * proportion

    def valueUpdater(entry, targetValue):
        # State-type calibrators write an initial value (y0 + state); everything
        # else sets the controller's targetValue.
        if 'State' in entry['type']:
            targetName = entry['params']['targetValue']
            modelStructure['other'][targetName]['params']['y0'] = targetValue
            statesFile[targetName] = targetValue
        else:
            entry['params']['targetValue'] = targetValue

    for key, value in modelStructure['calibration'].items():
        varToControl = value['params']['varToControl']
        varTarget = value['params']['varTarget'] if 'cubic' in value['type'] else ''

        # --- Volumes & unstressed volumes -------------------------------------
        # Route through valueUpdater so State-type calibrators (cubicStateController,
        # used by the sepsis population) write the volume into their target STATE rather
        # than clobbering the state-name ref with a float; identical to the old direct
        # assignment for the constant-target path.
        if varTarget.startswith('V_'):
            valueUpdater(value, statesFile[varTarget])
        if varTarget.startswith('avg_V_'):
            valueUpdater(value, statesFile[varTarget[4:]])
        if (varToControl.startswith('V0_') and 'Thx' not in varToControl
                and 'Plr' not in varToControl and 'Seringe' not in varToControl):
            value['params']['maxValue'] = statesFile['V' + varToControl[2:]]

        # --- Pressures --------------------------------------------------------
        # The My-ICU-Twin convergence twin (identified by an 'amp_P_As' key) specifies
        # the capillary means as a pressure DROP from the upstream arterial target, not
        # as an absolute mean (matching Convergence_Population.ipynb's targetsArray); the
        # full CPET twin specifies them absolutely. avg_P_Cs is the cardio-only single
        # systemic capillary, counterpart of the full model's P_Ch/P_Ca/P_Cl pressures.
        ampConvention = 'amp_P_As' in twinTargets
        if varTarget.startswith('avg_P_Cs'):
            if ampConvention:
                valueUpdater(value, twinTargets['Sys_P_As'] - twinTargets['amp_P_As']
                             - twinTargets['avg_P_Cs'])
            else:
                valueUpdater(value, twinTargets['avg_P_Cs'])
        elif varTarget.startswith('avg_P_Cp'):
            if ampConvention:
                valueUpdater(value, twinTargets['Dia_P_Ap'] - twinTargets['avg_P_Cp'])
            else:
                valueUpdater(value, twinTargets['avg_P_Cp'])
        elif (varTarget.startswith('P_Ch') or varTarget.startswith('P_Ca')
                or varTarget.startswith('P_Cl') or varTarget.startswith('P_Vh')):
            valueUpdater(value, twinTargets[varTarget])
        if varToControl == 'C_Vs':
            valueUpdater(value, twinTargets['CVP'])

        # --- Flows ------------------------------------------------------------
        if 'SV' in varTarget:
            totSV = twinTargets['CO'] / twinTargets['HR']
            # The main LV-elastance controller (Vv0_elastance_Hl in the full model,
            # E_Hl in the cardio-only model) targets the whole stroke volume; the
            # per-region flow controllers split it by flowDistribution.
            if 'Vv0_elastance_Hl' in varToControl or varToControl not in flowDistribution:
                targetValue = totSV
            else:
                targetValue = flowDistribution[varToControl] * totSV
            valueUpdater(value, targetValue)
        if 'Q_' in varTarget:
            valueUpdater(value, twinTargets[varTarget])

        # --- Thorax & lungs ---------------------------------------------------
        if varToControl.startswith('Vv0_V0_'):
            valueUpdater(value, twinTargets['TV'])
        if varToControl.startswith('V0_Plr'):
            valueUpdater(value, twinTargets['FRC'])

        # --- Systolic / diastolic pressures -----------------------------------
        # Prefer an explicit pulse-amplitude target (amp_P_*) when the twin provides
        # one (cardio-only model); otherwise derive it from systolic - diastolic.
        if varToControl == 'C_As':
            ampAs = twinTargets.get(
                'amp_P_As', twinTargets.get('Sys_P_As', 0.0) - twinTargets.get('Dia_P_As', 0.0))
            valueUpdater(value, ampAs)
        if varToControl == 'C_Ap':
            ampAp = twinTargets.get(
                'amp_P_Ap', twinTargets.get('Sys_P_Ap', 0.0) - twinTargets.get('Dia_P_Ap', 0.0))
            valueUpdater(value, ampAp)
        if 'keep_max_P_As' in varTarget:
            valueUpdater(value, twinTargets['Sys_P_As'])
        if 'keep_max_P_Ap' in varTarget:
            valueUpdater(value, twinTargets['Sys_P_Ap'])

    # --- Calibration-range override (single source of truth) ------------------
    # The controller clamp [minValue, maxValue] defaults to the model JSON; an optional
    # scenario/runConfig `calibration.bounds` map overrides it per-param here, BEFORE
    # prepareModel bakes the clamp constants, so the solve-time clamp matches the
    # notebook seeding/prior box (both resolve via resolveCalibrationBounds). Applied
    # last so an explicit override wins over the per-param defaults set above.
    boundsOverride = simulationParams['simulationConf']['calibration'].get('bounds', {})
    for param, (lo, hi) in boundsOverride.items():
        if param in modelStructure['calibration']:
            modelStructure['calibration'][param]['params']['minValue'] = lo
            modelStructure['calibration'][param]['params']['maxValue'] = hi

    # --- Reset transient states + derived rates -------------------------------
    resetStates(statesFile, RESET_CALIBRATION)
    for state in statesFile:
        if 'Cyc_HC' in state:
            statesFile[state] = 60 / twinTargets['HR']
        if 'Cyc_RCLa' in state and 'RR' in twinTargets:
            statesFile[state] = 60 / twinTargets['RR']

    return statesFile, modelStructure

# endregion
####################################################################################################


####################################################################################################
# region Layer 2 — control (configure ANS controllers from controlParams)
####################################################################################################

# Ramp-sensitivity field map: controller-param name <- controlParams group key.
_RAMP_FIELDS_LOCAL = [
    ('minValue', 'min'), ('maxValue', 'max'),
    ('chemoSensitivity', 'chemoSensitivity'),
    ('baroSensitivity', 'baroSensitivity'),
    ('localSensitivity', 'localSensitivity'),
]
_RAMP_FIELDS_GLOBAL = _RAMP_FIELDS_LOCAL[:4]   # global ramps have no localSensitivity


def _applyRamp(entry, groupCfg, fields):
    for paramName, cfgKey in fields:
        entry['params'][paramName] = groupCfg[cfgKey]


def _localWiring(entry, statesFile, modelStructure):
    # Seed the local-regulator target state + its 'other' integrator y0.
    localTarget = entry['params']['localTarget']
    localRegulator = entry['params']['localRegulator']
    statesFile[localTarget] = statesFile[localRegulator]
    modelStructure['other'][localTarget]['params']['y0'] = statesFile[localRegulator]


def _configureControlOther(modelStructure, controlConfiguration, statesFile):
    for key, value in modelStructure['other'].items():
        if 'baroreceptor' in key:
            value['params']['maxValue'] = controlConfiguration[key]['max']
            value['params']['minValue'] = controlConfiguration[key]['min']
            value['params']['slope'] = controlConfiguration[key]['slope']
        elif 'chemoreceptor' in key:
            value['params']['maxValue'] = controlConfiguration[key]['max']
            value['params']['minValue'] = controlConfiguration[key]['min']
            value['params']['slope'] = controlConfiguration[key]['slope']
        elif 'Upt_TissuesLeg' in key or 'Upt_TissuesHead' in key or 'Upt_TissuesAbdomen' in key:
            value['params']['y0'] = statesFile[value['params']['newVarName']]


def _configureControlEntry(key, value, controlConfiguration, statesFile, modelStructure):
    cfg = controlConfiguration

    # --- Areas (default: dc = current value) ----------------------------------
    if 'area' in key and cfg['updateArea'] is True:
        mult = cfg['lungArea'] if 'Cp' in key else cfg['tissueArea']
        volume = value['params']['varTarget']
        value['params']['linear'] = (statesFile[key] / statesFile[volume]) * mult
    else:
        value['params']['dc'] = statesFile[key]

    # --- Polynomial controllers ----------------------------------------------
    if key == 'Vv0_elastance_Hr':
        varTarget = value['params']['varTarget']
        value['params']['dc'] = cfg[key]['dc']
        value['params']['linear'] = statesFile[key] / statesFile[varTarget]
        value['params']['quadratic'] = cfg[key]['quadratic']
    if key == 'C_Ap':
        value['params']['dc'] = statesFile[key]
        value['params']['linear'] = cfg[key]['linear']
        value['params']['quadratic'] = cfg[key]['quadratic']
    if key == 't_Sys_HC':
        value['params']['dc'] = cfg[key]['dc']
        value['params']['linear'] = cfg[key]['linear']
        value['params']['quadratic'] = cfg[key]['quadratic']

    # --- Inflection points (also seed the underlying receptor) ----------------
    if 'inflectionPoint_baroreceptor' in key:
        value['params']['dc'] = statesFile['avg_P_As']
        value['params']['linear'] = cfg[key]['linear']
        value['params']['quadratic'] = cfg[key]['quadratic']
        underlying = key.split('_')[-1]
        modelStructure['other'][underlying]['params']['inflectionPoint'] = statesFile[key]
    if 'inflectionPoint_chemoreceptor' in key:
        value['params']['dc'] = statesFile['Y_C2_As']
        value['params']['linear'] = cfg[key]['linear']
        value['params']['quadratic'] = cfg[key]['quadratic']
        underlying = key.split('_')[-1]
        modelStructure['other'][underlying]['params']['inflectionPoint'] = cfg[key]['dc']

    # --- Ramp local: capacitors ----------------------------------------------
    if key.startswith('C_C') and 'Cp' not in key:
        _applyRamp(value, cfg['C_C'], _RAMP_FIELDS_LOCAL)
        _localWiring(value, statesFile, modelStructure)
    elif key.startswith('C_C') and 'Cp' in key:
        _applyRamp(value, cfg['C_P'], _RAMP_FIELDS_LOCAL)
    elif key.startswith('C_Vp'):
        _applyRamp(value, cfg['C_Vp'], _RAMP_FIELDS_LOCAL)

    # --- Ramp local: arterial resistances ------------------------------------
    if key.startswith('R_A') and 'Ap' not in key:
        if 'Ch' in key:
            _applyRamp(value, cfg['R_Ah'], _RAMP_FIELDS_LOCAL)
            _localWiring(value, statesFile, modelStructure)
        elif 'Cl' in key:
            _applyRamp(value, cfg['R_Al'], _RAMP_FIELDS_LOCAL)
            _localWiring(value, statesFile, modelStructure)
        elif 'Ca' in key:
            _applyRamp(value, cfg['R_Aa'], _RAMP_FIELDS_LOCAL)
            _localWiring(value, statesFile, modelStructure)
    elif key.startswith('R_A') and 'Ap' in key:
        _applyRamp(value, cfg['R_Ap'], _RAMP_FIELDS_LOCAL)

    # --- Ramp local: capillary & airway resistances --------------------------
    if key.startswith('R_C') and 'Cp' not in key:
        if 'Ch' in key:
            _applyRamp(value, cfg['R_Ch'], _RAMP_FIELDS_LOCAL)
        else:
            _applyRamp(value, cfg['R_C'], _RAMP_FIELDS_LOCAL)
        _localWiring(value, statesFile, modelStructure)
    elif key.startswith('R_C') and 'Cp' in key:
        _applyRamp(value, cfg['R_Ap'], _RAMP_FIELDS_LOCAL)
        _localWiring(value, statesFile, modelStructure)
    elif key.startswith('R_L'):
        _applyRamp(value, cfg['R_L'], _RAMP_FIELDS_LOCAL)

    # --- Ramp global ----------------------------------------------------------
    for prefix, group in (('C_Vs', 'C_Vs'),
                          ('Vv0_elastance_Hl', 'Vv0_elastance_Hl'),
                          ('VV0_elastance_Hl', 'VV0_elastance_Hl'),
                          ('Cyc_HC', 'Cyc_HC'),
                          ('Vv0_V0_ThoraxMuscle', 'Vv0_V0_ThoraxMuscle'),
                          ('Cyc_RCLa', 'Cyc_RCLa')):
        if key.startswith(prefix):
            _applyRamp(value, cfg[group], _RAMP_FIELDS_GLOBAL)

    # --- Cubic controllers ----------------------------------------------------
    if key.startswith('k_C6H12O6_C3H6O3_Tissue'):
        g = cfg['k_C6H12O6_C3H6O3_Tissue']
        value['params']['maxValue'] = g['max']
        value['params']['minValue'] = g['min']
        value['params']['cubicFactor'] = g['cubicFactor']
        value['params']['linearFactor'] = g['linearFactor']
        value['params']['k'] = g['k']


def _configureControl(simulationParams, modelStructure):
    statesFile = copy.deepcopy(modelStructure['states'])
    controlConfiguration = simulationParams['simulationConf']['control']['params']

    _configureControlOther(modelStructure, controlConfiguration, statesFile)

    for key, value in modelStructure['control'].items():
        _configureControlEntry(key, value, controlConfiguration, statesFile, modelStructure)

    # --- Config-driven reaction speeds & concentrations -----------------------
    for state in statesFile:
        if state.startswith('k_C3H6O3_O2') and 'k_C3H6O3_O2' in controlConfiguration:
            statesFile[state] = controlConfiguration['k_C3H6O3_O2']
        if state.startswith('k_Physio_C3H6O3_O2') and 'k_Physio_C3H6O3_O2' in controlConfiguration:
            statesFile[state] = controlConfiguration['k_Physio_C3H6O3_O2']
        if state.startswith('Y_NAD+_') and controlConfiguration['updateNAD'] is True:
            statesFile[state] = controlConfiguration['Y_NAD+_']
        if state.startswith('Y_HbO2_') and controlConfiguration['updateHb'] is True:
            statesFile[state] = controlConfiguration['Y_HbO2_']

    # --- Reset transient states -----------------------------------------------
    resetStates(statesFile, RESET_CONTROL)

    return statesFile, modelStructure

# endregion
####################################################################################################


####################################################################################################
# region Layer 3 — single entry point
####################################################################################################

def configureStates(simulationParams, modelStructure, mode, twinTargets=None):
    """Build the initial name-keyed state dict for a run and configure the model's
    controllers for the given mode.

    mode == 'baseline'    -> returns (states, modelStructure); no controller config.
    mode == 'calibration' -> returns (states, modelStructure); calibration targets
                             set from twinTargets (defaults to simulationParams).
    mode == 'control'     -> returns (states, modelStructure); ANS controllers set
                             from simulationParams[...]['controlParams'].
    """
    if mode == 'baseline':
        return _configureBaseline(modelStructure), modelStructure
    if mode == 'calibration':
        if not twinTargets:
            twinTargets = simulationParams['simulationConf']['shared']['twin']['twinTargets']
        return _configureCalibration(simulationParams, modelStructure, twinTargets)
    if mode == 'control':
        return _configureControl(simulationParams, modelStructure)
    raise ValueError(f"Unknown mode {mode!r}; expected 'baseline', 'calibration' or 'control'.")

# endregion
####################################################################################################
