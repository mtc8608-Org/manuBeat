import equinox as eqx
import jax.numpy as jnp
import dataclasses
import copy as _copy

'''
 ██████  █████  ██████   █████   ██████ ██ ████████  ██████  ██████  ███████
██      ██   ██ ██   ██ ██   ██ ██      ██    ██    ██    ██ ██   ██ ██
██      ███████ ██████  ███████ ██      ██    ██    ██    ██ ██████  ███████
██      ██   ██ ██      ██   ██ ██      ██    ██    ██    ██ ██   ██      ██
 ██████ ██   ██ ██      ██   ██  ██████ ██    ██     ██████  ██   ██ ███████
'''
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
    pressureName:str
    step:float = 1e-3
    unstressedVolumeIdx: str
    children : list
    partialVolumes : list

    def __init__(self,
                 volIdx: str,
                 C: str,
                 biasPIdx: str,
                 pressureName:str,
                 step:float,
                 unstressedVolumeIdx: str,
                 children : list,
                 partialVolumes : list
                 ):
        self.volIdx = volIdx
        self.C = C
        self.biasPIdx = biasPIdx
        self.pressureName = pressureName
        self.step = step
        self.unstressedVolumeIdx = unstressedVolumeIdx
        self.children = children
        self.partialVolumes = partialVolumes

    def pressure(self,t: jnp.ndarray,y:dict[str,float]) -> jnp.ndarray:

        partialVolumeTotal = 0.0
        for volume in self.partialVolumes:
            partialVolumeTotal += y[volume]
        
        volumeChildren = 0.0
        for child in self.children:
            volumeChildren += y[child]

        # ARRAY-mode fix: the dict idiom `self.volIdx in y` meant "is volIdx a real
        # state". After resolution volIdx is an int iff it mapped to a real slot
        # (otherwise it stays a name string, e.g. 'V_Comp0', which is not a state),
        # so "resolved to an int" is the array-safe equivalent of that membership.
        if isinstance(self.volIdx, int):
            selfVolume = y[self.volIdx]
        else:
            selfVolume = 0.0

        totalVolume = volumeChildren - y[self.unstressedVolumeIdx] + selfVolume + partialVolumeTotal

        pressure = (totalVolume + (y[self.C] * y[self.biasPIdx])) / y[self.C]
        

        return pressure
    
    def dP(self,t: jnp.ndarray,y:dict[str,float]) -> jnp.ndarray:

        pressure = self.pressure(t,y)
        dP = (pressure - y[self.pressureName])/self.step

        return dP

#TODO change to absolute pressure output, not variation of pressure
class CapacitorSelfBreathingThorax(eqx.Module):
    C: str
    uVolIdx: str
    V0: str
    biasPIdx: str
    children : list
    pressureName:str
    step:float = 1e-3

    def __init__(
            self,
            C: jnp.ndarray,
            uVolIdx: jnp.ndarray,
            V0: jnp.ndarray,
            biasPIdx: jnp.ndarray,
            children : list,
            pressureName:str,
            step:float = 1e-3,
        ):
    
        self.C = C
        self.uVolIdx = uVolIdx
        self.V0 = V0
        self.biasPIdx = biasPIdx
        self.children = children
        #self.cycle = cycle
        #self.cycleTimer = cycleTimer
        self.pressureName = pressureName
        #self.tIns = tIns
        #self.td = td
        self.step = step

    def pressure(self,
                 t: jnp.ndarray,
                 y:dict[str,float]) -> jnp.ndarray:

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
                 y:dict[str,float]) -> jnp.ndarray:

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

    def dP(self,
                t: jnp.ndarray,
                y:dict[str,float],
                ) -> jnp.ndarray:
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.pressureName])/self.step
        return dP

#TODO change to absolute pressure output, not variation of pressure
class ElastanceInputCapacitor(eqx.Module):
    E: str
    V0: str
    V: str
    biasPIdx: str
    pressureName:str
    step:float = 1e-3

    def __init__(
            self,
            E: jnp.ndarray,
            V0: jnp.ndarray,
            V: jnp.ndarray,
            biasPIdx: jnp.ndarray,
            pressureName:str,
            step:float = 1e-3,
        ):
    
        self.E = E
        self.V = V
        self.V0 = V0
        self.biasPIdx = biasPIdx
        self.pressureName = pressureName
        self.step = step

    def pressure(self,
                 t: jnp.ndarray,
                 y:dict[str,float]) -> jnp.ndarray:

        uVol = y[self.V0]
        V= y[self.V]
        E = y[self.E]
        pressure = ((V-uVol)*E) + (y[self.biasPIdx])
        #pressure = (uVol + (y[self.C] * y[self.biasPIdx])) / y[self.C]

        return pressure

    def dP(self,
                t: jnp.ndarray,
                y:dict[str,float],
                ) -> jnp.ndarray:
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.pressureName])/self.step
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
    pressureName:str
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
                 pressureName:str,
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
        self.pressureName = pressureName
        self.step = step


    def pressure(self,
                 t: jnp.ndarray,
                 y:dict[str,float]) -> jnp.ndarray:

        elastance = self.elastance(t,y)

        newCapacity = 1/elastance
        pressure = (y[self.volIdx] + (newCapacity * y[self.biasPIdx])) / newCapacity

        return pressure
    
    def elastance(self,
                 t: jnp.ndarray,
                 y:dict[str,float]
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
    
    def dP(self,
                t: jnp.ndarray,
                y:dict[str,float],
                ) -> jnp.ndarray:
        
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.pressureName])/self.step
        
        return dP

class SigmoidCapacitor(eqx.Module):
    volIdx: str
    maxValue: str
    minValue: str
    inflectionPoint: str
    slope: str
    
    
    biasPIdx: str
    unstressedVolumeIdx: str
    children : list
    partialVolumes : list
    pressureName:str
    step:float = 1e-3

    def __init__(
            self,
            volIdx: jnp.ndarray,
            biasPIdx: jnp.ndarray,
            maxValue: str,
            minValue: str,
            inflectionPoint: str,
            slope: str,
            pressureName:str,
            step:float,
            unstressedVolumeIdx: str,
            children : list,
            partialVolumes : list
        ):
    
        self.volIdx = volIdx
        self.maxValue = maxValue
        self.minValue = minValue
        self.inflectionPoint = inflectionPoint
        self.slope = slope
        
        self.biasPIdx = biasPIdx
        self.pressureName = pressureName
        self.step = step
        self.unstressedVolumeIdx = unstressedVolumeIdx
        self.children = children
        self.partialVolumes = partialVolumes


    def pressure(self,
                 t: jnp.ndarray,
                 y:dict[str,float]) -> jnp.ndarray:
        
        partialVolumeTotal = 0.0
        for volume in self.partialVolumes:
            partialVolumeTotal += y[volume]
        
        volumeChildren = 0.0
        for child in self.children:
            volumeChildren += y[child]

        # ARRAY-mode fix: the dict idiom `self.volIdx in y` meant "is volIdx a real
        # state". After resolution volIdx is an int iff it mapped to a real slot
        # (otherwise it stays a name string, e.g. 'V_Comp0', which is not a state),
        # so "resolved to an int" is the array-safe equivalent of that membership.
        if isinstance(self.volIdx, int):
            selfVolume = y[self.volIdx]
        else:
            selfVolume = 0.0

        totalVolume = volumeChildren - y[self.unstressedVolumeIdx] + selfVolume + partialVolumeTotal
        
        newCapacity = self.sigmoid(y)

        pressure = (totalVolume + (newCapacity * y[self.biasPIdx])) / newCapacity
        

        return pressure
    

    def sigmoid(self,y:dict[str,float]) -> jnp.ndarray:
        amplitude = y[self.maxValue] - y[self.minValue]
        offset = y[self.minValue]
        inflectionPoint = y[self.inflectionPoint]
        slope = y[self.slope]

        sigmoid = amplitude / (1 + jnp.exp(slope * (y[self.volIdx] - inflectionPoint))) + offset
        return sigmoid


    def dP(self,
                t: jnp.ndarray,
                y:dict[str,float],
                ) -> jnp.ndarray:
        
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.pressureName])/self.step
        
        return dP

class DoubleSigmoidCapacitor(eqx.Module):
    volIdx: str
    biasPIdx: str
    unstressedVolumeIdx: str
    children : list
    partialVolumes : list
    maxValue: str
    minValue: str
    inflectionPoint: str
    slope: str
    separation: str
    pressureName:str
    step:float = 1e-3

    def __init__(
            self,
            volIdx: jnp.ndarray,
            biasPIdx: jnp.ndarray,
            maxValue: str,
            minValue: str,
            inflectionPoint: str,
            slope: str,
            separation: str,
            pressureName:str,
            step:float,
            unstressedVolumeIdx: str,
            children : list,
            partialVolumes : list
        ):
    
        self.volIdx = volIdx
        self.biasPIdx = biasPIdx
        self.maxValue = maxValue
        self.minValue = minValue
        self.inflectionPoint = inflectionPoint
        self.slope = slope
        self.separation = separation
        self.pressureName = pressureName
        self.step = step
        self.unstressedVolumeIdx = unstressedVolumeIdx
        self.children = children
        self.partialVolumes = partialVolumes


    def pressure(self,
                 t: jnp.ndarray,
                 y:dict[str,float]) -> jnp.ndarray:
        
        partialVolumeTotal = 0.0
        for volume in self.partialVolumes:
            partialVolumeTotal += y[volume]
        
        volumeChildren = 0.0
        for child in self.children:
            volumeChildren += y[child]

        # ARRAY-mode fix: the dict idiom `self.volIdx in y` meant "is volIdx a real
        # state". After resolution volIdx is an int iff it mapped to a real slot
        # (otherwise it stays a name string, e.g. 'V_Comp0', which is not a state),
        # so "resolved to an int" is the array-safe equivalent of that membership.
        if isinstance(self.volIdx, int):
            selfVolume = y[self.volIdx]
        else:
            selfVolume = 0.0

        totalVolume = volumeChildren - y[self.unstressedVolumeIdx] + selfVolume + partialVolumeTotal
        
        newCapacity = self.sigmoid(y)

        pressure = (totalVolume + (newCapacity * y[self.biasPIdx])) / newCapacity
        

        return pressure
    
    def sigmoid(self,y:dict[str,float]) -> jnp.ndarray:
        amplitude = y[self.maxValue] - y[self.minValue]
        offset = y[self.minValue] 
        inflectionPoint = y[self.inflectionPoint]
        slope = y[self.slope]
        separation = y[self.separation]
        intersection = inflectionPoint + separation/2

        sigmoid_open = amplitude / (1 + jnp.exp(-slope * (y[self.volIdx] - inflectionPoint))) + offset
        sigmoid_strech = amplitude / (1 + jnp.exp(slope * (y[self.volIdx] - (inflectionPoint + separation)))) + offset

        result = jnp.where(y[self.volIdx] < intersection, sigmoid_open, sigmoid_strech)

        return result

    def dP(self,
                t: jnp.ndarray,
                y:dict[str,float],
                ) -> jnp.ndarray:
        
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.pressureName])/self.step
        
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
    pressureName: str
    step: float = 1e-3

    def __init__(self,
                amplitude: str,
                PEEP: str,
                rcIdx: str,
                rcTimerIdx: str,
                I: str,
                E: str,
                slopeFrac: str,
                pressureName: str,
                step:  str,

                 ):
        self.amplitude = amplitude
        self.PEEP = PEEP
        self.rcIdx = rcIdx
        self.rcTimerIdx = rcTimerIdx
        self.I = I
        self.E = E
        self.slopeFrac = slopeFrac
        self.pressureName = pressureName
        self.step = step

    def pressure(self,
                 t: jnp.ndarray,
                 y:dict[str,float]) -> jnp.ndarray:

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
    
    def dP(self,
                t: jnp.ndarray,
                y:dict[str,float],
                ) -> jnp.ndarray:
        pressure = self.pressure(t,y)
        dP = (pressure - y[self.pressureName])/self.step
        return dP

class ConstantPressure(eqx.Module):
    pressureName:str

    def __init__(self,pressureName:str):
        self.pressureName = pressureName

    def pressure(self,
                 t: jnp.ndarray,
                 y:dict[str,float]) -> jnp.ndarray:

        return y[self.pressureName]
    
    def dP(self,
                t: jnp.ndarray,
                y:dict[str,float],
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
                 y:dict[str,float]) -> jnp.ndarray:
        index = (t/self.fileStep).astype(int)
        pressure = jnp.array(self.array)[index]
        return pressure
    
    def dP(self,
                t: jnp.ndarray,
                y:dict[str,float],
                ) -> jnp.ndarray:
        
        #index = (t/self.step).astype(int)
        #pressure = jnp.array(self.array)[index]

        pressure = self.pressure(t,y)
        dP = (pressure-y[self.name])/self.step
        return dP

# endregion
#################################################################################################

'''
██████  ███████ ███████ ██ ███████ ████████  ██████  ██████  ███████
██   ██ ██      ██      ██ ██         ██    ██    ██ ██   ██ ██
██████  █████   ███████ ██ ███████    ██    ██    ██ ██████  ███████
██   ██ ██           ██ ██      ██    ██    ██    ██ ██   ██      ██
██   ██ ███████ ███████ ██ ███████    ██     ██████  ██   ██ ███████
'''
##################################################################################################
# region RESISTORS

# This is the super class for the components of the model that can be considered as a resistor
# or components that calculate the flow in the system. all the components that inherit from this class
# must have the flow_rate and flow_rate_deriv functions implemented.
# The flow_rate function is the function that calculates the flow in the system.
# The flow_rate_deriv function is the function that calculates the derivative of the flow in the system.
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
    flowIdx: str
    threshold:str
    inertial: bool
    inputPressure:str

    def __init__(
            self, 
            rIdx,
            l, 
            pInIdx, 
            pOutIdx, 
            flowIdx,
            threshold='',
            inertial=False,
            inputPressure='',
        ):

        self.rIdx = rIdx
        self.l = l
        self.pInIdx = pInIdx
        self.pOutIdx = pOutIdx
        self.flowIdx = flowIdx
        self.threshold = threshold
        self.inertial = inertial
        self.inputPressure = inputPressure

    def flow_rate(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:
        if not self.inertial:
            q_flow = (p[self.pInIdx] - p[self.pOutIdx]) / y[self.rIdx]
        else:
            q_flow = y[self.flowIdx]
        return q_flow

    def flow_rate_deriv(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:
        if not self.inertial:
            dq_dt = 0.0
        else:
            dq_dt = (p[self.pInIdx] - p[self.pOutIdx] - y[self.flowIdx] * y[self.rIdx]) / y[self.l]
        return dq_dt

# Class for the diode. The diode is a resistor that has a flow in only one direction.
# This is used to model the heart valves.
# The diode can have enertance or not
#
class Diode(Resistor):
    allow_reverse_flow: bool
    threshold:str

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.allow_reverse_flow = False

    def open(
        self,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:
        if self.inertial:
            return jnp.logical_or(p[self.pInIdx] > p[self.pOutIdx], y[self.flowIdx] > 0.0)
        else:
            return p[self.pInIdx] > p[self.pOutIdx] + y[self.threshold]

    def flow_rate(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:

        q_flow = super().flow_rate(t, y, p)
        # Regardless of inertial valve or not, ignore inertia and consider steady state
        valve_open = p[self.pInIdx] > p[self.pOutIdx] + y[self.threshold]
        return jnp.where(valve_open, q_flow, 0.0)


    def flow_rate_deriv(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:

        dq_dt = super().flow_rate_deriv(t, y, p)
        valve_open = self.open(y, p)
        return jnp.where(valve_open, dq_dt, 0.0)

class ResistorInputPressure(Resistor):
    allow_reverse_flow: bool
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.allow_reverse_flow = False

    def flow_rate(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:
        if not self.inertial:
            pressure = y[self.inputPressure]
            q_flow = (pressure - p[self.pOutIdx]) / y[self.rIdx]
        else:
            q_flow = y[self.flowIdx]
        
        return q_flow
        #valve_open = p[self.pInIdx] > p[self.pOutIdx]
        #return jnp.where(valve_open, q_flow, 0.0)

    def flow_rate_deriv(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:
        if not self.inertial:
            dq_dt = 0.0
        else:
            dq_dt = (p[self.pInIdx] - p[self.pOutIdx] - y[self.flowIdx] * y[self.rIdx]) / y[self.l]
        
        valve_open = self.open(y, p)
        return jnp.where(valve_open, dq_dt, 0.0)

    def open(
        self,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:
        if self.inertial:
            return jnp.logical_or(p[self.pInIdx] > p[self.pOutIdx], y[self.flowIdx] > y[self.threshold])
        else:
            return p[self.pInIdx] > p[self.pOutIdx] + y[self.threshold]

class ResistorMultiFlow(eqx.Module):
    rIdx: str
    l: str
    pInIdx: str
    pOutIdx: str
    flowIdx: str
    inertial: bool
    volumes: list
    allow_reverse_flow: bool = False
    threshold:str
    inputPressure:str

    def __init__(
            self, 
            rIdx,
            l, 
            pInIdx, 
            pOutIdx, 
            flowIdx, 
            threshold='',
            inertial=False,
            volumes=[],
            inputPressure='',
            ):
        
        self.rIdx = rIdx
        self.l = l
        self.pInIdx = pInIdx
        self.pOutIdx = pOutIdx
        self.flowIdx = flowIdx
        self.inertial = inertial
        self.volumes = volumes
        self.threshold = threshold
        self.inputPressure = inputPressure

    def flow_rate(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:
        
        volumeTotalIn = 0.0
        for volume in self.volumes['in']:
            volumeTotalIn += y[volume]
        
        volumeTotalOut = 0.0
        for volume in self.volumes['out']:
            volumeTotalOut += y[volume]

        if not self.inertial:
            q_flow = (p[self.pInIdx] - p[self.pOutIdx]) / y[self.rIdx]

            
            def fcn1():
                newFlows = jnp.array([q_flow * (y[volume] / volumeTotalIn) for volume in self.volumes['in']])
                return newFlows
            
            def fcn2():
                newFlows = jnp.array([q_flow * (y[volume] / volumeTotalOut) for volume in self.volumes['out']])
                return newFlows

            newFlows = jnp.where(q_flow > 0.0, fcn1(), fcn2())
        
        return newFlows #q_flow

class DiodeMultiFlow(ResistorMultiFlow):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def flow_rate(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:

        q_flow = super().flow_rate(t, y, p)
        valve_open = p[self.pInIdx] > p[self.pOutIdx] + y[self.threshold]

        return jnp.array([jnp.where(valve_open, q_flow[i], 0.0) for i in range(len(q_flow))])
    
class ResistorInputPressureMultiFlow(ResistorMultiFlow):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def flow_rate(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        p:dict[str,float]
    ) -> jnp.ndarray:

        volumeTotalIn = 0.0
        for volume in self.volumes['in']:
            volumeTotalIn += y[volume]
        
        volumeTotalOut = 0.0
        for volume in self.volumes['out']:
            volumeTotalOut += y[volume]

        if not self.inertial:
            pressure = y[self.inputPressure]
            q_flow = (pressure - y[self.pOutIdx]) / y[self.rIdx]

            
            def fcn1():
                newFlows = jnp.array([q_flow * (y[volume] / volumeTotalIn) for volume in self.volumes['in']])
                return newFlows
            
            def fcn2():
                newFlows = jnp.array([q_flow * (y[volume] / volumeTotalOut) for volume in self.volumes['out']])
                return newFlows

            newFlows = jnp.where(q_flow > 0.0, fcn1(), fcn2())
        return newFlows

class ResistorAlveoli(eqx.Module):
    cInIdx: str
    volInIdx: str
    cOutIdx: str
    volOutIdx: str
    flowIdx: str
    
    area: str
    diffusion: str
    thickness: str
    solubility: str
    
    threshold:str
    inertial: bool
    
    step: float = 1e-3

    def __init__(
            self, 
            cInIdx, 
            volInIdx,
            cOutIdx, 
            volOutIdx,
            flowIdx,

            area,
            diffusion,
            thickness,
            solubility,

            threshold='',
            inertial=False,
            step: float = 1e-3,
        ):

        self.cInIdx = cInIdx
        self.volInIdx = volInIdx
        self.cOutIdx = cOutIdx
        self.volOutIdx = volOutIdx
        self.flowIdx = flowIdx

        self.area = area
        self.diffusion = diffusion
        self.thickness = thickness
        self.solubility = solubility

        self.threshold = threshold
        self.inertial = inertial

    def flow_rate(
        self,
        t: jnp.ndarray,
        y:dict[str,float],
        constants:dict[str,float]
    ) -> jnp.ndarray:
        
        cAlveoli = y[self.cInIdx] 
        cBlood = y[self.cOutIdx]

        # Fick's law of diffusion
        q_flow = (y[self.area] * constants[self.diffusion] * constants[self.solubility] * (cAlveoli - cBlood)) / y[self.thickness]

        return q_flow
        #return jnp.where(q_flow > 0.0, q_flow*y[self.volInIdx]/1000, q_flow*y[self.volOutIdx]/1000)
# endregion
#################################################################################################

'''
 ██████  ██████  ███    ██ ███    ██ ███████  ██████ ████████ ██  ██████  ███    ██ ███████
██      ██    ██ ████   ██ ████   ██ ██      ██         ██    ██ ██    ██ ████   ██ ██
██      ██    ██ ██ ██  ██ ██ ██  ██ █████   ██         ██    ██ ██    ██ ██ ██  ██ ███████
██      ██    ██ ██  ██ ██ ██  ██ ██ ██      ██         ██    ██ ██    ██ ██  ██ ██      ██
 ██████  ██████  ██   ████ ██   ████ ███████  ██████    ██    ██  ██████  ██   ████ ███████
'''
# Class to hold the connections between the components of the model.
# The connections are the components that calculate the variation of the volume in the system.
# The dV function is the function that calculates the variation of the volume in the system.
# TODO I AM USING THE R AND THE TEMPERATURE AS LITERALS, I NEED TO CHANGE THIS TO USE THE VALUES FROM THE SYSTEM
class Connections(eqx.Module):
    fInIdxs: list
    fOutIdxs: list
    fInMemIdxs: list
    fOutMemIdxs: list
    volInIdx: str
    volOutIdx: str
    pressureIdx: str
    state: str

    def __init__(self, 
                fInIdxs: list, 
                fOutIdxs: list, 
                pressureIdx: str,
                fInMemIdxs: list = [],
                fOutMemIdxs: list = [],
                volInIdx: str = '',
                volOutIdx: str = '',
                state: str = ''
            ):
        
        self.fInIdxs = fInIdxs
        self.fOutIdxs = fOutIdxs
        self.pressureIdx = pressureIdx
        self.fInMemIdxs = fInMemIdxs
        self.fOutMemIdxs = fOutMemIdxs
        self.volInIdx = volInIdx
        self.volOutIdx = volOutIdx
        self.state = state

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        fInSum = 0.0
        fOutSum = 0.0
        fInMemSum = 0.0
        fOutMemSum = 0.0

        for idx in self.fInIdxs:
            fInSum += y[idx]
        for idx in self.fOutIdxs:
            fOutSum += y[idx]

        if self.state == 'gas':
            for idx in self.fInMemIdxs:
                #negativeFlow = y[idx] * (y[self.volInIdx]/y[self.volOutIdx])
                #positiveFlow = y[idx] * (y[self.volOutIdx]/y[self.volInIdx])
                
                #molFlow = jnp.where(y[idx] > 0.0, positiveFlow, negativeFlow)
                #volFlow = (62.36 * 310.15 * (molFlow))/(y[self.pressureIdx])
                #fInMemSum += volFlow
                
                molFlow = y[idx]
                #volFlow = (62.36367 * 310.15 * (molFlow))/(y[self.pressureIdx])
                volFlow = (62.36367 * 310.15 * (molFlow))/(760.0)
                fInMemSum += volFlow
            
            for idx in self.fOutMemIdxs:
                #positiveFlow = y[idx] * (y[self.volInIdx]/y[self.volOutIdx])
                #negativeFlow = y[idx] * (y[self.volOutIdx]/y[self.volInIdx])

                #molFlow = jnp.where(y[idx] > 0.0, positiveFlow, negativeFlow)
                #volFlow = (62.36367 * 310.15 * (molFlow))/(y[self.pressureIdx])
                #fOutMemSum += volFlow
                
                molFlow = y[idx]
                #volFlow = (62.36367 * 310.15 * (molFlow))/(y[self.pressureIdx])
                volFlow = (62.36367 * 310.15 * (molFlow))/(760.0)
                fOutMemSum += volFlow
        
        else:
            for idx in self.fInMemIdxs:
                fInMemSum += y[idx]
            for idx in self.fOutMemIdxs:
                fOutMemSum += y[idx]


        dV = (fInSum + fInMemSum) - (fOutSum + fOutMemSum)

        return dV

'''
 ██████ ██    ██  ██████ ██      ███████     ████████ ██    ██ ██████  ███████ ███████
██       ██  ██  ██      ██      ██             ██     ██  ██  ██   ██ ██      ██
██        ████   ██      ██      █████          ██      ████   ██████  █████   ███████
██         ██    ██      ██      ██             ██       ██    ██      ██           ██
 ██████    ██     ██████ ███████ ███████        ██       ██    ██      ███████ ███████
'''
##################################################################################################
# region Cycles

# Constant cycle rate
class Cycle(eqx.Module):
    cyclePeriodIdx: str # Index of the variable that holds the period of the cycle Ex: 'HC', 'RC'
    def __init__(self, cyclePeriodIdx):
        self.cyclePeriodIdx = cyclePeriodIdx

    def dCycle(self,y:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        return y[self.cyclePeriodIdx]

class CycleRamp(eqx.Module):
    cyclePeriodIdx: str # Index of the variable that holds the period of the cycle Ex: 'HC', 'RC'
    rate: float # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    def __init__(self, cyclePeriodIdx, rate=0.0):
        self.cyclePeriodIdx = cyclePeriodIdx
        self.rate = rate

    def dCycle(self,y:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        return self.rate

class CycleSine(eqx.Module):
    cyclePeriodIdx: str # Index of the variable that holds the period of the cycle Ex: 'HC', 'RC'
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    amplitude: float # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    changePeriod: float # Frequency of the cycle change Ex: 0.1 for a change of 0.1 Hz
    def __init__(
            self, 
            cyclePeriodIdx: str,
            initialTimeIdx: str, 
            amplitude: float, 
            changePeriod: float,
        ):
        self.cyclePeriodIdx = cyclePeriodIdx
        self.initialTimeIdx = initialTimeIdx
        self.amplitude = amplitude
        self.changePeriod = changePeriod

    def dCycle(self,y:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        return self.amplitude*jnp.sin(2*jnp.pi*currentAbsoluteTime/self.changePeriod)




'''
██████  ███████ ██████  ██  ██████  ██████  ██  ██████     ████████ ██████  ██  ██████   ██████  ███████ ██████  ███████
██   ██ ██      ██   ██ ██ ██    ██ ██   ██ ██ ██             ██    ██   ██ ██ ██       ██       ██      ██   ██ ██
██████  █████   ██████  ██ ██    ██ ██   ██ ██ ██             ██    ██████  ██ ██   ███ ██   ███ █████   ██████  ███████
██      ██      ██   ██ ██ ██    ██ ██   ██ ██ ██             ██    ██   ██ ██ ██    ██ ██    ██ ██      ██   ██      ██
██      ███████ ██   ██ ██  ██████  ██████  ██  ██████        ██    ██   ██ ██  ██████   ██████  ███████ ██   ██ ███████
'''

class PeriodicTrigger(eqx.Module):
    cyclePeriodIdx: str # Index of the variable that holds the period of the cycle Ex: 'HC', 'RC'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    timerIdx: str # Index of the variable that holds the timer of the cycle Ex: 'timerHC', 'timerRC'
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    step: float

    def __init__(
            self, 
            cyclePeriodIdx: str, 
            triggerIdx: str, 
            timerIdx: str,
            initialTimeIdx: str,
            step: float,
            ):
        self.cyclePeriodIdx = cyclePeriodIdx
        self.triggerIdx = triggerIdx
        self.timerIdx = timerIdx
        self.initialTimeIdx = initialTimeIdx
        self.step = step

    ###################################################################
    def caseTrueTrigger(self,y:dict[str,float]) -> jnp.ndarray:
        #return (2.36044/1e-3) # Misterious number to get the right period when using runge kutta 4 solver (Tsit5)
        return y[self.cyclePeriodIdx]/self.step
    
    def caseFalseTrigger(self,y:dict[str,float]) -> jnp.ndarray:
        return 0.0

    def trigger(self,y:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= 0.0
        #condition = currentAbsoluteTime - y[self.triggerIdx] >= -self.step
        return jnp.where(condition, self.caseTrueTrigger(y), self.caseFalseTrigger(y))

    ###################################################################
    # Timer for the cycle
    def caseTrueTimer(self,y:dict[str,float]) -> jnp.ndarray:
        return -y[self.timerIdx]/self.step
    
    def caseFalseTimer(self,y:dict[str,float]) -> jnp.ndarray:
        return 1.0

    def timer(self,y:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= -self.step
        #condition = currentAbsoluteTime - y[self.triggerIdx] >= 0.0
        return jnp.where(condition, self.caseTrueTimer(y), self.caseFalseTimer(y))
# endregion
#################################################################################################

'''
 ██████   █████  ███████     ███████ ██   ██  ██████ ██   ██  █████  ███    ██  ██████  ███████
██       ██   ██ ██          ██       ██ ██  ██      ██   ██ ██   ██ ████   ██ ██       ██
██   ███ ███████ ███████     █████     ███   ██      ███████ ███████ ██ ██  ██ ██   ███ █████
██    ██ ██   ██      ██     ██       ██ ██  ██      ██   ██ ██   ██ ██  ██ ██ ██    ██ ██
 ██████  ██   ██ ███████     ███████ ██   ██  ██████ ██   ██ ██   ██ ██   ████  ██████  ███████
'''
##################################################################################################
# region GAS EXCHANGE
class GasTransport(eqx.Module):
    ppName: str
    forwardFlowIn: list
    forwardFlowOut: list
    memForwardFlowIn: list
    memForwardFlowOut: list
    dVConf: dict[str,float]

    def __init__(self, species, gasExchangeconf,dV):
        self.ppName = species
        self.forwardFlowIn = gasExchangeconf['in']
        self.forwardFlowOut = gasExchangeconf['out']
        self.memForwardFlowIn = gasExchangeconf['memIn']
        self.memForwardFlowOut = gasExchangeconf['memOut']
        self.dVConf = dV

    def dP(self,y:dict[str,float],flow:dict[str,float],dV:dict[str,float]) -> jnp.ndarray:

        # region variation due to the flow of blood #########################################################################################
        # calculate the concentration variation due to the flow of blood between compartments
        cPin = 0
        cPout = 0
        for flowId, posConcentation, negConcentation in zip(self.forwardFlowIn['flows'], self.forwardFlowIn['positive'] , self.forwardFlowIn['negative'] ):
            posFLow = cPin + (flow[flowId] * y[posConcentation])
            negFLow = cPin + (flow[flowId] * y[negConcentation])
            cPin = jnp.where(flow[flowId] > 0.0, posFLow, negFLow)
        
        for flowId, posConcentation, negConcentation in zip(self.forwardFlowOut['flows'], self.forwardFlowOut['positive'] , self.forwardFlowOut['negative'] ):
            posFLow = cPout + (flow[flowId] * y[posConcentation])
            negFLow = cPout + (flow[flowId] * y[negConcentation])
            cPout = jnp.where(flow[flowId] > 0.0, posFLow, negFLow)
        # endregion #########################################################################################################################

        # region variation due to the membranes #########################################################################################
        # calculate the concentration variation due to the flow between membranes 
        # --> The flows here should be in mmol/s
        # --> The concentrations here should be in mmol/L
        # --> The volumes here should be in mL
        cMemIn = 0
        cMemOut = 0
        for flowId, posConcentation, negConcentation, posVol, negVol in zip(self.memForwardFlowIn['flows'], self.memForwardFlowIn['positive'] , self.memForwardFlowIn['negative'], self.memForwardFlowIn['positiveVolume'] , self.memForwardFlowIn['negativeVolume'] ):
            positiveFlow = flow[flowId] * (1000/y[posVol])
            negativeFlow = flow[flowId] * (1000/y[posVol])
            cMemIn = cMemIn + jnp.where(flow[flowId] > 0.0, positiveFlow, negativeFlow)
        
        for flowId, posConcentation, negConcentation, posVol, negVol in zip(self.memForwardFlowOut['flows'], self.memForwardFlowOut['positive'] , self.memForwardFlowOut['negative'], self.memForwardFlowOut['positiveVolume'] , self.memForwardFlowOut['negativeVolume'] ):
            positiveFlow = flow[flowId] * (1000/y[posVol])
            negativeFlow = flow[flowId] * (1000/y[posVol])
            cMemOut = cMemOut + jnp.where(flow[flowId] > 0.0, positiveFlow, negativeFlow)
        # endregion #########################################################################################################################    

        # region variation due to the reactions #########################################################################################
        # calculate the concentration variation due to the reactions
        reactions = self.dVConf['reactions']
        cReactions = 0
        for reaction in reactions:
            cReactions = cReactions + y[reaction]
        # endregion ######################################################################################################################

        
        # region FINAL Calculation #########################################################################################
        
        # volume variation ###########################################################
        dVP = dV[self.dVConf['volume']] * y[self.dVConf['concentration']]
        # calculate the concentration variation due to the volume variation
        dPdt = (cPin - cPout - dVP ) / y[self.dVConf['volume']]
        

        # calculate the concentration variation due to the membrane flow #############
        dPdtMem = (cMemIn - cMemOut)

        
        # calculate the concentration variation due to the reactions #################
        #dPdtReact = cReactions / y[self.dVConf['volume']]
        dPdtReact = cReactions

        # endregion ######################################################################################################################
        
        return dPdt + dPdtMem + dPdtReact

class GasTransportTissue(GasTransport):
    def __init__(self, species,dV):
        self.ppName = species
        self.forwardFlowIn = []
        self.forwardFlowOut = []
        self.dVConf = dV

    def dP(self,y:dict[str,float],flow:dict[str,float],dV:dict[str,float]) -> jnp.ndarray:
        return 0.0




################################################################################################
########################## Reactions ###########################################################
################################################################################################
class ChemicalEquilibriumControllable(eqx.Module):
    varName: str
    pdYName: str # the concentration of a particular species in the system
    reactantNames: list
    productNames: list
    ratio: float
    k: float
    k_ratio: float
    step: float

    def __init__(self, 
                varName: str,
                pdYName: str,
                reactantNames: list,
                productNames: list,
                ratio: float,
                k: float,
                k_ratio: float,
                step
                ):
        self.varName = varName
        self.pdYName = pdYName
        self.reactantNames = reactantNames
        self.productNames = productNames
        self.ratio = ratio
        self.k = k
        self.k_ratio = k_ratio
        self.step = step

    def dP(self,y:dict[str,float]) -> jnp.ndarray:
        k_1 = y[self.k] / y[self.k_ratio]

        reactantProduct = 1
        for reactant in self.reactantNames:
            reactantProduct = reactantProduct * y[reactant]
        
        productProduct = 1
        for product in self.productNames:
            productProduct = productProduct * y[product]

        #reactant_values = jnp.array([y[reactant] for reactant in self.reactantNames])
        #reactantProduct = jnp.prod(reactant_values)

        #product_values = jnp.array([y[product] for product in self.productNames])
        #productProduct = jnp.prod(product_values)

        reactantCalculation = self.ratio*(-y[self.k] * reactantProduct + k_1 * productProduct)
        productCalculation = self.ratio*(y[self.k] * reactantProduct - k_1 * productProduct)
        
        dPdt =  jnp.where(self.pdYName in self.reactantNames, reactantCalculation, productCalculation)
        
        return  (dPdt - y[self.varName])/self.step
    
    
class ChemicalEquilibriumControllableNEW(eqx.Module):
    varName: str
    pdYName: str # the concentration of a particular species in the system
    reactantNames: list
    productNames: list
    reactantStoichiometrics: list
    productStoichiometrics: list
    ratio : float
    k: float
    k_ratio: float
    step: float

    def __init__(self, 
                varName: str,
                pdYName: str,
                reactantNames: list,
                productNames: list,
                reactantStoichiometrics: list,
                productStoichiometrics: list,
                ratio: float,
                k: float,
                k_ratio: float,
                step
                ):
        self.varName = varName
        self.pdYName = pdYName
        self.reactantNames = reactantNames
        self.productNames = productNames
        self.reactantStoichiometrics = reactantStoichiometrics
        self.productStoichiometrics = productStoichiometrics
        self.ratio = ratio
        self.k = k
        self.k_ratio = k_ratio
        self.step = step

    def dP(self,y:dict[str,float]) -> jnp.ndarray:
        k_1 = y[self.k] / y[self.k_ratio]

        reactantProduct = 1
        for reactant,stoichiometric in zip(self.reactantNames,self.reactantStoichiometrics):
            reactantProduct = reactantProduct * (y[reactant] ** stoichiometric)
        
        productProduct = 1
        for product,stoichiometric in zip(self.productNames,self.productStoichiometrics):
            productProduct = productProduct * (y[product] ** stoichiometric)

        reactantCalculation = self.ratio*(-y[self.k] * reactantProduct + k_1 * productProduct)
        productCalculation = self.ratio*(y[self.k] * reactantProduct - k_1 * productProduct)
        
        dPdt =  jnp.where(
            self.pdYName in self.reactantNames, 
            reactantCalculation, 
            productCalculation
        )
        
        return  (dPdt - y[self.varName])/self.step
        #return  dPdt

class OneWayReactionControllable(eqx.Module):
    varName: str
    pdYName: str # the concentration of a particular species in the system
    reactantNames: list
    productNames: list
    ratio: float
    k: float
    step: float

    def __init__(self, 
                varName: str,
                pdYName: str,
                reactantNames: list,
                productNames: list,
                ratio: float,
                k: float,
                step
                ):
        self.varName = varName
        self.pdYName = pdYName
        self.reactantNames = reactantNames
        self.productNames = productNames
        self.ratio = ratio
        self.k = k
        self.step = step

    def dP(self,y:dict[str,float]) -> jnp.ndarray:

        reactantProduct = 1
        for reactant in self.reactantNames:
            reactantProduct = reactantProduct * y[reactant]

        #reactant_values = jnp.array([y[reactant] for reactant in self.reactantNames])
        #reactantProduct = jnp.prod(reactant_values)

        reactantCalculation = self.ratio*(-y[self.k] * reactantProduct)
        productCalculation = self.ratio*(y[self.k] * reactantProduct)
        
        dPdt =  jnp.where(
            self.pdYName in self.reactantNames, 
            reactantCalculation, 
            productCalculation
        )
        
        return  (dPdt - y[self.varName])/self.step

class OneWayReactionControllableNEW(eqx.Module):
    varName: str
    pdYName: str # the concentration of a particular species in the system
    reactantNames: list
    productNames: list
    reactantStoichiometrics: float
    ratio: float
    k: float
    step: float

    def __init__(self, 
                varName: str,
                pdYName: str,
                reactantNames: list,
                productNames: list,
                reactantStoichiometrics: float,
                ratio: float,
                k: float,
                step
                ):
        self.varName = varName
        self.pdYName = pdYName
        self.reactantNames = reactantNames
        self.productNames = productNames
        self.reactantStoichiometrics = reactantStoichiometrics
        self.ratio = ratio
        self.k = k
        self.step = step

    def dP(self,y:dict[str,float]) -> jnp.ndarray:

        reactantProduct = 1
        for reactant, stoichiometric in zip(self.reactantNames,self.reactantStoichiometrics):
            reactantProduct = reactantProduct * (y[reactant] ** stoichiometric)

        reactantCalculation = self.ratio*(-y[self.k] * reactantProduct)
        productCalculation = self.ratio*(y[self.k] * reactantProduct)
        
        dPdt =  jnp.where(
            self.pdYName in self.reactantNames, 
            reactantCalculation, 
            productCalculation
        )
        return  (dPdt - y[self.varName])/self.step
        #return  dPdt
################################################################################################
################################################################################################
################################################################################################

# endregion
#################################################################################################

'''
███    ███  █████  ████████ ██   ██      ██████  ████████ ██   ██ ███████ ██████  
████  ████ ██   ██    ██    ██   ██     ██    ██    ██    ██   ██ ██      ██   ██ 
██ ████ ██ ███████    ██    ███████     ██    ██    ██    ███████ █████   ██████  
██  ██  ██ ██   ██    ██    ██   ██     ██    ██    ██    ██   ██ ██      ██   ██ 
██      ██ ██   ██    ██    ██   ██      ██████     ██    ██   ██ ███████ ██   ██ 
'''
##################################################################################################
# region MATH OTHER
class MovingAverage(eqx.Module):
    processedIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varToProcessIdx: str # Index of the variable to integrate
    period: str 
    step: float

    def __init__(
            self, 
            processedIdx, 
            varToProcessIdx, 
            period: str, 
            step: float
            ):
        self.processedIdx = processedIdx
        self.varToProcessIdx = varToProcessIdx
        self.step = step
        self.period = period

    def derivative(self, y:dict[str,float],constants:dict[str,float], t:jnp.ndarray) -> jnp.ndarray:
        return ((y[self.varToProcessIdx])/constants[self.period]) - (y[self.processedIdx]/constants[self.period])

class MovingAverageCycle(eqx.Module):
    processedIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varToProcessIdx: str # Index of the variable to integrate
    period: str 
    step: float

    def __init__(
            self, 
            processedIdx, 
            varToProcessIdx, 
            period: str, 
            step: float
            ):
        self.processedIdx = processedIdx
        self.varToProcessIdx = varToProcessIdx
        self.step = step
        self.period = period

    def derivative(self, y:dict[str,float],constants:dict[str,float], t:jnp.ndarray) -> jnp.ndarray:
        #period = constants[self.period]
        period = y[self.period]
        return ((y[self.varToProcessIdx])/period) - (y[self.processedIdx]/period)


class CycleIntegrator(eqx.Module):
    processedIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varToProcessIdx: str  # Index of the variable to integrate
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    triggerConditionValue: str # Condition to trigger the cycle Ex: 't > 0.0', 't > 0.0 and t < 0.5'
    step: float

    def __init__(
            self, 
            processedIdx: str, 
            varToProcessIdx: str,
            initialTimeIdx: str,
            triggerIdx: str,
            triggerConditionValue: float,
            step: float,
            ):
        self.processedIdx = processedIdx
        self.varToProcessIdx = varToProcessIdx
        self.initialTimeIdx = initialTimeIdx
        self.triggerIdx = triggerIdx
        self.triggerConditionValue = triggerConditionValue
        self.step = step

    ###################################################################
    def caseTrueIntegrator(self,y:dict[str,float]) -> jnp.ndarray:
        return -(1/self.step) * y[self.processedIdx]

    def caseFalseIntegrator(self,y:dict[str,float]) -> jnp.ndarray:
        return y[self.varToProcessIdx]

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= self.triggerConditionValue
        return jnp.where(condition, self.caseTrueIntegrator(y), self.caseFalseIntegrator(y))

class CycleKeeper(eqx.Module):
    processedIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varToProcessIdx: str  # Index of the variable to integrate
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    step: float

    def __init__(
            self, 
            processedIdx: str, 
            varToProcessIdx: str,
            initialTimeIdx: str,
            triggerIdx: str,
            step: float,
            ):
        self.processedIdx = processedIdx
        self.varToProcessIdx = varToProcessIdx
        self.initialTimeIdx = initialTimeIdx
        self.triggerIdx = triggerIdx
        self.step = step

    ###################################################################
    def caseTrueKeeper(self,y:dict[str,float]) -> jnp.ndarray:
        return (1/self.step) * (-y[self.processedIdx] + y[self.varToProcessIdx])

    def caseFalseKeeper(self,y:dict[str,float]) -> jnp.ndarray:
        return 0.0

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= -self.step
        return jnp.where(condition, self.caseTrueKeeper(y), self.caseFalseKeeper(y))

class CycleMax(eqx.Module):
    processedIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varToProcessIdx: str # Index of the variable to integrate
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    step: float

    def __init__(
            self, 
            processedIdx: str, 
            varToProcessIdx: str,
            initialTimeIdx: str,
            triggerIdx: str,
            step: float,
            ):
        self.processedIdx = processedIdx
        self.varToProcessIdx = varToProcessIdx
        self.initialTimeIdx = initialTimeIdx
        self.triggerIdx = triggerIdx
        self.step = step

    ###################################################################
    def caseTrue(self,y:dict[str,float]) -> jnp.ndarray:
        return (1/self.step) * (-y[self.processedIdx])

    def caseMax(self,y:dict[str,float]) -> jnp.ndarray:
        return (1/self.step) * (-y[self.processedIdx] + y[self.varToProcessIdx])

    def caseFalse(self,y:dict[str,float]) -> jnp.ndarray:
        condition = y[self.varToProcessIdx] > y[self.processedIdx]
        return jnp.where(condition, self.caseMax(y), 0.0)

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= 0.00#-self.step
        return jnp.where(condition, self.caseTrue(y), self.caseFalse(y))

class CycleMin(eqx.Module):
    processedIdx: str # Index of the variable that holds the integrated value of the cycle Ex: 'Hl', 'Rl'
    varToProcessIdx: str # Index of the variable to integrate
    initialTimeIdx: str # Index of the variable that holds the initial time of the cycle Ex: 'T0'
    triggerIdx: str # Index of the variable that holds the trigger of the cycle Ex: 'triggerHC', 'triggerRC'
    step: float

    def __init__(
            self, 
            processedIdx: str, 
            varToProcessIdx: str,
            initialTimeIdx: str,
            triggerIdx: str,
            step: float,
            ):
        self.processedIdx = processedIdx
        self.varToProcessIdx = varToProcessIdx
        self.initialTimeIdx = initialTimeIdx
        self.triggerIdx = triggerIdx
        self.step = step

    ###################################################################
    def caseTrue(self,y:dict[str,float]) -> jnp.ndarray:
        return (1/self.step) * (-y[self.processedIdx] + y[self.varToProcessIdx])

    def caseMin(self,y:dict[str,float]) -> jnp.ndarray:
        return (1/self.step) * (-y[self.processedIdx] + y[self.varToProcessIdx])

    def caseFalse(self,y:dict[str,float]) -> jnp.ndarray:
        condition = y[self.varToProcessIdx] < y[self.processedIdx]
        return jnp.where(condition, self.caseMin(y), 0.0)

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        currentAbsoluteTime = t + y[self.initialTimeIdx]
        condition = currentAbsoluteTime - y[self.triggerIdx] >= 0.00#-self.step
        return jnp.where(condition, self.caseTrue(y), self.caseFalse(y))

class PressureToConcentration(eqx.Module):
    varToProcessIdx: str # Index of the variable to integrate
    pressureIn: str
    volumeIn: str
    temperatureIn: float
    R: float
    step: float

    def __init__(
            self, 
            varToProcessIdx: str, # Index of the variable to integrate
            pressureIn: str,
            volumeIn: str,
            temperatureIn: float,
            R: float,
            step: float,
            ):
        self.varToProcessIdx = varToProcessIdx
        self.pressureIn = pressureIn
        self.volumeIn = volumeIn
        self.temperatureIn = temperatureIn
        self.R = R
        self.step = step

    ###################################################################

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        n = (y[self.pressureIn] * y[self.volumeIn]) / (constants[self.R] * constants[self.temperatureIn])
        c = n / y[self.volumeIn]
        dc = (c - y[self.varToProcessIdx]) / self.step
        return dc

class ConcentrationHenrysLaw(eqx.Module):
    varToProcessIdx: str # Index of the variable to integrate
    pressureIn: str
    partialVolume: str
    volume: str
    V0: str
    C: str
    kh: str
    step: float

    def __init__(
            self, 
            varToProcessIdx: str, # Index of the variable to integrate
            pressureIn: str,
            partialVolume: str,
            volume: str,
            V0: str,
            C: str,
            kh: float,
            step: float,
            ):
        self.varToProcessIdx = varToProcessIdx
        self.pressureIn = pressureIn
        self.partialVolume = partialVolume
        self.volume = volume
        self.V0 = V0
        self.C = C
        self.kh = kh
        self.step = step

    ###################################################################

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        pressure = ((y[self.volume] - y[self.V0]) / y[self.C])+760.0

        pressure = pressure * (y[self.partialVolume]/y[self.volume])
        
        #c = pressure * self.kh
        #dc = (c - y[self.varToProcessIdx]) / self.step
        
        c = y[self.pressureIn] * constants[self.kh]
        dc = (c - y[self.varToProcessIdx]) / self.step

        #dc = ((pressure - y[self.pressureIn]) * self.kh)/ self.step
        
        return dc

class ConvertmmolpH(eqx.Module):
    varToProcessIdx: str # Index of the variable to integrate
    concentrationIn: str
    step: float

    def __init__(
            self, 
            varToProcessIdx: str, # Index of the variable to integrate
            concentrationIn: str,
            step: float,
            ):
        self.varToProcessIdx = varToProcessIdx
        self.concentrationIn = concentrationIn
        self.step = step

    ###################################################################

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        c = y[self.concentrationIn]
        pH = -jnp.log10(c)
        dpH = (pH - y[self.varToProcessIdx]) / self.step

        dph = jnp.where(pH > 0.0, jnp.where(pH > 14.0, 0.0, dpH), 0.0)
        
        return dph

class Constant(eqx.Module):
    def __init__(self):
        pass

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        return 0.0

class RatioStates(eqx.Module):
    numerator_state: str
    denominator_state: str
    varName: str
    step: float
    eps: float

    def __init__(self, numerator_state, denominator_state, varName, step, eps=1e-8):
        self.numerator_state = numerator_state
        self.denominator_state = denominator_state
        self.varName = varName
        self.step = step
        self.eps = eps

    def derivative(
        self,
        y: dict[str, float],
        constants: dict[str, float],
        t: jnp.ndarray
    ) -> jnp.ndarray:
        target_ratio = y[self.numerator_state] / (y[self.denominator_state] + self.eps)
        return (target_ratio - y[self.varName]) / self.step

class SumStates(eqx.Module):
    states: list # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    varName: str
    step: float

    def __init__(self, states, varName,step):
        self.states = states
        self.varName = varName
        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        sumStates = 0.0
        for state in self.states:
            sumStates += y[state]
        
        return (sumStates - y[self.varName])/self.step
    
class SubstactStates(eqx.Module):
    state1: str
    state2: str 
    varName: str
    step: float

    def __init__(self, state1, state2, varName,step):
        self.state1 = state1
        self.state2 = state2
        self.varName = varName
        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        sumStates = y[self.state1] - y[self.state2]
        
        return (sumStates - y[self.varName])/self.step

class Ramp(eqx.Module):
    rate: float # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    chemoRegulator: str
    baroRegulator: str
    chemoSensitivity: float
    baroSensitivity: float

    def __init__(
            self, 
            chemoRegulator="P_Atm",
            baroRegulator="P_Atm",
            chemoSensitivity=0.0,
            baroSensitivity=0.0,
            rate=0.0, 
            ):
        self.rate = rate
        self.chemoRegulator = chemoRegulator
        self.baroRegulator = baroRegulator
        self.chemoSensitivity = chemoSensitivity
        self.baroSensitivity = baroSensitivity

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        chemoRate = y[self.chemoRegulator] * constants[self.chemoSensitivity]
        baroRate = y[self.baroRegulator] * constants[self.baroSensitivity]
        
        newRate = constants[self.rate] + chemoRate + baroRate
        
        return newRate

class ATP_Prod(eqx.Module):
    varName: str
    rateLact: str
    ratioLact: float
    rateOxid: str
    ratioOxid: float
    ratioFat: float
    rateFat: str
    
    step: float

    def __init__(
            self,
            varName: str,
            rateLact: str,
            ratioLact: float,
            rateOxid: str,
            ratioOxid: float,
            rateFat: str,
            ratioFat: float,
            step: float
            ):
        self.varName = varName
        self.rateLact = rateLact
        self.ratioLact = ratioLact
        self.rateOxid = rateOxid
        self.ratioOxid = ratioOxid
        self.rateFat = rateFat
        self.ratioFat = ratioFat
        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        stepProduction = (y[self.rateLact] * self.ratioLact + y[self.rateOxid] * self.ratioOxid)
        stepProduction = stepProduction + y[self.rateFat] * self.ratioFat
        return (stepProduction - y[self.varName])/self.step
    
class ConstantMultiplication(eqx.Module):
    varName: str

    constant: float
    value: str
    
    step: float

    def __init__(
            self,
            varName: str,
            value: str,
            constant: float,
            step: float
            ):
        self.varName = varName
        self.value = value
        self.constant = constant
        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        stepProduction = y[self.value] * self.constant
        return (stepProduction - y[self.varName])/self.step

#TODO change to absolute pressure output, not variation of pressure
class HeldtParamVariation(eqx.Module):
    varMax: str
    varMin: str
    cycle:str
    cycleTimer:str
    varName:str
    t_up:str
    t_down:str
    step:float = 1e-3

    def __init__(self,
                 varMax: jnp.ndarray,
                 varMin: jnp.ndarray,
                 cycle:str,
                 cycleTimer:str,
                 varName:str,
                 t_up:str,
                 t_down:str,
                 step:float = 1e-3,
                 ):
        self.varMax = varMax
        self.varMin = varMin
        self.cycleTimer = cycleTimer
        self.t_up = t_up
        self.t_down = t_down
        self.varName = varName
        self.cycle = cycle
        self.step = step

    
    def derivative(
            self,
            y:dict[str,float],
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

        deltaVar = (newVarValue - y[self.varName])/self.step
        return deltaVar

# endregion
#################################################################################################

'''
 ██████  ██████  ███    ██ ████████ ██████   ██████  ██      ██      ███████ ██████  ███████
██      ██    ██ ████   ██    ██    ██   ██ ██    ██ ██      ██      ██      ██   ██ ██
██      ██    ██ ██ ██  ██    ██    ██████  ██    ██ ██      ██      █████   ██████  ███████
██      ██    ██ ██  ██ ██    ██    ██   ██ ██    ██ ██      ██      ██      ██   ██      ██
 ██████  ██████  ██   ████    ██    ██   ██  ██████  ███████ ███████ ███████ ██   ██ ███████
'''

##################################################################################################
# region Controllers
class NoController(eqx.Module):
    varToControlIdx: str #Ex: 'R_Cs', 'R_Cp'

    def __init__(self, varToControlIdx):
        self.varToControlIdx = varToControlIdx

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:

        varToControl = y[self.varToControlIdx]

        return 0.0

class LadderController(eqx.Module):
    varToControlIdx: str
    rate: str # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz


    def __init__(
            self, 
            varToControlIdx, 
            rate=0.0, 
            ):
        self.varToControlIdx = varToControlIdx
        self.rate = rate

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        newRate = constants[self.rate] 
        return newRate
    
class SineController(eqx.Module):
    varToControlIdx: str
    freq: str # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    amplitude: str

    def __init__(
            self, 
            varToControlIdx, 
            freq=0.0, 
            amplitude=1.0
            ):
        self.varToControlIdx = varToControlIdx
        self.freq = freq
        self.amplitude = amplitude

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        time = y['T']
        newRate = (constants[self.amplitude]*jnp.cos(constants[self.freq]*time))
        return newRate

class RampLocalControllerGated(eqx.Module):
    varToControlIdx: str
    rate: str # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    chemoRegulator: str
    baroRegulator: str
    chemoSensitivity: float
    baroSensitivity: float
    maxValue: str
    minValue: str
    
    localRegulator: str
    localSensitivity: float
    localTarget:str

    gateSlope: str
    edgeFrac: str
    recoveryRate: str
    eps : float


    def __init__(
            self, 
            varToControlIdx, 
            chemoRegulator,
            baroRegulator,
            chemoSensitivity,
            baroSensitivity,
            localRegulator,
            localSensitivity,
            localTarget,
            maxValue,
            minValue,
            rate=0.0, 
            gateSlope=20.0,
            edgeFrac=0.1,
            recoveryRate=1.0,
            eps=1e-8,
            ):
        self.varToControlIdx = varToControlIdx
        self.rate = rate
        self.chemoRegulator = chemoRegulator
        self.baroRegulator = baroRegulator
        self.chemoSensitivity = chemoSensitivity
        self.baroSensitivity = baroSensitivity
        self.localRegulator = localRegulator
        self.localSensitivity = localSensitivity
        self.localTarget = localTarget

        self.maxValue = maxValue
        self.minValue = minValue
        
        self.gateSlope = gateSlope
        self.edgeFrac = edgeFrac
        self.recoveryRate = recoveryRate
        self.eps = eps
    
    def _sigmoid(self, x):
        return 1.0 / (1.0 + jnp.exp(-x))

    def _directional_gate(self, currentValue, minValue, maxValue, rawRate, constants):
        width = jnp.maximum(maxValue - minValue, self.eps)
        z = (currentValue - minValue) / width
        z = jnp.clip(z, 0.0, 1.0)

        # Negative motion should die near the lower bound
        negGate = self._sigmoid(constants[self.gateSlope] * (z - constants[self.edgeFrac]))

        # Positive motion should die near the upper bound
        posGate = self._sigmoid(constants[self.gateSlope] * ((1.0 - constants[self.edgeFrac]) - z))

        gate = jnp.where(rawRate >= 0.0, posGate, negGate)
        return gate


    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        minValue = constants[self.minValue]
        maxValue = constants[self.maxValue]
        currentValue = y[self.varToControlIdx]
        scalor = minValue
        
        chemoRate = y[self.chemoRegulator] * constants[self.chemoSensitivity] * scalor
        baroRate = y[self.baroRegulator] * constants[self.baroSensitivity] * scalor
        
        error = (y[self.localTarget] - y[self.localRegulator])/y[self.localTarget]
        localRate = (error) * constants[self.localSensitivity] * scalor
        newRate = constants[self.rate] + chemoRate + baroRate + localRate

        gate = self._directional_gate(currentValue, minValue, maxValue, newRate, constants)
        gatedRate = newRate * gate

        # Keep the old idea of pushing back inward if numerical integration overshoots
        belowMin = constants[self.recoveryRate] * jnp.abs(maxValue)
        aboveMax = -constants[self.recoveryRate] * jnp.abs(maxValue)

        dValue = jnp.where(
            currentValue < minValue,
            belowMin,
            jnp.where(currentValue > maxValue, aboveMax, gatedRate),
        )
        return dValue


class RampControllerGated(eqx.Module):
    varToControlIdx: str
    rate: str
    chemoRegulator: str
    baroRegulator: str
    chemoSensitivity: str
    baroSensitivity: str

    maxValue: str
    minValue: str

    gateSlope: str
    edgeFrac: str
    recoveryRate: str
    eps : float

    def __init__(
        self,
        varToControlIdx,
        chemoRegulator,
        baroRegulator,
        chemoSensitivity,
        baroSensitivity,
        maxValue,
        minValue,
        rate=0.0,
        gateSlope=20.0,
        edgeFrac=0.1,
        recoveryRate=1.0,
        eps=1e-8,
    ):
        self.varToControlIdx = varToControlIdx
        self.rate = rate
        self.chemoRegulator = chemoRegulator
        self.baroRegulator = baroRegulator
        self.chemoSensitivity = chemoSensitivity
        self.baroSensitivity = baroSensitivity
        self.maxValue = maxValue
        self.minValue = minValue

        self.gateSlope = gateSlope
        self.edgeFrac = edgeFrac
        self.recoveryRate = recoveryRate
        self.eps = eps

    def _sigmoid(self, x):
        return 1.0 / (1.0 + jnp.exp(-x))

    def _directional_gate(self, currentValue, minValue, maxValue, rawRate, constants):
        width = jnp.maximum(maxValue - minValue, self.eps)
        z = (currentValue - minValue) / width
        z = jnp.clip(z, 0.0, 1.0)

        # Negative motion should die near the lower bound
        negGate = self._sigmoid(constants[self.gateSlope] * (z - constants[self.edgeFrac]))

        # Positive motion should die near the upper bound
        posGate = self._sigmoid(constants[self.gateSlope] * ((1.0 - constants[self.edgeFrac]) - z))

        gate = jnp.where(rawRate >= 0.0, posGate, negGate)
        return gate

    def derivative(self, y: dict[str, float], constants: dict[str, float]) -> jnp.ndarray:
        minValue = constants[self.minValue]
        maxValue = constants[self.maxValue]
        currentValue = y[self.varToControlIdx]

        scalor = minValue

        chemoRate = y[self.chemoRegulator] * constants[self.chemoSensitivity] * scalor
        baroRate = y[self.baroRegulator] * constants[self.baroSensitivity] * scalor
        rawRate = constants[self.rate] + chemoRate + baroRate

        gate = self._directional_gate(currentValue, minValue, maxValue, rawRate, constants)
        gatedRate = rawRate * gate

        # Keep the old idea of pushing back inward if numerical integration overshoots
        belowMin = constants[self.recoveryRate] * jnp.abs(minValue)
        aboveMax = -constants[self.recoveryRate] * jnp.abs(minValue)

        dValue = jnp.where(
            currentValue < minValue,
            belowMin,
            jnp.where(currentValue > maxValue, aboveMax, gatedRate),
        )

        return dValue

class RampController(eqx.Module):
    varToControlIdx: str
    rate: str # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    chemoRegulator: str
    baroRegulator: str
    chemoSensitivity: float
    baroSensitivity: float

    maxValue: str
    minValue: str

    def __init__(
            self, 
            varToControlIdx, 
            chemoRegulator,
            baroRegulator,
            chemoSensitivity,
            baroSensitivity,
            maxValue,
            minValue,
            rate=0.0, 
            ):
        self.varToControlIdx = varToControlIdx
        self.rate = rate
        self.chemoRegulator = chemoRegulator
        self.baroRegulator = baroRegulator
        self.chemoSensitivity = chemoSensitivity
        self.baroSensitivity = baroSensitivity
        self.maxValue = maxValue
        self.minValue = minValue

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        minValue = constants[self.minValue]
        maxValue = constants[self.maxValue]
        currentValue = y[self.varToControlIdx]
        scalor = minValue

        chemoRate = y[self.chemoRegulator] * constants[self.chemoSensitivity] * scalor
        baroRate = y[self.baroRegulator] * constants[self.baroSensitivity] * scalor
        newRate = constants[self.rate] + chemoRate + baroRate

        dValue = jnp.where(currentValue < minValue, minValue, jnp.where(currentValue > maxValue, -minValue, newRate))
        return dValue
    

class RampLocalController(eqx.Module):
    varToControlIdx: str
    rate: str # Rate of the cycle change Ex: 0.1 for a change of 0.1 Hz
    chemoRegulator: str
    baroRegulator: str
    chemoSensitivity: float
    baroSensitivity: float
    localRegulator: str
    localSensitivity: float
    localTarget:str

    maxValue: str
    minValue: str

    def __init__(
            self, 
            varToControlIdx, 
            chemoRegulator,
            baroRegulator,
            chemoSensitivity,
            baroSensitivity,
            localRegulator,
            localSensitivity,
            localTarget,
            maxValue,
            minValue,
            rate=0.0, 
            ):
        self.varToControlIdx = varToControlIdx
        self.rate = rate
        self.chemoRegulator = chemoRegulator
        self.baroRegulator = baroRegulator
        self.chemoSensitivity = chemoSensitivity
        self.baroSensitivity = baroSensitivity
        self.localRegulator = localRegulator
        self.localSensitivity = localSensitivity
        self.localTarget = localTarget

        self.maxValue = maxValue
        self.minValue = minValue

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        minValue = constants[self.minValue]
        maxValue = constants[self.maxValue]
        currentValue = y[self.varToControlIdx]
        scalor = minValue
        
        chemoRate = y[self.chemoRegulator] * constants[self.chemoSensitivity] * scalor
        baroRate = y[self.baroRegulator] * constants[self.baroSensitivity] * scalor
        
        error = (y[self.localTarget] - y[self.localRegulator])/y[self.localTarget]
        localRate = (error) * constants[self.localSensitivity] * scalor
        newRate = constants[self.rate] + chemoRate + baroRate + localRate

        dValue = jnp.where(currentValue < minValue, minValue, jnp.where(currentValue > maxValue, -minValue, newRate))
        return dValue


class LocalController(eqx.Module):
    # Index of the variable that holds the target value of the controller
    varTargetIdx: str # Ex: 'V_O2_Cs', 'V_O2_Cp'
    # Index of the variable that holds the value to control
    varToControlIdx: str #Ex: 'R_Cs', 'R_Cp'

    targetValue: str # Target value of the controller Ex: PpO2 = 100 mmHg
    minValueToControl: str # Minimum value of the variable to control Ex: R_Cs = 0.1 mmHg/(ml/min)
    maxValueToControl: str # Maximum value of the variable to control Ex: R_Cs = 0.1 mmHg/(ml/min)
    proportionalConstant: str # Slope of the controller Ex: 0.1 mmHg/(ml/min) / mmHg
    #derivativeConstant: str # Slope of the controller Ex: 0.1 mmHg/(ml/min) / mmHg
    offset: str

    def __init__(self, varTargetIdx, varToControlIdx, targetValue, minValueToControl, maxValueToControl, proportionalConstant=0.0, derivativeConstant=0.0,offset=0.0):
        self.varTargetIdx = varTargetIdx
        self.varToControlIdx = varToControlIdx
        self.targetValue = targetValue
        self.minValueToControl = minValueToControl
        self.maxValueToControl = maxValueToControl
        self.proportionalConstant = proportionalConstant
        self.offset = offset

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        varToControl = y[self.varToControlIdx]
        varTarget = y[self.varTargetIdx] - constants[self.offset]

        def belowMin():
            return jnp.abs(constants[self.proportionalConstant]) * varToControl

        def aboveMax():
            return - jnp.abs(constants[self.proportionalConstant]) * varToControl

        def betweenMinAndMax():
            diff = constants[self.targetValue] - varTarget
            meanError = jnp.abs((diff / varTarget)) #* constants[self.derivativeConstant])

            caseTrue = -constants[self.proportionalConstant] * varToControl * meanError
            caseFalse = +constants[self.proportionalConstant] * varToControl * meanError

            return jnp.where(diff < 0.0 , caseTrue, caseFalse)

        return jnp.where(varToControl < constants[self.minValueToControl], belowMin(), jnp.where(varToControl > constants[self.maxValueToControl], aboveMax(), betweenMinAndMax()))

class LocalStateController(eqx.Module):
    varToControlIdx: str

    # Index of the variable that holds the target value of the controller
    varTargetIdx: str # Ex: 'V_O2_Cs', 'V_O2_Cp'
    # Index of the variable that holds the value to control

    targetValue: str # Target value of the controller Ex: PpO2 = 100 mmHg
    minValueToControl: str # Minimum value of the variable to control Ex: R_Cs = 0.1 mmHg/(ml/min)
    maxValueToControl: str # Maximum value of the variable to control Ex: R_Cs = 0.1 mmHg/(ml/min)
    proportionalConstant: str # Slope of the controller Ex: 0.1 mmHg/(ml/min) / mmHg
    offset: str

    def __init__(self, varTargetIdx, varToControlIdx, targetValue, minValueToControl, maxValueToControl, proportionalConstant=0.0, offset=0.0):
        self.varTargetIdx = varTargetIdx
        self.varToControlIdx = varToControlIdx
        self.targetValue = targetValue
        self.minValueToControl = minValueToControl
        self.maxValueToControl = maxValueToControl
        self.proportionalConstant = proportionalConstant
        self.offset = offset

    def derivative(self, y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:

        varToControl = y[self.varToControlIdx] 
        varTarget = y[self.varTargetIdx] - constants[self.offset]
        targetValue = y[self.targetValue]

        def belowMin():
            return jnp.abs(constants[self.proportionalConstant]) * varToControl

        def aboveMax():
            return - jnp.abs(constants[self.proportionalConstant]) * varToControl

        def betweenMinAndMax():
            diff = targetValue - varTarget
            meanError = jnp.abs(((diff) / varTarget) )#* constants[self.derivativeConstant])

            caseTrue = -constants[self.proportionalConstant] * varToControl * meanError
            caseFalse = +constants[self.proportionalConstant] * varToControl * meanError
            return jnp.where(diff < 0.0, caseTrue, caseFalse)

        return jnp.where(varToControl < constants[self.minValueToControl], belowMin(), jnp.where(varToControl > constants[self.maxValueToControl], aboveMax(), betweenMinAndMax()))


class LocalCubicController(eqx.Module):
    varTargetIdx: str # Ex: 'V_O2_Cs', 'V_O2_Cp' # Index of the variable that holds the target value of the controller
    varToControlIdx: str # Index of the variable that holds the value to control
    targetValue: float

    maxValue: str
    minValue: str
    cubicFactor: str
    linearFactor: str
    k: str
    offset: str

    step: float

    def __init__(self, varTargetIdx, varToControlIdx, targetValue, maxValue, minValue, cubicFactor, linearFactor, k, offset, step):
        self.varTargetIdx = varTargetIdx
        self.varToControlIdx = varToControlIdx
        self.targetValue = targetValue
        self.maxValue = maxValue
        self.minValue = minValue
        self.cubicFactor = cubicFactor
        self.linearFactor = linearFactor
        self.k = k
        self.offset = offset

        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        
        varToControl = y[self.varToControlIdx] 
        varTarget = y[self.varTargetIdx] - constants[self.offset]
        k = constants[self.k]

        diff = constants[self.targetValue] - varTarget
        #error = jnp.abs((diff / varTarget)) # as a percentage of the target value
        error = jnp.where(
            jnp.abs(varTarget) == 0.0, #condition
            diff,                      # if True
            diff / jnp.abs(varTarget)  # if False
        )

        # Forces the error to be max 1/-1
        error = jnp.where(error<-1.0,-1.0,error)
        error = jnp.where(error>1.0,1.0,error)
        
        #error = (diff / jnp.abs(varTarget)) # as a percentage of the target value
        #error = (diff / constants[self.targetValue]) # as a percentage of the target value
        
        rawDerivative = self.cube(error,constants)
        #dValue = rawDerivative * jnp.abs(varToControl)
        dValue = rawDerivative * constants[self.maxValue]

        # bound to max dValue to 1 and min to -1
        maxd = k * constants[self.maxValue]
        #maxd = self.step * constants[self.maxValue]

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

class LocalCubicStateController(eqx.Module):
    varTargetIdx: str # Ex: 'V_O2_Cs', 'V_O2_Cp' # Index of the variable that holds the target value of the controller
    varToControlIdx: str # Index of the variable that holds the value to control
    targetValue: float

    maxValue: str
    minValue: str
    cubicFactor: str
    linearFactor: str
    k: str
    offset: str

    step: float

    def __init__(self, varTargetIdx, varToControlIdx, targetValue, maxValue, minValue, cubicFactor, linearFactor, k, offset, step):
        self.varTargetIdx = varTargetIdx
        self.varToControlIdx = varToControlIdx
        self.targetValue = targetValue
        self.maxValue = maxValue
        self.minValue = minValue
        self.cubicFactor = cubicFactor
        self.linearFactor = linearFactor
        self.k = k
        self.offset = offset

        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        
        varToControl = y[self.varToControlIdx]
        varTarget = y[self.varTargetIdx] - constants[self.offset]
        k = constants[self.k]

        # Per-lane target read from the STATE vector (vs LocalCubicController's constant);
        # everything else matches LocalCubicController.derivative so the two cubic laws are
        # numerically identical (guarded error, +-1 clip, dValue scaled by maxValue).
        diff = y[self.targetValue] - varTarget
        error = jnp.where(
            jnp.abs(varTarget) == 0.0, #condition
            diff,                      # if True
            diff / jnp.abs(varTarget)  # if False
        )

        # Forces the error to be max 1/-1
        error = jnp.where(error<-1.0,-1.0,error)
        error = jnp.where(error>1.0,1.0,error)

        rawDerivative = self.cube(error,constants)
        dValue = rawDerivative * constants[self.maxValue]

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


## USED ON OTHERS
class LocalSigmoidStateController(eqx.Module):
    varName: str # Ex: 'V_O2_Cs', 'V_O2_Cp' # Index of the variable that holds the target value of the controller
    varToControlIdx: str # Index of the variable that holds the value to control

    maxValue: str
    minValue: str
    inflectionPoint: str
    slope: str
    inhibitor: str
    I0 : str

    step: float

    def __init__(self, varName, varToControlIdx, maxValue, minValue, inflectionPoint, slope, inhibitor,I0, step=0.01):
        self.varName = varName
        self.varToControlIdx = varToControlIdx
        
        self.maxValue = maxValue
        self.minValue = minValue
        self.inflectionPoint = inflectionPoint
        self.slope = slope
        self.inhibitor = inhibitor
        self.I0 = I0

        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        value = self.sigmoid(y,constants)

        inhibition = (y[self.inhibitor] - constants[self.I0])/constants[self.I0]
        inhibition = jnp.where(inhibition < 0.0, 0.0, inhibition)
        inhibition = jnp.where(inhibition > 1.0, 1.0, inhibition)
        inhibition = 1 - inhibition
        dValue = value * inhibition

        dValue = (dValue - y[self.varName]) / self.step

        return dValue


    def sigmoid(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        amplitude = constants[self.maxValue] - constants[self.minValue]
        offset = constants[self.minValue]
        inflectionPoint = y[self.inflectionPoint]
        slope = constants[self.slope]

        sigmoid = amplitude / (1 + jnp.exp(-slope * (y[self.varToControlIdx] - inflectionPoint))) + offset
        return sigmoid
## USED ON CONTROLLERS
class LocalSigmoidStateController1(eqx.Module):
    varToControlIdx: str # Ex: 'V_O2_Cs', 'V_O2_Cp' # Index of the variable that holds the target value of the controller
    xAxis: str # Index of the variable that holds the value to control

    maxValue: str
    minValue: str
    inflectionPoint: str
    slope: str
    inhibitor: str
    I0 : str

    step: float

    def __init__(self, varToControlIdx, xAxis, maxValue, minValue, inflectionPoint, slope, inhibitor,I0, step):
        self.varToControlIdx = varToControlIdx
        self.xAxis = xAxis
        
        self.maxValue = maxValue
        self.minValue = minValue
        self.inflectionPoint = inflectionPoint
        self.slope = slope
        self.inhibitor = inhibitor
        self.I0 = I0

        self.step = step

    '''
    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        value = self.sigmoid(y,constants)

        inhibition = (y[self.inhibitor] - constants[self.I0])/y[self.inhibitor]
        inhibition = jnp.where(inhibition <= 0.0, 0.0, inhibition)
        inhibition = jnp.where(inhibition >= 1.0, 1.0, inhibition)
        inhibition = 1 - inhibition

        # If xAxis is below the inflection point, ignore inhibition and let it run fully
        effective_gain = jnp.where(
            y[self.xAxis] < constants[self.inflectionPoint],
            1.0,
            inhibition
        )
        target_value = value * effective_gain
        dValue = (target_value - y[self.varToControlIdx]) / self.step

        #dValue = value * inhibition
        #dValue = (dValue - y[self.varToControlIdx]) / self.step

        return dValue
    '''

    def derivative(self, y: dict[str, float], constants: dict[str, float]) -> jnp.ndarray:
        value = self.sigmoid(y, constants)
        inflection_point = constants[self.inflectionPoint]

        raw_inhibition = (y[self.inhibitor] - constants[self.I0]) / constants[self.I0]
        raw_inhibition = jnp.clip(raw_inhibition, 0.0, 1.0)
        allow_motion = 1.0 - raw_inhibition

        inhibited_target = (
            allow_motion * value + (1.0 - allow_motion) * y[self.varToControlIdx]
        )

        target_value = jnp.where(
            y[self.xAxis] < inflection_point,
            value,
            inhibited_target
        )

        dValue = (target_value - y[self.varToControlIdx]) / self.step
        return dValue


    def sigmoid(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        amplitude = constants[self.maxValue] - constants[self.minValue]
        offset = constants[self.minValue]
        inflectionPoint = constants[self.inflectionPoint]
        slope = constants[self.slope]

        sigmoid = amplitude / (1 + jnp.exp(-slope * (y[self.xAxis] - inflectionPoint))) + offset
        return sigmoid


## USED for the systolic time controller (ax^2 + bx + c)
class PolynomialController(eqx.Module):
    varToControlIdx: str
    varTargetIdx: str
    linearFactor: str
    quadraticFactor: str
    dcFactor: str
    step: float

    def __init__(
            self, 
            varToControlIdx, 
            varTargetIdx,
            linearFactor,
            quadraticFactor,
            dcFactor,
            step = 0.01
            ):
        self.varToControlIdx = varToControlIdx
        self.varTargetIdx = varTargetIdx
        self.linearFactor = linearFactor
        self.quadraticFactor = quadraticFactor
        self.dcFactor = dcFactor
        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        varToControl = y[self.varToControlIdx]
        varTarget = y[self.varTargetIdx]
        polynomial = constants[self.dcFactor] + (varTarget * constants[self.linearFactor]) + (varTarget**2 * constants[self.quadraticFactor])
        dValue = (polynomial - varToControl) / self.step
        return dValue


# endregion
#################################################################################################













##################################################################################################
# region ***NOT IN USE
# Only for compliances
class StressController(eqx.Module):
    varTargetIdx: str # id of the volume
    varToControlIdx: str # id of the compliance
    stressValue: str # id of the stress variable in others
    V0:str

    step: float

    def __init__(self, varTargetIdx, varToControlIdx, stressValue, V0, step):
        self.varTargetIdx = varTargetIdx
        self.varToControlIdx = varToControlIdx
        self.stressValue = stressValue
        self.V0 = V0

        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        
        compliance = y[self.varToControlIdx] 
        volume = y[self.varTargetIdx] - y[self.V0]
        stress = y[self.stressValue]


        radius = jnp.power(volume/(jnp.pi*(4/3)),1/3) 
        complianceNew = (2*jnp.pi*jnp.power(radius,4))/(stress)

        
        dValue = (complianceNew - compliance)/self.step

        return dValue

class ChemicalEquilibrium(eqx.Module):
    varName: str
    pdYName: str # the concentration of a particular species in the system
    reactantNames: list
    productNames: list
    reactantRatio: list
    productRatio: list
    k: float
    k_1: float
    step: float

    def __init__(self, 
                varName: str,
                pdYName: str,
                reactantNames: list,
                productNames: list,
                reactantRatio: list,
                productRatio: list,
                k: float,
                k_1: float,
                step
                ):
        self.varName = varName
        self.pdYName = pdYName
        self.reactantNames = reactantNames
        self.productNames = productNames
        self.reactantRatio = reactantRatio
        self.productRatio = productRatio
        self.k = k
        self.k_1 = k_1
        self.step = step

    def dP(self,y:dict[str,float]) -> jnp.ndarray:
        reactantProduct = 1
        for reactant,ratio in zip(self.reactantNames,self.reactantRatio):
            reactantProduct = reactantProduct * y[reactant] * ratio
        productProduct = 1
        for product,ratio in zip(self.productNames,self.productRatio):
            productProduct = productProduct * y[product] * ratio
        
        
        if self.pdYName in self.reactantNames:
            dPdt = -self.k * reactantProduct + self.k_1 * productProduct
        else:
            dPdt = self.k * reactantProduct - self.k_1 * productProduct

        return  (dPdt - y[self.varName])/self.step
# endregion
#################################################################################################



##################################################################################################
# region NOT IN USE

## not in use
class ProductionRateControllable(eqx.Module):
    varName: str
    pdYName: str # the concentration of a particular species in the system
    reactantNames: list
    productNames: list
    reactantRatio: list
    productRatio: list
    rate: float
    step: float

    def __init__(self, 
                varName: str,
                pdYName: str,
                reactantNames: list,
                productNames: list,
                reactantRatio: list,
                productRatio: list,
                k: float,
                k_1: float,
                step
                ):
        self.varName = varName
        self.pdYName = pdYName
        self.reactantNames = reactantNames
        self.productNames = productNames
        self.reactantRatio = reactantRatio
        self.productRatio = productRatio
        self.k = k
        self.k_1 = k_1
        self.step = step

    def dP(self,y:dict[str,float]) -> jnp.ndarray:
        reactantProduct = 1
        for reactant,ratio in zip(self.reactantNames,self.reactantRatio):
            reactantProduct = reactantProduct * y[reactant] * ratio
        productProduct = 1
        for product,ratio in zip(self.productNames,self.productRatio):
            productProduct = productProduct * y[product] * ratio
        
        
        if self.pdYName in self.reactantNames:
            dPdt = -y[self.k] * reactantProduct + y[self.k_1] * productProduct
        else:
            dPdt = y[self.k] * reactantProduct - y[self.k_1] * productProduct

        return  (dPdt - y[self.varName])/self.step


class LocalSigmoidCTRLController(eqx.Module):
    varTargetIdx: str # Ex: 'V_O2_Cs', 'V_O2_Cp' # Index of the variable that holds the target value of the controller
    varToControlIdx: str # Index of the variable that holds the value to control
    targetValue: float

    maxValue: str
    minValue: str
    slope: str

    step: float

    def __init__(self, varTargetIdx, varToControlIdx, targetValue, maxValue, minValue, slope, step):
        self.varTargetIdx = varTargetIdx
        self.varToControlIdx = varToControlIdx
        self.targetValue = targetValue
        self.maxValue = maxValue
        self.minValue = minValue
        self.slope = slope

        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float]) -> jnp.ndarray:
        
        varToControl = y[self.varToControlIdx]
        varTarget = y[self.varTargetIdx]

        diff = constants[self.targetValue] - varTarget
        #error = jnp.abs((diff / varTarget)) # as a percentage of the target value
        error = (diff / varTarget) # as a percentage of the target value
        

        rawDerivative = self.sigmoid(error,constants)
        dValue = rawDerivative * varToControl

        def belowMin():
            return jnp.abs(constants[self.slope]) * varToControl

        def aboveMax():
            return - jnp.abs(constants[self.slope]) * varToControl
        
        dValue = jnp.where(varToControl < constants[self.minValue], belowMin(), jnp.where(varToControl > constants[self.maxValue], aboveMax(), dValue))




        return dValue


    def sigmoid(self,error:float,constants:dict[str,float]) -> jnp.ndarray:
        '''
        offset	-1
        amplitude	2
        slope	10
        inflectionPoint	0
        y = dc + n / (e^(k*x + d))	
        '''
        amplitude = 2
        offset = -1
        inflectionPoint = 0
        slope = constants[self.slope]

        sigmoid = amplitude / (1 + jnp.exp(-slope * (error - inflectionPoint))) + offset
        return sigmoid

class ElastanceCalculator(eqx.Module):
    volume: str # id of the volume
    stiffness: str # id of the compliance
    V0:str
    varName: str

    step: float

    def __init__(self, volume, stiffness, V0,varName, step):
        self.volume = volume
        self.stiffness = stiffness
        self.V0 = V0
        self.varName = varName

        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        stiffness = y[self.stiffness] 
        volume = y[self.volume] - y[self.V0]

        radius = jnp.power(volume/(jnp.pi*(4/3)),1/3) 
        compliance = (2*jnp.pi*jnp.power(radius,4))/(stiffness)
        elastance = 1/compliance
        
        dValue = (elastance - y[self.varName])/self.step

        return dValue

# its elastance for now!!!!
class StiffnessCalculator(eqx.Module):
    volume: str # id of the volume
    compliance: str # id of the compliance
    V0:str
    varName: str

    step: float

    def __init__(self, volume, compliance, V0,varName, step):
        self.volume = volume
        self.compliance = compliance
        self.V0 = V0
        self.varName = varName

        self.step = step

    def derivative(self,y:dict[str,float],constants:dict[str,float],t:jnp.ndarray) -> jnp.ndarray:
        compliance = 1/y[self.compliance] 
        volume = y[self.volume] - y[self.V0]

        radius = jnp.power(volume/(jnp.pi*(4/3)),1/3) 
        stress = (2*jnp.pi*jnp.power(radius,4))/(compliance)

        
        dValue = (stress - y[self.varName])/self.step

        return dValue
# endregion
#################################################################################################



#############################################################
# region Array-mode resolution contract
#
# In "array mode" the model runs on a single flat jnp vector instead of a
# name-keyed dict. Every equation object is built by the generator holding
# *string names* in its reference fields (e.g. self.pInIdx == 'P_Lt'). Before
# the jitted RHS can run, those names must be swapped for *integer positions*
# into the flat vectors:
#   - state / algebraic names  -> position in the extended state vector  (name2idx)
#   - constant names           -> position in the constants vector       (const2idx)
#
# Resolution is *role-driven*, never value-guessed:
#   - A field listed in CONST_REF_FIELDS[<class>] is resolved against const2idx.
#   - Every other string field is resolved against name2idx (left untouched if
#     it is not a known name, which lets literal flags such as
#     Connections.state == 'gas' pass through harmlessly).
#   - Lists and dicts are walked recursively (dict keys preserved, values
#     resolved) so nested ref-containers resolve in one pass:
#       GasTransport.forwardFlowIn = {'flows':[...], 'positive':[...], ...}
#       GasTransport.dVConf        = {'reactions':[...], 'volume':..., ...}
#       Connections.fInMemIdxs     = [...]
#       ChemicalEquilibrium*.reactantNames / productNames = [...]
#   - Numbers / bools are passed through.
#
# The equation method bodies are *unchanged* from the dict path: they index
# y[self.x] / constants[self.x], which behaves identically whether self.x is a
# string (dict path) or a resolved int (array path). This is why the array
# stack can be built directly on the proven dict equations.
#############################################################

# Per-class fields that index the *constants* vector (auto-extracted by AST from
# every `constants[self.<field>]` site in this module). Field names are reused
# across classes with different meaning (e.g. 'amplitude' is a constant-ref in
# SineController but a literal float in CycleSine), so the map is keyed by class.
CONST_REF_FIELDS = {
    "ResistorAlveoli": ["diffusion", "solubility"],
    "MovingAverage": ["period"],
    "PressureToConcentration": ["R", "temperatureIn"],
    "ConcentrationHenrysLaw": ["kh"],
    "Ramp": ["baroSensitivity", "chemoSensitivity", "rate"],
    "LadderController": ["rate"],
    "SineController": ["amplitude", "freq"],
    "RampLocalControllerGated": ["baroSensitivity", "chemoSensitivity", "edgeFrac", "gateSlope", "localSensitivity", "maxValue", "minValue", "rate", "recoveryRate"],
    "RampControllerGated": ["baroSensitivity", "chemoSensitivity", "edgeFrac", "gateSlope", "maxValue", "minValue", "rate", "recoveryRate"],
    "RampController": ["baroSensitivity", "chemoSensitivity", "maxValue", "minValue", "rate"],
    "RampLocalController": ["baroSensitivity", "chemoSensitivity", "localSensitivity", "maxValue", "minValue", "rate"],
    "LocalController": ["maxValueToControl", "minValueToControl", "offset", "proportionalConstant", "targetValue"],
    "LocalStateController": ["maxValueToControl", "minValueToControl", "offset", "proportionalConstant"],
    "LocalCubicController": ["cubicFactor", "k", "linearFactor", "maxValue", "minValue", "offset", "targetValue"],
    "LocalCubicStateController": ["cubicFactor", "k", "linearFactor", "maxValue", "minValue", "offset"],
    "LocalSigmoidStateController": ["I0", "maxValue", "minValue", "slope"],
    "LocalSigmoidStateController1": ["I0", "inflectionPoint", "maxValue", "minValue", "slope"],
    "PolynomialController": ["dcFactor", "linearFactor", "quadraticFactor"],
    "LocalSigmoidCTRLController": ["maxValue", "minValue", "slope", "targetValue"],
}

# Forward-compatibility only (RK45, handoff Phase 6): classes whose derivative
# divides by self.step ("step operators"). The *active* integrator is plain
# fixed-step Euler over every state (matching the diffrax.Euler dict oracle), so
# this tag does NOT affect integration today — it is metadata for a future
# adaptive solver that must route these states through events / reformulation.
OPERATOR_CLASSES = frozenset({
    "NoController", "PeriodicTrigger",
    "CycleIntegrator", "CycleKeeper", "CycleMax", "CycleMin",
    "SubstactStates", "SumStates",
    "LocalSigmoidStateController", "PolynomialController",
    "ElastanceInputCapacitor", "StiffnessCalculator", "ElastanceCalculator",
    "ATP_Prod", "ConstantMultiplication", "HeldtParamVariation", "StressController",
    "ChemicalEquilibrium", "ChemicalEquilibriumControllable", "ChemicalEquilibriumControllableNEW",
    "OneWayReactionControllable", "OneWayReactionControllableNEW",
})


def _resolveValue(value, name2idx, const2idx, asConst):
    """Recursively swap names -> integer indices.

    asConst selects which index table a *string* leaf is looked up in. Lists and
    dicts are walked (dict keys preserved); numbers/bools pass through.
    """
    if isinstance(value, str):
        table = const2idx if asConst else name2idx
        return table.get(value, value)   # leave unknown strings untouched
    if isinstance(value, list):
        return [_resolveValue(v, name2idx, const2idx, asConst) for v in value]
    if isinstance(value, tuple):
        return tuple(_resolveValue(v, name2idx, const2idx, asConst) for v in value)
    if isinstance(value, dict):
        return {k: _resolveValue(v, name2idx, const2idx, asConst) for k, v in value.items()}
    return value


def resolveEquation(eq, name2idx, const2idx):
    """Return a copy of `eq` with every reference field resolved to int indices.

    Drives off CONST_REF_FIELDS (role-based), not value membership. Constant-ref
    fields are asserted to resolve, surfacing generator/config drift loudly
    instead of failing later inside the jitted RHS.
    """
    clsName = type(eq).__name__
    constFields = set(CONST_REF_FIELDS.get(clsName, ()))
    updates = {}
    for field in dataclasses.fields(eq):
        name = field.name
        raw = getattr(eq, name)
        asConst = name in constFields
        resolved = _resolveValue(raw, name2idx, const2idx, asConst)
        if asConst and isinstance(resolved, str):
            raise KeyError(
                f"{clsName}.{name} = {raw!r} is declared a constant-ref but is "
                f"not in const2idx (constant missing from the model)."
            )
        updates[name] = resolved
    # The dict equations have custom __init__ signatures that do not accept every
    # field as a kwarg, so dataclasses.replace (which re-runs __init__) fails.
    # Build the resolved copy by bypassing __init__: shallow-copy then write the
    # fields directly (equinox Modules are frozen, hence object.__setattr__).
    new = _copy.copy(eq)
    for name, value in updates.items():
        object.__setattr__(new, name, value)
    return new


def describeEquation(eq, idx2name, idx2const=None):
    """Inverse of resolution for debugging: map an equation's resolved int fields
    back to names. `idx2name`/`idx2const` are position->name lists/dicts. Returns
    a plain dict {field: name-or-value} that is safe to print/inspect.
    """
    constFields = set(CONST_REF_FIELDS.get(type(eq).__name__, ()))

    def back(value, asConst):
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            tbl = idx2const if (asConst and idx2const is not None) else idx2name
            try:
                return tbl[value]
            except (IndexError, KeyError, TypeError):
                return value
        if isinstance(value, (list, tuple)):
            return type(value)(back(v, asConst) for v in value)
        if isinstance(value, dict):
            return {k: back(v, asConst) for k, v in value.items()}
        return value

    out = {}
    for field in dataclasses.fields(eq):
        out[field.name] = back(getattr(eq, field.name), field.name in constFields)
    return out

# endregion
#############################################################
