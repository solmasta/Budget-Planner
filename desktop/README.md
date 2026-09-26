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

## Releasing an update (auto-updates)

Once installed, the app checks for a newer version on launch (and every few hours while left
open) and installs it in the background via [`electron-updater`](https://www.electron.build/auto-update) —
no manual reinstall needed. Updates are published as GitHub Releases by
`.github/workflows/desktop-release.yml`, which builds installers for all three platforms and
uploads them automatically. To ship an update:

1. Bump `"version"` in `desktop/package.json` (e.g. `1.0.0` → `1.0.1`).
2. Commit and push that change.
3. Tag and push: `git tag desktop-v1.0.1 && git push origin desktop-v1.0.1` (the tag just
   triggers the workflow — electron-builder names the actual GitHub Release `v1.0.1` from the
   `package.json` version, not from the tag text, so the two must match).
4. Wait for the [Actions run](../../actions) to finish (builds on Windows/macOS/Linux runners in
   parallel, a few minutes) — `"releaseType": "release"` in `package.json`'s publish config makes
   it go live immediately (no draft, no manual "Publish release" click) since `permissions.contents`
   is `write` and `GH_TOKEN` is the default `GITHUB_TOKEN`; no extra secrets to set up.
5. Every installed copy of the app picks up the new version next time it's opened (or within its
   next 4-hour check if left running).

There's no review step between step 3 and the release going live to every installed copy — that's
a deliberate tradeoff for a low-stakes personal app. If that ever stops being comfortable, drop
`"releaseType": "release"` from `package.json` (electron-builder's default is `"draft"`), which
adds back a manual "Publish release" click on GitHub before `electron-updater` will see it.

**macOS caveat:** Squirrel.Mac (the auto-update mechanism `electron-updater` uses on macOS)
requires the app to be code-signed and notarized to actually apply an update; that's not set up
here (needs a paid Apple Developer account). Unsigned Mac builds can still be downloaded and
installed manually from the GitHub Release, they just won't self-update. Windows and Linux
auto-updates work fine unsigned.

You can also trigger `.github/workflows/desktop-release.yml` manually from the Actions tab
(`workflow_dispatch`) if a run needs to be retried without pushing a new tag.

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
