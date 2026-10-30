import http from 'node:http';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, readdirSync, writeFileSync,
  renameSync, unlinkSync, existsSync, openSync, closeSync, fsyncSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { hash } from './crypto.mjs';
import { readToken, serverURL, positiveInt } from './config.mjs';
import { createControl, readJSON, readPrivateJSON, HARD_FILE_BYTES } from './control.mjs';
import { notifyRecipient } from './notifications.mjs';
import { createWebPush } from './web-push.mjs';
import { isExpired, isExhausted, deadline, uploadRetention } from './retention.mjs';
import { createRequestLimiter } from './rate-limit.mjs';

const ID = /^[A-Za-z0-9_-]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status, code) => Object.assign(new Error(code), { status });

export function createRelay(options) {
  const config = { dataDir: './data', maxBytes: 1024 * 1024 * 1024, maxTransfers: 1000,
    maxUploads: 4, maxStreams: 8, requestsPerMinute: 120, emergencyRequestsPerMinute: 6000,
    cleanupMs: 60_000, now: Date.now, ...options };
  if (!/^[A-Za-z0-9_-]{43}$/.test(config.uploadToken || '')) throw new Error('Invalid upload token');
  for (const field of ['maxBytes', 'maxTransfers', 'maxUploads', 'maxStreams', 'requestsPerMinute', 'emergencyRequestsPerMinute', 'cleanupMs']) {
    positiveInt(config[field], undefined);
  }
  const origin = serverURL(config.publicURL, config.allowHTTPLocalhost);
  const directory = resolve(config.dataDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if ((statSync(directory).mode & 0o077) !== 0) throw new Error('Data directory must have permissions 700');
  const lockPath = join(directory, '.lock');
  const lock = openSync(lockPath, 'wx', 0o600);
  writeFileSync(lock, String(process.pid)); closeSync(lock);
  let control;
  try { control = createControl(directory, config, origin); } catch (error) { unlinkSync(lockPath); throw error; }
  const records = new Map();
  let reserved = 0, uploading = 0, streaming = 0;
  const pathFor = (id, extension) => join(directory, `${id}.${extension}`);
  const syncDirectory = () => {
    const fd = openSync(directory, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  };
  const remove = (id, reason = 'removed', actor = null) => {
    const record = records.get(id);
    if (record) control.event(reason, record, actor);
    // Delete metadata first; restart treats any remaining blob as an orphan.
    for (const extension of ['json', 'blob']) {
      try { unlinkSync(pathFor(id, extension)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    syncDirectory();
    records.delete(id);
  };
  const persist = record => {
    const temp = pathFor(record.id, 'json.tmp');
    const fd = openSync(temp, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, pathFor(record.id, 'json'));
    syncDirectory();
  };
  const cleanup = () => {
    for (const [id, record] of records) if (isExpired(record, config.now()) || isExhausted(record)) remove(id, isExpired(record, config.now()) ? 'expired' : 'exhausted');
    control.cleanup();
  };
  try {
    for (const name of readdirSync(directory)) {
      if (!/^[A-Za-z0-9_-]{32}\.json$/.test(name)) continue;
      const record = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      if (!ID.test(record.id) || name !== `${record.id}.json` || !HASH.test(record.token_hash) ||
          !Number.isSafeInteger(record.bytes) || record.bytes < 36 || record.bytes > HARD_FILE_BYTES + 4096 ||
          (record.expires_at !== null && (!Number.isSafeInteger(record.expires_at) || record.expires_at <= 0 || record.expires_at > 8640000000000000)) ||
          !Number.isSafeInteger(record.downloads) || record.downloads < 0 ||
          (record.max_downloads !== null && (!Number.isSafeInteger(record.max_downloads) || record.max_downloads < 1 || record.max_downloads > 1000)) ||
          (record.expires_at === null && record.max_downloads !== null)) {
        throw new Error('Invalid storage metadata; inspect data directory');
      }
      if (!existsSync(pathFor(record.id, 'blob'))) { unlinkSync(join(directory, name)); continue; }
      if (statSync(pathFor(record.id, 'blob')).size !== record.bytes) throw new Error('Corrupt stored blob');
      records.set(record.id, record);
    }
    cleanup();
    for (const name of readdirSync(directory)) {
      const match = /^([A-Za-z0-9_-]{32})\.(part|json\.tmp|blob)$/.exec(name);
      if (match && (match[2] !== 'blob' || !records.has(match[1]))) unlinkSync(join(directory, name));
    }
  } catch (error) { unlinkSync(lockPath); throw error; }
  const assets = new Map([
    ['/', ['dashboard.html', 'text/html; charset=utf-8']],
    ['/receiver', ['index.html', 'text/html; charset=utf-8']],
    ['/dashboard', ['dashboard.html', 'text/html; charset=utf-8']],
    ['/dashboard.js', ['dashboard.js', 'text/javascript; charset=utf-8']],
    ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
    ['/vault.js', ['vault.js', 'text/javascript; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/decrypt.js', ['decrypt.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/v1/push/client.js', ['push.js', 'text/javascript; charset=utf-8']],
    ['/v1/browser/files.js', ['files.js', 'text/javascript; charset=utf-8']],
    ['/v1/browser/inbox.js', ['inbox.js', 'text/javascript; charset=utf-8']],
    ['/v1/browser/sync.js', ['sync.js', 'text/javascript; charset=utf-8']],
    ['/v1/browser/decrypt.js', ['decrypt.js', 'text/javascript; charset=utf-8']],
    ['/v1/push/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
    ['/v1/push/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
    ['/v1/push/icon-192.png', ['icon-192.png', 'image/png']],
    ['/v1/push/icon-512.png', ['icon-512.png', 'image/png']]
  ].map(([route, [name, type]]) => [route, { data: readFileSync(join(PUBLIC, name)), type }]));
  const limitRequest = createRequestLimiter(config);
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
  };
  const owner = req => control.requireUser(req);
  const settings = () => control.state.settings;
  const fileLimit = () => Math.min(config.maxUploadBytes || Infinity, settings().maxFileBytes + 4096);
  const sendPush = async (recipientId, senderDeviceIds = []) => {
    const all = control.subscriptionsFor(recipientId);
    const subscriptions = all.filter(s => !senderDeviceIds.includes(s.device_id));
    const excluded = all.length - subscriptions.length;
    const results = await Promise.all(subscriptions.map(async item => {
      try { await config.webPush.send(item.subscription); return 'accepted'; }
      catch (error) {
        if ([404, 410].includes(error.statusCode)) { control.expirePushSubscription(item); return 'expired'; }
        return 'failed';
      }
    }));
    return { accepted: results.filter(r => r === 'accepted').length, failed: results.filter(r => r === 'failed').length, expired: results.filter(r => r === 'expired').length, ...(excluded ? { excluded } : {}) };
  };
  const info = (record, user) => ({ id: record.id, bytes: record.bytes, expires_at: record.expires_at === null ? null : new Date(record.expires_at).toISOString(),
    downloads: record.downloads, max_downloads: record.max_downloads, uploaded_by: record.uploaded_by || 'admin',
    uploader_name: control.principals.find(p => p.id === (record.uploaded_by || 'admin'))?.name || 'Utente rimosso',
    recipient_id: record.recipient_id || null, require_recipient: Boolean(record.require_recipient),
    created_at: record.created_at || null, details: record.details || null,
    sender_device_ids: record.sender_device_ids || [],
    envelopes: (record.envelopes || []).filter(e => user && control.state.devices.some(d => d.id === e.device_id && d.user_id === user.id)),
    notification: record.notification || 'not_requested', notification_deliveries: record.notification_deliveries || null,
    can_manage: user ? control.canManage(user, record) : false });

  let activeHandlers = 0, serverClosed = false;
  const server = http.createServer({ maxHeaderSize: 32768, requestTimeout: 1800_000, headersTimeout: 15_000 }, async (req, res) => {
    activeHandlers++;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (origin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setTimeout(300_000, () => res.destroy());
    try {
      const route = req.url;
      const publicPage = req.method === 'GET' && (route === '/healthz' || assets.has(route) || /^\/d\/[A-Za-z0-9_-]{32}$/.test(route));
      let group = publicPage ? 'public' : 'anonymous', key = req.socket.remoteAddress || 'unknown', authError;
      const rejectedOrigin = (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] === 'cross-site' && route.startsWith('/v1/'));
      if (!publicPage && !rejectedOrigin) {
        let user;
        try { user = control.identity(req); } catch (error) { authError = error; }
        if (user) { group = 'authenticated'; key = 'user:' + user.id; }
        else if (!authError && req.method === 'POST') {
          const downloadId = /^\/v1\/transfers\/([A-Za-z0-9_-]{32})\/(?:download|preview)$/.exec(route)?.[1];
          const record = downloadId && records.get(downloadId);
          const secret = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
          if (record && !record.require_recipient && secret && equal(hash(secret), record.token_hash) &&
              !isExpired(record, config.now()) && !isExhausted(record)) {
            group = 'capability'; key = record.id;
          }
        }
      }
      const retryAfter = limitRequest(group, key);
      if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); throw fail(429, 'rate_limited'); }
      if (rejectedOrigin) throw fail(403, 'origin_rejected');
      if (authError) throw authError;
      if (req.method === 'GET' && route === '/healthz') return json(res, 200, { ok: true });
      if (req.method === 'GET' && (assets.has(route) || /^\/d\/[A-Za-z0-9_-]{32}$/.test(route))) {
        const asset = assets.get(route) || assets.get('/receiver');
        if (route === '/v1/push/sw.js') res.setHeader('Service-Worker-Allowed', '/');
        res.writeHead(200, { 'content-type': asset.type }); return res.end(asset.data);
      }
      if (route === '/v1/session' && req.method === 'POST') return json(res, 200, control.login(req, res));
      if (route === '/v1/session' && req.method === 'DELETE') { control.logout(req, res); return json(res, 200, { logged_out: true }); }
      if (route === '/v1/session' && req.method === 'PATCH') return json(res,200,control.setRemember(req,res,(await readJSON(req))?.remember));
      if (req.method === 'GET' && ['/v1/me','/v1/transfers','/v1/session'].includes(route)) {
        owner(req);
        const session=control.refreshSession(req,res);
        if(route==='/v1/session')return json(res,200,session);
      }
      if (route === '/v1/me' && req.method === 'GET') return json(res, 200, control.publicUser(owner(req)));
      if (route === '/v1/push/config' && req.method === 'GET') {
        const user = owner(req);
        return json(res, 200, { enabled: Boolean(config.webPush), public_key: config.webPush?.publicKey || null,
          devices: control.subscriptionsFor(user.id).map(s => s.device_id) });
      }
      if (route === '/v1/push/subscriptions' && req.method === 'POST') {
        const user = owner(req);
        if (!config.webPush) throw fail(503, 'web_push_not_configured');
        return json(res, 201, control.addPushSubscription(user, await readJSON(req, 8192)));
      }
      const pushMatch = /^\/v1\/push\/subscriptions\/([A-Za-z0-9_-]{16})$/.exec(route);
      if (pushMatch && req.method === 'DELETE') {
        control.removePushSubscription(owner(req), pushMatch[1]); return json(res, 200, { removed: true });
      }
      if (route === '/v1/policy' && req.method === 'GET') return json(res, 200, { maxFileBytes: settings().maxFileBytes, maxTTL: settings().maxTTL, maxDownloads: settings().maxDownloads, allowRetention: settings().allowRetention });
      if (route === '/v1/settings') {
        const user = control.requireAdmin(req);
        if (req.method === 'PATCH') { control.updateSettings(await readJSON(req)); control.event('settings_changed', null, user); }
        else if (req.method !== 'GET') throw fail(405, 'method_not_allowed');
        return json(res, 200, { ...settings(), usedBytes: [...records.values()].reduce((n,r) => n+r.bytes,0), reservedBytes: reserved });
      }
      if (route === '/v1/identities' && req.method === 'GET') {
        const user = owner(req);
        return json(res, 200, control.principals.filter(p => user.role !== 'recipient' || p.id === user.id).map(control.publicUser));
      }
      if (route === '/v1/devices' && req.method === 'GET') {
        const user = owner(req); return json(res, 200, control.state.devices.filter(d => d.user_id === user.id));
      }
      if (route === '/v1/devices' && req.method === 'POST') return json(res, 201, control.addDevice(owner(req), await readJSON(req)));
      const deviceMatch = /^\/v1\/devices\/([A-Za-z0-9_-]{16})$/.exec(route);
      if (deviceMatch && req.method === 'DELETE') { control.removeDevice(owner(req), deviceMatch[1]); return json(res, 200, { removed: true }); }
      const recipientDevices = /^\/v1\/recipient-devices\/([A-Za-z0-9_-]{1,64})$/.exec(route);
      if (recipientDevices && req.method === 'GET') {
        const user = owner(req);
        if (user.role === 'recipient' && recipientDevices[1] !== user.id) throw fail(403, 'own_devices_only');
        if (!control.principals.some(p => p.id === recipientDevices[1])) throw fail(404, 'unknown_recipient');
        return json(res, 200, control.devicesFor(user, recipientDevices[1]));
      }
      if (route === '/v1/events' && req.method === 'GET') {
        const user = owner(req); control.cleanup();
        return json(res, 200, control.state.events.filter(e => control.canSee(user, e)).slice(-500).reverse());
      }
      if (req.method === 'GET' && route === '/v1/transfers') {
        const user = owner(req); cleanup();
        return json(res, 200, [...records.values()].filter(r => control.canSee(user,r)).sort((a,b) => (b.created_at||0)-(a.created_at||0)).map(r => info(r,user)));
      }
      if (req.method === 'POST' && route === '/v1/transfers') {
        const user = owner(req);
        const recipientId = req.headers['x-recipient-id'];
        if (user.role === 'recipient' && (recipientId !== user.id || req.headers['x-require-recipient'] !== '1')) throw fail(403, 'own_inbox_only');
        const recipient = recipientId && control.principals.find(p => p.id === recipientId);
        if (recipientId && !recipient) throw fail(400, 'unknown_recipient');
        const requireRecipient = req.headers['x-require-recipient'] === '1';
        if (requireRecipient && !recipient) throw fail(400, 'recipient_required');
        const notify = req.headers['x-notify'] === '1';
        const senderDeviceIds = req.headers['x-sender-device-ids']?.split(',') || [];
        if (senderDeviceIds.length > 4 || new Set(senderDeviceIds).size !== senderDeviceIds.length || senderDeviceIds.some(id =>
          !/^[A-Za-z0-9_-]{16}$/.test(id) || !control.state.devices.some(d => d.id === id && d.user_id === user.id))) throw fail(403,'own_sender_devices_required');
        const useWebPush = recipient && config.webPush && control.subscriptionsFor(recipient.id).length > 0;
        if (notify && !useWebPush && !recipient?.notify) throw fail(400, 'notifications_not_configured');
        const metadata = control.validateMetadata(req.headers['x-file-metadata'], user, recipientId);

        if (req.headers['content-type'] !== 'application/octet-stream') throw fail(415, 'expected_octet_stream');
        if (!/^\d+$/.test(req.headers['content-length'] || '')) throw fail(411, 'length_required');
        const size = Number(req.headers['content-length']);
        if (!Number.isSafeInteger(size) || size < 36 || size > fileLimit()) throw fail(413, 'size_limit');
        const tokenHash = req.headers['x-download-token-sha256'];
        if (!HASH.test(tokenHash || '')) throw fail(400, 'invalid_download_token_hash');
        const retention = uploadRetention(req.headers, settings(), config.now());
        cleanup();
        const used = [...records.values()].reduce((sum, record) => sum + record.bytes, 0);
        if (uploading >= config.maxUploads) throw fail(503, 'upload_capacity');
        if (records.size + uploading >= settings().maxTransfers || used + reserved + size > settings().maxBytes) throw fail(507, 'storage_limit');
        const id = randomBytes(24).toString('base64url');
        reserved += size; uploading++;
        let received = 0, committed = false, reservationHeld = true;
        try {
          const limit = new Transform({ transform(chunk, _, callback) {
            received += chunk.length;
            callback(received > size ? fail(413, 'size_limit') : null, chunk);
          } });
          await pipeline(req, limit, createWriteStream(pathFor(id, 'part'), { flags: 'wx', mode: 0o600 }));
          if (received !== size) throw fail(400, 'incomplete_upload');
          const fd = openSync(pathFor(id, 'part'), 'r');
          try { fsyncSync(fd); } finally { closeSync(fd); }
          renameSync(pathFor(id, 'part'), pathFor(id, 'blob'));
          const expiresAt = retention.ttl !== undefined ? config.now() + retention.ttl * 1000 : retention.expires_at;
          if (expiresAt !== null && expiresAt <= config.now()) throw fail(400, 'invalid_expiry');
          const record = { id, bytes: size, token_hash: tokenHash, expires_at: expiresAt,
            downloads: 0, max_downloads: retention.max_downloads, uploaded_by: user.id, recipient_id: recipientId || null,
            require_recipient: requireRecipient, created_at: config.now(), sender_device_ids: senderDeviceIds, ...metadata };
          persist(record); records.set(id, record); committed = true;
          reserved -= size; reservationHeld = false;
          control.event('uploaded', record, user);
          if (notify) {
            try {
              if (useWebPush) {
                record.notification_deliveries = await sendPush(recipient.id, senderDeviceIds);
                const delivery = record.notification_deliveries;
                record.notification = delivery.accepted > 0 ? 'accepted' : delivery.excluded && !delivery.failed && !delivery.expired ? 'skipped' : 'failed';
              } else if (senderDeviceIds.length && recipient.id === user.id) {
                // A shared ntfy topic cannot omit one device; don't notify the sender accidentally.
                record.notification = 'skipped';
              } else { await (config.notificationSender || notifyRecipient)(recipient.notify, origin); record.notification = 'accepted'; }
            }
            catch { record.notification = 'failed'; }
            const current = records.get(id);
            if (current) { const updated = { ...current, notification: record.notification, notification_deliveries: record.notification_deliveries || null }; persist(updated); records.set(id, updated); }
            control.event('notification_' + record.notification, record, user);
          }
          return json(res, 201, info(records.get(id) || record, user));
        } finally {
          if (reservationHeld) reserved -= size; uploading--;
          if (!committed) for (const extension of ['part', 'blob', 'json', 'json.tmp']) {
            try { unlinkSync(pathFor(id, extension)); } catch (error) { if (error.code !== 'ENOENT') console.error('Upload cleanup failed'); }
          }
        }
      }
      const match = /^\/v1\/transfers\/([A-Za-z0-9_-]{32})(\/(?:download|preview|envelopes))?$/.exec(route);
      if (!match) throw fail(404, 'not_found');
      const [, id, download] = match;
      if (download === '/envelopes') {
        if(req.method!=='POST')throw fail(405,'method_not_allowed');
        const user=owner(req),body=await readJSON(req,8192),record=records.get(id);
        if(!record || isExpired(record,config.now()) || isExhausted(record) || !control.canSee(user,record))throw fail(404,'unavailable');
        if(user.id!==(record.uploaded_by || 'admin') && user.id!==record.recipient_id)throw fail(403,'own_keys_required');
        const secret=req.headers['x-download-token'];
        if(typeof secret!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(secret) || !equal(hash(secret),record.token_hash))throw fail(403,'file_key_required');
        if(!body || Object.keys(body).length!==1 || !Array.isArray(body.envelopes) || body.envelopes.length<1 || body.envelopes.length>4)throw fail(400,'invalid_envelope');
        const own=new Set(control.state.devices.filter(d=>d.user_id===user.id).map(d=>d.id)),seen=new Set();
        for(const e of body.envelopes){
          if(!e || !own.has(e.device_id) || seen.has(e.device_id) || typeof e.box!=='string' || !/^[A-Za-z0-9_-]{342}$/.test(e.box))throw fail(403,'own_keys_required');
          seen.add(e.device_id);
        }
        const active=new Set(control.state.devices.filter(d=>d.user_id===(record.uploaded_by || 'admin') || d.user_id===record.recipient_id).map(d=>d.id));
        const envelopes=(record.envelopes || []).filter(e=>active.has(e.device_id));
        const existing=new Set(envelopes.map(e=>e.device_id));
        const added=body.envelopes.filter(e=>!existing.has(e.device_id)).map(e=>({device_id:e.device_id,box:e.box}));
        if(envelopes.length+added.length>8)throw fail(400,'invalid_envelope');
        if(added.length){const updated={...record,envelopes:[...envelopes,...added]};persist(updated);records.set(id,updated);control.event('device_keys_shared',updated,user,{devices:added.length});}
        return json(res,200,{added:added.length});
      }
      if (download) {
        if (req.method !== 'POST') throw fail(405, 'method_not_allowed');
        const secret = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
        const record = records.get(id);
        // Unknown, expired, exhausted, and incorrect capability return the same response.
        if (!record || !secret || !equal(hash(secret), record.token_hash) || isExpired(record, config.now()) ||
            isExhausted(record)) throw fail(404, 'unavailable');
        const recipientUser = control.identity(req);
        if (record.require_recipient && (!recipientUser || recipientUser.id !== record.recipient_id)) throw fail(403, 'recipient_login_required');
        if (download === '/preview') return json(res, 200, { bytes: record.bytes, details: record.details || null, require_recipient: Boolean(record.require_recipient) });
        if (streaming >= config.maxStreams) throw fail(503, 'download_capacity');
        const fd = openSync(pathFor(id, 'blob'), 'r');
        const next = { ...record, downloads: Math.min(Number.MAX_SAFE_INTEGER, record.downloads + 1) };
        try { persist(next); } catch (error) { closeSync(fd); throw error; }
        records.set(id, next); streaming++;
        let delivered = false;
        const downloadStream = createReadStream(pathFor(id, 'blob'), { fd, autoClose: true });
        // Count before streaming: simultaneous clients cannot exceed the limit. Interrupted attempts count.
        try {
          control.event('download_started', record, recipientUser);
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': record.bytes,
            'content-disposition': 'attachment; filename="encrypted.bin"' });
          await pipeline(downloadStream, res,
            { signal: AbortSignal.timeout(1800_000) });
          delivered = true;
        } finally {
          downloadStream.destroy();
          streaming--;
          control.event(delivered ? 'download_transferred' : 'download_interrupted', record, recipientUser);
          const current = records.get(id);
          if (current && isExhausted(current)) remove(id, 'exhausted');
        }
        return;
      }
      const user = owner(req);
      // Read the body before reloading the record: downloads/cleanup can run during this await.
      const retentionChange = req.method === 'PATCH' ? await readJSON(req) : undefined;
      const record = records.get(id);
      if (!record || isExpired(record, config.now()) || isExhausted(record)) throw fail(404, 'unavailable');
      if (!control.canSee(user, record)) throw fail(404, 'unavailable');
      if (req.method === 'GET') return json(res, 200, info(record, user));
      if (req.method === 'PATCH') {
        if (!control.canManage(user, record)) throw fail(403, 'owner_required');
        if (!settings().allowRetention) throw fail(403, 'retention_disabled');
        if (!retentionChange || typeof retentionChange !== 'object' || Array.isArray(retentionChange) ||
            Object.keys(retentionChange).length !== 1 || !Object.hasOwn(retentionChange, 'expires_at')) throw fail(400, 'invalid_retention');
        const expiresAt = retentionChange.expires_at === null ? null : deadline(retentionChange.expires_at, config.now(), settings().maxTTL);
        const updated = { ...record, expires_at: expiresAt, max_downloads: null };
        persist(updated); records.set(id, updated);
        control.event('retention_changed', updated, user, { previous_expires_at: record.expires_at, expires_at: expiresAt,
          previous_max_downloads: record.max_downloads, max_downloads: null });
        return json(res, 200, info(updated, user));
      }
      if (req.method === 'DELETE') { if (!control.canManage(user, record)) throw fail(403, 'owner_required'); remove(id, 'revoked', user); return json(res, 200, { id, revoked: true }); }
      throw fail(405, 'method_not_allowed');
    } catch (error) {
      if (!error.status) console.error('Request failed'); // Deliberately no URLs, headers or secrets.
      if (!res.headersSent && !res.destroyed) {
        // Do not drain an untrusted rejected upload on a reusable connection.
        res.setHeader('Connection', 'close');
        json(res, error.status || 500, { error: error.status ? error.message : 'internal_error' });
      } else if (!res.destroyed) res.destroy();
    } finally {
      activeHandlers--;
      if (serverClosed) releaseLock();
    }
  });
  server.maxConnections = 64;
  server.keepAliveTimeout = 5000;
  const timer = setInterval(() => { try { cleanup(); } catch { console.error('Cleanup failed'); } }, config.cleanupMs);
  timer.unref();
  let lockReleased = false;
  const releaseLock = () => {
    if (lockReleased || activeHandlers > 0) return;
    lockReleased = true;
    clearInterval(timer);
    unlinkSync(lockPath);
  };
  server.on('close', () => { serverClosed = true; releaseLock(); });
  server.on('error', () => { if (!server.listening) releaseLock(); });
  return { server, cleanup, config, control };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const relay = createRelay({ uploadToken: readToken(process.env.RELAYDROP_TOKEN_FILE),
      identities: process.env.RELAYDROP_IDENTITIES_FILE ? readPrivateJSON(process.env.RELAYDROP_IDENTITIES_FILE) : [],
      webPush: process.env.RELAYDROP_WEB_PUSH_FILE ? createWebPush(readPrivateJSON(process.env.RELAYDROP_WEB_PUSH_FILE), process.env.RELAYDROP_URL) : undefined,
      maxFileBytes: process.env.RELAYDROP_MAX_FILE_BYTES ? positiveInt(process.env.RELAYDROP_MAX_FILE_BYTES, undefined, HARD_FILE_BYTES) : undefined,
      publicURL: process.env.RELAYDROP_URL, allowHTTPLocalhost: process.env.RELAYDROP_ALLOW_HTTP_LOCALHOST === '1',
      dataDir: process.env.RELAYDROP_DATA_DIR || './data',
      maxBytes: positiveInt(process.env.RELAYDROP_MAX_STORAGE_BYTES, 1024 * 1024 * 1024),
      maxTransfers: positiveInt(process.env.RELAYDROP_MAX_TRANSFERS, 1000),
      requestsPerMinute: positiveInt(process.env.RELAYDROP_REQUESTS_PER_MINUTE, 120),
      emergencyRequestsPerMinute: positiveInt(process.env.RELAYDROP_EMERGENCY_REQUESTS_PER_MINUTE, 6000) });
    relay.server.listen(positiveInt(process.env.PORT, 8787, 65535), process.env.HOST || '127.0.0.1', () => console.log('RelayDrop listening'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
      relay.server.close();
      setTimeout(() => { relay.server.closeAllConnections(); }, 10_000).unref();
    });
    relay.server.on('error', () => { console.error('Server failed to listen; check configuration and storage lock'); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
