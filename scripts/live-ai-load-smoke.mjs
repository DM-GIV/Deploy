#!/usr/bin/env node
import { createAiSearchServer } from '../services/ai-search/server.mjs';

process.env.AI_LOT_SEARCH_ENABLED = 'true';
process.env.AI_LOT_SECURITY_APPROVED = 'true';
process.env.AI_LOT_LEGAL_APPROVED = 'true';
const server = createAiSearchServer({ trustProxy: true });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}/api/ai-lot-search`;
const started = Date.now();
try {
  const responses = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Origin: 'https://torgatlas.ru', 'Content-Type': 'application/json', 'X-Real-IP': `203.0.113.${30 + index}` },
      body: JSON.stringify({ query: `Найди транспорт на торгах запрос ${index}` })
    });
    const body = await response.json();
    return { http_status: response.status, engine_status: body.status, reason: body.reason || null, lots: body.lots?.length || 0 };
  }));
  const report = { concurrent_requests: 4, elapsed_ms: Date.now() - started, responses };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const successful = responses.filter(row => row.engine_status === 'LIVE_VERIFIED_SOURCE_DATA').length;
  const busy = responses.filter(row => row.reason === 'BUSY').length;
  if (successful < 1 || successful > 2 || busy < 2 || responses.some(row => row.http_status !== 200)) process.exitCode = 2;
} finally {
  await new Promise(resolve => server.close(resolve));
}
