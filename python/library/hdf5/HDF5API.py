"""
LEGACY compatibility shim.

The unified HDF5 layer now lives in this package:
    hdf5.engine        generic engine (introspection, typed read, write, repack)
    hdf5.schema_sim    simulation-run artifact
    hdf5.schema_pop    population artifact
    hdf5.schema_calib  NN training / calibration artifact
    hdf5.migrate       readers for this legacy layout

New code should import those. This module is kept only so existing callers
(library/modelGen.py:getHdf5Data and the CPET notebooks/runners) keep working.
The matplotlib plotting helpers (plotHdf5Data, hdf5Example) were dropped; the
read/write/streaming functions below are preserved verbatim in behavior.
"""
import os
import traceback

import h5py as h5
import numpy as np

# Re-export the new generic engine so `HDF5API.engine` / direct names resolve.
from . import engine  # noqa: F401


#################################################################
###################### TYPE CONVERSION ##########################

def hdf5TypeConverter(dtype):
    new_dtype = []
    for key, value in dtype.items():
        if value == 'string':
            new_dtype.append((key, h5.string_dtype(encoding='utf-8')))
        elif value == 'integer':
            new_dtype.append((key, np.int32))
        elif value == 'float':
            new_dtype.append((key, np.float64))
    return np.dtype(new_dtype)


def hdf5TypeConverter2D(dtype):
    return np.dtype([(key, hdf5TypeConverter(value)) for key, value in dtype.items()])


#################################################################
###################### READ #####################################

def getHdf5Data(session, data_dir=None):
    directory = (os.getcwd() + '/data/') if data_dir is None else data_dir
    base = {'fileName': 'VentilatorData.hdf5', 'filePath': directory, 'mode': 'r'}
    pressureData  = readDataset(**base, datasetPath='/data/' + session + '/Paw')
    volumeData    = readDataset(**base, datasetPath='/data/' + session + '/V')
    flowData      = readDataset(**base, datasetPath='/data/' + session + '/FLOW')
    startOfBreath = readDataset(**base, datasetPath='/data/' + session + '/throughs')
    return pressureData, volumeData, flowData, startOfBreath


def readDataset(filePath, fileName, datasetPath, mode='r'):
    with h5.File(filePath + fileName, mode) as f:
        dataset = f[datasetPath]
        if dataset.dtype == 'float64':
            return dataset[()]
        if dataset.dtype == 'object':
            if h5.check_dtype(vlen=dataset.dtype) == str:
                return f[datasetPath][()].decode('utf-8')
            if dataset.dtype.kind == 'S':
                return dataset[()].astype(str)
        dictionary = {}
        for name in dataset.dtype.names:
            if dataset[name].dtype == 'float64':
                dictionary[name] = dataset[name][()]
            else:
                dictionary[name] = [b.decode('UTF-8') for b in dataset[name]]
        return dictionary


def readFile(filePath, fileName, datasetPath='', mode='r'):
    with h5.File(filePath + fileName, mode) as f:
        descriptorObject = f['/descriptor']
        descTypes = descriptorObject.dtype
        descriptor = {}
        for header in descTypes.names:
            if np.dtype(descTypes[header]) == np.dtype('O'):
                descriptor[header] = [b.decode('UTF-8') for b in descriptorObject[header]]
            elif np.dtype(descTypes[header]) == np.dtype('<f8'):
                descriptor[header] = descriptorObject[header][()]

        data = {}
        for group in f['/data']:
            sessionGroup = f['/data'][group]
            session = {}
            for datasetName in sessionGroup:
                dataset = sessionGroup[datasetName]
                if dataset.dtype == 'float64':
                    session[datasetName] = dataset[()]
                    if 'Pulses' not in datasetName and 'throughs' not in datasetName:
                        throughs = sessionGroup['throughs'][()]
                        rawPulse = {}
                        arr = dataset[()]
                        for i in np.arange(1, len(throughs), 1):
                            rawPulse['P_' + str(i)] = arr[int(throughs[i - 1]):int(throughs[i])]
                        session[datasetName + '_RawPulse'] = rawPulse
                else:
                    sax = {}
                    for name in dataset.dtype.names:
                        sax[name] = [b.decode('UTF-8') for b in dataset[name]]
                    session[datasetName] = sax
            data[group] = session
    return descriptor, data


#################################################################
###################### WRITE ####################################

def createHDF5File(filePath, fileName):
    h5.File(filePath + '/' + fileName, 'w').close()


def writeGroup(filePath, fileName, groupPath):
    with h5.File(filePath + '/' + fileName, 'a') as f:
        f.create_group(groupPath)


def write1DArrayDataset(filePath, fileName, datasetPath, data):
    with h5.File(filePath + '/' + fileName, 'a') as f:
        f.create_dataset(datasetPath, shape=(len(data),), data=data, dtype='float64',
                         chunks=True, compression='gzip', compression_opts=9, scaleoffset=5)


def write2DArrayDataset(filePath, fileName, datasetPath, data):
    with h5.File(filePath + '/' + fileName, 'a') as f:
        f.create_dataset(datasetPath, shape=data.shape, data=data, dtype='float64',
                         chunks=True, compression='gzip', compression_opts=9, scaleoffset=5)


def writeStringDataset(filePath, fileName, datasetPath, data):
    if isinstance(data, str):
        data = data.encode('utf-8')
    elif not isinstance(data, bytes):
        raise TypeError(f'writeStringDataset expects str or bytes, got {type(data)}')
    with h5.File(filePath + '/' + fileName, 'a') as f:
        f.create_dataset(datasetPath, data=data)


def write1DStrArrayDataset(filePath, fileName, datasetPath, data):
    dt = h5.string_dtype(encoding='utf-8')
    with h5.File(filePath + '/' + fileName, 'a') as f:
        f.create_dataset(datasetPath, shape=(len(data),), data=data, dtype=dt, chunks=True)


def writeCompoundDataset(filePath, fileName, datasetPath, data, dtype,
                         row_labels=None, column_labels=None):
    with h5.File(filePath + '/' + fileName, 'a') as f:
        dt = hdf5TypeConverter(dtype)
        keys = list(data.keys())
        compound_data = np.zeros(len(data[keys[0]]), dtype=dt)
        for i in range(len(data[keys[0]])):
            compound_data[i] = tuple(data[key][i] for key in keys)
        ds = f.create_dataset(datasetPath, data=compound_data)
        if row_labels is not None:
            ds.attrs['row_labels'] = np.array(row_labels, dtype='S10')
        if column_labels is not None:
            ds.attrs['column_labels'] = np.array(column_labels, dtype='S10')


def writeArrayCompoundDataset(filePath, fileName, datasetPath, data, dtype,
                              row_labels, column_labels):
    with h5.File(filePath + '/' + fileName, 'a') as f:
        dtypeHdf5 = hdf5TypeConverter(dtype)
        compound_data = np.zeros(len(row_labels), dtype=dtypeHdf5)
        for counter, (key, value) in enumerate(data.items()):
            compound_data[counter] = tuple(data[key][keyD] for keyD in value.keys())
        ds = f.create_dataset(datasetPath, data=compound_data)
        vlen_str_dt = h5.string_dtype(encoding='utf-8')
        if row_labels is not None:
            ds.attrs['row_labels'] = np.array(row_labels, dtype=vlen_str_dt)
        if column_labels is not None:
            ds.attrs['column_labels'] = np.array(column_labels, dtype=vlen_str_dt)


#################################################################
###################### STREAMING WRITE ##########################
# Used by the population runners (codeArchive/run_batchSimulation.py etc.).

def writeToFileAsDataAvailable(h5filePath, h5fileName, runTime, runsToSave, queue):
    print('Save To File Thread started')
    createHDF5File(h5filePath, h5fileName)
    groupName = 'data'
    writeGroup(h5filePath, h5fileName, groupName)
    dt0 = 0.01
    datasetSize = int((runsToSave * runTime) / dt0)
    completed = 0
    with h5.File(h5filePath + '/' + h5fileName, 'a') as hdf_file:
        while completed < runsToSave:
            try:
                nrun, y_dense, out = queue.get()
                results = out | y_dense
                for key, value in results.items():
                    if completed == 0:
                        hdf_file.create_dataset(
                            groupName + '/' + key, shape=(datasetSize,), dtype='float64',
                            compression='gzip', compression_opts=9, scaleoffset=5)
                    ds = hdf_file[groupName + '/' + key]
                    chunk = int((completed * runTime) / dt0)
                    ds[chunk:chunk + len(value) - 1] = value[0:int(runTime / dt0)]
                completed += 1
            except Exception:
                print(traceback.format_exc())
                break


def writeToFileAsDataAvailableGroups(h5filePath, h5fileName, runTime, runsToSave,
                                     totalModels, queue):
    print('Save To File Thread started')
    dt0 = 0.01
    datasetSize = int((runsToSave * runTime) / dt0)
    completed = 0
    groups = []
    with h5.File(h5filePath + '/' + h5fileName, 'a') as hdf_file:
        while completed < runsToSave * totalModels:
            try:
                groupName, nrun, y_dense, out = queue.get()
                results = out | y_dense
                try:
                    for key, value in results.items():
                        if np.isnan(value).any() or abs(value[-1]) > 1e20:
                            results = {k: np.ones(len(v)) * -99999.9
                                       for k, v in results.items()}
                            break
                except Exception:
                    print(traceback.format_exc())
                    results = {k: np.ones(len(v)) * -99999.9 for k, v in results.items()}

                if groupName not in groups:
                    groups.append(groupName)
                    hdf_file.create_group(groupName)
                    for key, value in results.items():
                        hdf_file.create_dataset(
                            groupName + '/' + key, shape=(datasetSize,), dtype='float64',
                            compression='gzip', compression_opts=9, scaleoffset=5)

                chunk = int((nrun * runTime) / dt0)
                for key, value in results.items():
                    ds = hdf_file[groupName + '/' + key]
                    ds[chunk:chunk + len(value) - 1] = value[0:int(runTime / dt0)]
                completed += 1
            except Exception:
                print(traceback.format_exc())
                break
