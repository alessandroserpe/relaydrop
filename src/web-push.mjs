import { createECDH, ECDH } from 'node:crypto';
import webpush from 'web-push';

export const PUSH_BODY = 'Un nuovo file è disponibile nella tua casella privata.';

// Browser-supplied endpoints are untrusted: never turn enrollment into an SSRF proxy.
export function validateSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 4096) throw new Error('Invalid push subscription');
  const url = new URL(value.endpoint);
  const allowed = /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname) ||
    ['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname);
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname === '/') throw new Error('Invalid push endpoint');
  const { p256dh, auth } = value.keys || {};
  if (!/^[A-Za-z0-9_-]{87}$/.test(p256dh || '') || !/^[A-Za-z0-9_-]{22}$/.test(auth || '')) throw new Error('Invalid push keys');
  const publicKey = Buffer.from(p256dh, 'base64url');
  if (publicKey.length !== 65 || publicKey[0] !== 4 || publicKey.toString('base64url') !== p256dh ||
      Buffer.from(auth, 'base64url').toString('base64url') !== auth) throw new Error('Invalid push keys');
  ECDH.convertKey(publicKey, 'prime256v1'); // Reject invalid curve points before persisting.
  return { endpoint: url.href, keys: { p256dh, auth } };
}

export function createWebPush(keys, subject, send = webpush.sendNotification.bind(webpush)) {
  if (!/^[A-Za-z0-9_-]{87}$/.test(keys?.publicKey || '') || !/^[A-Za-z0-9_-]{43}$/.test(keys?.privateKey || '')) throw new Error('Invalid Web Push configuration');
  const curve = createECDH('prime256v1'); curve.setPrivateKey(Buffer.from(keys.privateKey, 'base64url'));
  if (curve.getPublicKey().toString('base64url') !== keys.publicKey) throw new Error('Web Push key pair does not match');
  const origin = new URL(subject);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.hash || origin.search) throw new Error('Web Push requires an HTTPS subject');
  return {
    publicKey: keys.publicKey,
    async send(subscription) {
      const safe = validateSubscription(subscription);
      // This payload is constant: file identities, names, summaries and capabilities never enter it.
      await send(safe, JSON.stringify({ title: 'RelayDrop', body: PUSH_BODY }), {
        vapidDetails: { subject: origin.origin, ...keys }, contentEncoding: 'aes128gcm',
        TTL: 300, urgency: 'normal', topic: 'relaydrop-inbox', timeout: 5000
      });
    }
  };
}
