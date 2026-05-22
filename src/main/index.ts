import { app, BrowserWindow, ipcMain, shell, protocol, desktopCapturer, clipboard, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { startAsrSession, sendAsrAudio, stopAsrSession } from './asr-proxy';
import { loadSettings, saveSettings, openDataDir, getDataDir, type AppSettings } from './settings';

const isDev = !app.isPackaged;
const PROTOCOL = 'aimeet';

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    center: true,
    show: false,
    title: 'CatChat',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // DevTools can be opened manually via Ctrl+Shift+I or F12
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (pendingDeepLink) {
    flushDeepLink(pendingDeepLink);
    pendingDeepLink = null;
  }
}

function flushDeepLink(url: string) {
  if (!mainWindow) {
    pendingDeepLink = url;
    return;
  }
  const send = () => mainWindow?.webContents.send('deep-link', url);
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) flushDeepLink(link);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    flushDeepLink(url);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.registerFileProtocol('aimeet-asset', (req, cb) => {
      const url = req.url.replace('aimeet-asset://', '');
      cb({ path: decodeURIComponent(url) });
    });

    const launchLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (launchLink) pendingDeepLink = launchLink;

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('asr:start', (e) => {
  const settings = loadSettings();
  return startAsrSession(e.sender, settings);
});

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, s: AppSettings) => { saveSettings(s); return true; });
ipcMain.handle('settings:openDataDir', () => openDataDir());
ipcMain.handle('settings:getDataDir', () => getDataDir());

ipcMain.handle('file:saveToDesktop', (_e, name: string, data: ArrayBuffer) => {
  const desktop = app.getPath('desktop');
  const subdir = path.join(desktop, 'CatChat');
  fs.mkdirSync(subdir, { recursive: true });
  let target = path.join(subdir, name);
  // De-dup: if file exists, append timestamp
  if (fs.existsSync(target)) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    target = path.join(subdir, `${base}-${Date.now()}${ext}`);
  }
  fs.writeFileSync(target, Buffer.from(data));
  return target;
});

ipcMain.handle('file:reveal', (_e, p: string) => shell.showItemInFolder(p));

let screenshotCancelled = false;

ipcMain.handle('screenshot:native', async () => {
  screenshotCancelled = false;
  const before = clipboard.readImage();
  const beforeBuf = before.isEmpty() ? null : before.toPNG();

  const wasVisible = mainWindow?.isVisible() ?? false;
  mainWindow?.minimize();

  try {
    await shell.openExternal('ms-screenclip:');
  } catch (e: any) {
    if (wasVisible) mainWindow?.show();
    return { error: '无法启动系统截图工具：' + (e?.message || e) };
  }

  const restore = () => {
    if (wasVisible) {
      mainWindow?.show();
      mainWindow?.focus();
    }
  };

  const start = Date.now();
  while (Date.now() - start < 60000) {
    if (screenshotCancelled) {
      restore();
      return { cancelled: true };
    }
    await new Promise((r) => setTimeout(r, 400));
    const img = clipboard.readImage();
    if (img.isEmpty()) continue;
    const buf = img.toPNG();
    const isNew = !beforeBuf || buf.length !== beforeBuf.length || !buf.equals(beforeBuf);
    if (isNew) {
      restore();
      return { png: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
  }
  restore();
  return { timeout: true };
});

ipcMain.handle('screenshot:cancel', () => {
  screenshotCancelled = true;
});

ipcMain.on('asr:audio', (e, audio: ArrayBuffer) => {
  sendAsrAudio(e.sender.id, Buffer.from(audio));
});

ipcMain.handle('asr:stop', (e) => {
  stopAsrSession(e.sender.id);
});

ipcMain.handle('screen:getSources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 240, height: 135 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    isScreen: s.id.startsWith('screen:'),
  }));
});
