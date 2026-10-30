export const decode64 = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4)), c => c.charCodeAt(0));
const database = () => new Promise((resolve,reject) => {
  const request = indexedDB.open('relaydrop-private-vault', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('devices', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Archivio privato del browser non disponibile'));
});
async function storage(mode, action) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('devices',mode), request = action(tx.objectStore('devices')); let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Impossibile salvare la chiave nel browser')); };
  });
}
export const localDevices = () => storage('readonly', store => store.getAll());
export const removeLocalDevice = id => storage('readwrite', store => store.delete(id));
export async function enrollDevice(name, api) {
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, false, ['encrypt','decrypt']);
  const public_key = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const device = await api('/v1/devices', { method: 'POST', body: JSON.stringify({ name, public_key }) });
  try { await storage('readwrite', store => store.put({ id: device.id, user_id: device.user_id, name: device.name, private_key: pair.privateKey })); }
  catch (error) { await api('/v1/devices/' + device.id, { method:'DELETE' }); throw error; }
  return device;
}
export async function decryptDetails(box, key) {
  if (typeof box !== 'string' || box.length > 16384) throw new Error('Metadati non validi');
  const bytes = decode64(box);
  const aes = await crypto.subtle.importKey('raw', decode64(key), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:bytes.slice(0,12), additionalData:new TextEncoder().encode('RelayDrop/details/v1') }, aes, bytes.slice(12));
  const details = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
  if (typeof details.name !== 'string' || details.name.length > 1024) throw new Error('Nome non valido');
  if (details.summary && (typeof details.summary.text !== 'string' || details.summary.text.length > 4000)) throw new Error('Riepilogo non valido');
  return details;
}
export async function unlockTransfer(record, userId, devices) {
  let failed=false;
  for (const envelope of record.envelopes || []) {
    const device = devices.find(d => d.id === envelope.device_id && d.user_id === userId);
    if (!device) continue;
    try {
    const raw = await crypto.subtle.decrypt({name:'RSA-OAEP'}, device.private_key, decode64(envelope.box));
    const keys = new TextDecoder().decode(raw);
    if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(keys)) throw new Error('Chiavi non valide');
    const [secret,key] = keys.split('.');
    return { secret, key, ...(await decryptDetails(record.details, key)) };
    } catch { failed=true; }
  }
  if(failed)throw new Error('La chiave presente non riesce a verificare questo file.');
  return null;
}

export async function shareTransferKeys(record, userId, devices, api) {
  if(!record.unlocked)return 0;
  const targets=devices.filter(d=>d.user_id===userId && !(record.envelopes || []).some(e=>e.device_id===d.id));
  if(!targets.length)return 0;
  const keys=new TextEncoder().encode(record.unlocked.secret+'.'+record.unlocked.key);
  const envelopes=await Promise.all(targets.map(async device=>{
    const publicKey=await crypto.subtle.importKey('jwk',device.public_key,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,keys));
    const box=btoa(Array.from(encrypted,n=>String.fromCharCode(n)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return {device_id:device.id,box};
  }));
  const result=await api('/v1/transfers/'+record.id+'/envelopes',{method:'POST',headers:{'x-download-token':record.unlocked.secret},body:JSON.stringify({envelopes})});
  record.envelopes=[...(record.envelopes || []),...envelopes];
  return result.added;
}
