import { normalizeQuery, publicResearchMiniSearch, SOURCE_REGISTRY } from '../lib/torgatlas-public-web-research.mjs';
export const maxDuration=15;
const categories=new Set(['all','bankruptcy','government','commercial']);
const enabled=()=>process.env.AI_LOT_SEARCH_ENABLED==='true'&&process.env.AI_LOT_SECURITY_APPROVED==='true'&&process.env.AI_LOT_LEGAL_APPROVED==='true';
function send(res,code,data){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(code).json(data);}
export default async function handler(req,res){
 if(req.method==='GET')return send(res,200,{enabled:enabled(),max_results:10,mode:'PUBLIC_WEB_RESEARCH_MINI',sources:SOURCE_REGISTRY.map(({id,status})=>({id,status}))});
 if(req.method!=='POST')return send(res,405,{ok:false,code:'METHOD_NOT_ALLOWED'});
 if(!enabled())return send(res,503,{ok:false,code:'NOT_ENABLED'});
 if(req.headers.origin!=='https://torgatlas.ru')return send(res,403,{ok:false,code:'ORIGIN_DENIED'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{ok:false,code:'BAD_CONTENT_TYPE'});
 const body=req.body||{},query=normalizeQuery(body.query);
 if(JSON.stringify(body).length>1400)return send(res,413,{ok:false,code:'INVALID_BODY'});
 if(query.length<12||query.length>400||!categories.has(body.source)||![5,10].includes(body.limit))return send(res,422,{ok:false,code:'INVALID_QUERY'});
 const clientKey=String(req.clientIp||req.socket?.remoteAddress||'unknown').slice(0,80);
 return send(res,200,await publicResearchMiniSearch(query,{source:body.source,limit:body.limit,rateKey:clientKey}));
}
