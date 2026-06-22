const { spawn } = require('child_process')
const path = require('path')
const net = require('net')
const { v4: uuidv4 } = require('uuid')
const { EventEmitter } = require('events')

const SOCKET_PORT = 52525
const SOCKET_HOST = '127.0.0.1'

class PythonBridge extends EventEmitter {
  constructor(onMessage) {
    super()
    this.onMessage = onMessage
    this.pythonProcess = null
    this.socket = null
    this.isReady = false
    this.pendingRequests = new Map()
    this._buffer = ''
  }

  async start() {
    const pythonScriptPath = path.join(__dirname, '../python/engine_server.py')
    const isDev = process.env.NODE_ENV === 'development'

    const pythonArgs = [
      pythonScriptPath,
      '--host', SOCKET_HOST,
      '--port', String(SOCKET_PORT)
    ]

    let pythonExec = 'python3'
    try {
      require('child_process').execSync('which python3')
    } catch (_) {
      pythonExec = 'python'
    }

    console.log(`[Bridge] Starting Python with: ${pythonExec} ${pythonArgs.join(' ')}`)

    this.pythonProcess = spawn(pythonExec, pythonArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })

    this.pythonProcess.stdout.on('data', (data) => {
      console.log(`[Python stdout] ${data.toString().trim()}`)
    })

    this.pythonProcess.stderr.on('data', (data) => {
      console.warn(`[Python stderr] ${data.toString().trim()}`)
    })

    this.pythonProcess.on('exit', (code, signal) => {
      console.log(`[Bridge] Python exited code=${code} signal=${signal}`)
      this.isReady = false
      if (this.socket) {
        try { this.socket.destroy() } catch (_) {}
        this.socket = null
      }
    })

    await this._waitForSocket(15000)
    await this._connectSocket()
  }

  stop() {
    if (this.socket) {
      try { this.socket.destroy() } catch (_) {}
      this.socket = null
    }
    if (this.pythonProcess) {
      this.pythonProcess.kill('SIGTERM')
      setTimeout(() => {
        if (this.pythonProcess && !this.pythonProcess.killed) {
          this.pythonProcess.kill('SIGKILL')
        }
      }, 3000)
    }
    this.pendingRequests.forEach(({ reject }) => reject(new Error('Bridge stopped')))
    this.pendingRequests.clear()
  }

  request(payload) {
    return new Promise((resolve, reject) => {
      const requestId = uuidv4()
      const msg = JSON.stringify({ id: requestId, ...payload }) + '\n'
      this.pendingRequests.set(requestId, { resolve, reject, createdAt: Date.now() })
      try {
        this.socket.write(msg)
      } catch (err) {
        this.pendingRequests.delete(requestId)
        reject(err)
      }
    })
  }

  _waitForSocket(timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const tryConnect = () => {
        const probe = net.connect(SOCKET_PORT, SOCKET_HOST, () => {
          probe.destroy()
          resolve()
        })
        probe.on('error', () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Timeout waiting for Python socket'))
          } else {
            setTimeout(tryConnect, 300)
          }
        })
      }
      tryConnect()
    })
  }

  _connectSocket() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(SOCKET_PORT, SOCKET_HOST, () => {
        console.log('[Bridge] Connected to Python socket')
        this.isReady = true
        resolve()
      })

      this.socket.on('data', (data) => {
        this._buffer += data.toString()
        let idx
        while ((idx = this._buffer.indexOf('\n')) !== -1) {
          const rawLine = this._buffer.slice(0, idx).trim()
          this._buffer = this._buffer.slice(idx + 1)
          if (!rawLine) continue
          try {
            const msg = JSON.parse(rawLine)
            this._handleMessage(msg)
          } catch (err) {
            console.warn('[Bridge] Failed to parse message:', err, rawLine)
          }
        }
      })

      this.socket.on('error', (err) => {
        console.error('[Bridge] Socket error:', err)
        this.isReady = false
        reject(err)
      })

      this.socket.on('close', () => {
        console.log('[Bridge] Socket closed')
        this.isReady = false
      })
    })
  }

  _handleMessage(msg) {
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve } = this.pendingRequests.get(msg.id)
      this.pendingRequests.delete(msg.id)
      resolve(msg)
    } else if (msg.type === 'stream') {
      this.onMessage && this.onMessage(msg)
    } else if (msg.type === 'log') {
      console.log(`[Python log] ${msg.level}: ${msg.message}`)
      this.onMessage && this.onMessage(msg)
    }
  }
}

function createPythonBridge(onMessage) {
  return new PythonBridge(onMessage)
}

module.exports = { createPythonBridge, PythonBridge }
