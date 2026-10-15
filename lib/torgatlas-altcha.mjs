// Server-side ALTCHA (v1 protocol, SHA-256) for the AI lot search. Same wire format as the lead forms use
// (services/lead-intake/vendor/altcha_v1.py), but a SEPARATE key and a separate replay store: the AI search can
// neither verify nor issue lead-form challenges and the lead forms are not touched.
//   challenge = SHA256(salt + number) hex      salt = random hex + "?expires=<unix>&"
//   signature = HMAC-SHA256(key = ALTCHA key, message = challenge) hex
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const ALTCHA = Object.freeze({
  algorithm: 'SHA-256',
  maxNumber: 100_000,     // proof-of-work ceiling (also enforced on verification)
  ttlSeconds: 300,        // a challenge must be used within 5 minutes
  saltBytes: 16,
  payloadMax: 2048,
  replayCapacity: 4000,
  issueLimitPerMinute: 30
});
const HEX64 = /^[0-9a-f]{64}$/;

export function strongKey(value) {
  return typeof value === 'string' && value.length >= 32 && new Set(value).size >= 10;
}
const sha256Hex = text => createHash('sha256').update(text).digest('hex');
const hmacHex = (key, text) => createHmac('sha256', key).update(text).digest('hex');

export function createChallenge(key, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!strongKey(key)) throw new Error('ALTCHA_KEY_WEAK');
  const salt = `${randomBytes(ALTCHA.saltBytes).toString('hex')}?expires=${nowSeconds + ALTCHA.ttlSeconds}&`;
  const number = randomInt(0, ALTCHA.maxNumber + 1);
  const challenge = sha256Hex(salt + String(number));
  // Field names follow the ALTCHA protocol documentation (maxnumber, lowercase).
  return { algorithm: ALTCHA.algorithm, challenge, maxnumber: ALTCHA.maxNumber, salt, signature: hmacHex(key, challenge) };
}

const safeEqualHex = (a, b) => HEX64.test(a) && HEX64.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

// Cryptographic check only (stateless). Returns { ok, code, challenge?, expires? }.
export function verifyPayload(token, key, { nowSeconds = Math.floor(Date.now() / 1000), notBefore = 0 } = {}) {
  if (typeof token !== 'string' || token.length < 20) return { ok: false, code: 'CAPTCHA_REQUIRED' };
  if (token.length > ALTCHA.payloadMax || !/^[A-Za-z0-9+/]+={0,2}$/.test(token)) return { ok: false, code: 'CAPTCHA_INVALID' };
  let data;
  try { data = JSON.parse(Buffer.from(token, 'base64').toString('utf8')); } catch { return { ok: false, code: 'CAPTCHA_INVALID' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, code: 'CAPTCHA_INVALID' };
  const { algorithm, challenge, number, salt, signature } = data;
  if (algorithm !== ALTCHA.algorithm || !Number.isInteger(number) || number < 0 || number > ALTCHA.maxNumber
      || typeof salt !== 'string' || salt.length < 10 || salt.length > 200 || !salt.endsWith('&')
      || typeof challenge !== 'string' || typeof signature !== 'string') return { ok: false, code: 'CAPTCHA_INVALID' };
  const expires = [...salt.matchAll(/[?&]expires=(\d{1,12})(?=&)/g)];
  if (expires.length !== 1 || (salt.match(/expires=/g) || []).length !== 1) return { ok: false, code: 'CAPTCHA_INVALID' };
  const expiresAt = Number(expires[0][1]);
  // Cryptography first (a forged token is "invalid" whatever its dates say), then the time window.
  const expectedChallenge = sha256Hex(salt + String(number));
  if (!safeEqualHex(expectedChallenge, challenge) || !safeEqualHex(hmacHex(key, expectedChallenge), signature)) return { ok: false, code: 'CAPTCHA_INVALID' };
  if (expiresAt < nowSeconds) return { ok: false, code: 'CAPTCHA_EXPIRED' };
  if (expiresAt > nowSeconds + ALTCHA.ttlSeconds + 5) return { ok: false, code: 'CAPTCHA_INVALID' };
  // A challenge issued before this process started has no replay memory: refuse it (the widget re-issues silently).
  if (expiresAt - ALTCHA.ttlSeconds < notBefore) return { ok: false, code: 'CAPTCHA_EXPIRED' };
  return { ok: true, challenge, expires: expiresAt };
}

// One-time use. consume() is synchronous, so two parallel requests carrying the same token cannot both pass.
export class ReplayStore {
  constructor(capacity = ALTCHA.replayCapacity) { this.capacity = capacity; this.used = new Map(); }
  consume(challenge, expiresAt, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (this.used.size >= this.capacity) {
      for (const [id, exp] of this.used) if (exp < nowSeconds) this.used.delete(id);
      if (this.used.size >= this.capacity) return 'FULL';
    }
    if (this.used.has(challenge)) return 'REPLAY';
    this.used.set(challenge, expiresAt);
    return 'OK';
  }
}

// Per-client challenge issuing budget (the endpoint is cheap but public and unauthenticated).
export class IssueLimiter {
  constructor(limit = ALTCHA.issueLimitPerMinute, capacity = 5000) { this.limit = limit; this.capacity = capacity; this.buckets = new Map(); }
  allow(clientKey, nowMs = Date.now()) {
    const minute = Math.floor(nowMs / 60_000);
    const entry = this.buckets.get(clientKey);
    if (!entry || entry.minute !== minute) {
      if (this.buckets.size >= this.capacity) for (const [k, v] of this.buckets) if (v.minute !== minute) this.buckets.delete(k);
      if (this.buckets.size >= this.capacity) return false;
      this.buckets.set(clientKey, { minute, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }
}
