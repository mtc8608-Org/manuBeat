"""
Round-trip + migration tests for the unified HDF5 layer.

Run:  python -m hdf5.test_hdf5
No external test framework; assertions + a small PASS/FAIL summary.
"""
from __future__ import annotations

import json
import os
import pickle
import shutil
import tempfile

import h5py as h5
import numpy as np

from . import engine, schema_sim, schema_pop, schema_calib, migrate

_passed = 0


def check(name, cond):
    global _passed
    assert cond, f'FAIL: {name}'
    _passed += 1
    print(f'  ok  {name}')


# ── engine ───────────────────────────────────────────────────────────────────────

def test_engine(tmp):
    print('engine')
    p = os.path.join(tmp, 'engine.h5')
    engine.write_dataset(p, 'a/x', np.arange(10, dtype='float64'))
    d = engine.get_dataset(p, 'a/x')
    check('numeric round-trip', d['type'] == 'numeric' and d['data'] == list(range(10)))
    d = engine.get_dataset(p, 'a/x', start=2, end=5)
    check('numeric slice', d['data'] == [2.0, 3.0, 4.0])

    engine.write_string_dataset(p, 'note', 'hello')
    check('string round-trip', engine.get_dataset(p, 'note')['data'] == 'hello')

    with h5.File(p, 'a') as f:
        engine.write_str_array(f, 'names', ['aa', 'bb', 'cc'])
        engine.write_compound(f, 'tbl', {'u': [1.0, 2.0], 'v': [3.0, 4.0]})
        comp = engine.read_compound(f, 'tbl')
        arr, names = engine.compound_to_array(f, 'tbl')
        engine.write_blob(f, 'blob', b'\x00\x01\x02ABC')
        blob = engine.read_blob(f, 'blob')
    check('str array', list(h5.File(p)['names'].asstr()[:]) == ['aa', 'bb', 'cc'])
    check('compound dict', list(comp['u']) == [1.0, 2.0])
    check('compound array', arr.shape == (2, 2) and names == ['u', 'v'])
    check('blob round-trip', blob == b'\x00\x01\x02ABC')

    engine.write_attrs(p, '/', {'k': 7})
    check('attrs', engine.get_attrs(p, '/')['k'] == 7)

    tree = engine.get_tree(p)
    check('tree root', tree['type'] == 'group' and tree['path'] == '/')

    try:
        import pandas as pd
        with h5.File(p, 'a') as f:
            df = pd.DataFrame({'loss': [0.1, 0.2], 'tag': ['a', 'b']})
            engine.write_df(f, 'log', df)
            back = engine.read_group_as_df(f, 'log')
        check('df round-trip', list(back['loss']) == [0.1, 0.2] and list(back['tag']) == ['a', 'b'])
    except ImportError:
        print('  -- pandas missing, skipping df round-trip')


# ── schema_sim ───────────────────────────────────────────────────────────────────

def test_sim(tmp):
    print('schema_sim')
    p = os.path.join(tmp, 'run.h5')
    state_names = ['V_A', 'V_B']
    t = np.linspace(0, 1, 50)
    runs = {'V_A': np.sin(t), 'V_B': np.cos(t)}
    schema_sim.write_run_result(
        p, runs=runs, t_axis=t, state_names=state_names,
        final_states=[runs['V_A'][-1], runs['V_B'][-1]],
        model_structure={'data': {'states': state_names}},
        run_params={'runTime': 1, 'dt': 0.02, 'returnFrequency': 100},
        job_id='job1')
    schema_sim.append_processed(p, 'metrics',
                                {'amp': {'data': np.array([1.0, 2.0]),
                                         'metadata': {'unit': 'L', 'prefix': '', 'name': 'Amplitude'}}},
                                proc_config={'op': 'amp'})
    payload = schema_sim.read_run_result(p)
    check('sim payload keys', set(payload) >= {'stateNames', 't', 'signals', 'finalStates', 'processed'})
    check('sim final state', abs(payload['finalStates']['V_B'] - float(np.cos(t)[-1])) < 1e-4)
    check('sim processed', payload['processed']['metrics']['amp'] == [1.0, 2.0])
    check('sim processed unit', payload['units']['amp'] == 'L')
    b = schema_sim.read_run_bundle(p)
    check('sim bundle ms', b.model_structure['data']['states'] == state_names)


# ── schema_pop ───────────────────────────────────────────────────────────────────

def _make_pop(path, n, state_names, seed):
    rng = np.random.default_rng(seed)
    schema_pop.init_population(
        path, param_names=['k1'], state_names=state_names,
        observation_names=['V_A'], sampled_params=rng.random((n, 1)),
        model_structure={'m': 1}, problem={'names': ['k1']}, conf={'c': 1})
    for i in range(n):
        raw = {s: rng.random(20) for s in state_names}
        fs = {s: raw[s][-1] for s in state_names}
        schema_pop.add_run(path, f'r{i}', raw, fs)


def test_pop(tmp):
    print('schema_pop')
    state_names = ['V_A', 'k1']
    p1 = os.path.join(tmp, 'pop1.h5')
    p2 = os.path.join(tmp, 'pop2.h5')
    _make_pop(p1, 3, state_names, 1)
    _make_pop(p2, 2, state_names, 2)

    b = schema_pop.read_population(p1)
    check('pop n_runs', b.n_runs == 3)
    check('pop final_states len', b.final_states['V_A'].shape[0] == 3)
    arr, names = schema_pop.final_states_array(p1)
    check('pop fs array', arr.shape == (3, 2) and names == state_names)
    with h5.File(p1) as f:
        check('pop traces kept', 'runs/r0/raw/V_A' in f)

    merged = os.path.join(tmp, 'merged.h5')
    schema_pop.merge_populations(merged, [p1, p2], repack=False)
    mb = schema_pop.read_population(merged)
    check('merge n_runs', mb.n_runs == 5)
    check('merge fs rows', mb.final_states['V_A'].shape[0] == 5)
    with h5.File(merged) as f:
        check('merge traces renamed', 'runs/s0_r0/raw/V_A' in f and 'runs/s1_r0/raw/V_A' in f)


# ── schema_calib ─────────────────────────────────────────────────────────────────

def test_calib(tmp):
    print('schema_calib')
    rng = np.random.default_rng(0)
    state_names = ['obs1', 'obs2', 'p1', 'p2']
    fs = rng.normal(size=(400, 4))
    ts = schema_calib.build_training_set(
        fs, state_names, observation_keys=['obs1', 'obs2'],
        param_keys=['p1', 'p2'], seed=0)
    check('calib split shapes', ts['splits']['X_train'].shape[1] == 2)
    check('calib scaler arrays', ts['scalers']['x']['mean'].shape == (2,))

    p = os.path.join(tmp, 'calib.h5')
    preds = {'y_true': ts['splits']['y_test'], 'y_pred': ts['splits']['y_test'] + 0.01}
    schema_calib.save_calibration_run(
        p, observation_names=ts['observation_names'], param_names=ts['param_names'],
        splits=ts['splits'], scalers=ts['scalers'], predictions=preds,
        conf={'epochs': 10})
    cb = schema_calib.load_calibration_run(p)
    check('calib reload names', cb.observation_names == ['obs1', 'obs2'])
    check('calib reload split', cb.splits['X_train'].shape == ts['splits']['X_train'].shape)
    check('calib reload scaler', np.allclose(cb.scalers['x']['mean'], ts['scalers']['x']['mean']))
    check('calib predictions', 'y_pred' in cb.predictions)

    # scaler round-trip vs sklearn
    sk = schema_calib.make_scaler(cb.scalers['x'])
    manual = schema_calib.apply_scaler(cb.scalers['x'], ts['splits']['X_train'])
    check('calib scaler matches sklearn', np.allclose(sk.transform(ts['splits']['X_train']), manual, atol=1e-5))


# ── migrate ──────────────────────────────────────────────────────────────────────

def test_migrate(tmp):
    print('migrate')
    # synthetic legacy population
    legacy = os.path.join(tmp, 'Pop__legacy.h5')
    state_names = ['V_A', 'k1']
    with h5.File(legacy, 'w') as f:
        dt = engine.type_converter({s: 'float' for s in state_names})
        rows = np.zeros(4, dtype=dt)
        rows['V_A'] = [1, 2, 3, 4]
        rows['k1'] = [0.1, 0.2, 0.3, 0.4]
        f.create_dataset('finalStates', data=rows)
        f.create_dataset('startingParameters', data=np.arange(4).reshape(4, 1).astype('f8'))
        strdt = h5.string_dtype(encoding='utf-8')
        f.create_dataset('modelStructure',
                         data=json.dumps({'m': 1}).replace('"', "'").encode(), dtype=strdt)
        f.create_dataset('problem_startingParameters',
                         data=json.dumps({'names': ['k1']}).replace('"', "'").encode(), dtype=strdt)
    b = migrate.read_legacy_population(legacy)
    check('legacy pop names', b.state_names == state_names and b.param_names == ['k1'])
    check('legacy pop fs', list(b.final_states['k1']) == [0.1, 0.2, 0.3, 0.4])
    check('legacy pop ms unhacked', b.model_structure == {'m': 1})

    out = os.path.join(tmp, 'pop_migrated.h5')
    migrate.migrate_population(legacy, out)
    nb = schema_pop.read_population(out)
    check('migrated pop n', nb.final_states['V_A'].shape[0] == 4)

    # synthetic legacy training with pickled sklearn scaler
    from sklearn.preprocessing import StandardScaler
    legacy_tr = os.path.join(tmp, 'NNTrain_legacy.h5')
    Xtr = np.random.normal(size=(50, 2)).astype('f4')
    ytr = np.random.normal(size=(50, 1)).astype('f4')
    sx = StandardScaler().fit(Xtr)
    sy = StandardScaler().fit(ytr)
    with h5.File(legacy_tr, 'w') as f:
        engine.write_compound(f, 'X_train', {'obs1': Xtr[:, 0], 'obs2': Xtr[:, 1]})
        engine.write_compound(f, 'y_train', {'p1': ytr[:, 0]})
        engine.write_blob(f, 'x_scaler', pickle.dumps(sx))
        engine.write_blob(f, 'y_scaler', pickle.dumps(sy))
    data = migrate.read_legacy_training(legacy_tr)
    check('legacy train names', data['observation_names'] == ['obs1', 'obs2'])
    check('legacy train scaler', np.allclose(data['scalers']['x']['mean'], sx.mean_))

    out_tr = os.path.join(tmp, 'calib_migrated.h5')
    migrate.migrate_training(legacy_tr, out_tr)
    cb = schema_calib.load_calibration_run(out_tr)
    check('migrated train reload', cb.splits['X_train'].shape == (50, 2))


def main():
    tmp = tempfile.mkdtemp(prefix='hdf5test_')
    try:
        test_engine(tmp)
        test_sim(tmp)
        test_pop(tmp)
        test_calib(tmp)
        test_migrate(tmp)
        print(f'\nALL PASSED ({_passed} checks)')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
