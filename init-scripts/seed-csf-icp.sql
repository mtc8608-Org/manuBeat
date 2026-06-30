-- #region Physiology Simulator · CSF pressure / ICP / CSF flow / CSF stroke volume model seed
-- UUID range: f1XX  (prefix c51c1e5f-5cc1-4b77-8832-2d10cc97f1XX)
-- Clone-and-extend of model_Hr_test (c51c1e5f-...-f000): the original 9-compartment
-- cardiovascular circuit is reused unchanged, plus 5 new compartments modelling
-- CSF formation/flow/absorption and intracranial pressure, driven by the existing
-- cardiac cycle so ICP and CSF flow are genuinely pulsatile.
--
-- New compartments:
--   ChP    (constantPressure) choroid plexus filtration pressure — drives CSF formation
--   Vent   (capacitor) ventricular CSF
--   SAS    (capacitor) subarachnoid space — P_SAS is the clinically-measured ICP
--   Spinal (capacitor) spinal CSF reservoir/compliance
--   CaBV   (capacitor) cerebral arterial blood volume — pulsatile, tapped off `As`
--
-- Monro-Kellie coupling: CaBV's volume is listed in SAS's `regions`, so each heartbeat's
-- arterial inflow physically displaces CSF volume in SAS, producing pulsatile ICP and a
-- real cranio-spinal CSF flow (Q_SAS_Spinal) whose cycle peak-to-peak volume is CSF_SV
-- (CSF stroke volume) — computed with the same cycleMax/cycleMin/cycleKeeper/
-- stateSubstraction primitives the existing model already uses for cardiac stroke volume.
INSERT INTO model_configs (id, name, description, config) VALUES (
    'c51c1e5f-5cc1-4b77-8832-2d10cc97f100',
    'model_Hr_csf_icp',
    'Hr_test cardiovascular circuit extended with CSF formation/flow/absorption and intracranial pressure (ICP = P_SAS), cardiac-cycle-driven for pulsatile ICP and CSF stroke volume.',
    $json${
    "configurations":{
        "simulationParameters": {
            "dt": 0.0005,
            "calibration": true
        }
    },
    "modelParams": {
        "volumeDistribution":{
            "As":0.13,
            "Cs":0.07,
            "Vs":0.61,
            "Vt":0.04,
            "Hr":0.025,
            "Ap":0.04,
            "Cp":0.025,
            "Vp":0.035,
            "Hl":0.025
        },
        "flowDistribution":{
            "R_As_Cs":1.0
        }
    },
    "states":{
        "C_Ap": 1.3902192115783691,
        "C_As": 0.36856532096862793,
        "C_Cp": 1.9572831467819214,
        "C_Cs": 1.389806512069702,
        "C_Vp": 2.3689609675598144,
        "C_Vs": 57.30629348754883,
        "C_Vt": 4.444048255310059,
        "Cyc_HC": 0.4620000123977661,
        "E_Hl": 5.12673282623291,
        "E_Hr": 2.795010566711426,
        "P_Ap": 775.3477136523437,
        "P_As": 816.9201670507813,
        "P_Atm": 760.0,
        "P_Cp": 770.827150390625,
        "P_Cs": 798.05444296875,
        "P_Hl": 770.5801380078125,
        "P_Hr": 766.2743556445313,
        "P_Vp": 770.60802890625,
        "P_Vs": 767.9769934765625,
        "P_Vt": 766.4031402734375,
        "Q_Ap_Cp": 28.63649494873047,
        "Q_As_Cs": 27.526555631103516,
        "Q_Cp_Vp": 21.972659609375,
        "Q_Cs_Vs": 42.3649629272461,
        "Q_Hl_As": 11.108403457117081,
        "Q_Hr_Ap": 3.808596957168579,
        "Q_Vp_Hl": 11.157231249999999,
        "Q_Vs_Vt": 52.563480422058106,
        "Q_Vt_Hr": 25.817875625,
        "R_Ap_Cp": 0.15828544033527375,
        "R_As_Cs": 0.686537504196167,
        "R_Cp_Vp": 0.009999999776482582,
        "R_Cs_Vs": 0.7100801467895508,
        "R_Hl_As": 0.0024999999441206455,
        "R_Hr_Ap": 0.004999999888241291,
        "R_Vp_Hl": 0.0024999999441206455,
        "R_Vs_Vt": 0.029999999329447746,
        "R_Vt_Hr": 0.004999999888241291,
        "T": 0.0,
        "T0": 0.0,
        "Th_Hl_As": 0.0,
        "Th_Hr_Ap": 0.0,
        "Th_Vp_Hl": 0.0,
        "Th_Vt_Hr": 0.0,
        "Tim_HC": 0.3,
        "Trig_HC": 0.3,
        "V0_Ap": 1.0908887386322021,
        "V0_As": 72.0350341796875,
        "V0_Cp": 0.0,
        "V0_Cs": 0.0,
        "V0_Vp": 0.0,
        "V0_Vs": 0.0,
        "V0_Vt": 0.0,
        "V_Ap": 22.41328267150879,
        "V_As": 93.00007178955079,
        "V_Atm": 0.0,
        "V_Cp": 21.195179329833984,
        "V_Cs": 52.881302326660155,
        "V_Hl": 25.00800508255005,
        "V_Hr": 24.81428129211426,
        "V_Vp": 25.135323486328126,
        "V_Vs": 457.1248461328125,
        "V_Vt": 28.469256545410154,
        "amp_P_Ap": 9.07952873046875,
        "amp_P_As": 34.6890872265625,
        "avg_P_Ap": 778.2097168945312,
        "avg_P_As": 826.8870845898438,
        "avg_P_Cp": 771.4721025,
        "avg_P_Cs": 797.8715166992188,
        "avg_P_Vs": 767.998779296875,
        "avg_V_Ap": 26.407052236938476,
        "avg_V_As": 96.68763260742188,
        "avg_V_Cp": 22.44863953857422,
        "avg_V_Cs": 53.30272364990235,
        "avg_V_Hl": 18.7500338092041,
        "avg_V_Hr": 18.63455938598633,
        "avg_V_Vp": 26.131591814575195,
        "avg_V_Vt": 29.762705379028322,
        "avg_keep_SV_Hl": 19.38425799926758,
        "e_Hl": 0.42317103509902954,
        "e_Hr": 0.25298683477401734,
        "int_SV_Hl": 19.390247213846447,
        "keep_SV_Hl": 19.39529292541504,
        "keep_max_P_Ap": 782.6969559179687,
        "keep_max_P_As": 844.3026079882812,
        "keep_min_P_Ap": 773.6174336523437,
        "keep_min_P_As": 809.6135233789063,
        "max_P_Ap": 782.6959225505924,
        "max_P_As": 844.3059089021614,
        "min_P_Ap": 773.6162736523437,
        "min_P_As": 809.6296433789063,
        "t_Sys_HC": 0.4000000059604645,
        "t_transition_HC": 0.10000000149011612,

        "P_ChP": 785.0,
        "V_ChP": 0.0,

        "C_Vent": 5.0,
        "V0_Vent": 0.0,
        "V_Vent": 25.0,
        "P_Vent": 770.0,

        "C_SAS": 0.03,
        "V0_SAS": 0.0,
        "V_SAS": 0.3,
        "P_SAS": 770.0,

        "C_Spinal": 10.0,
        "V0_Spinal": 0.0,
        "V_Spinal": 25.0,
        "P_Spinal": 770.0,

        "C_CaBV": 0.05,
        "V0_CaBV": 0.0,
        "V_CaBV": 0.5,
        "P_CaBV": 770.0,

        "R_ChP_Vent": 2500.0,
        "Q_ChP_Vent": 0.006,

        "R_Vent_SAS": 2.0,
        "Q_Vent_SAS": 0.006,

        "R_SAS_Vt": 3.0,
        "Q_SAS_Vt": 0.006,

        "R_SAS_Spinal": 36.0,
        "Q_SAS_Spinal": 0.0,

        "R_As_CaBV": 1.0,
        "Q_As_CaBV": 1.0,

        "R_CaBV_Vt": 5.0,
        "Q_CaBV_Vt": 1.0,

        "R_CaBV_SAS": 8.0,
        "Q_CaBV_SAS": 0.1,

        "min_P_SAS": 0.0,
        "keep_min_P_SAS": 0.0,
        "max_P_SAS": 0.0,
        "keep_max_P_SAS": 0.0,
        "amp_P_SAS": 0.0,
        "avg_P_SAS": 770.0,
        "avg_P_Vent": 770.0,

        "int_V_csfFlow": 0.0,
        "max_V_csfFlow": 0.0,
        "keep_max_V_csfFlow": 0.0,
        "min_V_csfFlow": 0.0,
        "keep_min_V_csfFlow": 0.0,
        "CSF_SV": 0.0
    },
    "connections":{
        "resistive":{
            "Vt_Hr":{"from":"Vt","to":"Hr","type":"diode","params":{"R":0.005,"L":0.01,"threshold":0.0,"y0":0.0}},
            "Hr_Ap":{"from":"Hr","to":"Ap","type":"diode","params":{"R":0.006,"L":0.01,"threshold":0.0,"y0":0.0}},
            "Ap_Cp":{"from":"Ap","to":"Cp","type":"resistor","params":{"R":0.0875}},
            "Cp_Vp":{"from":"Cp","to":"Vp","type":"resistor","params":{"R":0.02}},
            "Vp_Hl":{"from":"Vp","to":"Hl","type":"diode","params":{"R":0.005,"threshold":0.0,"L":0.01,"y0":0.0}},
            "Hl_As":{"from":"Hl","to":"As","type":"diode","params":{"R":0.005,"threshold":0.0,"L":0.01,"y0":0.0}},
            "As_Cs":{"from":"As","to":"Cs","type":"resistor","params":{"R":3.5693631042273544,"L":0.1,"y0":11.9344570233923}},
            "Cs_Vs":{"from":"Cs","to":"Vs","type":"resistor","params":{"R":0.2}},
            "Vs_Vt":{"from":"Vs","to":"Vt","type":"resistor","params":{"R":0.04}},

            "ChP_Vent":{"from":"ChP","to":"Vent","type":"resistor","params":{"R":2500.0}},
            "Vent_SAS":{"from":"Vent","to":"SAS","type":"resistor","params":{"R":2.0}},
            "SAS_Vt":{"from":"SAS","to":"Vt","type":"resistor","params":{"R":3.0}},
            "SAS_Spinal":{"from":"SAS","to":"Spinal","type":"resistor","params":{"R":36.0}},
            "As_CaBV":{"from":"As","to":"CaBV","type":"resistor","params":{"R":1.0}},
            "CaBV_Vt":{"from":"CaBV","to":"Vt","type":"resistor","params":{"R":5.0}},
            "CaBV_SAS":{"from":"CaBV","to":"SAS","type":"resistor","params":{"R":8.0}}
        },
        "bias":{
            "As":"Atm","Cs":"Atm","Vs":"Atm","Vt":"Atm","Hr":"Atm",
            "Ap":"Atm","Cp":"Atm","Vp":"Atm","Hl":"Atm","Atm":"Atm",
            "Vt_Hr":"Atm","Hr_Ap":"Atm","Ap_Cp":"Atm","Cp_Vp":"Atm",
            "Vp_Hl":"Atm","Hl_As":"Atm","As_Cs":"Atm","Cs_Vs":"Atm","Vs_Vt":"Atm",

            "ChP":"Atm","Vent":"Atm","SAS":"Atm","Spinal":"Atm","CaBV":"Atm",
            "ChP_Vent":"Atm","Vent_SAS":"Atm","SAS_Vt":"Atm","SAS_Spinal":"Atm","As_CaBV":"Atm","CaBV_Vt":"Atm","CaBV_SAS":"Atm"
        },
        "regions":{
            "As":[],"Cs":[],"Vs":[],"Vt":[],"Hr":[],
            "Ap":[],"Cp":[],"Vp":[],"Hl":[],"Atm":[],

            "ChP":[],"Vent":[],"SAS":[],"Spinal":[],"CaBV":[]
        },
        "cycles":{
            "As":"","Cs":"","Vs":"","Vt":"","Hr":"HC",
            "Ap":"","Cp":"","Vp":"","Hl":"HC","Atm":"",

            "ChP":"","Vent":"","SAS":"","Spinal":"","CaBV":""
        }
    },
    "cycles":{
        "HC":{"type":"cycle","params":{"duration":0.8,"triggerOffset":0.0,"timerOffset":0.0}}
    },
    "compartments":{
        "As":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":0.6733524445766853,"V0":100.0,"y0":150.0,"p0":760.0}}},
        "Cs":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":40.486445277994356,"V0":0.0,"y0":100.0,"p0":760.0}}},
        "Vs":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":200.00129430271159,"V0":0.0,"y0":300.0,"p0":760.0}}},
        "Vt":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":46.56583730166053,"V0":0.0,"y0":200.0,"p0":760.0}}},
        "Hr":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"elastance","params":{"Emax":0.4170741369726069,"Emin":0.025,"V0":0.0,"y0":100.0,"systolicTime":0.4,"transitionTime":0.1,"p0":760.0}}},
        "Ap":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":3.413796042601061,"V0":100.0,"y0":150.0,"p0":760.0}}},
        "Cp":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":20.493428488036308,"V0":0.0,"y0":150.0,"p0":760.0}}},
        "Vp":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":34.1503423164771,"V0":0.0,"y0":300.0,"p0":760.0}}},
        "Hl":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"elastance","params":{"Emax":1.304287823905418,"Emin":0.02,"V0":0.0,"y0":100.0,"systolicTime":0.4,"transitionTime":0.1,"p0":760.0}}},
        "Atm":{"gasRegion":"Atmosphere","type":"component","capacitor":{"type":"constantPressure","params":{"p0":760.0,"y0":0.0}}},

        "ChP":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"constantPressure","params":{"p0":785.0,"y0":0.0}}},
        "Vent":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":5.0,"V0":0.0,"y0":25.0,"p0":770.0}}},
        "SAS":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":0.03,"V0":0.0,"y0":0.3,"p0":770.0}}},
        "Spinal":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":10.0,"V0":0.0,"y0":25.0,"p0":770.0}}},
        "CaBV":{"gasRegion":"bloodPlr","type":"component","capacitor":{"type":"capacitor","params":{"C":0.05,"V0":0.0,"y0":0.5,"p0":770.0}}}
    },
    "other":{
        "min_P_As":{"type":"cycleMin","params":{"varIn":"P_As","newVarName":"min_P_As","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "keep_min_P_As":{"type":"cycleKeeper","params":{"varIn":"min_P_As","newVarName":"keep_min_P_As","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "max_P_As":{"type":"cycleMax","params":{"varIn":"P_As","newVarName":"max_P_As","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "keep_max_P_As":{"type":"cycleKeeper","params":{"varIn":"max_P_As","newVarName":"keep_max_P_As","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "amp_P_As":{"type":"stateSubstraction","params":{"state1":"keep_max_P_As","state2":"keep_min_P_As","newVarName":"amp_P_As","y0":0.0}},
        "min_P_Ap":{"type":"cycleMin","params":{"varIn":"P_Ap","newVarName":"min_P_Ap","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "keep_min_P_Ap":{"type":"cycleKeeper","params":{"varIn":"min_P_Ap","newVarName":"keep_min_P_Ap","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "max_P_Ap":{"type":"cycleMax","params":{"varIn":"P_Ap","newVarName":"max_P_Ap","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "keep_max_P_Ap":{"type":"cycleKeeper","params":{"varIn":"max_P_Ap","newVarName":"keep_max_P_Ap","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "amp_P_Ap":{"type":"stateSubstraction","params":{"state1":"keep_max_P_Ap","state2":"keep_min_P_Ap","newVarName":"amp_P_Ap","y0":0.0}},
        "int_SV_Hl":{"type":"cycleIntegral","params":{"varIn":"Q_Hl_As","newVarName":"int_SV_Hl","t0":"T0","trigger":"Trig_HC","triggerConditionValue":0.0,"y0":0.0}},
        "keep_SV_Hl":{"type":"cycleKeeper","params":{"varIn":"int_SV_Hl","newVarName":"keep_SV_Hl","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "avg_keep_SV_Hl":{"type":"movingAverage","params":{"varIn":"keep_SV_Hl","period":1.0,"y0":91.5}},
        "avg_P_As":{"type":"movingAverage","params":{"varIn":"P_As","period":1.0,"y0":91.5}},
        "avg_P_Ap":{"type":"movingAverage","params":{"varIn":"P_Ap","period":1.0,"y0":760.0}},
        "avg_P_Cp":{"type":"movingAverage","params":{"varIn":"P_Cp","period":1.0,"y0":765.0}},
        "avg_P_Cs":{"type":"movingAverage","params":{"varIn":"P_Cs","period":1.0,"y0":765.0}},
        "avg_P_Vs":{"type":"movingAverage","params":{"varIn":"P_Vs","period":1.0,"y0":765.0}},
        "avg_V_Cp":{"type":"movingAverage","params":{"varIn":"V_Cp","period":1.0,"y0":765.0}},
        "avg_V_Cs":{"type":"movingAverage","params":{"varIn":"V_Cs","period":0.1,"y0":765.0}},
        "avg_V_Vt":{"type":"movingAverage","params":{"varIn":"V_Vt","period":1.0,"y0":765.0}},
        "avg_V_Vp":{"type":"movingAverage","params":{"varIn":"V_Vp","period":1.0,"y0":765.0}},
        "avg_V_As":{"type":"movingAverage","params":{"varIn":"V_As","period":1.0,"y0":327.86078916358724}},
        "avg_V_Ap":{"type":"movingAverage","params":{"varIn":"V_Ap","period":1.0,"y0":760.0}},
        "avg_V_Hl":{"type":"movingAverage","params":{"varIn":"V_Hl","period":1.0,"y0":120.0}},
        "avg_V_Hr":{"type":"movingAverage","params":{"varIn":"V_Hr","period":1.0,"y0":120.0}},

        "min_P_SAS":{"type":"cycleMin","params":{"varIn":"P_SAS","newVarName":"min_P_SAS","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "keep_min_P_SAS":{"type":"cycleKeeper","params":{"varIn":"min_P_SAS","newVarName":"keep_min_P_SAS","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "max_P_SAS":{"type":"cycleMax","params":{"varIn":"P_SAS","newVarName":"max_P_SAS","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "keep_max_P_SAS":{"type":"cycleKeeper","params":{"varIn":"max_P_SAS","newVarName":"keep_max_P_SAS","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "amp_P_SAS":{"type":"stateSubstraction","params":{"state1":"keep_max_P_SAS","state2":"keep_min_P_SAS","newVarName":"amp_P_SAS","y0":0.0}},
        "avg_P_SAS":{"type":"movingAverage","params":{"varIn":"P_SAS","period":1.0,"y0":770.0}},
        "avg_P_Vent":{"type":"movingAverage","params":{"varIn":"P_Vent","period":1.0,"y0":770.0}},

        "int_V_csfFlow":{"type":"cycleIntegral","params":{"varIn":"Q_SAS_Spinal","newVarName":"int_V_csfFlow","t0":"T0","trigger":"Trig_HC","triggerConditionValue":0.0,"y0":0.0}},
        "max_V_csfFlow":{"type":"cycleMax","params":{"varIn":"int_V_csfFlow","newVarName":"max_V_csfFlow","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "keep_max_V_csfFlow":{"type":"cycleKeeper","params":{"varIn":"max_V_csfFlow","newVarName":"keep_max_V_csfFlow","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "min_V_csfFlow":{"type":"cycleMin","params":{"varIn":"int_V_csfFlow","newVarName":"min_V_csfFlow","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "keep_min_V_csfFlow":{"type":"cycleKeeper","params":{"varIn":"min_V_csfFlow","newVarName":"keep_min_V_csfFlow","t0":"T0","trigger":"Trig_HC","y0":0.0}},
        "CSF_SV":{"type":"stateSubstraction","params":{"state1":"keep_max_V_csfFlow","state2":"keep_min_V_csfFlow","newVarName":"CSF_SV","y0":0.0}}
    },
    "calibration":{
        "C_Vs":{"type":"cubicController","params":{"varTarget":"avg_P_Vs","varToControl":"C_Vs","targetValue":9.0,"minValue":10.0,"maxValue":450.0,"cubicFactor":-1.0,"linearFactor":0.0,"k":0.1,"offset":760.0}},
        "R_Ap_Cp":{"type":"cubicController","params":{"varTarget":"avg_P_Cp","varToControl":"R_Ap_Cp","targetValue":11.0,"minValue":0.05,"maxValue":1.0,"cubicFactor":-0.1,"linearFactor":0.0,"k":0.1,"offset":760.0}},
        "R_Cs_Vs":{"type":"cubicController","params":{"varTarget":"avg_P_Cs","varToControl":"R_Cs_Vs","targetValue":30.0,"minValue":0.05,"maxValue":2.0,"cubicFactor":0.1,"linearFactor":0.0,"k":0.1,"offset":760.0}},
        "R_As_Cs":{"type":"cubicController","params":{"varToControl":"R_As_Cs","varTarget":"keep_max_P_As","targetValue":65.0,"minValue":0.1,"maxValue":6.0,"cubicFactor":0.1,"linearFactor":0.0,"k":0.1,"offset":760.0}},
        "E_Hl":{"type":"cubicController","params":{"varToControl":"E_Hl","varTarget":"keep_SV_Hl","targetValue":20.0,"minValue":0.5,"maxValue":30.0,"cubicFactor":0.1,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "E_Hr":{"type":"cubicController","params":{"varTarget":"keep_max_P_Ap","varToControl":"E_Hr","targetValue":23.0,"minValue":1.0,"maxValue":20.0,"cubicFactor":0.1,"linearFactor":0.0,"k":0.1,"offset":760.0}},
        "C_As":{"type":"cubicController","params":{"varTarget":"amp_P_As","varToControl":"C_As","targetValue":40.0,"minValue":0.05,"maxValue":5.0,"cubicFactor":-1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "C_Ap":{"type":"cubicController","params":{"varTarget":"amp_P_Ap","varToControl":"C_Ap","targetValue":10.0,"minValue":0.05,"maxValue":10.0,"cubicFactor":-10.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "V0_As":{"type":"cubicController","params":{"varTarget":"avg_V_As","varToControl":"V0_As","targetValue":103.14,"minValue":1.0,"maxValue":150.0,"cubicFactor":1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "V0_Ap":{"type":"cubicController","params":{"varTarget":"avg_V_Ap","varToControl":"V0_Ap","targetValue":27.77,"minValue":1.0,"maxValue":80.0,"cubicFactor":1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "e_Hl":{"type":"cubicController","params":{"varTarget":"avg_V_Hl","varToControl":"e_Hl","targetValue":21.0,"minValue":0.02,"maxValue":1.0,"cubicFactor":-1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "e_Hr":{"type":"cubicController","params":{"varTarget":"avg_V_Hr","varToControl":"e_Hr","targetValue":21.0,"minValue":0.02,"maxValue":1.0,"cubicFactor":-1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "C_Cs":{"type":"cubicController","params":{"varTarget":"avg_V_Cs","varToControl":"C_Cs","targetValue":49.0,"minValue":0.5,"maxValue":200.0,"cubicFactor":1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "C_Vt":{"type":"cubicController","params":{"varTarget":"avg_V_Vt","varToControl":"C_Vt","targetValue":28.0,"minValue":1.0,"maxValue":200.0,"cubicFactor":1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "C_Cp":{"type":"cubicController","params":{"varTarget":"avg_V_Cp","varToControl":"C_Cp","targetValue":21.0,"minValue":0.1,"maxValue":200.0,"cubicFactor":1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "C_Vp":{"type":"cubicController","params":{"varTarget":"avg_V_Vp","varToControl":"C_Vp","targetValue":24.5,"minValue":1.0,"maxValue":250.0,"cubicFactor":1.0,"linearFactor":0.0,"k":0.1,"offset":0.0}},
        "t_Sys_HC":{"type":"polynomialController","params":{"varTarget":"Cyc_HC","varToControl":"t_Sys_HC","dc":0.688,"linear":-0.278,"quadratic":0.0}}
    }
}$json$::jsonb
) ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region plot_configs · plot_Hr_csf_icp
INSERT INTO plot_configs (id, name, description, config) VALUES (
    'c51c1e5f-5cc1-4b77-8832-2d10cc97f101',
    'plot_Hr_csf_icp',
    'CSF pressure / ICP / CSF flow / CSF stroke volume axes for model_Hr_csf_icp. The original plot_Hr_test config can still be used against the same run to see the cardiovascular side.',
    $json${
        "grid": {"cols": 2, "rows": 4},
        "axes": {
            "ax_0_0_ICP": {"col": 0, "row": 0, "colSpan": 1, "rowSpan": 1, "type": "multiSideBySide",
                "params": {"left": ["P_Vent", "P_SAS", "P_Spinal"], "right": ["avg_P_SAS"], "title": "Intracranial & CSF Pressures (ICP = P_SAS)", "colorsLeft": "Reds", "colorsRight": "Blues"},
                "options": {"round": 3, "legend": {"show": true, "left": "upper left", "right": "upper right"}, "offset": 0, "zeroTime": true}},
            "ax_0_1_ICPAmp": {"col": 1, "row": 0, "colSpan": 1, "rowSpan": 1, "type": "multiSideBySide",
                "params": {"left": ["amp_P_SAS"], "right": ["amp_P_SAS"], "title": "ICP Pulse Amplitude", "colorsLeft": "Reds", "colorsRight": "Reds"},
                "options": {"round": 3, "legend": {"show": true, "left": "upper left", "right": "upper left"}, "offset": 0, "zeroTime": true}},
            "ax_1_0_CSFFlows": {"col": 0, "row": 1, "colSpan": 1, "rowSpan": 1, "type": "multiSideBySide",
                "params": {"left": ["Q_ChP_Vent", "Q_Vent_SAS", "Q_SAS_Vt"], "right": ["Q_ChP_Vent", "Q_Vent_SAS", "Q_SAS_Vt"], "title": "CSF Formation / Transport / Absorption Flow", "colorsLeft": "Greens", "colorsRight": "Greens"},
                "options": {"round": 6, "legend": {"show": true, "left": "upper left", "right": "upper left"}, "offset": 0, "zeroTime": true}},
            "ax_1_1_CSFSpinalFlow": {"col": 1, "row": 1, "colSpan": 1, "rowSpan": 1, "type": "multiSideBySide",
                "params": {"left": ["Q_SAS_Spinal"], "right": ["Q_SAS_Spinal"], "title": "Cranio-Spinal CSF Flow (pulsatile)", "colorsLeft": "Purples", "colorsRight": "Purples"},
                "options": {"round": 6, "legend": {"show": true, "left": "upper left", "right": "upper left"}, "offset": 0, "zeroTime": true}},
            "ax_2_0_CSFStrokeVolume": {"col": 0, "row": 2, "colSpan": 1, "rowSpan": 1, "type": "multiSideBySide",
                "params": {"left": ["CSF_SV"], "right": ["int_V_csfFlow"], "title": "CSF Stroke Volume", "colorsLeft": "Purples", "colorsRight": "Greys"},
                "options": {"round": 5, "legend": {"show": true, "left": "upper left", "right": "upper right"}, "offset": 0, "zeroTime": true}},
            "ax_2_1_CaBV": {"col": 1, "row": 2, "colSpan": 1, "rowSpan": 1, "type": "multiSideBySide",
                "params": {"left": ["V_CaBV"], "right": ["P_CaBV"], "title": "Cerebral Arterial Blood Volume (ICP driver)", "colorsLeft": "Oranges", "colorsRight": "Blues"},
                "options": {"round": 4, "legend": {"show": true, "left": "upper left", "right": "upper right"}, "offset": 0, "zeroTime": true}},
            "ax_3_0_CardiacRef": {"col": 0, "row": 3, "colSpan": 1, "rowSpan": 1, "type": "multiSideBySide",
                "params": {"left": ["P_As"], "right": ["Cyc_HC"], "title": "Systemic Arterial Pressure & Cardiac Cycle (reference)", "colorsLeft": "Reds", "colorsRight": "Blues"},
                "options": {"round": 3, "legend": {"show": true, "left": "upper left", "right": "lower right"}, "offset": 0, "zeroTime": true}},
            "ax_3_1_CSFVolumes": {"col": 1, "row": 3, "colSpan": 1, "rowSpan": 1, "type": "multiSideBySide",
                "params": {"left": ["V_Vent", "V_SAS", "V_Spinal"], "right": ["V_Vent", "V_SAS", "V_Spinal"], "title": "CSF Compartment Volumes", "colorsLeft": "Greens", "colorsRight": "Greens"},
                "options": {"round": 3, "legend": {"show": true, "left": "upper left", "right": "upper left"}, "offset": 0, "zeroTime": true}}
        }
    }$json$::jsonb
) ON CONFLICT (id) DO NOTHING;
-- #endregion
