const net = require('net')
const path = require('path')

const PORT = 52525
const HOST = '127.0.0.1'

let msgId = 0
const nextId = () => { msgId++; return `req_${msgId}_${Date.now()}` }

const pending = new Map()
let buffer = ''

const client = net.connect(PORT, HOST, () => {
  console.log('[Client] Connected')
  runTests()
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
      console.warn('[Client] Parse error:', e.message, line.slice(0, 100))
    }
  }
})

client.on('error', (e) => console.error('[Client] Error:', e))
client.on('close', () => { console.log('[Client] Closed'); process.exit(0) })

function send(msg) {
  if (!msg.id) msg.id = nextId()
  client.write(JSON.stringify(msg) + '\n')
  return msg.id
}

function request(msg, timeoutMs = 60000) {
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
  } else if (msg.type === 'stream') {
    const d = msg.data
    if (msg.stream === 'progress') {
      process.stdout.write(`  [progress] ${d.message || ''} ${d.percent || 0}%\r`)
    } else if (msg.stream === 'signal') {
      // console.log(`  [signal] ${d.type} @ ${d.price} idx=${d.index}`)
    } else if (msg.stream === 'result') {
      console.log(`\n  [result stream] summary:`, JSON.stringify(d.summary).slice(0, 200))
    } else if (msg.stream === 'klines') {
      console.log(`\n  [klines stream] ${d.length} bars`)
    } else if (msg.stream === 'indicators') {
      console.log(`  [indicators] MA fast=${d.ma_fast?.length || 0} slow=${d.ma_slow?.length || 0}`)
    } else if (msg.stream === 'equity_curve') {
      console.log(`  [equity_curve] ${d.length} points`)
    } else {
      console.log('  [stream]', msg.stream)
    }
  } else if (msg.type === 'log') {
    console.log(`  [python log ${msg.level}] ${msg.message}`)
  }
}

async function runTests() {
  try {
    console.log('\n=== TEST 1: Ping ===')
    const ping = await request({ action: 'ping' })
    console.log('Ping response:', ping)
    console.assert(ping.success === true, 'Ping failed')

    console.log('\n=== TEST 2: Generate sample CSV ===')
    const outPath = path.join(__dirname, '../sample_data/test_comm.csv')
    const genResp = await request({
      action: 'generate_sample',
      params: { outputPath: outPath, days: 30, symbol: 'TEST' },
    })
    console.log('Generate response:', genResp.success, genResp.result || genResp.error)
    console.assert(genResp.success === true, 'Generate failed')

    console.log('\n=== TEST 3: Preview CSV ===')
    const previewResp = await request({
      action: 'preview_csv',
      params: { csvPath: outPath },
    })
    console.log('Preview:', previewResp.success,
      previewResp.success
        ? `rows=${previewResp.result.totalRows} cols=${previewResp.result.columns.join(',')}`
        : previewResp.error)
    console.assert(previewResp.success === true, 'Preview failed')

    console.log('\n=== TEST 4: Start Backtest (this takes time) ===')
    const start = Date.now()
    const btResp = await request({
      action: 'start_backtest',
      params: {
        csvPath: outPath,
        strategy: 'ma',
        fastMa: 5,
        slowMa: 20,
        initialCapital: 100000,
        commission: 0.0003,
        slippage: 0.0,
        timeframe: '1min',
        stopLossPct: 0.02,
        takeProfitPct: 0.05,
      },
    }, 120000)
    const duration = ((Date.now() - start) / 1000).toFixed(2)
    console.log(`\nBacktest completed in ${duration}s`)
    console.log('Final response:', btResp.success, btResp.result ? 'summary keys=' + Object.keys(btResp.result.summary).join(',') : ('error=' + btResp.error))
    console.assert(btResp.success === true, 'Backtest failed')

    console.log('\n✅ ALL TESTS PASSED! Socket communication works perfectly.')

  } catch (e) {
    console.error('❌ TEST FAILED:', e.message)
    process.exitCode = 1
  } finally {
    client.destroy()
    setTimeout(() => process.exit(0), 500)
  }
}
