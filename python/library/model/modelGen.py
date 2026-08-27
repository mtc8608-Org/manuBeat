import numpy as np
import library.model.modelEq as eq   # array-mode equation classes (fork of equations.py + resolve())
import library.utils as utils
import library.hdf5.HDF5API as HDF5API
import copy

#################################################################################################################################################
'''##############################################################################################################################################
                                                                                                                                               ##
███    ███  ██████  ██████  ███████ ██          ██ ███    ██ ██ ████████ ██  █████  ██      ██ ███████  █████  ████████ ██  ██████  ███    ██  ##
████  ████ ██    ██ ██   ██ ██      ██          ██ ████   ██ ██    ██    ██ ██   ██ ██      ██    ███  ██   ██    ██    ██ ██    ██ ████   ██  ##
██ ████ ██ ██    ██ ██   ██ █████   ██          ██ ██ ██  ██ ██    ██    ██ ███████ ██      ██   ███   ███████    ██    ██ ██    ██ ██ ██  ██  ##
██  ██  ██ ██    ██ ██   ██ ██      ██          ██ ██  ██ ██ ██    ██    ██ ██   ██ ██      ██  ███    ██   ██    ██    ██ ██    ██ ██  ██ ██  ##
██      ██  ██████  ██████  ███████ ███████     ██ ██   ████ ██    ██    ██ ██   ██ ███████ ██ ███████ ██   ██    ██    ██  ██████  ██   ████  ##
                                                                                                                                               ##
##############################################################################################################################################
'''#################################################################################################################################################9


# This file is the ARRAY-mode generator: a fork of modelGenerator.py trimmed to
# the single supported route initModelObjectsNewGasExchange (Cabeleira gas
# exchange). The dict-only routes initModelObjects / initModelObjectsGasExchange
# were removed; every init* helper they shared is kept below. Equation classes
# come from modelEq (imported as eq). No physics changed vs. modelGenerator.py.

# Initialises the model WITHOUT gas exchange. Restored verbatim from
# modelGenerator.py because initModelObjectsNewGasExchange falls back to it
# in its no-gas (else) branch. Uses the same shared init* helpers + eq (modelEq),
# so the objects it builds are array-mode compatible (resolve() in prepareModel).
def initModelObjects(modelStructure):

    if 'trees' in modelStructure.keys():
        for treeName,tree in modelStructure['trees'].items():
            buildTrees(modelStructure,tree)


    #############################################

    prefixes = modelStructure['data']['prefixes']

    compartments = modelStructure['compartments']
    resistors = modelStructure['connections']['resistive']
    connections_cycles = modelStructure['connections']['cycles']
    connections_bias = modelStructure['connections']['bias']
    connections_regions = modelStructure['connections']['regions']

    if 'reactions' in modelStructure.keys():
        reactions = modelStructure['reactions']

    dt = modelStructure['configurations']['simulationParameters']['dt']
    atmPressure = modelStructure['gasRegions']['Atmosphere']['total']

    modelObjects = {
        'capacitors': {},         # Calculates the pressures (P) for the lungs and heart
        'inductors': {},          # Calculates the flows (Q) through the inertial resistors
        'resistors': {},          # Calculates the flows (Q) through the resistors
        'membraneResistors': {},  # Calculates the gas flows through membranes (Q)
        'parameterVariation': {}, # Calculates the gas flows through membranes (Q)
        'concentrations': {},   # Calculates the partial pressures (P) of the gases in every compartment
        'reactions': {},           # Calculates the reactions
        'connections': {},        # Calculates the volume variations (dVdt) in the compartments
        'cycles': {},             # Calculates the cycle durations
        'timekeeping': {},        # Keeps track of the time
        'other': {},
        'multiFlowResistors': {},
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
            'membraneFlows': [],
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

    if modelStructure['configurations']['simulationParameters']['control'] == True:
        step = modelStructure['configurations']['simulationParameters']['dt']
        initParameterVariation(structures,modelObjects,modelStructure['control'],step)




    return structures['initialConditions'], modelObjects, structures



# initialises the model with Lu et al. gas exchange strategy


# initialises the model with Cabeleira et al. gas exchange strategy
def initModelObjectsNewGasExchange(modelStructure):

    if 'trees' in modelStructure.keys():
        for treeName,tree in modelStructure['trees'].items():
            buildTrees(modelStructure,tree)

    
    #############################################

    prefixes = modelStructure['data']['prefixes']

    compartments = modelStructure['compartments']
    resistors = modelStructure['connections']['resistive']
    # cardio-only models (no gas exchange) carry no membrane connections; tolerate
    # their absence the same way 'trees'/'reactions' above are optional.
    memResistors = modelStructure['connections'].get('membrane', {})
    connections_cycles = modelStructure['connections']['cycles']
    connections_bias = modelStructure['connections']['bias']
    connections_regions = modelStructure['connections']['regions']
    
    if 'reactions' in modelStructure.keys():
        reactions = modelStructure['reactions']

    dt = modelStructure['configurations']['simulationParameters']['dt']
    atmPressure = modelStructure['gasRegions']['Atmosphere']['total']

    hasGasExchange = modelStructure['configurations']['simulationParameters']['gasExchange']
    gasRegions = modelStructure['gasRegions']

    modelObjects = {
        'capacitors': {},         # Calculates the pressures (P) for the lungs and heart
        'inductors': {},          # Calculates the flows (Q) through the inertial resistors
        'resistors': {},          # Calculates the flows (Q) through the resistors
        'membraneResistors': {},  # Calculates the gas flows through membranes (Q)
        'parameterVariation': {}, # Calculates the gas flows through membranes (Q)
        'concentrations': {},   # Calculates the partial pressures (P) of the gases in every compartment
        'reactions': {},           # Calculates the reactions
        'connections': {},        # Calculates the volume variations (dVdt) in the compartments
        'cycles': {},             # Calculates the cycle durations
        'timekeeping': {},        # Keeps track of the time
        'other': {},
        'multiFlowResistors': {},
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
            'dReactions': {},
        },
        'nonState': {
            'flows': [],
            'pressures': [],
            'membraneFlows': [],
        },
        'modelStructure':{
            'simulationParameters': modelStructure['configurations']['simulationParameters'],
        },
        'initialConditions': {},
    }

    initTimekeeping(structures,modelObjects,modelStructure)
    initOtherCalculations(structures,modelObjects,modelStructure)


    if hasGasExchange:
        #######################################################################################################
        # Capacitors & Connections
        for compartment_name,compartment in compartments.items():
            gasRegion = gasRegions[compartments[compartment_name]["gasRegion"]]
            gasRegionName = compartments[compartment_name]["gasRegion"]
            fluidState = gasRegion['state']

            # LUNG ############################################################################################
            # Capacitors for compartments where the fluid state is gas (use the partial volume strategy)
            if fluidState == 'gas':
                if compartment['type'] == 'component':
                    compartment_volumes = {}
                    for gas,value in gasRegion['gases'].items():
                        compartment_volumes[prefixes['volume']['prefix'] + gas + '_' + compartment_name] = compartment['capacitor']['params']['y0'] * (value / gasRegion['total'])

                    confComp = {
                        'compartment_name': compartment_name,
                        'capacitorName': prefixes['capacitor']['prefix'] + compartment_name,
                        'volumeName': prefixes['volume']['prefix'] + compartment_name,
                        'pressureName': prefixes['pressure']['prefix'] + compartment_name,
                        'biasPressureName': utils.findStrInDictionaryAndAddPrefix(compartment_name, connections_bias, prefixes['pressure']['prefix']),
                        'unstressedVolumeName': prefixes['unstressedVolume']['prefix'] + compartment_name,
                        'compartment_region_name': [],
                        'compartment_volumes': compartment_volumes,
                        'cycleName': utils.findKeyInDictionaryReturnValue(compartment_name, connections_cycles),
                        'params': compartment['capacitor']['params'],
                        'capacitorType': compartment['capacitor']['type'],
                        'compartmentType': compartment['type'],
                        'dt': dt,
                        'atmPressure': atmPressure,
                        'prefixes': prefixes
                    }
                    initCapacitor(structures,modelObjects,confComp)
                    ############################################################
                    # Connections For GAS compartments
                    
                    for gas,value in gasRegion['gases'].items():
                        if compartment['type'] == 'component':
                            fIn = []
                            fOut = []
                            fInMem = []
                            fOutMem = []

                            # MultiFlow Resistors
                            for resistorName,resistor in resistors.items():
                                flowName = prefixes['flow']['prefix'] + gas + '_' + resistor['from'] + '_' + resistor['to']
                                if resistor['from'] == compartment_name:
                                    fOut.append(flowName)
                                elif resistor['to'] == compartment_name:
                                    fIn.append(flowName)


                            # Membrane Resistors
                            for resistorName,resistor in memResistors.items():
                                flowName = prefixes['flow']['prefix'] + gas + '_' + resistor['from'] + '_' + resistor['to']
                                if (value >= 0.0) and (gasRegions[compartments[resistor['to']]["gasRegion"]]['gases'][gas]) >= 0.0:
                                    if resistor['from'] == compartment_name:
                                        fOutMem.append(flowName)
                                    elif resistor['to'] == compartment_name:
                                        fInMem.append(flowName)

                            modelObjects['connections'][prefixes['volume']['prefix'] + gas + '_' + compartment_name] = eq.Connections(
                                fInIdxs=fIn,
                                fOutIdxs=fOut,
                                pressureIdx=prefixes['pressure']['prefix'] + compartment_name,
                                #pressureIdx=prefixes['pressure']['prefix'] + gas + '_' + compartment_name,
                                fInMemIdxs=fInMem,
                                fOutMemIdxs=fOutMem,
                                volInIdx = prefixes['volume']['prefix'] + resistor['from'],
                                volOutIdx = prefixes['volume']['prefix'] + resistor['to'],
                                state=fluidState,

                            )
                    

            ###################################################################################################

            # BLOOD ###########################################################################################
            # Capacitors for compartments where the fluid state is dissolved (use the partial pressure strategy)
            elif fluidState == 'dissolved':
                compartmentsInRegion = utils.findKeyInDictionaryReturnValue(compartment_name, connections_regions)
                compartment_region_name = []
                for compartmentInRegion in compartmentsInRegion:
                    gasRegionOfCompartmentInRegion = gasRegions[compartments[compartmentInRegion]["gasRegion"]]
                    fluidStateOfCompartmentInRegion = gasRegionOfCompartmentInRegion['state']
                    if fluidStateOfCompartmentInRegion == 'gas':
                        for gas,value in gasRegionOfCompartmentInRegion['gases'].items():
                            compartment_region_name.append(gas + '_' + compartmentInRegion)
                    else:
                        compartment_region_name.append(compartmentInRegion)

                # Capacitors #######################################################
                confComp = {
                    'compartment_name': compartment_name,
                    'capacitorName': prefixes['capacitor']['prefix'] + compartment_name,
                    'volumeName': prefixes['volume']['prefix'] + compartment_name,
                    'pressureName': prefixes['pressure']['prefix'] + compartment_name,
                    'biasPressureName': utils.findStrInDictionaryAndAddPrefix(compartment_name, connections_bias, prefixes['pressure']['prefix']),
                    'unstressedVolumeName': prefixes['unstressedVolume']['prefix'] + compartment_name,
                    'compartment_region_name': compartment_region_name,
                    'cycleName': utils.findKeyInDictionaryReturnValue(compartment_name, connections_cycles),
                    'params': compartment['capacitor']['params'],
                    'capacitorType': compartment['capacitor']['type'],
                    'compartmentType': compartment['type'],
                    'dt': dt,
                    'atmPressure': atmPressure,
                    'prefixes': prefixes
                }
                initCapacitor(structures,modelObjects,confComp)

                # Reactions ########################################################
                if 'reactions' in modelStructure.keys():
                    if gasRegionName in reactions.keys():
                        for reactionName,reaction in reactions[gasRegionName].items():
                            confReaction = {
                                'compartmentType': compartment['type'],
                                'capacitorType': compartment['capacitor']['type'],
                                'reactionName': reactionName,
                                'reactionParams': reaction,
                                'compartmentName': compartment_name,
                                'prefixes': prefixes,
                                'step': modelStructure['configurations']['simulationParameters']['dt']
                            }
                            initReactions(structures,modelObjects,confReaction)
                ####################################################################

                # Connections ######################################################
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
                    )

                # Gas Exchange #####################################################
                #        Builds the gas exchange objects according to Lu1998
                for gas,value in gasRegion['gases'].items():
                    if value > 0.0:
                        dV = {
                            'volume': prefixes['volume']['prefix'] + compartment_name,
                            'concentration': prefixes['concentration']['prefix'] + gas + '_' + compartment_name,
                            'reactions': [],
                        }
                        for reactionsName in modelObjects['reactions'].keys():
                            nameToCompare = prefixes['partialConcentrationDifference']['prefix'] + gas + '_' + compartment_name
                            if nameToCompare in reactionsName:
                                dV['reactions'].append(reactionsName)

                        objectConf = {
                            'in':{
                                'flows':[],
                                'positive':[],
                                'negative':[],
                            },
                            'out':{
                                'flows':[],
                                'positive':[],
                                'negative':[],
                            },
                            'memIn':{
                                'flows':[],
                                'positive':[],
                                'negative':[],
                                'positiveVolume':[],
                                'negativeVolume':[],
                            },
                            'memOut':{
                                'flows':[],
                                'positive':[],
                                'negative':[],
                                'positiveVolume':[],
                                'negativeVolume':[],
                            },
                        }
                        for resistorName,resistor in resistors.items():
                            if resistor['from'] == compartment_name:
                                objectConf['out']['flows'].append(prefixes['flow']['prefix'] + resistor['from'] + '_' + resistor['to'])
                                objectConf['out']['positive'].append(prefixes['concentration']['prefix'] + gas + '_' + resistor['from'])
                                objectConf['out']['negative'].append(prefixes['concentration']['prefix'] + gas + '_' + resistor['to'])
                            elif resistor['to'] == compartment_name:
                                objectConf['in']['flows'].append(prefixes['flow']['prefix'] + resistor['from'] + '_' + resistor['to'])
                                objectConf['in']['positive'].append(prefixes['concentration']['prefix'] + gas + '_' + resistor['from'])
                                objectConf['in']['negative'].append(prefixes['concentration']['prefix'] + gas + '_' + resistor['to'])

                        for resistorName,resistor in memResistors.items():
                            fromGasRegion = gasRegions[compartments[resistor['from']]["gasRegion"]]
                            toGasRegion = gasRegions[compartments[resistor['to']]["gasRegion"]]
                            if (gas in fromGasRegion['gases']) and (gas in toGasRegion['gases']):
                                fromHasGas = gasRegions[compartments[resistor['from']]["gasRegion"]]['gases'][gas] > 0.0
                                toHasGas = gasRegions[compartments[resistor['to']]["gasRegion"]]['gases'][gas] > 0.0

                                if (resistor['from'] == compartment_name) and fromHasGas and toHasGas:
                                    objectConf['memOut']['flows'].append(prefixes['flow']['prefix'] + gas + '_' + resistor['from'] + '_' + resistor['to'])
                                    objectConf['memOut']['positive'].append(prefixes['concentration']['prefix'] + gas + '_' + resistor['from'])
                                    objectConf['memOut']['negative'].append(prefixes['concentration']['prefix'] + gas + '_' + resistor['to'])
                                    
                                    objectConf['memOut']['positiveVolume'].append(prefixes['volume']['prefix'] + resistor['from'])
                                    objectConf['memOut']['negativeVolume'].append(prefixes['volume']['prefix'] + resistor['to'])

                                elif resistor['to'] == compartment_name and fromHasGas and toHasGas:
                                    objectConf['memIn']['flows'].append(prefixes['flow']['prefix'] + gas + '_' + resistor['from'] + '_' + resistor['to'])
                                    objectConf['memIn']['positive'].append(prefixes['concentration']['prefix'] + gas + '_' + resistor['to'])
                                    objectConf['memIn']['negative'].append(prefixes['concentration']['prefix'] + gas + '_' + resistor['from'])

                                    objectConf['memIn']['positiveVolume'].append(prefixes['volume']['prefix'] + resistor['to'])
                                    objectConf['memIn']['negativeVolume'].append(prefixes['volume']['prefix'] + resistor['from'])

                        gasExchangeConf = {
                            'compartmentType': compartment['type'],
                            'capacitorType': compartment['capacitor']['type'],
                            'concentrationName': prefixes['concentration']['prefix'] + gas + '_' + compartment_name,
                            'gasValue': value,
                            'dV': dV,
                            'objectConf': objectConf,

                        }
                        initGasExchange(structures,modelObjects,gasExchangeConf)
            ###################################################################################################

            else:
                print('Error: Fluid state not implemented for ' + fluidState)
        #######################################################################################################

        #######################################################################################################
        # Resistors
        for resistorName,resistor in resistors.items():
            biasPressureName = utils.findStrInDictionaryAndAddPrefix(resistorName, connections_bias, prefixes['pressure']['prefix'])
            compartment_region_name = utils.findKeyInDictionaryReturnValue(resistorName, connections_regions)
            cycleName = utils.findKeyInDictionaryReturnValue(resistorName, connections_cycles)

            gasRegion = gasRegions[compartments[resistor['from']]["gasRegion"]]
            fluidState = gasRegion['state']
            if fluidState == 'gas':
                compartment_volumes = {
                    'in':[],
                    'out':[],
                }
                for gas,value in gasRegion['gases'].items():
                    compartment_volumes['in'].append(prefixes['volume']['prefix'] + gas + '_' + resistor['from'])
                    compartment_volumes['out'].append(prefixes['volume']['prefix'] + gas + '_' + resistor['to'])

                if (value > 0.0) and (gasRegions[compartments[resistor['to']]["gasRegion"]]['gases'][gas]) > 0.0:
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
                        'compartment_volumes': compartment_volumes,
                        'atmPressure': atmPressure,
                        'dt': dt,
                        'prefixes': prefixes
                    }
                    if resistor['type'] == 'resistorInputPressure':
                        resConf['resitorType'] = 'resistorInputPressureMultiFlow'
                    elif resistor['type'] == 'diode':
                        resConf['resitorType'] = 'diodeMultiFlow'
                    elif resistor['type'] == 'resistor':
                        resConf['resitorType'] = 'resistorMultiFlow'

                    initResistors(structures,modelObjects,resConf)

            elif fluidState == 'dissolved':
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
        #######################################################################################################

        #######################################################################################################
        # Membrane Resistors
        for resistorName,resistor in memResistors.items():
            # Find the names for the Bias pressures, the compartment region and the cycle to use in the membrane resistor
            biasPressureName = utils.findStrInDictionaryAndAddPrefix(resistorName, connections_bias, prefixes['pressure']['prefix'])
            compartment_region_name = utils.findKeyInDictionaryReturnValue(resistorName, connections_regions)
            cycleName = utils.findKeyInDictionaryReturnValue(resistorName, connections_cycles)
            
            # Find the gas region of the compartment where the resistor is coming from (inlet)
            gasRegion = gasRegions[compartments[resistor['from']]["gasRegion"]]
            if compartments[resistor['from']]['type'] == 'component':
                # Loop through the gases in the gas region of the inlet compartment
                for gas,value in gasRegion['gases'].items():
                    # Check if the gas is present in the inlet and outlet compartments
                    if (value > 0.0) and (gasRegions[compartments[resistor['to']]["gasRegion"]]['gases'][gas]) > 0.0:
                        memResConf = {
                            'resistorFlow': prefixes['flow']['prefix'] + gas + '_' + resistor['from'] + '_' + resistor['to'],
                            'resistorName': prefixes['resistor']['prefix'] + gas + '_' + resistor['from'] + '_' + resistor['to'],
                            'resistorNameGeneral': prefixes['resistor']['prefix'] + resistor['from'] + '_' + resistor['to'],
                            'inductorName': prefixes['inductance']['prefix'] + resistor['from'] + '_' + resistor['to'],
                            #'thresholdName': prefixes['threshold']['prefix'] + gas + '_' + resistor['from'] + '_' + resistor['to'],
                            
                            'concentrationIn': prefixes['concentration']['prefix'] + gas + '_' + resistor['from'],
                            'volimeIn': prefixes['volume']['prefix'] + resistor['from'],
                            'concentrationOut': prefixes['concentration']['prefix'] + gas + '_' + resistor['to'],
                            'volumeOut': prefixes['volume']['prefix'] + resistor['to'],
                            
                            'paramsMemb': resistor['paramsMemb'],
                            'params': resistor['params'],
                            'resitorType': resistor['type'],
                            'gas': gas,
                            
                            #'biasPressureName': biasPressureName,
                            #'cycleName': cycleName,
                            #'atmPressure': atmPressure,
                            'dt': dt,
                            'prefixes': prefixes
                        }
                        initMembraneResistor(structures,modelObjects,memResConf)
        #######################################################################################################

    else:  # No Gas exchange... Just run the original builder
        initialConditions, modelObjects, structures = initModelObjects(modelStructure)

    initOtherModelDependentCalculations(structures,modelObjects,modelStructure)
    
    for key,dictionary in structures['states'].items():
        for key,value in dictionary.items():
            structures['initialConditions'][key] = value

    if modelStructure['configurations']['simulationParameters']['calibration'] == True:
        step = modelStructure['configurations']['simulationParameters']['dt']
        initParameterVariation(structures,modelObjects,modelStructure['calibration'],step)

    if modelStructure['configurations']['simulationParameters']['control'] == True:
        step = modelStructure['configurations']['simulationParameters']['dt']
        initParameterVariation(structures,modelObjects,modelStructure['control'],step)

    

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
    variationObjects = modelObjects['parameterVariation']
    capacitorObjects = modelObjects['capacitors']
    pressures = structures['nonState']['pressures']

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

    '''
    # Elastance Capacitor
    if capacitorType == 'elastance':

        nameEmax = prefixes['elastanceMax']['prefix'] + compartment_name
        nameEmin = prefixes['elastanceMin']['prefix'] + compartment_name
        transitionTime = prefixes['time']['prefix'] + 'transition_' + compartment_name
        systolicTimeName = prefixes['time']['prefix'] + 'Sys_' + compartment_name
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

        modelParams[transitionTime] = params['transitionTime']
        variationObjects[transitionTime] = eq.NoController(transitionTime)

        modelParams[systolicTimeName] = params['systolicTime']
        variationObjects[systolicTimeName] = eq.NoController(systolicTimeName)
    '''

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
            pressureName = pressureName,
            step = dt,
            )
        modelParams[unstressedVolumeName] = params['V0']
        variationObjects[unstressedVolumeName] = eq.NoController(unstressedVolumeName)

    # Sigmoid Capacitor
    elif capacitorType == 'sigmoidCapacitor':
        regionVolumes = []
        for region in compartment_region_name:
            regionVolumes.append(prefixes['volume']['prefix'] + region)


        partialVolumes = []
        if 'compartment_volumes' in conf:
            compartment_volumes = conf['compartment_volumes']
            for key,volume in compartment_volumes.items():
                partialVolumes.append(key)

        maxValueName = 'Cmax_' + compartment_name
        minValueName = 'Cmin_' + compartment_name
        inflectionPointName = 'InfP_' + compartment_name
        slopeName = 'slope_' + compartment_name


        component = eq.SigmoidCapacitor(
            volumeName,
            biasPressureName,
            maxValueName,
            minValueName,
            inflectionPointName,
            slopeName,
            pressureName,
            dt,
            unstressedVolumeName,
            regionVolumes,
            partialVolumes,
        )

        modelParams[unstressedVolumeName] = params['V0']
        variationObjects[unstressedVolumeName] = eq.NoController(unstressedVolumeName)

        modelParams[maxValueName] = params['maxValue']
        variationObjects[maxValueName] = eq.NoController(maxValueName)

        modelParams[minValueName] = params['minValue']
        variationObjects[minValueName] = eq.NoController(minValueName)

        modelParams[inflectionPointName] = params['inflectionPoint']
        variationObjects[inflectionPointName] = eq.NoController(inflectionPointName)

        modelParams[slopeName] = params['slope']
        variationObjects[slopeName] = eq.NoController(slopeName)

    # Double Sigmoid Capacitor
    elif capacitorType == 'doubleSigmoidCapacitor':
        regionVolumes = []
        for region in compartment_region_name:
            regionVolumes.append(prefixes['volume']['prefix'] + region)


        partialVolumes = []
        if 'compartment_volumes' in conf:
            compartment_volumes = conf['compartment_volumes']
            for key,volume in compartment_volumes.items():
                partialVolumes.append(key)

        maxValueName = 'Cmax_' + compartment_name
        minValueName = 'Cmin_' + compartment_name
        inflectionPointName = 'InfP_' + compartment_name
        slopeName = 'slope_' + compartment_name
        separationName = 'separation_' + compartment_name


        component = eq.DoubleSigmoidCapacitor(
            volumeName,
            biasPressureName,
            maxValueName,
            minValueName,
            inflectionPointName,
            slopeName,
            separationName ,
            pressureName,
            dt,
            unstressedVolumeName,
            regionVolumes,
            partialVolumes,
        )

        modelParams[unstressedVolumeName] = params['V0']
        variationObjects[unstressedVolumeName] = eq.NoController(unstressedVolumeName)

        modelParams[maxValueName] = params['maxValue']
        variationObjects[maxValueName] = eq.NoController(maxValueName)

        modelParams[minValueName] = params['minValue']
        variationObjects[minValueName] = eq.NoController(minValueName)

        modelParams[inflectionPointName] = params['inflectionPoint']
        variationObjects[inflectionPointName] = eq.NoController(inflectionPointName)

        modelParams[slopeName] = params['slope']
        variationObjects[slopeName] = eq.NoController(slopeName)

        modelParams[separationName ] = params['separation']
        variationObjects[separationName ] = eq.NoController(separationName )


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

    modelObjects['multiFlowResistors']

    inductorObjects = modelObjects['inductors']
    flows = structures['nonState']['flows']

    resistorFlow = conf['resistorFlow']
    resistorName = conf['resistorName']
    inductorName = conf['inductorName']
    pressureIn = conf['pressureIn']
    pressureOut = conf['pressureOut']
    params = conf['params']
    resitorType = conf['resitorType']
    thresholdName = conf['thresholdName']
    atmPressure = conf['atmPressure']
    dt = conf['dt']
    prefixes = conf['prefixes']

    biasPressureName = conf['biasPressureName']
    compartment_region_name = conf['compartment_region_name']
    cycleName = conf['cycleName']


    variationObjects[resistorName] = eq.NoController(
                            resistorName,#varToControlIdx
                        )

    if resitorType == 'diode': #Diode
        resistorObjects[resistorFlow] = eq.Diode(
            resistorName,
            inductorName,
            pressureIn,
            pressureOut,
            resistorFlow,
            thresholdName,
            False
        )
        flows.append(resistorFlow)

        modelParams[resistorName] = params['R']
        modelParams[thresholdName] = params['threshold']
        variationObjects[thresholdName] = eq.NoController(thresholdName)

    elif resitorType == 'resistor': #Resistor
        resistorObjects[resistorFlow] = eq.Resistor(
            resistorName,
            inductorName,
            pressureIn,
            pressureOut,
            resistorFlow,
            False
        )
        flows.append(resistorFlow)

        modelParams[resistorName] = params['R']

    elif resitorType == 'diode_inertial': #DiodeInertial
        inductorObjects[resistorFlow] = eq.Diode(
            resistorName,
            inductorName,
            pressureIn,
            pressureOut,
            resistorFlow,
            thresholdName,
            True
        )
        states[resistorFlow] = params['y0']
        modelParams[resistorName] = params['R']
        modelParams[inductorName] = params['L']
        modelParams[thresholdName] = params['threshold']
        variationObjects[thresholdName] = eq.NoController(thresholdName)
        variationObjects[inductorName] = eq.NoController(inductorName)

    elif resitorType == 'inertial': #ResistorInertial
        inductorObjects[resistorFlow] = eq.Resistor(
            resistorName,
            inductorName,
            pressureIn,
            pressureOut,
            resistorFlow,
            inertial=True
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
            inputPressure,

        )
        flows.append(resistorFlow)

        modelParams[resistorName] = params['R']


    elif resitorType == 'resistorMultiFlow':

        compartment_volumes = conf['compartment_volumes']
        for volume in compartment_volumes['in']:
            flows.append('Q_' + volume[2:4] + '_' + resistorFlow[2:])

        resistorObjects[resistorFlow] = eq.ResistorMultiFlow(
            resistorName,
            inductorName,
            pressureIn,
            pressureOut,
            resistorFlow,
            thresholdName,
            False,
            conf['compartment_volumes']
        )
        #flows.append(resistorFlow)
        modelParams[resistorName] = params['R']

    elif resitorType == 'diodeMultiFlow':
        compartment_volumes = conf['compartment_volumes']
        for volume in compartment_volumes['in']:
            flows.append('Q_' + volume[2:4] + '_' + resistorFlow[2:])

        resistorObjects[resistorFlow] = eq.DiodeMultiFlow(
            resistorName,
            inductorName,
            pressureIn,
            pressureOut,
            resistorFlow,
            thresholdName,
            False,
            conf['compartment_volumes']
        )
        #flows.append(resistorFlow)
        modelParams[resistorName] = params['R']

        modelParams[thresholdName] = params['threshold']
        variationObjects[thresholdName] = eq.NoController(thresholdName)

    elif resitorType == 'resistorInputPressureMultiFlow':
        compartment_volumes = conf['compartment_volumes']
        for volume in compartment_volumes['in']:
            flows.append('Q_' + volume[2:4] + '_' + resistorFlow[2:])

        inputPressure = params['inputPressure']

        resistorObjects[resistorFlow] = eq.ResistorInputPressureMultiFlow(
            resistorName,
            inductorName,
            pressureIn,
            pressureOut,
            resistorFlow,
            thresholdName,
            False,
            conf['compartment_volumes'],
            inputPressure,
        )
        #flows.append(resistorFlow)
        modelParams[resistorName] = params['R']

def initMembraneResistor(structures,modelObjects,conf):
    resistorFlow = conf['resistorFlow']
    resistorName = conf['resistorName']
    resistorNameGeneral = conf['resistorNameGeneral']
    inductorName = conf['inductorName']

    concentrationIn = conf['concentrationIn']
    volumeIn = conf['volimeIn']
    concentrationOut = conf['concentrationOut']
    volumeOut = conf['volumeOut']

    paramsMemb = conf['paramsMemb']
    params = conf['params']
    resitorType = conf['resitorType']
    gas = conf['gas']

    prefixes = conf['prefixes']


    constants = modelObjects['constants']

    modelParams = structures['states']['modelParams']
    variationObjects = modelObjects['parameterVariation']
    resistorObjects = modelObjects['membraneResistors']
    flows = structures['nonState']['membraneFlows']


    if gas in params:
        if resitorType == 'diode': #Diode
            resistorObjects[resistorFlow] = eq.Diode(
                resistorName,
                inductorName,
                concentrationIn,
                concentrationOut,
                resistorFlow,
                False
            )
            flows.append(resistorFlow)
            modelParams[resistorName] = params['R']
            variationObjects[resistorName] = eq.NoController(resistorName)


        elif resitorType == 'resistor': #Resistor
            resistorObjects[resistorFlow] = eq.Resistor(
                resistorName,
                inductorName,
                concentrationIn,
                concentrationOut,
                resistorFlow,
                False
            )
            flows.append(resistorFlow)
            modelParams[resistorName] = params['R']
            variationObjects[resistorName] = eq.NoController(resistorName)

        elif resitorType == 'resistorAlveoli': #ResistorAlveoli
            resistorObjects[resistorFlow] = eq.ResistorAlveoli(
                cInIdx = concentrationIn,
                volInIdx = volumeIn,
                cOutIdx = concentrationOut,
                volOutIdx = volumeOut,
                flowIdx = resistorFlow,
                area = 'area_' + resistorNameGeneral,
                diffusion= 'diffusion_' + resistorName,
                thickness = 'thickness_' + resistorNameGeneral,
                solubility= 'solubility_' + resistorName,
                inertial=False
            )
            flows.append(resistorFlow)

            modelParams['area_' + resistorNameGeneral] = paramsMemb['area']
            variationObjects['area_' + resistorNameGeneral] = eq.NoController('area_' + resistorNameGeneral)

            modelParams['thickness_' + resistorNameGeneral] = paramsMemb['thickness']
            variationObjects['thickness_' + resistorNameGeneral] = eq.NoController('thickness_' + resistorNameGeneral)
            
            #constants['thickness_' + resistorNameGeneral] = paramsMemb['thickness']
            constants['diffusion_' + resistorName] = params[gas]['diffusion']
            constants['solubility_' + resistorName] = params[gas]['solubility']

            #modelParams['diffusion_' + resistorName] = params[gas]['diffusion']
            #variationObjects['diffusion_' + resistorName] = eq.NoController('diffusion_' + resistorName)
            #modelParams['solubility_' + resistorName] = params[gas]['solubility']
            #variationObjects['solubility_' + resistorName] = eq.NoController('solubility_' + resistorName)



def initReactions(structures,modelObjects,conf):
    ##########################################################################################################
    # region Setup
    states = structures['states']['dReactions'] # Will be used to store the partial concentration variation of the concentrations involved in the reaction
    reactionObjects = modelObjects['reactions'] # Will be used to store the reaction objects/equations

    variationObjects = modelObjects['parameterVariation']
    compartmentType = conf['compartmentType'] # This is the type of compartment in the JSON file
    capacitorType = conf['capacitorType'] # This is the type of capacitor of the compartment
    
    reactionName = conf['reactionName'] # The name of the reaction in the JSON file
    compartmentName = conf['compartmentName'] # The name of the compartment in the JSON file
    prefixes = conf['prefixes'] # This is the prefix dictionary of the model
    step = conf['step'] # This is the step of the simulation

    reactionParams = conf['reactionParams'] # This is the dictionary of the parameters of the reaction
    reactionType = reactionParams['type'] # This is the type of the reaction
    reactants = reactionParams['reactants'] # This is the list of the reactants of the reaction
    products = reactionParams['products'] # This is the list of the products of the reaction

    reactantsRatio = reactionParams['reactantsRatio'] # This is the ratio of the reactants in the reaction
    productsRatio = reactionParams['productsRatio'] # This is the ratio of the products in the reaction 

    ### This compartment will be responsible for the partial variation of both reactants and products due to the chemical reaction
    #       So get their names.
    #       Also create the new name for the partial variation of the concentration of the regents and products
    reactantConcentrationNames = [] # Names of the model variables to be used in the reaction
    partialReactantConcentrationNames = [] # Names of the model variables to be used to store the partial variation of the concentration of the reactants
    for reactant in reactants:
        reactantConcentrationName = prefixes['concentration']['prefix'] + reactant + '_' + compartmentName
        reactantConcentrationNames.append(reactantConcentrationName)

        partialReactantConcentrationName = prefixes['partialConcentrationDifference']['prefix'] + reactant + '_' + compartmentName + '_' + reactionName
        partialReactantConcentrationNames.append(partialReactantConcentrationName)

    productConcentrationNames = [] # Names of the model variables to be used in the reaction
    partialProductConcentrationNames = [] # Names of the model variables to be used to store the partial variation of the concentration of the products
    for product in products:
        productConcentrationName = prefixes['concentration']['prefix'] + product + '_' + compartmentName
        productConcentrationNames.append(productConcentrationName)

        partialProductConcentrationName = prefixes['partialConcentrationDifference']['prefix'] + product + '_' + compartmentName + '_' + reactionName
        partialProductConcentrationNames.append(partialProductConcentrationName)
    ####################################################################################################################################
    # endregion

    ##########################################################################################################
    # Now we have the names of the model variables to be used in the reaction we can create the reaction objects
    if reactionType == 'equilibrium':
        #kName = 'k_' + reactionName  + '_' + compartmentName
        kName = 'k_' + reactionName
        states[kName] = reactionParams['k']
        if kName not in variationObjects:
            variationObjects[kName] = eq.NoController(kName)

        #k_ratioName = 'Kratio_' + reactionName  + '_' + compartmentName
        k_ratioName = 'Kratio_' + reactionName 
        states[k_ratioName] = reactionParams['Kratio']
        if k_ratioName not in variationObjects:
            variationObjects[k_ratioName] = eq.NoController(k_ratioName)

        for concentrationName,partialConcentrationName,ratio in zip(reactantConcentrationNames,partialReactantConcentrationNames,reactantsRatio):
            reactionObjects[partialConcentrationName] = eq.ChemicalEquilibriumControllableNEW(
                varName=partialConcentrationName,
                pdYName=concentrationName,
                reactantNames=reactantConcentrationNames,
                productNames=productConcentrationNames,
                reactantStoichiometrics=reactantsRatio,
                productStoichiometrics=productsRatio,
                ratio=ratio,
                k=kName,
                k_ratio=k_ratioName,
                step = step
            )
            states[partialConcentrationName] = 0.0

        for concentrationName,partialConcentrationName, ratio in zip(productConcentrationNames,partialProductConcentrationNames,productsRatio):
            reactionObjects[partialConcentrationName] = eq.ChemicalEquilibriumControllableNEW(
                varName=partialConcentrationName,
                pdYName=concentrationName,
                reactantNames=reactantConcentrationNames,
                productNames=productConcentrationNames,
                reactantStoichiometrics=reactantsRatio,
                productStoichiometrics=productsRatio,
                ratio=ratio,
                k=kName,
                k_ratio=k_ratioName,
                step = step
            )
            states[partialConcentrationName] = 0.0
        
        '''
        for concentrationName,partialConcentrationName,ratio in zip(reactantConcentrationNames,partialReactantConcentrationNames,reactantsRatio):
            reactionObjects[partialConcentrationName] = eq.ChemicalEquilibriumControllable(
                varName=partialConcentrationName,
                pdYName=concentrationName,
                reactantNames=reactantConcentrationNames,
                productNames=productConcentrationNames,
                ratio=ratio,
                k=kName,
                k_ratio=k_ratioName,
                step = step
            )
            states[partialConcentrationName] = 0.0

        for concentrationName,partialConcentrationName, ratio in zip(productConcentrationNames,partialProductConcentrationNames,productsRatio):
            reactionObjects[partialConcentrationName] = eq.ChemicalEquilibriumControllable(
                varName=partialConcentrationName,
                pdYName=concentrationName,
                reactantNames=reactantConcentrationNames,
                productNames=productConcentrationNames,
                ratio=ratio,
                k=kName,
                k_ratio=k_ratioName,
                step = step
            )
            states[partialConcentrationName] = 0.0
        '''

    elif reactionType == 'oneWayReaction':
        #kName = 'k_' + reactionName  + '_' + compartmentName
        kName = 'k_' + reactionName
        states[kName] = reactionParams['k']
        if kName not in variationObjects:
            variationObjects[kName] = eq.NoController(kName)

        for concentrationName,partialConcentrationName, ratio in zip(reactantConcentrationNames,partialReactantConcentrationNames,reactantsRatio):
            reactionObjects[partialConcentrationName] = eq.OneWayReactionControllableNEW(
                varName=partialConcentrationName,
                pdYName=concentrationName,
                reactantNames=reactantConcentrationNames,
                productNames=productConcentrationNames,
                reactantStoichiometrics=reactantsRatio,
                ratio=ratio,
                k=kName,
                step = step
            )
            states[partialConcentrationName] = 0.0

        for concentrationName,partialConcentrationName, ratio in zip(productConcentrationNames,partialProductConcentrationNames,productsRatio):
            reactionObjects[partialConcentrationName] = eq.OneWayReactionControllableNEW(
                varName=partialConcentrationName,
                pdYName=concentrationName,
                reactantNames=reactantConcentrationNames,
                productNames=productConcentrationNames,
                reactantStoichiometrics=reactantsRatio,
                ratio=ratio,
                k=kName,
                step = step
            )
            states[partialConcentrationName] = 0.0
        '''
        for concentrationName,partialConcentrationName, ratio in zip(reactantConcentrationNames,partialReactantConcentrationNames,reactantsRatio):
            reactionObjects[partialConcentrationName] = eq.OneWayReactionControllable(
                varName=partialConcentrationName,
                pdYName=concentrationName,
                reactantNames=reactantConcentrationNames,
                productNames=productConcentrationNames,
                ratio=ratio,
                k=kName,
                step = step
            )
            states[partialConcentrationName] = 0.0

        for concentrationName,partialConcentrationName, ratio in zip(productConcentrationNames,partialProductConcentrationNames,productsRatio):
            reactionObjects[partialConcentrationName] = eq.OneWayReactionControllable(
                varName=partialConcentrationName,
                pdYName=concentrationName,
                reactantNames=reactantConcentrationNames,
                productNames=productConcentrationNames,
                ratio=ratio,
                k=kName,
                step = step
            )
            states[partialConcentrationName] = 0.0
        '''

    elif reactionType == 'creation':
        pass

    else:
        print('Error: Reactions not implemented for ' + reactionType)

def initGasExchange(structures,modelObjects,conf):
    states = structures['states']['states']
    gasExchangeObjects = modelObjects['concentrations']

    compartmentType = conf['compartmentType']
    capacitorType = conf['capacitorType']
    concentrationName = conf['concentrationName']
    gasValue = conf['gasValue']
    dV = conf['dV']
    objectConf = conf['objectConf']

    if compartmentType == 'component':
        gasExchangeObjects[concentrationName] = eq.GasTransport(concentrationName, objectConf, dV)
        states[concentrationName] = gasValue

    elif capacitorType == 'constantPressure':
        gasExchangeObjects[concentrationName] = eq.GasTransportTissue(concentrationName, dV)
        states[concentrationName] = gasValue

    else:
        print('Error: Gas exchange not implemented for ' + capacitorType)

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

        '''
        if value['type'] == 'cycle':
            cycleObjects[cycleName] = eq.Cycle(
                cycleName,
                )
        elif value['type'] == 'ramp':
            rate = value['params']['rate']
            cycleObjects[cycleName] = eq.CycleRamp(
                cycleName,
                rate,
                )
        elif value['type'] == 'sine':
            amplitude = value['params']['amplitude']
            period = value['params']['period']
            cycleObjects[cycleName] = eq.CycleSine(
                cycleName,
                "T0",
                amplitude,
                period,
                )

        '''

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
                processedIdx = otherName,
                varToProcessIdx = varIn,
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
                processedIdx = otherName,
                varToProcessIdx = varIn,
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
                processedIdx = otherName,
                varToProcessIdx = varIn,
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
                processedIdx = otherName,
                varToProcessIdx = varIn,
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
                varToProcessIdx = otherName,
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
                varToProcessIdx = otherName,
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
        
        elif value['type'] == 'stateRatio':
            otherName = value['params']['newVarName']
            otherObjects[otherName] = eq.RatioStates(
                numerator_state=value['params']['numerator_state'],
                denominator_state=value['params']['denominator_state'],
                varName=otherName,
                step=step
            )
            dOther[otherName] = value['params']['y0']
            
        elif value['type'] == 'stateSummation':
            otherName = value['params']['newVarName']
            otherObjects[otherName] = eq.SumStates(
                states = value['params']['states'],
                varName = otherName,
                step = step
            )
            dOther[otherName] = value['params']['y0']
        
        elif value['type'] == 'stateSubstraction':
            otherName = value['params']['newVarName']
            otherObjects[otherName] = eq.SubstactStates(
                state1 = value['params']['state1'],
                state2 = value['params']['state2'],
                varName = otherName,
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
                varName = otherName,
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
                varName = otherName,
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
                varName = otherName,
                varToControlIdx = baseVar,
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
                varName = otherName,
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
                varName = otherName,
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
                varName = otherName,
                step = step,
                )
            
            dOther[otherName] = value['params']['y0']

        
            

def initOtherModelDependentCalculations(structures,modelObjects,modelStructure):
        
    otherObjects = modelObjects['other']
    others = modelStructure['other']
    dOther = structures['states']['dOther']
    prefixes = modelStructure['data']['prefixes']
    step = modelStructure['configurations']['simulationParameters']['dt']


    for key,value in others.items():
        constants = modelObjects['constants']

        if value['type'] == 'lungVolume':
            otherName = value['params']['newVarName']
            compartmentName = value['params']['compartment']
            
            fIn = []
            fOut = []    
            fInMem = []
            fOutMem = []   
            
            for connectionName,connection in modelObjects['connections'].items():
                if compartmentName in connectionName:
                    for f in connection.fInIdxs:
                        fIn.append(f)
                    for f in connection.fOutIdxs:
                        fOut.append(f)
                    for f in connection.fInMemIdxs:
                        fInMem.append(f)
                    for f in connection.fOutMemIdxs:
                        fOutMem.append(f)  
                          
            otherObjects[otherName] = eq.Connections(
                        fIn,
                        fOut,
                        prefixes['pressure']['prefix'] + compartmentName,
                        fInMem,
                        fOutMem,
                        'gas',

            )
            dOther[otherName] = value['params']['y0']

        elif value['type'] == 'concentrationHenrysLaw':
            otherName = value['params']['newVarName']
            compartmentName = value['params']['compartment']

            '''
            
            fIn = []
            fOut = []    
            fInMem = []
            fOutMem = []   
            for connectionName,connection in modelObjects['connections'].items():
                if compartmentName in connectionName:
                    for f in connection.fInIdxs:
                        fIn.append(f)
                    for f in connection.fOutIdxs:
                        fOut.append(f)
                    for f in connection.fInMemIdxs:
                        fInMem.append(f)
                    for f in connection.fOutMemIdxs:
                        fOutMem.append(f) 
            '''
            constants['kh_' + otherName] = value['params']['kh']
            otherObjects[otherName] = eq.ConcentrationHenrysLaw(
                varToProcessIdx = otherName,
                pressureIn = value['params']['pressureIn'],
                partialVolume = value['params']['partialVolume'],
                volume = value['params']['volume'],
                V0 = value['params']['V0'],
                C = value['params']['C'],
                kh = 'kh_' + otherName,
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
                    

                if calibration['type'] == 'localController':
                    constants['minValueToControl_' + parameter] = calibration['params']['minValue']
                    constants['maxValueToControl_' + parameter] = calibration['params']['maxValue']
                    constants['proportionalConstant_' + parameter] = calibration['params']['proportionalK']
                    constants['targetValue' + parameter] = calibration['params']['targetValue']

                    parameterVariationObjects[parameter] = eq.LocalController(
                        varTargetIdx = calibration['params']['varTarget'],
                        varToControlIdx= calibration['params']['varToControl'],
                        targetValue= 'targetValue' + parameter,
                        minValueToControl= 'minValueToControl_' + parameter,
                        maxValueToControl= 'maxValueToControl_' + parameter,
                        proportionalConstant= 'proportionalConstant_' + parameter,
                        offset= 'offset_' + parameter
                    )
                
                
                elif calibration['type'] == 'localStateController':
                    constants['minValueToControl_' + parameter] = calibration['params']['minValue']
                    constants['maxValueToControl_' + parameter] = calibration['params']['maxValue']
                    constants['proportionalConstant_' + parameter] = calibration['params']['proportionalK']
                    parameterVariationObjects[parameter] = eq.LocalStateController(
                        varTargetIdx = calibration['params']['varTarget'],
                        varToControlIdx= calibration['params']['varToControl'],
                        targetValue= calibration['params']['targetValue'],
                        minValueToControl= 'minValueToControl_' + parameter,
                        maxValueToControl= 'maxValueToControl_' + parameter,
                        proportionalConstant= 'proportionalConstant_' + parameter,
                        offset= 'offset_' + parameter
                    )
                
                elif calibration['type'] == 'ladder':
                    constants['rate_' + parameter] = calibration['params']['rate']

                    parameterVariationObjects[parameter] = eq.LadderController(
                        varToControlIdx= calibration['params']['varToControl'],
                        rate = 'rate_' + parameter,
                    )
                elif calibration['type'] == 'cosine':
                    constants['freq_' + parameter] = calibration['params']['freq']
                    constants['amp_' + parameter] = calibration['params']['amp']
                    parameterVariationObjects[parameter] = eq.SineController(
                        varToControlIdx= calibration['params']['varToControl'],
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
                        varToControlIdx= calibration['params']['varToControl'],
                        chemoRegulator= calibration['params']['chemoRegulator'],
                        baroRegulator= calibration['params']['baroRegulator'],
                        chemoSensitivity= 'chS_' + parameter,
                        baroSensitivity= 'baS_' + parameter,
                        maxValue= 'max_' + parameter,
                        minValue= 'min_' + parameter,
                        rate = 'rate_' + parameter,
                    )
                elif calibration['type'] == 'rampGated':
                    constants['rate_' + parameter] = calibration['params']['rate']
                    constants['chS_' + parameter] = calibration['params']['chemoSensitivity']
                    constants['baS_' + parameter] = calibration['params']['baroSensitivity']
                    constants['max_' + parameter] = calibration['params']['maxValue']
                    constants['min_' + parameter] = calibration['params']['minValue']

                    constants['gateSlope_' + parameter] = calibration['params']['gateSlope']
                    constants['edgeFrac_' + parameter] = calibration['params']['edgeFrac']
                    constants['recoveryRate_' + parameter] = calibration['params']['recoveryRate']

                    parameterVariationObjects[parameter] = eq.RampControllerGated(
                        varToControlIdx= calibration['params']['varToControl'],
                        chemoRegulator= calibration['params']['chemoRegulator'],
                        baroRegulator= calibration['params']['baroRegulator'],
                        chemoSensitivity= 'chS_' + parameter,
                        baroSensitivity= 'baS_' + parameter,
                        maxValue= 'max_' + parameter,
                        minValue= 'min_' + parameter,
                        rate = 'rate_' + parameter,
                        gateSlope = 'gateSlope_' + parameter,
                        edgeFrac = 'edgeFrac_' + parameter,
                        recoveryRate = 'recoveryRate_' + parameter
                    )
                elif calibration['type'] == 'rampLocalGated':
                    constants['rate_' + parameter] = calibration['params']['rate']
                    constants['chS_' + parameter] = calibration['params']['chemoSensitivity']
                    constants['baS_' + parameter] = calibration['params']['baroSensitivity']

                    constants['localSensitivity_' + parameter] = calibration['params']['localSensitivity']
                    constants['max_' + parameter] = calibration['params']['maxValue']
                    constants['min_' + parameter] = calibration['params']['minValue']

                    constants['gateSlope_' + parameter] = calibration['params']['gateSlope']
                    constants['edgeFrac_' + parameter] = calibration['params']['edgeFrac']
                    constants['recoveryRate_' + parameter] = calibration['params']['recoveryRate']

                    parameterVariationObjects[parameter] = eq.RampLocalControllerGated(
                        varToControlIdx= calibration['params']['varToControl'],
                        chemoRegulator= calibration['params']['chemoRegulator'],
                        baroRegulator= calibration['params']['baroRegulator'],
                        chemoSensitivity= 'chS_' + parameter,
                        baroSensitivity= 'baS_' + parameter,
                        localRegulator= calibration['params']['localRegulator'],
                        localSensitivity= 'localSensitivity_' + parameter,
                        localTarget= calibration['params']['localTarget'],
                        maxValue= 'max_' + parameter,
                        minValue= 'min_' + parameter,
                        rate = 'rate_' + parameter,
                        gateSlope = 'gateSlope_' + parameter,
                        edgeFrac = 'edgeFrac_' + parameter,
                        recoveryRate = 'recoveryRate_' + parameter
                    )               
                elif calibration['type'] == 'rampLocal':
                    constants['rate_' + parameter] = calibration['params']['rate']
                    constants['chS_' + parameter] = calibration['params']['chemoSensitivity']
                    constants['baS_' + parameter] = calibration['params']['baroSensitivity']

                    constants['localSensitivity_' + parameter] = calibration['params']['localSensitivity']
                    constants['max_' + parameter] = calibration['params']['maxValue']
                    constants['min_' + parameter] = calibration['params']['minValue']

                    parameterVariationObjects[parameter] = eq.RampLocalController(
                        varToControlIdx= calibration['params']['varToControl'],
                        chemoRegulator= calibration['params']['chemoRegulator'],
                        baroRegulator= calibration['params']['baroRegulator'],
                        chemoSensitivity= 'chS_' + parameter,
                        baroSensitivity= 'baS_' + parameter,
                        localRegulator= calibration['params']['localRegulator'],
                        localSensitivity= 'localSensitivity_' + parameter,
                        localTarget= calibration['params']['localTarget'],
                        maxValue= 'max_' + parameter,
                        minValue= 'min_' + parameter,
                        rate = 'rate_' + parameter,
                    )
                
                elif calibration['type'] == 'sigmoid':

                    constants['maxValue_' + parameter] = calibration['params']['maxValue']
                    constants['minValue_' + parameter] = calibration['params']['minValue']
                    constants['inflectionPoint_' + parameter] = calibration['params']['inflectionPoint']
                    constants['slope_' + parameter] = calibration['params']['slope']

 
                    if 'inhibitor' in calibration['params']:
                        inhibitor = calibration['params']['inhibitor']
                        constants['I0_' + parameter] = calibration['params']['I0']
                    else:
                        inhibitor = 'P_Atm'
                        constants['I0_' + parameter] = 760.0
                    
                    parameterVariationObjects[key] = eq.LocalSigmoidStateController1(
                        xAxis = calibration['params']['xAxis'],
                        varToControlIdx = calibration['params']['varToControl'],
                        maxValue = 'maxValue_' + parameter,
                        minValue = 'minValue_' + parameter,
                        inflectionPoint = 'inflectionPoint_' + parameter,
                        slope = 'slope_' + parameter,
                        inhibitor = inhibitor,
                        I0 = 'I0_' + parameter,
                        step=step
                    )
                
                elif calibration['type'] == 'sigmoidCTRL':

                    constants['targetValue' + parameter] = calibration['params']['targetValue']
                    constants['maxValue_' + parameter] = calibration['params']['maxValue']
                    constants['minValue_' + parameter] = calibration['params']['minValue']
                    constants['slope_' + parameter] = calibration['params']['slope']
                    
                    parameterVariationObjects[key] = eq.LocalSigmoidCTRLController(
                        varTargetIdx = calibration['params']['varTarget'],
                        varToControlIdx = calibration['params']['varToControl'],
                        targetValue= 'targetValue' + parameter,
                        maxValue = 'maxValue_' + parameter,
                        minValue = 'minValue_' + parameter,
                        slope = 'slope_' + parameter,
                        step=step
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
                        varToControlIdx = calibration['params']['varToControl'],
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
                        varToControlIdx = calibration['params']['varToControl'],
                        targetValue= calibration['params']['targetValue'],
                        maxValue = 'maxValue_' + parameter,
                        minValue = 'minValue_' + parameter,
                        cubicFactor = 'cubicFactor_' + parameter,
                        linearFactor = 'linearFactor_' + parameter,
                        k = 'k_' + parameter,
                        offset = 'offset_' + parameter,
                        step=step
                    )

                elif calibration['type'] == 'stressStateController':

                    parameterVariationObjects[key] = eq.StressController(
                        varTargetIdx = calibration['params']['varTarget'],
                        varToControlIdx = calibration['params']['varToControl'],
                        stressValue= calibration['params']['stressValue'],
                        V0 = calibration['params']['V0'],
                        step=step
                    )
                
                elif calibration['type'] == 'polynomialController':

                    constants['dc_' + parameter] = calibration['params']['dc']
                    constants['linear_' + parameter] = calibration['params']['linear']
                    constants['quadratic_' + parameter] = calibration['params']['quadratic']
                    
                    parameterVariationObjects[key] = eq.PolynomialController(
                        varTargetIdx = calibration['params']['varTarget'],
                        varToControlIdx = calibration['params']['varToControl'],
                        dcFactor = 'dc_' + parameter,
                        linearFactor = 'linear_' + parameter,
                        quadraticFactor = 'quadratic_' + parameter,
                        step=step
                    )




#████████ ██████  ███████ ███████     ██████  ██    ██ ██ ██      ██████  ███████ ██████  ███████
#   ██    ██   ██ ██      ██          ██   ██ ██    ██ ██ ██      ██   ██ ██      ██   ██ ██
#   ██    ██████  █████   █████       ██████  ██    ██ ██ ██      ██   ██ █████   ██████  ███████
#   ██    ██   ██ ██      ██          ██   ██ ██    ██ ██ ██      ██   ██ ██      ██   ██      ██
#   ██    ██   ██ ███████ ███████     ██████   ██████  ██ ███████ ██████  ███████ ██   ██ ███████

def buildTrees(modelStructure,tree):
    newJSONelements = {
        'compartments': {},
        'resistors': {},
        'bias': {},
        'regions': {},
        'cycles': {}
    }

    if tree['type'] == 'openTree':
        buildOpenTree(newJSONelements,tree)

    modelStructure['compartments'] = modelStructure['compartments'] | newJSONelements['compartments']
    modelStructure['connections']['resistive'] = modelStructure['connections']['resistive'] | newJSONelements['resistors']
    modelStructure['connections']['bias'] = modelStructure['connections']['bias'] | newJSONelements['bias']
    modelStructure['connections']['cycles'] = modelStructure['connections']['cycles'] | newJSONelements['cycles']

    newRegions = {}
    for regionName,regions in newJSONelements['regions'].items():
        if regionName in newJSONelements['compartments']:
            newRegions[regionName] = []
            for region in regions:
                if region != '':
                        modelStructure['connections']['regions'][region].append(regionName)

        else:
            newRegions[regionName] = region

    modelStructure['connections']['regions'] = modelStructure['connections']['regions'] | newRegions

def buildOpenTree(
        newJSONelements,
        tree,
        level = 0,
        inputNodeName = '',
        idx = 0
    ):

    compartments = newJSONelements['compartments']
    resistors = newJSONelements['resistors']
    bias = newJSONelements['bias']
    regions = newJSONelements['regions']
    cycles = newJSONelements['cycles']

     # Trachea
    if level == 0:
        # make names and gas regions
        inputNodeName = tree['treeParams']['inputNode']
        nodeName = tree['treeParams']['rootNode']['name'] + '|' + str(idx)
        gasRegion = tree['gasRegion']
        # capacitor parameters are the same as the root node
        capacitor = {
            'type': tree['treeParams']['rootNode']['typeCapacitor'],
            'params': tree['treeParams']['rootNode']['paramsCapacitor'],
        }
        # add to compartments
        compartments[nodeName] = {
            'gasRegion': gasRegion,
            'type': 'component',
            'capacitor': capacitor,
        }

        # resistor name
        resistorName = 'Res_' + inputNodeName + '_' + nodeName
        # resistor parameters are the same as the root node
        resistor = {
            'from': inputNodeName,
            'to': nodeName,
            'type': tree['treeParams']['rootNode']['typeResistor'],
            'params': tree['treeParams']['rootNode']['paramsResistor'],
        }
        resistors[resistorName] = resistor

        bias[nodeName] = tree['treeParams']['rootNode']['bias']
        bias[resistorName] = tree['treeParams']['rootNode']['bias']
        regions[nodeName] = tree['treeParams']['rootNode']['region']
        regions[resistorName] = []
        cycles[nodeName] = tree['treeParams']['rootNode']['cycle']
        cycles[resistorName] = tree['treeParams']['rootNode']['cycle']

        # call function for the next level
        if tree['treeParams']['nrLevels'] > 0:
            for i in range(tree['treeParams']['branchArray'][1]):
                buildOpenTree(newJSONelements,tree,level+1,nodeName,i)

    # Branches
    elif level == 1:
        # make names and gas regions
        parentInitialNameLength = len(tree['treeParams']['rootNode']['name'])
        nodeName = tree['treeParams']['branch']['name'] + inputNodeName[parentInitialNameLength:] + '|' + str(idx)
        gasRegion = tree['gasRegion']

        if tree['treeParams']['branch']['distribution']['type'] == 'uniform':
            newParams = {}
            for key,value in tree['treeParams']['branch']['paramsCapacitor'].items():
                newParams[key] = value

        capacitor = {
            'type': tree['treeParams']['branch']['typeCapacitor'],
            'params': newParams,
        }
        # add to compartments
        compartments[nodeName] = {
            'gasRegion': gasRegion,
            'type': 'component',
            'capacitor': capacitor,
        }

        # resistor name
        resistorName = 'Res_' + inputNodeName + '_' + nodeName

        if tree['treeParams']['branch']['distribution']['type'] == 'uniform':
            newParams = {}
            for key,value in tree['treeParams']['branch']['paramsResistor'].items():
                newParams[key] = value

        resistor = {
            'from': inputNodeName,
            'to': nodeName,
            'type': tree['treeParams']['branch']['typeResistor'],
            'params': newParams,
        }
        resistors[resistorName] = resistor

        bias[nodeName] = tree['treeParams']['branch']['bias']
        bias[resistorName] = tree['treeParams']['branch']['bias']
        regions[nodeName] = tree['treeParams']['branch']['region']
        regions[resistorName] = []
        cycles[nodeName] = tree['treeParams']['branch']['cycle']
        cycles[resistorName] = tree['treeParams']['branch']['cycle']

        # call function for the next level
        if tree['treeParams']['nrLevels'] > 1:
            for i in range(tree['treeParams']['branchArray'][2]):
                buildOpenTree(newJSONelements,tree,level+1,nodeName,i)

    # Leafs
    else:
        # make names and gas regions
        if level == 2:
            parentInitialNameLength = len(tree['treeParams']['branch']['name'])
        else:
            parentInitialNameLength = len(tree['treeParams']['leaf']['name'])
        nodeName = tree['treeParams']['leaf']['name'] + inputNodeName[parentInitialNameLength:] + '|' + str(idx)
        gasRegion = tree['gasRegion']

        if tree['treeParams']['leaf']['distribution']['type'] == 'uniform':
            newParams = {}
            for key,value in tree['treeParams']['leaf']['paramsCapacitor'].items():
                newParams[key] = value

        capacitor = {
            'type': tree['treeParams']['leaf']['typeCapacitor'],
            'params': newParams,
        }
        # add to compartments
        compartments[nodeName] = {
            'gasRegion': gasRegion,
            'type': 'component',
            'capacitor': capacitor,
        }

        # resistor name
        resistorName = 'Res_' + inputNodeName + '_' + nodeName

        if tree['treeParams']['leaf']['distribution']['type'] == 'uniform':
            newParams = {}
            for key,value in tree['treeParams']['leaf']['paramsResistor'].items():
                newParams[key] = value

        resistor = {
            'from': inputNodeName,
            'to': nodeName,
            'type': tree['treeParams']['leaf']['typeResistor'],
            'params': newParams,
        }
        resistors[resistorName] = resistor

        bias[nodeName] = tree['treeParams']['leaf']['bias']
        bias[resistorName] = tree['treeParams']['leaf']['bias']
        regions[nodeName] = tree['treeParams']['leaf']['region']
        regions[resistorName] = []
        cycles[nodeName] = tree['treeParams']['leaf']['cycle']
        cycles[resistorName] = tree['treeParams']['leaf']['cycle']

        # call function for the next level
        if tree['treeParams']['nrLevels'] > level:
            for i in range(tree['treeParams']['branchArray'][3]):
                buildOpenTree(newJSONelements,tree,level+1,nodeName,i)

