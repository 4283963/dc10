const net = require('net')
const path = require('path')

const PORT = 52526
const HOST = '127.0.0.1'

let msgId = 0
const nextId = () => { msgId++; return `req_${msgId}_${Date.now()}` }

const pending = new Map()
let buffer = ''

const client = net.connect(PORT, HOST, () => {
  console.log('[Client] Connected to port', PORT)
  runComparison()
})

client.on('data', (data) => {
  buffer += data.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      handle(msg)
    } catch (e) {
      console.warn('[Client] Parse error:', e.message)
    }
  }
})

client.on('error', (e) => console.error('[Client] Error:', e))
client.on('close', () => {
  console.log('[Client] Closed')
  process.exit(0)
})

function send(msg) {
  if (!msg.id) msg.id = nextId()
  client.write(JSON.stringify(msg) + '\n')
  return msg.id
}

function request(msg, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = send(msg)
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Request ${msg.action} timed out`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timeout })
  })
}

function handle(msg) {
  if (msg.id && pending.has(msg.id)) {
    const { resolve, timeout } = pending.get(msg.id)
    pending.delete(msg.id)
    clearTimeout(timeout)
    resolve(msg)
  }
}

async function runComparison() {
  try {
    const csvPath = path.join(__dirname, '../sample_data/compare_test.csv')

    const genResp = await request({
      action: 'generate_sample',
      params: { outputPath: csvPath, days: 60, symbol: 'TREND' },
    })
    console.log('Sample generated:', genResp.success, genResp.result?.rows, 'rows')

    const btResp = await request({
      action: 'start_backtest',
      params: {
        csvPath,
        strategy: 'ma',
        fastMa: 10,
        slowMa: 30,
        initialCapital: 100000,
        commission: 0.0003,
        slippage: 0.001,
        timeframe: '1min',
        stopLossPct: 0.03,
        takeProfitPct: 0.06,
      },
    })

    if (btResp.success) {
      const s = btResp.result.summary
      console.log('\n========= 修复后回测结果 =========')
      console.log(`  总收益率:    ${s.total_return_pct.toFixed(2)}%`)
      console.log(`  年化收益:    ${s.annual_return_pct.toFixed(2)}%`)
      console.log(`  最大回撤:    ${s.max_drawdown_pct.toFixed(2)}%`)
      console.log(`  夏普比率:    ${s.sharpe_ratio.toFixed(3)}`)
      console.log(`  交易次数:    ${s.trade_count}`)
      console.log(`  胜率:        ${s.win_rate_pct.toFixed(2)}%`)
      console.log(`  盈亏比:      ${s.profit_factor.toFixed(3)}`)
      console.log(`  期末权益:    ¥${s.final_equity.toLocaleString()}`)
      console.log('==================================')

      console.log('\n✅ 全链路通信测试通过')
    } else {
      console.error('Backtest failed:', btResp.error)
    }

  } catch (e) {
    console.error('Test failed:', e.message)
    process.exitCode = 1
  } finally {
    client.destroy()
    setTimeout(() => process.exit(0), 500)
  }
}
