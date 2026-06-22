const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron')
const path = require('path')
const { createPythonBridge } = require('./pythonBridge')

const isDev = process.env.NODE_ENV === 'development'

let mainWindow = null
let pythonBridge = null

const EXCHANGE_NAMES = {
  SHFE: '上期所',
  DCE: '大商所',
  CZCE: '郑商所',
  CFFEX: '中金所',
  INE: '能源中心',
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function playSystemBeep() {
  try {
    const { exec } = require('child_process')
    const platform = process.platform
    if (platform === 'darwin') {
      exec('afplay /System/Library/Sounds/Glass.aiff')
    } else if (platform === 'win32') {
      exec('powershell -c "(New-Object Media.SoundPlayer \'C:\\Windows\\Media\\Alarm01.wav\').PlaySync()"')
    } else {
      exec('paplay /usr/share/sounds/freedesktop/stereo/complete.oga')
    }
  } catch (e) {
    console.error('[Electron] Beep error:', e)
  }
}

function showAlertNotification(alertData) {
  try {
    const exchName = EXCHANGE_NAMES[alertData.exchange] || alertData.exchange
    const symbol = alertData.symbol
    const spread = alertData.spread_pct !== undefined
      ? `${alertData.spread_pct.toFixed(1)} bp`
      : alertData.spread.toFixed(4)
    const priceRange = `买 ${alertData.bid1_price.toFixed(2)} / 卖 ${alertData.ask1_price.toFixed(2)}`

    const title = `⚠️ 价差报警 | ${exchName} ${symbol}`
    const body = `价差: ${spread} 超过阈值\n${priceRange}`

    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        silent: false,
        urgency: 'critical',
        timeoutType: 'default',
      })
      notification.show()
    }

    if (mainWindow) {
      mainWindow.webContents.send('md:alert', alertData)
    }

    playSystemBeep()
  } catch (e) {
    console.error('[Electron] Notification error:', e)
  }
}

async function setupPythonBridge() {
  pythonBridge = createPythonBridge((message) => {
    if (message.type === 'stream' && message.stream === 'md_alert') {
      showAlertNotification(message.data)
      return
    }
    if (mainWindow) {
      mainWindow.webContents.send('python:message', message)
    }
  })

  try {
    await pythonBridge.start()
    console.log('[Electron] Python bridge started successfully')
  } catch (err) {
    console.error('[Electron] Failed to start Python bridge:', err)
    if (mainWindow) {
      mainWindow.webContents.send('python:error', {
        type: 'bridge_start_failed',
        message: err.message
      })
    }
  }
}

app.whenReady().then(async () => {
  createWindow()
  await setupPythonBridge()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (pythonBridge) {
    pythonBridge.stop()
  }
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('app:selectCsvFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择历史行情 CSV 文件',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
})

ipcMain.handle('python:request', async (event, payload) => {
  if (!pythonBridge || !pythonBridge.isReady) {
    return { success: false, error: 'Python bridge not ready' }
  }
  try {
    return await pythonBridge.request(payload)
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('app:playBeep', () => {
  playSystemBeep()
  return true
})

ipcMain.handle('app:showNotification', (_event, opts) => {
  if (opts && opts.title) {
    if (Notification.isSupported()) {
      new Notification({
        title: opts.title,
        body: opts.body || '',
        silent: opts.silent || false,
      }).show()
    }
  }
  return true
})

