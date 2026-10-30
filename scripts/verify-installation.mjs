// Synthetic end-to-end check for a disposable installation; never use personal credentials.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { decryptFile } from '../public/decrypt.js';
const { values } = parseArgs({ options: { server: { type: 'string' }, secrets: { type: 'string' }, cli: { type: 'string' }, phase: { type: 'string', default: 'seed' } } });
const origin = new URL(values.server).origin;
assert.ok(origin.startsWith('https://'), 'Installation check requires verified HTTPS');
const directory = resolve(values.secrets), statePath = join(directory, 'installation-proof.json');
const credential = name => {
  const path = join(directory, name + '-token');
  assert.equal(statSync(path).mode & 0o077, 0);
  return readFileSync(path, 'utf8').trim();
};
async function api(path, { secret, cookie, ...options } = {}) {
  return fetch(origin + path, { ...options, headers: { ...(secret ? { authorization: 'Bearer ' + secret } : {}), ...(cookie ? { cookie } : {}), origin, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(30000) });
}
let state;
if (values.phase === 'seed') {
  assert.equal((await api('/healthz')).status, 200);
  assert.equal((await api('/dashboard')).status, 200);
  const worker = await api('/v1/push/sw.js');
  assert.equal(worker.headers.get('service-worker-allowed'), '/');
  const admin = credential('admin'), personal = credential('me');
  assert.equal((await api('/v1/settings', { secret: admin })).status, 200);
  assert.equal((await api('/v1/settings', { secret: personal })).status, 403);
  const login = await api('/v1/session', { method: 'POST', secret: personal, headers: { 'x-remember-device': '1' } });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await (await api('/v1/push/config', { cookie })).json()).enabled, true);
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const registration = await api('/v1/devices', { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Installation fixture', public_key: pair.publicKey.export({ format: 'jwk' }) }) });
  assert.equal(registration.status, 201); const device = await registration.json();
  const plaintext = 'RelayDrop installation fixture — encrypted HTTPS transfer.\n';
  const path = join(directory, 'installation-fixture.txt'); writeFileSync(path, plaintext, { mode: 0o600 });
  let output;
  try {
    ({ stdout: output } = await promisify(execFile)(process.execPath, [resolve(values.cli), 'send', path, '--server', origin, '--token-file', join(directory, 'agent-token'), '--to', 'me', '--require-recipient', '--ttl', '3600', '--downloads', '10'], { maxBuffer: 1024 * 1024 }));
  } catch { throw new Error('Synthetic CLI upload failed; no credential or secret URL printed'); }
  const sent = JSON.parse(output);
  const list = await (await api('/v1/transfers', { cookie })).json();
  const record = list.find(r => r.id === sent.id); assert.ok(record);
  const box = record.envelopes.find(e => e.device_id === device.id).box;
  const [secret, key] = privateDecrypt({ key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(box, 'base64url')).toString().split('.');
  state = { cookie, secret, key, id: record.id, plaintext };
  writeFileSync(statePath, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
} else {
  assert.equal(values.phase, 'resume');
  state = JSON.parse(readFileSync(statePath));
  assert.equal((await api('/v1/me', { cookie: state.cookie })).status, 200, 'Session survives restart');
}
const received = await api(`/v1/transfers/${state.id}/download`, { method: 'POST', secret: state.secret, cookie: state.cookie });
assert.equal(received.status, 200);
const decoded = await decryptFile(await received.arrayBuffer(), state.key);
assert.equal(Buffer.from(decoded.data).toString(), state.plaintext);
if (values.phase === 'seed') {
  let status;
  for (let n = 0; n < 121 && status !== 429; n++) { const r = await api('/healthz'); status = r.status; await r.arrayBuffer(); }
  assert.equal(status, 429);
  assert.equal((await api('/v1/me', { cookie: state.cookie })).status, 200, 'Public traffic cannot block an account');
}
console.log(JSON.stringify({ phase: values.phase, verified_https: true, plaintext_matches: true, ...(values.phase === 'seed' ? { role_separation: true, web_push_configured: true, anonymous_budget_isolated: true } : { session_and_file_survive_restart: true }) }));
