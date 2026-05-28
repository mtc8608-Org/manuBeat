from . import equations as eq
from . import utils
from . import hdf5_api as HDF5API
import numpy as np
import copy

#################################################################################################################################################
##############################################################################################################################################
                                                                                                                                               ##
#███    ███  ██████  ██████  ███████ ██          ██ ███    ██ ██ ████████ ██  █████  ██      ██ ███████  █████  ████████ ██  ██████  ███    ██  ##
#████  ████ ██    ██ ██   ██ ██      ██          ██ ████   ██ ██    ██    ██ ██   ██ ██      ██    ███  ██   ██    ██    ██ ██    ██ ████   ██  ##
#██ ████ ██ ██    ██ ██   ██ █████   ██          ██ ██ ██  ██ ██    ██    ██ ███████ ██      ██   ███   ███████    ██    ██ ██    ██ ██ ██  ██  ##
#██  ██  ██ ██    ██ ██   ██ ██      ██          ██ ██  ██ ██ ██    ██    ██ ██   ██ ██      ██  ███    ██   ██    ██    ██ ██    ██ ██  ██ ██  ##
#██      ██  ██████  ██████  ███████ ███████     ██ ██   ████ ██    ██    ██ ██   ██ ███████ ██ ███████ ██   ██    ██    ██  ██████  ██   ████  ##
                                                                                                                                               ##
##############################################################################################################################################
#################################################################################################################################################9


# Initialises the model without gas exchange
# To be called by the other initialisation functions as a default option for no gas exchange
def initModelObjects(modelStructure):


    #############################################

    prefixes = modelStructure['data']['prefixes']

    compartments = modelStructure['compartments']
    resistors = modelStructure['connections']['resistive']
    connections_cycles = modelStructure['connections']['cycles']
    connections_bias = modelStructure['connections']['bias']
    connections_regions = modelStructure['connections']['regions']

    dt = modelStructure['configurations']['simulationParameters']['dt']
    atmPressure = modelStructure['gasRegions']['Atmosphere']['total']

    modelObjects = {
        'capacitors': {},         # Calculates the pressures (P) for the lungs and heart
        'inductors': {},          # Calculates the flows (Q) through the inertial resistors
        'resistors': {},          # Calculates the flows (Q) through the resistors
        'parameterVariation': {}, # Calculates the gas flows through membranes (Q)
        'connections': {},        # Calculates the volume variations (dVdt) in the compartments
        'cycles': {},             # Calculates the cycle durations
        'timekeeping': {},        # Keeps track of the time
        'other': {},
        'prefixes': copy.deepcopy(prefixes),
        'constants': {}
    }

    structures = {
        'states': {
            'states': {},
            'modelParams': {},
            'dT': {},
            'dCycles': {},
            'dOther': {},
        },
        'nonState': {
            'flows': [],
            'pressures': [],
        },
        'modelStructure':{
            'simulationParameters': modelStructure['configurations']['simulationParameters'],
        },
        'initialConditions': {},
    }

    initTimekeeping(structures,modelObjects,modelStructure)
    initOtherCalculations(structures,modelObjects,modelStructure)

    # Capacitors & Connections
    for compartment_name,compartment in compartments.items():
        biasPressureName = utils.findStrInDictionaryAndAddPrefix(compartment_name, connections_bias, prefixes['pressure']['prefix'])
        compartment_region_name = utils.findKeyInDictionaryReturnValue(compartment_name, connections_regions)
        cycleName = utils.findKeyInDictionaryReturnValue(compartment_name, connections_cycles)

        # Capacitors
        capComp = {
            'compartment_name': compartment_name,
            'capacitorName': prefixes['capacitor']['prefix'] + compartment_name,
            'volumeName': prefixes['volume']['prefix'] + compartment_name,
            'pressureName': prefixes['pressure']['prefix'] + compartment_name,
            'biasPressureName': biasPressureName,
            'unstressedVolumeName': prefixes['unstressedVolume']['prefix'] + compartment_name,
            'compartment_region_name': compartment_region_name,
            'cycleName': cycleName,
            'params': compartment['capacitor']['params'],
            'capacitorType': compartment['capacitor']['type'],
            'compartmentType': compartment['type'],
            'dt': dt,
            'atmPressure': atmPressure,
            'prefixes': prefixes
        }
        initCapacitor(structures,modelObjects,capComp)

        # Connections
        if compartment['type'] == 'component':
            fIn = []
            fOut = []
            for resistorName,resistor in resistors.items():
                flowName = prefixes['flow']['prefix'] + resistor['from'] + '_' + resistor['to']
                if resistor['from'] == compartment_name:
                    fOut.append(flowName)
                elif resistor['to'] == compartment_name:
                    fIn.append(flowName)

            modelObjects['connections'][prefixes['volume']['prefix'] + compartment_name] = eq.Connections(
                fIn,
                fOut,
                prefixes['volume']['prefix'] + compartment_name,
                stateIdx = prefixes['volume']['prefix'] + compartment_name
            )

    # Resistors
    for resistorName,resistor in resistors.items():
        biasPressureName = utils.findStrInDictionaryAndAddPrefix(resistorName, connections_bias, prefixes['pressure']['prefix'])
        compartment_region_name = utils.findKeyInDictionaryReturnValue(resistorName, connections_regions)
        cycleName = utils.findKeyInDictionaryReturnValue(resistorName, connections_cycles)

        # Resistors
        resConf = {
            'resistorFlow': prefixes['flow']['prefix'] + resistor['from'] + '_' + resistor['to'],
            'resistorName': prefixes['resistor']['prefix'] + resistor['from'] + '_' + resistor['to'],
            'inductorName': prefixes['inductance']['prefix'] + resistor['from'] + '_' + resistor['to'],
            'pressureIn': prefixes['pressure']['prefix'] + resistor['from'],
            'pressureOut': prefixes['pressure']['prefix'] + resistor['to'],
            'thresholdName': prefixes['threshold']['prefix'] + resistor['from'] + '_' + resistor['to'],
            'biasPressureName': biasPressureName,
            'compartment_region_name': compartment_region_name,
            'cycleName': cycleName,
            'params': resistor['params'],
            'resitorType': resistor['type'],
            'atmPressure': atmPressure,
            'dt': dt,
            'prefixes': prefixes
        }
        initResistors(structures,modelObjects,resConf)


    for key,dictionary in structures['states'].items():
        for key,value in dictionary.items():
            structures['initialConditions'][key] = value


    if modelStructure['configurations']['simulationParameters']['calibration'] == True:
        step = modelStructure['configurations']['simulationParameters']['dt']
        initParameterVariation(structures,modelObjects,modelStructure['calibration'],step)

    return structures['initialConditions'], modelObjects, structures




#███████  ██████  ██    ██  █████  ████████ ██  ██████  ███    ██ ███████     ██ ███    ██ ██ ████████
#██      ██    ██ ██    ██ ██   ██    ██    ██ ██    ██ ████   ██ ██          ██ ████   ██ ██    ██
#█████   ██    ██ ██    ██ ███████    ██    ██ ██    ██ ██ ██  ██ ███████     ██ ██ ██  ██ ██    ██
#██      ██ ▄▄ ██ ██    ██ ██   ██    ██    ██ ██    ██ ██  ██ ██      ██     ██ ██  ██ ██ ██    ██
#███████  ██████   ██████  ██   ██    ██    ██  ██████  ██   ████ ███████     ██ ██   ████ ██    ██
#            ▀▀

def initCapacitor(structures,modelObjects,conf):
    states = structures['states']['states']
    modelParams = structures['states']['modelParams']
    pressures = structures['nonState']['pressures']
    
    variationObjects = modelObjects['parameterVariation']
    capacitorObjects = modelObjects['capacitors']

    compartment_name = conf['compartment_name']
    capacitorName = conf['capacitorName']
    volumeName = conf['volumeName']
    pressureName = conf['pressureName']
    biasPressureName = conf['biasPressureName']
    unstressedVolumeName = conf['unstressedVolumeName']
    compartment_region_name = conf['compartment_region_name']
    cycleName = conf['cycleName']
    params = conf['params']
    capacitorType = conf['capacitorType']
    compartmentType = conf['compartmentType']
    dt = conf['dt']
    atmPressure = conf['atmPressure']
    prefixes = conf['prefixes']

    # Elastance Capacitor
    if capacitorType == 'elastance':

        nameEmax = prefixes['elastanceMax']['prefix'] + compartment_name
        nameEmin = prefixes['elastanceMin']['prefix'] + compartment_name
        
        transitionTime = prefixes['time']['prefix'] + 'transition_' + cycleName
        systolicTimeName = prefixes['time']['prefix'] + 'Sys_' + cycleName
        
        component = eq.ElastanceCapacitor(
            volumeName,
            biasPressureName,
            nameEmax, #Emax
            nameEmin, #Emin
            prefixes['cycle']['prefix'] + cycleName,
            prefixes['timer']['prefix'] + cycleName,
            transitionTime,
            systolicTimeName,
            pressureName,
            dt,
        )

        modelParams[nameEmax] = params['Emax']
        variationObjects[nameEmax] = eq.NoController(nameEmax)

        modelParams[nameEmin] = params['Emin']
        variationObjects[nameEmin] = eq.NoController(nameEmin)

        if transitionTime not in modelParams:
            modelParams[transitionTime] = params['transitionTime']
            variationObjects[transitionTime] = eq.NoController(transitionTime)

        if systolicTimeName not in modelParams:
            modelParams[systolicTimeName] = params['systolicTime']
            variationObjects[systolicTimeName] = eq.NoController(systolicTimeName)

    # Capacitor
    elif capacitorType == 'capacitor':
        regionVolumes = []
        for region in compartment_region_name:
            regionVolumes.append(prefixes['volume']['prefix'] + region)


        partialVolumes = []
        if 'compartment_volumes' in conf:
            compartment_volumes = conf['compartment_volumes']
            for key,volume in compartment_volumes.items():
                partialVolumes.append(key)


        component = eq.Capacitor(
            volumeName,
            capacitorName,
            biasPressureName,
            pressureName,
            dt,
            unstressedVolumeName,
            regionVolumes,
            partialVolumes,
        )

        modelParams[capacitorName] = params['C']
        variationObjects[capacitorName] = eq.NoController(capacitorName)

        modelParams[unstressedVolumeName] = params['V0']
        variationObjects[unstressedVolumeName] = eq.NoController(unstressedVolumeName)

    # Thorax Capacitor
    elif capacitorType == 'thorax':
        regionVolumes = []
        for region in compartment_region_name:
            regionVolumes.append(prefixes['volume']['prefix'] + region)
        nameV0 = prefixes['unstressedVolume']['prefix'] + compartment_name

        component = eq.CapacitorSelfBreathingThorax(
            C = capacitorName,
            uVolIdx = params['uVol'],
            V0 = nameV0,
            biasPIdx = biasPressureName,
            children = regionVolumes,
            pressureName = pressureName,
            step = dt,
            )

        modelParams[nameV0] = params['V0']
        variationObjects[nameV0] = eq.NoController(nameV0)

        modelParams[capacitorName] = params['C']
        variationObjects[capacitorName] = eq.NoController(capacitorName)
    
    # Elastance Input Capacitor
    elif capacitorType == 'elastanceInput':
        component = eq.ElastanceInputCapacitor(
            E = params['E'],
            V0 = unstressedVolumeName,
            V = volumeName,
            biasPIdx = biasPressureName,
            stateIdx = pressureName,
            step = dt,
            )
        modelParams[unstressedVolumeName] = params['V0']
        variationObjects[unstressedVolumeName] = eq.NoController(unstressedVolumeName)

    # Contant pressure Capacitor
    elif capacitorType == 'constantPressure':
        component = eq.ConstantPressure(
            pressureName,
            )

    # Ventilator pressure Capacitor
    elif capacitorType == 'ventilator':

        nameAmp = prefixes['amplitude']['prefix'] + compartment_name
        namePEEP = prefixes['PEEP']['prefix'] + compartment_name
        nameIven = prefixes['Iven']['prefix'] + compartment_name
        nameEven = prefixes['Even']['prefix'] + compartment_name
        nameSlopeFr = prefixes['slopeFraction']['prefix'] + compartment_name

        component = eq.VentilatorPressure(
            nameAmp,
            namePEEP,
            prefixes['cycle']['prefix'] + cycleName,
            prefixes['timer']['prefix'] + cycleName,
            nameIven,
            nameEven,
            nameSlopeFr,
            pressureName,
            dt,
        )

        modelParams[nameAmp] = params['amplitude']
        variationObjects[nameAmp] = eq.NoController(nameAmp)

        modelParams[namePEEP] = atmPressure + params['PEEP']
        variationObjects[namePEEP] = eq.NoController(namePEEP)

        modelParams[nameIven] = params['I']
        variationObjects[nameIven] = eq.NoController(nameIven)

        modelParams[nameEven] = params['E']
        variationObjects[nameEven] = eq.NoController(nameEven)

        modelParams[nameSlopeFr] = params['slopeFraction']
        variationObjects[nameSlopeFr] = eq.NoController(nameSlopeFr)

    # Ventilator pressure from file
    elif capacitorType == 'ventilatorFile':
        #"interpolationThreshold": 0.0,
        #"y0": 0.0,
        #"p0": 775.446739,
        #"start": 0.0,
        #"end": 5.0

        # if array not present or empty
        if 'array' in params:
            pressure = params['array']
        else:
            pressure,volume,flow,breaths = \
                HDF5API.getHdf5Data(params['file'],
                                    params.get('file_dir_path', None))
            if 'start' in params and 'end' in params:
                start = params['start']
                end = params['end']
                pressure = pressure[int(start):int(end)]
            if 'interpolationThreshold' in params:
                threshold = params['interpolationThreshold']
                for i,p in enumerate(pressure):
                    if p < threshold:
                        pressure[i] = threshold


        if 'fileStep' in params:
            fileStep = params['fileStep']
        else:
            fileStep = 0.01




        # interpolate
        # cut the breath

        component = eq.FilePressure(
            pressureName,
            tuple(np.transpose(np.squeeze((pressure * 0.735559) + 760.0))),
            dt,
            fileStep,
        )

    ###############################################
    # Add the component to the model objects
    capacitorObjects[pressureName] = component

    if 'compartment_volumes' in conf:
        compartment_volumes = conf['compartment_volumes']
        for key,volume in compartment_volumes.items():
            states[key] = volume
            pressures.append(prefixes['pressure']['prefix'] + key[2:])
    else:
        states[volumeName] = params['y0']

    pressures.append(pressureName)
    states[pressureName] = params['p0']

    ###############################################

# TODO: MultiFlow Resistor interaction needs a second look
def initResistors(structures,modelObjects,conf):
    states = structures['states']['states']
    modelParams = structures['states']['modelParams']
    variationObjects = modelObjects['parameterVariation']

    if 'MultiFlow' in conf['resitorType']:
        resistorObjects = modelObjects['multiFlowResistors']
    else:
        resistorObjects = modelObjects['resistors']

    flows = structures['nonState']['flows']

    resistorFlow = conf['resistorFlow']
    resistorName = conf['resistorName']
    inductorName = conf['inductorName']
    pressureIn = conf['pressureIn']
    pressureOut = conf['pressureOut']
    params = conf['params']
    resitorType = conf['resitorType']
    thresholdName = conf['thresholdName']
    dt = conf['dt']

    variationObjects[resistorName] = eq.NoController(
                            resistorName,#varToControlIdx
                        )

    if resitorType == 'diode': #Diode
        resistorObjects[resistorFlow] = eq.Diode(
            rIdx=resistorName,
            l=inductorName,
            pInIdx=pressureIn,
            pOutIdx=pressureOut,
            stateIdx=resistorFlow,
            threshold=thresholdName,
            inertial=False,
            step=dt

        )
        flows.append(resistorFlow)

        modelParams[resistorName] = params['R']
        modelParams[thresholdName] = params['threshold']
        variationObjects[thresholdName] = eq.NoController(thresholdName)

    elif resitorType == 'resistor': #Resistor
        resistorObjects[resistorFlow] = eq.Resistor(
            rIdx=resistorName,
            l=inductorName,
            pInIdx=pressureIn,
            pOutIdx=pressureOut,
            stateIdx=resistorFlow,
            threshold=thresholdName,
            inertial=False,
            step=dt
        )
        flows.append(resistorFlow)

        modelParams[resistorName] = params['R']

    elif resitorType == 'diode_inertial': #DiodeInertial
        resistorObjects[resistorFlow] = eq.Diode(
            rIdx=resistorName,
            l=inductorName,
            pInIdx=pressureIn,
            pOutIdx=pressureOut,
            stateIdx=resistorFlow,
            threshold=thresholdName,
            inertial=True,
            step=dt
        )
        states[resistorFlow] = params['y0']
        modelParams[resistorName] = params['R']
        modelParams[inductorName] = params['L']
        modelParams[thresholdName] = params['threshold']
        variationObjects[thresholdName] = eq.NoController(thresholdName)
        variationObjects[inductorName] = eq.NoController(inductorName)

    elif resitorType == 'inertial': #ResistorInertial
        resistorObjects[resistorFlow] = eq.Resistor(
            rIdx=resistorName,
            l=inductorName,
            pInIdx=pressureIn,
            pOutIdx=pressureOut,
            stateIdx=resistorFlow,
            inertial=True,
            step = dt
        )
        states[resistorFlow] = params['y0']
        modelParams[resistorName] = params['R']
        modelParams[inductorName] = params['L']
        variationObjects[inductorName] = eq.NoController(inductorName)

    elif resitorType == 'resistorInputPressure':
        inputPressure = params['inputPressure']
        resistorObjects[resistorFlow] = eq.ResistorInputPressure(
            resistorName,
            inductorName,
            pressureIn,
            pressureOut,
            resistorFlow,
            thresholdName,
            False,
            dt,
            inputPressure,

        )
        flows.append(resistorFlow)

        modelParams[resistorName] = params['R']

# TODO Refractor code to align with the newer way for doing these initializations
# Remove dCycles and add the initial condition the proper way
# Remove references to dycles elsewhere on the code and align with current way
# look again into the triggers and timers to make sure there are no errors in time calcularions
def initTimekeeping(structures,modelObjects,modelStructure):
    timekeepingObjects = modelObjects['timekeeping']
    cycleObjects = modelObjects['cycles']
    dT = structures['states']['dT']
    dCycles = structures['states']['dCycles']
    cycles = modelStructure['cycles']
    prefixes = modelStructure['data']['prefixes']
    step = modelStructure['configurations']['simulationParameters']['dt']
    parameterVariationObjects = modelObjects['parameterVariation']

    dT['T'] = 0.0
    dT['T0'] = 0.0

    for key,value in cycles.items():
        cycleName = prefixes['cycle']['prefix'] + key
        timerName = prefixes['timer']['prefix'] + key
        tiggerName = prefixes['trigger']['prefix'] + key

        dT[tiggerName] = value['params']['triggerOffset']
        dT[timerName] = value['params']['timerOffset']
        timekeepingObjects[cycleName] = eq.PeriodicTrigger(
            cycleName,
            tiggerName,
            timerName,
            'T0',
            step
            )
        
        parameterVariationObjects[cycleName] = eq.NoController(cycleName)
        dCycles[cycleName] = value['params']['duration']

def initOtherCalculations(structures,modelObjects,modelStructure):
    modelParams = structures['states']['modelParams']
    variationObjects = modelObjects['parameterVariation']
    
    constants = modelObjects['constants']
    otherObjects = modelObjects['other']
    averages = modelStructure['other']
    dOther = structures['states']['dOther']
    prefixes = modelStructure['data']['prefixes']
    step = modelStructure['configurations']['simulationParameters']['dt']


    for key,value in averages.items():

        if value['type'] == 'movingAverage':
            varIn = value['params']['varIn']
            otherName = prefixes['average']['prefix'] + varIn
            constants['period_' + otherName] = value['params']['period']

            otherObjects[otherName] = eq.MovingAverage(
                otherName,
                varIn,
                'period_' + otherName,
                step,
                )
            dOther[otherName] = value['params']['y0']
        
        elif value['type'] == 'movingAverageCycle':
            varIn = value['params']['varIn']
            otherName = prefixes['average']['prefix'] + varIn
            #constants['period_' + otherName] = value['params']['period']

            otherObjects[otherName] = eq.MovingAverageCycle(
                otherName,
                varIn,
                value['params']['period'],
                step,
                )
            dOther[otherName] = value['params']['y0']

        elif value['type'] == 'cycleIntegral':
            varIn = value['params']['varIn']
            otherName = value['params']['newVarName']
            initialTimeName = value['params']['t0']
            triggerName = value['params']['trigger']
            triggerConditionValue = value['params']['triggerConditionValue']

            otherObjects[otherName] = eq.CycleIntegrator(
                stateIdx = otherName,
                varIn = varIn,
                initialTimeIdx = initialTimeName,
                triggerIdx = triggerName,
                triggerConditionValue = triggerConditionValue,
                step=step
                )
            dOther[otherName] = value['params']['y0']

        elif value['type'] == 'cycleKeeper':
            varIn = value['params']['varIn']
            otherName = value['params']['newVarName']
            initialTimeName = value['params']['t0']
            triggerName = value['params']['trigger']

            otherObjects[otherName] = eq.CycleKeeper(
                stateIdx = otherName,
                varIn = varIn,
                initialTimeIdx = initialTimeName,
                triggerIdx = triggerName,
                step=step
                )
            dOther[otherName] = value['params']['y0']

        elif value['type'] == 'cycleMax':
            varIn = value['params']['varIn']
            otherName = value['params']['newVarName']
            initialTimeName = value['params']['t0']
            triggerName = value['params']['trigger']

            otherObjects[otherName] = eq.CycleMax(
                stateIdx = otherName,
                varIn = varIn,
                initialTimeIdx = initialTimeName,
                triggerIdx = triggerName,
                step=step
                )
            dOther[otherName] = value['params']['y0']

        elif value['type'] == 'cycleMin':
            varIn = value['params']['varIn']
            otherName = value['params']['newVarName']
            initialTimeName = value['params']['t0']
            triggerName = value['params']['trigger']

            otherObjects[otherName] = eq.CycleMin(
                stateIdx = otherName,
                varIn = varIn,
                initialTimeIdx = initialTimeName,
                triggerIdx = triggerName,
                step=step
                )
            dOther[otherName] = value['params']['y0']

        elif value['type'] == 'pressureToConcentration':
            otherName = value['params']['newVarName']
            constants['temperatureIn_' + otherName] = value['params']['temperatureIn']
            constants['R_' + otherName] = value['params']['R']
            
            otherObjects[otherName] = eq.PressureToConcentration(
                stateIdx = otherName,
                pressureIn = value['params']['pressureIn'],
                volumeIn = value['params']['volumeIn'],
                temperatureIn = 'temperatureIn_' + otherName,
                R = 'R_' + otherName,
                step = step,
            )
            dOther[otherName] = value['params']['y0']

        elif value['type'] == 'mmolpH':
            otherName = value['params']['newVarName']
            otherObjects[otherName] = eq.ConvertmmolpH(
                stateIdx = otherName,
                concentrationIn = value['params']['concentrationIn'],
                step = step,
            )
            dOther[otherName] = value['params']['y0']
        
        elif value['type'] == 'constant':
            otherName = value['params']['newVarName']
            #otherObjects[otherName] = eq.Constant()
            #dOther[otherName] = value['params']['y0']

            #paramValueName = "y0_" + otherName
            modelParams[otherName] = value['params']['y0']
            variationObjects[otherName] = eq.NoController(otherName)
        
        elif value['type'] == 'stateSummation':
            otherName = value['params']['newVarName']
            otherObjects[otherName] = eq.SumStates(
                states = value['params']['states'],
                stateIdx = otherName,
                step = step
            )
            dOther[otherName] = value['params']['y0']
        
        elif value['type'] == 'stateSubstraction':
            otherName = value['params']['newVarName']
            otherObjects[otherName] = eq.SubstactStates(
                state1 = value['params']['state1'],
                state2 = value['params']['state2'],
                stateIdx = otherName,
                step = step
            )
            dOther[otherName] = value['params']['y0']
        
        elif value['type'] == 'ramp':
            otherName = value['params']['newVarName']
            constants['rate_' + otherName] = value['params']['rate']
            
            if 'chemoSensitivity' in value['params']:
                constants['chS_' + otherName] = value['params']['chemoSensitivity']
            else:
                constants['chS_' + otherName] = 0.0
            
            if 'baroSensitivity' in value['params']:
                constants['baS_' + otherName] = value['params']['baroSensitivity']
            else:
                constants['baS_' + otherName] = 0.0

            if 'chemoRegulator' in value['params']:
                chemoRegulator = value['params']['chemoRegulator']
            else:
                chemoRegulator = 'P_Atm'
            
            if 'baroRegulator' in value['params']:
                baroRegulator = value['params']['baroRegulator']
            else:
                baroRegulator = 'P_Atm'
            
            
            otherObjects[otherName] = eq.Ramp(
                stateIdx = otherName,
                chemoRegulator= chemoRegulator,
                baroRegulator= baroRegulator,
                chemoSensitivity= 'chS_' + otherName,
                baroSensitivity= 'baS_' + otherName,
                rate = 'rate_' + otherName,
            )
            dOther[otherName] = value['params']['y0']
        
        elif value['type'] == 'atp_Prod':
            otherName = value['params']['newVarName']
            rateLact = value['params']['rateLact']
            ratioLact = value['params']['ratioLact']
            
            rateOxid = value['params']['rateOxid']
            ratioOxid = value['params']['ratioOxid']
            
            ratioFat = value['params']['ratioFat']
            rateFat = value['params']['rateFat']
            
            otherObjects[otherName] = eq.ATP_Prod(
                stateIdx = otherName,
                rateLact = rateLact,
                ratioLact = ratioLact,
                rateOxid = rateOxid,
                ratioOxid = ratioOxid,
                ratioFat = ratioFat,
                rateFat = rateFat,
                step=step
            )
            dOther[otherName] = value['params']['y0']

        elif value['type'] == 'constant_Multiplication':
            otherName = value['params']['newVarName']
            cnt = value['params']['constant']
            val = value['params']['value']
            
            otherObjects[otherName] = eq.ConstantMultiplication(
                stateIdx = otherName,
                value = val,
                constant = cnt,
                step=step
            )
            dOther[otherName] = value['params']['y0']


        elif value['type'] == 'sigmoid':
            otherName = value['params']['newVarName']
            baseVar = value['params']['baseVar']

            constants['maxValue_' + otherName] = value['params']['maxValue']
            constants['minValue_' + otherName] = value['params']['minValue']
            constants['slope_' + otherName] = value['params']['slope']

            #constants['inflectionPoint_' + otherName] = value['params']['inflectionPoint']
            infPointName = 'inflectionPoint_' + otherName
            modelParams[infPointName] = value['params']['inflectionPoint']
            variationObjects[infPointName] = eq.NoController(infPointName)
            
            if 'inhibitor' in value['params']:
                inhibitor = value['params']['inhibitor']
                constants['I0_' + otherName] = value['params']['I0']
            else:
                inhibitor = 'P_Atm'
                constants['I0_' + otherName] = 760.0
            
            otherObjects[otherName] = eq.LocalSigmoidStateController(
                stateIdx = otherName,
                varName = baseVar,
                maxValue = 'maxValue_' + otherName,
                minValue = 'minValue_' + otherName,
                inflectionPoint = infPointName,
                slope = 'slope_' + otherName,
                inhibitor = inhibitor,
                I0 = 'I0_' + otherName,
                step=step
            )
            dOther[otherName] = value['params']['y0']
    
        # Thorax Unsressed Volume or ventricle elastances (used for thorax pleura muscle)
        elif value['type'] == 'heldtParamVariation':
            otherName = value['params']['newVarName']
            cycleName = value['params']['cycle']
        
            varMax = prefixes['unstressedVolumeMax']['prefix'] + otherName
            varMin = prefixes['unstressedVolumeMin']['prefix'] + otherName
            t_up = prefixes['time']['prefix'] + 'Sys_' + cycleName
            t_down = prefixes['time']['prefix'] + 'transition_' + cycleName
            
            otherObjects[otherName] = eq.HeldtParamVariation(
                varMax = varMax, #Emax
                varMin = varMin, #Emin
                cycle = prefixes['cycle']['prefix'] + cycleName,
                cycleTimer = prefixes['timer']['prefix'] + cycleName,
                stateIdx = otherName,
                t_up = t_up,
                t_down = t_down,
                step = step,
                )
            
            dOther[otherName] = value['params']['y0']

            modelParams[varMax] = value['params']['maxValue']
            variationObjects[varMax] = eq.NoController(varMax)

            modelParams[varMin] = value['params']['minValue']
            variationObjects[varMin] = eq.NoController(varMin)

            if t_up not in modelParams:
                modelParams[t_up] = value['params']['t_up']
                variationObjects[t_up] = eq.NoController(t_up)

            if t_down not in modelParams:
                modelParams[t_down] = value['params']['t_down']
                variationObjects[t_down] = eq.NoController(t_down)

        elif value['type'] == 'stiffness':
            otherName = value['params']['newVarName']
            volumeName = value['params']['volume']
            complianceName = value['params']['compliance']
            V0Name = value['params']['V0']
        
            
            otherObjects[otherName] = eq.StiffnessCalculator(
                volume = volumeName, #Emax
                compliance = complianceName, #Emin
                V0 = V0Name,
                stateIdx = otherName,
                step = step,
                )
            
            dOther[otherName] = value['params']['y0']
        
        elif value['type'] == 'elastanceCalc':
            otherName = value['params']['newVarName']
            volumeName = value['params']['volume']
            stiffnessName = value['params']['stiffness']
            V0Name = value['params']['V0']
        
            
            otherObjects[otherName] = eq.ElastanceCalculator(
                volume = volumeName, #Emax
                stiffness = stiffnessName, #Emin
                V0 = V0Name,
                stateIdx = otherName,
                step = step,
                )
            
            dOther[otherName] = value['params']['y0']

def initParameterVariation(structures,modelObjects,calibrationStructure,step):
    constants = modelObjects['constants']
    parameterVariationObjects = modelObjects['parameterVariation']
    

    for key,calibration in calibrationStructure.items():
        for parameter in parameterVariationObjects.keys():
            if parameter == key:
                if 'offset' in calibration['params']:
                    constants['offset_' + parameter] = calibration['params']['offset']
                else:
                    constants['offset_' + parameter] = 0.0
                    

                if calibration['type'] == 'ladder':
                    constants['rate_' + parameter] = calibration['params']['rate']

                    parameterVariationObjects[parameter] = eq.LadderController(
                        stateIdx= calibration['params']['varToControl'],
                        rate = 'rate_' + parameter,
                    )
                elif calibration['type'] == 'cosine':
                    constants['freq_' + parameter] = calibration['params']['freq']
                    constants['amp_' + parameter] = calibration['params']['amp']
                    parameterVariationObjects[parameter] = eq.SineController(
                        stateIdx= calibration['params']['varToControl'],
                        freq = 'freq_' + parameter,
                        amplitude = 'amp_' + parameter,
                    )
                
                elif calibration['type'] == 'ramp':
                    constants['rate_' + parameter] = calibration['params']['rate']
                    constants['chS_' + parameter] = calibration['params']['chemoSensitivity']
                    constants['baS_' + parameter] = calibration['params']['baroSensitivity']
                    constants['max_' + parameter] = calibration['params']['maxValue']
                    constants['min_' + parameter] = calibration['params']['minValue']

                    parameterVariationObjects[parameter] = eq.RampController(
                        stateIdx= calibration['params']['varToControl'],
                        chemoRegulator= calibration['params']['chemoRegulator'],
                        baroRegulator= calibration['params']['baroRegulator'],
                        chemoSensitivity= 'chS_' + parameter,
                        baroSensitivity= 'baS_' + parameter,
                        maxValue= 'max_' + parameter,
                        minValue= 'min_' + parameter,
                        rate = 'rate_' + parameter,
                    )
                
                elif calibration['type'] == 'cubicController':

                    constants['targetValue' + parameter] = calibration['params']['targetValue']
                    constants['maxValue_' + parameter] = calibration['params']['maxValue']
                    constants['minValue_' + parameter] = calibration['params']['minValue']
                    constants['cubicFactor_' + parameter] = calibration['params']['cubicFactor']
                    constants['linearFactor_' + parameter] = calibration['params']['linearFactor']
                    constants['k_' + parameter] = calibration['params']['k']
                    constants['offset_' + parameter] = calibration['params']['offset']
                    
                    parameterVariationObjects[key] = eq.LocalCubicController(
                        varTargetIdx = calibration['params']['varTarget'],
                        stateIdx = calibration['params']['varToControl'],
                        targetValue= 'targetValue' + parameter,
                        maxValue = 'maxValue_' + parameter,
                        minValue = 'minValue_' + parameter,
                        cubicFactor = 'cubicFactor_' + parameter,
                        linearFactor = 'linearFactor_' + parameter,
                        k = 'k_' + parameter,
                        offset = 'offset_' + parameter,
                        step=step
                    )
                
                elif calibration['type'] == 'cubicStateController':

                    constants['maxValue_' + parameter] = calibration['params']['maxValue']
                    constants['minValue_' + parameter] = calibration['params']['minValue']
                    constants['cubicFactor_' + parameter] = calibration['params']['cubicFactor']
                    constants['linearFactor_' + parameter] = calibration['params']['linearFactor']
                    constants['k_' + parameter] = calibration['params']['k']
                    constants['offset_' + parameter] = calibration['params']['offset']
                    
                    parameterVariationObjects[key] = eq.LocalCubicStateController(
                        varTargetIdx = calibration['params']['varTarget'],
                        stateIdx = calibration['params']['varToControl'],
                        targetValue= calibration['params']['targetValue'],
                        maxValue = 'maxValue_' + parameter,
                        minValue = 'minValue_' + parameter,
                        cubicFactor = 'cubicFactor_' + parameter,
                        linearFactor = 'linearFactor_' + parameter,
                        k = 'k_' + parameter,
                        offset = 'offset_' + parameter,
                        step=step
                    )
                
                elif calibration['type'] == 'polynomialController':

                    constants['dc_' + parameter] = calibration['params']['dc']
                    constants['linear_' + parameter] = calibration['params']['linear']
                    constants['quadratic_' + parameter] = calibration['params']['quadratic']
                    
                    parameterVariationObjects[key] = eq.PolynomialController(
                        varTargetIdx = calibration['params']['varTarget'],
                        stateIdx = calibration['params']['varToControl'],
                        dcFactor = 'dc_' + parameter,
                        linearFactor = 'linear_' + parameter,
                        quadraticFactor = 'quadratic_' + parameter,
                        step=step
                    )

