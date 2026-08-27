#!/usr/bin/env python3
"""[MEDICAL] Generate init-scripts/seed-physiology.sql from python/config/**.

    python3 scripts/gen-physiology-seed.py

Disk is canonical: the notebooks (python/run_*/) read config/ directly through
library/utils.configPath, and the seeded rows are the web app's editable copies.
Re-run whenever a shipped config JSON is added or changed, and commit both.

Every INSERT is ON CONFLICT (id) DO NOTHING, so re-running never clobbers a row an
admin edited in a Sandbox page — a divergence from disk is deliberate and survives.
Adding a config file appends a row; a `./run reset` is what applies it.
"""
import json
import os
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "python", "config")
OUT = os.path.join(ROOT, "init-scripts", "seed-physiology.sql")

PREFIX = "c51c1e5f-5cc1-4b77-8832-2d10cc97"


def uuid(suffix):
    return f"{PREFIX}{suffix}"


def load(path):
    with open(path) as f:
        return json.load(f)


def compact(obj):
    return json.dumps(obj, separators=(",", ":"))


# proc_configs.config is a `json` column (op order is semantic — see
# 02-init-medical.sql); the other three are jsonb.
CAST = {"proc_configs": "::json"}


def row(table, uid, name, desc, cfg):
    d = "NULL" if not desc else "'" + desc.replace("'", "''") + "'"
    assert "$json$" not in compact(cfg), f"{name}: config contains the dollar-quote tag"
    return (
        f"INSERT INTO {table} (id, name, description, config) VALUES (\n"
        f"    '{uid}',\n"
        f"    '{name}',\n"
        f"    {d},\n"
        f"    $json${compact(cfg)}$json${CAST.get(table, '::jsonb')}\n"
        f") ON CONFLICT (id) DO NOTHING;\n"
    )


def model_desc(cfg):
    comps = len(cfg.get("compartments", {}))
    conns = sum(len(v) for v in cfg.get("connections", {}).values() if isinstance(v, dict))
    cals = len(cfg.get("calibration", {}))
    return (f"{comps}-compartment circuit · {conns} connections · "
            f"{cals} calibration controllers")


def scenario_desc(cfg):
    modes = []
    if cfg.get("baseline"):
        modes.append("baseline")
    for m in ("calibration", "control"):
        stages = (cfg.get(m) or {}).get("stages")
        if stages:
            modes.append(f"{m} ({len(stages)} stages)")
    integ = (cfg.get("shared") or {}).get("integration", {})
    gas = "gas exchange on" if integ.get("gasExchange") else "no gas exchange"
    return f"Modes: {', '.join(modes) or 'none'} · dt {integ.get('dt')} s · {gas}"


def proc_desc(cfg):
    ops = sum(len(v) for v in cfg.values() if isinstance(v, dict))
    return f"{len(cfg)} stages · {ops} operations"


def plot_desc(cfg):
    grid = cfg.get("grid", {})
    return f"{len(cfg.get('axes', {}))} axes · {grid.get('rows')}×{grid.get('cols')} grid"


chunks = []
chunks.append(
    "-- ════════════════════════════════════════════════════════════════════════════\n"
    "--  seed-physiology.sql — the shipped cardiopulmonary configs\n"
    "--\n"
    "--  GENERATED from python/config/** — do not hand-edit a config blob here.\n"
    "--  Disk is canonical: the notebooks (python/run_*/) read config/ directly through\n"
    "--  library/utils.configPath, and these rows are the web app's editable copies of\n"
    "--  the same files. Editing a row in a Sandbox page deliberately diverges it from\n"
    "--  disk; re-running this generator does NOT overwrite it (ON CONFLICT DO NOTHING).\n"
    "--\n"
    "--    model_configs     ← config/models/*.json        (structure / physics)\n"
    "--    scenario_configs  ← config/scenarios/*.json     (values + stage stacks)\n"
    "--    proc_configs      ← config/processing/*.json    (post-processing DAG)\n"
    "--    plot_configs      ← config/plots/**/*.json      (figure definitions)\n"
    "--\n"
    "--  UUID ranges under the framework prefix c51c1e5f-5cc1-4b77-8832-2d10cc97:\n"
    "--    f00X models · f01X scenarios · f02X processing · f03X plots\n"
    "--  (f000 is also 01-init-db.sql\'s User Feedback survey id — different table,\n"
    "--   no conflict; f0XX has been this domain\'s documented range since the first seed.)\n"
    "--\n"
    "--  Depends on: 02-init-medical.sql (the four tables must exist first)\n"
    "-- ════════════════════════════════════════════════════════════════════════════\n"
)

groups = [
    ("model_configs", "models", "f00", sorted(glob.glob(f"{CONFIG}/models/*.json")), model_desc),
    ("scenario_configs", "scenarios", "f01", sorted(glob.glob(f"{CONFIG}/scenarios/*.json")), scenario_desc),
    ("proc_configs", "processing", "f02", sorted(glob.glob(f"{CONFIG}/processing/*.json")), proc_desc),
    ("plot_configs", "plots", "f03", sorted(glob.glob(f"{CONFIG}/plots/*/*.json")), plot_desc),
]

count = 0
for table, label, base, paths in [(g[0], g[1], g[2], g[3]) for g in groups]:
    desc_fn = dict((g[0], g[4]) for g in groups)[table]
    chunks.append(f"\n\n-- #region {table} ← config/{label}/\n")
    for i, path in enumerate(paths):
        assert i < 16, f"{label}: more than 16 files, widen the UUID range"
        rel = os.path.relpath(path, os.path.join(CONFIG, label))
        name = rel[:-len(".json")]
        cfg = load(path)
        chunks.append("\n" + row(table, uuid(f"{base}{i:x}"), name, desc_fn(cfg), cfg))
        count += 1
    chunks.append("-- #endregion\n")

with open(OUT, "w") as f:
    f.write("".join(chunks))

print(f"{OUT}: {count} rows, {os.path.getsize(OUT) / 1024:.0f} KB")
