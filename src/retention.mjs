import { positiveInt } from './config.mjs';
import { reject } from './control.mjs';

export const isExpired = (record, now) => record.expires_at !== null && record.expires_at <= now;
export const isExhausted = record => record.max_downloads !== null && record.downloads >= record.max_downloads;

export function deadline(value, now, maxTTL) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw reject(400, 'invalid_expiry');
  const time = Date.parse(value);
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== canonical || time <= now || time > now + maxTTL * 1000) throw reject(400, 'invalid_expiry');
  return time;
}

export function uploadRetention(headers, settings, now) {
  const keep = headers['x-keep'], expires = headers['x-expires-at'];
  if (keep !== undefined || expires !== undefined) {
    if ((keep !== undefined && keep !== '1') || (keep !== undefined && expires !== undefined) ||
        headers['x-ttl-seconds'] !== undefined || headers['x-max-downloads'] !== undefined) throw reject(400, 'conflicting_retention');
    if (!settings.allowRetention) throw reject(403, 'retention_disabled');
    return { expires_at: keep === '1' ? null : deadline(expires, now, settings.maxTTL), max_downloads: null };
  }
  try {
    return { ttl: positiveInt(headers['x-ttl-seconds'], Math.min(3600, settings.maxTTL), settings.maxTTL),
      max_downloads: positiveInt(headers['x-max-downloads'], Math.min(3, settings.maxDownloads), settings.maxDownloads) };
  } catch { throw reject(400, 'invalid_limits'); }
}
