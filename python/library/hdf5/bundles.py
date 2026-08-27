"""Typed return containers for the HDF5 schema readers.

Dataclasses keep the read APIs self-documenting and decouple callers from the
on-disk layout. The web app uses the JSON payload dicts; Python callers use these.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class RunBundle:
    """A single simulation run (schema_sim)."""
    state_names:  list
    t:            np.ndarray
    raw:          dict                 # {var: np.ndarray}
    final_states: dict                 # {state: float}
    processed:    dict = field(default_factory=dict)   # {name: {out: np.ndarray}}
    metadata:     dict = field(default_factory=dict)    # root attrs
    model_structure: dict | None = None


@dataclass
class PopulationBundle:
    """A population of runs (schema_pop)."""
    param_names:       list
    state_names:       list
    observation_names: list
    sampled_params:    np.ndarray       # (N, P)
    final_states:      dict             # {state: np.ndarray}  length N
    conf:              dict = field(default_factory=dict)
    meta:              dict = field(default_factory=dict)
    problem:           dict = field(default_factory=dict)
    model_structure:   dict | None = None
    run_ids:           list = field(default_factory=list)

    @property
    def n_runs(self) -> int:
        return self.sampled_params.shape[0] if self.sampled_params is not None else 0


@dataclass
class CalibrationBundle:
    """An NN training set + calibration result (schema_calib)."""
    observation_names: list
    param_names:       list
    splits:            dict             # {'X_train': arr, 'y_train': arr, ...}
    scalers:           dict             # {'x': {'mean','scale'}, 'y': {...}}
    predictions:       dict = field(default_factory=dict)
    training_log:      object = None    # pd.DataFrame
    bootstrap:         object = None    # pd.DataFrame
    conf:              dict = field(default_factory=dict)
    meta:              dict = field(default_factory=dict)
    run_path:          str | None = None
