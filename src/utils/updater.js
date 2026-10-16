const getIpcRenderer = () => {
  if (typeof window === 'undefined' || typeof window.require !== 'function') return null
  try {
    return window.require('electron').ipcRenderer || null
  } catch {
    return null
  }
}

const ipcRenderer = getIpcRenderer()

export const updater = ipcRenderer
  ? {
      isSupported: true,
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      on: (channel, listener) => {
        const wrapped = (_event, payload) => listener(payload)
        ipcRenderer.on(channel, wrapped)
        return wrapped
      },
      off: (channel, listener) => ipcRenderer.removeListener(channel, listener)
    }
  : {
      isSupported: false,
      invoke: async () => ({ status: 'browser' }),
      on: () => {},
      off: () => {}
    }
