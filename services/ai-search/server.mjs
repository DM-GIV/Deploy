import http from 'node:http';
import { pathToFileURL } from 'node:url';
import handler from '../../api/ai-lot-search.mjs';

const MAX_BODY_BYTES = 4_096;
const REQUEST_TIMEOUT_MS = 60_000;

function validForwardedIp(value) {
  const candidate = String(value || '').split(',')[0].trim();
  return /^[0-9a-f:.]{2,64}$/i.test(candidate) ? candidate : null;
}

function responseAdapter(response) {
  return {
    setHeader(name, value) { response.setHeader(name, value); },
    status(code) { response.statusCode = code; return this; },
    json(value) {
      if (!response.headersSent) response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(value));
      return value;
    }
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('BODY_TOO_LARGE');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('INVALID_JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

export function createAiSearchServer({ trustProxy = process.env.AI_LOT_TRUST_PROXY === 'true' } = {}) {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.url === '/health' && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, feature_enabled: process.env.AI_LOT_SEARCH_ENABLED === 'true' }));
      return;
    }
    const target = new URL(request.url || '/', 'http://internal');
    request.query = Object.fromEntries([...target.searchParams].slice(0, 4));
    if (target.pathname !== '/api/ai-lot-search') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    request.clientIp = trustProxy ? validForwardedIp(request.headers['x-real-ip']) || request.socket.remoteAddress : request.socket.remoteAddress;
    try {
      request.body = request.method === 'POST' ? await readJson(request) : {};
      await handler(request, responseAdapter(response));
    } catch (error) {
      if (response.writableEnded) return;
      response.statusCode = error?.code === 'BODY_TOO_LARGE' ? 413 : error?.code === 'INVALID_JSON' ? 400 : 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: false, code: error?.code || 'INTERNAL_ERROR' }));
    }
  }).setTimeout(REQUEST_TIMEOUT_MS);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  const server = createAiSearchServer();
  server.listen(port, host, () => process.stdout.write(`torgatlas-ai-search listening on ${host}:${port}\n`));
}
