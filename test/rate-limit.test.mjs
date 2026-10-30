import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createRequestLimiter } from '../src/rate-limit.mjs';
import { createRelay } from '../src/server.mjs';
import { token, hash, encryptFile } from '../src/crypto.mjs';

test('rate budgets isolate clients and trust classes, retain emergency limits and reset', () => {
  let now = 1000;
  const limit = createRequestLimiter({ requestsPerMinute: 2, emergencyRequestsPerMinute: 3, now: () => now });
  assert.equal(limit('authenticated', 'alice'), 0);
  assert.equal(limit('authenticated', 'alice'), 0);
  for (let n = 0; n < 100; n++) assert.equal(limit('authenticated', 'alice'), 60);
  assert.equal(limit('authenticated', 'bob'), 0);
  assert.equal(limit('authenticated', 'carol'), 60);
  assert.equal(limit('anonymous', 'peer'), 0);
  assert.equal(limit('public', 'peer'), 0);
  now += 45000; assert.equal(limit('authenticated', 'alice'), 15);
  now += 15000; assert.equal(limit('authenticated', 'alice'), 0);
});

test('anonymous bucket storage is bounded and cannot displace authenticated accounts', () => {
  const limit = createRequestLimiter({ requestsPerMinute: 2, emergencyRequestsPerMinute: 10000, now: () => 0 });
  for (let n = 0; n < 4096; n++) assert.equal(limit('anonymous', String(n)), 0);
  assert.equal(limit('anonymous', 'new-peer'), 60);
  assert.equal(limit('authenticated', 'alice'), 0);
  assert.equal(limit('anonymous', '0'), 0);
  assert.equal(limit('anonymous', '0'), 60);
});

async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'relaydrop-rate-'));
  const admin = token();
  const relay = createRelay({ dataDir, uploadToken: admin, publicURL: 'http://127.0.0.1:8787', allowHTTPLocalhost: true, ...options });
  relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening');
  t.after(async () => { await new Promise(r => relay.server.close(r)); rmSync(dataDir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  const request = async (path, options) => {
    const response = await fetch(origin + path, options);
    return { status: response.status, headers: response.headers, body: await response.text() };
  };
  return { request, admin };
}

test('anonymous floods and spoofed forwarding headers cannot exhaust login, session or valid link budgets', async t => {
  const { request, admin } = await fixture(t);
  const headers = { authorization: 'Bearer ' + admin };
  const secret = token();
  const upload = await request('/v1/transfers', { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream', 'x-download-token-sha256': hash(secret) }, body: encryptFile(Buffer.from('fixture'), 'fixture.txt').body });
  assert.equal(upload.status, 201);
  const id = JSON.parse(upload.body).id;
  for (let n = 0; n < 120; n++) {
    assert.equal((await request('/healthz')).status, 200);
    assert.equal((await request('/v1/me', { headers: { authorization: 'Bearer ' + token(), 'x-forwarded-for': `192.0.2.${n}`, 'x-real-ip': `192.0.2.${n}` } })).status, 401);
  }
  assert.equal((await request('/healthz')).status, 429);
  assert.equal((await request('/v1/me', { headers: { 'x-forwarded-for': '198.51.100.1' } })).status, 429);
  assert.equal((await request('/v1/me', { headers })).status, 200);
  const login = await request('/v1/session', { method: 'POST', headers });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/v1/transfers', { headers: { cookie } })).status, 200);
  assert.equal((await request(`/v1/transfers/${id}/download`, { method: 'POST', headers: { authorization: 'Bearer ' + secret } })).status, 200);
});

test('HTTP account limits are per identity rather than cookie, token or socket', async t => {
  const alice = token(), bob = token();
  const { request } = await fixture(t, { requestsPerMinute: 2, identities: [
    { id: 'alice', name: 'Alice', role: 'recipient', token_hash: hash(alice) },
    { id: 'bob', name: 'Bob', role: 'recipient', token_hash: hash(bob) }
  ] });
  const login = await request('/v1/session', { method: 'POST', headers: { authorization: 'Bearer ' + alice } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/v1/me', { headers: { cookie } })).status, 200);
  assert.equal((await request('/v1/me', { headers: { authorization: 'Bearer ' + alice } })).status, 429);
  assert.equal((await request('/v1/me', { headers: { authorization: 'Bearer ' + bob } })).status, 200);
  assert.equal((await request('/dashboard', { headers: { cookie } })).status, 200);
});
