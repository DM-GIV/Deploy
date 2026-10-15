#!/usr/bin/env node
import { createAiSearchServer } from '../services/ai-search/server.mjs';

process.env.AI_LOT_SEARCH_ENABLED = 'true';
process.env.AI_LOT_SECURITY_APPROVED = 'true';
process.env.AI_LOT_LEGAL_APPROVED = 'true';

const server = createAiSearchServer({ trustProxy: true });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const started = Date.now();
try {
  const response = await fetch(`${base}/api/ai-lot-search`, {
    method: 'POST',
    headers: { Origin: 'https://torgatlas.ru', 'Content-Type': 'application/json', 'X-Real-IP': '203.0.113.20' },
    body: JSON.stringify({ query: 'Найди транспорт на торгах' })
  });
  const payload = await response.json();
  const safe = {
    http_status: response.status,
    elapsed_ms: Date.now() - started,
    engine_status: payload.status,
    coverage: payload.coverage,
    count: payload.lots?.length || 0,
    lots: (payload.lots || []).map(lot => ({
      source: lot.source, source_lot_id: lot.source_lot_id, title: lot.title,
      source_status: lot.source_status, application_deadline: lot.application_deadline,
      accepting_applications: lot.accepting_applications, url: lot.url
    }))
  };
  process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
  if (response.status !== 200 || safe.count < 1 || safe.lots.some(lot => lot.accepting_applications !== 'CONFIRMED_BY_SOURCE_STATUS_AND_DATE')) process.exitCode = 2;
} finally {
  await new Promise(resolve => server.close(resolve));
}
