// server.js — Travel Planning Pro proxy server for Render.com
// Serves the app and proxies AI API calls so keys stay server-side.

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper: forward a request to an upstream API ──────────────────────
async function proxy(res, url, headers, body) {
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Upstream error', detail: err.message });
  }
}

// ── Anthropic / Claude ────────────────────────────────────────────────
app.post('/api/anthropic', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
  const body = { ...req.body };
  delete body.api_key;
  body.max_tokens = Math.min(body.max_tokens || 8000, 16000);
  await proxy(res,
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body
  );
});

// ── Gemini ────────────────────────────────────────────────────────────
app.post('/api/gemini', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY not set on server' });
  const body = { ...req.body };
  const model = body.model || 'gemini-2.5-flash';
  delete body.model;
  delete body.api_key;
  await proxy(res,
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {},
    body
  );
});

// ── OpenAI / DeepSeek / Groq ──────────────────────────────────────────
app.post('/api/openai', async (req, res) => {
  const body = { ...req.body };
  const model = body.model || '';
  delete body.api_key;
  body.max_tokens = Math.min(body.max_tokens || 8000, 16000);

  let key, baseUrl;
  if (model.startsWith('deepseek')) {
    key = process.env.DEEPSEEK_API_KEY;
    baseUrl = 'https://api.deepseek.com/v1/chat/completions';
  } else if (model.startsWith('llama') || model.startsWith('mixtral') || model.startsWith('gemma')) {
    key = process.env.GROQ_API_KEY;
    baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
  } else {
    key = process.env.OPENAI_API_KEY;
    baseUrl = 'https://api.openai.com/v1/chat/completions';
  }

  if (!key) return res.status(500).json({ error: `API key for "${model}" not set on server` });
  await proxy(res, baseUrl, { 'Authorization': `Bearer ${key}` }, body);
});

// ── Catch-all: serve index.html for any unknown route ─────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Travel Planning Pro running on port ${PORT}`));

// Node's default keepAliveTimeout is only 5s — shorter than the idle-
// connection timeout Render's own front-end proxy uses for its pooled
// connections to this app. When a connection sits idle for longer than
// Node's 5s but less than the proxy's own timeout, Node silently closes it
// while the proxy still considers it reusable; the next request the proxy
// sends over that connection lands on a half-dead socket and gets no HTTP
// response at all — surfacing to the browser as a bare "Failed to fetch" /
// net::ERR_CONNECTION_CLOSED with no status code, intermittently, under
// completely normal traffic. Reproduced directly: rapid back-to-back
// requests failed about 1 in 4 times with exactly this signature.
// Raising Node's timeout comfortably above the proxy's removes the race.
// (headersTimeout must exceed keepAliveTimeout or Node throws at startup.)
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
