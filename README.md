# Budget Planner

A single-page, installable budget planner: track accounts, recurring bills and income, see projected cash flow, and get AI-generated insights and receipt scanning. Everything runs in the browser — there's no backend for your budget data, and no build step for the app itself.

## Features

- Accounts, recurring bills/income (weekly/biweekly/monthly/quarterly/yearly), and projected running balance
- Snapshots, cleared/skipped transaction tracking, and manual overrides
- AI insights, an AI "advisor" chat, and photo-based receipt/bill scanning (via Claude)
- Optional backup/restore to Google Drive
- Installable PWA with offline support via a service worker

## Tech stack

- Plain HTML + a single bundled React (production build) — everything lives in `index.html`
- No bundler, no `npm install`, no build step
- `sw.js` — service worker for offline caching and install-to-home-screen support

## Running locally

Because of the service worker, opening `index.html` directly via `file://` won't behave correctly (service workers require `http`/`https`). Serve the folder instead:

```bash
# from the repo root
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080`. Your data is saved to the browser's `localStorage`, so it's local to that browser/device unless you use the Google Drive backup feature.

## Deployment (GitHub Pages)

This repo is a static site, so GitHub Pages needs no build step:

1. Push `index.html` and `sw.js` to the branch you want to publish (e.g. `main`).
2. In the repo settings, go to **Settings → Pages** and set the source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. GitHub will publish the site at `https://<user>.github.io/<repo>/`.

When you deploy changes to `index.html`, bump `window.__APP_VERSION` (near the top of `index.html`) so the boot screen reflects the new version. The service worker (`sw.js`) refreshes its cache in the background on focus/visibility change and on next load, so most users pick up updates automatically without a hard refresh.

## Optional: AI features (insights, advisor chat, receipt scanning)

AI features call a small proxy Worker (`WORKER_URL` near the top of the app script in `index.html`) instead of calling Claude directly from the browser, so an API key is never exposed client-side. The Worker's source lives in this repo at `worker/index.js`, with `wrangler.jsonc` at the repo root — see [`worker/README.md`](worker/README.md) for full deployment steps, including deploying straight from this repo via Cloudflare's Git integration.

Quick version:

1. Connect this repo to a Cloudflare Worker (Cloudflare dashboard → Workers & Pages → Create → Import a repository), or paste `worker/index.js` into a manually created Worker.
2. Store your Anthropic API key as a Worker secret named `ANTHROPIC_API_KEY` — never commit it to this repo.
3. Update `WORKER_URL` in `index.html` to point at your Worker's URL.

If you don't set this up, the app still works fully for manual budgeting — the AI panels will just fail to load when used.

## Optional: Google Drive backup

Backup/restore uses Google Identity Services with the narrow `drive.file` scope (access only to files the app itself creates — not your whole Drive). To enable it on your own deployment:

1. Create an OAuth 2.0 Client ID (type: Web application) in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add your deployed site's origin (e.g. `https://<user>.github.io`) to **Authorized JavaScript origins**.
3. Replace `GOOGLE_DRIVE_CLIENT_ID` near the top of the app script in `index.html` with your client ID.

## Data & privacy

All budget data (accounts, bills, snapshots, notes) is stored only in the browser's `localStorage` on the device you're using. Nothing is sent anywhere except: (a) the optional Google Drive backup file, and (b) the minimal context sent to your AI proxy Worker when you use an AI feature.
