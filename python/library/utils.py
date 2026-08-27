import numpy as np
import random
import json
import os

# Project root is the parent of the library package (utils.py lives in it).
# Deriving from __file__ keeps config lookups robust regardless of the working dir.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(PROJECT_ROOT, 'config')


def configPath(*parts):
    """Resolve a path under the top-level config/ dir, e.g.
    configPath('models', 'cpet.json') -> <root>/config/models/cpet.json."""
    return os.path.join(CONFIG_DIR, *parts)


# ── Display labels (name -> LaTeX / plain / unit) ────────────────────────────────
# Single source of truth: config/labels.json. The equivalent of My-ICU-Twin's
# paper_label dict + paper_name() accessor, made data-driven so the same mapping
# drives paper tables, notebook plots, model plots, and the web payload.
_LABELS_CACHE = None


def _loadLabels():
    global _LABELS_CACHE
    if _LABELS_CACHE is None:
        try:
            with open(configPath('labels.json')) as f:
                _LABELS_CACHE = json.load(f)
        except FileNotFoundError:
            _LABELS_CACHE = {}
    return _LABELS_CACHE


def labelFor(name, fmt='latex', default=None):
    """Display label for a model-generated variable name.

    fmt is 'latex', 'plain' or 'unit'. Falls back to `default` if given, else the
    raw `name` (so unmapped variables still render). Mirrors paper_name(var)."""
    entry = _loadLabels().get(name)
    if isinstance(entry, dict) and entry.get(fmt):
        return entry[fmt]
    return default if default is not None else name


def labelsFor(names, fmt='latex'):
    """labelFor mapped over an iterable of names."""
    return [labelFor(n, fmt) for n in names]

def getColors(nrColors,type = 'random'):
    colors = []
    if type == 'random':
        for i in np.arange(0,nrColors):
            colors.append('#%06X' % random.randint(0, 0xFFFFFF))
    elif type == 'scaleBlue':
        for i in np.arange(0,nrColors):
            colors.append('#%02X%02X%02X' % (0, 0, int(255/nrColors*i)))

    return colors


#██    ██ ███    ██ ██ ████████      ██████  ██████  ███    ██ ██    ██ ███████ ██████  ███████ ██  ██████  ███    ██ ███████
#██    ██ ████   ██ ██    ██        ██      ██    ██ ████   ██ ██    ██ ██      ██   ██ ██      ██ ██    ██ ████   ██ ██
#██    ██ ██ ██  ██ ██    ██        ██      ██    ██ ██ ██  ██ ██    ██ █████   ██████  ███████ ██ ██    ██ ██ ██  ██ ███████
#██    ██ ██  ██ ██ ██    ██        ██      ██    ██ ██  ██ ██  ██  ██  ██      ██   ██      ██ ██ ██    ██ ██  ██ ██      ██
# ██████  ██   ████ ██    ██         ██████  ██████  ██   ████   ████   ███████ ██   ██ ███████ ██  ██████  ██   ████ ███████

def paTOmmHg (value):
    return value * 0.0075006156130264

def mmHgTOPa (value):
    return value * 133.3223900000007

#TODO: check this conversion
def mmHgTOCmH2O (value):
    return value * 1.359511

#TODO: check this conversion
def cmH2OTOmmHg (value):
    return value * 0.735559

#TODO: check this conversion
def paTOcmH2O (value):
    return value * 0.0101972

#TODO: check this conversion
def cmH2OTOPa (value):
    return value * 98.0665

def mmHgTOmolml (value):
    # [C] = P / (R * T)
    result = value / (62.36367 * 310.15)
    return result

#     ██ ███████  ██████  ███    ██
#     ██ ██      ██    ██ ████   ██
#     ██ ███████ ██    ██ ██ ██  ██
#██   ██      ██ ██    ██ ██  ██ ██
# █████  ███████  ██████  ██   ████

# json.dumps default= coercion: ndarray/jax scalars -> list, anything else -> str.
def _jsonDefault(o):
    return o.tolist() if hasattr(o, "tolist") else str(o)


# Serialise a modelStructure dict to a JSON string, coercing numpy/jax arrays and
# scalars to plain python. Used to stash the structure alongside run results.
def modelStructureJSON(modelStructure):
    return json.dumps(modelStructure, default=_jsonDefault)


# Load a scenario JSON by name from config/scenarios/.
def loadScenario(name):
    return loadJSONfile(configPath("scenarios", name))


# load a JSON file and parse it into a dictionary. If a value of a key is list, convert to ndarray
def loadJSONfile(fileName):
    with open(fileName) as json_file:
        modelStructure = json.load(json_file)

    for key,value in modelStructure.items():
        if isinstance(value, list):
            if all(isinstance(element, str) for element in value):
                pass
            else:
                modelStructure[key] = np.array(value)

    return modelStructure

# Load model structure AND metadata and merge
def loadModelStructure(structureFilePath, metadataFilePath):

    model_structure = loadJSONfile(structureFilePath)
    metadata = loadJSONfile(metadataFilePath)

    model_structure['data'] = metadata['data']
    model_structure['gasRegions'] = metadata['gasRegions']

    return model_structure


#██       █████  ████████ ███████ ██   ██
#██      ██   ██    ██    ██       ██ ██
#██      ███████    ██    █████     ███
#██      ██   ██    ██    ██       ██ ██
#███████ ██   ██    ██    ███████ ██   ██

def generate_latex_table_new(data_dict, column_names,header,name,ref,caption,colSpec=None):
    # Begin the LaTeX table environment
    latex_table ="\\begin{table}\n"
    latex_table +="\\centering\n"
    # colSpec overrides the all-centred default, for tables whose cells are prose and must wrap
    latex_table += "\\begin{tabular}{" + (colSpec or
                   ("|" + "|".join(["c"] * len(column_names)) + "|")) + "}\n"
    latex_table += "\\hline\n"

    # Add the column names as the table header
    latex_table +=  " & ".join(map(str, column_names)) + " \\\\ \\hline \n"

    # Iterate through the dictionary and populate the table
    # convert values in array from float64 to float
    for key, values in data_dict.items():
        #values = ["{:.2e}".format(value*100) for value in values]
        #values = [np.round(float(value)*100,2) for value in values]
        row = [key]
        for value in values:
            if type(value)==str:
                row += [value]
                pass
            else:
                #row += ["{:.2e}".format(value*100)]
                row += [str(value)]
                

        #row = [key] + values

        latex_table += " & ".join(map(str, row)) + " \\\\\n"
        latex_table += "\\hline\n"

    # End the LaTeX table environment
    latex_table += "\\end{tabular}\n"

    latex_table += "\\caption{\\label{table:"+ref+"} "+caption+"}\n"
    latex_table += "\\end{table}"

    # replace underscores with latex underscore
    #latex_table = latex_table.replace("_", "\_")

    return latex_table


def generateLatexTableInline(data_dict, column_names, ref, caption,
                             colSpec=None, fontSize="small", ruleRows=None,
                             unbreakable=True):
    """LaTeX table as a NON-float brace group (booktabs + \\captionof).

    The float emitter above (`generate_latex_table_new`) produces a real
    `\\begin{table}`, which LaTeX refuses inside a `multicols` environment. Main-text
    tables in the paper are therefore written as a brace group with
    `\\captionsetup{type=table}` + `\\captionof{table}{...}`; this emits that shape so a
    generated table can be `\\input` into the two-column body.

    Args:
        data_dict:    {rowLabel: [cell, ...]} - the first column is the key.
        column_names: full header row, including the label column.
        ref:          the FULL label (e.g. "tab:techniqueComparison"); unlike the float
                      emitter, no "table:" prefix is added.
        caption:      caption text (no trailing label).
        colSpec:      tabular column spec; default "l" + "c" * (nCols - 1).
        fontSize:     LaTeX size command applied inside the group ("" to disable).
        ruleRows:     row labels after which to draw a `\\midrule` (section separators).
        unbreakable:  wrap the body in a `minipage` so the tabular and its `\\captionof`
                      can never be split by a column/page break (a plain brace group
                      breaks between the two, orphaning the caption). False emits the
                      bare group.

    Returns:
        The LaTeX source as a string.
    """
    nCols   = len(column_names)
    colSpec = colSpec or ("l" + "c" * (nCols - 1))
    ruleRows = set(ruleRows or ())

    out  = "{\\vspace{1em}\n"
    if unbreakable:
        # \noindent: a minipage opening a paragraph inherits \parindent, which pushes a
        # \linewidth box past the column edge (a ~15pt overfull hbox in the two-column body).
        out += "    \\noindent\\begin{minipage}{\\linewidth}\n"
    if fontSize:
        out += f"    \\{fontSize}\n"
    out += "    \\centering\n"
    out += "    \\begin{tabular}{" + colSpec + "}\n"
    out += "    \\toprule\n"
    out += "    " + " & ".join(map(str, column_names)) + " \\\\\n"
    out += "    \\midrule\n"

    for key, values in data_dict.items():
        row = [str(key)] + [str(v) for v in values]
        out += "    " + " & ".join(row) + " \\\\\n"
        if key in ruleRows:
            out += "    \\midrule\n"

    out += "    \\bottomrule\n"
    out += "    \\end{tabular}\n"
    out += "    \\captionsetup{type=table}\n"
    out += "    \\captionsetup{justification=justified}\n"
    out += "    \\captionof{table}{" + caption + "}\n"
    out += "    \\label{" + ref + "}\n"
    if unbreakable:
        out += "    \\end{minipage}\n"
    out += "\\vspace{1em}}\n"

    return out

# ██████  ████████ ██   ██ ███████ ██████
#██    ██    ██    ██   ██ ██      ██   ██
#██    ██    ██    ███████ █████   ██████
#██    ██    ██    ██   ██ ██      ██   ██
# ██████     ██    ██   ██ ███████ ██   ██

def findStrInDictionaryAndAddPrefix(name, dictionary, prefix = ''):
    for key,value in dictionary.items():
        if key == name:
            newName = prefix + value
            break
    return newName

def findKeyInDictionaryReturnValue(name, dictionary):
    for key,value in dictionary.items():
        if key == name:
            return value

#███    ███  █████  ████████ ██   ██ ███████
#████  ████ ██   ██    ██    ██   ██ ██
#██ ████ ██ ███████    ██    ███████ ███████
#██  ██  ██ ██   ██    ██    ██   ██      ██
#██      ██ ██   ██    ██    ██   ██ ███████

# calculates a sigmoid function
# a = amplitude, b = steepness, c = inflection point, d = vertical shift, x = variable
def sigmoid(x, a, b, c, d):
    return (a / (1 + np.exp(-b * (x - c)))) + d


# ██████  ██████  ███████ ███████ ██████  ██    ██
#██    ██ ██   ██ ██      ██      ██   ██ ██    ██
#██    ██ ██████  ███████ █████   ██████  ██    ██
#██    ██ ██   ██      ██ ██      ██   ██  ██  ██
# ██████  ██████  ███████ ███████ ██   ██   ████

# Atmospheric offset baked into absolute-pressure signals: gauge = raw - offset.
# atm is the run's atmospheric pressure (runConfig["analysis"]["atm"]).
def obsOffset(name, atm):
    return atm if ("_P_" in name and not name.startswith("amp_")) else 0.0


# Gauge steady-state of an observation: last sample minus its atmospheric offset.
def steadyState(results, name, atm):
    return float(np.asarray(results[name]).flat[-1]) - obsOffset(name, atm)


# Symmetric/asymmetric clamp of value into [lo, hi].
def clamp(value, lo, hi):
    return max(lo, min(hi, value))


# Strip a trailing error suffix from a variable name (e.g. avg_P_As_error_rel -> avg_P_As).
def baseVarName(name, suffixes=("_error_rel", "_error")):
    for s in suffixes:
        if name.endswith(s):
            return name[: -len(s)]
    return name


# Robust y-axis limits from data: percentile-based, nan/inf-safe, with fractional
# padding and an optional symmetric-about-zero mode.
def robustYLim(y, p=(1, 99), padFrac=0.08, symmetric=False):
    y = np.asarray(y, dtype=float).ravel()
    y = y[np.isfinite(y)]
    if y.size == 0:
        return (-1.0, 1.0)
    lo, hi = np.percentile(y, p)
    if symmetric:
        m = max(abs(lo), abs(hi))
        lo, hi = -m, m
    span = hi - lo
    if span == 0:
        span = abs(hi) if hi != 0 else 1.0
    pad = padFrac * span
    return (float(lo - pad), float(hi + pad))


# Gelman-Rubin split-R-hat over an ensemble of chains: x is (nSteps, nChains) samples of ONE
# scalar quantity. Returns sqrt(vhat/W); ~1.0 = mixed, >1.05 = the chains still disagree.
# NaN when there is too little history (n < 2 or m < 2) or the within-chain variance is zero.
def splitRhat(x):
    x = np.asarray(x, dtype=float)
    n, m = x.shape
    if n < 2 or m < 2:
        return np.nan
    W = x.var(0, ddof=1).mean()
    B = n * x.mean(0).var(ddof=1)
    vhat = (n - 1) / n * W + B / n
    return float(np.sqrt(vhat / W)) if W > 0 else np.nan











