"""
[MEDICAL] Cardiopulmonary model routes — the web driver for python/library.

What this module computes, numbered:

  1. POST /cardio/run          — expands (model JSON, scenario JSON, mode, numeric
                                 overrides) into the library's simulationParams,
                                 solves the 0D lumped-parameter cardiopulmonary ODE
                                 on a worker thread, and writes the run artifact.
  2. GET  /cardio/status/{id}  — job state, the live convergence trace a
                                 calibration emits while it is still running, and
                                 the run's captured console output (plus the
                                 traceback, if it failed).
  3. GET  /cardio/result*      — the stored run as a JSON payload for the web app.
  4. POST /cardio/process/{id} — replays a post-processing config over a stored run
                                 through the ResultsEngine DAG and appends the
                                 outputs to the same artifact.
  5. GET/DELETE/POST /cardio/hdf5/*  — tree, dataset, delete and repack over the
                                 stored artifact, for the HDF Inspector page.

The library is imported, never reimplemented: `runner` owns orchestration,
`resultsEngine` owns post-processing, `schema_sim`/`engine` own persistence. Nothing
here contains physics, an integrator loop, or a hand-rolled HDF5 write — see
.claude/rules/model-stack.md.

Node/Python split: Node owns auth, owner-scoping and every Postgres read — it fetches
the model, scenario and processing configs and POSTs them in the request body; this
service holds no DB credentials and runs no queries. It does hold MinIO credentials,
the one documented deviation from the framework rule (docker-compose.yml explains
why), because run artifacts are streamed to object storage from here.
"""
import json
import os
import resource
import sys
import tempfile
import threading
import time
import traceback
import uuid
from contextlib import contextmanager
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, field_validator

import library.utils as utils
from library.hdf5 import engine, schema_sim
from library.model import modelGen
from library.postproc import resultsEngine
from library.run import runner

# ── MinIO client ───────────────────────────────────────────────────────────────
from minio import Minio

_minio = Minio(
    f"{os.environ.get('MINIO_ENDPOINT', 'minio')}:{os.environ.get('MINIO_PORT', '9000')}",
    access_key=os.environ.get("MINIO_USER", "minioadmin"),
    secret_key=os.environ.get("MINIO_PASSWORD", "minioadmin123"),
    secure=False,
)
_BUCKET = os.environ.get("MINIO_BUCKET", "uploads")

# ── In-memory job registry ─────────────────────────────────────────────────────
# { job_id: { status, run_id, mode, progress[], logs[], error?, duration_s?, ... } }
_jobs: dict[str, dict] = {}

# Cap on retained convergence lines per job. A long staged calibration emits one line
# every progressEvery simulated seconds; without a cap a runaway run would grow the
# registry unbounded. The tail is what a progress display wants anyway.
_MAX_PROGRESS_RECORDS = 500

# ── Console capture ────────────────────────────────────────────────────────────
# The library narrates through print(): the mode banner, per-run status, solver
# warnings. From the web that went to the container log only, where the caller who
# started the run cannot see it — a failed run showed up in the Simulator as a red
# badge and nothing else. These shims tee the calling thread's stdout/stderr into
# whatever sink is registered for that thread, so /status can hand the web app the
# same narration a terminal caller gets, while still writing through to the real
# stream (the container log is unchanged).
#
# Routing is per THREAD IDENT, not global: FastAPI runs each sync endpoint and each
# background task on its own worker thread, so two concurrent runs keep their output
# apart instead of interleaving into whichever one registered last. A thread with no
# sink — uvicorn's own, anything at import time — just passes through.

_MAX_LOG_LINES = 500

_log_sinks: dict[int, list] = {}


def _append_log(sink: list, text: str) -> None:
    """Append one console line, keeping only the tail. The list object never changes,
    so a job entry holding a reference to it sees the trim."""
    if not text.strip():
        return
    sink.append({"t": time.time(), "text": text.rstrip()})
    if len(sink) > _MAX_LOG_LINES:
        del sink[:-_MAX_LOG_LINES]


class _TeeStream:
    """sys.stdout / sys.stderr replacement that copies a captured thread's lines out."""

    def __init__(self, wrapped):
        self._wrapped = wrapped
        self._partial: dict[int, str] = {}

    def write(self, text: str) -> int:
        ident = threading.get_ident()
        sink = _log_sinks.get(ident)
        if sink is not None:
            # print() emits the value and the newline as separate write() calls, and
            # progress lines redraw themselves with \r, so buffer per thread until a
            # break: a stored record is always one whole line.
            buf = self._partial.get(ident, "") + text.replace("\r", "\n")
            *lines, self._partial[ident] = buf.split("\n")
            for line in lines:
                _append_log(sink, line)
        return self._wrapped.write(text)

    def flush(self) -> None:
        self._wrapped.flush()

    def release(self, ident: int, sink: Optional[list] = None) -> None:
        """Flush a finished thread's trailing partial line and forget the thread.

        The sink is passed in rather than looked up, so the caller can deregister the
        thread FIRST — a thread must never be left capturing into a stale sink.
        """
        tail = self._partial.pop(ident, "")
        if tail and sink is not None:
            _append_log(sink, tail)

    def __getattr__(self, name):        # isatty / encoding / fileno / …
        return getattr(self._wrapped, name)


# Guarded so a module reload cannot wrap an already-wrapped stream twice.
if not isinstance(sys.stdout, _TeeStream):
    sys.stdout = _TeeStream(sys.stdout)
if not isinstance(sys.stderr, _TeeStream):
    sys.stderr = _TeeStream(sys.stderr)


@contextmanager
def _capture_logs(sink: list):
    """Route everything this thread prints into `sink` for the duration."""
    ident = threading.get_ident()
    _log_sinks[ident] = sink
    try:
        yield sink
    finally:
        _log_sinks.pop(ident, None)
        sys.stdout.release(ident, sink)
        sys.stderr.release(ident, sink)


router = APIRouter(prefix="/cardio", tags=["cardio"])

_MODES = ("baseline", "calibration", "control")

# ── Request models ─────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    run_id: str                          # stable DB UUID from model_runs
    model_json: dict                     # model_configs.config — structure/physics
    scenario_json: dict                  # scenario_configs.config — values + stages
    mode: str = "baseline"               # baseline | calibration | control
    model_name: str = ""                 # provenance only, stored in /config
    scenario_name: str = ""              # provenance only, stored in /config
    simulation_params: dict = {}         # numeric overrides on top of the scenario

    # Node sends both configs as raw JSON TEXT straight out of Postgres (config::text)
    # rather than as parsed objects, and they are parsed HERE. JS has a single number
    # type, so a jsonb column read in Node collapses every integral float — 760.0 -> 760,
    # 1.0 -> 1 — and re-serialises them into the request as ints; for cpet.json that is
    # 636 values arriving with a different type than utils.loadJSONfile reads off disk.
    # Postgres keeps the decimal, so text + json.loads reproduces the disk types exactly.
    # A dict is still accepted: an inline unsaved scenario edited in the browser has been
    # through JS regardless, and older callers keep working.
    @field_validator("model_json", "scenario_json", mode="before")
    @classmethod
    def _parse_config_text(cls, value):
        return json.loads(value) if isinstance(value, str) else value

class ValidateRequest(BaseModel):
    model_json: dict

class ProcessRequest(BaseModel):
    proc_run_name:    str        # user-given label → HDF5 group key
    proc_config_id:   str        # stored as attr for provenance
    proc_config:      dict
    proc_config_name: str = ""   # human name of the proc config (stored as attr)

# ── MinIO helpers ──────────────────────────────────────────────────────────────

def _minio_key(run_id: str) -> str:
    return f"cardio/runs/{run_id}.hdf5"


def _upload_hdf5(run_id: str, tmp_path: str) -> None:
    _minio.fput_object(_BUCKET, _minio_key(run_id), tmp_path,
                       content_type="application/x-hdf5")


def _download_hdf5(run_id: str, tmp_path: str) -> None:
    _minio.fget_object(_BUCKET, _minio_key(run_id), tmp_path)


# ── runConfig assembly ─────────────────────────────────────────────────────────

def _build_run_config(req: RunRequest) -> dict:
    """The web equivalent of a driver script's runConfig dict.

    `runner.buildSimulationParams` is the ONE adapter from runConfig + scenario to the
    simulationParams the library consumes, so the route builds a runConfig rather than
    a simulationParams dict — the scenario stays canonical and only the keys the caller
    actually sent override it (the same precedence any caller gets).
    """
    sp = req.simulation_params or {}
    cfg = {
        # File references are provenance only here: the model and scenario arrive as
        # dicts from Postgres, not from config/. buildSimulationParams still wants a
        # `model` key, and it lands in the artifact's /config[run_config].
        "model":    req.model_name or "(database)",
        "scenario": req.scenario_name or "(database)",
        "mode":     req.mode,
        # Saving and plotting are the route's job, not the library's: the artifact goes
        # to MinIO below, and matplotlib is not installed in the API image.
        "output":   {"save": False, "path": "", "name": "", "logProgress": True},
        "plots":    [],
        # Post-processing is a separate endpoint against a stored run, so the run
        # itself never carries one.
        "postProcessing": None,
        # On by default here, unlike a bare library call: the console pane is the only window
        # a web caller has onto a run, and the per-stage/per-run lines are what make a
        # slow or diverging solve legible. Still overridable per run.
        "printStatus": bool(sp.get("printStatus", True)),
        # "legacy" (modelClass, diffrax.Euler only) or "SI" (modelClassSI, honours
        # solver.type). The scenario's own solver choice reaches the SI stack through
        # shared.integration.solver.
        "stack": sp.get("stack", "legacy"),
    }
    # Numeric overrides: present-only, so an untouched field keeps the scenario's value.
    for key in ("runTime", "dt", "dtDense", "progressEvery"):
        if sp.get(key) is not None:
            cfg[key] = sp[key]
    if sp.get("solver"):
        cfg["solver"] = sp["solver"]
    return cfg


def _assert_mode_supported(mode: str, scenario: dict) -> None:
    """Fail before the solve rather than with a KeyError three layers down."""
    if mode not in _MODES:
        raise ValueError(f"mode must be one of {_MODES}, got {mode!r}")
    if mode == "control" and not (scenario.get("control") or {}).get("stages"):
        raise ValueError("This scenario declares no control.stages — control mode "
                         "needs a control stage stack (only the cpet scenario has one).")
    if mode == "calibration" and not (scenario.get("calibration") or {}):
        raise ValueError("This scenario declares no calibration section.")
    if "shared" not in scenario or "integration" not in scenario.get("shared", {}):
        raise ValueError("Scenario is missing shared.integration (dt / runTime / "
                         "gasExchange / useEquilibriumStates).")


# ── Simulation thread ──────────────────────────────────────────────────────────

def _run_simulation(job_id: str, req: RunRequest) -> None:
    """Background-thread entry point: run one simulation with its console captured.

    The solve itself lives in _solve; this wrapper owns only the capture window, so
    every line the library prints between the two banners below reaches /status —
    and the Simulator's console pane — instead of only the container log.
    """
    job = _jobs[job_id]
    job["status"] = "running"
    t0 = time.time()
    with _capture_logs(job.setdefault("logs", [])):
        print(f"[web] {req.mode} run · model={req.model_name or '(database)'} "
              f"· scenario={req.scenario_name or '(database)'} · run_id={req.run_id}")
        _solve(job_id, req)
        print(f"[web] {job['status']} after {round(time.time() - t0, 2)} s")


def _solve(job_id: str, req: RunRequest) -> None:
    t0 = time.time()
    tmp_path = None
    try:
        _assert_mode_supported(req.mode, req.scenario_json)

        run_config = _build_run_config(req)
        simulationParams = runner.buildSimulationParams(run_config, req.scenario_json)

        # The model JSON comes from Postgres, not config/models/ — see the manuBeat
        # divergence note in modelClass.initialiseModel. Passed as a plain dict: the
        # list→ndarray coercion utils.loadJSONfile does only applies to TOP-LEVEL list
        # values, and neither a model nor a scenario JSON has any.
        simulationParams["modelStructure"] = req.model_json

        # Live convergence trace. Only fires for a calibration over a scenario that
        # declares convergence.observations (the sepsis and solver_compare scenarios);
        # everything else reports plain wall-clock lines to the container log.
        simulationParams["progress"]["onEmit"] = _progress_recorder(job_id)

        states, _modelObjects, modelStructure, results, _structures = \
            runner.run(simulationParams)

        # raw/ holds the signals; T is stored separately as the time vector. Mirrors
        # library/run/runIO.saveRun, which writes this exact artifact.
        signals     = {k: v for k, v in results.items() if k != "T"}
        state_names = list(states.keys())
        return_freq = (int(round(1 / simulationParams["dtDense"]))
                       if simulationParams.get("dtDense") else 100)
        duration    = round(time.time() - t0, 2)

        _, tmp_path = tempfile.mkstemp(suffix=".hdf5")
        schema_sim.write_run_result(
            tmp_path,
            runs            = signals,
            t_axis          = results["T"],
            state_names     = state_names,
            final_states    = [float(states[k]) for k in state_names],
            model_structure = utils.modelStructureJSON(modelStructure),
            run_params      = {"runTime":         simulationParams["runTime"],
                               "dt":              simulationParams["dt"] or 0,
                               "returnFrequency": return_freq},
            job_id          = job_id,
            config_id       = req.run_id,
        )
        # /config is the recipe (source inputs), distinct from model_structure (the
        # mutated structure that actually ran, calibrated params included). Storing it
        # makes the artifact self-describing and re-runnable.
        schema_sim.append_config(
            tmp_path,
            configs = {"model":    req.model_json,
                       "scenario": req.scenario_json,
                       "metadata": utils.loadJSONfile(utils.configPath("metadata.json"))},
            run_config = run_config,
            mode       = req.mode,
        )
        _upload_hdf5(req.run_id, tmp_path)

        file_size_bytes = os.path.getsize(tmp_path)
        # ru_maxrss is kilobytes on Linux
        max_rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)

        _jobs[job_id].update({
            "status":          "done",
            "duration_s":      duration,
            "state_count":     len(state_names),
            "minio_key":       _minio_key(req.run_id),
            "file_size_bytes": file_size_bytes,
            "max_rss_mb":      max_rss_mb,
        })

    except Exception:
        # Printed as well as stored: printing puts it in the captured console (and the
        # container log) in place, so the pane reads like a terminal session.
        traceback.print_exc()
        _jobs[job_id].update({
            "status": "error",
            "error":  traceback.format_exc(),
        })
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


def _progress_recorder(job_id: str):
    """Callback handed to ProgressReporter.emit — appends each convergence line to the
    job entry as it happens, so /cardio/status shows a calibration converging instead
    of an opaque 'running' for minutes. Bounded to the most recent lines."""
    def record(rec: dict) -> None:
        job = _jobs.get(job_id)
        if job is None:
            return
        trace = job.setdefault("progress", [])
        trace.append(rec)
        if len(trace) > _MAX_PROGRESS_RECORDS:
            del trace[:-_MAX_PROGRESS_RECORDS]
    return record


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/run")
def run_model(req: RunRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "pending", "run_id": req.run_id,
                     "mode": req.mode, "progress": []}
    background_tasks.add_task(_run_simulation, job_id, req)
    return {"job_id": job_id, "status": "pending"}


@router.get("/status/{job_id}")
def get_status(job_id: str):
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/result/{job_id}")
def get_result(job_id: str):
    """Load a run result via the in-memory job registry (used by the Simulator poller)."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"Job status is '{job['status']}'")
    run_id = job.get("run_id", job_id)
    return _read_result(run_id)


@router.get("/result-by-run/{run_id}")
def get_result_by_run(run_id: str):
    """
    Load a run result directly by DB run_id — does not require the in-memory
    job registry, so it works after a Python service restart.
    """
    return _read_result(run_id)


def _read_result(run_id: str) -> dict:
    tmp_path = None
    try:
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)
        return schema_sim.read_run_result(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.get("/configs")
def list_configs():
    """The model JSONs shipped on disk in config/models/. The app reads model_configs
    from Postgres instead; this is the disk view the seeds were generated from."""
    models_dir = utils.configPath("models")
    return [{"filename": fname,
             "name": fname.replace(".json", "").replace("_", " ")}
            for fname in sorted(os.listdir(models_dir)) if fname.endswith(".json")]


@router.get("/model/{filename}")
def get_model_file(filename: str):
    safe = os.path.basename(filename)
    path = utils.configPath("models", safe)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Model file '{safe}' not found")
    with open(path) as f:
        return json.load(f)


@router.get("/scenarios")
def list_scenarios():
    """The scenario JSONs shipped on disk in config/scenarios/ — disk counterpart of
    /configs, and the source the scenario_configs seeds were generated from."""
    scen_dir = utils.configPath("scenarios")
    return [{"filename": fname,
             "name": fname.replace(".json", "").replace("_", " ")}
            for fname in sorted(os.listdir(scen_dir)) if fname.endswith(".json")]


@router.get("/scenario/{filename}")
def get_scenario_file(filename: str):
    safe = os.path.basename(filename)
    path = utils.configPath("scenarios", safe)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Scenario file '{safe}' not found")
    with open(path) as f:
        return json.load(f)


@router.post("/validate")
def validate_model(req: ValidateRequest):
    required = ["configurations", "compartments", "connections", "states"]
    missing = [k for k in required if k not in req.model_json]
    if missing:
        return {"valid": False, "errors": [f"Missing top-level key: {k}" for k in missing]}
    return {"valid": True, "errors": []}


# ── HDF5 inspection routes (all use stable run_id) ────────────────────────────

@router.get("/hdf5/tree/{run_id}")
def hdf5_tree(run_id: str):
    """Return the full HDF5 file tree for a completed run."""
    tmp_path = None
    try:
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)
        return engine.get_tree(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.get("/hdf5/dataset/{run_id}")
def hdf5_dataset(
    run_id: str,
    path:  str           = Query(..., description="HDF5 dataset path, e.g. /raw/P_As"),
    start: Optional[int] = Query(None),
    end:   Optional[int] = Query(None),
):
    """Load a single dataset from a run HDF5 file."""
    tmp_path = None
    try:
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)
        return engine.get_dataset(tmp_path, path, start=start, end=end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


class DeleteDatasetRequest(BaseModel):
    path: str

@router.delete("/hdf5/dataset/{run_id}")
def hdf5_delete_dataset(run_id: str, req: DeleteDatasetRequest):
    """Delete a dataset from a run HDF5 file and re-upload."""
    tmp_path = None
    try:
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)
        engine.delete_dataset(tmp_path, req.path)
        _upload_hdf5(run_id, tmp_path)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.post("/hdf5/repack/{run_id}")
def hdf5_repack(run_id: str):
    """Download, repack (reclaim deleted space), and re-upload the HDF5 file."""
    tmp_path = None
    try:
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)
        engine.repack(tmp_path)
        _upload_hdf5(run_id, tmp_path)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.get("/processed-groups/{run_id}")
def get_processed_groups(run_id: str):
    """Return the user-given names of all processing runs stored in /processed/."""
    tmp_path = None
    try:
        import h5py as h5
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)
        with h5.File(tmp_path, 'r') as f:
            group_names = list(f.get('processed', {}).keys())
        return {"group_names": group_names}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.get("/processed/{run_id}/{proc_name}")
def get_processed_outputs(run_id: str, proc_name: str):
    """Return all output arrays for a named processing run as { outputs: { key: [float] } }."""
    tmp_path = None
    try:
        import h5py as h5
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)
        outputs: dict = {}
        with h5.File(tmp_path, 'r') as f:
            grp_path = f'processed/{proc_name}'
            if grp_path not in f:
                raise HTTPException(status_code=404, detail=f"Processed group '{proc_name}' not found")
            grp = f[grp_path]
            for key in grp:
                node = grp[key]
                if isinstance(node, h5.Dataset):
                    outputs[key] = node[()].tolist()
        return {"outputs": outputs}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.post("/process/{run_id}")
def process_run(run_id: str, req: ProcessRequest):
    """
    Apply a post-processing config to a completed run and append the results into
    /processed/{proc_run_name}/ in the same HDF5 file.

    The config is replayed through the ResultsEngine DAG — the same engine
    runIO.processResults drives — so a signal computed here and one computed
    straight off the library come out identical.

    Unlike a run this is synchronous, so there is no job registry to park the console
    in: the captured lines ride back on the response instead (and inside the error
    detail when it fails), which is what the Simulator's console pane reads.
    """
    logs: list[dict] = []
    with _capture_logs(logs):
        print(f"[web] post-processing '{req.proc_run_name}' with config "
              f"'{req.proc_config_name or req.proc_config_id}' on run {run_id}")
        try:
            payload = _process_run(run_id, req)
        except HTTPException:
            raise
        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=500, detail={
                "error":     str(e),
                "traceback": traceback.format_exc(),
                "logs":      logs,
            })
        print(f"[web] post-processing done · {len(payload['outputs'])} outputs")
    return {**payload, "logs": logs}


def _process_run(run_id: str, req: ProcessRequest) -> dict:
    tmp_path = None
    try:
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)

        model_structure = json.loads(
            engine.get_dataset(tmp_path, '/model_structure')['data'])

        # ResultsEngine reads the raw store as a flat {name: array} dict and needs T
        # in it (it sizes the signal store from T); the artifact keeps T out of raw/
        # and stores it as the time vector, so put it back.
        import h5py as h5
        with h5.File(tmp_path, 'r') as f:
            raw_signals = {name: f['raw'][name][()] for name in f['raw']}
            raw_signals['T'] = f['time'][()]

        # A handful of processing ops (compliance, sigmoid ranges) read the live
        # equation objects rather than arrays. Rebuilding them from the stored
        # structure is what makes processing replayable long after the run.
        # initModelObjectsNewGasExchange branches internally on the structure's
        # gasExchange flag, so it covers both the gas and no-gas builds.
        _states, modelObjects, _structures = \
            modelGen.initModelObjectsNewGasExchange(model_structure)

        proc_engine = resultsEngine.ResultsEngine(
            raw_signals, req.proc_config, model_structure, modelObjects=modelObjects)
        proc_engine.evaluate()
        assembled = proc_engine.assembleLegacy()

        # Raw leaves pass through the engine untouched and already live in raw/, so
        # store only the names the config actually defines — engine.order is exactly
        # that set, in first-seen order (mirrors runIO.saveProcessed).
        proc_output = {k: assembled[k] for k in proc_engine.order if k in assembled}

        schema_sim.append_processed(
            tmp_path, req.proc_run_name, proc_output,
            proc_config      = req.proc_config,
            proc_config_id   = req.proc_config_id,
            proc_config_name = req.proc_config_name,
        )
        _upload_hdf5(run_id, tmp_path)
        return {"ok": True, "proc_name": req.proc_run_name,
                "proc_config_id": req.proc_config_id,
                "outputs": list(proc_output),
                "errors": [{"name": n, "op": o, "reason": r}
                           for n, o, r in proc_engine.errors]}

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
