# AI proxy Worker

This folder + `wrangler.toml` at the repo root define the Cloudflare Worker that proxies AI requests (Insights, Advisor chat, receipt scanning) from `index.html` to the Anthropic API, keeping the API key server-side.

## Deploying via Cloudflare's Git integration (recommended)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Import a repository** (or **Connect to Git**).
2. Authorize Cloudflare's GitHub connection and select this repository.
3. Cloudflare detects `wrangler.toml` at the repo root and configures the build automatically — no build command needed, since this Worker has no dependencies.
4. Deploy. Every push to the connected branch redeploys the Worker automatically going forward.
5. **Add the API key as a secret** (do this once, after the first deploy — secrets are never committed to the repo): on the Worker's page, go to **Settings → Variables and Secrets** → **Add** → name it `ANTHROPIC_API_KEY`, paste your key from [console.anthropic.com](https://console.anthropic.com), mark it **Secret** → **Save**.
6. Copy the deployed Worker's URL (shown on its overview page) and update `WORKER_URL` near the top of the app script in `index.html` to match it.

## Deploying manually instead

You can also skip the Git integration and paste `worker/index.js`'s contents directly into a Worker created via **Create → Create Worker** in the dashboard — same steps 5–6 above apply.

## CORS

The Worker only allows requests from `https://solmasta.github.io` (set at the top of `worker/index.js` as `ALLOWED_ORIGIN`). Update that value if the app is ever deployed under a different origin.
