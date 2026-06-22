import React from 'react'

const METRIC_DEFS = [
  { key: 'total_return_pct', label: '总收益率', type: 'percent', suffix: '%' },
  { key: 'annual_return_pct', label: '年化收益率', type: 'percent', suffix: '%' },
  { key: 'final_equity', label: '期末权益', type: 'money', prefix: '¥ ' },
  { key: 'max_drawdown_pct', label: '最大回撤', type: 'drawdown', suffix: '%' },
  { key: 'sharpe_ratio', label: '夏普比率', type: 'raw' },
  { key: 'sortino_ratio', label: '索提诺比率', type: 'raw' },
  { key: 'win_rate_pct', label: '胜率', type: 'percent', suffix: '%' },
  { key: 'profit_factor', label: '盈亏比', type: 'raw' },
  { key: 'trade_count', label: '交易次数', type: 'count' },
  { key: 'total_pnl', label: '总盈亏', type: 'money', prefix: '¥ ' },
  { key: 'bar_count', label: 'K 线数', type: 'count' },
  { key: 'initial_capital', label: '初始资金', type: 'money', prefix: '¥ ' },
]

function renderMetric(def, value) {
  let numVal = 0
  let displayed = '—'
  let valClass = 'neutral'

  if (value !== undefined && value !== null && !Number.isNaN(value)) {
    numVal = Number(value)
    if (def.type === 'count') {
      displayed = numVal.toLocaleString('zh-CN')
    } else if (def.type === 'money') {
      displayed = numVal.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    } else if (def.type === 'percent') {
      displayed = numVal.toFixed(2)
    } else if (def.type === 'drawdown') {
      displayed = numVal.toFixed(2)
      valClass = numVal < -0.01 ? 'negative' : 'neutral'
    } else {
      displayed = numVal.toFixed(3)
    }

    if (def.key === 'total_return_pct' || def.key === 'annual_return_pct' || def.key === 'total_pnl') {
      valClass = numVal >= 0 ? 'positive' : 'negative'
    } else if (def.key === 'win_rate_pct') {
      valClass = numVal >= 50 ? 'positive' : 'neutral'
    } else if (def.key === 'sharpe_ratio' || def.key === 'sortino_ratio') {
      valClass = numVal >= 1 ? 'positive' : 'neutral'
    } else if (def.key === 'profit_factor') {
      valClass = numVal >= 1 ? 'positive' : 'negative'
    }
  }

  const txt = `${def.prefix || ''}${displayed}${def.suffix || ''}`

  return (
    <div className="metric-card" key={def.key}>
      <div className="metric-label">{def.label}</div>
      <div className={`metric-value ${valClass}`}>{txt}</div>
    </div>
  )
}

export default function MetricsCards({ summary }) {
  if (!summary) {
    return (
      <div className="metrics-grid">
        {METRIC_DEFS.slice(0, 8).map((d) => (
          <div className="metric-card" key={d.key}>
            <div className="metric-label">{d.label}</div>
            <div className="metric-value neutral">—</div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="metrics-grid">
      {METRIC_DEFS.map((d) => renderMetric(d, summary[d.key]))}
    </div>
  )
}
