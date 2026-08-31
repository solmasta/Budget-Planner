# AI proxy Worker

This folder + `wrangler.jsonc` at the repo root define the Cloudflare Worker that proxies AI requests (Insights, Advisor chat, receipt scanning) from `index.html` to the Anthropic API, keeping the API key server-side.

**Keep exactly one Wrangler config file at the repo root.** Cloudflare's dashboard Git integration manages `wrangler.jsonc` directly (it can rewrite it on reconnect/reconfigure), so that's the file to edit. If Cloudflare's dashboard ever regenerates it without a `"main": "worker/index.js"` field, the deploy silently falls back to serving the repo as static assets with no proxy logic at all — that's a real failure mode that happened here once already, and it presents as AI Insights/Advisor/receipt-scanning failing with a generic "Failed to fetch" (no CORS headers come back because there's no custom fetch handler running). If a second `wrangler.toml` shows up alongside `wrangler.jsonc`, delete one — having both is ambiguous and not something to rely on.

## Deploying via Cloudflare's Git integration (recommended)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Import a repository** (or **Connect to Git**).
2. Authorize Cloudflare's GitHub connection and select this repository.
3. Cloudflare detects `wrangler.jsonc` at the repo root and configures the build automatically — no build command needed, since this Worker has no dependencies.
4. Deploy. Every push to the connected branch redeploys the Worker automatically going forward.
5. **Add the API key as a secret** (do this once, after the first deploy — secrets are never committed to the repo): on the Worker's page, go to **Settings → Variables and Secrets** → **Add** → name it `ANTHROPIC_API_KEY`, paste your key from [console.anthropic.com](https://console.anthropic.com), mark it **Secret** → **Save**.
6. Copy the deployed Worker's URL (shown on its overview page) and update `WORKER_URL` near the top of the app script in `index.html` to match it.

## Deploying manually instead

You can also skip the Git integration and paste `worker/index.js`'s contents directly into a Worker created via **Create → Create Worker** in the dashboard — same steps 5–6 above apply.

## CORS

The Worker only allows requests from `https://solmasta.github.io` (set at the top of `worker/index.js` as `ALLOWED_ORIGIN`). Update that value if the app is ever deployed under a different origin.

## Abuse protection

Since `WORKER_URL` is public (it's right there in `index.html`'s source), anything reachable through it is reachable by anyone who reads the page source, not just this app. The Worker rejects requests whose `Origin` header doesn't match `ALLOWED_ORIGIN` (this stops browser-based abuse from other sites, since browsers don't let JS forge that header — though it can't stop a non-browser client that sets its own headers), and it hard-caps the blast radius of any request that does get through: only the two models `index.html` actually uses are allowed, `max_tokens` is clamped to what the app ever sends, and oversized payloads are rejected before they reach Anthropic. None of this is real authentication — there's no login and no server-side secret the client can present, so a determined attacker who finds the URL can still make requests at the capped cost. If usage/cost ever becomes a problem, add a Cloudflare Rate Limiting binding (per-IP) to `wrangler.jsonc`.
