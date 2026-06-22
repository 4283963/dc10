import React from 'react'

export default function ControlPanel({
  csvPath,
  csvPreview,
  config,
  setConfig,
  onSelectFile,
  onGenerateSample,
  onStart,
  isRunning,
  disabled,
}) {
  const update = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }))

  const formatSize = (bytes) => {
    if (!bytes) return ''
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    return `${(kb / 1024).toFixed(2)} MB`
  }

  return (
    <>
      <div className="panel-section">
        <div className="section-title">行情数据</div>
        <button
          className="file-select-btn"
          onClick={onSelectFile}
          disabled={disabled || isRunning}
        >
          📂 选择 CSV 文件
        </button>
        {csvPath && (
          <div className="file-info">
            <div><b>路径:</b> {csvPath}</div>
            {csvPreview && (
              <>
                <div style={{ marginTop: 4 }}><b>行数:</b> {csvPreview.totalRows?.toLocaleString()} 行</div>
                {csvPreview.sizeBytes > 0 && <div><b>大小:</b> {formatSize(csvPreview.sizeBytes)}</div>}
              </>
            )}
          </div>
        )}
        <button
          className="generate-sample-btn"
          onClick={onGenerateSample}
          disabled={disabled || isRunning}
        >
          ✨ 生成示例数据 (黄金期货 120 天)
        </button>
      </div>

      <div className="panel-section">
        <div className="section-title">策略参数 · MA 双均线</div>

        <div className="form-group">
          <div className="form-label">时间周期聚合</div>
          <select
            className="form-select"
            value={config.timeframe}
            onChange={(e) => update('timeframe', e.target.value)}
            disabled={isRunning}
          >
            <option value="tick">原始 Tick</option>
            <option value="1s">1 秒</option>
            <option value="5s">5 秒</option>
            <option value="15s">15 秒</option>
            <option value="30s">30 秒</option>
            <option value="1min">1 分钟</option>
            <option value="5min">5 分钟</option>
            <option value="15min">15 分钟</option>
            <option value="30min">30 分钟</option>
            <option value="1h">1 小时</option>
            <option value="1d">日线</option>
          </select>
        </div>

        <div className="form-input-row">
          <div className="form-group">
            <div className="form-label">快线周期</div>
            <input
              type="number"
              className="form-input"
              min={1}
              max={200}
              value={config.fastMa}
              onChange={(e) => update('fastMa', Number(e.target.value))}
              disabled={isRunning}
            />
          </div>
          <div className="form-group">
            <div className="form-label">慢线周期</div>
            <input
              type="number"
              className="form-input"
              min={2}
              max={500}
              value={config.slowMa}
              onChange={(e) => update('slowMa', Number(e.target.value))}
              disabled={isRunning}
            />
          </div>
        </div>

        <div className="form-input-row">
          <div className="form-group">
            <div className="form-label">止损比例 %</div>
            <input
              type="number"
              className="form-input"
              step="0.1"
              min={0}
              max={50}
              value={config.stopLossPct * 100}
              onChange={(e) => update('stopLossPct', Number(e.target.value) / 100)}
              disabled={isRunning}
            />
          </div>
          <div className="form-group">
            <div className="form-label">止盈比例 %</div>
            <input
              type="number"
              className="form-input"
              step="0.1"
              min={0}
              max={200}
              value={config.takeProfitPct * 100}
              onChange={(e) => update('takeProfitPct', Number(e.target.value) / 100)}
              disabled={isRunning}
            />
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="section-title">账户 / 交易成本</div>

        <div className="form-group">
          <div className="form-label">初始资金 (元)</div>
          <input
            type="number"
            className="form-input"
            min={1000}
            step={10000}
            value={config.initialCapital}
            onChange={(e) => update('initialCapital', Number(e.target.value))}
            disabled={isRunning}
          />
        </div>

        <div className="form-input-row">
          <div className="form-group">
            <div className="form-label">手续费率 (‱)</div>
            <input
              type="number"
              className="form-input"
              step="0.1"
              min={0}
              value={config.commission * 10000}
              onChange={(e) => update('commission', Number(e.target.value) / 10000)}
              disabled={isRunning}
            />
          </div>
          <div className="form-group">
            <div className="form-label">滑点比例 %</div>
            <input
              type="number"
              className="form-input"
              step="0.01"
              min={0}
              value={config.slippage * 100}
              onChange={(e) => update('slippage', Number(e.target.value) / 100)}
              disabled={isRunning}
            />
          </div>
        </div>
      </div>

      <button
        className="start-btn"
        onClick={onStart}
        disabled={disabled || isRunning || !csvPath}
      >
        {isRunning ? '⏳ 回测中...' : '🚀 开始回测'}
      </button>
    </>
  )
}
