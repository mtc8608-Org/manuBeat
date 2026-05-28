"""
Cardio-pulmonary model routes.
POST /cardio/run kicks off async computation; results are stored in MinIO as HDF5.
The minio key is built from run_id (the stable DB UUID) so it survives Python restarts.
"""
import json
import os
import resource
import tempfile
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import numpy as np
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

from .cardio import model as cardio_model
from .cardio import model_generator, utils
from . import hdf5_engine as engine

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
# { job_id: { status, run_id, error?, duration_s?, state_count? } }
_jobs: dict[str, dict] = {}
_executor = ThreadPoolExecutor(max_workers=2)

router = APIRouter(prefix="/cardio", tags=["cardio"])

# ── Request models ─────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    run_id: str                  # stable DB UUID from model_runs table
    model_json: dict
    simulation_params: dict

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


# ── Simulation thread ──────────────────────────────────────────────────────────

def _run_simulation(job_id: str, run_id: str,
                    model_json: dict, simulation_params: dict) -> None:
    _jobs[job_id]["status"] = "running"
    t0 = time.time()
    tmp_path = None
    try:
        import jax.numpy as jnp

        params = {
            "modelFileName":   simulation_params.get("modelFileName", "model_Hr_test.json"),
            "runTime":         float(simulation_params.get("runTime", 10)),
            "runsToIgnore":    int(simulation_params.get("runsToIgnore", 0)),
            "runsToSave":      int(simulation_params.get("runsToSave", 1)),
            "printStatus":     bool(simulation_params.get("printStatus", False)),
            "calibration":     simulation_params.get("calibration", {}),
            "returnFrequency": int(simulation_params.get("returnFrequency", 100)),
            "dt":              float(simulation_params.get("dt0", simulation_params.get("dt", 0.001))),
        }

        if model_json:
            metadata = utils.loadJSONfile(
                os.path.join(os.path.dirname(__file__), "cardio", "configs", "metadata.json")
            )
            model_structure = {**model_json}
            model_structure['data'] = metadata['data']
            model_structure['gasRegions'] = metadata['gasRegions']
            model_structure['configurations']['simulationParameters']['calibration'] = params['calibration']
        else:
            model_structure = cardio_model.initialiseModel(params)
        eqDict, namesDict, modelDataDict = cardio_model.prepareModel(params, model_structure)
        cpModel = cardio_model.CardioPulmonaryModelArray(eqDict, namesDict, model_structure)

        initial_states = modelDataDict["initialStates"]
        constants      = modelDataDict["constantList"]
        states_arr     = jnp.array(initial_states, dtype=float)
        constants_arr  = jnp.array(constants, dtype=float)

        runsRes, final_states = cardio_model.runSimulationArray(
            states_arr, cpModel, params, {},
            modelDataDict["structures"], constants_arr,
        )

        state_names = namesDict["stateNames"]
        n_samples   = len(list(runsRes.values())[0])
        total_time  = params["runsToSave"] * params["runTime"]
        t_axis      = np.linspace(0.0, total_time, n_samples)
        duration    = round(time.time() - t0, 2)

        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        engine.write_run_result(
            tmp_path             = tmp_path,
            job_id               = job_id,
            config_id            = run_id,
            runsRes              = runsRes,
            t_axis               = t_axis,
            state_names          = state_names,
            final_states         = final_states,
            model_structure_json = json.dumps(model_structure),
            run_params           = params,
        )
        _upload_hdf5(run_id, tmp_path)

        file_size_bytes = os.path.getsize(tmp_path)
        # ru_maxrss is kilobytes on Linux
        max_rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)

        _jobs[job_id].update({
            "status":          "done",
            "duration_s":      duration,
            "state_count":     len(state_names),
            "minio_key":       _minio_key(run_id),
            "file_size_bytes": file_size_bytes,
            "max_rss_mb":      max_rss_mb,
        })

    except Exception:
        _jobs[job_id].update({
            "status": "error",
            "error":  traceback.format_exc(),
        })
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/run")
def run_model(req: RunRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "pending", "run_id": req.run_id}
    background_tasks.add_task(
        _run_simulation, job_id, req.run_id, req.model_json, req.simulation_params
    )
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
        return engine.read_run_result(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.get("/configs")
def list_configs():
    configs_dir = os.path.join(os.path.dirname(__file__), "cardio", "configs")
    configs = []
    for fname in os.listdir(configs_dir):
        if fname.startswith("model_") and fname.endswith(".json"):
            configs.append({
                "filename": fname,
                "name": fname.replace("model_", "").replace(".json", "").replace("_", " ").title(),
            })
    return configs


@router.get("/model/{filename}")
def get_model_file(filename: str):
    safe = os.path.basename(filename)
    path = os.path.join(os.path.dirname(__file__), "cardio", "configs", safe)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Model file '{safe}' not found")
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
    Apply a post-processing config to a completed run and append results
    into /processed/{proc_config_id}/ in the same HDF5 file.
    """
    from .cardio import data_processing as dp

    tmp_path = None
    try:
        _, tmp_path = tempfile.mkstemp(suffix='.hdf5')
        _download_hdf5(run_id, tmp_path)

        model_structure_raw = engine.get_dataset(tmp_path, '/model_structure')
        model_structure = json.loads(model_structure_raw['data'])

        import h5py as h5
        runsRes = {}
        with h5.File(tmp_path, 'r') as f:
            for name in f['raw']:
                runsRes[name] = f['raw'][name][()]

        _, modelObjects, _ = model_generator.initModelObjects(model_structure)
        proc_output = dp.processVariables(
            runsRes, modelObjects, req.proc_config, model_structure
        )
        # Keep only variables explicitly defined as outputs in the proc config
        # (new variables and altered raw states alike), not untouched raw states.
        config_output_keys = {key for stage in req.proc_config.values() for key in stage}
        proc_output = {k: v for k, v in proc_output.items() if k in config_output_keys}

        engine.append_processed(
            tmp_path         = tmp_path,
            proc_name        = req.proc_run_name,
            proc_config_id   = req.proc_config_id,
            proc_output      = proc_output,
            proc_config_json = json.dumps(req.proc_config),
            proc_config_name = req.proc_config_name,
        )
        _upload_hdf5(run_id, tmp_path)
        return {"ok": True, "proc_name": req.proc_run_name, "proc_config_id": req.proc_config_id}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
