import { configured, headers } from './lead-config.mjs';

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJsonBounded(req, limit = 12288) {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('TOO_LARGE');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('BAD_BODY');
  let size = 0;
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('TOO_LARGE');
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes));
  } catch (err) {
    if (err.message === 'TOO_LARGE') throw err;
    throw new Error('BAD_JSON');
  }
}

async function captchaValid(token) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 2048) return false;
  const requestBody = new URLSearchParams({
    secret:process.env.LEAD_TURNSTILE_SECRET, response:token
  });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:'POST', body:requestBody,
    signal:AbortSignal.timeout(6000)
  });
  if (!response.ok) return false;
  const result = await response.json();
  // Recheck destination, not just token validity.
  const expectedHostname = new URL(process.env.LEAD_ALLOWED_ORIGIN).hostname;
  return result.success === true && result.hostname === expectedHostname;
}

function validInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.website) return null; // honeypot
  if (body.consent !== true || body.privacyVersion !== '2026-10-11') return null;
  if (!['lot', 'search'].includes(body.kind)) return null;
  if (typeof body.contact !== 'string' || typeof body.message !== 'string') return null;
  const contact = body.contact.trim();
  const message = body.message.trim();
  if (contact.length < 5 || contact.length > 180 ||
      message.length < 40 || message.length > 6000 ||
      /[\u0000-\u001f]/.test(contact) ||
      /[\u0000\u0008\u000b\u000c]/.test(message)) return null;
  if (typeof body.turnstileToken !== 'string') return null;
  return { kind:body.kind, contact, message, turnstileToken:body.turnstileToken };
}

export async function POST(request) {
  // Critical: no body is read and no external call occurs when the gate is off.
  if (!configured()) return json(503, { ok:false, code:'NOT_CONFIGURED' });
  if (request.headers.get('origin') !== process.env.LEAD_ALLOWED_ORIGIN) {
    return json(403, { ok:false, code:'ORIGIN_REJECTED' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    return json(415, { ok:false, code:'INVALID_TYPE' });
  }
  let body;
  try { body = await readJsonBounded(request); }
  catch (err) { return json(err.message === 'TOO_LARGE' ? 413 : 400, {ok:false, code:err.message}); }
  const input = validInput(body);
  if (!input) return json(422, { ok:false, code:'INVALID_INPUT' });

  try {
    const captchaOk = await captchaValid(input.turnstileToken);
    if (!captchaOk) return json(403, { ok:false, code:'ANTISPAM_REJECTED' });
  } catch {
    return json(503, { ok:false, code:'ANTISPAM_UNAVAILABLE' });
  }

  // No database, cookies or request-body logging. Delivery adapter is configured
  // only after confirming a lawful, owner-controlled recipient/location.
  // Never return success if the receiver has not explicitly accepted the lead.
  try {
    const receipt = crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    let result;
    try {
      result = await fetch(process.env.LEAD_DELIVERY_URL, {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer ' + process.env.LEAD_DELIVERY_SECRET
        },
        body:JSON.stringify({
          id:receipt, recipient:process.env.LEAD_RECIPIENT_ID,
          type:input.kind, contact:input.contact, message:input.message,
          consentVersion:'2026-10-11', receivedAt:new Date().toISOString()
        }),
        signal:controller.signal,
        redirect:'error'
      });
    } finally { clearTimeout(timeout); }
    if (!result?.ok) return json(502, {ok:false, code:'DELIVERY_UNCONFIRMED'});
    const confirmation = await result.json().catch(() => null);
    if (confirmation?.accepted !== true || confirmation?.id !== receipt) {
      return json(502, {ok:false, code:'DELIVERY_UNCONFIRMED'});
    }
    return json(200, {ok:true, code:'ACCEPTED', receipt});
  } catch {
    return json(502, {ok:false, code:'DELIVERY_UNAVAILABLE'});
  }
}

export function GET() { return json(405, {ok:false, code:'METHOD_NOT_ALLOWED'}); }
