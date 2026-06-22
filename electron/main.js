const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { createPythonBridge } = require('./pythonBridge')

const isDev = process.env.NODE_ENV === 'development'

let mainWindow = null
let pythonBridge = null

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

async function setupPythonBridge() {
  pythonBridge = createPythonBridge((message) => {
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
