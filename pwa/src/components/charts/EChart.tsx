// EChart — owned React glue for the Apache ECharts engine.
// - Replaces the abandoned echarts-for-react adapter (peer-locked to echarts 5)
// - The echarts options object passes straight through to setOption
// - Owns init, option updates, container resize, and disposal; nothing else
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

interface Props {
  option: EChartsOption;
  height?: string | number;
  theme?: string;
  notMerge?: boolean; // true = replace the previous option instead of merging into it
  className?: string;
}

const EChart: React.FC<Props> = ({ option, height = 300, theme, notMerge = false, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init>>();
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, theme);
    chart.setOption(optionRef.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = undefined;
    };
  }, [theme]);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge });
  }, [option, notMerge]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height }} />;
};

export default EChart;
