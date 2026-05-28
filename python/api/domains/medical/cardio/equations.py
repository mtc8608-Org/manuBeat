import jax.numpy as jnp
import equinox as eqx

# ██████  █████  ██████   █████   ██████ ██ ████████  ██████  ██████  ███████
#██      ██   ██ ██   ██ ██   ██ ██      ██    ██    ██    ██ ██   ██ ██
#██      ███████ ██████  ███████ ██      ██    ██    ██    ██ ██████  ███████
#██      ██   ██ ██      ██   ██ ██      ██    ██    ██    ██ ██   ██      ██
# ██████ ██   ██ ██      ██   ██  ██████ ██    ██     ██████  ██   ██ ███████

##################################################################################################
# region CAPACITORS

# This is the super class for the components of the model that can be considered as a capacitor
# or components that calculate the pressure in the system. all the components that inherit from this class
# must have the pressure function implemented.
# The pressure function is the function that calculates the pressure in the system.
# Eventually a method to calculate the variation of the capacity of the capacitor will be implemented here.
class Capacitor(eqx.Module):
    volIdx: str
    C: str # Here means just the capacity of the capacitor
    biasPIdx: str
    stateIdx:str
    step:float = 1e-3
    unstressedVolumeIdx: str
    children : list
    partialVolumes : list

    def __init__(self,
                 volIdx: str,
                 C: str,
                 biasPIdx: str,
                 stateIdx:str,
                 step:float,
                 unstressedVolumeIdx: str,
                 children : list,
                 partialVolumes : list
                 ):
        self.volIdx = volIdx
        self.C = C
        self.biasPIdx = biasPIdx
        self.stateIdx = stateIdx
        self.step = step
        self.unstressedVolumeIdx = unstressedVolumeIdx
        self.children = children
        self.partialVolumes = partialVolumes

    def pressure(self,t: jnp.ndarray,y) -> jnp.ndarray:

        partialVolumeTotal = 0.0
        for volume in self.partialVolumes:
            partialVolumeTotal += y[volume]
        
        volumeChildren = 0.0
        for child in self.children:
            volumeChildren += y[child]

        #if self.volIdx in y:
        #    selfVolume = y[self.volIdx]
        #else:
        #    selfVolume = 0.0
        
        selfVolume = y[self.volIdx]

        totalVolume = volumeChildren - y[self.unstressedVolumeIdx] + selfVolume + partialVolumeTotal

        pressure = (totalVolume + (y[self.C] * y[self.biasPIdx])) / y[self.C]
        

        return pressure
    
    def derivative(self,t: jnp.ndarray,y) -> jnp.ndarray:

        pressure = self.pressure(t,y)
        dP = (pressure - y[self.stateIdx])/self.step

        return dP

#TODO change to absolute pressure output, not variation of pressure
class CapacitorSelfBreathingThorax(eqx.Module):
    C: str
    uVolIdx: str
    V0: str
    biasPIdx: str
    children : list
    stateIdx:str
    step:float = 1e-3

    def __init__(
            self,
            C: jnp.ndarray,
            uVolIdx: jnp.ndarray,
            V0: jnp.ndarray,
            biasPIdx: jnp.ndarray,
            children : list,
            stateIdx:str,
            step:float = 1e-3,
        ):
    
        self.C = C
        self.uVolIdx = uVolIdx
        self.V0 = V0
        self.biasPIdx = biasPIdx
        self.children = children
        #self.cycle = cycle
        #self.cycleTimer = cycleTimer
        self.stateIdx = stateIdx
        #self.tIns = tIns
        #self.td = td
        self.step = step

    def pressure(self,
                 t: jnp.ndarray,
                 y) -> jnp.ndarray:

        volumeChildren = 0.0
        for child in self.children:
            volumeChildren += y[child]
        volumeCavity = volumeChildren

        uVol = y[self.uVolIdx] + y[self.V0]
        pressure = (volumeCavity - uVol + (y[self.C] * y[self.biasPIdx])) / y[self.C]

        return pressure
    
    ''' OLD V0 FUNCTION
    def v0(self,
                 t: jnp.ndarray,
                 y) -> jnp.ndarray:

        tTrans = y[self.td] * y[self.cycle]
        tInsp = y[self.tIns] * y[self.cycle]
        t0 = y[self.cycleTimer]

        V0Max = y[self.V0MaxIdx]
        V0Min = y[self.V0MinIdx]

        inspiration_condition = t0 <= tInsp
        transition_condition = t0 < (tInsp + tTrans)
        
        inspiration_value = 1 - jnp.cos( (jnp.pi*t0) / tInsp )
        transition_value = 1 + jnp.cos( (jnp.pi*(t0-tInsp)) / (tTrans) )

        expiration_value = V0Min

        def systole_or_diastole():
            value_tmp = jnp.where(inspiration_condition, inspiration_value, transition_value)
            uVol_tmp = V0Min + (((V0Max - V0Min) / 2) * value_tmp)
            return uVol_tmp

        uVol = jnp.where(transition_condition, systole_or_diastole(), expiration_value)

        return uVol
    '''

    def derivative(self,
                t: jnp.ndarray,
                y,
                ) -> jnp.ndarray:
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.stateIdx])/self.step
        return dP

#TODO change to absolute pressure output, not variation of pressure
class ElastanceInputCapacitor(eqx.Module):
    E: str
    V0: str
    V: str
    biasPIdx: str
    stateIdx:str
    step:float = 1e-3

    def __init__(
            self,
            E: jnp.ndarray,
            V0: jnp.ndarray,
            V: jnp.ndarray,
            biasPIdx: jnp.ndarray,
            stateIdx:str,
            step:float = 1e-3,
        ):
    
        self.E = E
        self.V = V
        self.V0 = V0
        self.biasPIdx = biasPIdx
        self.stateIdx = stateIdx
        self.step = step

    def pressure(self,
                 t: jnp.ndarray,
                 y) -> jnp.ndarray:

        uVol = y[self.V0]
        V= y[self.V]
        E = y[self.E]
        pressure = ((V-uVol)*E) + (y[self.biasPIdx])
        #pressure = (uVol + (y[self.C] * y[self.biasPIdx])) / y[self.C]

        return pressure

    def derivative(self,
                t: jnp.ndarray,
                y,
                ) -> jnp.ndarray:
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.stateIdx])/self.step
        return dP


# Class for the elastance capacitor. The elastance capacitor is a capacitor that has a variable capacity.
# This is used to calculate the driving functions of the heart ventricles.
class ElastanceCapacitor(eqx.Module):
    volIdx: str
    biasPIdx: str
    eMaxIdx: str
    eMinIdx: str
    hcIdx: str
    hcTimerIdx: str
    td: str
    tSys: str
    stateIdx:str
    step:float = 1e-3

    def __init__(self,
                 volIdx: jnp.ndarray,
                 biasPIdx: jnp.ndarray,
                 eMaxIdx: jnp.ndarray,
                 eMinIdx: jnp.ndarray,
                 hcIdx: jnp.ndarray,
                 hcTimerIdx: jnp.ndarray,
                 td: jnp.ndarray,
                 tSys: jnp.ndarray,
                 stateIdx:str,
                 step:float = 1e-3,
                 ):
        self.volIdx = volIdx
        self.biasPIdx = biasPIdx
        self.eMaxIdx = eMaxIdx
        self.eMinIdx = eMinIdx
        self.hcIdx = hcIdx
        self.hcTimerIdx = hcTimerIdx
        self.td = td
        self.tSys = tSys
        self.stateIdx = stateIdx
        self.step = step


    def pressure(self,
                 t: jnp.ndarray,
                 y) -> jnp.ndarray:

        elastance = self.elastance(t,y)

        newCapacity = 1/elastance
        pressure = (y[self.volIdx] + (newCapacity * y[self.biasPIdx])) / newCapacity

        return pressure
    
    def elastance(self,
                 t: jnp.ndarray,
                 y
            ) -> jnp.ndarray:

        #elastance = 0.0
        t0 = y[self.hcTimerIdx]
        td = y[self.td] * y[self.hcIdx]
        tSys = y[self.tSys] * y[self.hcIdx]

        Edias = y[self.eMinIdx]
        Esys = y[self.eMaxIdx] + y[self.eMinIdx]
        
        systole_condition = t0 <= tSys
        transition_condition = t0 < (tSys + td)
        
        systole_value = 1 - jnp.cos( (jnp.pi*t0) / tSys )
        transition_value = 1 + jnp.cos( (jnp.pi*(t0-tSys)) / (td) )

        diastole_value = Edias

        # jnp.where(condition, value_if_true, value_if_false)
        def systole_or_diastole():
            value_tmp = jnp.where(systole_condition, systole_value, transition_value)
            elastance_tmp = Edias + (((Esys - Edias) / 2) * value_tmp)
            return elastance_tmp

        elastance = jnp.where(transition_condition, systole_or_diastole(), diastole_value)

        return elastance
    
    def derivative(self,
                t: jnp.ndarray,
                y,
                ) -> jnp.ndarray:
        
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.stateIdx])/self.step
        
        return dP

#################### Special Capacitors ####################

class VentilatorPressure(eqx.Module):
    amplitude: str
    PEEP: str
    rcIdx: str
    rcTimerIdx: str
    I: str
    E: str
    slopeFrac: str
    stateIdx: str
    step: float = 1e-3

    def __init__(self,
                amplitude: str,
                PEEP: str,
                rcIdx: str,
                rcTimerIdx: str,
                I: str,
                E: str,
                slopeFrac: str,
                stateIdx: str,
                step:  str,

                 ):
        self.amplitude = amplitude
        self.PEEP = PEEP
        self.rcIdx = rcIdx
        self.rcTimerIdx = rcTimerIdx
        self.I = I
        self.E = E
        self.slopeFrac = slopeFrac
        self.stateIdx = stateIdx
        self.step = step

    def pressure(self,
                 t: jnp.ndarray,
                 y) -> jnp.ndarray:

        ie = y[self.I] + y[self.E]
        ieRatio = y[self.I] / ie
        slopeFreq = y[self.slopeFrac] / y[self.rcIdx]

        tInsp = (ieRatio) * y[self.rcIdx]  # Inspiration duration (seconds)
        slopeTime = (slopeFreq) * y[self.rcIdx]

        slopeFreq = 1 / slopeTime

        t0 = y[self.rcTimerIdx]

        def cnd2(t000):
            pr1 = y[self.PEEP] + y[self.amplitude] * jnp.sin(0.5 * slopeFreq * jnp.pi * t0)
            pr2 = y[self.PEEP] + y[self.amplitude]
            return jnp.where(t000 < slopeTime, pr1, pr2)

        def cnd1(t00):
            pr2 = y[self.PEEP] + y[self.amplitude] * jnp.cos(0.5 * slopeFreq * jnp.pi * (t0 - (tInsp)))
            return jnp.where(t00 < tInsp, cnd2(t00), pr2)

        pressure = jnp.where(t0 < (tInsp + slopeTime), cnd1(t0) , y[self.PEEP])
        return pressure
    
    def derivative(self,
                t: jnp.ndarray,
                y,
                ) -> jnp.ndarray:
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.stateIdx])/self.step
        return dP

class ConstantPressure(eqx.Module):
    stateIdx:str

    def __init__(self,stateIdx:str):
        self.stateIdx = stateIdx

    def pressure(self,
                 t: jnp.ndarray,
                 y) -> jnp.ndarray:

        return y[self.stateIdx]
    
    def derivative(self,
                t: jnp.ndarray,
                y,
                ) -> jnp.ndarray:
        return 0.0

class FilePressure(eqx.Module):
    name:str
    array: tuple #= eqx.field(static=True)
    step: str
    fileStep: float


    def __init__(self,
                 name: str,
                 array: tuple,
                 step: str,
                 fileStep: float
                 ):
        self.name = name
        self.array = array
        self.step = step
        self.fileStep = fileStep


    def pressure(self,
                 t: jnp.ndarray,
                 y) -> jnp.ndarray:
        index = (t/self.fileStep).astype(int)
        pressure = jnp.array(self.array)[index]
        return pressure
    
    def derivative(self,
                t: jnp.ndarray,
                y,
                ) -> jnp.ndarray:
        
        #index = (t/self.step).astype(int)
        #pressure = jnp.array(self.array)[index]

        pressure = self.pressure(t,y)
        dP = (pressure-y[self.name])/self.step
        return dP

# endregion
#################################################################################################

#██████  ███████ ███████ ██ ███████ ████████  ██████  ██████  ███████
#██   ██ ██      ██      ██ ██         ██    ██    ██ ██   ██ ██
#██████  █████   ███████ ██ ███████    ██    ██    ██ ██████  ███████
#██   ██ ██           ██ ██      ██    ██    ██    ██ ██   ██      ██
#██   ██ ███████ ███████ ██ ███████    ██     ██████  ██   ██ ███████

##################################################################################################
# region RESISTORS

# This is the super class for the components of the model that can be considered as a resistor
# or components that calculate the flow in the system. all the components that inherit from this class
# must have the flow_rate and derivative functions implemented.
# The flow_rate function is the function that calculates the flow in the system.
# The derivative function is the function that calculates the derivative of the flow in the system.
# Eventually a method to calculate the variation of the resistance of the resistor will be implemented here.

############################# Sigmoid code ####################
# u = V1-V2
# expCoef = (-u+0.3)*10
# sigmoid = 1/(1 + np.exp(expCoef))
# # result = ((V1-V2)/params['R']) * sigmoid
###############################################################

class Resistor(eqx.Module):
    rIdx: str
    l: str
    pInIdx: str
    pOutIdx: str
    stateIdx: str
    threshold:str
    inertial: bool
    inputPressure:str
    step:float

    def __init__(
            self, 
            rIdx,
            l, 
            pInIdx, 
            pOutIdx, 
            stateIdx,
            threshold='',
            inertial=False,
            inputPressure='',
            step:float = 1e-3,
        ):

        self.rIdx = rIdx
        self.l = l
        self.pInIdx = pInIdx
        self.pOutIdx = pOutIdx
        self.stateIdx = stateIdx
        self.threshold = threshold
        self.inertial = inertial
        self.inputPressure = inputPressure
        self.step = step

    def flow_rate(
        self,
        t: jnp.ndarray,
        y,
    ) -> jnp.ndarray:
        if self.inertial==False:
            q_flow = (y[self.pInIdx] - y[self.pOutIdx]) / y[self.rIdx]
        else:
            q_flow = y[self.stateIdx]
        return q_flow

    def derivative(
        self,
        t: jnp.ndarray,
        y,
    ) -> jnp.ndarray:
        if self.inertial==False:
            flow = self.flow_rate(t,y)
            dq_dt = (flow - y[self.stateIdx])/self.step
        else:
            dq_dt = (y[self.pInIdx] - y[self.pOutIdx] - y[self.stateIdx] * y[self.rIdx]) / y[self.l]
        return dq_dt

# Class for the diode. The diode is a resistor that has a flow in only one direction.
# This is used to model the heart valves.
# The diode can have enertance or not
#
class Diode(Resistor):
    threshold:str

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def open(
        self,
        y,
    ) -> jnp.ndarray:
        if self.inertial == True:
            return jnp.logical_or(y[self.pInIdx] > y[self.pOutIdx], y[self.stateIdx] > 0.0)
        else:
            return y[self.pInIdx] > (y[self.pOutIdx] + y[self.threshold])

    def flow_rate(
        self,
        t: jnp.ndarray,
        y,
    ) -> jnp.ndarray:

        q_flow = super().flow_rate(t, y)
        # Regardless of inertial valve or not, ignore inertia and consider steady state
        valve_open = y[self.pInIdx] > (y[self.pOutIdx] + y[self.threshold])
        return jnp.where(valve_open, q_flow, 0.0)


    def derivative(
        self,
        t: jnp.ndarray,
        y
    ) -> jnp.ndarray:

        dq_dt = super().derivative(t, y)
        valve_open = self.open(y)
        return jnp.where(valve_open, dq_dt, 0.0)

class ResistorInputPressure(Resistor):
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def flow_rate(
        self,
        t: jnp.ndarray,
        y
    ) -> jnp.ndarray:
        if self.inertial == False:
            pressure = y[self.inputPressure]
            q_flow = (pressure - y[self.pOutIdx]) / y[self.rIdx]
        else:
            q_flow = y[self.stateIdx]
        
        return q_flow

    def derivative(
        self,
        t: jnp.ndarray,
        y
    ) -> jnp.ndarray:
        if self.inertial == False:
            dq_dt = 0.0
        else:
            dq_dt = (y[self.pInIdx] - y[self.pOutIdx] - y[self.stateIdx] * y[self.rIdx]) / y[self.l]
        
        valve_open = self.open(y)
        return jnp.where(valve_open, dq_dt, 0.0)

    def open(
        self,
        y
    ) -> jnp.ndarray:
        if self.inertial == True:
            return jnp.logical_or(y[self.pInIdx] > y[self.pOutIdx], y[self.stateIdx] > y[self.threshold])
        else:
            return y[self.pInIdx] > y[self.pOutIdx] + y[self.threshold]

# endregion
#################################################################################################

# ██████  ██████  ███    ██ ███    ██ ███████  ██████ ████████ ██  ██████  ███    ██ ███████
#██      ██    ██ ████   ██ ████   ██ ██      ██         ██    ██ ██    ██ ████   ██ ██
#██      ██    ██ ██ ██  ██ ██ ██  ██ █████   ██         ██    ██ ██    ██ ██ ██  ██ ███████
#██      ██    ██ ██  ██ ██ ██  ██ ██ ██      ██         ██    ██ ██    ██ ██  ██ ██      ██
# ██████  ██████  ██   ████ ██   ████ ███████  ██████    ██    ██  ██████  ██   ████ ███████

# Class to hold the connections between the components of the model.
# The connections are the components that calculate the variation of the volume in the system.
# The dV function is the function that calculates the variation of the volume in the system.
# TODO I AM USING THE R AND THE TEMPERATURE AS LITERALS, I NEED TO CHANGE THIS TO USE THE VALUES FROM THE SYSTEM
class Connections(eqx.Module):
    fInIdxs: list
    fOutIdxs: list
    pressureIdx: str
    stateIdx: str

    def __init__(self, 
                fInIdxs: list, 
                fOutIdxs: list, 
                pressureIdx: str,
                stateIdx: str = ''
            ):
        
        self.fInIdxs = fInIdxs
        self.fOutIdxs = fOutIdxs
        self.pressureIdx = pressureIdx
        self.stateIdx = stateIdx

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        fInSum = 0.0
        fOutSum = 0.0

        for idx in self.fInIdxs:
            fInSum += y[idx]
        for idx in self.fOutIdxs:
            fOutSum += y[idx]


        dV = fInSum - fOutSum

        return dV

# ██████ ██    ██  ██████ ██      ███████     ████████ ██    ██ ██████  ███████ ███████
#██       ██  ██  ██      ██      ██             ██     ██  ██  ██   ██ ██      ██
#██        ████   ██      ██      █████          ██      ████   ██████  █████   ███████
#██         ██    ██      ██      ██             ██       ██    ██      ██           ██
# ██████    ██     ██████ ███████ ███████        ██       ██    ██      ███████ ███████

##################################################################################################
# region Cycles

# Constant cycle rate
class Cycle(eqx.Module):
    stateIdx: str # Index of the variable that holds the period of the cycle Ex: 'HC', 'RC'
    def __init__(self, stateIdx):
        self.stateIdx = stateIdx

    def dCycle(self,y,t:jnp.ndarray) -> jnp.ndarray:
        return y[self.stateIdx]

class CycleRamp(eqx.Module):
    stateIdx: str # Index of the variable that holds the period of the cycle Ex: 'HC', 'RC'
    rate: float # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    def __init__(self, stateIdx, rate=0.0):
        self.stateIdx = stateIdx
        self.rate = rate

    def dCycle(self,y,t:jnp.ndarray) -> jnp.ndarray:
        return self.rate

class CycleSine(eqx.Module):
    stateIdx: str # Index of the variable that holds the period of the cycle Ex: 'HC', 'RC'
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    amplitude: float # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    changePeriod: float # Frequency of the cycle change Ex: 0.1 for a change of 0.1 Hz
    def __init__(
            self, 
            stateIdx: str,
            initialTimeIdx: str, 
            amplitude: float, 
            changePeriod: float,
        ):
        self.stateIdx = stateIdx
        self.initialTimeIdx = initialTimeIdx
        self.amplitude = amplitude
        self.changePeriod = changePeriod

    def dCycle(self,y,t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        return self.amplitude*jnp.sin(2*jnp.pi*currentAbsoluteTime/self.changePeriod)

# endregion
#################################################################################################

#██████  ███████ ██████  ██  ██████  ██████  ██  ██████     ████████ ██████  ██  ██████   ██████  ███████ ██████  ███████
#██   ██ ██      ██   ██ ██ ██    ██ ██   ██ ██ ██             ██    ██   ██ ██ ██       ██       ██      ██   ██ ██
#██████  █████   ██████  ██ ██    ██ ██   ██ ██ ██             ██    ██████  ██ ██   ███ ██   ███ █████   ██████  ███████
#██      ██      ██   ██ ██ ██    ██ ██   ██ ██ ██             ██    ██   ██ ██ ██    ██ ██    ██ ██      ██   ██      ██
#██      ███████ ██   ██ ██  ██████  ██████  ██  ██████        ██    ██   ██ ██  ██████   ██████  ███████ ██   ██ ███████

class PeriodicTrigger(eqx.Module):
    stateIdx: str # Index of the variable that holds the period of the cycle Ex: 'HC', 'RC'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    timerIdx: str # Index of the variable that holds the timer of the cycle Ex: 'timerHC', 'timerRC'
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    step: float

    def __init__(
            self, 
            stateIdx: str, 
            triggerIdx: str, 
            timerIdx: str,
            initialTimeIdx: str,
            step: float,
            ):
        self.stateIdx = stateIdx
        self.triggerIdx = triggerIdx
        self.timerIdx = timerIdx
        self.initialTimeIdx = initialTimeIdx
        self.step = step

    ###################################################################
    def caseTrueTrigger(self,y) -> jnp.ndarray:
        #return (2.36044/1e-3) # Misterious number to get the right period when using runge kutta 4 solver (Tsit5)
        return y[self.stateIdx]/self.step
    
    def caseFalseTrigger(self,y) -> jnp.ndarray:
        return 0.0

    def trigger(self,y,t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        #currentAbsoluteTime = y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= 0.0
        #condition = currentAbsoluteTime - y[self.triggerIdx] >= -self.step
        return jnp.where(condition, self.caseTrueTrigger(y), self.caseFalseTrigger(y))

    ###################################################################
    # Timer for the cycle
    def caseTrueTimer(self,y) -> jnp.ndarray:
        return -y[self.timerIdx]/self.step
    
    def caseFalseTimer(self,y) -> jnp.ndarray:
        return 1.0

    def timer(self,y,t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        #currentAbsoluteTime = y[self.initialTimeIdx]
        #condition = currentAbsoluteTime - y[self.triggerIdx] >= -self.step
        condition = currentAbsoluteTime - y[self.triggerIdx] >= 0.0
        return jnp.where(condition, self.caseTrueTimer(y), self.caseFalseTimer(y))

#███    ███  █████  ████████ ██   ██      ██████  ████████ ██   ██ ███████ ██████  
#████  ████ ██   ██    ██    ██   ██     ██    ██    ██    ██   ██ ██      ██   ██ 
#██ ████ ██ ███████    ██    ███████     ██    ██    ██    ███████ █████   ██████  
#██  ██  ██ ██   ██    ██    ██   ██     ██    ██    ██    ██   ██ ██      ██   ██ 
#██      ██ ██   ██    ██    ██   ██      ██████     ██    ██   ██ ███████ ██   ██ 

##################################################################################################
# region MATH OTHER
class MovingAverage(eqx.Module):
    stateIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varIn: str # Index of the variable to integrate
    period: str 
    step: float

    def __init__(
            self, 
            stateIdx, 
            varIn, 
            period: str, 
            step: float
            ):
        self.stateIdx = stateIdx
        self.varIn = varIn
        self.step = step
        self.period = period

    def derivative(self, y,constants:dict[str,float], t:jnp.ndarray) -> jnp.ndarray:
        return ((y[self.varIn])/constants[self.period]) - (y[self.stateIdx]/constants[self.period])

class MovingAverageCycle(eqx.Module):
    stateIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varIn: str # Index of the variable to integrate
    period: str 
    step: float

    def __init__(
            self, 
            stateIdx, 
            varIn, 
            period: str, 
            step: float
            ):
        self.stateIdx = stateIdx
        self.varIn = varIn
        self.step = step
        self.period = period

    def derivative(self, y,constants:dict[str,float], t:jnp.ndarray) -> jnp.ndarray:
        #period = constants[self.period]
        period = y[self.period]
        return ((y[self.varIn])/period) - (y[self.stateIdx]/period)

class CycleIntegrator(eqx.Module):
    stateIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varIn: str  # Index of the variable to integrate
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    triggerConditionValue: str # Condition to trigger the cycle Ex: 't > 0.0', 't > 0.0 and t < 0.5'
    step: float

    def __init__(
            self, 
            stateIdx: str, 
            varIn: str,
            initialTimeIdx: str,
            triggerIdx: str,
            triggerConditionValue: float,
            step: float,
            ):
        self.stateIdx = stateIdx
        self.varIn = varIn
        self.initialTimeIdx = initialTimeIdx
        self.triggerIdx = triggerIdx
        self.triggerConditionValue = triggerConditionValue
        self.step = step

    ###################################################################
    def caseTrueIntegrator(self,y) -> jnp.ndarray:
        return -(1/self.step) * y[self.stateIdx]

    def caseFalseIntegrator(self,y) -> jnp.ndarray:
        return y[self.varIn]

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        #currentAbsoluteTime = y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= self.triggerConditionValue
        return jnp.where(condition, self.caseTrueIntegrator(y), self.caseFalseIntegrator(y))

class CycleKeeper(eqx.Module):
    stateIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varIn: str  # Index of the variable to integrate
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    step: float

    def __init__(
            self, 
            stateIdx: str, 
            varIn: str,
            initialTimeIdx: str,
            triggerIdx: str,
            step: float,
            ):
        self.stateIdx = stateIdx
        self.varIn = varIn
        self.initialTimeIdx = initialTimeIdx
        self.triggerIdx = triggerIdx
        self.step = step

    ###################################################################
    def caseTrueKeeper(self,y) -> jnp.ndarray:
        return (1/self.step) * (-y[self.stateIdx] + y[self.varIn])

    def caseFalseKeeper(self,y) -> jnp.ndarray:
        return 0.0

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        #currentAbsoluteTime = y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= -self.step
        return jnp.where(condition, self.caseTrueKeeper(y), self.caseFalseKeeper(y))

class CycleMax(eqx.Module):
    stateIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varIn: str # Index of the variable to integrate
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    step: float

    def __init__(
            self, 
            stateIdx: str, 
            varIn: str,
            initialTimeIdx: str,
            triggerIdx: str,
            step: float,
            ):
        self.stateIdx = stateIdx
        self.varIn = varIn
        self.initialTimeIdx = initialTimeIdx
        self.triggerIdx = triggerIdx
        self.step = step

    ###################################################################
    def caseTrue(self,y) -> jnp.ndarray:
        return (1/self.step) * (-y[self.stateIdx])

    def caseMax(self,y) -> jnp.ndarray:
        return (1/self.step) * (-y[self.stateIdx] + y[self.varIn])

    def caseFalse(self,y) -> jnp.ndarray:
        condition = y[self.varIn] > y[self.stateIdx]
        return jnp.where(condition, self.caseMax(y), 0.0)

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        #currentAbsoluteTime = y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= 0.00#-self.step
        return jnp.where(condition, self.caseTrue(y), self.caseFalse(y))

class CycleMin(eqx.Module):
    stateIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varIn: str # Index of the variable to integrate
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    step: float

    def __init__(
            self, 
            stateIdx: str, 
            varIn: str,
            initialTimeIdx: str,
            triggerIdx: str,
            step: float,
            ):
        self.stateIdx = stateIdx
        self.varIn = varIn
        self.initialTimeIdx = initialTimeIdx
        self.triggerIdx = triggerIdx
        self.step = step

    ###################################################################
    def caseTrue(self,y) -> jnp.ndarray:
        return (1/self.step) * (-y[self.stateIdx] + y[self.varIn])

    def caseMin(self,y) -> jnp.ndarray:
        return (1/self.step) * (-y[self.stateIdx] + y[self.varIn])

    def caseFalse(self,y) -> jnp.ndarray:
        condition = y[self.varIn] < y[self.stateIdx]
        return jnp.where(condition, self.caseMin(y), 0.0)

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        #currentAbsoluteTime = y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= 0.00#-self.step
        return jnp.where(condition, self.caseTrue(y), self.caseFalse(y))

class Constant(eqx.Module):
    def __init__(self):
        pass

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        return 0.0

class SumStates(eqx.Module):
    states: list # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    stateIdx: str
    step: float

    def __init__(self, states, stateIdx,step):
        self.states = states
        self.stateIdx = stateIdx
        self.step = step

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        sumStates = 0.0
        for state in self.states:
            sumStates += y[state]
        
        return (sumStates - y[self.stateIdx])/self.step
    
class SubstactStates(eqx.Module):
    state1: str
    state2: str 
    stateIdx: str
    step: float

    def __init__(self, state1, state2, stateIdx,step):
        self.state1 = state1
        self.state2 = state2
        self.stateIdx = stateIdx
        self.step = step

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        sumStates = y[self.state1] - y[self.state2]
        
        return (sumStates - y[self.stateIdx])/self.step

# its elastance for now!!!!
class StiffnessCalculator(eqx.Module):
    volume: str # id of the volume
    compliance: str # id of the compliance
    V0:str
    stateIdx: str

    step: float

    def __init__(self, volume, compliance, V0,stateIdx, step):
        self.volume = volume
        self.compliance = compliance
        self.V0 = V0
        self.stateIdx = stateIdx

        self.step = step

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        compliance = 1/y[self.compliance] 
        volume = y[self.volume] - y[self.V0]

        radius = jnp.power(volume/(jnp.pi*(4/3)),1/3) 
        stress = (2*jnp.pi*jnp.power(radius,4))/(compliance)

        
        dValue = (stress - y[self.stateIdx])/self.step

        return dValue

class ElastanceCalculator(eqx.Module):
    volume: str # id of the volume
    stiffness: str # id of the compliance
    V0:str
    stateIdx: str

    step: float

    def __init__(self, volume, stiffness, V0,stateIdx, step):
        self.volume = volume
        self.stiffness = stiffness
        self.V0 = V0
        self.stateIdx = stateIdx

        self.step = step

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        stiffness = y[self.stiffness] 
        volume = y[self.volume] - y[self.V0]

        radius = jnp.power(volume/(jnp.pi*(4/3)),1/3) 
        compliance = (2*jnp.pi*jnp.power(radius,4))/(stiffness)
        elastance = 1/compliance
        
        dValue = (elastance - y[self.stateIdx])/self.step

        return dValue

class Ramp(eqx.Module):
    stateIdx: str
    rate: float # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    chemoRegulator: str
    baroRegulator: str
    chemoSensitivity: float
    baroSensitivity: float

    def __init__(
            self, 
            stateIdx,
            chemoRegulator="P_Atm",
            baroRegulator="P_Atm",
            chemoSensitivity=0.0,
            baroSensitivity=0.0,
            rate=0.0, 
            ):
        self.stateIdx = stateIdx
        self.rate = rate
        self.chemoRegulator = chemoRegulator
        self.baroRegulator = baroRegulator
        self.chemoSensitivity = chemoSensitivity
        self.baroSensitivity = baroSensitivity

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        chemoRate = y[self.chemoRegulator] * constants[self.chemoSensitivity]
        baroRate = y[self.baroRegulator] * constants[self.baroSensitivity]
        
        newRate = constants[self.rate] + chemoRate + baroRate
        
        return newRate

class ConstantMultiplication(eqx.Module):
    stateIdx: str

    constant: float
    value: str
    
    step: float

    def __init__(
            self,
            stateIdx: str,
            value: str,
            constant: float,
            step: float
            ):
        self.stateIdx = stateIdx
        self.value = value
        self.constant = constant
        self.step = step

    def derivative(self,y,constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        stepProduction = y[self.value] * self.constant
        return (stepProduction - y[self.stateIdx])/self.step

#TODO change to absolute pressure output, not variation of pressure
class HeldtParamVariation(eqx.Module):
    varMax: str
    varMin: str
    cycle:str
    cycleTimer:str
    stateIdx:str
    t_up:str
    t_down:str
    step:float = 1e-3

    def __init__(self,
                 varMax: jnp.ndarray,
                 varMin: jnp.ndarray,
                 cycle:str,
                 cycleTimer:str,
                 stateIdx:str,
                 t_up:str,
                 t_down:str,
                 step:float = 1e-3,
                 ):
        self.varMax = varMax
        self.varMin = varMin
        self.cycleTimer = cycleTimer
        self.t_up = t_up
        self.t_down = t_down
        self.stateIdx = stateIdx
        self.cycle = cycle
        self.step = step

    
    def derivative(
            self,
            y,
            constants:dict[str,float],
            t:jnp.ndarray) -> jnp.ndarray:

        t_down = y[self.t_down] * y[self.cycle]
        t_up = y[self.t_up] * y[self.cycle]
        t0 = y[self.cycleTimer]

        varMax = y[self.varMax] + y[self.varMin]
        varMin = y[self.varMin]

        up_condition = t0 <= t_up
        down_condition = t0 < (t_up + t_down)
        
        up_value = 1 - jnp.cos( (jnp.pi*t0) / t_up )
        down_value = 1 + jnp.cos( (jnp.pi*(t0-t_up)) / (t_down) )

        recover_value = varMin

        def systole_or_diastole():
            value_tmp = jnp.where(up_condition, up_value, down_value)
            newVarValue = varMin + (((varMax - varMin) / 2) * value_tmp)
            return newVarValue

        newVarValue = jnp.where(down_condition, systole_or_diastole(), recover_value)

        deltaVar = (newVarValue - y[self.stateIdx])/self.step
        return deltaVar

# endregion
#################################################################################################

# ██████  ██████  ███    ██ ████████ ██████   ██████  ██      ██      ███████ ██████  ███████
#██      ██    ██ ████   ██    ██    ██   ██ ██    ██ ██      ██      ██      ██   ██ ██
#██      ██    ██ ██ ██  ██    ██    ██████  ██    ██ ██      ██      █████   ██████  ███████
#██      ██    ██ ██  ██ ██    ██    ██   ██ ██    ██ ██      ██      ██      ██   ██      ██
# ██████  ██████  ██   ████    ██    ██   ██  ██████  ███████ ███████ ███████ ██   ██ ███████

##################################################################################################
# region Controllers
class NoController(eqx.Module):
    stateIdx: str #Ex: 'R_Cs', 'R_Cp'

    def __init__(self, stateIdx):
        self.stateIdx = stateIdx

    def derivative(self,y,constants:dict[str,float]) -> jnp.ndarray:

        varToControl = y[self.stateIdx]

        return 0.0

class LadderController(eqx.Module):
    stateIdx: str
    rate: str # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz


    def __init__(
            self, 
            stateIdx, 
            rate=0.0, 
            ):
        self.stateIdx = stateIdx
        self.rate = rate

    def derivative(self,y,constants:dict[str,float]) -> jnp.ndarray:
        newRate = constants[self.rate] 
        return newRate
    
class SineController(eqx.Module):
    stateIdx: str
    freq: str # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    amplitude: str

    def __init__(
            self, 
            stateIdx, 
            freq=0.0, 
            amplitude=1.0
            ):
        self.stateIdx = stateIdx
        self.freq = freq
        self.amplitude = amplitude

    def derivative(self,y,constants:dict[str,float]) -> jnp.ndarray:
        time = y['T']
        newRate = (constants[self.amplitude]*jnp.cos(constants[self.freq]*time))
        return newRate

class RampController(eqx.Module):
    stateIdx: str
    rate: str # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    chemoRegulator: str
    baroRegulator: str
    chemoSensitivity: float
    baroSensitivity: float

    maxValue: str
    minValue: str

    def __init__(
            self, 
            stateIdx, 
            chemoRegulator,
            baroRegulator,
            chemoSensitivity,
            baroSensitivity,
            maxValue,
            minValue,
            rate=0.0, 
            ):
        self.stateIdx = stateIdx
        self.rate = rate
        self.chemoRegulator = chemoRegulator
        self.baroRegulator = baroRegulator
        self.chemoSensitivity = chemoSensitivity
        self.baroSensitivity = baroSensitivity
        self.maxValue = maxValue
        self.minValue = minValue

    def derivative(self,y,constants:dict[str,float]) -> jnp.ndarray:
        minValue = constants[self.minValue]
        maxValue = constants[self.maxValue]
        currentValue = y[self.stateIdx]
        scalor = minValue

        chemoRate = y[self.chemoRegulator] * constants[self.chemoSensitivity] * scalor
        baroRate = y[self.baroRegulator] * constants[self.baroSensitivity] * scalor
        newRate = constants[self.rate] + chemoRate + baroRate

        dValue = jnp.where(currentValue < minValue, minValue, jnp.where(currentValue > maxValue, -minValue, newRate))
        return dValue

class LocalCubicController(eqx.Module):
    varTargetIdx: str # Ex: 'V_O2_Cs', 'V_O2_Cp' # Index of the variable that holds the target value of the controller
    stateIdx: str # Index of the variable that holds the value to control
    targetValue: float

    maxValue: str
    minValue: str
    cubicFactor: str
    linearFactor: str
    k: str
    offset: str

    step: float

    def __init__(self, varTargetIdx, stateIdx, targetValue, maxValue, minValue, cubicFactor, linearFactor, k, offset, step):
        self.varTargetIdx = varTargetIdx
        self.stateIdx = stateIdx
        self.targetValue = targetValue
        self.maxValue = maxValue
        self.minValue = minValue
        self.cubicFactor = cubicFactor
        self.linearFactor = linearFactor
        self.k = k
        self.offset = offset

        self.step = step

    def derivative(self,y,constants) -> jnp.ndarray:
        varToControl = y[self.stateIdx] 
        varTarget = y[self.varTargetIdx] - constants[self.offset]
        k = constants[self.k]
        targetValue = constants[self.targetValue]

        diff = targetValue - varTarget
        error = jnp.where(
            jnp.abs(targetValue) == 0.0, #condition
            diff,                      # if True
            diff / jnp.abs(targetValue)  # if False
        )
        # Forces the error to be max 1/-1
        error = jnp.where(error<-1.0,-1.0,error)
        error = jnp.where(error>1.0,1.0,error)
        
        rawDerivative = self.cube(error,constants)
        #dValue = rawDerivative * jnp.abs(varToControl)
        dValue = rawDerivative * constants[self.maxValue]

        # bound to max dValue to 1 and min to -1
        maxd = self.step * constants[self.maxValue]
        minValue = constants[self.minValue]
        maxValue = constants[self.maxValue]
        
        # control max derivative
        val = 50.0
        dValue = jnp.where(dValue > maxd * val, maxd * val, jnp.where(dValue < -maxd * val, -maxd * val, dValue))
        
        # control parameter bounds
        dValue = jnp.where(
            varToControl < minValue, 
            maxd, 
            jnp.where(
                varToControl > maxValue, 
                -maxd, 
                dValue
            )
        )

        
        return dValue


    def cube(self,error:float,constants) -> jnp.ndarray:
        cubicFactor = constants[self.cubicFactor] #* (1/jnp.abs(error))
        #cubicFactor = jnp.where(cubicFactor > 100.0, 100.0, cubicFactor)
        linearFactor = constants[self.linearFactor]
        cube = ((error**3) * cubicFactor) + (error * linearFactor) 
        return cube

class LocalCubicStateController(eqx.Module):
    varTargetIdx: str # Ex: 'V_O2_Cs', 'V_O2_Cp' # Index of the variable that holds the target value of the controller
    stateIdx: str # Index of the variable that holds the value to control
    targetValue: float

    maxValue: str
    minValue: str
    cubicFactor: str
    linearFactor: str
    k: str
    offset: str

    step: float

    def __init__(self, varTargetIdx, stateIdx, targetValue, maxValue, minValue, cubicFactor, linearFactor, k, offset, step):
        self.varTargetIdx = varTargetIdx
        self.stateIdx = stateIdx
        self.targetValue = targetValue
        self.maxValue = maxValue
        self.minValue = minValue
        self.cubicFactor = cubicFactor
        self.linearFactor = linearFactor
        self.k = k
        self.offset = offset

        self.step = step

    def derivative(self,y,constants:dict[str,float]) -> jnp.ndarray:
        
        varToControl = y[self.stateIdx] 
        varTarget = y[self.varTargetIdx] - constants[self.offset]
        k = constants[self.k]

        diff = y[self.targetValue] - varTarget
        #error = jnp.abs((diff / varTarget)) # as a percentage of the target value
        error = (diff / jnp.abs(varTarget)) # as a percentage of the target value
        #error = (diff / y[self.targetValue])

        rawDerivative = self.cube(error,constants)
        dValue = rawDerivative * jnp.abs(varToControl)

        # bound to max dValue to 1 and min to -1
        maxd = k * constants[self.maxValue]

        minValue = constants[self.minValue]
        maxValue = constants[self.maxValue]
        
        # control max derivative
        dValue = jnp.where(dValue > maxd, maxd, jnp.where(dValue < -maxd, -maxd, dValue))
        
        # control parameter bounds
        dValue = jnp.where(varToControl < minValue, maxd, jnp.where(varToControl > maxValue, -maxd, dValue))



        return dValue


    def cube(self,error:float,constants:dict[str,float]) -> jnp.ndarray:
        cubicFactor = constants[self.cubicFactor]
        linearFactor = constants[self.linearFactor]
        cube = (error**3 * cubicFactor) + (error * linearFactor) 
        return cube

## USED for the systolic time controller (ax^2 + bx + c)
class PolynomialController(eqx.Module):
    stateIdx: str
    varTargetIdx: str
    linearFactor: str
    quadraticFactor: str
    dcFactor: str
    step: float

    def __init__(
            self, 
            stateIdx, 
            varTargetIdx,
            linearFactor,
            quadraticFactor,
            dcFactor,
            step = 0.01
            ):
        self.stateIdx = stateIdx
        self.varTargetIdx = varTargetIdx
        self.linearFactor = linearFactor
        self.quadraticFactor = quadraticFactor
        self.dcFactor = dcFactor
        self.step = step

    def derivative(self,y,constants:dict[str,float]) -> jnp.ndarray:
        varToControl = y[self.stateIdx]
        varTarget = y[self.varTargetIdx]
        polynomial = constants[self.dcFactor] + (varTarget * constants[self.linearFactor]) + (varTarget**2 * constants[self.quadraticFactor])
        dValue = (polynomial - varToControl) / self.step
        return dValue

# endregion
#################################################################################################





