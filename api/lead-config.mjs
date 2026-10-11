/* Public capability probe: returns no secrets or personal data.
 * Feature stays off until the site owner has approved the data-flow and recipient.
 */
function configured() {
  const e = process.env;
  const url = String(e.LEAD_DELIVERY_URL || '');
  let validUrl = false;
  try {
    const u = new URL(url);
    validUrl = u.protocol === 'https:' && !!u.hostname &&
      !u.username && !u.password && !u.hash &&
      u.hostname !== 'localhost' &&
      !/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
  } catch {}
  return e.DIRECT_LEADS_ENABLED === 'true' &&
    e.DIRECT_LEADS_LEGAL_APPROVED === 'true' &&
    validUrl &&
    !!e.LEAD_DELIVERY_SECRET &&
    !!e.LEAD_RECIPIENT_ID &&
    /^https:\/\/[^/]+$/.test(e.LEAD_ALLOWED_ORIGIN || '') &&
    !!e.LEAD_TURNSTILE_SITE_KEY &&
    !!e.LEAD_TURNSTILE_SECRET;
}

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Vary': 'Origin'
};

export function GET() {
  const enabled = configured();
  return new Response(JSON.stringify({
    enabled,
    ...(enabled ? { siteKey: process.env.LEAD_TURNSTILE_SITE_KEY } : {})
  }), { status: 200, headers });
}

export { configured, headers };
