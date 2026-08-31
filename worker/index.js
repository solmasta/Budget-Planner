const ALLOWED_ORIGIN = "https://solmasta.github.io";
// The models and cost ceiling actually used by index.html — anything outside this is rejected
// so a request that reaches this Worker (with or without a browser) can't run up unbounded
// Anthropic spend on the owner's key.
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-haiku-4-5"]);
const MAX_TOKENS_CEILING = 1500;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // generous headroom for base64 receipt photos

export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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
    const origin = request.headers.get("Origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response(JSON.stringify({ error: "Forbidden origin" }), {
        status: 403,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let body;
    try {
      body = await request.json();
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
