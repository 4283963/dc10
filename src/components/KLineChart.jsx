import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'

export default function KLineChart({ klines, indicators, signals }) {
  const option = useMemo(() => {
    if (!klines || klines.length === 0) {
      return {}
    }

    const categoryData = klines.map((k) => k[0])
    const values = klines.map((k) => [k[1], k[4], k[3], k[2]])
    const volumes = klines.map((k) => k[5] || 0)

    const buySignals = (signals || []).filter((s) => s.type === 'buy').map((s) => {
      const idx = klines.findIndex((k) => k[0] === s.timestamp)
      if (idx < 0) return null
      const k = klines[idx]
      return {
        value: s.price,
        xAxis: idx,
        yAxis: s.price,
        itemStyle: { color: '#3ddc84' },
        symbol: 'arrow',
        symbolRotate: 180,
        symbolSize: 14,
        label: {
          show: true,
          position: 'bottom',
          formatter: '买',
          color: '#3ddc84',
          fontSize: 10,
          fontWeight: 600,
        },
      }
    }).filter(Boolean)

    const sellSignals = (signals || []).filter((s) => s.type === 'sell').map((s) => {
      const idx = klines.findIndex((k) => k[0] === s.timestamp)
      if (idx < 0) return null
      const k = klines[idx]
      const pnlTxt = s.pnl !== undefined ? (s.pnl >= 0 ? `+${s.pnl.toFixed(0)}` : `${s.pnl.toFixed(0)}`) : '卖'
      return {
        value: s.price,
        xAxis: idx,
        yAxis: s.price,
        itemStyle: { color: s.pnl >= 0 ? '#ffb63d' : '#ff5577' },
        symbol: 'arrow',
        symbolRotate: 0,
        symbolSize: 14,
        label: {
          show: true,
          position: 'top',
          formatter: pnlTxt,
          color: s.pnl >= 0 ? '#ffb63d' : '#ff5577',
          fontSize: 10,
          fontWeight: 600,
        },
      }
    }).filter(Boolean)

    const maFast = (indicators?.ma_fast || []).map((p) => {
      const idx = klines.findIndex((k) => k[0] === p[0])
      return idx >= 0 ? [idx, p[1]] : null
    }).filter(Boolean)

    const maSlow = (indicators?.ma_slow || []).map((p) => {
      const idx = klines.findIndex((k) => k[0] === p[0])
      return idx >= 0 ? [idx, p[1]] : null
    }).filter(Boolean)

    return {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          lineStyle: { color: 'rgba(108,140,255,0.4)', width: 1, type: 'dashed' },
          crossStyle: { color: 'rgba(108,140,255,0.4)' },
        },
        backgroundColor: 'rgba(20,20,40,0.95)',
        borderColor: 'rgba(108,140,255,0.3)',
        borderWidth: 1,
        textStyle: { color: '#e4e4f0', fontSize: 12 },
        formatter: function (params) {
          const idx = params[0]?.dataIndex ?? -1
          if (idx < 0 || idx >= klines.length) return ''
          const k = klines[idx]
          const ts = new Date(k[0])
          const dateStr = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
          const up = k[4] >= k[1]
          const color = up ? '#3ddc84' : '#ff5577'
          return `
            <div style="font-family: monospace; line-height: 1.7;">
              <div style="color:#a0a0c8; margin-bottom:4px;">${dateStr}</div>
              <div>开盘: <b style="color:${color}">${k[1]}</b></div>
              <div>最高: <b style="color:#3ddc84">${k[2]}</b></div>
              <div>最低: <b style="color:#ff5577">${k[3]}</b></div>
              <div>收盘: <b style="color:${color}">${k[4]}</b></div>
              <div>量: ${(k[5] || 0).toLocaleString()}</div>
            </div>
          `
        },
      },
      grid: [
        { left: 60, right: 24, top: 24, height: '62%' },
        { left: 60, right: 24, top: '78%', height: '18%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: categoryData,
          gridIndex: 0,
          axisLine: { lineStyle: { color: 'rgba(100,120,200,0.25)' } },
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
        {
          type: 'category',
          data: categoryData,
          gridIndex: 1,
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
      ],
      yAxis: [
        {
          type: 'value',
          scale: true,
          gridIndex: 0,
          position: 'left',
          axisLine: { show: false },
          axisLabel: { color: '#8a8aaa', fontSize: 11, fontFamily: 'monospace' },
          splitLine: { lineStyle: { color: 'rgba(100,120,200,0.08)', type: 'dashed' } },
          axisTick: { show: false },
        },
        {
          type: 'value',
          scale: true,
          gridIndex: 1,
          position: 'left',
          axisLine: { show: false },
          axisLabel: { color: '#8a8aaa', fontSize: 10, fontFamily: 'monospace',
            formatter: (v) => v >= 10000 ? (v/10000).toFixed(1)+'万' : v },
          splitLine: { lineStyle: { color: 'rgba(100,120,200,0.08)', type: 'dashed' } },
          axisTick: { show: false },
        },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: Math.max(0, 100 - 30000 / Math.max(klines.length, 1)),
          end: 100,
        },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          start: Math.max(0, 100 - 30000 / Math.max(klines.length, 1)),
          end: 100,
          height: 16,
          bottom: 4,
          borderColor: 'rgba(100,120,200,0.2)',
          backgroundColor: 'rgba(15,15,30,0.6)',
          fillerColor: 'rgba(108,140,255,0.15)',
          handleStyle: { color: '#6c8cff' },
          textStyle: { color: '#6a6a8a', fontSize: 10 },
          moveHandleStyle: { color: '#8aa0ff' },
        },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: values,
          itemStyle: {
            color: '#3ddc84',
            color0: '#ff5577',
            borderColor: '#3ddc84',
            borderColor0: '#ff5577',
          },
        },
        {
          name: 'MA 快线',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: maFast,
          smooth: false,
          showSymbol: false,
          lineStyle: { color: '#6c8cff', width: 1.3 },
          connectNulls: true,
          tooltip: { show: false },
        },
        {
          name: 'MA 慢线',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: maSlow,
          smooth: false,
          showSymbol: false,
          lineStyle: { color: '#ff9a3d', width: 1.3 },
          connectNulls: true,
          tooltip: { show: false },
        },
        ...(buySignals.length > 0 ? [{
          name: '买入信号',
          type: 'scatter',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: buySignals,
          tooltip: { show: false },
          z: 10,
        }] : []),
        ...(sellSignals.length > 0 ? [{
          name: '卖出信号',
          type: 'scatter',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: sellSignals,
          tooltip: { show: false },
          z: 10,
        }] : []),
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes.map((v, i) => ({
            value: v,
            itemStyle: {
              color: values[i][1] <= values[i][2] ? 'rgba(61,220,132,0.6)' : 'rgba(255,85,119,0.6)',
            },
          })),
          tooltip: { show: false },
        },
      ],
    }
  }, [klines, indicators, signals])

  if (!klines || klines.length === 0) {
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
