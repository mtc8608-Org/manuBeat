import HDF5API as hdf5

def test():
    print("Hello HDF5 world")
    # Create a new HDF5 file
    filePath = "data"
    fileName = "test.hdf5"



    hdf5.createHDF5File(filePath, fileName)
    hdf5.writeGroup(filePath, fileName, "group1")

    # For string arrays and strings, use writeStringDataset
    strData = "Hello HDF5 world"
    hdf5.writeStringDataset(filePath, fileName, "group1/str", strData)
    strArrayData = ["Hello", "HDF5", "world"]
    hdf5.writeStringDataset(filePath, fileName, "group1/strArray", strArrayData)

    # For arrays, use writeArrayDataset
    arrayData = [1, 2, 3, 4, 5]
    hdf5.writeArrayDataset(filePath, fileName, "group1/floatArray", arrayData)

    # For Compound Data Types, use writeCompoundDataset
    compoundData = {
        'name': ['John', 'Michael', 'Sarah'],
        'age': [25,30,35],
        'height': [1.75, 1.80, 1.65]
    }

    dtype = { 
        "name": 'string', 
        "age": 'integer', 
        "height": 'float' 
        }

    hdf5.writeCompoundDataset(filePath, fileName, "group1/compoundData", compoundData, dtype)

    # For the results of the model
    results = {
        'P_O2' : [0.1, 0.2, 0.3, 0.4, 0.5],
        'P_CO2' : [0.6, 0.7, 0.8, 0.9, 1.0],
        'P_N2' : [1.1, 1.2, 1.3, 1.4, 1.5]
    }
    hdf5.writeGroup(filePath, fileName, "results")
    for key, value in results.items():
        hdf5.writeArrayDataset(filePath, fileName, "results/" + key, value)


import numpy as np
import h5py as h5

# Example data2 dictionary
data2 = {
    'row1': {'col1': 1.0, 'col2': 2.0},
    'row2': {'col1': 3.0, 'col2': 4.0},
    'row3': {'col1': 5.0, 'col2': 6.0}
}

# Define the column labels and row labels
datasetsLabels = ['col1', 'col2']
rowLabels = list(data2.keys())

# Define the compound data type including a field for row labels
dtype = [('row_label', 'S10')] + [(key, 'float') for key in datasetsLabels]

# Create the NumPy array with the appropriate compound data type
compound_data = np.zeros(len(rowLabels), dtype=dtype)

# Populate the NumPy array with data from the dictionary, including row labels
for i, row_label in enumerate(rowLabels):
    row_data = tuple([row_label.encode()] + [data2[row_label][key] for key in datasetsLabels])
    compound_data[i] = row_data

# Specify the file path and name
filePath = '.'
fileName = 'example.h5'
newDatasetPath = '/data2'

# Create and open the HDF5 file
with h5.File(filePath + '/' + fileName, 'w') as hdf5_file:
    # Create the dataset
    dataset = hdf5_file.create_dataset(
        name=newDatasetPath,
        data=compound_data
    )

# Verify the contents
with h5.File(filePath + '/' + fileName, 'r') as hdf5_file:
    dset = hdf5_file[newDatasetPath]
    print("Data:")
    print(dset[:])
