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
  body.max_tokens = Math.min(body.max_tokens || 4000, 8000);
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
  const model = body.model || 'gemini-2.0-flash';
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
  body.max_tokens = Math.min(body.max_tokens || 4000, 8000);

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
app.listen(PORT, () => console.log(`Travel Planning Pro running on port ${PORT}`));
