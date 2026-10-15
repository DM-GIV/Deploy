#!/usr/bin/env node
/** Read-only live gate for the public research engine. Never writes source responses. */
import { publicResearchMiniSearch } from '../lib/torgatlas-public-web-research.mjs';

const queries = [
  'Найди транспорт на торгах',
  'Найди оборудование на открытых торгах',
  'Найди недвижимость на публичном предложении'
];

const evidence = [];
for (const query of queries) {
  const started = Date.now();
  const result = await publicResearchMiniSearch(query, {
    cacheEnabled: false,
    rateKey: `live-gate-${started}-${evidence.length}`,
    limit: 10
  });
  evidence.push({
    query,
    elapsed_ms: Date.now() - started,
    status: result.status,
    coverage: result.coverage,
    source_attempts: result.source_attempts || [],
    cost: result.cost,
    lots: result.lots.map(lot => ({
      source: lot.source,
      source_lot_id: lot.source_lot_id,
      title: lot.title,
      category: lot.category,
      region_code: lot.region_code,
      procedure_type: lot.procedure_type,
      price_rub: lot.price_rub,
      price_meaning: lot.price_meaning,
      source_status: lot.source_status,
      application_deadline: lot.application_deadline,
      accepting_applications: lot.accepting_applications,
      checked_at: lot.checked_at,
      url: lot.url
    }))
  });
}

process.stdout.write(`${JSON.stringify({ observed_at: new Date().toISOString(), evidence }, null, 2)}\n`);
