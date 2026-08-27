"""Single-run save / process / plot I/O helpers.

The "Result Handling" block that every single-run driver notebook used to paste
inline: write the run as a manuBeat-compatible HDF5 artifact, dump the source
configs, run the post-processing DAG, append the processed signals, and render
the configured plots. It lived byte-identical in every such notebook (currently
`run_cpet/run.ipynb`); it lives here (not inline per notebook) so all callers
share ONE set of functions and cannot drift apart.

It belongs in `run/` rather than `utils.py` because it is domain-coupled — it
wraps :mod:`library.hdf5.schema_sim` + :mod:`library.postproc.resultsEngine` +
:mod:`library.viz.plots` and knows the `simulationParams` / `model_structure`
shapes — and `utils.py` is the leaf those packages import (routing it there
would invert the dependency). See `.claude/rules/code-reuse.md`.
"""

import os

import library.utils as utils
from library.hdf5 import schema_sim
import library.postproc.resultsEngine as resultsEngine
import library.viz.plots as libPlots


def _runPath(simulationParams):
    out = simulationParams['hdf5File']
    return os.path.join(out['filePath'], out['fileName'])


def saveRun(simulationParams, results, states, modelStructure):
    """Write the raw simulation run as a manuBeat-compatible run artifact
    (hdf5.schema_sim): attrs + model_structure(JSON) + time + raw/{signal} +
    final_states(compound). Web-portable; no pickled Python objects."""
    stateNames = list(states.keys())
    signals = {k: v for k, v in results.items() if k != 'T'}
    returnFreq = (int(round(1 / simulationParams['dtDense']))
                  if simulationParams.get('dtDense') else 100)
    schema_sim.write_run_result(
        _runPath(simulationParams),
        runs=signals,
        t_axis=results['T'],
        state_names=stateNames,
        final_states=[float(states[k]) for k in stateNames],
        model_structure=utils.modelStructureJSON(modelStructure),
        run_params={'runTime': simulationParams['runTime'],
                    'dt': simulationParams['dt'] or 0,
                    'returnFrequency': returnFreq},
        config_id=simulationParams.get('modelFileName', ''),
    )


def saveConfig(simulationParams, runConfig, scenario):
    """Dump the SOURCE configs needed to re-mount this run from scratch into /config:
    the raw model JSON, the scenario JSON, metadata.json, and the post-processing
    config. (The run artifact's `model_structure` is the *mutated* runtime structure
    — a snapshot of what actually ran, incl. calibrated params; these are the inputs.)"""
    configs = {
        "model":    utils.loadJSONfile(utils.configPath("models", runConfig["model"])),
        "scenario": scenario,
        "metadata": utils.loadJSONfile(utils.configPath("metadata.json")),
    }
    pp = runConfig.get("postProcessing")
    if pp:
        configs["post_processing"] = utils.loadJSONfile(utils.configPath("processing", pp))
    schema_sim.append_config(
        _runPath(simulationParams), configs=configs,
        run_config=runConfig, mode=runConfig["mode"])


def saveProcessed(simulationParams, newResults, engine, name='cpet', names=None):
    """Append ONLY the pipeline-computed signals into /processed/<name>.

    Raw leaves pass through ResultsEngine unchanged and already live in raw/, so we
    save only the names the post-processing config actually defines/transforms
    (engine.order). Pass `names` to narrow it further (e.g. runConfig['requested'])."""
    names = names if names is not None else engine.order
    proc = {k: newResults[k] for k in names if k in newResults}
    schema_sim.append_processed(
        _runPath(simulationParams), name, proc,
        proc_config={'config': simulationParams['postProcessing'].get('filePath')},
        proc_config_name=simulationParams['postProcessing'].get('filePath') or '')


def processResults(simulationParams, results, modelObjects, modelStructure, requested=None):
    """Run the post-processing DAG engine (library/postproc/resultsEngine.py).

    requested=None computes every signal in the config; a list computes only those
    signals plus their transitive inputs (lazy). Returns (newResults, engine):
      newResults -> legacy {name: {'data','metadata'}} dict for plotResults
      engine     -> live ResultsEngine (engine.toPayload(...), engine.errors, ...)
    """
    filePath = utils.configPath('processing', simulationParams['postProcessing']['filePath'])
    dataProcessingConfig = utils.loadJSONfile(filePath)

    engine = resultsEngine.ResultsEngine(
        results, dataProcessingConfig, modelStructure, modelObjects=modelObjects)
    engine.evaluate(requested)

    if engine.errors:
        print(f'{len(engine.errors)} post-processing issue(s):')
        for name, op, reason in engine.errors[:20]:
            print(f'  [{op}] {name}: {reason}')

    nSignals = len(requested) if requested else len(engine.order)
    print(f'Post-processing done ({nSignals} signal(s))')
    return engine.assembleLegacy(), engine


def plotResults(simulationParams, newResults, modelStructure):
    if simulationParams['plotResults'] == True:
        for plotFile in simulationParams['plots']:
            filePath = utils.configPath('plots', plotFile)
            plotOptions = utils.loadJSONfile(filePath)
            libPlots.buildPlot(newResults, modelStructure, plotOptions)
