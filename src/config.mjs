import { readFileSync, statSync } from 'node:fs';

export function readToken(path) {
  if (!path) throw new Error('Set RELAYDROP_TOKEN_FILE to a private token file');
  if ((statSync(path).mode & 0o077) !== 0) throw new Error('Token file must have permissions 600 or 400');
  const token = readFileSync(path, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Token must be 32 random bytes encoded as base64url; use init');
  return token;
}

export function serverURL(value, allowHTTP = false) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowHTTP && local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTPS origin; HTTP is allowed only for explicit localhost development');
  }
  return url.origin;
}

export function positiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error('Invalid numeric setting');
  return number;
}
