import React from 'react'

const STAGE_TEXT = {
  init: '初始化...',
  loading_csv: '加载 CSV 数据...',
  data_loaded: '数据已加载',
  running: '策略计算中...',
  generating_sample: '生成示例数据...',
  finished: '汇总结果...',
  done: '完成',
}

export default function ProgressOverlay({ percent, message, stage }) {
  const displayPercent = stage === 'generating_sample' ? 50 : Math.max(2, percent || 0)
  const displayText = message || STAGE_TEXT[stage] || '处理中...'

  return (
    <div className="progress-overlay">
      <div className="progress-box">
        <div className="progress-spinner" />
        <div className="progress-title">策略回测引擎</div>
        <div className="progress-msg">{displayText}</div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${Math.min(100, displayPercent)}%` }}
          />
        </div>
        <div className="progress-pct">{Math.round(displayPercent)}%</div>
      </div>
    </div>
  )
}
