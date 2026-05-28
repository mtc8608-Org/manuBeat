import h5py as h5
import numpy as np
import os
import traceback


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


# ── Read ──────────────────────────────────────────────────────────────────────

def getHdf5Data(session, data_dir=None):
    directory = (os.getcwd() + '/data/') if data_dir is None else data_dir
    base = {'fileName': 'VentilatorData.hdf5', 'filePath': directory, 'mode': 'r', 'datasetPath': ''}
    pressureData  = readDataset(**{**base, 'datasetPath': '/data/' + session + '/Paw'})
    volumeData    = readDataset(**{**base, 'datasetPath': '/data/' + session + '/V'})
    flowData      = readDataset(**{**base, 'datasetPath': '/data/' + session + '/FLOW'})
    startOfBreath = readDataset(**{**base, 'datasetPath': '/data/' + session + '/throughs'})
    return pressureData, volumeData, flowData, startOfBreath

def readDataset(filePath, fileName, datasetPath, mode='r'):
    fileObject = h5.File(filePath + fileName, mode)
    dataset = fileObject[datasetPath]
    if dataset.dtype == 'float64':
        return dataset[()]
    if dataset.dtype == 'object':
        if h5.check_dtype(vlen=dataset.dtype) == str:
            return fileObject[datasetPath][()].decode('utf-8')
        if dataset.dtype.kind == 'S':
            return dataset[()].astype(str)
    dictionary = {}
    for name in dataset.dtype.names:
        if dataset[name].dtype == 'float64':
            dictionary[name] = dataset[name]
        else:
            dictionary[name] = [b.decode('UTF-8') for b in dataset[name]]
    return dictionary


def readFile(filePath, fileName, datasetPath, mode='r'):
    fileObject = h5.File(filePath + fileName, mode)
    descriptorObject = fileObject['/descriptor']
    descTypes = descriptorObject.dtype
    descriptor = {}
    for header in descTypes.names:
        if np.dtype(descTypes[header]) == np.dtype('O'):
            descriptor[header] = [b.decode('UTF-8') for b in descriptorObject[header]]
        elif np.dtype(descTypes[header]) == np.dtype('<f8'):
            descriptor[header] = descriptorObject[header]

    dataGroup = fileObject['/data']
    data = {}
    for group in dataGroup:
        sessionGroup = dataGroup[group]
        session = {}
        for datasetName in sessionGroup:
            dataset = sessionGroup[datasetName]
            if dataset.dtype == 'float64':
                session[datasetName] = dataset[()]
                if 'Pulses' not in datasetName and 'throughs' not in datasetName:
                    throughs = sessionGroup['throughs'][()]
                    rawPulse = {}
                    for i in np.arange(1, len(throughs), 1):
                        arr = dataset[()]
                        rawPulse['P_' + str(i)] = arr[int(throughs[i-1]):int(throughs[i])]
                    session[datasetName + '_RawPulse'] = rawPulse
            else:
                sax = {}
                for name in dataset.dtype.names:
                    sax[name] = [b.decode('UTF-8') for b in dataset[name]]
                session[datasetName] = sax
        data[group] = session
    return descriptor, data


# ── Write ─────────────────────────────────────────────────────────────────────

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
        raise TypeError(f"writeStringDataset expects str or bytes, got {type(data)}")
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


# ── Streaming write (used by population runs) ─────────────────────────────────

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
                            results = {k: np.ones(len(v)) * -99999.9 for k, v in results.items()}
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
