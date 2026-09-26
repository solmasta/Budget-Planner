const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Fixed on purpose: the Worker's CORS allowlist (worker/index.js -> ALLOWED_ORIGINS) is keyed
// to this exact origin, so AI features (advisor chat, receipt/report scanning) only work if the
// app is served from this port. Changing it here means updating the Worker to match and
// redeploying it.
const PORT = 51248;
const HOST = "127.0.0.1";

// In dev this is the repo root (one level up from desktop/); once packaged, electron-builder
// copies index.html/sw.js into resources/app via the "extraResources" config in package.json.
const APP_ROOT = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (reqPath === "/") reqPath = "/index.html";
      const filePath = path.normalize(path.join(APP_ROOT, reqPath));
      // Reject any path that escapes APP_ROOT (e.g. via ../../).
      if (!filePath.startsWith(path.normalize(APP_ROOT))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    title: "Budget Planner",
    backgroundColor: "#F2F4F7",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Anything the app tries to open in a new window (e.g. mailto: drafts, the Google Drive
  // OAuth popup, bureau portal links from the credit tab) should go to the system browser
  // rather than spawn another Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://${HOST}:${PORT}/index.html`);
  return win;
}

// Checks GitHub Releases (see .github/workflows/desktop-release.yml and the "publish" config
// in package.json) for a newer version, downloads it in the background, and offers to restart
// once it's ready. A no-op in dev (`npm start`) since there's no packaged installer to update.
function setupAutoUpdates(win) {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    console.error("Auto-update check failed:", err);
  });

  autoUpdater.on("update-downloaded", (info) => {
    dialog
      .showMessageBox(win, {
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: `Budget Planner ${info.version} has been downloaded.`,
        detail: "Restart now to finish installing it, or it'll install next time you quit.",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  const check = () => autoUpdater.checkForUpdates().catch((err) => console.error(err));
  check();
  // Also re-check periodically in case the app is left open for a long time.
  setInterval(check, 4 * 60 * 60 * 1000);
}

// Two instances can't both bind PORT, so hand focus to the existing window instead of
// letting the second launch fail with a confusing "port in use" dialog.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (e) {
      dialog.showErrorBox(
        "Budget Planner",
        `Couldn't start the local server on port ${PORT} (${e.message}). ` +
          "Another instance may already be running, or another app is using that port."
      );
      app.quit();
      return;
    }

    Menu.setApplicationMenu(buildMenu());
    const win = await createWindow();
    setupAutoUpdates(win);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
