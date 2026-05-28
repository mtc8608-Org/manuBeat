import numpy as np
import random
import json

# ── Unit conversions ──────────────────────────────────────────────────────────

def paTOmmHg(value):
    return value * 0.0075006156130264

def mmHgTOPa(value):
    return value * 133.3223900000007

def mmHgTOCmH2O(value):
    return value * 1.359511

def cmH2OTOmmHg(value):
    return value * 0.735559

def paTOcmH2O(value):
    return value * 0.0101972

def cmH2OTOPa(value):
    return value * 98.0665

def mmHgTOmolml(value):
    return value / (62.36367 * 310.15)

# ── JSON I/O ──────────────────────────────────────────────────────────────────

def createJSONfile(modelStructure, fileName, indent=4):
    newStructure = {}
    for key, value in modelStructure.items():
        newStructure[key] = value.tolist() if isinstance(value, np.ndarray) else value
    with open(fileName + '.json', 'w') as f:
        json.dump(newStructure, f, indent=indent)


def loadJSONfile(fileName):
    with open(fileName) as f:
        structure = json.load(f)
    for key, value in structure.items():
        if isinstance(value, list) and not all(isinstance(e, str) for e in value):
            structure[key] = np.array(value)
    return structure


def loadModelStructure(structureFilePath, metadataFilePath):
    model_structure = loadJSONfile(structureFilePath)
    metadata = loadJSONfile(metadataFilePath)
    model_structure['data'] = metadata['data']
    model_structure['gasRegions'] = metadata['gasRegions']
    return model_structure

# ── Misc ──────────────────────────────────────────────────────────────────────

def random_sum_to_1(n):
    rand_nums = sorted([random.random() for _ in range(n - 1)])
    rand_nums = [0] + rand_nums + [1]
    return [rand_nums[i + 1] - rand_nums[i] for i in range(n)]


def sigmoid(x, a, b, c, d):
    return (a / (1 + np.exp(-b * (x - c)))) + d


def compareDicts(dict1, dict2):
    for key in dict1:
        if key not in dict2:
            print('key not found', key)
            continue
        if not np.array_equal(dict1[key], dict2[key]):
            print(key, dict1[key], dict2[key])
    print('comparison done')


def findKeyInDictionaryReturnValue(name, dictionary):
    for key, value in dictionary.items():
        if key == name:
            return value


def findStrInDictionaryAndAddPrefix(name, dictionary, prefix=''):
    for key, value in dictionary.items():
        if key == name:
            return prefix + value
    raise KeyError(f"'{name}' not found in dictionary")
