import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { graphic as echartsGraphic } from 'echarts'

export default function EquityChart({ equityCurve, initialCapital }) {
  const option = useMemo(() => {
    if (!equityCurve || equityCurve.length === 0) {
      return {}
    }

    const eqValues = equityCurve.map((e) => e[1])
    const minEq = Math.min(...eqValues)
    const maxEq = Math.max(...eqValues)
    const padTop = (maxEq - initialCapital) * 0.15 || maxEq * 0.05
    const padBottom = (initialCapital - minEq) * 0.15 || initialCapital * 0.05

    const yMin = Math.floor(Math.min(initialCapital * 0.95, minEq - padBottom) / 100) * 100
    const yMax = Math.ceil(Math.max(initialCapital * 1.05, maxEq + padTop) / 100) * 100

    const returnCurve = equityCurve.map(([ts, eq]) => {
      const retPct = ((eq / initialCapital) - 1) * 100
      return [ts, retPct]
    })

    const areaColorPositive = {
      type: 'linear',
      x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [
        { offset: 0, color: 'rgba(108,140,255,0.35)' },
        { offset: 1, color: 'rgba(108,140,255,0.02)' },
      ],
    }
    const areaColorNegative = {
      type: 'linear',
      x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [
        { offset: 0, color: 'rgba(255,85,119,0.02)' },
        { offset: 1, color: 'rgba(255,85,119,0.35)' },
      ],
    }

    return {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20,20,40,0.95)',
        borderColor: 'rgba(108,140,255,0.3)',
        borderWidth: 1,
        textStyle: { color: '#e4e4f0', fontSize: 12 },
        formatter: function (params) {
          const p = params[0]
          if (!p) return ''
          const ts = new Date(p.data[0])
          const dateStr = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}`
          const eq = p.data[1]
          const ret = ((eq / initialCapital) - 1) * 100
          const color = eq >= initialCapital ? '#3ddc84' : '#ff5577'
          return `
            <div style="font-family: monospace; line-height: 1.7;">
              <div style="color:#a0a0c8; margin-bottom:4px;">${dateStr}</div>
              <div>权益: <b style="color:#e4e4f0">¥${eq.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</b></div>
              <div>收益: <b style="color:${color}">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</b></div>
            </div>
          `
        },
      },
      grid: {
        left: 68,
        right: 68,
        top: 20,
        bottom: 30,
      },
      xAxis: {
        type: 'category',
        data: equityCurve.map((e) => e[0]),
        axisLine: { lineStyle: { color: 'rgba(100,120,200,0.25)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#6a6a8a',
          fontSize: 10,
          formatter: (val) => {
            const d = new Date(val)
            return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
          },
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          scale: true,
          position: 'left',
          min: yMin,
          max: yMax,
          axisLine: { show: false },
          axisLabel: {
            color: '#8a8aaa',
            fontSize: 11,
            fontFamily: 'monospace',
            formatter: (v) => '¥' + v.toLocaleString(),
          },
          splitLine: { lineStyle: { color: 'rgba(100,120,200,0.08)', type: 'dashed' } },
          axisTick: { show: false },
        },
        {
          type: 'value',
          scale: true,
          position: 'right',
          min: ((yMin / initialCapital) - 1) * 100,
          max: ((yMax / initialCapital) - 1) * 100,
          axisLine: { show: false },
          axisLabel: {
            color: '#8a8aaa',
            fontSize: 11,
            fontFamily: 'monospace',
            formatter: (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%',
          },
          splitLine: { show: false },
          axisTick: { show: false },
        },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0],
          start: Math.max(0, 100 - 30000 / Math.max(equityCurve.length, 1)),
          end: 100,
        },
      ],
      series: [
        {
          name: '权益',
          type: 'line',
          data: equityCurve,
          smooth: false,
          showSymbol: false,
          lineStyle: {
            width: 1.8,
            color: new (echartsGraphic.LinearGradient)(0, 0, 1, 0, [
              { offset: 0, color: '#6c8cff' },
              { offset: 1, color: '#b46cff' },
            ]),
          },
          areaStyle: {
            color: equityCurve[equityCurve.length - 1][1] >= initialCapital
              ? areaColorPositive
              : areaColorNegative,
          },
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: 'rgba(100,120,200,0.25)', type: 'dashed', width: 1 },
            data: [
              { yAxis: initialCapital, label: { show: true, formatter: '初始资金', color: '#6a6a8a', fontSize: 10, position: 'insideEndTop' } },
            ],
          },
        },
      ],
    }
  }, [equityCurve, initialCapital])

  if (!equityCurve || equityCurve.length === 0) {
    return null
  }

  return (
    <ReactECharts
      option={option}
      style={{ width: '100%', height: '100%' }}
      notMerge={true}
      lazyUpdate={true}
      opts={{ renderer: 'canvas' }}
    />
  )
}
