// The web app's deployed origin, plus the fixed local origin the desktop (Electron) build
// serves itself on — see desktop/main.js, which binds to the 127.0.0.1 literal (not
// "localhost"; browsers treat them as distinct origins, so both are listed here to be safe).
// Anything else is rejected below.
const ALLOWED_ORIGINS = new Set([
  "https://solmasta.github.io",
  "http://127.0.0.1:51248",
  "http://localhost:51248",
]);
// The models and cost ceiling actually used by index.html — anything outside this is rejected
// so a request that reaches this Worker (with or without a browser) can't run up unbounded
// Anthropic spend on the owner's key.
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-haiku-4-5"]);
const MAX_TOKENS_CEILING = 1500;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // generous headroom for base64 receipt photos

// SimpleFIN caps a single accounts request to 90 days of transaction history.
const SIMPLEFIN_LOOKBACK_DAYS = 60;
const SIMPLEFIN_KV_KEY = "simplefin";

// Cross-device sync: the sync key itself is the KV lookup key, so it doubles as the bearer
// credential — anyone who has it can read/write this budget's data. It's a client-generated
// crypto.randomUUID(), never a user-chosen low-entropy code, so treating it this way is safe.
const SYNC_KEY_MAX_LEN = 128;

// Content-Length is client-supplied and can be omitted or lied about (chunked transfer, a
// non-browser caller with no header at all), so it can't be trusted as the size cap on its own.
// Read the stream ourselves and bail out as soon as it exceeds the limit, before ever handing
// the (potentially huge) body to JSON.parse or forwarding it to Anthropic.
async function readBodyCapped(request, maxBytes) {
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

// Splits an "https://user:pass@host/path" Access URL into a bare fetchable URL plus a
// Basic Auth header. Not relying on fetch() to honor userinfo embedded in a URL, since
// that's inconsistent across runtimes (browsers reject it outright) — this is explicit
// and portable.
function splitAccessUrl(accessUrl) {
  const u = new URL(accessUrl);
  const auth = "Basic " + btoa(decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password));
  u.username = "";
  u.password = "";
  return { url: u.toString(), auth };
}

async function handleSimplefinConnect(request, env, headers) {
  let body;
  try {
    body = JSON.parse(await readBodyCapped(request, 16 * 1024) || "");
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const setupToken = body && typeof body.setupToken === "string" ? body.setupToken.trim() : "";
  if (!setupToken) {
    return new Response(JSON.stringify({ error: "Missing setup token" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  let claimUrl;
  try {
    claimUrl = atob(setupToken);
    if (!/^https:\/\//.test(claimUrl)) throw new Error("bad token");
  } catch (e) {
    return new Response(JSON.stringify({ error: "That doesn't look like a valid setup token" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  let claimRes;
  try {
    claimRes = await fetch(claimUrl, { method: "POST" });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Couldn't reach SimpleFIN to claim that token" }), { status: 502, headers: { ...headers, "Content-Type": "application/json" } });
  }
  if (!claimRes.ok) {
    return new Response(JSON.stringify({ error: "SimpleFIN rejected that setup token (it may already be used, or expired)" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const accessUrl = (await claimRes.text()).trim();
  if (!/^https:\/\/.+:.+@.+/.test(accessUrl)) {
    return new Response(JSON.stringify({ error: "Unexpected response from SimpleFIN" }), { status: 502, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const secret = crypto.randomUUID();
  await env.SIMPLEFIN_KV.put(SIMPLEFIN_KV_KEY, JSON.stringify({ accessUrl, secret, connectedAt: new Date().toISOString() }));
  return new Response(JSON.stringify({ ok: true, secret }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}

async function handleSimplefinDisconnect(request, env, headers) {
  const secret = request.headers.get("X-SimpleFIN-Secret") || "";
  const stored = await env.SIMPLEFIN_KV.get(SIMPLEFIN_KV_KEY, "json");
  if (stored && secret && stored.secret === secret) {
    await env.SIMPLEFIN_KV.delete(SIMPLEFIN_KV_KEY);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}

async function handleSimplefinSync(request, env, headers) {
  const secret = request.headers.get("X-SimpleFIN-Secret") || "";
  const stored = await env.SIMPLEFIN_KV.get(SIMPLEFIN_KV_KEY, "json");
  if (!stored) {
    return new Response(JSON.stringify({ error: "Not connected" }), { status: 404, headers: { ...headers, "Content-Type": "application/json" } });
  }
  if (!secret || secret !== stored.secret) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const { url, auth } = splitAccessUrl(stored.accessUrl);
  const startDate = Math.floor(Date.now() / 1000) - SIMPLEFIN_LOOKBACK_DAYS * 24 * 60 * 60;
  let sfinRes;
  try {
    sfinRes = await fetch(`${url}/accounts?pending=1&start-date=${startDate}`, { headers: { Authorization: auth } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Couldn't reach SimpleFIN" }), { status: 502, headers: { ...headers, "Content-Type": "application/json" } });
  }
  if (!sfinRes.ok) {
    return new Response(JSON.stringify({ error: "SimpleFIN returned an error (" + sfinRes.status + ") — the connection may need to be redone" }), { status: 502, headers: { ...headers, "Content-Type": "application/json" } });
  }
  let data;
  try {
    data = await sfinRes.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Unexpected response from SimpleFIN" }), { status: 502, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const accounts = (data.accounts || []).map((a) => ({
    id: a.id,
    name: a.name,
    balance: parseFloat(a.balance) || 0,
    balanceDate: a["balance-date"] || null,
    org: a.org && a.org.name ? a.org.name : "",
    transactions: (a.transactions || []).map((t) => ({
      id: t.id,
      date: t.posted || t.transacted_at || null,
      amount: parseFloat(t.amount) || 0,
      description: t.description || "",
      pending: !!t.pending,
    })),
  }));
  return new Response(JSON.stringify({ ok: true, accounts, syncedAt: new Date().toISOString() }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}

function syncKeyFrom(request) {
  const key = request.headers.get("X-Sync-Key") || "";
  return key && key.length <= SYNC_KEY_MAX_LEN ? key : "";
}

async function handleSyncPush(request, env, headers) {
  const key = syncKeyFrom(request);
  if (!key) {
    return new Response(JSON.stringify({ error: "Missing or invalid sync key" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const raw = await readBodyCapped(request, MAX_BODY_BYTES);
  if (raw === null) {
    return new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: { ...headers, "Content-Type": "application/json" } });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  if (!body || typeof body !== "object" || !body.data) {
    return new Response(JSON.stringify({ error: "Missing data" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const updatedAt = Date.now();
  await env.SYNC_KV.put("sync:" + key, JSON.stringify({ data: body.data, updatedAt }));
  return new Response(JSON.stringify({ ok: true, updatedAt }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}

async function handleSyncPull(request, env, headers) {
  const key = syncKeyFrom(request);
  if (!key) {
    return new Response(JSON.stringify({ error: "Missing or invalid sync key" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const stored = await env.SYNC_KV.get("sync:" + key, "json");
  if (!stored) {
    return new Response(JSON.stringify({ error: "Nothing synced yet under this code" }), { status: 404, headers: { ...headers, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, data: stored.data, updatedAt: stored.updatedAt }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}

export default {
  async fetch(request, env) {
    // Echo back the request's Origin only if it's one we allow, so the preflight response
    // (and every response after it) carries an Access-Control-Allow-Origin the browser will
    // actually accept for that request. A disallowed origin still gets a response (so error
    // bodies are readable during debugging) but with no matching ACAO, so the browser blocks it.
    const origin = request.headers.get("Origin");
    const headers = {
      "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://solmasta.github.io",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-SimpleFIN-Secret, X-Sync-Key",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // CORS headers only stop browsers from reading the response, not from sending the request,
    // so this is the actual server-side gate. It can't stop a non-browser client that forges an
    // Origin header, but it does block the far more common case of this URL being hit from
    // another website or script running in a browser.
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response(JSON.stringify({ error: "Forbidden origin" }), {
        status: 403,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const pathname = new URL(request.url).pathname;
    if (pathname === "/simplefin/connect") return handleSimplefinConnect(request, env, headers);
    if (pathname === "/simplefin/sync") return handleSimplefinSync(request, env, headers);
    if (pathname === "/simplefin/disconnect") return handleSimplefinDisconnect(request, env, headers);
    if (pathname === "/sync/push") return handleSyncPush(request, env, headers);
    if (pathname === "/sync/pull") return handleSyncPull(request, env, headers);

    const raw = await readBodyCapped(request, MAX_BODY_BYTES);
    if (raw === null) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_MODELS.has(body.model)) {
      return new Response(JSON.stringify({ error: "Unsupported model" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    if (typeof body.max_tokens !== "number" || body.max_tokens <= 0 || body.max_tokens > MAX_TOKENS_CEILING) {
      body = { ...body, max_tokens: MAX_TOKENS_CEILING };
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const text = await anthropicRes.text();
    return new Response(text, {
      status: anthropicRes.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  },
};
