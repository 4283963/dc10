import React, { useState, useEffect, useRef } from 'react'

const EXCHANGE_NAMES = {
  SHFE: '上期所',
  DCE: '大商所',
  CZCE: '郑商所',
}

const EXCHANGE_COLORS = {
  SHFE: '#e74c3c',
  DCE: '#3498db',
  CZCE: '#27ae60',
}

function formatNumber(v, decimals = 2) {
  if (v === null || v === undefined || isNaN(v)) return '--'
  return Number(v).toFixed(decimals)
}

function formatTime(ts) {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function calcSpreadPct(bid, ask) {
  if (!bid || !ask || bid <= 0) return null
  return ((ask / bid) - 1) * 10000
}

export default function MonitorPanel({ isElectron, setMdTickHandler, setMdAlertHandler }) {
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [ticks, setTicks] = useState({})
  const [alerts, setAlerts] = useState([])
  const [exchangeConfigs, setExchangeConfigs] = useState([])
  const [thresholdType, setThresholdType] = useState('bp')
  const [thresholdValue, setThresholdValue] = useState(20)
  const [cooldownMs, setCooldownMs] = useState(5000)
  const [error, setError] = useState(null)

  const alertsEndRef = useRef(null)

  useEffect(() => {
    if (setMdTickHandler) {
      setMdTickHandler((tickList) => {
        const now = Date.now()
        setTicks((prev) => {
          const next = { ...prev }
          for (const t of tickList) {
            const key = `${t.exchange}:${t.symbol}`
            next[key] = { ...t, received_at: now }
          }
          return next
        })
      })
    }
    if (setMdAlertHandler) {
      setMdAlertHandler((alert) => {
        const a = { ...alert, received_at: Date.now() }
        setAlerts((prev) => [a, ...prev].slice(0, 100))
      })
    }
    loadExchangeConfigs()
  }, [])

  useEffect(() => {
    if (alertsEndRef.current) {
      alertsEndRef.current.scrollTop = 0
    }
  }, [alerts])

  const loadExchangeConfigs = async () => {
    if (!isElectron) return
    try {
      const resp = await window.quantAPI.sendRequest({ action: 'get_exchange_configs' })
      if (resp?.success) {
        setExchangeConfigs(resp.result?.exchanges || [])
      }
    } catch (e) {
      setError(`获取交易所配置失败: ${e.message}`)
    }
  }

  const handleStart = async () => {
    if (!isElectron) return
    setError(null)
    try {
      const resp = await window.quantAPI.sendRequest({
        action: 'start_monitor',
        threshold_type: thresholdType,
        threshold: Number(thresholdValue),
        cooldown_ms: Number(cooldownMs),
      })
      if (resp?.success) {
        setIsMonitoring(true)
        window.quantAPI.showNotification({
          title: '实时行情监控已启动',
          body: `连接 ${resp.result?.gateway_count || 0} 路交易所数据流`,
        })
      } else {
        setError(resp?.error || '启动失败')
      }
    } catch (e) {
      setError(`启动失败: ${e.message}`)
    }
  }

  const handleStop = async () => {
    if (!isElectron) return
    try {
      const resp = await window.quantAPI.sendRequest({ action: 'stop_monitor' })
      if (resp?.success) {
        setIsMonitoring(false)
      }
    } catch (e) {
      setError(`停止失败: ${e.message}`)
    }
  }

  const handleSetThreshold = async () => {
    if (!isElectron || !isMonitoring) return
    try {
      await window.quantAPI.sendRequest({
        action: 'set_spread_threshold',
        threshold_type: thresholdType,
        threshold: Number(thresholdValue),
        cooldown_ms: Number(cooldownMs),
      })
      window.quantAPI.showNotification({
        title: '阈值已更新',
        body: `价差阈值: ${thresholdValue} ${thresholdType === 'bp' ? '基点' : '元'}`,
      })
    } catch (e) {
      setError(`设置阈值失败: ${e.message}`)
    }
  }

  const handlePlayTestBeep = () => {
    if (isElectron) {
      window.quantAPI.playBeep()
    }
  }

  const exchangeSymbols = {}
  for (const ec of exchangeConfigs) {
    exchangeSymbols[ec.exchange] = ec.symbols || []
  }

  const tickList = Object.values(ticks)
  const alertCount = alerts.length

  return (
    <div className="monitor-panel">
      <div className="monitor-main">
        <div className="monitor-toolbar">
          <div className="monitor-status">
            {isMonitoring ? (
              <span className="monitor-running">
                <span className="pulse-dot" />
                监控中 · {tickList.length} 个品种
              </span>
            ) : (
              <span className="monitor-stopped">⏸ 未启动</span>
            )}
          </div>
          <div className="monitor-actions">
            <button className="btn-secondary" onClick={handlePlayTestBeep} disabled={!isElectron}>
              🔊 测试蜂鸣
            </button>
            {!isMonitoring ? (
              <button className="btn-primary" onClick={handleStart} disabled={!isElectron}>
                ▶ 启动监控
              </button>
            ) : (
              <button className="btn-danger" onClick={handleStop}>
                ⏹ 停止监控
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="monitor-error">
            <strong>⚠️ 错误：</strong>{error}
          </div>
        )}

        <div className="monitor-exchange-groups">
          {Object.keys(exchangeSymbols).map((exch) => (
            <div key={exch} className="exchange-group">
              <div className="exchange-header" style={{ borderColor: EXCHANGE_COLORS[exch] }}>
                <span className="exchange-badge" style={{ backgroundColor: EXCHANGE_COLORS[exch] }}>
                  {exch}
                </span>
                <span className="exchange-name">{EXCHANGE_NAMES[exch]}</span>
                <span className="exchange-count">{exchangeSymbols[exch].length} 个品种</span>
              </div>
              <table className="ticks-table">
                <thead>
                  <tr>
                    <th style={{ width: '25%' }}>品种</th>
                    <th style={{ width: '18%' }}>买一价</th>
                    <th style={{ width: '18%' }}>卖一价</th>
                    <th style={{ width: '14%' }}>最新价</th>
                    <th style={{ width: '12%' }}>价差</th>
                    <th style={{ width: '13%' }}>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {exchangeSymbols[exch].map((sym) => {
                    const key = `${exch}:${sym}`
                    const tick = ticks[key]
                    const spread = tick ? (tick.ask1_price - tick.bid1_price) : null
                    const spreadPct = tick ? calcSpreadPct(tick.bid1_price, tick.ask1_price) : null
                    const isSpreadBreach = tick && (
                      (thresholdType === 'absolute' && spread > thresholdValue) ||
                      (thresholdType === 'bp' && spreadPct > thresholdValue)
                    )
                    return (
                      <tr key={sym} className={isSpreadBreach ? 'alert-row' : ''}>
                        <td>
                          <span className="symbol-cell">{sym}</span>
                        </td>
                        <td className="num-cell bid-cell">{tick ? formatNumber(tick.bid1_price) : '--'}</td>
                        <td className="num-cell ask-cell">{tick ? formatNumber(tick.ask1_price) : '--'}</td>
                        <td className="num-cell last-cell">{tick ? formatNumber(tick.last_price) : '--'}</td>
                        <td className={`num-cell spread-cell ${isSpreadBreach ? 'spread-breach' : ''}`}>
                          {tick ? (
                            <>
                              <div>{formatNumber(spread, 3)} 元</div>
                              <div className="spread-pct">{formatNumber(spreadPct, 1)} bp</div>
                            </>
                          ) : '--'}
                        </td>
                        <td className="num-cell time-cell">
                          {tick ? formatTime(tick.received_at) : '--'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      <aside className="monitor-sidebar">
        <div className="monitor-config-card">
          <div className="monitor-card-title">⚙️ 价差阈值配置</div>
          <div className="config-field">
            <label>阈值类型</label>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${thresholdType === 'bp' ? 'active' : ''}`}
                onClick={() => setThresholdType('bp')}
                disabled={isMonitoring}
              >
                基点 (bp)
              </button>
              <button
                className={`toggle-btn ${thresholdType === 'absolute' ? 'active' : ''}`}
                onClick={() => setThresholdType('absolute')}
                disabled={isMonitoring}
              >
                绝对值 (元)
              </button>
            </div>
          </div>
          <div className="config-field">
            <label>
              阈值 ({thresholdType === 'bp' ? 'bp' : '元'})
            </label>
            <input
              type="number"
              className="config-input"
              value={thresholdValue}
              onChange={(e) => setThresholdValue(e.target.value)}
            />
            <div className="config-hint">
              {thresholdType === 'bp'
                ? `价差大于 ${thresholdValue} 基点触发报警 (1bp = 0.01%)`
                : `价差大于 ${thresholdValue} 元触发报警`}
            </div>
          </div>
          <div className="config-field">
            <label>冷却时间 (毫秒)</label>
            <input
              type="number"
              className="config-input"
              value={cooldownMs}
              onChange={(e) => setCooldownMs(e.target.value)}
              step="1000"
              min="1000"
            />
            <div className="config-hint">同品种 {cooldownMs / 1000} 秒内不重复报警</div>
          </div>
          {isMonitoring && (
            <button className="btn-primary btn-block" onClick={handleSetThreshold}>
              ✅ 应用新阈值
            </button>
          )}
        </div>

        <div className="monitor-alerts-card">
          <div className="monitor-card-title">
            🚨 报警历史
            {alertCount > 0 && <span className="alert-badge">{alertCount}</span>}
          </div>
          <div className="alerts-list" ref={alertsEndRef}>
            {alerts.length === 0 ? (
              <div className="alerts-empty">
                <div className="empty-icon">🔔</div>
                <div className="empty-title">暂无报警</div>
                <div className="empty-desc">启动监控后价差异常会显示在此</div>
              </div>
            ) : (
              alerts.map((a, idx) => (
                <div key={idx} className="alert-item">
                  <div className="alert-header">
                    <span
                      className="alert-exch"
                      style={{ backgroundColor: EXCHANGE_COLORS[a.exchange] || '#888' }}
                    >
                      {a.exchange}
                    </span>
                    <span className="alert-symbol">{a.symbol}</span>
                    <span className="alert-time">{formatTime(a.received_at)}</span>
                  </div>
                  <div className="alert-body">
                    <div className="alert-row-2">
                      <span>买 {formatNumber(a.bid1_price)}</span>
                      <span className="alert-spread">
                        价差 {formatNumber(a.spread, 3)} / {formatNumber(a.spread_pct, 1)} bp
                      </span>
                      <span>卖 {formatNumber(a.ask1_price)}</span>
                    </div>
                    <div className="alert-threshold">
                      阈值: {formatNumber(a.threshold)} {a.threshold_type === 'bp' ? 'bp' : '元'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
