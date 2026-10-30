import { decryptFile } from './decrypt.js';

const encode64 = bytes => btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const utf8 = text => new TextEncoder().encode(text);

export async function encryptBrowserFile(file, devices, maxBytes) {
  // Web Crypto encrypts whole buffers. Keep mobile uploads bounded, even if the relay allows more.
  if (file.size > Math.min(maxBytes, 100 * 1024 ** 2)) throw new Error('Dal browser puoi inviare fino a 100 MiB, entro il limite del servizio. Per file più grandi usa la CLI.');
  if (!devices.length) throw new Error('Registra almeno un browser prima di inviare il file.');
  const name = file.name.replace(/[\\/\x00-\x1f\x7f]/g, '_');
  if (!name || utf8(name).length > 1024) throw new Error('Nome del file non valido.');
  const source = new Uint8Array(await file.arrayBuffer());
  if (source.length !== file.size) throw new Error('Il file è cambiato durante la lettura.');
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = encode64(crypto.getRandomValues(new Uint8Array(32)));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const meta = utf8(JSON.stringify({ name, size: file.size }));
  const plain = new Uint8Array(4 + meta.length + source.length);
  new DataView(plain.buffer).setUint32(0, meta.length); plain.set(meta,4); plain.set(source,4+meta.length);
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:utf8('RelayDrop/v1') }, key, plain);
  const body = new Blob([utf8('RD01'), iv, ciphertext], { type:'application/octet-stream' });
  const detailIV = crypto.getRandomValues(new Uint8Array(12));
  const detailsCipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv:detailIV, additionalData:utf8('RelayDrop/details/v1') }, key, utf8(JSON.stringify({name,summary:null})));
  const details = new Uint8Array(12+detailsCipher.byteLength);details.set(detailIV);details.set(new Uint8Array(detailsCipher),12);
  const envelopes = await Promise.all(devices.map(async device => {
    const publicKey = await crypto.subtle.importKey('jwk',device.public_key,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    const box = await crypto.subtle.encrypt({name:'RSA-OAEP'}, publicKey, utf8(secret+'.'+encode64(keyBytes)));
    return { device_id:device.id, box:encode64(box) };
  }));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',utf8(secret)));
  return { body, tokenHash:Array.from(digest,b=>b.toString(16).padStart(2,'0')).join(''),
    metadata:encode64(utf8(JSON.stringify({details:encode64(details),envelopes}))) };
}

export async function receiveFile(record, request = fetch) {
  if (!record.unlocked) throw new Error('Questo browser non ha la chiave. Usa un browser già registrato al momento dell’invio.');
  const response = await request(`/v1/transfers/${record.id}/download`, { method:'POST',
    headers:{authorization:'Bearer '+record.unlocked.secret}, credentials:'same-origin', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(1800_000) });
  if (!response.ok) {
    if ([401,403].includes(response.status)) throw new Error('Accedi di nuovo con il tuo utente per scaricare il file.');
    if (response.status===404) throw new Error('File scaduto, revocato o tentativi esauriti.');
    throw new Error(`Download non riuscito (${response.status}).`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(declared) || declared<36 || declared>2*1024**3) { await response.body?.cancel(); throw new Error('Dimensione del file non valida.'); }
  const reader=response.body.getReader(),chunks=[];let total=0;
  while(true) {
    const {value,done}=await reader.read();if(done)break;
    total+=value.length;
    if(total>declared){await reader.cancel();throw new Error('Trasferimento oltre la dimensione dichiarata.');}
    chunks.push(value);
  }
  if(total!==declared)throw new Error('Trasferimento incompleto.');
  const encrypted=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){encrypted.set(chunk,offset);offset+=chunk.length;}
  return decryptFile(encrypted.buffer,record.unlocked.key,2*1024**3);
}
