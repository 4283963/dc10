const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('quantAPI', {
  selectCsvFile: () => ipcRenderer.invoke('app:selectCsvFile'),
  sendRequest: (payload) => ipcRenderer.invoke('python:request', payload),
  onPythonMessage: (callback) => {
    const listener = (_event, msg) => callback(msg)
    ipcRenderer.on('python:message', listener)
    return () => ipcRenderer.removeListener('python:message', listener)
  },
  onPythonError: (callback) => {
    const listener = (_event, msg) => callback(msg)
    ipcRenderer.on('python:error', listener)
    return () => ipcRenderer.removeListener('python:error', listener)
  }
})
