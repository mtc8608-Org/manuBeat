import numpy as np
import copy
import library.utils as utils
import math
import jax.numpy as jnp

def addMetadataToResults(results,modelStructure):

    prefixes = [value for value in modelStructure['data']['prefixes'].values()]

    newResults = {}
    
    for key, value in results.items():
        for prefix in prefixes:
            has_nan = any(math.isnan(x) for x in value if isinstance(x, float))
            if has_nan:
                newResults[key] = {
                    'data': np.zeros(len(value)),
                    'metadata': copy.deepcopy(modelStructure['data']['prefixes']['toAdd'])
                }
                print('NaN found in ' + key)
                break
            else:
                if key.startswith(prefix['prefix']):
                    newResults[key] = {
                        'data': value,
                        'metadata': copy.deepcopy(prefix)
                    }
                    break
                else:
                    newResults[key] = {
                        'data': value,
                        'metadata': modelStructure['data']['prefixes']['unknown']
                    }

    return copy.deepcopy(newResults)

# TODO: Generalize the function to work with other fromats
# Adds all necessary data processing operations for a tree of alveoli
def addTreeToPostProcessingConfig(results,dataProcessingConfig,inputKey):
    done = []
    for key in results.keys():
        if inputKey in key:
            # extract the substring from key that starts with La
            substring = key[key.index(inputKey):]
            nrFields = len(substring.split('|'))
            # its the parent alveoli
            if ((nrFields == 4) or (nrFields == 5)) and (substring not in done):
                done.append(substring)

                c_sigmoid = 'C_Sigmoid_' + substring
                dataProcessingConfig['compliance0'][c_sigmoid]={
                    "operation": "calculateSigmoidComplianceRange",
                    "params": {
                        "resultName": "P_" + substring,
                        "tagToUse": "V_" + substring,
                        "start": 0.0,
                        "end": results['separation_' + substring][-1] +  results['InfP_' + substring][-1]
                    }
                }
                c_ = 'C_' + substring
                dataProcessingConfig['compliance0'][c_]={
                    "operation": "calculateSigmoidCompliance",
                    "params": {
                        "resultName": "P_" + substring,
                    }
                }
                v_range = 'V_range_' + substring
                dataProcessingConfig['volumes2'][v_range]={
                    "operation": "range",
                    "params": {
                        "start": 0.0,
                        "end": results['separation_' + substring][-1] +  results['InfP_' + substring][-1]
                    }
                }
                p_transpulmonary = 'P_Trp_' + substring
                dataProcessingConfig['pressures2'][p_transpulmonary]={
                    "operation": "difference",
                    "params": {
                        "resultName1": "P_" + substring,
                        "resultName2": "P_Plr"
                    }
                }
                p_sigmoid = 'P_Sigmoid_' + substring
                dataProcessingConfig['pressures2'][p_sigmoid]={
                    "operation": "division",
                    "params": {
                        "numerator" : v_range,
                        "denominator" : c_sigmoid
                    }
                }
            else:
                pass

#██████  ██████   ██████   ██████ ███████ ███████ ███████     ██    ██  █████  ██████  ██  █████  ██████  ██      ███████ ███████ 
#██   ██ ██   ██ ██    ██ ██      ██      ██      ██          ██    ██ ██   ██ ██   ██ ██ ██   ██ ██   ██ ██      ██      ██      
#██████  ██████  ██    ██ ██      █████   ███████ ███████     ██    ██ ███████ ██████  ██ ███████ ██████  ██      █████   ███████ 
#██      ██   ██ ██    ██ ██      ██           ██      ██      ██  ██  ██   ██ ██   ██ ██ ██   ██ ██   ██ ██      ██           ██ 
#██      ██   ██  ██████   ██████ ███████ ███████ ███████       ████   ██   ██ ██   ██ ██ ██   ██ ██████  ███████ ███████ ███████

# Backwards-compatible shim. The eager ~40-branch if/elif engine (which deep-copied
# every array output and ran Python loops in the cycle ops) is replaced by the lazy,
# vectorized DAG engine in resultsEngine.py. This returns the same
# {name: {'data','metadata'}} shape the notebook and plots.py consume.
#
# `requested` (optional) computes only the transitive closure of the named outputs;
# omit it to compute everything (default, matches the legacy behavior).
def processVariables(results, modelObjects, dataProcessingConfig, modelStructure,
                     requested=None, strict=False):
    from library import resultsEngine        # local import avoids a cycle
    engine = resultsEngine.ResultsEngine(
        results, dataProcessingConfig, modelStructure,
        modelObjects=modelObjects, strict=strict)
    engine.evaluate(requested)
    if engine.errors:
        for name, op, reason in engine.errors:
            print(f'processVariables error [{op}] {name}: {reason}')
    return engine.assembleLegacy()

#███    ███  █████  ████████ ██   ██ 
#████  ████ ██   ██    ██    ██   ██ 
#██ ████ ██ ███████    ██    ███████ 
#██  ██  ██ ██   ██    ██    ██   ██ 
#██      ██ ██   ██    ██    ██   ██ 

# Results processing functions
def sumOfArrays(params,results):
    try:
        resultNames = params['resultNames']
        newResultNames = []
        for name in resultNames:
            if name not in results.keys():
                print('sumOfArrays warning' + name + ' not found')
                pass
            else:
                newResultNames.append(name) 

        output = np.sum(np.array([results[name]['data'] for name in newResultNames]),axis=0)

        return output
    except Exception as e:
        print('sumOfArrays error ' + str(params.get('resultNames')))
        return np.zeros(int(len(results['T']['data'])))

def proportion(params,results):
    try:
        multiplier = results[params['multiplier']]['data']
        numerator = results[params['numerator']]['data']
        denominator = results[params['denominator']]['data']
        if (params['multiplier'] in results.keys()) and (params['numerator'] in results.keys()) and (params['denominator'] in results.keys()) :
            return multiplier * (numerator/denominator)
        else:
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('proportion error' + params['multiplier'] + ' or ' + params['numerator'] + ' or ' + params['denominator'])
        return np.zeros(int(len(results['T']['data'])))

def constantSubstraction(params,results):
    try:
        constant = params['constant']
        resultName = params['resultName']
        if resultName in results.keys():
            output = results[resultName]['data'] - constant
        else:
            print('constantSubstraction warning' + resultName + ' not found')
            output = np.zeros(int(len(results['T']['data'])))

        return output
    except Exception as e:
        print(e)
        print('constantSubstraction error' + resultName)
        return []

def absoluteValue(params,results):
    try:
        resultName = params['resultName']
        if resultName in results.keys():
            output = np.abs(results[resultName]['data'])
        else:
            print('absoluteValue warning' + resultName + ' not found')
            output = np.zeros(int(len(results['T']['data'])))

        return output
    except Exception as e:
        print(e)
        print('absoluteValue error' + resultName)
        return []
       
def constantMultiplication(params,results):
    try:
        constant = params['constant']
        resultName = params['resultName']
        if resultName in results.keys():
            output = results[resultName]['data'] * constant
        else:
            print('constantMultiplication warning' + resultName + ' not found')
            output = np.zeros(int(len(results['T']['data'])))

        return output
    except Exception as e:
        print(e)
        print('constantMultiplication error' + resultName)
        return []

def unitConversion(params,results):
    try:
        resultName = params['resultName']
        fromUnit = params['from']
        toUnit = params['to']
        
        unit = str(toUnit)

        if resultName in results.keys():
            if fromUnit == 'Pa' and toUnit == 'mmHg':
                output = utils.paTOmmHg(results[resultName]['data'])
            elif fromUnit == 'mmHg' and toUnit == 'Pa':
                output = utils.mmHgTOPa(results[resultName]['data'])
            elif fromUnit == 'mmHg' and toUnit == 'cmH2O':
                output = utils.mmHgTOCmH2O(results[resultName]['data'])
            elif fromUnit == 'cmH2O' and toUnit == 'mmHg':
                output = utils.cmH2OTOmmHg(results[resultName]['data'])
            elif fromUnit == 'Pa' and toUnit == 'cmH2O':
                output = utils.paTOcmH2O(results[resultName]['data'])
            elif fromUnit == 'cmH2O' and toUnit == 'Pa':
                output = utils.cmH2OTOPa(results[resultName]['data'])
            elif fromUnit == 'mmHg' and toUnit == 'mol/ml':
                output = utils.mmHgTOmolml(results[resultName]['data'])
            else:
                print('unit conversion not implemented: ', fromUnit, ' to ', toUnit)
                unit = str(fromUnit)
                output = results[resultName]['data']

            return output,unit
        else:
            print('unitConversion warning' + resultName + ' not found')
            return np.zeros(int(len(results['T']['data']))),unit
    except Exception as e:
        print(e)
        print('unitConversion error' + resultName)
        return np.zeros(int(len(results['T']['data']))),unit

def integral(params,results):
    try:
        resultName = params['resultName']
        step = params['step']
        if resultName in results.keys():
            return np.cumsum(results[resultName]['data']*step)
        else:
            print('integral warning' + resultName)
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('integral error' + resultName)
        return []

def minusMin(params,results):
    try:
        resultName = params['resultName']
        if resultName in results.keys():
            return results[resultName]['data'] - np.min(results[resultName]['data'])
        else:
            print('minusMin warning' + resultName)
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('minusMin error' + resultName)
        return np.zeros(int(len(results['T']['data'])))

def minusY0(params,results):
    try:
        resultName = params['resultName']
        if resultName in results.keys():
            return results[resultName]['data'] - results[resultName]['data'][0]
        else:
            print('minusMin warning' + resultName)
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('minusMin error' + resultName)
        return np.zeros(int(len(results['T']['data'])))

def difference(params,results):
    try:
        resultName1 = params['resultName1']
        resultName2 = params['resultName2']
        if (resultName1 in results.keys()) and (resultName2 in results.keys()):
            return results[resultName1]['data'] - results[resultName2]['data']
        else:
            print('difference warning' + resultName1 + ' or ' + resultName2)
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('difference error' + resultName1 + ' or ' + resultName2)
        return np.zeros(int(len(results['T']['data'])))

def rangeArray(params,results):
    try:
        start = params['start']
        end = params['end']
        step = (end-start)/len(results['T']['data'])
        result = np.arange(start,end,step)
        if len(result) > len(results['T']['data']):
            return result[:len(results['T']['data'])]
        elif len(result) < len(results['T']['data']):
            return np.append(result,np.zeros(len(results['T']['data'])-len(result)))
        else:
            return result
    except Exception as e:
        print(e)
        print('rangeArray error')
        return np.zeros(int(len(results['T']['data'])))

def division(params,results):
    try:
        numerator = params['numerator']
        denominator = params['denominator']
        if (numerator in results.keys()) and (denominator in results.keys()):
            return results[numerator]['data']/results[denominator]['data']
        else:
            print('division error ' + numerator + ' or ' + denominator + ' not found')
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('division error ' + numerator + ' or ' + denominator)
        return np.zeros(int(len(results['T']['data'])))

def pH(params,results):
    try:
        concentration = params['concentration']
        pH = -np.log10(results[concentration]['data'])
        return pH
    except Exception as e:
        print(e)
        print('pH error H not found')
        return np.zeros(int(len(results['T']['data'])))

def oxygenSaturation(params,results):
    #round(100-(states['Y_Hb_Vp']/(states['Y_Hb_Vp']+states['Y_HbO2_Vp']))*100,2)
    try:
        resultName = params['resultName']
        compartment = params['compartment']

        Yhb = results['Y_Hb_' + compartment]['data']
        Yhbo2 = results['Y_HbO2_' + compartment]['data']
        oxygenSaturation = 100 - (Yhb/(Yhb+Yhbo2))*100
        return oxygenSaturation
        
    except Exception as e:
        print(e)
        print('oxygenSaturation error H not found')
        return np.zeros(int(len(results['T']['data'])))




def movingAverage(params,results):
    try:
        resultName = params['resultName']
        window = int(params['window'])
        if resultName in results.keys():

            res= results[resultName]['data']
            x = np.asarray(res, dtype=float)
            pad_left = window // 2
            pad_right = window - 1 - pad_left
            xpad = np.pad(x, (pad_left, pad_right), mode="edge")
            kernel = np.ones(window, dtype=float) / window
            return np.convolve(xpad, kernel, mode="valid")

            #ma = np.convolve(res, np.ones(window) / window, mode="same")
            #results[resultName]['data'] = ma
        else:
            print('movingAverage warning: ' + resultName)
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('movingAverage error: ' + resultName)
        return np.zeros(int(len(results['T']['data'])))


def cardiacOutput(params,results):
    try:
        SV = params['SV']
        HR = params['HR']
        if (SV in results.keys()) and (HR in results.keys()):
            return (results[SV]['data'] * results[HR]['data'])/1000
        else:
            print('cardiacOutput error ' + SV + ' or ' + HR + ' not found')
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('cardiacOutput error ' + SV + ' or ' + HR)
        return np.zeros(int(len(results['T']['data'])))
    
def heartRate(params,results):
    try:
        cycle = params['cycle']
        time = params['time']
        if (cycle in results.keys()):
            return time/results[cycle]['data'] 
        else:
            print('heartRate error ' + cycle + ' not found')
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('heartRate error ' + cycle)
        return np.zeros(int(len(results['T']['data'])))

def volumetricFlow(params,results):
    try:
        pressure = params['pressure']
        flow = params['flow']
        if (pressure in results.keys()) and (flow in results.keys()):
            RT = 62.36367 * 310.15
            
            return (RT * (results[flow]['data']))/(results[pressure]['data'])
        else:
            print('volumetricFlow error ' + pressure + ' or ' + flow + ' not found')
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('volumetricFlow error ' + pressure + ' or ' + flow)
        return np.zeros(int(len(results['T']['data'])))

def totalBloodGasMoles(params,results):
    try:
        tag = params['tag']
        multiplier = params['multiplier']
        compartments = {}
        for key,value in results.items():
            if key.startswith(tag) and ('Tissue' not in key) and ('La' not in key) and ('Thx' not in key) and ('Plr' not in key):
                compartmentName = 'V_' + key[len(tag):]
                #print('##########' + key + '##########')
                #print(compartmentName)
                compartments[key] = value['data'] * (results[compartmentName]['data']/1000)
        
        # make an array that is the sum of all compartments
        total = np.zeros(int(len(results['T']['data'])))
        for key,value in compartments.items():
            total += value

            
        return (total * multiplier)

    except Exception as e:
        print(e)
        print('totalBloodGasMoles error ' + tag)
        return np.zeros(int(len(results['T']['data'])))

def totalTissueGasMoles(params,results):
    try:
        tag = params['tag']
        multiplier = params['multiplier']
        compartments = {}
        for key,value in results.items():
            if key.startswith(tag) and ('Tissue' in key) and ('La' not in key) and ('Thx' not in key) and ('Plr' not in key):
                compartmentName = 'V_' + key[len(tag):]
                #print('##########' + key + '##########')
                #print(compartmentName)
                compartments[key] = value['data'] * (results[compartmentName]['data']/1000)
        
        # make an array that is the sum of all compartments
        total = np.zeros(int(len(results['T']['data'])))
        for key,value in compartments.items():
            total += value

            
        return (total * multiplier)

    except Exception as e:
        print(e)
        print('totalBloodGasMoles error ' + tag)
        return np.zeros(int(len(results['T']['data'])))


def volumeToMol(params,results):
    try:
        volume = params['volume']
        pressure = params['pressure']
        RT = 62.36367 *params['temperature']

        nMol = (results[volume]['data'])*(results[pressure]['data'])/RT
        
        return nMol
        
    except Exception as e:
        print(e)
        print('molToVolume error ' + pressure + ' or ' + volume)
        return np.zeros(int(len(results['T']['data'])))

def molToVolume(params,results):
    try:
        nmol = params['nmol']
        pressure = params['pressure']
        RT = 62.36367 *params['temperature']
        volume = results[params['volume']]['data']

        molvolume = (RT * results[nmol]['data'])/(pressure)
        molvolume = molvolume * (volume/ 1000)
        
        return molvolume
        
    except Exception as e:
        print(e)
        print('molToVolume error ' + pressure + ' or ' + nmol)
        return np.zeros(int(len(results['T']['data'])))

def concentrationToVolume(params,results):
    try:
        volume = results[params['volume']]['data']
        concentration = results[params['concentration']]['data']
        
        
        nmoles = concentration * (volume/1000)
        gasVolume = (nmoles * 62.36367 * 310.15)/(760.0) 

        #gasVolume = (concentration * 62.36367 * 310.15)/(volume)  
        return gasVolume

    except Exception as e:
        print(e)
        print('totalBloodGasMoles error ' + volume)
        return np.zeros(int(len(results['T']['data'])))


# ██████ ██    ██  ██████ ██      ███████     ██████  ███████ ██████  ███████ ███    ██ ██████  ███████ ███    ██ ████████ 
#██       ██  ██  ██      ██      ██          ██   ██ ██      ██   ██ ██      ████   ██ ██   ██ ██      ████   ██    ██    
#██        ████   ██      ██      █████       ██   ██ █████   ██████  █████   ██ ██  ██ ██   ██ █████   ██ ██  ██    ██    
#██         ██    ██      ██      ██          ██   ██ ██      ██      ██      ██  ██ ██ ██   ██ ██      ██  ██ ██    ██    
# ██████    ██     ██████ ███████ ███████     ██████  ███████ ██      ███████ ██   ████ ██████  ███████ ██   ████    ██    

def _cycleBoundaries(cycleData, step):
    """Indices where a new cycle starts: cycleData < step, but at least 5 samples
    after the previous boundary (the legacy `idx - idxStart > 4` guard, which is
    sequential because the reference is the *last accepted* boundary). Candidates
    are sparse (one cluster per cycle reset) so this scan is cheap; it replaces the
    per-sample Python loops in the cycle ops with a vectorized segment computation."""
    cand = np.flatnonzero(np.asarray(cycleData) < step)
    bounds = []
    idxStart = 0
    for c in cand:
        c = int(c)
        if c - idxStart > 4:
            bounds.append(c)
            idxStart = c
    return bounds


def _fillCycleHeadTail(out, bounds):
    # tail [lastBoundary:] carries the last segment's value; head [0:firstBoundary]
    # is replaced by the first post-boundary segment value (legacy interpolation).
    out[bounds[-1]:] = out[bounds[-1] - 1]
    out[0:bounds[0]] = out[bounds[0] + 1]
    return out


def integralOverCycle(params,results):
    try:
        resultName = params['resultName']
        cycle = params['cycle']
        step = params['step']

        if (resultName in results.keys()) and (cycle in results.keys()):
            rd = np.asarray(results[resultName]['data'])
            out = np.zeros(len(rd))
            bounds = _cycleBoundaries(results[cycle]['data'], step)
            if not bounds:
                return out
            # pre[i] = sum_{0..i-1} rd * step ; segment [prev:b) integral excludes
            # the boundary sample (matches the legacy loop, which skips rd at the
            # boundary index): sum_{j=prev+1}^{b-1} rd*step = pre[b] - pre[prev+1].
            pre = np.concatenate(([0.0], np.cumsum(rd))) * step
            prev = 0
            for b in bounds:
                out[prev:b] = pre[b] - pre[prev + 1]
                prev = b
            return _fillCycleHeadTail(out, bounds)
        else:
            print('integralOverCycle warning ' + resultName + ' or ' + cycle)
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('integralOverCycle error ' + str(params.get('resultName')) + ' or ' + str(params.get('cycle')))
        return np.zeros(int(len(results['T']['data'])))
    
def variationOfIntegalValueOverCycle(params,results):
    try:
        resultName = params['resultName']
        cycle = params['cycle']
        step = params['step']

        if (resultName in results.keys()) and (cycle in results.keys()):
            rd = np.asarray(results[resultName]['data'])
            out = np.zeros(len(rd))
            bounds = _cycleBoundaries(results[cycle]['data'], step)
            if not bounds:
                return out
            # Per segment, the legacy loop records the running max of the in-cycle
            # cumulative integral, seeded with rd[prev]. The partial integral at
            # index j is pre[j]-pre[prev] (pre[i]=sum_{0..i-1} rd*step), so the max
            # over the segment is max(rd[prev], max(pre[prev+1:b+1]) - pre[prev]).
            pre = np.concatenate(([0.0], np.cumsum(rd))) * step
            prev = 0
            for b in bounds:
                segMax = np.max(pre[prev + 1:b + 1]) - pre[prev]
                out[prev:b] = max(rd[prev], segMax)
                prev = b
            return _fillCycleHeadTail(out, bounds)
        else:
            return []
    except Exception as e:
        print(e)
        print('variationOfIntegalValueOverCycle error ' + str(params.get('resultName')) + ' or ' + str(params.get('cycle')) + ' not found')
        return []

def variationOfValueOverCycle(params,results):
    try:
        resultName = params['resultName']
        cycle = params['cycle']
        step = params['step']

        if (resultName in results.keys()) and (cycle in results.keys()):
            rd = np.asarray(results[resultName]['data'])
            out = np.zeros(len(rd))
            bounds = _cycleBoundaries(results[cycle]['data'], step)
            if not bounds:
                return out
            # peak-to-peak over each cycle; the boundary sample is included in the
            # segment's max/min (the legacy loop updates currentMax/Min before the
            # boundary fill), so the range is over rd[prev:b+1].
            prev = 0
            for b in bounds:
                seg = rd[prev:b + 1]
                out[prev:b] = np.max(seg) - np.min(seg)
                prev = b
            return _fillCycleHeadTail(out, bounds)
        else:
            return []
    except Exception as e:
        print(e)
        print('variationOfValueOverCycle error ' + str(params.get('resultName')) + ' or ' + str(params.get('cycle')) + ' not found')
        return []


def valueOverCycle(params,results):
    # max || min || mean
    try:
        resultName = params['resultName']
        cycle = params['cycle']
        step = params['step']
        operation = params['operation']
        if (resultName in results.keys()) and (cycle in results.keys()):
            outputArray = np.zeros(int(len(results[resultName]['data'])))
            startIdx = 0
            
            if operation == 'max':
                currentMax = results[resultName]['data'][0]
                for idx, value in enumerate(results[resultName]['data']):
                    if value > currentMax:
                        currentMax = value
                    if results[cycle]['data'][idx] < step and (idx - startIdx > 4):
                        outputArray[startIdx:idx] = currentMax
                        startIdx = idx
                        currentMax = results[resultName]['data'][idx]
                outputArray[startIdx:] = outputArray[startIdx:] + outputArray[startIdx-1]
                return outputArray
            elif operation == 'min':
                currentMin = results[resultName]['data'][0]
                for idx, value in enumerate(results[resultName]['data']):
                    if value < currentMin:
                        currentMin = value
                    if results[cycle]['data'][idx] < step and (idx - startIdx > 4):
                        outputArray[startIdx:idx] = currentMin
                        startIdx = idx
                        currentMin = results[resultName]['data'][idx]
                outputArray[startIdx:] = outputArray[startIdx:] + outputArray[startIdx-1]
                return outputArray
            elif operation == 'mean':
                currentMean = results[resultName]['data'][0]
                for idx, value in enumerate(results[resultName]['data']):
                    currentMean += value
                    if results[cycle]['data'][idx] < step and (idx - startIdx > 4):
                        outputArray[startIdx:idx] = currentMean/(idx-startIdx)
                        startIdx = idx
                        currentMean = results[resultName]['data'][idx]
                outputArray[startIdx:] = outputArray[startIdx:] + outputArray[startIdx-1]
                return outputArray
        else:
            print('valueOverCycle warning' + resultName + ' or ' + cycle + ' not found')
            return np.zeros(int(len(results['T']['data'])))
    except Exception as e:
        print(e)
        print('valueOverCycle error' + resultName + ' or ' + cycle + ' not found')
        return np.zeros(int(len(results['T']['data'])))


#███    ███  ██████  ██████  ███████ ██          ███████ ██████  ███████  ██████ ██ ███████ ██  ██████ 
#████  ████ ██    ██ ██   ██ ██      ██          ██      ██   ██ ██      ██      ██ ██      ██ ██      
#██ ████ ██ ██    ██ ██   ██ █████   ██          ███████ ██████  █████   ██      ██ █████   ██ ██      
#██  ██  ██ ██    ██ ██   ██ ██      ██               ██ ██      ██      ██      ██ ██      ██ ██      
#██      ██  ██████  ██████  ███████ ███████     ███████ ██      ███████  ██████ ██ ██      ██  ██████ 


# Returns the compliance array of a capacitor using 'class ElastanceCapacitor' from equations
# use results from the simulation to recreate the compliance array
# id: capacitor id -> ex: P_Hl
def calculateCompliance(config,results,modelObjects):
    resultName = config['resultName']
    resultsForCalc = {key:value['data'] for key,value in results.items()}
    t = results['T']['data']

    res = modelObjects['capacitors'][resultName].elastance(t,resultsForCalc)
    return np.array(1/res)

def calculateSigmoidCompliance(config,results,modelObjects):
    resultName = config['resultName']
    resultsForCalc = {key:value['data'] for key,value in results.items()}

    res = modelObjects['capacitors'][resultName].sigmoid(resultsForCalc,modelObjects['constants'])
    return np.array(res)

def calculateSigmoidComplianceRange(config,results,modelObjects):
    resultName = config['resultName']
    tagToUse = config['tagToUse']
    start = config['start']
    end = config['end']
    
    resultsForCalc = {key:value['data'] for key,value in results.items()}

    step = (end-start)/len(resultsForCalc[tagToUse])
    resultsForCalc[tagToUse] = np.arange(start,end,step)
    resultsForCalc[tagToUse] = resultsForCalc[tagToUse][:len(resultsForCalc['T'])]

    res = modelObjects['capacitors'][resultName].sigmoid(resultsForCalc,modelObjects['constants'])
    return np.array(res)

def calculateSigmoid(config,results,modelObjects):
    resultName = config['resultName']
    resultsForCalc = {key:value['data'] for key,value in results.items()}

    res = modelObjects['other'][resultName].sigmoid(resultsForCalc,modelObjects['constants'])
    return np.array(res)

def calculateSigmoidRange(config,results,modelObjects):
    try:
        resultName = config['resultName']
        if resultName in modelObjects['other'].keys():
            tagToUse = modelObjects['other'][resultName].varToControlIdx
        elif resultName in modelObjects['parameterVariation'].keys():
            tagToUse = modelObjects['parameterVariation'][resultName].xAxis
        else:
            print('calculateSigmoidRange error --------------------')
            print('resultName not found in modelObjects')
            return np.zeros(int(len(results['T']['data'])))
        
        start = config['start']
        end = config['end']
        
        resultsForCalc = {key:value['data'] for key,value in results.items()}

        step = (end-start)/len(resultsForCalc[tagToUse])
        resultsForCalc[tagToUse] = np.arange(start,end,step)
        resultsForCalc[tagToUse] = resultsForCalc[tagToUse][:len(resultsForCalc['T'])]

        
        if resultName in modelObjects['other'].keys():
            res = modelObjects['other'][resultName].sigmoid(resultsForCalc,modelObjects['constants'])
        elif resultName in modelObjects['parameterVariation'].keys():
            res = modelObjects['parameterVariation'][resultName].sigmoid(resultsForCalc,modelObjects['constants'])
        
        
        return np.array(res)
    except Exception as e:
        print('calculateSigmoidRange error ----------- ' + resultName)
        print(e)
        return np.zeros(int(len(results['T']['data'])))
    
def calculateSigmoidRangeArray(config,results,modelObjects):
    try:
        '''
        resultName = config['resultName']
        tagToUse = modelObjects['other'][0].stateIdx
        print('tagToUse',tagToUse)


        resultsForCalc[tagToUse] = np.arange(start,end,step)
        resultsForCalc[tagToUse] = resultsForCalc[tagToUse][:len(resultsForCalc['T'])]

        '''

        start = config['start']
        end = config['end']
        step = (end-start)/len(results['T']['data'])
        result = np.arange(start,end,step)


        constants = modelObjects['constantList']
        eq = modelObjects['eqDict']['other'][0]
        amplitude = constants[eq.maxValue] - constants[eq.minValue]
        slope = constants[eq.slope]
        offset = constants[eq.minValue]

        res = amplitude / (1 + jnp.exp(-slope * (result - results['inflectionPoint_baroreceptor']['data']))) + offset

        
        return np.array(res)
    except Exception as e:
        print('calculateSigmoidRange error ----------- ')
        print(e)
        return np.zeros(int(len(results['T']['data'])))


# Returns the elastance array of a capacitor using 'class ElastanceCapacitor' from equations
# use results from the simulation to recreate the elastance array
# id: capacitor id -> ex: P_Hl
def calculateElastance(config,results,modelObjects):
    resultName = config['resultName']
    resultsForCalc = {key:value['data'] for key,value in results.items()}
    t = results['T']['data']

    res = modelObjects['capacitors'][resultName].elastance(t,resultsForCalc)
    return np.array(res)
  

# Returns the V0 array of a component using 'class CapacitorSelfBreathingThorax' from equations
# use results from the simulation to recreate the compliance array
def calculateThoraxUnstressedVolume(config,results,modelObjects):
    resultName = config['resultName']
    resultsForCalc = {key:value['data'] for key,value in results.items()}
    t = results['T']['data']
    res = modelObjects['capacitors'][resultName].v0(t,resultsForCalc)
    return np.array(res)

def calculateConcentrationInGas(config,results,modelObjects):
    pressureIn = results[config['pressureIn']]
    volumeIn = results[config['volumeIn']]
    temperature = config['temperatureIn']
    constR = config['R']
    n = (pressureIn * volumeIn) / (constR * temperature)
    c = n / volumeIn


    return np.array(c)