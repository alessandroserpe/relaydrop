#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hash, token } from './crypto.mjs';
import { readToken, serverURL } from './config.mjs';
import { atomicJSON, readPrivateJSON } from './control.mjs';
import { encryptPath, encryptDetails, wrapKeys } from './stream-crypto.mjs';
import { summarizeLocal } from './summarize.mjs';
import { uploadRetention } from './retention.mjs';
const help = `RelayDrop — private file inbox for people and agents
  init --token-file PATH  (create the administrator credential once)
  identity-add ID --name NAME --role uploader|recipient|admin --registry-file PATH --token-file PATH
  send FILE [--to USER_ID] [--require-recipient] [--notify] [--ttl SECONDS] [--downloads N]
            [--keep | --expires UTC_ISO_DATE] (replaces TTL/download limits; requires allowRetention)
            [--summarize --model LOCAL_MODEL | --summary-file TEXT_FILE]
  summarize FILE --model LOCAL_MODEL --output PRIVATE_JSON_FILE
  list | events | status ID | revoke ID
  retention ID (--keep | --expires UTC_ISO_DATE)
Options: --server HTTPS_ORIGIN --token-file PATH --allow-http-localhost
Environment: RELAYDROP_URL, RELAYDROP_TOKEN_FILE, RELAYDROP_OLLAMA_URL
Success JSON on stdout; init also prints credential-storage guidance on stderr. Errors JSON on stderr/exit 1. URLs are secrets. No implicit retries.
Notifications require --notify and an operator-configured destination. Summary engines are local only.`;
async function main() {
  const args=process.argv.slice(2);
  // A valid base64url transfer ID can start with '-'; don't parse it as a CLI flag.
  if (['status','revoke','retention'].includes(args[0]) && /^-[A-Za-z0-9_-]{31}$/.test(args[1] || '')) {
    const [id]=args.splice(1,1);args.push('--',id);
  }
  const { values: v, positionals } = parseArgs({ args, allowPositionals: true, options: {
    server: { type: 'string' }, 'token-file': { type: 'string' }, ttl: { type: 'string' }, downloads: { type: 'string' },
    'allow-http-localhost': { type: 'boolean' }, help: { type: 'boolean' }, to: { type: 'string' },
    'require-recipient': { type: 'boolean' }, notify: { type: 'boolean' }, summarize: { type: 'boolean' },
    'summary-file': { type: 'string' }, model: { type: 'string' }, output: { type: 'string' },
    name: { type: 'string' }, role: { type: 'string' }, 'registry-file': { type: 'string' },
    keep: { type: 'boolean' }, expires: { type: 'string' }
  } });
  const [command, target] = positionals;
  if (!command || v.help) return console.log(help);
  const tokenPath = v['token-file'] || process.env.RELAYDROP_TOKEN_FILE;
  if (command === 'init' || command === 'identity-add') {
    if (!tokenPath) throw new Error('Specify --token-file');
    let registry, identities;
    if (command === 'identity-add') {
      registry = v['registry-file'];
      if (!registry || !/^[a-zA-Z0-9_-]{1,64}$/.test(target || '') || target === 'admin' || !v.name || v.name.length > 100 ||
          !['admin','uploader','recipient'].includes(v.role)) throw new Error('Invalid identity arguments');
      identities = existsSync(registry) ? readPrivateJSON(registry) : [];
      if (!Array.isArray(identities) || identities.some(p => p.id === target)) throw new Error('Identity already exists or invalid registry');
    }
    mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
    const secret = token(); writeFileSync(tokenPath, secret + '\n', { flag: 'wx', mode: 0o600 });
    if (registry) {
      mkdirSync(dirname(registry), { recursive: true, mode: 0o700 });
      identities.push({ id: target, name: v.name, role: v.role, token_hash: hash(secret) }); atomicJSON(registry, identities);
    }
    if (command === 'init') console.error([
      'Credenziale amministrativa creata (non mostrata).',
      `File privato: ${resolve(tokenPath)}`,
      'Conserva il contenuto in un gestore di password, con il dominio e il nome «RelayDrop — amministratore».',
      'Per accedere, apri /dashboard sul tuo servizio e incolla la credenziale nel campo «Credenziale di accesso». Comparirà Impostazioni.',
      'Per recuperarla in seguito, leggi lo stesso file con i permessi del proprietario. Non rieseguire init: non sostituisce una credenziale esistente.',
      'Per telefono, computer e agenti crea credenziali separate con identity-add.'
    ].join('\n'));
    return console.log(JSON.stringify({ created: true, id: target, role: command === 'init' ? 'admin' : v.role, token_file: tokenPath }));
  }
  if (command === 'summarize') {
    if (!target || !v.output) throw new Error('Specify FILE and --output');
    const summary = await summarizeLocal(target, { model: v.model, endpoint: process.env.RELAYDROP_OLLAMA_URL });
    writeFileSync(v.output, JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
    return console.log(JSON.stringify({ summary_file: v.output, source: summary.source, reviewed: false }));
  }
  if (!['send','list','events','status','revoke','retention'].includes(command) || (['send','status','revoke','retention'].includes(command) && !target)) throw new Error('Invalid command; use --help');
  const origin = serverURL(v.server || process.env.RELAYDROP_URL, v['allow-http-localhost']);
  const auth = readToken(tokenPath);
  const headers = { authorization: `Bearer ${auth}` };
  const api = async (path, options = {}) => {
    const response = await fetch(origin + path, { ...options, headers: { ...headers, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(1800000) });
    if (!response.ok) throw new Error(`Relay returned HTTP ${response.status}`);
    return response.json();
  };
  const retentionHeaders = { ...(v.keep ? {'x-keep':'1'} : {}), ...(v.expires !== undefined ? {'x-expires-at':v.expires} : {}),
    ...(v.ttl !== undefined ? {'x-ttl-seconds':v.ttl} : {}), ...(v.downloads !== undefined ? {'x-max-downloads':v.downloads} : {}) };
  if (command === 'retention') {
    if (!/^[A-Za-z0-9_-]{32}$/.test(target) || (!v.keep && v.expires === undefined)) throw new Error('Specify ID and --keep or --expires');
    const change = uploadRetention(retentionHeaders, await api('/v1/policy'), Date.now());
    return console.log(JSON.stringify(await api('/v1/transfers/'+target, {method:'PATCH', headers:{'content-type':'application/json'},
      body:JSON.stringify({expires_at:change.expires_at === null ? null : new Date(change.expires_at).toISOString()})})));
  }
  if (command === 'send') {
    const policy = await api('/v1/policy');
    uploadRetention(retentionHeaders, policy, Date.now());
    if ((v.notify || v['require-recipient']) && !v.to) throw new Error('--notify and --require-recipient require --to');
    let summary = null;
    if (v.summarize && v['summary-file']) throw new Error('Choose --summarize or --summary-file');
    if (v.summarize) summary = await summarizeLocal(target, { model: v.model, endpoint: process.env.RELAYDROP_OLLAMA_URL });
    if (v['summary-file']) {
      if (statSync(v['summary-file']).size > 12000) throw new Error('Summary file too large');
      let text = readFileSync(v['summary-file'], 'utf8');
      try { const value = JSON.parse(text); if (typeof value.text === 'string') text = value.text; } catch {}
      if (text.length > 4000) throw new Error('Summary exceeds 4000 characters');
      summary = { text, source: 'sender-provided', reviewed: false };
    }
    const me = await api('/v1/me');
    const devices = await api('/v1/recipient-devices/' + encodeURIComponent(v.to || me.id));
    const encrypted = await encryptPath(target, policy.maxFileBytes);
    const secret = token();
    try {
      const metadata = { details: encryptDetails(encrypted.key, { name: encrypted.name, summary }), envelopes: wrapKeys(devices, secret, encrypted.key) };
      const result = await api('/v1/transfers', { method: 'POST', body: createReadStream(encrypted.path), duplex: 'half', headers: {
        'content-type': 'application/octet-stream', 'content-length': String(encrypted.bytes),
        'x-download-token-sha256': hash(secret), ...retentionHeaders,
        'x-file-metadata': Buffer.from(JSON.stringify(metadata)).toString('base64url'),
        ...(v.to ? { 'x-recipient-id': v.to } : {}), ...(v['require-recipient'] ? { 'x-require-recipient': '1' } : {}), ...(v.notify ? { 'x-notify': '1' } : {})
      } });
      return console.log(JSON.stringify({ ...result, url: `${origin}/d/${result.id}#${secret}.${encrypted.key}`,
        recipient_devices: devices.filter(d => d.user_id === v.to).length,
        warning: v.to && !devices.some(d => d.user_id === v.to) ? 'Recipient has no registered browser; deliver the private link separately' : undefined }));
    } finally { encrypted.cleanup(); }
  }
  const path = command === 'list' ? '/v1/transfers' : command === 'events' ? '/v1/events' : `/v1/transfers/${target}`;
  if (target && !/^[A-Za-z0-9_-]{32}$/.test(target)) throw new Error('Invalid transfer ID');
  console.log(JSON.stringify(await api(path, { method: command === 'revoke' ? 'DELETE' : 'GET' })));
}
main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
