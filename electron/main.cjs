const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

let mainWindow = null;
let tray = null;
let isQuitting = false;

let portDataCache = [];
let portDataTime = 0;
let processCache = {};
let processCacheTime = 0;
let statsCache = null;
let isUpdatingPorts = false;
let isUpdatingProcesses = false;

const REFRESH_INTERVAL = 5000;
const CACHE_MAX_AGE = 10000;

function parseNetstatOutput(output) {
  const lines = output.split('\n');
  const connections = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Proto') || trimmed.startsWith('Active')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;

    const proto = parts[0];
    const localAddress = parts[1];
    const state = parts.length >= 5 ? parts[3] : '';
    const pid = parts.length >= 5 ? parts[4] : parts[3];

    if (!localAddress || !pid || pid === '0') continue;

    const portMatch = localAddress.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);
    const key = `${proto}:${port}:${pid}`;

    if (seen.has(key)) continue;
    seen.add(key);

    connections.push({
      protocol: proto,
      localAddress,
      port,
      state,
      pid: parseInt(pid, 10),
      processName: ''
    });
  }

  return connections;
}

function updatePortData() {
  if (isUpdatingPorts) return;
  isUpdatingPorts = true;

  exec('netstat -ano', { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
    isUpdatingPorts = false;
    if (error) {
      console.error('Error updating port data:', error.message);
      return;
    }
    portDataCache = parseNetstatOutput(stdout);
    portDataTime = Date.now();
    updateStats();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ports-updated');
    }
  });
}

function updateProcessData() {
  if (isUpdatingProcesses) return;
  isUpdatingProcesses = true;

  const cmd = 'powershell -NoProfile -Command "Get-Process | Select-Object Id, ProcessName | ConvertTo-Json -Compress"';
  exec(cmd, { encoding: 'utf8', timeout: 3000 }, (error, stdout) => {
    if (error) {
      exec('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 5000 }, (error2, stdout2) => {
        isUpdatingProcesses = false;
        if (error2) {
          console.error('Error updating process data:', error2.message);
          return;
        }
        const pidToName = {};
        const lines = stdout2.trim().split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const match = trimmed.match(/"([^"]+)","([^"]+)",/);
          if (match) {
            const name = match[1];
            const pid = parseInt(match[2], 10);
            if (!isNaN(pid)) {
              pidToName[pid] = name;
            }
          }
        }
        processCache = pidToName;
        processCacheTime = Date.now();
      });
      return;
    }

    isUpdatingProcesses = false;
    try {
      const processes = JSON.parse(stdout.trim());
      const pidToName = {};
      if (Array.isArray(processes)) {
        for (const p of processes) {
          pidToName[p.Id] = p.ProcessName + '.exe';
        }
      } else if (processes) {
        pidToName[processes.Id] = processes.ProcessName + '.exe';
      }
      processCache = pidToName;
      processCacheTime = Date.now();
    } catch (e) {
      console.error('Error parsing process data:', e.message);
    }
  });
}

function updateStats() {
  const connections = portDataCache;
  const tcpCount = connections.filter(c => c.protocol.toLowerCase().startsWith('tcp')).length;
  const udpCount = connections.filter(c => c.protocol.toLowerCase().startsWith('udp')).length;
  const uniquePorts = new Set(connections.map(c => c.port));
  const uniquePids = new Set(connections.map(c => c.pid));

  statsCache = {
    totalConnections: connections.length,
    tcpConnections: tcpCount,
    udpConnections: udpCount,
    uniquePorts: uniquePorts.size,
    uniqueProcesses: uniquePids.size,
    platform: os.platform(),
    hostname: os.hostname()
  };
}

function filterAndSortPorts(connections, search, protocol, sortBy, sortOrder) {
  let result = connections.map(c => ({
    ...c,
    processName: processCache[c.pid] || 'Unknown'
  }));

  if (search) {
    const searchLower = String(search).toLowerCase();
    result = result.filter(c =>
      c.port.toString().includes(searchLower) ||
      c.processName.toLowerCase().includes(searchLower) ||
      c.pid.toString().includes(searchLower) ||
      c.localAddress.toLowerCase().includes(searchLower)
    );
  }

  if (protocol && protocol !== 'all') {
    result = result.filter(c =>
      c.protocol.toLowerCase().startsWith(protocol.toLowerCase())
    );
  }

  result.sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'port':
        comparison = a.port - b.port;
        break;
      case 'pid':
        comparison = a.pid - b.pid;
        break;
      case 'processName':
        comparison = a.processName.localeCompare(b.processName);
        break;
      case 'protocol':
        comparison = a.protocol.localeCompare(b.protocol);
        break;
      default:
        comparison = 0;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  return result;
}

ipcMain.handle('get-ports', async (event, params) => {
  const { search = '', protocol = 'all', sortBy = 'port', sortOrder = 'asc' } = params || {};

  if (portDataCache.length === 0) {
    updatePortData();
    updateProcessData();
    return { total: 0, ports: [], cached: false };
  }

  const result = filterAndSortPorts(portDataCache, search, protocol, sortBy, sortOrder);
  const isFresh = (Date.now() - portDataTime) < CACHE_MAX_AGE;

  if (!isFresh) {
    updatePortData();
    updateProcessData();
  }

  return {
    total: result.length,
    ports: result,
    cached: !isFresh,
    lastUpdate: portDataTime
  };
});

ipcMain.handle('kill-process', async (event, pid) => {
  const pidNum = parseInt(pid, 10);
  if (isNaN(pidNum) || pidNum <= 0) {
    return { success: false, error: 'Invalid PID' };
  }

  if (pidNum <= 100) {
    return { success: false, error: 'Cannot kill system processes (PID <= 100)' };
  }

  return new Promise((resolve) => {
    exec(`taskkill /F /PID ${pidNum}`, { encoding: 'utf8', timeout: 5000 }, (error) => {
      if (error) {
        resolve({ success: false, error: `Failed to terminate process ${pidNum}`, details: error.message });
        return;
      }
      setTimeout(() => {
        updatePortData();
        updateProcessData();
      }, 500);
      resolve({ success: true, message: `Process ${pidNum} terminated successfully` });
    });
  });
});

ipcMain.handle('get-stats', async () => {
  if (statsCache) {
    if ((Date.now() - portDataTime) > CACHE_MAX_AGE) {
      updatePortData();
    }
    return statsCache;
  }

  updatePortData();
  updateProcessData();
  return {
    totalConnections: 0,
    tcpConnections: 0,
    udpConnections: 0,
    uniquePorts: 0,
    uniqueProcesses: 0,
    platform: os.platform(),
    hostname: os.hostname()
  };
});

ipcMain.handle('refresh-data', async () => {
  updatePortData();
  updateProcessData();
  return { success: true };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0e17',
    title: '端口监控仪表板',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Page load failed:', errorCode, errorDescription, validatedURL);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    console.log('Loading index from:', indexPath);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  
  try {
    tray = new Tray(trayIcon.isEmpty() ? icon : trayIcon);
  } catch (e) {
    tray = new Tray(icon);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('端口监控仪表板');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });
}

app.whenReady().then(() => {
  updatePortData();
  updateProcessData();

  setInterval(() => {
    updatePortData();
    updateProcessData();
  }, REFRESH_INTERVAL);

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});
