const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server');

let mainWindow;

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
        { role: 'quit', label: '退出 ' + app.name }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        isMac ? { role: 'close', label: '关闭' } : { role: 'quit', label: '退出' }
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
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '切换开发者工具' },
        { type: 'separator' },
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

  // 根据环境变量判断是开发环境还是生产环境
  if (process.env.NODE_ENV === 'development') {
    // 开发环境加载 Vite 的开发服务器
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境加载构建好的 Vue 静态文件
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  setAppMenu();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  // macOS 上除外，应用通常保持活动状态直到用户显式退出
  if (process.platform !== 'darwin') app.quit();
});
