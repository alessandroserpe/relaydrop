import { readFileSync, statSync } from 'node:fs';
export async function notifyRecipient(config, origin, request = fetch) {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) throw new Error('Invalid ntfy endpoint');
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', Title: 'RelayDrop', Click: origin + '/dashboard' };
  if (config.token_file) {
    if ((statSync(config.token_file).mode & 0o077) !== 0) throw new Error('Notification token permissions');
    const token = readFileSync(config.token_file, 'utf8').trim();
    if (!/^[A-Za-z0-9_-]{10,512}$/.test(token)) throw new Error('Invalid notification token');
    headers.Authorization = 'Bearer ' + token;
  }
  const response = await request(url.href, { method: 'POST', headers, body: 'Un nuovo file è disponibile nella tua casella privata.',
    redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Notification provider rejected message');
  await response.body?.cancel();
  return { status: 'accepted' }; // Provider acceptance is not evidence of phone delivery.
}
