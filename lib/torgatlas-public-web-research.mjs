/* Public Web Research vertical-slice contract. No credentials, cookies, private
 * networks or document downloads. Adapters stay disabled until source verification. */
export const RESEARCH_BUDGET = Object.freeze({ maxLots: 10, maxPages: 12, maxRedirects: 2, maxHtmlBytes: 750_000, timeoutMs: 12_000, cacheTtlMs: 300_000, concurrentBrowsers: 1, llmCalls: 0, llmTokens: 0 });
export const SOURCE_REGISTRY = Object.freeze([
  { id:'efrsb', host:'bankrot.fedresurs.ru', priority:1, status:'UNVERIFIED_PUBLIC_INTERFACE', mode:'html_or_browser' },
  { id:'gis-torgi', host:'torgi.gov.ru', priority:1, status:'UNVERIFIED_PUBLIC_INTERFACE', mode:'html_or_browser' },
  { id:'mets', host:'m-ets.ru', priority:2, status:'UNVERIFIED_PUBLIC_INTERFACE', mode:'html_or_browser' },
  { id:'rad', host:'lot-online.ru', priority:2, status:'UNVERIFIED_PUBLIC_INTERFACE', mode:'html_or_browser' }
]);
const privateHost = /^(localhost|.*\.local|.*\.internal)$/i;
export function allowedPublicUrl(raw) { try { const u=new URL(raw); if(u.protocol!=='https:'||u.username||u.password||privateHost.test(u.hostname)) return null; return SOURCE_REGISTRY.some(s=>u.hostname===s.host||u.hostname.endsWith('.'+s.host)) ? u.href : null; } catch { return null; } }
export function normalizeQuery(query) { return String(query||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU').slice(0,400); }
export function emptyResearch(query, reason='NO_VERIFIED_SOURCE_ADAPTER') { return { ok:true, lots:[], status:'PARTIAL_NO_VERIFIED_SOURCE', normalized_query:normalizeQuery(query), retrieved_at:new Date().toISOString(), cost:{http_requests:0,opened_pages:0,elapsed_ms:0,llm_calls:0,llm_tokens:0}, reason }; }
const cache=new Map(), rate=new Map();
export function parseGisLot(row, checkedAt=new Date().toISOString()) {
  if(!row||typeof row.id!=='string'||!row.lotName)return null;
  return {source:'gis-torgi',source_lot_id:row.id,procedure_id:row.noticeNumber||null,lot_number:row.lotNumber??null,title:String(row.lotName).trim().slice(0,240),category:row.category?.name||null,region:row.subjectRFCode||null,price_rub:Number.isFinite(row.priceMin)?row.priceMin:null,status:row.lotStatus||'UNKNOWN',deadline:row.biddEndTime||null,url:`https://torgi.gov.ru/new/public/lots/lot/${encodeURIComponent(row.id)}`,etp_url:null,checked_at:checkedAt,provenance:{title:'listing.lotName',price:'listing.priceMin',deadline:'listing.biddEndTime',status:'listing.lotStatus'}};
}
export async function gisMiniSearch(query,{fetcher=fetch,now=Date.now}={}) {
 const key=normalizeQuery(query), hit=cache.get(key); if(hit&&now()-hit.at<RESEARCH_BUDGET.cacheTtlMs)return {...hit.value,cost:{...hit.value.cost,cache_hit:true}};
 const last=rate.get(key)||0;if(now()-last<1000)return emptyResearch(query,'RATE_LIMITED');rate.set(key,now());
 const started=now(),url='https://torgi.gov.ru/new/api/public/lotcards/search?page=0&size=10&sort=firstVersionPublicationDate,desc';
 try{const c=new AbortController(),t=setTimeout(()=>c.abort(),RESEARCH_BUDGET.timeoutMs);const r=await fetcher(url,{headers:{Accept:'application/json'},redirect:'error',signal:c.signal});clearTimeout(t);if(!r.ok)return emptyResearch(query,'SOURCE_BLOCKED');const text=await r.text();if(text.length>RESEARCH_BUDGET.maxHtmlBytes)return emptyResearch(query,'SOURCE_TOO_LARGE');const data=JSON.parse(text), lots=(data.content||[]).map(x=>parseGisLot(x)).filter(Boolean).filter(x=>x.title.toLowerCase().includes(key.split(' ')[0]||'' )).slice(0,10);const value={ok:true,lots,status:lots.length?'PRELIMINARY_UNVERIFIED':'NO_VERIFIED_RESULTS',normalized_query:key,retrieved_at:new Date().toISOString(),cost:{http_requests:1,opened_pages:1,elapsed_ms:now()-started,llm_calls:0,llm_tokens:0}};cache.set(key,{at:now(),value});return value;}catch(e){return emptyResearch(query,e?.name==='AbortError'?'TIMEOUT':'SOURCE_BLOCKED');}
}
