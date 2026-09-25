# Budget Planner — desktop app

An Electron wrapper around the same `index.html` used by the web app. It doesn't duplicate any
app code: on launch it spins up a tiny local HTTP server (`127.0.0.1:51248`) serving the repo's
`index.html` and `sw.js`, then opens a window pointed at it — so it behaves exactly like the
browser version (including the service worker), just in its own window with a dock/taskbar icon
instead of a browser tab.

## Run it in dev mode

```bash
cd desktop
npm install
npm start
```

## Build an installer

```bash
cd desktop
npm install
npm run dist
```

Output lands in `desktop/dist/`: a `.dmg` on macOS, an NSIS `.exe` installer on Windows, or an
`.AppImage` on Linux (electron-builder only cross-builds some of these — building the macOS
target requires running on macOS, etc.).

## Why port 51248 is fixed

The Worker that proxies AI requests (`worker/index.js`) only accepts requests from an allowlisted
`Origin` header — that's what stops the publicly-visible Worker URL from being abused by other
sites. The desktop app's local server always binds to `http://localhost:51248` so that origin can
be allowlisted once, in `ALLOWED_ORIGINS` in `worker/index.js`, rather than needing to change
every time you rebuild. If you change `PORT` in `main.js`, update and redeploy the Worker to match
(and update `worker/README.md`'s CORS note), or AI features will fail with "Forbidden origin".

## Google Drive backup in the desktop app

Google's OAuth client only allows sign-in from origins you've explicitly authorized. If you use
the optional Drive backup feature, add `http://localhost:51248` to **Authorized JavaScript
origins** on your OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
the same way the deployed web origin is added per the root README. Without this, the "Connect
Google Drive" button will fail in the desktop app even though it works fine in the browser.

## Icons

No custom app icon is configured yet — builds use electron-builder's default icon. To add one,
drop `icon.icns` (mac), `icon.ico` (win), and `icon.png` (linux, 512x512) into `desktop/build/`
and reference them under `build.mac.icon` / `build.win.icon` / `build.linux.icon` in
`package.json`.
