import { readFileSync, existsSync, openSync, writeFileSync, closeSync, fsyncSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash } from './crypto.mjs';
import { validateSubscription } from './web-push.mjs';
export const HARD_FILE_BYTES = 2 * 1024 ** 3 - 4096;
const SESSION_MS = 8 * 3600000, REMEMBER_MS = 90 * 86400000;
export const reject = (status, message) => Object.assign(new Error(message), { status });
export const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function atomicJSON(path, value) {
  const fd = openSync(path + '.tmp', 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(path + '.tmp', path);
}
export function readPrivateJSON(path) {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error('Private JSON file must have permissions 600 or 400');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export async function readJSON(req, max = 32768) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw reject(415, 'expected_json');
  let total = 0; const chunks = [];
  for await (const chunk of req) { total += chunk.length; if (total > max) throw reject(413, 'json_limit'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw reject(400, 'invalid_json'); }
}
export function validateSettings(value) {
  if (!value || typeof value !== 'object') throw reject(400, 'invalid_settings');
  const ranges = { maxFileBytes: [1, HARD_FILE_BYTES], maxBytes: [1, 10 * 1024 ** 4], maxTransfers: [1, 10000],
    maxTTL: [1, 30 * 86400], maxDownloads: [1, 1000], auditDays: [1, 365] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) throw reject(400, `invalid_${key}`);
  }
  if (value.maxBytes < value.maxFileBytes) throw reject(400, 'storage_smaller_than_file');
  if (value.allowRetention !== undefined && typeof value.allowRetention !== 'boolean') throw reject(400, 'invalid_allowRetention');
  return { ...Object.fromEntries(Object.keys(ranges).map(key => [key, value[key]])), allowRetention: value.allowRetention ?? false };
}
export function createControl(directory, config, origin) {
  const principals = [{ id: 'admin', name: 'Amministratore', role: 'admin', token_hash: hash(config.uploadToken) }, ...(config.identities || [])];
  const ids = new Set(), hashes = new Set();
  for (const p of principals) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || typeof p.name !== 'string' || p.name.length > 100 || !p.name ||
        !['admin','uploader','recipient'].includes(p.role) || !/^[a-f0-9]{64}$/.test(p.token_hash) || ids.has(p.id) || hashes.has(p.token_hash)) throw new Error('Invalid identities registry');
    ids.add(p.id); hashes.add(p.token_hash);
  }
  const path = join(directory, 'control.json');
  const defaults = { maxFileBytes: config.maxFileBytes || Math.min(config.maxBytes, 100 * 1024 ** 2), maxBytes: config.maxBytes,
    maxTransfers: config.maxTransfers, maxTTL: 86400, maxDownloads: 20, auditDays: 30 };
  let state = existsSync(path) ? readPrivateJSON(path) : { settings: defaults, events: [], devices: [] };
  state.settings = validateSettings(state.settings);
  if (!Array.isArray(state.events) || !Array.isArray(state.devices)) throw new Error('Invalid control state');
  state.pushSubscriptions ??= [];
  if (!Array.isArray(state.pushSubscriptions)) throw new Error('Invalid push state');
  state.sessions ??= [];
  if (!Array.isArray(state.sessions) || state.sessions.length > 1000 || state.sessions.some(s =>
    !/^[a-f0-9]{64}$/.test(s.id_hash || '') || !/^[a-f0-9]{64}$/.test(s.credential_hash || '') ||
    typeof s.user !== 'string' || !Number.isSafeInteger(s.expires) ||
    (s.remember !== undefined && typeof s.remember !== 'boolean'))) throw new Error('Invalid session state');
  // Store only hashes of random cookies; a copy of this file cannot be used as a session cookie.
  const sessions = new Map(state.sessions.map(s => [s.id_hash, s]));
  const save = () => { state.sessions = [...sessions.values()]; atomicJSON(path, state); const fd = openSync(directory, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } };
  const prune = () => {
    const cutoff = config.now() - state.settings.auditDays * 86400000;
    state.events = state.events.filter(event => event.at >= cutoff).slice(-2000);
    for (const [key, session] of sessions) if (session.expires <= config.now() || !principals.some(p => p.id === session.user && same(p.token_hash,session.credential_hash))) sessions.delete(key);
  };
  const bearer = req => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
  const byToken = secret => secret && principals.find(p => same(p.token_hash, hash(secret)));
  const cookieId = req => /(?:^|;\s*)relaydrop_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const cookieSession = req => {
    const id = cookieId(req), session = id && sessions.get(hash(id));
    return session && session.expires > config.now() && principals.some(p => p.id === session.user && same(p.token_hash,session.credential_hash)) ? session : null;
  };
  const setCookie = (res, id, expires) => res.setHeader('Set-Cookie', `relaydrop_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0,Math.floor((expires-config.now())/1000))}${origin.startsWith('https:') ? '; Secure' : ''}`);
  const sessionInfo = session => session ? { remember: Boolean(session.remember), expires_at: new Date(session.expires).toISOString() } : null;
  const identity = req => {
    const apiUser = byToken(req.headers['x-identity-token'] || bearer(req));
    if (apiUser) return apiUser;
    const cookie = cookieId(req);
    const session = cookie && sessions.get(hash(cookie));
    if (!session || session.expires <= config.now()) return null;
    // Cookie authentication requires the actual same-origin browser for mutations.
    if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) throw reject(403, 'origin_required');
    return principals.find(p => p.id === session.user && same(p.token_hash,session.credential_hash));
  };
  const requireUser = req => { const user = identity(req); if (!user) throw reject(401, 'unauthorized'); return user; };
  const requireAdmin = req => { const user = requireUser(req); if (user.role !== 'admin') throw reject(403, 'admin_required'); return user; };
  const subscriptionsFor = userId => state.pushSubscriptions.filter(s => s.user_id === userId && state.devices.some(d => d.id === s.device_id && d.user_id === userId));
  const publicUser = p => ({ id: p.id, name: p.name, role: p.role, notifications: Boolean(p.notify || (config.webPush && subscriptionsFor(p.id).length)) });
  const event = (type, record, user, extra = {}) => {
    prune();
    state.events.push({ id: randomBytes(12).toString('base64url'), at: config.now(), type,
      transfer_id: record?.id, uploaded_by: record?.uploaded_by || 'admin', recipient_id: record?.recipient_id || null,
      actor: user?.id || null, actor_name: user?.name || (['expired','exhausted','removed'].includes(type) ? 'Sistema' : 'Link anonimo'), ...extra });
    state.events = state.events.slice(-2000); save();
  };
  const canSee = (user, record) => user.role === 'admin' || (user.role === 'uploader' && (record.uploaded_by || 'admin') === user.id) || record.recipient_id === user.id;
  const canManage = (user, record) => user.role === 'admin' || (record.uploaded_by || 'admin') === user.id;
  return { get state() { return state; }, principals, publicUser, identity, requireUser, requireAdmin, event, canSee, canManage,
    refreshSession(req, res) {
      const session = cookieSession(req);
      if (session && session.user !== requireUser(req).id) return null;
      if (session?.remember) {
        // Persist at most hourly; polling must not cause a disk write on every request.
        if (session.expires - config.now() <= REMEMBER_MS - 3600000) { session.expires = config.now() + REMEMBER_MS; save(); }
        setCookie(res,cookieId(req),session.expires);
      }
      return sessionInfo(session);
    },
    setRemember(req,res,value) {
      const user = requireUser(req), session = cookieSession(req);
      if (!session || session.user !== user.id) throw reject(401,'browser_session_required');
      if (req.headers.origin !== origin) throw reject(403,'origin_required');
      if (typeof value !== 'boolean') throw reject(400,'invalid_remember');
      session.remember=value;session.expires=config.now()+(value?REMEMBER_MS:SESSION_MS);save();
      setCookie(res,cookieId(req),session.expires);return sessionInfo(session);
    },
    updateSettings(value) { state.settings = validateSettings({ ...value, allowRetention: Object.hasOwn(value || {},'allowRetention') ? value.allowRetention : state.settings.allowRetention }); save(); },
    cleanup() { const before = state.events.length, count = sessions.size; prune(); if (before !== state.events.length || count !== sessions.size) save(); },
    login(req, res) {
      const user = byToken(bearer(req)); if (!user) throw reject(401, 'unauthorized');
      if (req.headers['x-remember-device'] !== undefined && !['0','1'].includes(req.headers['x-remember-device'])) throw reject(400,'invalid_remember');
      const remember=req.headers['x-remember-device']==='1';
      prune(); if (sessions.size >= 1000) throw reject(503, 'session_capacity');
      const id = randomBytes(32).toString('base64url'), idHash = hash(id);
      sessions.set(idHash, { id_hash: idHash, user: user.id, credential_hash: user.token_hash, remember, expires: config.now() + (remember?REMEMBER_MS:SESSION_MS) });
      save();
      setCookie(res,id,sessions.get(idHash).expires);
      return publicUser(user);
    },
    logout(req, res) { requireUser(req); const cookie=cookieId(req); if(cookie){sessions.delete(hash(cookie));save();} res.setHeader('Set-Cookie', `relaydrop_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${origin.startsWith('https:') ? '; Secure' : ''}`); },
    addDevice(user, body) {
      const jwk = body.public_key;
      if (!jwk || jwk.kty !== 'RSA' || jwk.e !== 'AQAB' || !/^[A-Za-z0-9_-]{342}$/.test(jwk.n || '') || jwk.d ||
          typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) throw reject(400, 'invalid_device');
      if (state.devices.filter(d => d.user_id === user.id).length >= 4) throw reject(409, 'device_limit');
      const device = { id: randomBytes(12).toString('base64url'), user_id: user.id, name: body.name.trim(),
        public_key: { kty: 'RSA', n: jwk.n, e: 'AQAB', alg: 'RSA-OAEP-256', ext: true }, created_at: config.now() };
      state.devices.push(device); save(); return device;
    },
    removeDevice(user, id) {
      state.devices = state.devices.filter(d => !(d.id === id && (d.user_id === user.id || user.role === 'admin')));
      state.pushSubscriptions = state.pushSubscriptions.filter(s => state.devices.some(d => d.id === s.device_id)); save();
    },
    subscriptionsFor,
    addPushSubscription(user, body) {
      if (!state.devices.some(d => d.id === body?.device_id && d.user_id === user.id)) throw reject(403, 'own_device_required');
      let subscription;
      try { subscription = validateSubscription(body.subscription); } catch { throw reject(400, 'invalid_push_subscription'); }
      if (state.pushSubscriptions.some(s => s.subscription.endpoint === subscription.endpoint && (s.user_id !== user.id || s.device_id !== body.device_id))) throw reject(409, 'push_endpoint_in_use');
      const item = { user_id: user.id, device_id: body.device_id, subscription, created_at: config.now() };
      state.pushSubscriptions = state.pushSubscriptions.filter(s => s.device_id !== body.device_id);
      state.pushSubscriptions.push(item); save(); return { device_id: item.device_id, enabled: true };
    },
    removePushSubscription(user, deviceId) {
      state.pushSubscriptions = state.pushSubscriptions.filter(s => !(s.user_id === user.id && s.device_id === deviceId)); save();
    },
    expirePushSubscription(item) {
      // Don't delete a renewed subscription while an older send is still in flight.
      state.pushSubscriptions = state.pushSubscriptions.filter(s => !(s.device_id === item.device_id && s.subscription.endpoint === item.subscription.endpoint && s.subscription.keys.auth === item.subscription.keys.auth && s.subscription.keys.p256dh === item.subscription.keys.p256dh)); save();
    },
    devicesFor(user, recipient) { return state.devices.filter(d => d.user_id === user.id || d.user_id === recipient); },
    validateMetadata(raw, user, recipient) {
      if (!raw) return {};
      let value; try { value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { throw reject(400, 'invalid_metadata'); }
      if (!value || typeof value !== 'object' || !/^[A-Za-z0-9_-]{1,16384}$/.test(value.details || '') ||
          !Array.isArray(value.envelopes) || value.envelopes.length > 8) throw reject(400, 'invalid_metadata');
      const allowed = new Set(this.devicesFor(user, recipient).map(d => d.id));
      const used = new Set();
      for (const e of value.envelopes) {
        if (!allowed.has(e.device_id) || used.has(e.device_id) || !/^[A-Za-z0-9_-]{342}$/.test(e.box || '')) throw reject(400, 'invalid_envelope');
        used.add(e.device_id);
      }
      return { details: value.details, envelopes: value.envelopes };
    }
  };
}
