from . import model_generator as modelGenerator
from . import utils
from functools import partial, lru_cache
import jax.numpy as jnp
import equinox as eqx
import numpy as np
import time
import copy
import jax
import os
import dataclasses


############################################################################################
# region Model Array Mode
############################################################################################
def runge_kutta_step(f, y, t, h, constants):
    k1 = f(t, y, constants)
    k2 = f(t + h / 2, y + h * k1 / 2, constants)
    k3 = f(t + h / 2, y + h * k2 / 2, constants)
    k4 = f(t + h, y + h * k3, constants)

    dy_rk4 = y + (h / 6) * (k1 + 2*k2 + 2*k3 + k4)
    dy_euler = y + h * k1

    # Override RK4 result with Euler where needed
    eul_idx = jnp.array(f.eul_idx, dtype=int)
    dy = dy_rk4.at[eul_idx].set(dy_euler[eul_idx])

    return dy

def runge_kutta4(f, y0, t0, tf, h, constants):
    def step_fn(y, t):
        y_next = runge_kutta_step(f, y, t, h, constants)
        return y_next,y_next

    num_steps = int((tf - t0) / h)
    ts = jnp.linspace(t0, tf, num_steps + 1)

    _,ys = jax.lax.scan(step_fn, y0, ts[:-1])
    ys = jnp.vstack([y0[None], ys])
    return ts, ys

def euler_step(f, y, t, h, constants):
    k1 = f(t, y, constants)
    dy = y + h * k1
    return dy

def euler(f, y0, t0, tf, h, constants):
    def step_fn(y, t):
        y_next = euler_step(f, y, t, h, constants)
        return y_next,y_next

    num_steps = int((tf - t0) / h)
    ts = jnp.linspace(t0, tf, num_steps + 1)

    _,ys = jax.lax.scan(step_fn, y0, ts[:-1])
    ys = jnp.vstack([y0[None], ys])
    return ts, ys

def count_decimals(x, max_digits=10):
    powers = jnp.power(10.0, jnp.arange(1, max_digits+1))
    diffs = jnp.abs(powers * x - jnp.round(powers * x))
    decimals = jnp.argmax(diffs < 1e-6) + 1
    return decimals

@lru_cache(maxsize=16)
def _make_solver(runTime: float, dt0: float, returnFrequency: int, startTime: float):
    """Returns a JIT-compiled solver for the given fixed scalar params.
    Cached so we only recompile when these scalars change.
    """
    step = int((1 / dt0) / returnFrequency)

    @eqx.filter_jit
    def _solve(cpModel, states, constants):
        ts, ys = euler(cpModel, states, startTime, runTime, dt0, constants)
        sts = jnp.array([ys[-1][i] for i in range(ys.shape[1])])
        statenames = cpModel.stateNames
        sts = sts.at[statenames.index('T')].set(
            jnp.round(states[statenames.index('T')] + runTime, 0)
        )
        sts = sts.at[statenames.index('T0')].set(sts[statenames.index('T')])
        sts = jnp.array(sts)
        y_ret = ys[::step]
        return (ts, y_ret, sts)

    return _solve


def solveModelArray(
    cpModel,
    runTime: float,
    states,
    constants,
    dt0: float,
    startTime: float = 0.0,
    returnFrequency: int = 100,
):
    solver = _make_solver(float(runTime), float(dt0), int(returnFrequency), float(startTime))
    return solver(cpModel, states, constants)
    '''
    max_steps=16**7
    dt_fixed= dt0
    dt_dense=1e-2
    t_stabilise=0.0

    ode_solver=diffrax.Euler()
    term = diffrax.ODETerm(cpModel)
    stepsize_controller = diffrax.ConstantStepSize()
    max_steps = int(runTime / dt0)


    # Solve the ODE system
    res = diffrax.diffeqsolve(
        term,
        ode_solver,
        startTime,
        runTime,
        dt0,
        states,
        args=(ode_solver,constants),
        stepsize_controller=stepsize_controller,
        max_steps=max_steps,
        saveat=diffrax.SaveAt(steps=True, dense=True),
    )

    # create the time vector and the dense solution
    t_dense = jnp.linspace(t_stabilise, runTime, int((runTime - t_stabilise) / dt_dense) + 1)
    y_dense = jax.vmap(res.evaluate)(t_dense)

    statenames = cpModel.stateNames
    sts = jnp.array([res.ys[-1][i] for i in range(res.ys.shape[1])])
    sts = sts.at[statenames.index('T')].set(jnp.round(states[statenames.index('T')] + runTime,0))
    sts = sts.at[statenames.index('T0')].set(sts[statenames.index('T')])
    sts = jnp.array(sts)


    # Calculate the derivatives and the outputs
    #deriv = cpModel(t_dense, y_dense, (ode_solver,constants))

    return (res, t_dense, y_dense, sts)
    '''

# Algorithm to run the solver multiple times
def runSolverArray(cpModel, states, constants,simParameters, runsRes, trun, totalRuns = 1, runTime = 1, save=True, printTime = True): 
    breakFlag = False
    statenames = cpModel.stateNames
    for nruns in range(totalRuns):
        # Run the model with the updated states
        dt0 = simParameters['dt']
        t_dense, y_dense, sts = solveModelArray(cpModel, runTime, states, constants, dt0)

        if runsRes == {}:
            runsRes = {key: np.array([]) for key in statenames}
        
        # Concatenate the results of the runs to the previous results
        if save: 
            runsResTmp = {key:y_dense[:,i] for i, key in enumerate(statenames)} 
            runsRes = {key: np.concatenate((runsRes[key] , np.array(value[1:])),axis = 0) for key, value in runsResTmp.items()}
        

        if (printTime and save):
            now = time.time()
            loading_message = str(np.round(now - trun, 4)) + ' -> Run:' + str(nruns) + ' of ' + str(totalRuns-1) + ' completed!'
            if nruns == 0 or nruns == totalRuns-1:
                print(loading_message)
            else:
                print(loading_message, end='\r')
            #sys.stdout.flush()
        if (printTime and (not save)): 
            now = time.time()
            loading_message = str(np.round(now - trun, 4)) + ' -> Ignored Run:' + str(nruns) + ' of ' + str(totalRuns-1) + ' completed!'
            if nruns == 0 or nruns == totalRuns-1:
                print(loading_message)
            else:
                print(loading_message, end='\r')
            #sys.stdout.flush()
        trun = time.time()#1

        # Update the states with the last values of the previous run
        #print(y_dense.shape)
        #states = [y_dense[-1][i] for i in range(y_dense.shape[1])]
        #states[statenames.index('T0')] = states[statenames.index('T')]
        #states = jnp.array(states)
        states = sts

    return runsRes, trun, states

# Algorithm to run the simulation ignoring or not the results
def runSimulationArray(states, cpModel, simulationParams, runsRes, structures,constants):
    trun = time.time()
    runTime = simulationParams['runTime']
    totalRunsToIgnore = simulationParams['runsToIgnore']
    totalRuns = simulationParams['runsToSave']
    printStatus = simulationParams['printStatus']
    modelSimulationParameters = structures['modelStructure']['simulationParameters']

    ###############################################################
    if totalRunsToIgnore > 0:
        runsRes, trun, states = runSolverArray(
                cpModel, 
                states, 
                constants,
                modelSimulationParameters,
                runsRes, 
                trun, 
                totalRunsToIgnore, 
                runTime, 
                save = False, 
                printTime = printStatus,
            )
    ###############################################################
    # TODO add results to HDF5 file
    # Run to get the results
    runsRes, trun, states = runSolverArray(
            cpModel, 
            states, 
            constants,
            modelSimulationParameters,
            runsRes, 
            trun, 
            totalRuns, 
            runTime, 
            save = True, 
            printTime = printStatus,
        )

    return runsRes, states

# Equinox class holding the system of equations for the CardioPulmonary Model to be used by JAX
class CardioPulmonaryModelArray(eqx.Module):
    # region vars
    capacitors: jnp.ndarray
    resistors :jnp.ndarray
    parameterVariation :jnp.ndarray
    connections :jnp.ndarray
    timekeeping : jnp.ndarray
    other :jnp.ndarray

    equationArray: jnp.ndarray
    stateNames: jnp.ndarray
    constantNames: jnp.ndarray
    rk4_idx : jnp.ndarray
    eul_idx : jnp.ndarray

    dt : jnp.ndarray
    # endregion

    def __init__(self,eqDict, namesDict, modelStructure):
        
        self.equationArray = namesDict['equationList']
        self.stateNames = namesDict['stateNames']
        self.constantNames = namesDict['constantNames']

        self.capacitors = eqDict['capacitors']
        self.resistors = eqDict['resistors']
        self.parameterVariation = eqDict['parameterVariation']
        self.connections = eqDict['connections']
        self.timekeeping = eqDict['timekeeping']
        self.other = eqDict['other']

        self.dt = modelStructure['configurations']['simulationParameters']['dt']
        
        self.rk4_idx = namesDict['rk4_idx']
        self.eul_idx = namesDict['eul_idx']
  

    def __call__(
        self,
        t: jnp.ndarray,
        y: jnp.ndarray,
        #args:(tuple[diffrax.AbstractImplicitSolver, np.ndarray]),
        args: np.ndarray,
        return_outputs: bool = False,
    ) -> jnp.ndarray:
        
        dFlow = [mod.derivative(t, y) for mod in self.resistors]
        dPcomponents = [mod.derivative(t, y) for mod in self.capacitors]
        
        
        flow = [mod.flow_rate(t, y) for mod in self.resistors]
        pressuresComponents = [mod.pressure(t, y) for mod in self.capacitors]
        
        i=0
        yTmp = y
        for values in flow:
            yTmp = yTmp.at[i].set(values)
            i += 1
        for values in pressuresComponents:
            yTmp = yTmp.at[i].set(values)
            i += 1
        roundTime = jnp.round(yTmp[-2],4)
        timediff = (jnp.abs(roundTime - yTmp[-2]))/self.dt
        yTmp = yTmp.at[-2].set(roundTime)

        paramDerivatives = [mod.derivative(yTmp, args) for mod in self.parameterVariation]
        dV = [mod.derivative(yTmp, args, t) for mod in self.connections]
        
        dOther = [mod.derivative(yTmp, args, t) for mod in self.other]

        # Calculates the derivatives for the times #################################################################
        triggers = [mod.trigger(yTmp,t) for mod in self.timekeeping]
        timers = [mod.timer(yTmp,t) for mod in self.timekeeping]
        
        tt = [1.0,0.0]
        #tt = [0.9994+timediff,0.0]

        x = jnp.zeros(len(self.stateNames))
        i=0
        for values in dFlow:
            x = x.at[i].set(values)
            i += 1
        for values in dPcomponents:
            x = x.at[i].set(values)
            i += 1
        for values in paramDerivatives:
            x = x.at[i].set(values)
            i += 1
        for values in dOther:
            x = x.at[i].set(values)
            i += 1
        for values in dV:
            x = x.at[i].set(values)
            i += 1
        for values in triggers:
            x = x.at[i].set(values)
            i += 1
        for values in timers:
            x = x.at[i].set(values)
            i += 1
        for values in tt:
            x = x.at[i].set(values)
            i += 1
        
        return x 

# endregion
############################################################################################


############################################################################################
# region Init Methods
# Function to reinitialize an object with new values

def reinitialize(obj, **new_values):
    #print('Reinitialized')
    return dataclasses.replace(obj, **new_values)


def prepareModel(simulationParams, modelStructure):
    equationTypesWithStepOperators = [
        #'Capacitor',
        #'Resistor',
        #'Diode',
        #'Connections',
        #'MovingAverage',
        #'Ramp',
        #'LocalCubicStateController',
        #'LocalCubicController',
        #'ConstantPressure',
        #'ElastanceCapacitor',
        
        'NoController',
        'PeriodicTrigger',
        'CycleIntegrator',
        'CycleKeeper',
        'CycleMax',
        'CycleMin',
        'SubstactStates',
        'LocalSigmoidStateController',
        
        'PolynomialController',
        'ElastanceInputCapacitor',
        
        'SumStates',
        'StiffnessCalculator',
        'ElastanceCalculator',
        'ATP_Prod',
        'ConstantMultiplication',
        'HeldtParamVariation',
        'StressController',
        'ChemicalEquilibrium',
        'ChemicalEquilibriumControllable',
        'OneWayReactionControllable',
    ]


    #modelStructure = initialiseModel(simulationParams)
    # create model objects based on the type of gas exchange method
    _, modelObjects, structures = modelGenerator.initModelObjects(modelStructure)
    states = modelStructure['states']
    dt = modelStructure['configurations']['simulationParameters']['dt']

    ########################################################################################################
    # region generatres: equationList,equationNames,equationType,constantList,constantNames
    equationList = []  # holds the equations
    equationNames = [] # holds the names and therefore order
    equationType = []  # holds the type of equation
    classNames = []  # holds the class names
    for eqType,value in modelObjects.items():
        if ('prefixes') not in eqType and ('constants') not in eqType:
            for eqName, equation in value.items():
                equationList.append(equation)
                equationNames.append(eqName)
                equationType.append(eqType)
                classNames.append(type(equation).__name__)  # Get class name

    constantList = []
    constantNames = []
    for name,constant in modelObjects['constants'].items():
        constantList.append(constant)
        constantNames.append(name)
    
    # endregion
    ########################################################################################################
    
    ########################################################################################################
    # region generates: newStates, updatedY, timeKeeping, newStateNames, mapping

    index_map = {s: [i for i, x in enumerate(equationType) if x == s] for s in set(equationType)}
    #print(index_map)  # Dict with unique strings as keys and lists of indexes as values
    #print('#########################')
    
    eqDict = {}
    stateIdxDict = {}
    for eqType, indexes in index_map.items():
        eqDict[eqType] = []
        stateIdxDict[eqType] = []
        for idx in indexes:
            eqDict[eqType].append(equationList[idx])
            stateIdxDict[eqType].append(equationList[idx].stateIdx)

    #print(stateIdxDict)
    #print('#########################')
    newStateValues = []
    newStateNames = []
    for stateIdx in stateIdxDict['resistors']:
        newStateValues.append(states[stateIdx])
        newStateNames.append(stateIdx)
    for stateIdx in stateIdxDict['capacitors']:
        newStateValues.append(states[stateIdx])
        newStateNames.append(stateIdx)
    for stateIdx in stateIdxDict['parameterVariation']:
        newStateValues.append(states[stateIdx])
        newStateNames.append(stateIdx)
    for stateIdx in stateIdxDict['other']:
        newStateValues.append(states[stateIdx])
        newStateNames.append(stateIdx)
    for stateIdx in stateIdxDict['connections']:
        newStateValues.append(states[stateIdx])
        newStateNames.append(stateIdx)

    updatedY = []
    for stateIdx in stateIdxDict['resistors']:
        updatedY.append(states[stateIdx])
    for stateIdx in stateIdxDict['capacitors']:
        updatedY.append(states[stateIdx])

    timeKeeping = []
    for eq in eqDict['timekeeping']:
        triggerIdx = eq.triggerIdx
        timerIdx = eq.timerIdx
        timeKeeping.append(states[triggerIdx])
        newStateNames.append(triggerIdx)
        timeKeeping.append(states[timerIdx])
        newStateNames.append(timerIdx)

    timeKeeping.append(states['T'])
    newStateNames.append('T')
    timeKeeping.append(states['T0'])
    newStateNames.append('T0')


    #print(len(timeKeeping))
    #print(len(newStates))
    #print(len(updatedY))
    #print(len(stateList))
    #print('_______________________________')

    newStatesMerge = newStateValues + timeKeeping
    #print(len(newStatesMerge))
    #print(stateNames)
    #print(newStateNames)

    # endregion
    ########################################################################################################

    ########################################################################################################
    # region generates: newEquationList
    
    equationListCopy = copy.deepcopy(equationList)
    newEquationList = []
    # Extract class names and internal attributes
    #print('Reinitializing the model array')
    #print(constantNames)
    i = 0
    for obj in equationListCopy:
        class_name = type(obj).__name__  # Get class name
        attributes = vars(obj)  # Get instance attributes
        #print(class_name)
        for varName, varValue in attributes.items(): # loop the class attributes
            if varValue in newStateNames:
                index = newStateNames.index(varValue)
                attributes[varName] = index
            elif varValue in constantNames:
                index = constantNames.index(varValue)
                attributes[varName] = index
            elif (varName == 'fInIdxs') or (varName == 'fOutIdxs'):
                for j in range(len(varValue)):
                    if varValue[j] in newStateNames:
                        index = newStateNames.index(varValue[j])
                        varValue[j] = index
                    elif varValue[j] in constantNames:
                        index = constantNames.index(varValue[j])
                        varValue[j] = index
                attributes[varName] = varValue
        newEquationList.append(reinitialize(obj,**attributes))
        i += 1
    # endregion
    ########################################################################################################

    
    eqDict = {}
    for eqType, indexes in index_map.items():
        eqDict[eqType] = []
        for idx in indexes:
            eqDict[eqType].append(newEquationList[idx])
    
    rk4_idx = []
    eul_idx = []
    for i, eq in enumerate(newEquationList):
        stateIdx = eq.stateIdx
        if type(eq).__name__ not in equationTypesWithStepOperators:
            rk4_idx.append(stateIdx)
        else:
            if type(eq).__name__  == 'PeriodicTrigger':
                triggerIdx = eq.triggerIdx
                eul_idx.append(triggerIdx)
                timerIdx = eq.timerIdx
                eul_idx.append(timerIdx)
            else:
                eul_idx.append(stateIdx)

    eul_idx.append(newStateNames.index('T'))
    eul_idx.append(newStateNames.index('T0'))


    namesDict = {
        'dt': dt,
        'stateNames': newStateNames,
        'constantNames': constantNames,
        'equationList': newEquationList,
        'rk4_idx': rk4_idx,
        'eul_idx': eul_idx,
        'classNames': classNames,
    }

    modelDataDict = {
        'initialStates': newStatesMerge,
        'structures': structures,
        'constantList': constantList,
        'modelObjects': modelObjects,
        'modelStructure': modelStructure,
        'eqDict': eqDict,
    }

    return eqDict, namesDict, modelDataDict  



_CONFIGS_DIR = os.path.join(os.path.dirname(__file__), 'configs')

def initialiseModel(simulationParams):
    metadata = utils.loadJSONfile(os.path.join(_CONFIGS_DIR, 'metadata.json'))
    modelStructure = utils.loadJSONfile(os.path.join(_CONFIGS_DIR, simulationParams['modelFileName']))
    modelStructure['data'] = metadata['data']
    modelStructure['gasRegions'] = metadata['gasRegions']
    modelStructure['configurations']['simulationParameters']['calibration'] = simulationParams['calibration']
    return modelStructure

# endregion
############################################################################################




