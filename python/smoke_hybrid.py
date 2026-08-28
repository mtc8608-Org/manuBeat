"""Smoke: hybrid-only calibratorUpdater (controllerLaw + adaptive strategy removed).

Tier 0 (imports) + a gain-algebra check on the migrated sepsis_linear stage, then
Tier 2: one short legacy calibration and one short SI calibration on smoketest.json.

Temporary file — delete after the run.
"""
import time
import numpy as np
import jax

jax.config.update("jax_enable_x64", True)

import library.utils as utils
import library.run.runner as runner
import library.run.runnerBatchSI as runnerBatchSI   # imports calibratorUpdater from runner

# -- Tier 0: the removed names are gone, the kept ones import ------------------
assert not hasattr(runner, "resolveStages"), "resolveStages should be deleted"
assert not hasattr(runner, "buildAdaptiveStages"), "buildAdaptiveStages should be deleted"
print("tier0: imports ok, adaptive strategy selector removed")

# -- Gain algebra: the migrated sepsis_linear stage must still drive the LINEAR leg --
scen = utils.loadScenario("sepsis_linear.json")
stage = scen["calibration"]["stages"][2]          # was multiplierC 0.25 under controllerLaw "linear"
assert "controllerLaw" not in scen["calibration"]
assert "strategy" not in scen["calibration"] and "adaptive" not in scen["calibration"]
assert stage["multiplierC"] == 0.0 and stage["multiplierL"] == 0.25, stage

param = "R_Ap_Cp"
seedStruct = {"calibration": {param: {"params": {
    "cubicFactor": 2.0, "linearFactor": 3.0, "k": 0.1, "targetValue": 42.0}}}}
live = {param: {"params": dict(seedStruct["calibration"][param]["params"])}}
runner.calibratorUpdater(stage, 1, live, seedStruct,
                         maxCubicFactor=10.0, maxLinearFactor=1.0)
p = live[param]["params"]
assert p["cubicFactor"] == 0.0, p
assert abs(p["linearFactor"] - 0.25 * 3.0) < 1e-12, p
print(f"gains: cubicFactor={p['cubicFactor']}  linearFactor={p['linearFactor']} (0.25 x 3.0) ok")

# A stage that omits multiplierL must default it to 0.0 (pure cubic), not crash.
bare = {"multiplierC": 1.0, "parameters": [param], "targets": {}, "states": {}}
live = {param: {"params": dict(seedStruct["calibration"][param]["params"])}}
runner.calibratorUpdater(bare, 1, live, seedStruct, maxCubicFactor=10.0, maxLinearFactor=1.0)
p = live[param]["params"]
assert p["cubicFactor"] == 2.0 and p["linearFactor"] == 0.0, p
print("defaults: absent multiplierL -> 0.0 (pure cubic) ok")


def solve(label, extra):
    scenario = utils.loadScenario("smoketest.json")
    runConfig = {"model": "cvModel_linear.json", "scenario": "smoketest.json",
                 "mode": "calibration",
                 "output": {"save": False, "path": "smokeData", "name": "smoke"},
                 "postProcessing": None, "plots": [], "printStatus": False, **extra}
    sp = runner.buildSimulationParams(runConfig, scenario)
    t = time.time()
    states, _, _, results, _ = runner.run(sp)
    wall = time.time() - t
    T = np.asarray(results["T"])
    finite = all(np.all(np.isfinite(np.asarray(v))) for v in results.values())
    assert finite, f"{label}: non-finite output"
    print(f"{label}: wall={wall:.2f}s  nPts={len(T)}  nSignals={len(results)}  "
          f"T={T[0]:.2f}..{T[-1]:.2f}  finite=True")


solve("tier2 legacy calibration", {})
solve("tier2 SI calibration", {"stack": "SI", "solver": {"type": "euler"}})
print("SMOKE OK")
