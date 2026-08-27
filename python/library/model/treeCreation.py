import numpy as np
import random

def generate_random_numbers_with_bias(max_difference):
    # Generate 3 random numbers between 0 and 1
    rand1 = random.uniform(0.20, 0.30)
    rand2 = random.uniform(0.20, 0.30)
    rand3 = random.uniform(0.20, 0.30)

    # Calculate the sum of the first 3 random numbers
    total = rand1 + rand2 + rand3

    # Calculate the fourth number to ensure the sum is 1
    rand4 = 1 - total

    '''
    # Ensure that no number has more than 0.5 difference from the mean
    mean = total / 3
    while any(abs(x - mean) > max_difference for x in (rand1, rand2, rand3, rand4)):
        rand1 = random.random()
        rand2 = random.random()
        rand3 = random.random()
        total = rand1 + rand2 + rand3
        rand4 = 1 - total
    '''

    # Create a list to store the 4 random numbers
    random_numbers = np.array([rand1, rand2, rand3, rand4])

    return random_numbers

def mergeArray(arr1, arr2):
    # Determine the dimensions n and m
    n, _ = arr1.shape
    m, _ = arr2.shape

    # Create an empty square array of shape (m+n) x (m+n)
    merged_array = np.zeros((n+m, n+m))

    # Insert the original arrays into the empty array
    merged_array[:n, :n] = arr1
    merged_array[n:, n:] = arr2


    return merged_array

def mergeWithModelStructure(modelStructure, params, matrix, compartmentNames, resistorNames, resistorParams, capacitorParams, num_nodes):
    lengthMatrix = len(modelStructure['connectivityMatrix'])
    modelStructure['connectivityMatrix'] = mergeArray(modelStructure['connectivityMatrix'], matrix)
    modelStructure['connectivityMatrix'][params['idxVen']][lengthMatrix] = 1

    modelStructure['compartmentNames'] = modelStructure['compartmentNames'] + compartmentNames
    modelStructure['resistorNames'] = modelStructure['resistorNames'] + resistorNames

    modelStructure['resistorParamsMatrix'] = np.vstack((modelStructure['resistorParamsMatrix'], resistorParams)) 
    modelStructure['capacitorsParamsMatrix'] = np.vstack((modelStructure['capacitorsParamsMatrix'], capacitorParams))

    modelStructure['connectivityPresBiasMatrix'] = mergeArray(modelStructure['connectivityPresBiasMatrix'], np.zeros((num_nodes, num_nodes), dtype=int))
    modelStructure['connectivityPresBiasMatrix'][params['idxPlr']][lengthMatrix:] = 1
    
    modelStructure['connectivityRegionVolMatrix'] = mergeArray(modelStructure['connectivityRegionVolMatrix'], np.zeros((num_nodes, num_nodes), dtype=int))
    modelStructure['connectivityRegionVolMatrix'][params['idxThx']][lengthMatrix:] = 1
    modelStructure['connectivityRegionVolMatrix'][params['idxPlr']][lengthMatrix:] = 1
    
    modelStructure['connectivityMemResistorsMatrix'] = mergeArray(modelStructure['connectivityMemResistorsMatrix'], np.zeros((num_nodes, num_nodes), dtype=int))
    
    modelStructure['cyclesDistributionMatrix'] = np.hstack((modelStructure['cyclesDistributionMatrix'], np.zeros((2, num_nodes), dtype=int)))
    modelStructure['gasDistributionMatrix'] = np.hstack((modelStructure['gasDistributionMatrix'], np.zeros((5, num_nodes), dtype=int)))
    modelStructure['gasDistributionMatrix'][0][lengthMatrix:] = 1

    

    unique_lengths = set()
    for comp in compartmentNames:
        unique_lengths.add(len(comp))
    unique_lengths_list = sorted(list(unique_lengths))
    nr_levels = len(unique_lengths_list)

    counter = 0
    for comp in compartmentNames:
        if comp.startswith('La') and len(comp) == 6:
            separation = params['separation']
            infPoint = (params['infPoint']) #- (counter * 1)
            maxCompliance = params['maxCompliance']/8 + 00.0 + (counter * 1)
            k = params['k'] #+ (counter * 0.002)
            cMin = params['cMin']
            counter += 1

            controller = np.array(['V_' + comp, 'C_' + comp, infPoint,  maxCompliance, separation, k, cMin, 3])
            modelStructure['controllers'] = np.vstack((modelStructure['controllers'], controller))

            counter1 = 0
            for newcomp in compartmentNames:
                ####################################################################################
                if comp in newcomp and len(newcomp) != 6:
                    separation_a = params['separation_a']
                    infPoint_a = (params['infPoint_a']) - (counter1 * params['infPoint_PerSmallAlv']) + (counter * params['infPoint_PerBigAlv'])
                    maxCompliance_a = params['maxCompliance_a']/32 + params['maxC_DC']  - (counter1 * params['maxC_PerSmallAlv']) + (counter * params['maxC_PerBigAlv']) 
                    k_a = params['k_a']
                    cMin_a = params['cMin_a']
                    counter1 += 1
                    
                    controller = np.array(['V_' + newcomp, 'C_' + newcomp, infPoint_a,  maxCompliance_a, separation_a, k_a, cMin_a, 3])
                    modelStructure['controllers'] = np.vstack((modelStructure['controllers'], controller))
                ####################################################################################
    
    for res in resistorNames:
        if res.startswith('La'):
            dist = params['infPoint_a'] * params['separation_a']
            target = params['infPoint_a'] - dist
            
            minVal = params['minRes_a']
            maxVal = params['maxRes_a']
            slope = params['k_Res_a']
            dist = params['dist_Res_a']

            controller = np.array(['V_' + res[6:], 'R_' + res, target,  minVal, maxVal,  slope, dist,  4,])
            modelStructure['controllers'] = np.vstack((modelStructure['controllers'], controller))
        
        elif res.startswith('Lb'):
            dist = params['infPoint'] * params['separation']
            target = params['infPoint'] - dist

            minVal = params['minRes']
            maxVal = params['maxRes']
            slope = params['k_Res']
            dist = params['dist_Res']


            controller = np.array(['V_' + res[:4], 'R_' + res, target,  minVal, maxVal,  slope, dist,  4,])
            modelStructure['controllers'] = np.vstack((modelStructure['controllers'], controller))
    
    
        

            

def set_connections(node_index, level, params, matrix, compartmentNames, resistorNames, resistorParams, capacitorParams, levels):
    # Terminate function
    if level == levels+1:
        return
    
    # Trachea
    elif level == 0:
        compartmentNames[0] = 'Lt'
        resistorNames[0] = 'VenLt'
        resistorParams[0] = [params['R_Lt'], 0.001, 0.0, 1]
        capacitorParams[0] = [params['C_Lt'], params['V0_Lt'], 0.0000, 0.0000, 0.0000, 75.088, 2]
        set_connections(node_index, level + 1, params, matrix, compartmentNames, resistorNames, resistorParams, capacitorParams, levels)
    
    # Upper Bronchi
    elif level == 1:
        for i in range(2):
            child_index = i+1

            compartmentNames[child_index] = 'Lb|' + str(i)
            resistorNames[child_index] = 'LtLb|' + str(i)
            
            R = params['R_Lb']
            new_resistor = [R*2, 0.0, 0.0, 1]
            resistorParams[child_index] = new_resistor
            
            new_capacitor = [params['C_Lb']/2, params['V0_Lb']/2, 0.0, 0.0, 0.0, params['V0_Lb']/2, 2,]
            capacitorParams[child_index] = new_capacitor

            matrix[node_index, child_index] = 1
            set_connections(child_index, level + 1, params, matrix, compartmentNames, resistorNames, resistorParams, capacitorParams, levels)          
    
    # Alveoli
    else:
        #resistors = generate_random_numbers_with_bias(0.5) * (params['R_La']*alveoli * 4)
        #print('Found!')
        for i in range(4):
            child_index = 4 * node_index - 1 + i
            name = 'La' + compartmentNames[node_index][2:] + '|' + str(i)
            compartmentNames[child_index] = name
            resistorNames[child_index] = compartmentNames[node_index] + name

            num_comps = 1 + 2 * (4 ** level - 1) // 3# Total # nodes up to level
            num_parent_comps = 1 + 2 * (4 ** (level-1) - 1) // 3 # Total # nodes before this level
            num_comps = num_comps - num_parent_comps # Total # nodes in this level
            
            # Small Alveoli
            if level == levels:
                R = (params['R_La']) #- 0.00 + ((i) * 0.001)
                C = (params['C_La'] * 0.4)/num_comps
                V0 = 1.0

                new_resistor = [R, 0.0, 0.0, 1]
                resistorParams[child_index] = new_resistor
                
                new_capacitor = [C, 0.0, 0.0, 0.0, 0.0, V0, 1]
                capacitorParams[child_index] = new_capacitor
                matrix[node_index, child_index] = 1

                set_connections(child_index, level + 1, params, matrix, compartmentNames, resistorNames, resistorParams, capacitorParams, levels)
            # Big Alveoli
            else:
                R = params['R_La']*8#- 0.00 - ((i) * 0.002)
                C = (params['C_La'] * 0.6) / num_comps
                V0 = 1.0
                
                new_resistor = [R, 0.0, 0.0, 1]
                
                resistorParams[child_index] = new_resistor
                new_capacitor = [C, 0.0, 0.0, 0.0, 0.0, V0, 1]
                capacitorParams[child_index] = new_capacitor
                matrix[node_index, child_index] = 1

                set_connections(child_index, level + 1, params, matrix, compartmentNames, resistorNames, resistorParams, capacitorParams, levels)

# Function to create a connectivity matrix for a tree with branching factor 4
def create_connectivity_matrix(levels,params,modelStructure):
    # Helper function to recursively set connections in the matrix
    

    num_nodes = 1 + 2 * (4 ** levels - 1) // 3  # Total nodes in the tree

    trachea = 1
    bronchi = 2
    alveoli = num_nodes - trachea - bronchi
    
    # Init arrays and add Trachea
    compartmentNames = [""] * num_nodes
    resistorNames = [""] * num_nodes
    resistorParams = np.zeros((num_nodes,4))
    capacitorParams = np.zeros((num_nodes,7))
    matrix = np.zeros((num_nodes, num_nodes), dtype=int)

    # Set connections recursively
    set_connections(0, 0, params, matrix, compartmentNames, resistorNames, resistorParams, capacitorParams, levels)
    print(str(trachea) + ' trachea, ' + str(bronchi) + ' bronchi, ' + str(alveoli) + ' alveoli')
    
    mergeWithModelStructure(modelStructure, params, matrix, compartmentNames, resistorNames, resistorParams, capacitorParams, num_nodes)


    
    




# Create a binary tree with the first level having two children and subsequent levels branching into four
#levels = 2  # Adjust the number of levels as needed
#connectivity_matrix, compartmentNames, resistorNames, resistorParams, capacitorParams = create_connectivity_matrix(levels,[])


