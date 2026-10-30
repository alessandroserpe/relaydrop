import { decryptFile } from './decrypt.js';
import { decryptDetails } from './vault.js';
const status = document.querySelector('#status');
const receive = document.querySelector('#receive');
const save = document.querySelector('#save');
const share = document.querySelector('#share');
const id = /^\/d\/([A-Za-z0-9_-]{32})$/.exec(location.pathname)?.[1];
const parts = /^#([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(location.hash);
// Remove capability and key from the current history entry immediately after capture.
// Reloading requires reopening the original link. Nothing is stored in localStorage.
if (location.hash) history.replaceState(null, '', location.pathname);
let objectURL;
let largeAcknowledged = false;
if (id && parts && globalThis.isSecureContext && crypto.subtle) {
  status.textContent = 'Il link è pronto. Premi il pulsante per ricevere il file. Il tentativo conta anche se la connessione si interrompe.';
  receive.hidden = false;
} else if (id) {
  status.textContent = 'Link incompleto o contesto non sicuro. Riapri il link completo su HTTPS.';
}
receive.addEventListener('click', async () => {
  receive.disabled = true;
  status.textContent = 'Ricezione e decifratura in corso…';
  try {
    const max = 2 * 1024 ** 3;
    const preview = await fetch(`/v1/transfers/${id}/preview`, {method:'POST', headers:{authorization:`Bearer ${parts[1]}`},credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});
    if (preview.status === 403) { document.querySelector('#receiver-login').hidden=false; throw new Error('Questo file richiede l’accesso del destinatario indicato. Accedi qui sotto, poi riprova.'); }
    if (!preview.ok) throw new Error('Link scaduto, revocato, non valido o download esauriti.');
    const metadata=await preview.json();
    if (metadata.bytes > 100 * 1024 * 1024 && !largeAcknowledged) {
      largeAcknowledged = true; receive.disabled=false;receive.textContent='Continua la ricezione';
      status.textContent='Questo file supera 100 MiB. La decifratura usa memoria del browser e può fallire sui telefoni con poca memoria. Premi di nuovo per continuare.';return;
    }
    let details;
    if(metadata.details) details=await decryptDetails(metadata.details,parts[2]);
    const response = await fetch(`/v1/transfers/${id}/download`, { method: 'POST',
      headers: { authorization: `Bearer ${parts[1]}` }, credentials: 'same-origin', cache: 'no-store',
      redirect: 'error', signal: AbortSignal.timeout(1800_000) });
    if (!response.ok) {
      if (response.status === 403) { document.querySelector('#receiver-login').hidden = false; throw new Error('Questo file richiede l’accesso del destinatario indicato. Accedi qui sotto, poi riprova.'); }
      if (response.status === 404) throw new Error('Link scaduto, revocato, non valido o download esauriti. Chiedi un nuovo link al mittente.');
      throw new Error(`Servizio temporaneamente non disponibile (${response.status}). Riprova più tardi.`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(declared) || declared < 36 || declared > max) throw new Error('Dimensione non valida.');
    // Bound the received data even if a server sends a dishonest length.
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > declared || total > max) { await reader.cancel(); throw new Error('File troppo grande.'); }
      chunks.push(value);
    }
    if (total !== declared) throw new Error('Trasferimento incompleto.');
    const encrypted = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { encrypted.set(chunk, offset); offset += chunk.length; }
    const { name, data } = await decryptFile(encrypted.buffer, parts[2], max);
    const file = new File([data], name, { type: 'application/octet-stream' });
    objectURL = URL.createObjectURL(file);
    save.href = objectURL; save.download = name; save.hidden = false;
    receive.hidden = true;
    if(details?.summary?.text) { const summary=document.querySelector('#receiver-summary'); summary.hidden=false; summary.textContent='Riepilogo del mittente da verificare: '+details.summary.text; }
    status.textContent = `${name} · ${new Intl.NumberFormat('it-IT').format(data.byteLength)} byte. Decifrato: ora puoi salvarlo.`;
    if (navigator.canShare?.({ files: [file] })) {
      share.hidden = false;
      share.onclick = async () => {
        try { await navigator.share({ files: [file] }); }
        catch (error) { if (error.name !== 'AbortError') status.textContent = 'Condivisione non disponibile. Usa “Salva il file”.'; }
      };
    }
  } catch (error) {
    status.textContent = error.name === 'OperationError' ? 'Impossibile verificare il file: chiave errata o contenuto alterato.' : error.message;
    receive.disabled = false;
    receive.textContent = 'Riprova (un altro tentativo)';
  }
});
addEventListener('pagehide', () => { if (objectURL) URL.revokeObjectURL(objectURL); });

document.querySelector('#receiver-login').addEventListener('submit', async event => {
  event.preventDefault(); const input=document.querySelector('#receiver-token');
  try { const response=await fetch('/v1/session',{method:'POST',headers:{authorization:'Bearer '+input.value.trim()},credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error('Credenziale non valida.'); input.value=''; event.target.hidden=true; status.textContent='Accesso effettuato. Premi Riprova per ricevere il file.';
  } catch(error) {status.textContent=error.message;}
});
