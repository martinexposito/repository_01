import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { getAvailability } from './availability-provider.js';

loadDotEnv();

const port = Number(process.env.PORT || 8787);
const staticHtmlPath = process.env.STATIC_HTML_PATH
  ? resolve(process.env.STATIC_HTML_PATH)
  : '/Users/martinexposito/Downloads/ev-charger_mtin.html';

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/availability') {
      const body = await readJson(req);
      const availability = await getAvailability({
        center: body.center,
        radiusKm: body.radiusKm,
        stations: Array.isArray(body.stations) ? body.stations : []
      });
      return sendJson(res, 200, { availability });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(staticHtmlPath, 'utf8');
      return sendHtml(res, injectAvailabilityConfig(html));
    }

    return sendText(res, 404, 'Not found');
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`CargaYa backend listening on http://localhost:${port}`);
  console.log(`Serving HTML from ${staticHtmlPath}`);
});

function injectAvailabilityConfig(html) {
  const script = `<script data-cargaya-config>window.CARGAYA_AVAILABILITY_PROVIDER_URL='/api/availability';</script>`;
  return html.includes('data-cargaya-config')
    ? html
    : html.replace('</head>', `${script}\n</head>`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders()
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': contentType('.html'),
    'Cache-Control': 'no-store',
    ...corsHeaders()
  });
  res.end(html);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders()
  });
  res.end(text);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };
}

function contentType(filePath) {
  const ext = extname(filePath);
  if (ext === '.html') return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function loadDotEnv() {
  try {
    const envPath = resolve('.env');
    const data = readEnv(envPath);
    if (!data) return;
    data.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    });
  } catch {}
}

function readEnv(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
