const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray;
let isQuitting = false;
let closePromptVisible = false;
let quitPromise = null;
let updateCheckPromise = null;
const releaseUrl = 'https://github.com/sakurazerodark/mini-shop-manager/releases';

const getTrayIcon = () => {
  const candidates = [
    path.join(app.getAppPath(), 'public', 'app.ico'),
    path.join(__dirname, '..', 'public', 'app.ico'),
    path.join(process.resourcesPath || '', 'public', 'app.ico')
  ];
  const iconPath = candidates.find((candidate) => fs.existsSync(candidate));
  return iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
};

const showMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const createTray = () => {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  tray.setToolTip(app.name);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 MiniShop', click: showMainWindow },
    { type: 'separator' },
    { label: '退出应用', click: requestQuit }
  ]));
  tray.on('click', showMainWindow);
};

const hideToTray = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
};

const clearRendererAuth = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const logoutUrl = `http://127.0.0.1:${process.env.PORT || 8080}/api/auth/logout`;
  const script = `(async () => {
    const token = localStorage.getItem('mini-shop-auth-token');
    if (token) {
      try {
        await Promise.race([
          fetch(${JSON.stringify(logoutUrl)}, { method: 'POST', headers: { Authorization: 'Bearer ' + token } }),
          new Promise(resolve => setTimeout(resolve, 800))
        ]);
      } catch (_) {}
    }
    localStorage.removeItem('mini-shop-auth-token');
    localStorage.removeItem('mini-shop-auth-user');
    localStorage.removeItem('mini-shop-auth-permissions');
  })()`;
  try {
    await mainWindow.webContents.executeJavaScript(script, true);
  } catch (_) {}
};

function requestQuit() {
  if (isQuitting) return;
  isQuitting = true;
  quitPromise = clearRendererAuth().finally(() => app.quit());
}

function showClosePrompt() {
  if (closePromptVisible || isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
  closePromptVisible = true;
  dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '关闭 MiniShop',
    message: '请选择关闭方式',
    detail: '最小化到托盘后，仍可从系统托盘重新打开应用。',
    buttons: ['关闭应用', '最小化到托盘', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  }).then(({ response }) => {
    closePromptVisible = false;
    if (response === 0) requestQuit();
    else if (response === 1) hideToTray();
  }).catch(() => {
    closePromptVisible = false;
  });
}

function sendUpdateEvent(channel, payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function configureAutoUpdater() {
  ipcMain.handle('update:version', () => ({
    currentVersion: app.getVersion(),
    supported: app.isPackaged
  }));
  ipcMain.handle('update:open-release', () => shell.openExternal(releaseUrl));

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { status: 'development', currentVersion: app.getVersion() };
    }
    if (updateCheckPromise) return updateCheckPromise;

    updateCheckPromise = autoUpdater.checkForUpdates()
      .then((result) => ({
        status: 'checking',
        currentVersion: app.getVersion(),
        latestVersion: result?.updateInfo?.version || ''
      }))
      .catch((error) => {
        sendUpdateEvent('update:error', { message: error?.message || String(error) });
        throw new Error(error?.message || 'Unable to check for updates');
      })
      .finally(() => {
        updateCheckPromise = null;
      });
    return updateCheckPromise;
  });

  ipcMain.handle('update:download', async () => {
    if (!app.isPackaged) return { status: 'development' };
    await autoUpdater.downloadUpdate();
    return { status: 'downloading' };
  });

  ipcMain.handle('update:install', async () => {
    if (!app.isPackaged) return { status: 'development' };
    isQuitting = true;
    await clearRendererAuth();
    autoUpdater.quitAndInstall();
    return { status: 'installing' };
  });

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateEvent('update:checking'));
  autoUpdater.on('update-available', (info) => sendUpdateEvent('update:available', {
    version: info?.version || '',
    releaseDate: info?.releaseDate || '',
    releaseNotes: info?.releaseNotes || ''
  }));
  autoUpdater.on('update-not-available', (info) => sendUpdateEvent('update:not-available', {
    version: info?.version || app.getVersion()
  }));
  autoUpdater.on('download-progress', (progress) => sendUpdateEvent('update:progress', {
    percent: Number(progress?.percent || 0),
    transferred: progress?.transferred || 0,
    total: progress?.total || 0
  }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateEvent('update:downloaded', {
    version: info?.version || ''
  }));
  autoUpdater.on('error', (error) => sendUpdateEvent('update:error', {
    message: error?.message || String(error)
  }));
}

function checkForUpdatesOnStartup() {
  if (!app.isPackaged) return;
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      sendUpdateEvent('update:error', { message: error?.message || String(error) });
    });
  }, 5000);
}

function setAppMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 ' + app.name },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 ' + app.name },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { label: '退出 ' + app.name, click: showClosePrompt }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        isMac ? { role: 'close', label: '关闭' } : { label: '退出', click: showClosePrompt }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
          { role: 'delete', label: '删除' },
          { role: 'selectAll', label: '全选' },
          { type: 'separator' },
          {
            label: '语音',
            submenu: [
              { role: 'startSpeaking', label: '开始朗读' },
              { role: 'stopSpeaking', label: '停止朗读' }
            ]
          }
        ] : [
          { role: 'delete', label: '删除' },
          { type: 'separator' },
          { role: 'selectAll', label: '全选' }
        ])
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front', label: '前置所有窗口' },
          { type: 'separator' },
          { role: 'window', label: '窗口' }
        ] : [
          { role: 'close', label: '关闭' }
        ])
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '项目仓库 (GitHub)',
          click: async () => {
            await shell.openExternal('https://github.com/sakurazerodark/mini-shop-manager');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  // 启动本地 Express 服务
  await startServer();

  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    showClosePrompt();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  createTray();

  // 根据环境变量判断是开发环境还是生产环境
  if (process.env.NODE_ENV === 'development') {
    // 开发环境加载 Vite 的开发服务器
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境加载构建好的 Vue 静态文件
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.once('did-finish-load', checkForUpdatesOnStartup);
}

app.whenReady().then(() => {
  configureAutoUpdater();
  setAppMenu();
  createWindow();

  app.on('activate', function () {
    if (mainWindow && !mainWindow.isDestroyed()) showMainWindow();
    else createWindow();
  });
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  requestQuit();
});

app.on('window-all-closed', function () {
  // macOS 上除外，应用通常保持活动状态直到用户显式退出
  if (process.platform !== 'darwin') app.quit();
});
