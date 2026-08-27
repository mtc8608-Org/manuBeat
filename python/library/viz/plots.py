import numpy as np
import matplotlib.pyplot as mpl
import pandas as pd
import seaborn as sns
import matplotlib.gridspec as gridspec
from matplotlib.ticker import ScalarFormatter
from matplotlib.ticker import FuncFormatter
from matplotlib.ticker import MaxNLocator
from matplotlib.collections import LineCollection
from matplotlib import colormaps as _colormaps
import matplotlib.colors as _mcolors
#from adjustText import adjust_text
#from scipy.optimize import curve_fit
#from scipy.signal import savgol_filter


import library.utils as utils
import copy


# Deterministic cohort colours when a caller names none. The sepsis paper's own code is the
# first three: normal green, warm shock red, cold shock blue.
_CLASS_COLOURS = ["tab:green", "tab:red", "tab:blue", "tab:orange", "tab:purple",
                  "tab:brown", "tab:pink", "tab:gray", "tab:olive", "tab:cyan"]


def _disp(name, fallback=None):
    """Paper-quality (LaTeX) display name for a signal, from config/labels.json.
    Falls back to `fallback` (current behaviour) when the name has no label entry,
    so existing plots are unchanged unless a label is defined."""
    return utils.labelFor(name, 'latex', default=(fallback if fallback is not None else name))


def buildPlot(results,modelStructure,plotOptions):
    fig = mpl.figure(figsize=(plotOptions['figSize']['width'], plotOptions['figSize']['height']))
    grid = gridspec.GridSpec(plotOptions['grid']['rows'], plotOptions['grid']['cols'], figure=fig)

    for axName,axesConf in plotOptions['axes'].items():
        ax = fig.add_subplot(grid[
            axesConf['row']:axesConf['row']+axesConf['rowSpan'], 
            axesConf['col']:axesConf['col']+axesConf['colSpan']
            ])
        
        if axesConf['type'] == 'compartmentPartialPressure':
            buildCompartmentPartialPressure(ax,results,modelStructure,axesConf,plotOptions['formatOptions'])
        elif axesConf['type'] == 'sideBySide':
            buildTwoSideBySide(ax,results,modelStructure,axesConf,plotOptions['formatOptions'])
        elif axesConf['type'] == 'oneAgainstAnother':
            buildOneAgainstAnother(ax,results,modelStructure,axesConf,plotOptions['formatOptions'])
        elif axesConf['type'] == 'multiSideBySide':
            buildMultiSideBySide(ax,results,modelStructure,axesConf,plotOptions['formatOptions'])
        elif axesConf['type'] == 'oneAgainstAnotherMulti':
            buildOneAgainstAnotherMulti(ax,results,modelStructure,axesConf,plotOptions['formatOptions'])
        elif axesConf['type'] == 'PEEPChallenge':
            buildPEEPChallengePlot(ax,results,modelStructure,axesConf,plotOptions['formatOptions'])
        elif axesConf['type'] == 'multiHistogram':
            buildMultiSideBySideHistogram(ax,results,modelStructure,axesConf,plotOptions['formatOptions'])

    mpl.tight_layout()
    mpl.show()

#██████  ██████  ███████       ██████  ██    ██ ██ ██      ████████      █████  ██   ██ ███████ ███████ 
#██   ██ ██   ██ ██            ██   ██ ██    ██ ██ ██         ██        ██   ██  ██ ██  ██      ██      
#██████  ██████  █████   █████ ██████  ██    ██ ██ ██         ██        ███████   ███   █████   ███████ 
#██      ██   ██ ██            ██   ██ ██    ██ ██ ██         ██        ██   ██  ██ ██  ██           ██ 
#██      ██   ██ ███████       ██████   ██████  ██ ███████    ██        ██   ██ ██   ██ ███████ ███████ 


def buildTwoSideBySide(ax,results,modelStructure,plotOptions,formatOptions):
    try:
        formatter = ScalarFormatter(useMathText=False, useOffset=False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        ax1 = ax.twinx()
        ax1.xaxis.set_major_formatter(formatter)
        ax1.yaxis.set_major_formatter(formatter)
        ax1.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax1.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        ax.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        ax1.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        ax.tick_params(axis='y', labelcolor=plotOptions['params']['leftColor'])
        ax1.tick_params(axis='y', labelcolor=plotOptions['params']['rightColor'])

        ax.tick_params(axis='y', labelcolor=plotOptions['params']['leftColor'])
        ax1.tick_params(axis='y', labelcolor=plotOptions['params']['rightColor'])
    except Exception as e:
        print(e)
        print('Error: buildTwoSideBySide: ' + ' -> init Error')
        

    try:
        if 'left' in plotOptions['params']: 
            leftName = plotOptions['params']['left']
        else: leftName = ''

        if leftName in results.keys() :
            metadataLeft = results[leftName]['metadata']
            printNameLeft = _disp(leftName, leftName.replace(metadataLeft['prefix'] + '_', ''))
            axLabel ='[' + metadataLeft['unit'] + ']'
        else:
            metadataLeft = {
                'name': '',
                'unit': '',
                'prefix': ''

            }
            printNameLeft = leftName + ' ERROR!!'
            axLabel = ''

        if 'right' in plotOptions['params']: 
            rightName = plotOptions['params']['right']
        else: rightName = ''
        
        if rightName in results.keys():
            metadataRight = results[rightName]['metadata']
            printNameRight = _disp(rightName, rightName.replace(metadataRight['prefix'] + '_', ''))
            ax1Label = '[' + metadataRight['unit'] + ']'
        else:
            metadataRight = {
                'name': '',
                'unit': '',
                'prefix': ''

            }
            printNameRight = rightName + ' ERROR!!'
            ax1Label = ''

        leftTitle = metadataLeft['name'] + ' of ' + printNameLeft
        rightTitle = metadataRight['name'] + ' of ' + printNameRight
        title = ''
        
        if 'title' in plotOptions['params']:
            title = plotOptions['params']['title']
        else:
            if leftName in results.keys():
                title += leftTitle
            if leftName in results.keys() and rightName in results.keys():
                title += ' and '
            if rightName in results.keys():
                title += rightTitle
            if title == '':
                title = 'ERROR!!'

        
        if 'xLabel' in plotOptions['params']:
            xLabel = plotOptions['params']['xLabel']
        else:
            xLabel = 'Time [s]'
        
        if 'yLeftLabel' in plotOptions['params']:
            axLabel = plotOptions['params']['yLabel']
        
        if 'yRightLabel' in plotOptions['params']:
            ax1Label = plotOptions['params']['y1Label']
        
        
        ax.set_ylabel(axLabel, fontsize=formatOptions['fonts']['ylabel'])
        ax1.set_ylabel(ax1Label, fontsize=formatOptions['fonts']['ylabel'])
        ax.set_title(title, fontsize=formatOptions['fonts']['title'])
        ax.set_xlabel(xLabel, fontsize=formatOptions['fonts']['xlabel'])
    except Exception as e:
        print(e)
        print('Error: buildTwoSideBySide: ' + ' -> title Error')

    try:
        if plotOptions['options']['zeroTime']:
            t = results['T']['data'] - results['T']['data'][0]
        else:
            t = results['T']['data']
        
        if leftName in results.keys() :
            leftColor = plotOptions['params']['leftColor']
            ax.plot(
                np.array(t[plotOptions['options']['toIgnore']:]),
                np.array(results[leftName]['data'][plotOptions['options']['toIgnore']:]), 
                color=leftColor, 
                label = _disp(leftName)
            )
        if rightName in results.keys():
            rightColor = plotOptions['params']['rightColor']
            ax1.plot(
                np.array(t[plotOptions['options']['toIgnore']:]),
                np.array(results[rightName]['data'][plotOptions['options']['toIgnore']:]), 
                color=rightColor, 
                label = _disp(rightName)
            )
    except Exception as e:
        print(e)
        print('Error: buildTwoSideBySide: ' + str(title) + ' -> ax.plot() Error')

    try:
        if leftName in results.keys() :
            minL = min(np.array(results[leftName]['data'][plotOptions['options']['toIgnore']:]))
            maxL = max(np.array(results[leftName]['data'][plotOptions['options']['toIgnore']:]))
        else:
            minL = 0
            maxL = 0
        
        if rightName in results.keys() :
            minR = min(np.array(results[rightName]['data'][plotOptions['options']['toIgnore']:]))
            maxR = max(np.array(results[rightName]['data'][plotOptions['options']['toIgnore']:]))
        else:
            minR = 0
            maxR = 0

        if plotOptions['options']['ticks']['useCustomTicks']:
            ticks = []
            if leftName in results.keys() :
                if plotOptions['options']['ticks']['params']['maxLeft']:
                    ticks.append(np.round(max(np.array(results[leftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['minLeft']:
                    ticks.append(np.round(min(np.array(results[leftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['averageLeft']:
                    ticks.append(np.round(np.mean(np.array(results[leftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))

            ticks1 = []
            if rightName in results.keys() :
                if plotOptions['options']['ticks']['params']['maxRight']:
                    ticks1.append(np.round(max(np.array(results[rightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['minRight']:
                    ticks1.append(np.round(min(np.array(results[rightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['averageRight']:
                    ticks1.append(np.round(np.mean(np.array(results[rightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
            
            ax.set_yticks(ticks)
            ax1.set_yticks(ticks1)
        else:
            if leftName in results.keys() :
                #step = (maxL-minL)/formatOptions['nbins']
                axTicks = np.arange(
                    minL, 
                    maxL, 
                    (maxL-minL)/formatOptions['nbins']
                )
                axTicks.append(maxL)
                ax.set_yticks(axTicks)
            if rightName in results.keys() :
                ax1Ticks = np.arange(
                    minR,
                    maxR,
                    (maxR-minR)/formatOptions['nbins']
                )
                ax1Ticks.append(maxR)
                ax1.set_yticks(ax1Ticks)
            
    except Exception as e:
        print(e)
        print('Error: buildTwoSideBySide: ' + str(title) + ' -> ax.set_yticks() Error')

    try:

        if plotOptions['options']['ticks']['useCustomTicks']:
            if plotOptions['options']['ticks']['dependentScales']:
                minP = min(minL, minR)
                maxP = max(maxL, maxR)
                ax.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
                ax1.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
            else:
                ax.set_ylim(minL - plotOptions['options']['offset'], maxL + plotOptions['options']['offset'])
                ax1.set_ylim(minR - plotOptions['options']['offset'], maxR + plotOptions['options']['offset'])
        else:
            ax.set_ylim(minL - plotOptions['options']['offset'], maxL + plotOptions['options']['offset'])
            ax1.set_ylim(minR - plotOptions['options']['offset'], maxR + plotOptions['options']['offset'])

    except Exception as e:
        print(e)
        print('Error: buildTwoSideBySide: ' + str(title) + ' -> ax.set_ylim() Error')

    if plotOptions['options']['legend']['show']:
        ax.legend(loc=plotOptions['options']['legend']['left'], fontsize=formatOptions['fonts']['legend'])
        ax1.legend(loc=plotOptions['options']['legend']['right'], fontsize=formatOptions['fonts']['legend'])

def buildMultiSideBySide(ax,results,modelStructure,plotOptions,formatOptions):
    try:
        formatter = ScalarFormatter(useMathText=False, useOffset=False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        
        if 'right' in plotOptions['params']:
            ax1 = ax.twinx()
            ax1.xaxis.set_major_formatter(formatter)
            ax1.yaxis.set_major_formatter(formatter)
            ax1.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
            ax1.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
            ax1.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        
        ax.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
    except Exception as e:
        print(e)
        print('Error: buildMultiSideBySide: ' + ' -> init Error')

    try:
        if 'left' in plotOptions['params']: 
            leftNames = plotOptions['params']['left']
        else: leftNames = ['']

        toPlotLeft = []
        axLabel = ''
        for name in leftNames:
            if name in results.keys() :
                toPlotLeft.append(name)
                metadataLeft = results[name]['metadata']
                axLabel ='[' + metadataLeft['unit'] + ']'
            else:
                metadataLeft = {
                    'name': '',
                    'unit': '',
                    'prefix': ''

                }
                axLabel = ''

        if 'right' in plotOptions['params']: 
            rightNames = plotOptions['params']['right']
        else: rightNames = ''

        toPlotRight = []
        ax1Label = ''
        for name in rightNames:
            if name in results.keys():
                toPlotRight.append(name)
                metadataRight = results[name]['metadata']
                ax1Label = '[' + metadataRight['unit'] + ']'
            else:
                metadataRight = {
                    'name': '',
                    'unit': '',
                    'prefix': ''

                }
                ax1Label = ''

        title = plotOptions['params']['title']
        
        ax.set_ylabel(axLabel, fontsize=formatOptions['fonts']['ylabel'])
        if 'right' in plotOptions['params']:
            ax1.set_ylabel(ax1Label, fontsize=formatOptions['fonts']['ylabel'])
        ax.set_title(title, fontsize=formatOptions['fonts']['title'])
        ax.set_xlabel('Time [s]', fontsize=formatOptions['fonts']['xlabel'])
    except Exception as e:
        print(e)
        print('Error: buildMultiSideBySide: ' + ' -> title Error')

    try:
        if plotOptions['options']['zeroTime']:
            t = results['T']['data'] - results['T']['data'][0]
        else:
            t = results['T']['data']
        
        # always use a new color for each line independently of the number of the axes
        colors = utils.getColors(len(toPlotLeft) + len(toPlotRight),'random')
        
        if 'colorsLeft' in plotOptions['params']:
            cmap = mpl.get_cmap(plotOptions['params']['colorsLeft'])
            colorsLeft = [cmap((i+2) / (len(toPlotLeft)+2)) for i in range(len(toPlotLeft))]
            if  plotOptions['params']['left'] != []:
                ax.tick_params(axis='y', labelcolor=colorsLeft[-1])
        if 'colorsRight' in plotOptions['params']:
            cmap = mpl.get_cmap(plotOptions['params']['colorsRight'])
            colorsRight = [cmap((i+2) / (len(toPlotRight)+2)) for i in range(len(toPlotRight))]
            if  plotOptions['params']['right'] != []:
                ax1.tick_params(axis='y', labelcolor=colorsRight[-1])
        

        if  plotOptions['params']['left'] != []:
            for leftName in toPlotLeft:
                if 'colorsLeft' in plotOptions['params']:
                    color = colorsLeft.pop()
                else:
                    color = colors.pop()
                ax.plot(
                    np.array(t[plotOptions['options']['toIgnore']:]),
                    np.array(results[leftName]['data'][plotOptions['options']['toIgnore']:]), 
                    label = _disp(leftName),
                    color = color
            )

        if  plotOptions['params']['right'] != []:
            for rightName in toPlotRight:
                if 'colorsRight' in plotOptions['params']:
                    color = colorsRight.pop()
                else:
                    color = colors.pop()
                ax1.plot(
                    np.array(t[plotOptions['options']['toIgnore']:]),
                    np.array(results[rightName]['data'][plotOptions['options']['toIgnore']:]), 
                    label = _disp(rightName),
                    color = color
                    )
    except Exception as e:
        print(e)
        print('Error: buildMultiSideBySide: ' + str(plotOptions['params']['title']) + ' -> ax.plot() Error')

    if plotOptions['options']['legend']['show']:
        ax.legend(loc=plotOptions['options']['legend']['left'], fontsize=formatOptions['fonts']['legend'])
        if 'right' in plotOptions['params']:
            ax1.legend(loc=plotOptions['options']['legend']['right'], fontsize=formatOptions['fonts']['legend'])

def buildOneAgainstAnother(ax,results,modelStructure,plotOptions,formatOptions):
    try:
        formatter = ScalarFormatter(useMathText=False, useOffset=False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        ax1 = ax.twinx()
        ax1.xaxis.set_major_formatter(formatter)
        ax1.yaxis.set_major_formatter(formatter)
        ax1.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax1.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        ax.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        ax1.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])

        ax.tick_params(axis='y', labelcolor=plotOptions['params']['yLeftColor'])
        ax1.tick_params(axis='y', labelcolor=plotOptions['params']['yRightColor'])
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + ' -> init Error')

    try: 
        if 'yLeft' in plotOptions['params']: 
            yLeftName = plotOptions['params']['yLeft']
        else: yLeftName = ''

        if 'xLeft' in plotOptions['params']: 
            xLeftName = plotOptions['params']['xLeft']
        else: xLeftName = ''

        if 'yRight' in plotOptions['params']: 
            yRightName = plotOptions['params']['yRight']
        else: yRightName = ''

        if 'xRight' in plotOptions['params']: 
            xRightName = plotOptions['params']['xRight']
        else: xRightName = ''

        if yLeftName in results.keys() :
            metadataLeft = results[yLeftName]['metadata']
            printNameLeft = _disp(yLeftName, yLeftName.replace(metadataLeft['prefix'] + '_', ''))
            axLabel ='[' + metadataLeft['unit'] + ']'
        else:
            metadataLeft = {
                'name': '',
                'unit': '',
                'prefix': ''

            }
            printNameLeft = yLeftName + ' ERROR!!'
            axLabel = ''
        
        if yRightName in results.keys():
            metadataRight = results[yRightName]['metadata']
            printNameRight = _disp(yRightName, yRightName.replace(metadataRight['prefix'] + '_', ''))
            ax1Label = '[' + metadataRight['unit'] + ']'
        else:
            metadataRight = {
                'name': '',
                'unit': '',
                'prefix': ''

            }
            printNameRight = yRightName + ' ERROR!!'
            ax1Label = ''

        if xLeftName in results.keys() :
            metadataX = results[xLeftName]['metadata']
            printNameX = xLeftName.replace(metadataX['prefix'] + '_', '')
            xLabel = printNameX + ' [' + metadataX['unit'] + ']'
        else:
            metadataX = {
                'name': '',
                'unit': '',
                'prefix': ''

            }
            printNameX = xLeftName + ' ERROR!!'
            xLabel = ''
        
        title = ''
        titleType = metadataLeft['name'] + '/' + metadataX['name'] + ' curve of '

        if yLeftName in results.keys():
            title += titleType + printNameLeft
        if yLeftName in results.keys() and yRightName in results.keys():
            title += ' and '
        if yRightName in results.keys():
            title += printNameRight

        if 'title' in plotOptions['params']:
            title = plotOptions['params']['title']
        else:
            title = metadataLeft['name'] + '/' + metadataX['name'] + ' curve of ' + printNameLeft + ' and ' + printNameRight
        
        
        ax.set_ylabel(axLabel, fontsize=formatOptions['fonts']['ylabel'])
        ax1.set_ylabel(ax1Label, fontsize=formatOptions['fonts']['ylabel'])
        ax.set_title(title, fontsize=formatOptions['fonts']['title'])
        ax.set_xlabel(xLabel, fontsize=formatOptions['fonts']['xlabel'])
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> init Error')

    try:

        if results[xLeftName] and results[yLeftName]:
            yLeftColor = plotOptions['params']['yLeftColor']
            if 'plotType' in plotOptions:
                if plotOptions['plotType'] == 'scatter':
                    ax.scatter(
                        np.array(results[xLeftName]['data'][plotOptions['options']['toIgnore']:]),
                        np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:]), 
                        color=yLeftColor, 
                        label = _disp(yLeftName)
                    )
            else:
                ax.plot(
                    np.array(results[xLeftName]['data'][plotOptions['options']['toIgnore']:]),
                    np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:]), 
                    color=yLeftColor, 
                    label = _disp(yLeftName)
                )
            
        
        if results[xRightName] and results[yRightName]:
            yRightColor = plotOptions['params']['yRightColor']
            if 'plotType' in plotOptions:
                if plotOptions['plotType'] == 'scatter':
                    ax1.scatter(
                        np.array(results[xRightName]['data'][plotOptions['options']['toIgnore']:]),
                        np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:]), 
                        color=yRightColor, 
                        label = _disp(yRightName)
                    )
            else:
                ax1.plot(
                    np.array(results[xRightName]['data'][plotOptions['options']['toIgnore']:]),
                    np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:]), 
                    color=yRightColor, 
                    label = _disp(yRightName)
                )
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.plot() Error')

    try:
        if plotOptions['options']['ticks']['useCustomTicks']:

            if results[xLeftName] and results[yLeftName]:
                ticks = []
                ticks.append(np.round(max(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['minLeft']:
                    ticks.append(np.round(min(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['averageLeft']:
                    ticks.append(np.round(np.mean(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))

            if results[xRightName] and results[yRightName]:
                ticks1 = []
                ticks1.append(np.round(max(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['minRight']:
                    ticks1.append(np.round(min(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['averageRight']:
                    ticks1.append(np.round(np.mean(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                ax.set_yticks(ticks)
                ax1.set_yticks(ticks1)
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.set_yticks() Error')

    try:
        if plotOptions['options']['ticks']['useCustomTicks']:
            minL = []
            maxL = []
            minL.append(min(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])))
            maxL.append(max(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])))
            

            minR = []
            maxR = []
            minR.append(min(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])))
            maxR.append(max(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])))

            if plotOptions['options']['ticks']['dependentScales']:
                minP = min(min(minL), min(minR))
                maxP = max(max(maxL), max(maxR))
                ax.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
                ax1.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
            else:
                ax.set_ylim(min(minL) - plotOptions['options']['offset'], max(maxL) + plotOptions['options']['offset'])
                ax1.set_ylim(min(minR) - plotOptions['options']['offset'], max(maxR) + plotOptions['options']['offset'])
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.set_ylim() Error')

    if plotOptions['options']['legend']['show']:
        ax.legend(loc=plotOptions['options']['legend']['left'], fontsize=formatOptions['fonts']['legend'])
        ax1.legend(loc=plotOptions['options']['legend']['right'], fontsize=formatOptions['fonts']['legend'])

def buildOneAgainstAnotherMulti(ax,results,modelStructure,plotOptions,formatOptions):
    try:
        formatter = ScalarFormatter(useMathText=False, useOffset=False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins'], prune=None))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins'], prune=None))

        
        ax1 = ax.twinx()
        ax1.xaxis.set_major_formatter(formatter)
        ax1.yaxis.set_major_formatter(formatter)
        ax1.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins'], prune=None))
        ax1.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins'], prune=None))
        
        ax.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        ax1.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        if 'title' in plotOptions['params']:
            title = plotOptions['params']['title']
        else:
            title = ''
            title = metadataLeft['name'] + '/' + metadataX['name'] + ' curve of '

    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + ' -> init Error')
        print(e)

    try:
        if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']): 
            for xLeftName in plotOptions['params']['xLeft']:
                if xLeftName in results.keys():
                    metadataX = results[xLeftName]['metadata']
                    if 'xLabel' in plotOptions['params']:
                        xLabel = plotOptions['params']['xLabel']
                    else:
                        xLabel = '[' + metadataX['unit'] + ']'
            for yLeftName in plotOptions['params']['yLeft']:
                if yLeftName in results.keys():
                    metadataLeft = results[yLeftName]['metadata']
                    if 'yLeftLabel' in plotOptions['params']:
                        axLabel = plotOptions['params']['yLeftLabel']
                    else:
                        axLabel ='[' + metadataLeft['unit'] + ']'
                    break
                else:
                    print('Error: buildOneAgainstAnotherMulti: ' + str(title) + ' -> yLeftName Error') 
        else: 
            metadataLeft = {
                'name': '',
                'unit': '',
                'prefix': ''
            }
            axLabel = ''
            metadataX = {
                'name': '',
                'unit': '',
                'prefix': ''
            }
            xLabel = ''

        if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
            for yRightName in plotOptions['params']['yRight']:
                if yRightName in results.keys():
                    metadataRight = results[yRightName]['metadata']
                    if 'yRightLabel' in plotOptions['params']:
                        ax1Label = plotOptions['params']['yRightLabel']
                    else:
                        ax1Label = '[' + metadataRight['unit'] + ']'

                else:
                    print('Error: buildOneAgainstAnotherMulti: ' + str(title) + ' -> yRightName Error')
        else: 
            metadataRight = {
                'name': '',
                'unit': '',
                'prefix': ''
            }
            ax1Label = ''
            xRightName = ''
        
        

        ax.set_ylabel(axLabel, fontsize=formatOptions['fonts']['ylabel'])
        ax1.set_ylabel(ax1Label, fontsize=formatOptions['fonts']['ylabel'])
        ax.set_title(title, fontsize=formatOptions['fonts']['title'])
        ax.set_xlabel(xLabel, fontsize=formatOptions['fonts']['xlabel'])
    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> init Error')
        print(e)

    try:
        if 'colorsLeft' in plotOptions['params']:
            cmap = mpl.get_cmap(plotOptions['params']['colorsLeft'])
            nrColors = len(plotOptions['params']['yLeft'])
            colorsLeft = [cmap((i) / (nrColors)) for i in range(nrColors)]
            if  plotOptions['params']['yLeft'] != []:
                ax.tick_params(axis='y', labelcolor=colorsLeft[-1])
        if 'colorsRight' in plotOptions['params']:
            cmap = mpl.get_cmap(plotOptions['params']['colorsRight'])
            nrColors = len(plotOptions['params']['yRight'])
            colorsRight = [cmap((i) / (nrColors)) for i in range(nrColors)]
            if  plotOptions['params']['yRight'] != []:
                ax1.tick_params(axis='y', labelcolor=colorsRight[-1])



        if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']):
            for res1,res2 in zip(plotOptions['params']['yLeft'],plotOptions['params']['xLeft']):
                if results[res1] and results[res2]:
                    ax.plot(
                        np.array(results[res2]['data'][plotOptions['options']['toIgnore']:]),
                        np.array(results[res1]['data'][plotOptions['options']['toIgnore']:]), 
                        color=colorsLeft.pop(), 
                        label = res1
                    )
        
        if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
            for res1,res2 in zip(plotOptions['params']['yRight'],plotOptions['params']['xRight']):
                if results[res1] and results[res2]:
                    ax1.plot(
                        np.array(results[res2]['data'][plotOptions['options']['toIgnore']:]),
                        np.array(results[res1]['data'][plotOptions['options']['toIgnore']:]), 
                        color=colorsRight.pop(), 
                        label = res1
                    )
    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.plot() Error')
        print(e)

    try:
        if plotOptions['options']['ticks']['useCustomTicks']:
            ticks = []
            if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']):
                for res1,res2 in zip(plotOptions['params']['yLeft'],plotOptions['params']['xLeft']):
                    if results[res2] and results[res1]:
                        if plotOptions['options']['ticks']['params']['maxLeft']:
                            ticks.append(np.round(max(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                        if plotOptions['options']['ticks']['params']['minLeft']:
                            ticks.append(np.round(min(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                        if plotOptions['options']['ticks']['params']['averageLeft']:
                            ticks.append(np.round(np.mean(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
            if 'ticksLeft' in plotOptions['options']['ticks']['params']:
                for tck in plotOptions['options']['ticks']['params']['ticksLeft']:
                    ticks.append(tck)
            ax.set_yticks(ticks)
            
            ticks1 = []
            if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
                for res1,res2 in zip(plotOptions['params']['yRight'],plotOptions['params']['xRight']):
                    if results[res2] and results[res1]:
                        if plotOptions['options']['ticks']['params']['maxRight']:
                            ticks1.append(np.round(max(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                        if plotOptions['options']['ticks']['params']['minRight']:
                            ticks1.append(np.round(min(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                        if plotOptions['options']['ticks']['params']['averageRight']:
                            ticks1.append(np.round(np.mean(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
            if 'ticksRight' in plotOptions['options']['ticks']['params']:
                for tck in plotOptions['options']['ticks']['params']['ticksRight']:
                    ticks1.append(tck)
            ax1.set_yticks(ticks1)

            if 'ticksX' in plotOptions['options']['ticks']['params']:
                ax.set_xticks(plotOptions['options']['ticks']['params']['ticksX'])
    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.set_yticks() Error')
        print(e)

    try:
        if plotOptions['options']['ticks']['useCustomTicks']:
            minL = []
            maxL = []
            if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']):
                for res1,res2 in zip(plotOptions['params']['yLeft'],plotOptions['params']['xLeft']):
                    if results[res2] and results[res1]:
                        minL.append(min(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])))
                        maxL.append(max(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])))
            

            minR = []
            maxR = []
            if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
                for res1,res2 in zip(plotOptions['params']['yRight'],plotOptions['params']['xRight']):
                    if results[res2] and results[res1]:
                        minR.append(min(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])))
                        maxR.append(max(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])))

            if plotOptions['options']['ticks']['dependentScales']:
                minP = min(min(minL), min(minR))
                maxP = max(max(maxL), max(maxR))
                ax.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
                ax1.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
            else:
                ax.set_ylim(min(minL) - plotOptions['options']['offset'], max(maxL) + plotOptions['options']['offset'])
                ax1.set_ylim(min(minR) - plotOptions['options']['offset'], max(maxR) + plotOptions['options']['offset'])
    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.set_ylim() Error')
        print(e)

    if plotOptions['options']['legend']['show']:
        if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']):
            ax.legend(loc=plotOptions['options']['legend']['left'], fontsize=formatOptions['fonts']['legend'])
        if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
            ax1.legend(loc=plotOptions['options']['legend']['right'], fontsize=formatOptions['fonts']['legend'])

# A bit custom made for PEEP Challenge, curve fit hardcodded, only fits sigmoids
def buildPEEPChallengePlot(ax,results,modelStructure,plotOptions,formatOptions):
    try:
        formatter = ScalarFormatter(useMathText=False, useOffset=False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        ax.tick_params(axis='y', labelcolor=plotOptions['params']['yLeftColor'])
        '''
        ax1 = ax.twinx()
        ax1.xaxis.set_major_formatter(formatter)
        ax1.yaxis.set_major_formatter(formatter)
        ax1.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax1.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax1.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        ax1.tick_params(axis='y', labelcolor=plotOptions['params']['yRightColor'])
        '''
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + ' -> init Error')

    try: 
        if 'yLeft' in plotOptions['params']: 
            yLeftName = plotOptions['params']['yLeft']
        else: yLeftName = ''

        if yLeftName in results.keys() :
            metadataLeft = results[yLeftName]['metadata']
            printNameLeft = _disp(yLeftName, yLeftName.replace(metadataLeft['prefix'] + '_', ''))
            if 'yLabel' in plotOptions['params']:
                axLabel = plotOptions['params']['yLabel']
            else:
                axLabel ='[' + metadataLeft['unit'] + ']'
        else:
            metadataLeft = {
                'name': '',
                'unit': '',
                'prefix': ''

            }
            printNameLeft = yLeftName + ' ERROR!!'
            axLabel = ''
        
        if 'xLeft' in plotOptions['params']: 
            xLeftName = plotOptions['params']['xLeft']
        else: xLeftName = ''

        if xLeftName in results.keys() :
            metadataX = results[xLeftName]['metadata']
            printNameX = xLeftName.replace(metadataX['prefix'] + '_', '')
            if 'xLabel' in plotOptions['params']:
                xLabel = plotOptions['params']['xLabel']
            else:
                xLabel = printNameX + ' [' + metadataX['unit'] + ']'
        else:
            metadataX = {
                'name': '',
                'unit': '',
                'prefix': ''

            }
            printNameX = xLeftName + ' ERROR!!'
            xLabel = ''

        '''
        if 'yRight' in plotOptions['params']: 
            yRightName = plotOptions['params']['yRight']
        else: yRightName = ''

        if 'xRight' in plotOptions['params']: 
            xRightName = plotOptions['params']['xRight']
        else: xRightName = ''
        
        if yRightName in results.keys():
            metadataRight = results[yRightName]['metadata']
            printNameRight = _disp(yRightName, yRightName.replace(metadataRight['prefix'] + '_', ''))
            ax1Label = '[' + metadataRight['unit'] + ']'
        else:
            metadataRight = {
                'name': '',
                'unit': '',
                'prefix': ''

            }
            printNameRight = yRightName + ' ERROR!!'
            ax1Label = ''
        
        
        '''

        if 'title' in plotOptions['params']:
            title = plotOptions['params']['title']
        else:
            title = ''
            title = metadataLeft['name'] + '/' + metadataX['name'] + ' curve of '
            if yLeftName in results.keys():
                title += printNameLeft
            #if yLeftName in results.keys() and yRightName in results.keys():
            #    title += ' and '
            #if yRightName in results.keys():
            #    title += printNameRight
        
        ax.set_ylabel(axLabel, fontsize=formatOptions['fonts']['ylabel'])
        #ax1.set_ylabel(ax1Label, fontsize=formatOptions['fonts']['ylabel'])
        ax.set_title(title, fontsize=formatOptions['fonts']['title'])
        ax.set_xlabel(xLabel, fontsize=formatOptions['fonts']['xlabel'])
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> init Error')

    try:
        halfTime = int(len(results[xLeftName]['data'])/2)
        # Plot the first half of the data
        if results[xLeftName] and results[yLeftName]:
            xDataArray = results[xLeftName]['data'][plotOptions['options']['toIgnore']:halfTime]
            yDataArray = results[yLeftName]['data'][plotOptions['options']['toIgnore']:halfTime]
            yLeftColor = plotOptions['params']['yLeftColor']
            ax.plot(
                np.array(xDataArray),
                np.array(yDataArray), 
                color=yLeftColor, 
                label = 'Volume In/Out'
            )
    
        '''
        if results[xRightName] and results[yRightName]:
            yRightColor = plotOptions['params']['yRightColor']
            ax1.plot(
                np.array(results[xRightName]['data'][plotOptions['options']['toIgnore']:]),
                np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:]), 
                color=yRightColor, 
                label = _disp(yRightName)
            )
        '''

        try:
            timer = results[plotOptions['params']['cycle']]['data'][plotOptions['options']['toIgnore']:halfTime]
            inflection_indices = []
            #smoothed_series = savgol_filter(timer, window_length=11, polyorder=2)
            timer_diff = np.diff(timer)
            for idx,val in enumerate(timer_diff):
                if idx > 3:
                    if val < -0.5:
                        inflection_indices.append(idx)
            #print(inflection_indices)
        except Exception as e:
            print(e)
            print('Error: buildOneAgainstAnother: ' + str(title) + ' -> inflection_indices Error')

        try:
            maxArrayVol = np.zeros(halfTime)
            maxArrayPre = np.zeros(halfTime)
            for i,index in enumerate(inflection_indices):
                if i == 0:
                    if index == 0:
                        maxArrayVol[0] = yDataArray[0]
                        maxArrayPre[0] = xDataArray[0]
                    else:
                        pMax = np.argmax(xDataArray[0:index])
                        maxArrayVol[0:index] = yDataArray[pMax]
                        maxArrayPre[0:index] = xDataArray[pMax]
                else:
                    pMax = np.argmax(xDataArray[inflection_indices[i-1]:index])
                    maxArrayVol[inflection_indices[i-1]:index] = yDataArray[pMax + inflection_indices[i-1]]
                    maxArrayPre[inflection_indices[i-1]:index] = xDataArray[pMax + inflection_indices[i-1]]
            
            maxArrayVol[inflection_indices[-1]:] = maxArrayVol[inflection_indices[-1]-2]
            maxArrayPre[inflection_indices[-1]:] = maxArrayPre[inflection_indices[-1]-2]
            inspV =  maxArrayVol[0:int(halfTime)] - min(yDataArray)
            inspP = maxArrayPre[0:int(halfTime)]
        
            ax.plot( inspP ,inspV, color='tab:blue', label = 'Inspiration Curve',linewidth=4)
        except Exception as e:
            print(e)
            print('Error: buildOneAgainstAnother: ' + str(title) + ' -> min_max Error')

         # Perform curve fitting
        if plotOptions['params']['trendLines']['show']:
            try:
                p0=[3988,0.16,24,200]
                maxfev = 120000
                bounds=([1600,0.04,0,-1000],[8600,0.5,500,4000])
                popt, pcov = curve_fit(utils.sigmoid, inspP, inspV, p0=p0, maxfev=maxfev, bounds=bounds)
                v_max, k, p_0, v_0 = popt
                adjustedCurve = utils.sigmoid(inspP, v_max, k, p_0, v_0)
                residuals = inspV - adjustedCurve
                ss_res = np.sum(residuals**2)
                ss_tot = np.sum((inspV - np.mean(inspV))**2)
                r_squared = round(1 - (ss_res / ss_tot),2)
                ax.plot(inspP, adjustedCurve, 'tab:orange', label='Sigmoid: v_max: ' + str(round(v_max,0)) + ', k: ' + str(round(k,2)) + ', p_0: ' + str(round(p_0,0)) + ', v_0: ' + str(round(v_0,0)))
            except Exception as e:
                print(e)
                print('Error: buildOneAgainstAnother: ' + str(title) + ' -> curve_fit Error')

    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.plot() Error')

    # Set the ticks - not in use, only makes sense for where there is a right axis
    try:
        if plotOptions['options']['ticks']['useCustomTicks']:

            if results[xLeftName] and results[yLeftName]:
                ticks = []
                ticks.append(np.round(max(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['minLeft']:
                    ticks.append(np.round(min(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['averageLeft']:
                    ticks.append(np.round(np.mean(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                ax.set_yticks(ticks)

            '''
            if results[xRightName] and results[yRightName]:
                ticks1 = []
                ticks1.append(np.round(max(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['minRight']:
                    ticks1.append(np.round(min(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['averageRight']:
                    ticks1.append(np.round(np.mean(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                ax1.set_yticks(ticks1)
            '''
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.set_yticks() Error')

    # Set the limits - not in use, only makes sense for where there is a right axis
    try:
        if plotOptions['options']['ticks']['useCustomTicks']:
            minL = []
            maxL = []
            minL.append(min(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])))
            maxL.append(max(np.array(results[yLeftName]['data'][plotOptions['options']['toIgnore']:])))
            
            '''
            minR = []
            maxR = []
            minR.append(min(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])))
            maxR.append(max(np.array(results[yRightName]['data'][plotOptions['options']['toIgnore']:])))
            '''

            if plotOptions['options']['ticks']['dependentScales']:
                pass
                '''
                minP = min(min(minL), min(minR))
                maxP = max(max(maxL), max(maxR))
                ax.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
                ax1.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
                '''
            else:
                ax.set_ylim(min(minL) - plotOptions['options']['offset'], max(maxL) + plotOptions['options']['offset'])
                #ax1.set_ylim(min(minR) - plotOptions['options']['offset'], max(maxR) + plotOptions['options']['offset'])
    except Exception as e:
        print(e)
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.set_ylim() Error')

    if plotOptions['options']['legend']['show']:
        ax.legend(loc=plotOptions['options']['legend']['left'], fontsize=formatOptions['fonts']['legend'])
        #ax1.legend(loc=plotOptions['options']['legend']['right'], fontsize=formatOptions['fonts']['legend'])


##██████   █████  ███████     ███████ ██   ██  ██████ ██   ██  █████  ███    ██  ██████  ███████      █████  ██   ██ ███████ ███████ 
#██       ██   ██ ██          ██       ██ ██  ██      ██   ██ ██   ██ ████   ██ ██       ██          ██   ██  ██ ██  ██      ██      
#██   ███ ███████ ███████     █████     ███   ██      ███████ ███████ ██ ██  ██ ██   ███ █████       ███████   ███   █████   ███████ 
#██    ██ ██   ██      ██     ██       ██ ██  ██      ██   ██ ██   ██ ██  ██ ██ ██    ██ ██          ██   ██  ██ ██  ██           ██ 
##██████  ██   ██ ███████     ███████ ██   ██  ██████ ██   ██ ██   ██ ██   ████  ██████  ███████     ██   ██ ██   ██ ███████ ███████ 

def buildCompartmentPartialPressure(ax,results,modelStructure,plotOptions,formatOptions):
    
    try:
        formatter = ScalarFormatter(useMathText=False, useOffset=False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        ax1 = ax.twinx()
        ax1.xaxis.set_major_formatter(formatter)
        ax1.yaxis.set_major_formatter(formatter)
        ax1.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax1.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        ax.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        ax1.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
    except:
        print('Error: buildTwoSideBySide: ' + ' -> init Error')
    try:
        prefixes = modelStructure['data']['prefixes']

        if 'compartment' in plotOptions['params']: 
            compartmentName = plotOptions['params']['compartment']
        else: compartmentName = ''

        if 'unit' in plotOptions['params']:
            unit = plotOptions['params']['unit']
        else: unit = ''

        title = 'Partial Pressure of the gases in: ' + compartmentName
        axLabel = '[' + unit + ']'
        ax1Label = '[' + unit + ']'
        
        ax.set_ylabel(axLabel, fontsize=formatOptions['fonts']['ylabel'])
        ax1.set_ylabel(ax1Label, fontsize=formatOptions['fonts']['ylabel'])
        ax.set_title(title, fontsize=formatOptions['fonts']['title'])
        ax.set_xlabel('Time [s]', fontsize=formatOptions['fonts']['xlabel'])
    except:
        print('Error: buildCompartmentPartialPressure: ' + ' -> init Error')

    try:
        if plotOptions['options']['zeroTime']:
            t = results['T']['data'] - results['T']['data'][0]
        else:
            t = results['T']['data']
        valueCompartment = modelStructure['compartments'][plotOptions['params']['compartment']]

        pressures = []
        pressures1 = []
        for keyResults,valueResults in results.items(): # Loop all Results
            if plotOptions['params']['compartment'] in keyResults: # If the compartment is in the results
                gasRegion = modelStructure['gasRegions'][valueCompartment['gasRegion']] # Get the gasRegion
                for keyGas,gas in gasRegion['gases'].items(): # Loop all gases in the gasRegion
                    if keyGas in keyResults: # If the gas is in the results
                        if keyResults.startswith(prefixes['pressure']['prefix']): # If the results is a pressure
                            gasColor = formatOptions['gases'][keyGas]['color']
                            
                            if results[keyResults]['metadata']['unit'] == unit:
                                if keyGas in ['N2']:
                                    pressures1.append(keyResults)
                                    ax1.plot(np.array(t[plotOptions['options']['toIgnore']:]),np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:]), color=gasColor, label = keyResults)
                                else:
                                    pressures.append(keyResults)
                                    ax.plot(np.array(t[plotOptions['options']['toIgnore']:]),np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:]), color=gasColor, label = keyResults)
    except:
        print('Error: buildCompartmentPartialPressure: ' + str(title) + ' -> ax.plot() Error')

    try:
        if plotOptions['options']['ticks']['useCustomTicks']:
            ticks = []
            ticks1 = []
            for keyResults in pressures:
                ticks.append(np.round(max(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['minLeft']:
                    ticks.append(np.round(min(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['averageLeft']:
                    ticks.append(np.round(np.mean(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
            for keyResults in pressures1:
                ticks1.append(np.round(max(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['minRight']:
                    ticks1.append(np.round(min(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                if plotOptions['options']['ticks']['params']['averageRight']:
                    ticks1.append(np.round(np.mean(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
            
                ax.set_yticks(ticks)
                ax1.set_yticks(ticks1)
    except:
        print('Error: buildCompartmentPartialPressure: ' + str(title) + ' -> ax.set_yticks() Error')

    try:
        if plotOptions['options']['ticks']['useCustomTicks']:
            minL = []
            maxL = []
            minR = []
            maxR = []
            for keyResults in pressures:
                minL.append(min(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])))
                maxL.append(max(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])))
            for keyResults in pressures1:
                minR.append(min(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])))
                maxR.append(max(np.array(results[keyResults]['data'][plotOptions['options']['toIgnore']:])))

            if plotOptions['options']['ticks']['dependentScales']:
                minP = min(min(minL), min(minR))
                maxP = max(max(maxL), max(maxR))
                ax.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
                ax1.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
            else:
                ax.set_ylim(min(minL) - plotOptions['options']['offset'], max(maxL) + plotOptions['options']['offset'])
                ax1.set_ylim(min(minR) - plotOptions['options']['offset'], max(maxR) + plotOptions['options']['offset'])
    except:
        print('Error: buildCompartmentPartialPressure: ' + str(title) + ' -> ax.set_ylim() Error')

    

    if plotOptions['options']['legend']['show']:
        ax.legend(loc=plotOptions['options']['legend']['left'], fontsize=formatOptions['fonts']['legend'])
        ax1.legend(loc=plotOptions['options']['legend']['right'], fontsize=formatOptions['fonts']['legend'])

##██████ ██████  ███████  █████  ████████ ███████     ██████  ██       ██████  ████████     ███████ ██ ██      ███████ 
#██      ██   ██ ██      ██   ██    ██    ██          ██   ██ ██      ██    ██    ██        ██      ██ ██      ██      
#██      ██████  █████   ███████    ██    █████       ██████  ██      ██    ██    ██        █████   ██ ██      █████   
#██      ██   ██ ██      ██   ██    ██    ██          ██      ██      ██    ██    ██        ██      ██ ██      ██      
##██████ ██   ██ ███████ ██   ██    ██    ███████     ██      ███████  ██████     ██        ██      ██ ███████ ███████ 


#██   ██ ██ ███████ ████████  ██████   ██████  ██████   █████  ███    ███ ███████ 
#██   ██ ██ ██         ██    ██    ██ ██       ██   ██ ██   ██ ████  ████ ██      
#███████ ██ ███████    ██    ██    ██ ██   ███ ██████  ███████ ██ ████ ██ ███████ 
#██   ██ ██      ██    ██    ██    ██ ██    ██ ██   ██ ██   ██ ██  ██  ██      ██ 
#██   ██ ██ ███████    ██     ██████   ██████  ██   ██ ██   ██ ██      ██ ███████
        
def buildMultiSideBySideHistogram(ax,results,modelStructure,plotOptions,formatOptions):
    try:
        formatter = ScalarFormatter(useMathText=False, useOffset=False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        #ax.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        #ax.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        if 'right' in plotOptions['params']:
            ax1 = ax.twinx()
            ax1.xaxis.set_major_formatter(formatter)
            ax1.yaxis.set_major_formatter(formatter)
            ax1.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
            ax1.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
            ax1.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        
        ax.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
    except Exception as e:
        print(e)
        print('Error: buildMultiSideBySideHistogram: ' + ' -> init Error')

    try:
        title = plotOptions['params']['title']
        toPlotLeft = []
        axLabel = ''
        if 'left' in plotOptions['params']: 
            leftNames = plotOptions['params']['left']
            for name in leftNames:
                if name in results.keys() :
                    toPlotLeft.append(name)
                    metadataLeft = results[name]['metadata']
                    axLabel ='[' + metadataLeft['unit'] + ']'
                else:
                    metadataLeft = {
                        'name': '',
                        'unit': '',
                        'prefix': ''

                    }
                    axLabel = ''
        else: leftNames = ['']


        toPlotRight = []
        ax1Label = ''
        if 'right' in plotOptions['params']: 
            rightNames = plotOptions['params']['right']
            for name in rightNames:
                if name in results.keys():
                    toPlotRight.append(name)
                    metadataRight = results[name]['metadata']
                    ax1Label = '[' + metadataRight['unit'] + ']'
                else:
                    metadataRight = {
                        'name': '',
                        'unit': '',
                        'prefix': ''

                    }
                    ax1Label = ''
        else: 
            rightNames = ''
            metadataRight = {
                    'name': '',
                    'unit': '',
                    'prefix': ''
                }
            ax1Label = ''


        
        ax.set_ylabel('Count', fontsize=formatOptions['fonts']['ylabel'])
        if 'right' in plotOptions['params']:
            ax1.set_ylabel(ax1Label, fontsize=formatOptions['fonts']['ylabel'])
        ax.set_title(title, fontsize=formatOptions['fonts']['title'])
        ax.set_xlabel(axLabel, fontsize=formatOptions['fonts']['xlabel'])
    except Exception as e:
        print(e)
        print('Error: buildMultiSideBySideHistogram: ' + ' -> title Error')
        print('__________________________________________________________________')

    try:
        # always use a new color for each line independently of the number of the axes
        
        if 'colors' in plotOptions['params']:
            colors = copy.deepcopy(plotOptions['params']['colors'])
        else:
            colors = utils.getColors(len(toPlotLeft) + len(toPlotRight),'random')

        if 'edgecolor' in plotOptions['params']:
            edgecolor = plotOptions['params']['edgecolor']
        else:
            edgecolor = 'black'
        
        for leftName in toPlotLeft:
            color = colors.pop()
            ax.hist(
                np.array(results[leftName]['data'][plotOptions['options']['toIgnore']:]), 
                bins = plotOptions['params']['bins'],
                alpha = plotOptions['params']['alpha'],
                color = color,
                edgecolor = edgecolor
            )
        for rightName in toPlotRight:
            color = colors.pop()
            ax1.hist(
                np.array(results[rightName]['data'][plotOptions['options']['toIgnore']:]), 
                bins = plotOptions['params']['bins'],
                alpha = plotOptions['params']['alpha'],
                color = color,
                edgecolor = edgecolor
                )
    except Exception as e:
        print(e)
        print('Error: buildMultiSideBySideHistogram: ' + str(title) + ' -> ax.plot() Error')
        print('__________________________________________________________________')

    if plotOptions['options']['legend']['show']:
        ax.legend(loc=plotOptions['options']['legend']['left'], fontsize=formatOptions['fonts']['legend'])
        if 'right' in plotOptions['params']:
            ax1.legend(loc=plotOptions['options']['legend']['right'], fontsize=formatOptions['fonts']['legend'])


'''
def buildOneAgainstAnotherMulti(ax,results,modelStructure,plotOptions,formatOptions):
    try:
        formatter = ScalarFormatter(useMathText=False, useOffset=False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        ax1 = ax.twinx()
        ax1.xaxis.set_major_formatter(formatter)
        ax1.yaxis.set_major_formatter(formatter)
        ax1.xaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        ax1.yaxis.set_major_locator(MaxNLocator(nbins=formatOptions['nbins']))
        
        ax.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        ax1.tick_params(axis='both', which='major', labelsize=formatOptions['fonts']['ticks'])
        if 'title' in plotOptions['params']:
            title = plotOptions['params']['title']
        else:
            title = ''
            title = metadataLeft['name'] + '/' + metadataX['name'] + ' curve of '

    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + ' -> init Error')
        print(e)

    try:
        if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']): 
            for xLeftName in plotOptions['params']['xLeft']:
                if xLeftName in results.keys():
                    metadataX = results[xLeftName]['metadata']
                    if 'xLabel' in plotOptions['params']:
                        xLabel = plotOptions['params']['xLabel']
                    else:
                        xLabel = '[' + metadataX['unit'] + ']'
            for yLeftName in plotOptions['params']['yLeft']:
                if yLeftName in results.keys():
                    metadataLeft = results[yLeftName]['metadata']
                    if 'yLeftLabel' in plotOptions['params']:
                        axLabel = plotOptions['params']['yLeftLabel']
                    else:
                        axLabel ='[' + metadataLeft['unit'] + ']'
                    break
                else:
                    print('Error: buildOneAgainstAnotherMulti: ' + str(title) + ' -> yLeftName Error') 
        else: 
            metadataLeft = {
                'name': '',
                'unit': '',
                'prefix': ''
            }
            axLabel = ''
            metadataX = {
                'name': '',
                'unit': '',
                'prefix': ''
            }
            xLabel = ''

        if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
            for yRightName in plotOptions['params']['yRight']:
                if yRightName in results.keys():
                    metadataRight = results[yRightName]['metadata']
                    if 'yRightLabel' in plotOptions['params']:
                        ax1Label = plotOptions['params']['yRightLabel']
                    else:
                        ax1Label = '[' + metadataRight['unit'] + ']'

                else:
                    print('Error: buildOneAgainstAnotherMulti: ' + str(title) + ' -> yRightName Error')
        else: 
            metadataRight = {
                'name': '',
                'unit': '',
                'prefix': ''
            }
            ax1Label = ''
            xRightName = ''
        
        

        ax.set_ylabel(axLabel, fontsize=formatOptions['fonts']['ylabel'])
        ax1.set_ylabel(ax1Label, fontsize=formatOptions['fonts']['ylabel'])
        ax.set_title(title, fontsize=formatOptions['fonts']['title'])
        ax.set_xlabel(xLabel, fontsize=formatOptions['fonts']['xlabel'])
    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> init Error')
        print(e)

    try:
        if 'colorsLeft' in plotOptions['params']:
            cmap = mpl.get_cmap(plotOptions['params']['colorsLeft'])
            nrColors = len(plotOptions['params']['yLeft'])
            colorsLeft = [cmap((i+2) / (nrColors+2)) for i in range(nrColors)]
            if  plotOptions['params']['left'] != []:
                ax.tick_params(axis='y', labelcolor=colorsLeft[-1])
        if 'colorsRight' in plotOptions['params']:
            cmap = mpl.get_cmap(plotOptions['params']['colorsRight'])
            nrColors = len(plotOptions['params']['yRight'])
            colorsRight = [cmap((i+2) / (nrColors+2)) for i in range(nrColors)]
            if  plotOptions['params']['right'] != []:
                ax1.tick_params(axis='y', labelcolor=colorsRight[-1])



        if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']):
            for res1,res2 in zip(plotOptions['params']['yLeft'],plotOptions['params']['xLeft']):
                if results[res1] and results[res2]:
                    ax.plot(
                        np.array(results[res2]['data'][plotOptions['options']['toIgnore']:]),
                        np.array(results[res1]['data'][plotOptions['options']['toIgnore']:]), 
                        color=colorsLeft.pop(), 
                        label = res1
                    )
        
        if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
            for res1,res2 in zip(plotOptions['params']['yRight'],plotOptions['params']['xRight']):
                if results[res1] and results[res2]:
                    ax1.plot(
                        np.array(results[res2]['data'][plotOptions['options']['toIgnore']:]),
                        np.array(results[res1]['data'][plotOptions['options']['toIgnore']:]), 
                        color=colorsRight.pop(), 
                        label = res1
                    )
    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.plot() Error')
        print(e)

    try:
        if plotOptions['options']['ticks']['useCustomTicks']:
            ticks = []
            if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']):
                for res1,res2 in zip(plotOptions['params']['yLeft'],plotOptions['params']['xLeft']):
                    if results[res2] and results[res1]:
                        if plotOptions['options']['ticks']['params']['maxLeft']:
                            ticks.append(np.round(max(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                        if plotOptions['options']['ticks']['params']['minLeft']:
                            ticks.append(np.round(min(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                        if plotOptions['options']['ticks']['params']['averageLeft']:
                            ticks.append(np.round(np.mean(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
            if 'ticksLeft' in plotOptions['options']['ticks']['params']:
                for tck in plotOptions['options']['ticks']['params']['ticksLeft']:
                    ticks.append(tck)
            ax.set_yticks(ticks)
            
            ticks1 = []
            if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
                for res1,res2 in zip(plotOptions['params']['yRight'],plotOptions['params']['xRight']):
                    if results[res2] and results[res1]:
                        if plotOptions['options']['ticks']['params']['maxRight']:
                            ticks1.append(np.round(max(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                        if plotOptions['options']['ticks']['params']['minRight']:
                            ticks1.append(np.round(min(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
                        if plotOptions['options']['ticks']['params']['averageRight']:
                            ticks1.append(np.round(np.mean(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])),plotOptions['options']['round']))
            if 'ticksRight' in plotOptions['options']['ticks']['params']:
                for tck in plotOptions['options']['ticks']['params']['ticksRight']:
                    ticks1.append(tck)
            ax1.set_yticks(ticks1)

            if 'ticksX' in plotOptions['options']['ticks']['params']:
                ax.set_xticks(plotOptions['options']['ticks']['params']['ticksX'])
    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.set_yticks() Error')
        print(e)

    try:
        if plotOptions['options']['ticks']['useCustomTicks']:
            minL = []
            maxL = []
            if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']):
                for res1,res2 in zip(plotOptions['params']['yLeft'],plotOptions['params']['xLeft']):
                    if results[res2] and results[res1]:
                        minL.append(min(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])))
                        maxL.append(max(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])))
            

            minR = []
            maxR = []
            if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
                for res1,res2 in zip(plotOptions['params']['yRight'],plotOptions['params']['xRight']):
                    if results[res2] and results[res1]:
                        minR.append(min(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])))
                        maxR.append(max(np.array(results[res1]['data'][plotOptions['options']['toIgnore']:])))

            if plotOptions['options']['ticks']['dependentScales']:
                minP = min(min(minL), min(minR))
                maxP = max(max(maxL), max(maxR))
                ax.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
                ax1.set_ylim([minP - plotOptions['options']['offset'], maxP + plotOptions['options']['offset']])
            else:
                ax.set_ylim(min(minL) - plotOptions['options']['offset'], max(maxL) + plotOptions['options']['offset'])
                ax1.set_ylim(min(minR) - plotOptions['options']['offset'], max(maxR) + plotOptions['options']['offset'])
    except Exception as e:
        print('Error: buildOneAgainstAnother: ' + str(title) + ' -> ax.set_ylim() Error')
        print(e)

    if plotOptions['options']['legend']['show']:
        if ('yLeft' in plotOptions['params']) and ('xLeft' in plotOptions['params']):
            ax.legend(loc=plotOptions['options']['legend']['left'], fontsize=formatOptions['fonts']['legend'])
        if ('yRight' in plotOptions['params']) and ('xRight' in plotOptions['params']):
            ax1.legend(loc=plotOptions['options']['legend']['right'], fontsize=formatOptions['fonts']['legend'])

'''


def plotCalibrationConvergence(traces, traceT=None, targets=None, offsets=None,
                               paramForObs=None, nrCols=3, showRuns=None, ranges=None,
                               showLegend=True, title="Calibration convergence", figScale=1.0,
                               ylim=None, robustPct=(1, 99), divLimit=None,
                               runValues=None, runValueLabel=None):
    """Self-contained port of the legacy convergence plot (buildConvPlot) — no buildPlot
    machinery. One panel per signal in `traces`; each panel overlays the converged
    steady-cycle trajectory of that signal for every population member (one jet-colored
    line per run), with a dashed line at its twin target. Shows how tightly the calibrated
    population clusters on each target.

    Args:
        traces:   {name: (Nruns, nT)} per-run trajectories (already restricted to good runs).
        traceT:   (nT,) time axis (s); defaults to the sample index.
        targets:  {name: targetValue} gauge target per signal (missing/None -> no line).
        offsets:  {name: offset} subtracted from each trace (gauge conversion); default 0.
        paramForObs: {obsName: paramName} -> annotate the controlling parameter in titles.
        nrCols:   number of panel columns.
        showRuns: cap on run-lines drawn per panel (speed); None = all.
        ranges:   {name: (lo, hi)} sampling range per signal -> dotted min/max lines.
        showLegend: draw a per-panel legend (target/range labels). When False, the target
                  value is appended to the panel title instead and no legend is drawn.
        title:    figure suptitle.
        ylim:     per-panel y-limit mode. None -> matplotlib autoscale (default). "initial" ->
                  frame each panel to the robust range of its FIRST time column (the iteration-0
                  ensemble spread), so transient early divergences run off-screen while the
                  convergence toward the target stays framed. "robust" -> frame to the robust range
                  of the whole trajectory. Either mode keeps the target line on-screen.
        robustPct: (lo, hi) percentiles handed to utils.robustYLim for the "initial"/"robust" modes.
        divLimit: when the "initial"/"robust" framing is on, drop members with |value| >= divLimit
                  BEFORE computing the robust y-limits. A small ensemble's transiently-diverged
                  members (|obs| ~ 1e20) sit past the 1st/99th percentile yet can't be trimmed by
                  robustPct alone (1% of e.g. 64 members < 1 point), so they'd still blow up the
                  axis; masking at the project's out-of-scope threshold removes them cleanly. None
                  (default) applies no mask.
        runValues: (Nruns,) physical value encoded by each run's line color (e.g. the swept
                  inductance L per lane, in lane order). When given, a figure-level colorbar
                  legends the jet color code, ticked with these values. None (default) = no bar.
        runValueLabel: colorbar axis label (e.g. "L_Hl_As (mmHg·s²/mL)").

    Returns the matplotlib Figure.
    """
    targets = targets or {}
    offsets = offsets or {}
    paramForObs = paramForObs or {}
    ranges = ranges or {}
    names = [n for n in traces if traces[n] is not None and np.size(traces[n])]
    if not names:
        print("plotCalibrationConvergence: no traces to plot")
        return None

    nrPlots = len(names)
    nrRows = int(np.ceil(nrPlots / nrCols))
    fig, axes = mpl.subplots(nrRows, nrCols,
                             figsize=(5.0 * nrCols * figScale, 3.2 * nrRows * figScale),
                             squeeze=False)
    cmap = mpl.cm.get_cmap("jet")
    nRunsSeen = 0

    for k, name in enumerate(names):
        ax = axes[k // nrCols][k % nrCols]
        arr = np.atleast_2d(np.asarray(traces[name], dtype=float)) - offsets.get(name, 0.0)
        nRuns = arr.shape[0]
        nRunsSeen = max(nRunsSeen, nRuns)
        x = traceT if (traceT is not None and len(traceT) == arr.shape[1]) else np.arange(arr.shape[1])
        idx = range(nRuns) if showRuns is None else range(min(showRuns, nRuns))
        for r in idx:
            ax.plot(x, arr[r], lw=0.6, alpha=0.5, color=cmap(r / max(nRuns - 1, 1)))
        tgt = targets.get(name)
        if tgt is not None and np.isfinite(tgt):
            ax.axhline(tgt, color="k", ls="--", lw=1.2, label=f"target = {tgt:.4g}")
        rng = ranges.get(name)
        if rng is not None and np.all(np.isfinite(rng)):
            lo, hi = float(rng[0]) - offsets.get(name, 0.0), float(rng[1]) - offsets.get(name, 0.0)
            ax.axhline(lo, color="grey", ls=":", lw=1.1, label=f"range = [{lo:.4g}, {hi:.4g}]")
            ax.axhline(hi, color="grey", ls=":", lw=1.1)
        if showLegend and ((tgt is not None and np.isfinite(tgt)) or rng is not None):
            ax.legend(loc="best", fontsize=8)
        if ylim in ("initial", "robust") and arr.shape[1] > 0:
            src = np.asarray(arr[:, 0] if ylim == "initial" else arr, dtype=float).ravel()
            if divLimit is not None:                             # drop diverged members before framing
                src = src[np.abs(src) < float(divLimit)]         # (robustPct can't trim a lone spike)
            loY, hiY = utils.robustYLim(src, p=robustPct)
            if tgt is not None and np.isfinite(tgt):             # keep the target line on-screen
                loY, hiY = min(loY, tgt), max(hiY, tgt)
                pad = 0.04 * (hiY - loY) if hiY > loY else 1.0
                loY, hiY = loY - pad, hiY + pad
            if np.isfinite(loY) and np.isfinite(hiY) and hiY > loY:
                ax.set_ylim(loY, hiY)
        ttl = _disp(name, name)
        if name in paramForObs:
            ttl += f"  <-  {_disp(paramForObs[name], paramForObs[name])}"
        if not showLegend and tgt is not None and np.isfinite(tgt):
            ttl += f"  (target = {tgt:.4g})"
        ax.set_title(ttl, fontsize=11)
        ax.set_xlabel("time (s)" if traceT is not None else "sample")
        ax.tick_params(labelsize=8)

    for k in range(nrPlots, nrRows * nrCols):       # blank any unused panels
        axes[k // nrCols][k % nrCols].axis("off")

    vals = np.asarray(runValues, dtype=float).ravel() if runValues is not None else None
    withBar = vals is not None and min(len(vals), nRunsSeen) > 1

    fig.suptitle(f"{title}  ({nrPlots} signals, {nRunsSeen} runs)", fontsize=13)
    fig.tight_layout(rect=(0, 0, 0.92 if withBar else 1, 0.98))

    if withBar:
        # lines are colored by run INDEX (cmap(r/(nRuns-1))), so the bar spans index space
        # and its ticks are labelled with the physical value of those indices
        n = min(len(vals), nRunsSeen)
        cax = fig.add_axes((0.935, 0.10, 0.012, 0.78))
        sm = mpl.cm.ScalarMappable(cmap=cmap, norm=mpl.Normalize(0, n - 1))
        tickIdx = np.unique(np.linspace(0, n - 1, min(n, 8)).round().astype(int))
        cbar = fig.colorbar(sm, cax=cax, ticks=tickIdx)
        cbar.ax.set_yticklabels([f"{vals[i]:.3g}" for i in tickIdx], fontsize=8)
        if runValueLabel:
            cbar.set_label(runValueLabel, fontsize=9)
    return fig


def plotStageSchedule(columns, params, ranges=None, figSize=(3.35, 3.6), fontSize=7,
                      ylim="robust", robustPct=(1, 99), divLimit=None, showRuns=None,
                      stageLabels=True, title=None, xLabel="normalised progress",
                      xScale="linear"):
    """Parameter trajectories laid out one ROW per parameter and one COLUMN per calibration
    schedule, with that schedule's stage changes marked.

    The exploratory `plotCalibrationConvergence` grid cannot express this: it takes ONE shared
    time axis for every panel, and here each column has its own sample count (a schedule of 365
    saved runs against one of 665) plus its own set of vertical marks. Progress is therefore
    normalised to [0,1] per column, so schedules of different simulated length are compared on
    the SHAPE of the approach -- the per-stage cost belongs in the companion table, which states
    it in forward solves.

    Args:
        columns: [{"label": str,                      # column heading (the schedule's name)
                   "traces": {param: (nLane, nT)},    # per-lane trajectory, one entry per param
                   "prog":   (nT,),                   # x over this schedule: progress in [0,1],
                                                      #   or an absolute clock (simulated seconds)
                   "stages": [(prog, text), ...]}]    # stage CHANGES to mark, in "prog" units
                 Only stage changes that actually run belong in "stages"; a stage contributing
                 no saved runs has no width and would draw a duplicate line on its neighbour.
        params:  row order. A param missing from a column's traces leaves that panel empty.
        ranges:  {param: (lo, hi)} prior box per parameter -> dotted grey min/max lines.
        figSize: (w, h) inches. Authored AT the target column width, so fontSize is the final
                 rendered size (a wide figure downscaled into 8.5 cm renders 7 pt text at 2 pt).
        ylim:    "robust" -> frame each ROW to the robust range over all its columns, so the two
                 schedules are read against one another; None -> matplotlib autoscale per panel.
        robustPct: (lo, hi) percentiles handed to utils.robustYLim for the "robust" mode.
        divLimit: drop lanes with |value| >= this before framing (a transiently-diverged lane
                 sits past the 99th percentile yet is too rare for robustPct to trim).
        showRuns: cap on lane lines drawn per panel (speed); None = all.
        stageLabels: annotate each marked stage change with its "stages" text.
        title:   figure suptitle. None = none.
        xLabel:  x-axis label, drawn on the bottom row only.
        xScale:  "linear" (default) or "log". "linear" frames each column to the extent of its
                 own "prog", so an absolute clock reads as real elapsed time and the width of
                 each stage is its true cost. A schedule that spends most of its budget in one
                 long final stage then crowds every earlier stage change into the leftmost few
                 percent; "log" spreads them, at the cost of distorting those widths, and needs
                 "prog" normalised to [0,1] (progress 0 is unplottable, so the first sample is
                 placed at 1/nT instead of 0).

    Returns the matplotlib Figure.
    """
    ranges = ranges or {}
    cols = [c for c in columns if c.get("traces")]
    if not cols or not params:
        print("plotStageSchedule: no columns or no params to plot")
        return None

    nrRows, nrCols = len(params), len(cols)
    fig, axes = mpl.subplots(nrRows, nrCols, figsize=figSize, squeeze=False, sharex="col")
    cmap = mpl.cm.get_cmap("jet")

    for i, name in enumerate(params):
        rowSrc = []                                   # pooled values for the shared row framing
        for j, col in enumerate(cols):
            ax = axes[i][j]
            tr = col["traces"].get(name)
            if tr is None or not np.size(tr):
                ax.axis("off")
                continue
            arr = np.atleast_2d(np.asarray(tr, dtype=float))
            nLane = arr.shape[0]
            x = np.asarray(col["prog"], dtype=float)
            if len(x) != arr.shape[1]:                # fall back to this column's own index space
                x = np.linspace(0.0, 1.0, arr.shape[1])
            if xScale == "log":                       # progress 0 has no place on a log axis
                x = np.where(x <= 0.0, 1.0 / arr.shape[1], x)
            for r in (range(nLane) if showRuns is None else range(min(showRuns, nLane))):
                ax.plot(x, arr[r], lw=0.25, alpha=0.5, color=cmap(r / max(nLane - 1, 1)))

            rng = ranges.get(name)
            if rng is not None and np.all(np.isfinite(rng)):
                ax.axhline(float(rng[0]), color="grey", ls=":", lw=0.5)
                ax.axhline(float(rng[1]), color="grey", ls=":", lw=0.5)

            # Labels are stacked into rows when two marks fall closer together than they can be
            # read apart: a schedule that escalates several times early on puts its first marks
            # within a couple of percent of one another, and a single row of labels overprints.
            lastLabelled, level, maxLevel = -np.inf, 0, -1
            for prog, text in col.get("stages", []):
                prog = float(prog)
                ax.axvline(prog, color="k", ls="--", lw=0.5)
                if not (stageLabels and i == 0 and text):
                    continue
                # top row only: the marks are shared down the column, so labelling every panel
                # would repeat the same schedule once per parameter
                # the crowding gap is in the axis's own units, so it follows an absolute x
                # (simulated seconds) as well as a normalised one
                seen = np.log10(max(prog, 1e-6)) if xScale == "log" else prog
                gap  = 0.10 if xScale == "log" else 0.055 * max(np.ptp(x), 1e-12)
                level = level + 1 if seen - lastLabelled < gap else 0
                lastLabelled, maxLevel = seen, max(maxLevel, level)
                ax.annotate(text, xy=(prog, 1.0), xycoords=("data", "axes fraction"),
                            xytext=(1.0, 1.5 + level * (fontSize + 1.5)),
                            textcoords="offset points", fontsize=fontSize - 2,
                            rotation=90, ha="left", va="bottom")

            src = np.asarray(arr, dtype=float).ravel()
            if divLimit is not None:
                src = src[np.abs(src) < float(divLimit)]
            rowSrc.append(src)

            if i == 0:
                # padded clear of the stage-label stack, which is drawn above the axes and would
                # otherwise print through the column heading
                pad = 3.0 + (maxLevel + 1) * (fontSize + 1.5) + (10.0 if maxLevel >= 0 else 0.0)
                ax.set_title(col["label"], fontsize=fontSize, fontweight="bold", pad=pad)
            if j == 0:
                ax.set_ylabel(_disp(name, name), fontsize=fontSize)
            else:
                ax.tick_params(labelleft=False)
            if i == nrRows - 1:
                ax.set_xlabel(xLabel, fontsize=fontSize)
            if xScale == "log":
                ax.set_xscale("log")
                ax.set_xlim(1.0 / arr.shape[1], 1.0)
            else:
                ax.set_xlim(float(np.min(x)), float(np.max(x)))
            ax.tick_params(labelsize=fontSize - 1)
            ax.grid(ls=":", lw=0.3, color="0.9")

        # one y-range per ROW, pooled over the columns: the panels are only comparable if the
        # same parameter is drawn on the same scale in every schedule
        if ylim == "robust" and rowSrc:
            loY, hiY = utils.robustYLim(np.concatenate(rowSrc), p=robustPct)
            if np.isfinite(loY) and np.isfinite(hiY) and hiY > loY:
                for j in range(nrCols):
                    if axes[i][j].axison:
                        axes[i][j].set_ylim(loY, hiY)

    if title:
        fig.suptitle(title, fontsize=fontSize + 1)
    fig.tight_layout(rect=(0, 0, 1, 0.98 if title else 1))
    return fig


def plotSearchTraces(chainSteps, obsSteps, targets, bounds, paramNames,
                     traceParams, scatterPair=None, groupMask=None,
                     groupLabels=("converged", "trapped"), burnIn=None,
                     errBand=None, figSize=(3.4, 5.2), nrCols=2, title=None,
                     xLabel="iteration", errYLim=None):
    """Compact paper-sized summary of an independent optimiser's / sampler's search.

    The full-page `plotCalibrationConvergence` grid (one panel per parameter, jet-coloured
    by member index) is the exploratory view; this is its publication counterpart. It shows
    only the handful of parameters that separate the outcomes, colours members by OUTCOME
    rather than by index, and adds the two panels that make a local-minimum story legible:
    the per-member residual history and the final-point scatter in a plane where distinct
    basins are visually separated.

    Layout is a fixed six-panel grid so two methods plotted with the same `traceParams` /
    `scatterPair` can be read side by side: panels 1-4 are the four `traceParams`, panel 5
    is worst |relative error| vs iteration (log-y), panel 6 is the final-iteration scatter.

    The default `figSize`/`nrCols` give a 3x2 grid at the width of a single manuscript column
    (8.5 cm), so the figure is included at 1:1 and its 6-8 pt annotations print at 6-8 pt. A
    wider figure downscaled into the same column would render them unreadably small.

    Args:
        chainSteps:  (nIter, nMember, nParam) parameter trajectories, PHYSICAL units.
        obsSteps:    (nIter, nMember, nTarget) observation trajectories, gauge units.
        targets:     (nTarget,) gauge targets, aligned to obsSteps' last axis.
        bounds:      (nParam, 2) prior [lo, hi] per parameter -> dotted range lines.
        paramNames:  (nParam,) names, aligned to chainSteps' last axis.
        traceParams: names to draw in panels 1-4 (any count; the grid takes the first 4).
        scatterPair: (nameX, nameY) for panel 6; None -> the first two `traceParams`.
        groupMask:   (nMember,) bool, True = the "good" group. Members are coloured by group
                     and the counts go in the legend. None -> a single-colour ensemble.
        groupLabels: (goodLabel, badLabel) legend text for the two groups.
        burnIn:      iteration index of a dashed vertical marker (sampler burn-in). None = none.
        errBand:     dashed horizontal reference on the residual panel, in % (e.g. the
                     threshold `groupMask` was derived from). None = none.
        figSize:     (w, h) inches. The default is a 1:1 single-column (8.5 cm) figure.
        nrCols:      panel columns (6 panels total, so 2 -> 3x2, 3 -> 2x3).
        title:       figure suptitle. None = no suptitle (the caption carries it in the paper).
        xLabel:      x-axis label for the trace/residual panels.
        errYLim:     (lo, hi) % limits for the residual panel; None = autoscale.

    Returns the matplotlib Figure.
    """
    chainSteps = np.asarray(chainSteps, dtype=float)
    obsSteps   = np.asarray(obsSteps,   dtype=float)
    targets    = np.asarray(targets,    dtype=float)
    bounds     = np.asarray(bounds,     dtype=float)
    paramNames = list(paramNames)
    idxOf      = {p: j for j, p in enumerate(paramNames)}

    panelParams = [p for p in traceParams if p in idxOf][:4]
    if len(panelParams) < 4:
        raise ValueError(f"plotSearchTraces needs 4 traceParams present in paramNames; "
                         f"got {panelParams} from {list(traceParams)}")
    sx, sy = tuple(scatterPair) if scatterPair else (panelParams[0], panelParams[1])

    nIter, nMember = chainSteps.shape[0], chainSteps.shape[1]
    x = np.arange(nIter)
    # worst |relative error| over the targets, per member per iteration -- the quantity that
    # says whether a member actually FIT, independent of which basin it settled in.
    worstRel = 100.0 * np.nanmax(np.abs(obsSteps - targets) / np.abs(targets), axis=2)

    if groupMask is None:
        groups = [(np.ones(nMember, bool), "C0", None)]
    else:
        good = np.asarray(groupMask, bool)
        groups = [(good,  "C0", f"{good.sum()} {groupLabels[0]}"),
                  (~good, "C3", f"{(~good).sum()} {groupLabels[1]}")]

    fig, axes = mpl.subplots(int(np.ceil(6 / nrCols)), nrCols, figsize=figSize, squeeze=False)
    axes = axes.ravel()

    def _members(ax, y, mask, color):
        """One thin translucent line per member. Drawn as a LineCollection: 128 walkers x 4
        panels is 512 Line2D objects otherwise, which dominates both draw time and PNG size."""
        seg = [np.column_stack([x, y[:, m]]) for m in np.where(mask)[0]]
        if seg:
            ax.add_collection(LineCollection(seg, colors=color, linewidths=0.5, alpha=0.35))

    for k, p in enumerate(panelParams):
        ax = axes[k]
        j = idxOf[p]
        for mask, color, _ in groups:
            _members(ax, chainSteps[:, :, j], mask, color)
        for b in bounds[j]:                                   # prior box -> dotted grey
            ax.axhline(float(b), color="grey", ls=":", lw=0.7)
        if burnIn is not None:
            ax.axvline(float(burnIn), color="k", ls="--", lw=0.7)
        ax.set_xlim(0, nIter - 1)
        # autoscale ignores collection-only artists, so frame to the data explicitly
        lo, hi = utils.robustYLim(chainSteps[:, :, j].ravel(), p=(0, 100))
        ax.set_ylim(min(lo, bounds[j, 0]), max(hi, bounds[j, 1]))
        ax.set_title(_disp(p, p), fontsize=8, pad=2)
        ax.tick_params(labelsize=6)
        # a single-column panel is ~4 cm wide; the default locator packs in ticks that collide
        ax.xaxis.set_major_locator(MaxNLocator(nbins=4))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=5))

    axErr = axes[4]
    for mask, color, label in groups:
        _members(axErr, worstRel, mask, color)
        if label:                                             # legend proxy (collections don't label)
            axErr.plot([], [], color=color, lw=1.2, label=label)
    if errBand is not None:
        axErr.axhline(float(errBand), color="k", ls="--", lw=0.7)
    if burnIn is not None:
        axErr.axvline(float(burnIn), color="k", ls="--", lw=0.7)
    axErr.set_yscale("log")
    axErr.set_xlim(0, nIter - 1)
    if errYLim is not None:
        axErr.set_ylim(*errYLim)
    else:
        fin = worstRel[np.isfinite(worstRel) & (worstRel > 0)]
        if fin.size:
            axErr.set_ylim(max(fin.min() * 0.5, 1e-3), np.percentile(fin, 99.5) * 2)
    axErr.set_title("worst |rel. err| (%)", fontsize=8, pad=2)
    axErr.tick_params(labelsize=6)
    axErr.xaxis.set_major_locator(MaxNLocator(nbins=4))
    if any(lbl for _, _, lbl in groups):
        axErr.legend(loc="best", fontsize=6, frameon=False)

    axSc = axes[5]
    jx, jy = idxOf[sx], idxOf[sy]
    # good group drawn LAST: its cluster is tight enough to be hidden under the few bad members
    # that land geometrically close to it but miss the residual threshold.
    for mask, color, _ in reversed(groups):
        axSc.scatter(chainSteps[-1, mask, jx], chainSteps[-1, mask, jy],
                     s=6, c=color, alpha=0.7, linewidths=0)
    axSc.set_xlabel(_disp(sx, sx), fontsize=7, labelpad=1)
    axSc.set_ylabel(_disp(sy, sy), fontsize=7, labelpad=1)
    axSc.set_title("final points", fontsize=8, pad=2)
    axSc.tick_params(labelsize=6)
    axSc.xaxis.set_major_locator(MaxNLocator(nbins=4))
    axSc.yaxis.set_major_locator(MaxNLocator(nbins=5))

    for ax in axes[:5]:
        ax.set_xlabel(xLabel, fontsize=7, labelpad=1)
    for ax in axes[6:]:                                       # blank any unused grid cell
        ax.axis("off")

    if title:
        fig.suptitle(title, fontsize=9)
    fig.tight_layout(rect=(0, 0, 1, 0.96 if title else 1.0), pad=0.5, w_pad=0.9, h_pad=1.1)
    return fig


def plotSimulationWindows(tracesByVariant, dt, variables, windows,
                          targets=None, offsets=None, colors=None,
                          title="Simulation windows", figScale=1.0):
    """Overlay each variant's dense trajectory for a set of variables across several
    trailing time windows. Grid = len(variables) rows x len(windows) cols; each cell
    slices every variant's trace to its own last `w` seconds (w=None => whole trace) and
    overlays the variants on a shared "time before end of calibration" axis (0 = the end
    of each variant's run), with a dashed twin-target line and a gauge offset subtracted.

    Each variant carries its OWN time axis built from `dt` (variants may have different
    trace lengths — e.g. a run that saved fewer stages), so they are aligned at the
    right edge (end of calibration) rather than requiring equal lengths. Used by the
    cubic-vs-linear controller comparison notebook (whole run / last minute / last 5 s).

    Args:
        tracesByVariant: {variantLabel: {varName: (nT,) trace}}; per-variant nT may differ.
        dt:       dense-grid spacing in seconds (runConfig["dtDense"]) -> per-variant axis.
        variables: ordered list of variable names -> one row each.
        windows:  ordered list of (windowLabel, seconds[, endOffset]) -> one column each.
                  seconds=None means the whole trace. Optional endOffset (seconds, a scalar
                  or a {variantLabel: seconds} dict) shifts the window's right edge back from
                  the end of the trace -- e.g. the controllers-off settle-tail duration, so
                  the window ends at the instant control stopped. That column is re-zeroed at
                  the instant (x = time before it), aligning variants there.
        targets:  {name: targetValue} gauge target per signal (missing/None -> no line).
        offsets:  {name: offset} subtracted from each trace (gauge conversion); default 0.
        colors:   {variantLabel: colorspec}; default = a fixed cycle.
        title:    figure suptitle.

    Returns the matplotlib Figure.
    """
    def _endOffset(eo, v):
        return float((eo.get(v, 0.0) if isinstance(eo, dict) else eo) or 0.0)
    targets = targets or {}
    offsets = offsets or {}
    dt = float(dt)
    variants = list(tracesByVariant.keys())

    if colors is None:
        cyc = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#8c564b"]
        colors = {v: cyc[i % len(cyc)] for i, v in enumerate(variants)}

    nrRows, nrCols = len(variables), len(windows)
    if nrRows == 0 or nrCols == 0 or not variants:
        print("plotSimulationWindows: nothing to plot")
        return None

    fig, axes = mpl.subplots(nrRows, nrCols,
                             figsize=(5.0 * nrCols * figScale, 2.8 * nrRows * figScale),
                             squeeze=False)

    for r, name in enumerate(variables):
        off = offsets.get(name, 0.0)
        for c, w in enumerate(windows):
            wlabel, wsec = w[0], w[1]
            weo = w[2] if len(w) > 2 else 0.0
            ax = axes[r][c]
            allY, colOffset = [], False
            for v in variants:
                tr = tracesByVariant[v].get(name)
                if tr is None:
                    continue
                y = np.asarray(tr, dtype=float) - off
                if y.size < 2:                          # sentinel / diverged run -> nothing to draw
                    continue
                tEnd = (y.size - 1) * dt
                if wsec is None:                        # whole trace: x = time before end of run
                    x = np.arange(y.size) * dt - tEnd
                    mask = np.ones(y.size, dtype=bool)
                else:                                   # window ends `eo` s before the run end
                    eo = _endOffset(weo, v)
                    colOffset = colOffset or eo > 0
                    x = np.arange(y.size) * dt - (tEnd - eo)   # x = time before the window's right edge
                    mask = (x >= -float(wsec)) & (x <= 1e-9)
                ax.plot(x[mask], y[mask], lw=0.9, color=colors[v],
                        label=v if (r == 0 and c == 0) else None)
                allY.append(y[mask])
            tgt = targets.get(name)
            if tgt is not None and np.isfinite(tgt):
                ax.axhline(tgt, color="k", ls="--", lw=1.0)
            if allY:
                lo, hi = utils.robustYLim(np.concatenate(allY))
                if tgt is not None and np.isfinite(tgt):
                    # keep the target line on-screen even when the signal converged just shy
                    # of it (robustYLim would otherwise clip to the data's own band).
                    lo, hi = min(lo, tgt), max(hi, tgt)
                    pad = 0.04 * (hi - lo) if hi > lo else 1.0
                    lo, hi = lo - pad, hi + pad
                if np.isfinite(lo) and np.isfinite(hi) and hi > lo:
                    ax.set_ylim(lo, hi)
            if r == 0:
                ax.set_title(wlabel, fontsize=11)
            if c == 0:
                ttl = _disp(name, name)
                if tgt is not None and np.isfinite(tgt):
                    ttl += f"  (target = {tgt:.4g})"
                ax.set_ylabel(ttl, fontsize=10)
            if r == nrRows - 1:
                ax.set_xlabel("time before controllers off (s)" if colOffset
                              else "time before end (s)", fontsize=9)
            ax.tick_params(labelsize=8)

    handles, labels = axes[0][0].get_legend_handles_labels()
    if handles:
        fig.legend(handles, labels, loc="upper right", fontsize=9, ncol=len(handles))
    fig.suptitle(f"{title}  ({len(variables)} signals, {len(variants)} variants)", fontsize=13)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    return fig


def plotRunTimings(perRunWall, meta=None, title="Run timings", figScale=1.0):
    """Self-contained per-run wall-clock plot for a population sweep.

    Two panels: (left) per-run wall time vs run index (bar), (right) the
    distribution of per-run wall times (histogram) with mean/median markers.
    NaN entries (skipped/untimed runs) are dropped.

    Args:
        perRunWall: length-N sequence of seconds (NaN allowed) from
                    schema_pop.read_timings.
        meta:       optional context dict (device/precision/solver/dt/runTime/
                    nrModels/stack/total_wall) -> annotated in the suptitle.
        title:      figure suptitle prefix.

    Returns the matplotlib Figure (or None if there are no finite timings).
    """
    meta = meta or {}
    wall = np.asarray(perRunWall, dtype=float)
    finite = wall[np.isfinite(wall)]
    if finite.size == 0:
        print("plotRunTimings: no finite timings to plot")
        return None

    mean, median = float(np.mean(finite)), float(np.median(finite))
    fig, (axB, axH) = mpl.subplots(1, 2, figsize=(12.0 * figScale, 4.0 * figScale))

    idx = np.arange(wall.size)
    axB.bar(idx[np.isfinite(wall)], finite, color="#4477aa", width=0.9)
    axB.axhline(mean, color="k", ls="--", lw=1.0, label=f"mean = {mean:.3g}s")
    axB.axhline(median, color="r", ls=":", lw=1.0, label=f"median = {median:.3g}s")
    axB.set_xlabel("run index")
    axB.set_ylabel("wall time (s)")
    axB.set_title("per-run wall time")
    axB.legend(loc="best", fontsize=8)

    axH.hist(finite, bins=min(30, max(5, finite.size)), color="#4477aa", alpha=0.85)
    axH.axvline(mean, color="k", ls="--", lw=1.0, label=f"mean = {mean:.3g}s")
    axH.axvline(median, color="r", ls=":", lw=1.0, label=f"median = {median:.3g}s")
    axH.set_xlabel("wall time (s)")
    axH.set_ylabel("count")
    axH.set_title("distribution")
    axH.legend(loc="best", fontsize=8)

    ctx = []
    for key in ("device", "precision", "solver", "stack"):
        if meta.get(key) is not None:
            ctx.append(str(meta[key]))
    total = meta.get("total_wall")
    tail = f"{finite.size} runs, {sum(finite):.3g}s total"
    if total is not None:
        tail += f" ({float(total):.3g}s incl. save)"
    sub = f"{title}  [{', '.join(ctx)}]  —  {tail}" if ctx else f"{title}  —  {tail}"
    fig.suptitle(sub, fontsize=13)
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    return fig


def plotInductanceSweep(L, residualMax, residualRMS, params=None, rcAnchor=None,
                        errorTarget=None, nHighlight=None, title="Inductance sweep",
                        figScale=1.0):
    """Calibration residual (and optionally converged parameters) vs aortic inductance L.

    Shows that a fixed twin-target calibration recalibrates across a swept inertance L
    with the residual staying flat/low — the evidence that the tuning approach is
    unchanged for an RLC element. L is drawn on a log x-axis.

    Args:
        L:           (M,) swept inductance values (mmHg·s²/mL), > 0.
        residualMax: (M,) per-lane MAX |rel err| over the twin targets (%).
        residualRMS: (M,) per-lane RMS |rel err| over the twin targets (%).
        params:      optional {label: (M,)} converged calibrated parameters vs L ->
                     drawn in a second panel (one line per parameter, own y-scale by
                     normalising to each series' first value). None -> single panel.
        rcAnchor:    optional {"max": v, "rms": v} pure-RC (L->0) reference -> horizontal
                     dashed lines on the residual panel.
        errorTarget: optional success threshold (%) -> dotted horizontal line.
        nHighlight:  optional count -> the FIRST `nHighlight` entries of `params` (which
                     is expected ordered, most-sensitive first) are drawn coloured and
                     labelled; the remainder are drawn faint grey under one proxy legend
                     entry, so that "only these few move" is visible against the whole
                     calibrated set. None -> every series coloured and labelled.
        title:       figure suptitle.

    Returns the matplotlib Figure (or None if there is nothing finite to plot).
    """
    L = np.asarray(L, dtype=float)
    rMax = np.asarray(residualMax, dtype=float)
    rRMS = np.asarray(residualRMS, dtype=float)
    good = np.isfinite(L) & (L > 0) & np.isfinite(rMax)
    if not good.any():
        print("plotInductanceSweep: no finite (L, residual) points to plot")
        return None
    L, rMax, rRMS = L[good], rMax[good], rRMS[good]
    order = np.argsort(L)
    L, rMax, rRMS = L[order], rMax[order], rRMS[order]

    nPanels = 2 if params else 1
    fig, axes = mpl.subplots(1, nPanels, figsize=(6.0 * nPanels * figScale, 4.2 * figScale))
    axR = axes[0] if nPanels > 1 else axes

    axR.plot(L, rMax, "o-", color="#ee6677", lw=1.4, ms=4, label="max |rel err|")
    axR.plot(L, rRMS, "s-", color="#4477aa", lw=1.4, ms=4, label="RMS |rel err|")
    if rcAnchor:
        if rcAnchor.get("max") is not None:
            axR.axhline(float(rcAnchor["max"]), color="#ee6677", ls="--", lw=1.0,
                        label=f"RC max = {float(rcAnchor['max']):.2g}%")
        if rcAnchor.get("rms") is not None:
            axR.axhline(float(rcAnchor["rms"]), color="#4477aa", ls="--", lw=1.0,
                        label=f"RC RMS = {float(rcAnchor['rms']):.2g}%")
    if errorTarget is not None:
        axR.axhline(float(errorTarget), color="k", ls=":", lw=1.0,
                    label=f"target = {float(errorTarget):.2g}%")
    axR.set_xscale("log")
    axR.set_xlabel("aortic inductance $L_{Hl\\_As}$ (mmHg·s²/mL)")
    axR.set_ylabel("calibration residual (% rel err)")
    axR.set_title("residual vs inductance")
    axR.grid(True, which="both", ls=":", alpha=0.4)
    axR.legend(loc="best", fontsize=8)

    if params:
        axP = axes[1]
        cmap = mpl.get_cmap("tab10")
        nHi = len(params) if nHighlight is None else int(nHighlight)
        for i, (label, series) in enumerate(params.items()):
            s = np.asarray(series, dtype=float)[good][order]
            base = s[np.isfinite(s)][0] if np.isfinite(s).any() and s[np.isfinite(s)][0] != 0 else 1.0
            if i < nHi:
                axP.plot(L, s / base, "-", lw=1.6, color=cmap(i % 10), label=label)
            else:
                axP.plot(L, s / base, "-", lw=0.9, color="0.6", alpha=0.4,
                         label=f"other {len(params) - nHi} parameters" if i == nHi else None)
        axP.set_xscale("log")
        axP.set_xlabel("aortic inductance $L_{Hl\\_As}$ (mmHg·s²/mL)")
        axP.set_ylabel("converged parameter (normalised)")
        axP.set_title("converged parameters vs inductance")
        axP.grid(True, which="both", ls=":", alpha=0.4)
        axP.legend(loc="best", fontsize=8)

    fig.suptitle(title, fontsize=13)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    return fig


def plotVolumeLadder(elasticity, paramNames, ladderNames=None,
                     title="Calibration-target ladder", figScale=1.0):
    """Elasticity heatmap of every calibrated parameter against every laddered target.

    Each "ladder" is one population of lanes that share every calibration target except a
    single one, which is stepped from a low to a high fraction of its reference value.
    ``elasticity[r, c]`` is the slope of ln(param r) on ln(ladder fraction) along ladder c —
    the dimensionless d ln p / d ln y*. |eps| ~ 1 means the inferred parameter inherits an
    error in the assumed target one-for-one; |eps| ~ 0 means it is indifferent to it.

    Args:
        elasticity:  (nParams, nLadders) matrix of d ln(param) / d ln(target).
        paramNames:  (nParams,) row labels (display strings).
        ladderNames: (nLadders,) column labels; defaults to the column index.
        title:       figure suptitle.
        figScale:    multiplies the content-derived figure size.

    Returns the matplotlib Figure (or None if nothing in `elasticity` is finite).
    """
    E = np.asarray(elasticity, dtype=float)
    if E.ndim != 2 or not np.isfinite(E).any():
        print("plotVolumeLadder: no finite elasticities to plot")
        return None
    rows = list(paramNames)
    cols = list(ladderNames) if ladderNames is not None else [str(c) for c in range(E.shape[1])]

    # Size off the matrix — as the sole panel the per-cell annotations have to stay legible:
    # label gutter + one slot per column/row + colorbar. The cell slots are sized for the
    # annotation font below, so bumping one means bumping the other.
    fig, axH = mpl.subplots(figsize=(max((3.6 + 0.78 * E.shape[1]) * figScale, 5.0),
                                     max((1.8 + 0.46 * E.shape[0]) * figScale, 4.0)))

    lim = np.nanmax(np.abs(E))
    lim = lim if lim > 0 else 1.0
    im = axH.imshow(E, cmap="RdBu_r", vmin=-lim, vmax=lim, aspect="auto")
    axH.set_xticks(range(len(cols)), cols, rotation=90, fontsize=20)
    axH.set_yticks(range(len(rows)), rows, fontsize=20)
    axH.tick_params(axis="x", pad=6)
    for r in range(E.shape[0]):
        for c in range(E.shape[1]):
            if np.isfinite(E[r, c]):
                axH.text(c, r, f"{E[r, c]:.2f}", ha="center", va="center", fontsize=16,
                         color="k" if abs(E[r, c]) < 0.6 * lim else "w")
    # The colour IS the elasticity, so the quantity is named on the bar rather than in an axes
    # title. \frac renders at a reduced size inside mathtext, hence the larger point size.
    cbar = fig.colorbar(im, ax=axH, fraction=0.046, pad=0.04)
    cbar.ax.tick_params(labelsize=18)
    cbar.set_label(r"$\mathrm{elasticity}\;\; \varepsilon = \frac{\partial \ln p}"
                   r"{\partial \ln y^{*}}$", fontsize=26, labelpad=18)

    # Title goes in the (now free) axes-title slot rather than a suptitle: `pad` sets the gap to
    # the grid exactly, where a suptitle floats at the top of the figure and leaves a void.
    axH.set_title(title, fontsize=24, pad=14)
    fig.tight_layout()
    return fig


def plotPopulationErrorGrid(errors, classes, panels, classOrder=None, classColors=None,
                            labelAlias=None, ncols=2, panelSize=(7.6, 6.0), fontSize=48,
                            robustPct=(0.01, 99.9), showFliers=True, tickSpan=5.0, title=None):
    """Small multiples of per-lane relative calibration error: one panel per calibration target,
    one violin + overlaid box per cohort.

    The cohorts share an x slot per panel and are told apart by colour alone (the x tick labels
    are suppressed -- with one violin per cohort the axis would repeat the legend on every panel
    of the grid), so `classColors` IS the figure's key and belongs in the caption.

    Args:
        errors:      (nLane, nPanel) signed relative error in PERCENT, column j = `panels[j]`.
        classes:     (nLane,) cohort name per lane.
        panels:      target names, in the order they are laid out (row-major over `ncols`).
        classOrder:  cohort order within each panel; default = first-seen order in `classes`.
        classColors: {cohort: colour}; default = a deterministic colour per cohort.
        labelAlias:  {panel: labels.json key} for a panel whose title differs from its signal
                     name (the published grid names `keep_max_P_As` as $SysP_{As}$).
        ncols:       panels per row.
        panelSize:   (w, h) inches PER PANEL; the figure is this times the grid.
        fontSize:    panel-title size; ticks are drawn 18 pt smaller and the suptitle 6 pt larger.
        robustPct:   percentiles handed to utils.robustYLim to frame each panel. Wide tails are
                     kept as fliers rather than expanding the frame around them.
        showFliers:  draw the box outliers.
        tickSpan:    a panel framed tighter than this many percent labels its five ticks with one
                     decimal; wider panels use whole percent. One shared format collapses to
                     duplicate labels ("1%, 0%, -0%, -1%, -1%") on the tight panels.
        title:       figure suptitle. None = none.

    Returns the matplotlib Figure (or None if there is nothing to draw).
    """
    E = np.asarray(errors, dtype=float)
    panels = list(panels)
    if E.ndim != 2 or E.shape[1] != len(panels) or not panels:
        print("plotPopulationErrorGrid: errors must be (nLane, nPanel) matching `panels`")
        return None
    cls = np.asarray(classes).astype(str)
    order = list(classOrder) if classOrder is not None else list(dict.fromkeys(cls.tolist()))
    colors = dict(classColors) if classColors else {
        c: _CLASS_COLOURS[i % len(_CLASS_COLOURS)] for i, c in enumerate(order)}
    alias = dict(labelAlias or {})

    nrows = int(np.ceil(len(panels) / ncols))
    fig, axs = mpl.subplots(nrows, ncols, squeeze=False,
                            figsize=(panelSize[0] * ncols, panelSize[1] * nrows))
    for j, (ax, name) in enumerate(zip(axs.flat, panels)):
        frame = pd.DataFrame({"class": cls, "error": E[:, j]})
        lo, hi = utils.robustYLim(E[:, j], p=tuple(robustPct))
        ax.set_ylim(lo, hi)
        sns.violinplot(data=frame, x="class", y="error", hue="class", order=order,
                       hue_order=order, palette=colors, dodge=False, cut=0, inner=None,
                       linewidth=0.8, legend=False, ax=ax)
        sns.boxplot(data=frame, x="class", y="error", hue="class", order=order, hue_order=order,
                    palette=colors, dodge=False, width=0.5, showcaps=True, showfliers=showFliers,
                    boxprops={"facecolor": "none", "linewidth": 2.5},
                    whiskerprops={"linewidth": 2.5}, medianprops={"linewidth": 3.0},
                    legend=False, ax=ax)
        ax.set_title(_disp(alias.get(name, name)), fontsize=fontSize)
        ax.set_xlabel(""); ax.set_ylabel("")
        ax.tick_params(axis="y", labelsize=fontSize - 18)
        ax.tick_params(axis="x", labelsize=fontSize - 18, labelbottom=False)
        ax.set_yticks(np.linspace(lo, hi, 5))
        dec = 0 if (hi - lo) >= tickSpan else 1
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _, d=dec: f"{v:.{d}f}%"))
    for ax in axs.flat[len(panels):]:
        ax.axis("off")
    if title:
        fig.suptitle(title, fontsize=fontSize + 6)
    fig.tight_layout(rect=[0, 0, 1, 0.99])
    return fig


def plotPopulationScatter(data, pairs, classes, classOrder=None, classColors=None,
                          labelAlias=None, ncols=1, panelSize=(15.0, 5.0), fontSize=38,
                          tickFontSize=30, markerSize=75, robustPct=(0.5, 99.5), padFrac=0.05,
                          decimals=2, legendPanel=None):
    """Cohort-coloured scatter panels: one panel per (x, y) pair of population quantities.

    Args:
        data:        {name: (nLane,) values} -- every name used by `pairs` must be a key.
        pairs:       [(xName, yName), ...], one panel each, laid out row-major over `ncols`.
        classes:     (nLane,) cohort name per lane; sets the point colour.
        classOrder:  legend/colour order; default = first-seen order in `classes`.
        classColors: {cohort: colour}; default = a deterministic colour per cohort.
        labelAlias:  {name: labels.json key} for an axis whose label differs from its column name.
        ncols:       panels per row.
        panelSize:   (w, h) inches PER PANEL.
        fontSize:    axis-label size.
        tickFontSize: tick-label size.
        markerSize:  scatter marker area.
        robustPct:   percentiles handed to utils.robustYLim to frame the y axis of each panel.
        padFrac:     fractional padding added to that frame.
        decimals:    decimals on the five y ticks.
        legendPanel: panel index carrying the cohort legend; None = no legend on any panel
                     (the published resistance figures caption the colour code instead).

    Returns the matplotlib Figure (or None if there is nothing to draw).
    """
    pairs = [tuple(p) for p in pairs]
    missing = [n for p in pairs for n in p if n not in data]
    if not pairs or missing:
        print(f"plotPopulationScatter: nothing to plot / missing columns {missing}")
        return None
    cls = np.asarray(classes).astype(str)
    order = list(classOrder) if classOrder is not None else list(dict.fromkeys(cls.tolist()))
    colors = dict(classColors) if classColors else {
        c: _CLASS_COLOURS[i % len(_CLASS_COLOURS)] for i, c in enumerate(order)}
    alias = dict(labelAlias or {})

    nrows = int(np.ceil(len(pairs) / ncols))
    fig, axs = mpl.subplots(nrows, ncols, squeeze=False,
                            figsize=(panelSize[0] * ncols, panelSize[1] * nrows))
    for i, (ax, (xName, yName)) in enumerate(zip(axs.flat, pairs)):
        frame = pd.DataFrame({"class": cls,
                              xName: np.asarray(data[xName], dtype=float),
                              yName: np.asarray(data[yName], dtype=float)})
        sns.scatterplot(data=frame, x=xName, y=yName, hue="class", hue_order=order,
                        palette=colors, s=markerSize, edgecolor="none", ax=ax)
        ax.set_xlabel(_disp(alias.get(xName, xName)), fontsize=fontSize)
        ax.set_ylabel(_disp(alias.get(yName, yName)), fontsize=fontSize)
        ax.tick_params(axis="both", labelsize=tickFontSize)
        ax.set_title("")
        lo, hi = utils.robustYLim(frame[yName].to_numpy(), p=tuple(robustPct), padFrac=padFrac)
        ax.set_ylim(lo, hi)
        ax.set_yticks(np.linspace(lo, hi, 5))
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _, d=decimals: f"{v:.{d}f}"))
        if i == legendPanel:
            ax.legend(title="Class", frameon=True, fontsize=tickFontSize,
                      title_fontsize=tickFontSize)
        elif ax.legend_ is not None:
            ax.legend_.remove()
    for ax in axs.flat[len(pairs):]:
        ax.axis("off")
    fig.tight_layout()
    return fig


def _extendUpperToTick(ax, which, dataMax):
    """Grow an autoscaled UPPER limit until the outermost tick clears the data.

    Autoscale stops wherever the padding lands, which is usually between ticks, so a cloud whose
    top sits above the last tick is drawn against an unlabelled edge -- the reader cannot read off
    where those points are. Pushing the limit to the next whole tick step makes the locator label
    it. The lower limit is left alone: the paper's panels start mid-step too."""
    getT, getL, setL = ((ax.get_xticks, ax.get_xlim, ax.set_xlim) if which == "x"
                        else (ax.get_yticks, ax.get_ylim, ax.set_ylim))
    lo, hi = getL()
    ticks = np.asarray(getT(), dtype=float)
    ticks = ticks[(ticks >= lo) & (ticks <= hi)]
    if ticks.size < 2 or not np.isfinite(dataMax) or ticks.max() >= dataMax:
        return
    step = float(np.diff(ticks).max())
    top = np.ceil(dataMax / step) * step
    if top > hi:
        setL(lo, float(np.nextafter(top, np.inf)))


def plotPopulationDualView(data, pairs, classes, errors, classOrder=None, classColors=None,
                           labelAlias=None, panelSize=(15.0, 5.0), fontSize=38, tickFontSize=20,
                           legendFontSize=20, titleFontSize=30, markerSize=50, alpha=0.8,
                           errorCap=10.0, cmapName="coolwarm", cmapRange=(0.005, 0.995),
                           showColorbar=True, legendPairs=None, padTopToTick=True):
    """Dual-view scatter stack: each (x, y) pair gets TWO stacked panels -- the same samples
    coloured by cohort, then by the signed relative calibration error of `y`.

    The pairing is the point: the upper panel says which cohort occupies a region of parameter
    space, the lower one says whether the calibration got there. Controller saturation shows up
    as a cloud that is one colour above and one sign of error below.

    Args:
        data:        {name: (nLane,) values}; every name used by `pairs` must be a key.
        pairs:       [(xName, yName), ...]; each contributes two rows, in this order.
        classes:     (nLane,) cohort name per lane -- the upper panel's colour.
        errors:      {yName: (nLane,) SIGNED relative error in PERCENT} -- the lower panel's
                     colour. Points are drawn in ascending |error| so the worst land on top.
        classOrder:  legend/colour order; default = first-seen order in `classes`.
        classColors: {cohort: colour}; default = a deterministic colour per cohort.
        labelAlias:  {name: labels.json key} for an axis whose label differs from its column name.
        panelSize:   (w, h) inches PER PANEL; the figure is (w, h * 2 * len(pairs)).
        fontSize:    axis-label size; tick/legend/title sizes are their own arguments because the
                     published figure draws the axis labels much larger than the panel titles.
        markerSize:  scatter marker area.
        alpha:       marker alpha.
        errorCap:    the diverging colour scale saturates at +/- this many percent.
        cmapName:    diverging colormap for the error panel.
        cmapRange:   (min, max) fractions the colormap is truncated to, softening the extremes.
        showColorbar: draw the error colourbar beside each lower panel.
        legendPairs: indices of `pairs` whose upper panel carries the cohort legend;
                     None = every one (the published figure legends all three).
        padTopToTick: grow each panel's upper x/y limit to the next whole tick step when the
                     data overshoots the last tick, so no cloud is cut off by an unlabelled edge.

    Returns the matplotlib Figure (or None if there is nothing to draw).
    """
    pairs = [tuple(p) for p in pairs]
    missing = [n for p in pairs for n in p if n not in data]
    missingErr = [y for _, y in pairs if y not in errors]
    if not pairs or missing or missingErr:
        print(f"plotPopulationDualView: missing columns {missing} / error columns {missingErr}")
        return None
    cls = np.asarray(classes).astype(str)
    order = list(classOrder) if classOrder is not None else list(dict.fromkeys(cls.tolist()))
    colors = dict(classColors) if classColors else {
        c: _CLASS_COLOURS[i % len(_CLASS_COLOURS)] for i, c in enumerate(order)}
    alias = dict(labelAlias or {})
    withLegend = set(range(len(pairs))) if legendPairs is None else set(legendPairs)

    base = _colormaps[cmapName]
    cmap = _mcolors.LinearSegmentedColormap.from_list(
        f"trunc({cmapName})", base(np.linspace(cmapRange[0], cmapRange[1], 256)))
    norm = _mcolors.Normalize(vmin=-float(errorCap), vmax=float(errorCap), clip=True)
    relLabel = _disp("Relative Error")

    fig, axs = mpl.subplots(2 * len(pairs), 1, squeeze=False,
                            figsize=(panelSize[0], panelSize[1] * 2 * len(pairs)))
    axs = axs[:, 0]
    for i, (xName, yName) in enumerate(pairs):
        err = np.asarray(errors[yName], dtype=float)
        o = np.argsort(np.abs(err))                      # worst errors drawn last / on top
        frame = pd.DataFrame({"class": cls[o],
                              xName: np.asarray(data[xName], dtype=float)[o],
                              yName: np.asarray(data[yName], dtype=float)[o]})
        xLab, yLab = _disp(alias.get(xName, xName)), _disp(alias.get(yName, yName))

        axTop, axBot = axs[2 * i], axs[2 * i + 1]
        sns.scatterplot(data=frame, x=xName, y=yName, hue="class", hue_order=order,
                        palette=colors, s=markerSize, alpha=alpha, edgecolor="none", ax=axTop)
        axTop.set_title(f"{yLab} vs {xLab}", fontsize=titleFontSize)
        axTop.set_xlabel(""); axTop.set_ylabel(yLab, fontsize=fontSize)
        axTop.tick_params(axis="both", labelsize=tickFontSize)
        if i in withLegend:
            axTop.legend(title="Class", frameon=False, fontsize=legendFontSize,
                         title_fontsize=legendFontSize)
        elif axTop.legend_ is not None:
            axTop.legend_.remove()

        sc = axBot.scatter(frame[xName], frame[yName], c=err[o], cmap=cmap, norm=norm,
                           s=markerSize, alpha=alpha, edgecolors="none")
        axBot.set_title(f"Colour = relative error ({relLabel}) for targets of {yLab}",
                        fontsize=titleFontSize)
        axBot.set_xlabel(xLab, fontsize=fontSize); axBot.set_ylabel(yLab, fontsize=fontSize)
        axBot.tick_params(axis="both", labelsize=tickFontSize)
        if showColorbar:
            cbar = fig.colorbar(sc, ax=axBot, fraction=0.046, pad=0.04)
            cbar.set_label(f"{relLabel} (saturated at {errorCap:g}%)", fontsize=legendFontSize)
            cbar.ax.tick_params(labelsize=tickFontSize)

        if padTopToTick:
            for ax in (axTop, axBot):
                _extendUpperToTick(ax, "x", np.nanmax(frame[xName].to_numpy()))
                _extendUpperToTick(ax, "y", np.nanmax(frame[yName].to_numpy()))
    fig.tight_layout()
    return fig
