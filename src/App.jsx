import React, { useState, useEffect, useRef, useCallback } from 'react'
import ControlPanel from './components/ControlPanel.jsx'
import KLineChart from './components/KLineChart.jsx'
import EquityChart from './components/EquityChart.jsx'
import MetricsCards from './components/MetricsCards.jsx'
import ProgressOverlay from './components/ProgressOverlay.jsx'
import MonitorPanel from './components/MonitorPanel.jsx'

const isElectron = window && window.quantAPI && typeof window.quantAPI.sendRequest === 'function'

export default function App() {
  const [activeTab, setActiveTab] = useState('backtest')
  const [bridgeStatus, setBridgeStatus] = useState({ state: 'loading', message: '正在启动 Python 引擎...' })
  const [csvPath, setCsvPath] = useState('')
  const [csvPreview, setCsvPreview] = useState(null)
  const [config, setConfig] = useState({
    strategy: 'ma',
    fastMa: 5,
    slowMa: 20,
    initialCapital: 100000,
    commission: 0.0003,
    slippage: 0.0,
    timeframe: '1min',
    stopLossPct: 0.02,
    takeProfitPct: 0.05,
  })
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState({ percent: 0, message: '', stage: '' })
  const [signals, setSignals] = useState([])
  const [klines, setKlines] = useState([])
  const [indicators, setIndicators] = useState({ ma_fast: [], ma_slow: [] })
  const [equityCurve, setEquityCurve] = useState([])
  const [summary, setSummary] = useState(null)
  const [trades, setTrades] = useState([])
  const [errors, setErrors] = useState([])

  const msgUnsub = useRef(null)
  const errUnsub = useRef(null)
  const alertUnsub = useRef(null)
  const mdTickHandler = useRef(null)
  const mdAlertHandler = useRef(null)

  useEffect(() => {
    if (!isElectron) {
      setBridgeStatus({ state: 'error', message: '非 Electron 环境，Python 通信不可用' })
      return
    }
    const t = setTimeout(() => {
      setBridgeStatus({ state: 'ready', message: 'Python 引擎就绪' })
    }, 800)

    msgUnsub.current = window.quantAPI.onPythonMessage((msg) => {
      handlePythonMessage(msg)
    })
    errUnsub.current = window.quantAPI.onPythonError((err) => {
      console.error('Python error:', err)
      setBridgeStatus({ state: 'error', message: err.message || 'Python 引擎异常' })
    })
    alertUnsub.current = window.quantAPI.onAlert((alertData) => {
      if (mdAlertHandler.current) {
        mdAlertHandler.current(alertData)
      }
    })

    return () => {
      clearTimeout(t)
      if (msgUnsub.current) msgUnsub.current()
      if (errUnsub.current) errUnsub.current()
      if (alertUnsub.current) alertUnsub.current()
    }
  }, [])

  const handlePythonMessage = useCallback((msg) => {
    if (msg.type === 'stream') {
      if (msg.stream === 'progress') {
        const d = msg.data || {}
        setProgress({
          percent: d.percent || 0,
          message: d.message || '',
          stage: d.stage || '',
        })
      } else if (msg.stream === 'signal') {
        setSignals((prev) => [...prev, msg.data])
      } else if (msg.stream === 'klines') {
        setKlines(msg.data || [])
      } else if (msg.stream === 'indicators') {
        setIndicators(msg.data || { ma_fast: [], ma_slow: [] })
      } else if (msg.stream === 'equity_curve') {
        setEquityCurve(msg.data || [])
      } else if (msg.stream === 'result') {
        setSummary(msg.data?.summary || null)
        setTrades(msg.data?.trades || [])
      } else if (msg.stream === 'md_tick_batch') {
        if (mdTickHandler.current) {
          mdTickHandler.current(msg.data || [])
        }
      } else if (msg.stream === 'md_alert') {
        if (mdAlertHandler.current) {
          mdAlertHandler.current(msg.data)
        }
      }
    } else if (msg.type === 'log') {
      console.log(`[Python ${msg.level}] ${msg.message}`)
    }
  }, [])

  const handleSelectFile = async () => {
    if (!isElectron) return
    const path = await window.quantAPI.selectCsvFile()
    if (path) {
      setCsvPath(path)
      const resp = await window.quantAPI.sendRequest({
        action: 'preview_csv',
        params: { csvPath: path },
      })
      if (resp?.success) {
        setCsvPreview(resp.result)
      } else {
        setCsvPreview(null)
      }
    }
  }

  const handleGenerateSample = async () => {
    if (!isElectron) return
    const defaultDir = '/Users/kl/Documents/trae_projects2/dc10/sample_data'
    const filename = `AU0_120days_${Date.now()}.csv`
    const outputPath = `${defaultDir}/${filename}`
    setProgress({ percent: 0, message: '正在生成示例数据...', stage: 'generating_sample' })
    setIsRunning(true)
    try {
      const resp = await window.quantAPI.sendRequest({
        action: 'generate_sample',
        params: { outputPath, days: 120, symbol: 'AU0' },
      })
      if (resp?.success) {
        setCsvPath(resp.result.path)
        setCsvPreview({
          columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
          rows: [],
          totalRows: resp.result.rows,
          sizeBytes: 0,
        })
      } else {
        alert(`生成失败: ${resp?.error || '未知错误'}`)
      }
    } catch (e) {
      alert(`生成失败: ${e.message}`)
    } finally {
      setIsRunning(false)
      setProgress({ percent: 0, message: '', stage: '' })
    }
  }

  const handleStartBacktest = async () => {
    if (!isElectron || !csvPath || isRunning) return
    setIsRunning(true)
    setProgress({ percent: 0, message: '初始化回测...', stage: 'init' })
    setSignals([])
    setKlines([])
    setIndicators({ ma_fast: [], ma_slow: [] })
    setEquityCurve([])
    setSummary(null)
    setTrades([])
    try {
      const resp = await window.quantAPI.sendRequest({
        action: 'start_backtest',
        params: {
          csvPath,
          ...config,
        },
      })
      if (!resp?.success) {
        alert(`回测失败: ${resp?.error || '未知错误'}`)
      } else if (resp.result?.summary) {
        setSummary(resp.result.summary)
      }
    } catch (e) {
      alert(`请求失败: ${e.message}`)
    } finally {
      setIsRunning(false)
      setProgress({ percent: 100, message: '完成', stage: 'done' })
    }
  }

  const handleTabChange = (tabId) => {
    setActiveTab(tabId)
  }

  const renderBacktestTab = () => (
    <div className="main-content">
      <aside className="sidebar">
        <ControlPanel
          csvPath={csvPath}
          csvPreview={csvPreview}
          config={config}
          setConfig={setConfig}
          onSelectFile={handleSelectFile}
          onGenerateSample={handleGenerateSample}
          onStart={handleStartBacktest}
          isRunning={isRunning}
          disabled={!isElectron}
        />
      </aside>

      <section className="chart-area">
        <MetricsCards summary={summary} />

        <div className="chart-card kline-card">
          <div className="chart-header">
            <div className="chart-title">
              <span>K 线图 &amp; 买卖信号</span>
              {trades.length > 0 && (
                <span className="trade-count-badge">{trades.length} 笔交易</span>
              )}
            </div>
          </div>
          <div className="chart-container">
            {klines.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📈</div>
                <div className="empty-title">暂无 K 线数据</div>
                <div className="empty-desc">
                  选择本地 CSV 历史行情文件，或生成示例数据后，点击"开始回测"按钮
                </div>
              </div>
            ) : (
              <KLineChart klines={klines} indicators={indicators} signals={signals} />
            )}
          </div>
        </div>

        <div className="chart-card equity-card">
          <div className="chart-header">
            <div className="chart-title">权益曲线 / 资金走势</div>
          </div>
          <div className="chart-container">
            {equityCurve.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💰</div>
                <div className="empty-title">暂无权益数据</div>
              </div>
            ) : (
              <EquityChart equityCurve={equityCurve} initialCapital={config.initialCapital} />
            )}
          </div>
        </div>
      </section>
    </div>
  )

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-title">QuantLab · 量化策略回测与行情监控台</div>
        <div className="app-subtitle">A 股 &amp; 商品期货 | Tick 级数据</div>
        <div className="tab-bar">
          <div
            className={`tab-btn ${activeTab === 'backtest' ? 'active' : ''}`}
            onClick={() => handleTabChange('backtest')}
          >
            📊 策略回测
          </div>
          <div
            className={`tab-btn ${activeTab === 'monitor' ? 'active' : ''}`}
            onClick={() => handleTabChange('monitor')}
          >
            🔴 实时行情监控
          </div>
        </div>
        <div className={`status-dot ${bridgeStatus.state}`} />
        <div className="status-text">{bridgeStatus.message}</div>
      </header>

      {activeTab === 'backtest' ? renderBacktestTab() : (
        <MonitorPanel
          isElectron={isElectron}
          setMdTickHandler={(fn) => { mdTickHandler.current = fn }}
          setMdAlertHandler={(fn) => { mdAlertHandler.current = fn }}
        />
      )}

      {isRunning && (
        <ProgressOverlay
          percent={progress.percent}
          message={progress.message}
          stage={progress.stage}
        />
      )}
    </div>
  )
}
