import { inboxPreferences, isNewArrival, expirationLabel, localDateTime } from '/v1/browser/inbox.js';
import { enrollDevice, localDevices, removeLocalDevice, unlockTransfer, shareTransferKeys } from './vault.js';
import { configurePushUI } from '/v1/push/client.js';
import { encryptBrowserFile, receiveFile } from '/v1/browser/files.js';
import { watchInbox } from '/v1/browser/sync.js';
const $ = selector => document.querySelector(selector);
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
let user, transfers = [], events = [], identities = [], devices = [], selected, limits, selectedView, browserSession;
const downloading=new Set(), prepared=new Map();
const retentionDrafts=new Map();
let preferences, myDeviceIds=new Set(), uploading=false, uploadPolicy;
let keySyncPending=0,keySyncFailed=false;
const bytes = n => n < 1024 ? `${n} byte` : n < 1024**2 ? `${(n/1024).toFixed(1)} KiB` : n < 1024**3 ? `${(n/1024**2).toFixed(1)} MiB` : `${(n/1024**3).toFixed(2)} GiB`;
const date = value => value ? new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';
const names = { uploaded:'File caricato',download_started:'Download avviato',download_transferred:'Trasferimento completato',download_interrupted:'Trasferimento interrotto',revoked:'File revocato',expired:'File scaduto',exhausted:'Tentativi esauriti',retention_changed:'Conservazione modificata',device_keys_shared:'Chiavi sincronizzate con un nuovo browser',settings_changed:'Limiti modificati',notification_accepted:'Avviso accettato dal servizio',notification_failed:'Invio avviso fallito',notification_skipped:'Avviso non necessario sul mittente' };
function message(text = '', error = false) { $('#message').textContent = text; $('#message').classList.toggle('error',error); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type':'application/json', ...options.headers }, credentials:'same-origin', redirect:'error', signal:AbortSignal.timeout(30000) });
  if (!response.ok) { const error = new Error(response.status === 401 ? 'Sessione non valida o scaduta. Accedi di nuovo.' : response.status === 403 ? 'Operazione non consentita per questo utente.' : response.status === 429 ? 'Troppe richieste. Attendi un minuto e riprova.' : `Operazione non riuscita (${response.status}). Verifica i valori e riprova.`); error.status = response.status; throw error; }
  return response.json();
}
function switchTab(name) {
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== name;
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === name) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  }
  message();
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => switchTab(button.dataset.tab);
function renderFiles() {
  const query = $('#search').value.toLocaleLowerCase('it-IT');
  const filter = $('#filter').value;
  const visible = [...transfers].sort((a,b)=>(b.created_at||0)-(a.created_at||0)||b.id.localeCompare(a.id)).filter(t => (!query || [t.unlocked?.name,t.uploader_name,t.id].filter(Boolean).join(' ').toLocaleLowerCase('it-IT').includes(query)) &&
    (filter !== 'mine' || t.uploaded_by === user.id) && (filter !== 'received' || t.recipient_id === user.id));
  const rows = visible.map(t => {
    const row = el('tr'); row.dataset.id = t.id; row.classList.toggle('selected',t.id === selected);
    const nameCell = el('td');nameCell.className='file-name';
    const heading=el('div',undefined,'file-title');heading.append(el('strong',t.unlocked?.name || 'File cifrato'));
    if(preferences && isNewArrival(t,myDeviceIds,preferences)){heading.append(el('span','Nuovo','new-badge'));row.classList.add('new-arrival');}
    nameCell.append(heading,el('span',t.unlocked?.summary ? 'Riepilogo disponibile' : (t.sender_device_ids||[]).some(id=>myDeviceIds.has(id))?'Inviato da questo dispositivo':t.uploader_name,'file-sub'));
    const actions=el('div',undefined,'file-actions');
    const download=el('button',downloading.has(t.id)?'Download…':'Scarica');download.disabled=!t.unlocked || downloading.has(t.id);
    download.setAttribute('aria-busy',String(downloading.has(t.id)));
    if(!t.unlocked){download.title=keyHelp(t);nameCell.append(el('span',keyHelp(t),'file-sub'));}
    download.setAttribute('aria-label','Scarica '+(t.unlocked?.name || 'file cifrato'));
    download.onclick=()=>downloadFile(t);actions.append(download);
    if(t.unlocked?.summary){const summary=el('button','Riepilogo','secondary');summary.onclick=()=>showSummary(t.id,true);actions.append(summary);}
    const detail=el('button','Dettagli','quiet');detail.onclick=()=>showDetails(t.id,true);actions.append(detail);
    if(prepared.has(t.id)){const saved=prepared.get(t.id);const retry=el('a','Salva di nuovo','quiet');retry.href=saved.url;retry.download=saved.name;actions.append(retry);}
    nameCell.append(actions);
    row.append(nameCell,...[['Arrivato',date(t.created_at)],['Dimensione',bytes(t.bytes)],['Scadenza',expirationLabel(t.expires_at)]].map(([label,value])=>{const cell=el('td',value);cell.dataset.label=label;return cell;}));return row;
  });
  $('#file-rows').replaceChildren(...rows); $('#empty').hidden = visible.length > 0;
  const fresh=transfers.filter(t=>preferences && isNewArrival(t,myDeviceIds,preferences)).length;
  $('#recent-status').textContent=(fresh?`${fresh} ${fresh===1?'nuovo arrivo':'nuovi arrivi'}. `:'')+'Gli ultimi arrivi sono in cima.';
  $('#overview').textContent = `${transfers.length} file disponibili`;
}
function showDetails(id, focus=false) {
  if(focus){preferences.markSeen(id);renderFiles();}
  selectedView="details";
  selected = id; const t = transfers.find(t => t.id === id); if (!t) return;
  for (const row of document.querySelectorAll('#file-rows tr')) row.classList.toggle('selected',row.dataset.id === id);
  const panel = $('#details-panel');panel.hidden=false;
  const dl = el('dl');
  for (const [label,value] of [['Caricato da',t.uploader_name],['Destinatario',identities.find(p=>p.id===t.recipient_id)?.name || t.recipient_id || 'Chi possiede il link'],['Accesso',t.require_recipient ? 'Identità richiesta' : 'Link privato'],['Scadenza',expirationLabel(t.expires_at)],['Download disponibili',t.max_downloads===null?'Senza limite':`${Math.max(0,t.max_downloads-t.downloads)} di ${t.max_downloads}`],['Avviso',t.notification === 'accepted' ? 'Accettato dal servizio' : t.notification === 'failed' ? 'Fallito' : t.notification === 'skipped' ? 'Nessun altro dispositivo da avvisare' : 'Non richiesto']]) dl.append(el('dt',label),el('dd',value));
  panel.replaceChildren(el('h2',t.unlocked?.name || 'File cifrato'),dl);
  const close=el('button','Chiudi dettagli','quiet');close.onclick=()=>{selected=null;panel.hidden=true;};panel.prepend(close);
  if(!t.unlocked)panel.append(el('p',keyHelp(t),'muted'));
  if(focus){panel.focus({preventScroll:true});panel.scrollIntoView({block:'nearest'});}
  if (t.can_manage) {
    if(uploadPolicy.allowRetention)panel.append(retentionEditor(t));
    else panel.append(el('p','Per modificare la conservazione, l’amministratore deve abilitarla in Impostazioni.','muted'));
    const revoke = el('button','Revoca il file','danger');
    revoke.onclick = async () => { revoke.disabled = true; try { await api('/v1/transfers/'+id,{method:'DELETE'}); selected=null; await reloadData(); panel.replaceChildren(el('h2','File revocato'),el('p','Le nuove richieste sono bloccate. I trasferimenti già avviati possono terminare.')); message('Revoca completata.'); } catch(e){message(e.message,true);revoke.disabled=false;} };
    panel.append(revoke);
  }
  const activity = events.filter(e=>e.transfer_id===id).slice(0,5);
  if (activity.length) { panel.append(el('h3','Ultima attività')); for(const e of activity) panel.append(el('p',`${names[e.type] || e.type} · ${e.actor_name}\n${date(e.at)}`,'muted')); }
}
function chosenDeadline(value, policy) {
  const time=new Date(value).getTime();
  if(!value || !Number.isFinite(time) || time<=Date.now() || time>Date.now()+policy.maxTTL*1000)throw Error('Scegli una data futura entro '+date(Date.now()+policy.maxTTL*1000)+'.');
  return new Date(time).toISOString();
}
function keyHelp(t){
  if(user.role==='admin' && t.uploaded_by!==user.id && t.recipient_id!==user.id)return 'Accesso amministrativo ai metadati. Per il contenuto usa la casella personale destinataria.';
  if(t.unlockError)return 'La chiave locale non verifica il file. Prova da un altro dispositivo che riesce già ad aprirlo.';
  return myDeviceIds.size?'Chiave da sincronizzare: apri RelayDrop su un dispositivo che può già leggere questo file.':'Registra questo browser; poi apri RelayDrop su un dispositivo che può già leggere il file.';
}
function renderKeySync(){
  const missing=transfers.filter(t=>!t.unlocked && (t.uploaded_by===user.id || t.recipient_id===user.id));
  $('#key-sync-banner').hidden=!missing.length&&!keySyncPending&&!keySyncFailed;
  $('#key-sync-state').textContent=missing.length?
    (myDeviceIds.size?`${missing.length} file attendono le chiavi su questo browser. Apri RelayDrop su un tuo dispositivo che li può già leggere e lascialo aperto per circa un minuto: la sincronizzazione è automatica, senza reinviare i file.`:'Registra questo browser per ricevere i file. Per quelli già condivisi, apri poi RelayDrop anche su un dispositivo che può già leggerli.'):
    keySyncFailed?'La sincronizzazione delle chiavi non è riuscita. I file già accessibili restano disponibili; premi Aggiorna i file per riprovare.':`Sincronizzazione di ${keySyncPending} file verso i nuovi browser. Lascia aperta la casella: le chiavi restano cifrate durante il passaggio.`;
  $('#key-sync-action').textContent=myDeviceIds.size?'Aggiorna i file':'Registra questo browser';
}
function retentionEditor(t) {
  const draft=retentionDrafts.get(t.id) || {mode:t.expires_at===null?'keep':'date',value:localDateTime(t.expires_at ?? Date.now()+Math.min(86400,uploadPolicy.maxTTL)*1000),dirty:false,saving:false};
  retentionDrafts.set(t.id,draft);
  const form=el('form',undefined,'retention-editor');form.id='retention-form';form.append(el('h3','Conservazione'));
  const label=el('label','Come conservare questo file');label.htmlFor='file-retention';
  const choice=el('select');choice.id='file-retention';
  for(const [value,text] of [['date','Fino a una data e ora'],['keep','Senza scadenza']]){const option=el('option',text);option.value=value;choice.append(option);}choice.value=draft.mode;
  const dateLabel=el('label','Elimina il (ora di questo dispositivo)');dateLabel.htmlFor='file-expires';
  const input=el('input');input.id='file-expires';input.type='datetime-local';input.step='60';input.value=draft.value;
  input.min=localDateTime(Date.now()+60000);input.max=localDateTime(Date.now()+uploadPolicy.maxTTL*1000);dateLabel.append(input);
  const note=el('p',undefined,'muted');const save=el('button','Salva conservazione');save.type='submit';
  const render=()=>{dateLabel.hidden=choice.value==='keep';input.required=!dateLabel.hidden;choice.disabled=input.disabled=draft.saving;save.disabled=!draft.dirty||draft.saving;
    note.textContent=choice.value==='keep'?'Il file non verrà eliminato automaticamente e non avrà limiti di download. Occuperà spazio fino alla revoca manuale.':'Il file resterà disponibile fino alla data scelta, senza limiti di download. Data massima: '+date(Date.now()+uploadPolicy.maxTTL*1000)+'.';};
  choice.onchange=()=>{draft.mode=choice.value;draft.dirty=true;render();};input.oninput=()=>{draft.value=input.value;draft.dirty=true;render();};
  form.append(label,choice,dateLabel,note,save);render();
  form.onsubmit=async event=>{event.preventDefault();if(draft.saving)return;
    try{const expires=draft.mode==='keep'?null:chosenDeadline(draft.value,uploadPolicy);draft.saving=true;render();
      await api('/v1/transfers/'+t.id,{method:'PATCH',body:JSON.stringify({expires_at:expires})});retentionDrafts.delete(t.id);
      await reloadData();message(expires===null?'File conservato senza scadenza. Download senza limite.':'Scadenza aggiornata. Download senza limite.');
    }catch(error){message(error.message,true);}finally{draft.saving=false;render();}};
  return form;
}
function showSummary(id,focus=false) {
  if(focus){preferences.markSeen(id);renderFiles();}
  selected=id;selectedView='summary';const t=transfers.find(t=>t.id===id);if(!t)return;
  const panel=$('#details-panel');panel.hidden=false;
  const close=el('button','Chiudi riepilogo','quiet');close.onclick=()=>{selected=null;panel.hidden=true;};
  panel.replaceChildren(close,el('h2',t.unlocked?.name || 'File cifrato'),el('h3','Riepilogo'),el('p',t.unlocked?.summary?.text || 'Nessun riepilogo disponibile.','summary'),el('p','Il riepilogo non sostituisce il documento. La lettura qui non avvia un download.','muted'));
  if(focus){panel.focus({preventScroll:true});panel.scrollIntoView({block:'nearest'});}
}
async function downloadFile(t) {
  if(downloading.has(t.id))return;
  if(t.bytes>100*1024**2 && !confirm('Questo file supera 100 MiB e richiede memoria sul dispositivo. Continuare il download?'))return;
  downloading.add(t.id);renderFiles();message('Download in corso…');
  try {
    const result=await receiveFile(t);
    if(prepared.has(t.id))URL.revokeObjectURL(prepared.get(t.id).url);
    const url=URL.createObjectURL(new Blob([result.data],{type:'application/octet-stream'}));prepared.set(t.id,{url,name:result.name});
    const link=el('a');link.href=url;link.download=result.name;document.body.append(link);link.click();link.remove();
    setTimeout(()=>{if(prepared.get(t.id)?.url===url){URL.revokeObjectURL(url);prepared.delete(t.id);renderFiles();}},300000);
    message('Download richiesto. Se il browser non avvia il salvataggio, usa “Salva di nuovo” sul file.');
    t.downloads++;preferences.markSeen(t.id);renderEvents();
  } catch(error){message(error.name==='OperationError'?'Il file non supera la verifica di integrità. Nessun download salvato.':error.message,true);}
  finally{downloading.delete(t.id);renderFiles();}
}
addEventListener('pagehide',()=>{for(const item of prepared.values())URL.revokeObjectURL(item.url);prepared.clear();});
function renderSummaries() {
  const items=transfers.filter(t=>t.unlocked?.summary?.text);
  $('#summary-list').replaceChildren(...items.map(t=>{const section=el('article',undefined,'summary-item');
    section.append(el('h3',t.unlocked.name),el('p',t.uploader_name+' · '+date(t.created_at),'muted'),el('p',t.unlocked.summary.text,'summary'));
    const button=el('button','Scarica','secondary');button.onclick=()=>downloadFile(t);section.append(button);return section;}));
  if(!items.length)$('#summary-list').append(el('p','Nessun riepilogo accessibile in questo browser. Registra il browser e chiedi al mittente di allegare un riepilogo al prossimo invio.','empty'));
}
function renderEvents() {
  $('#events').replaceChildren(...events.map(e=> {
    const item=el('li'); const time=el('time',date(e.at));time.dateTime=new Date(e.at).toISOString();
    const action=el('div',names[e.type] || e.type);if(e.transfer_id)action.append(el('small','File '+e.transfer_id.slice(0,10)));
    item.append(time,action,el('span',e.actor_name));return item;
  })); $('#events-empty').hidden=events.length>0;
}
async function renderDevices() {
  const local = await localDevices();
  $('#device-list').replaceChildren(...devices.map(d=> {
    const item=el('li'); const label=el('span',d.name);label.append(el('small',local.some(l=>l.id===d.id) ? 'Chiave disponibile in questo browser' : 'Chiave su un altro browser'));
    const remove=el('button','Rimuovi','quiet');remove.onclick=async()=>{try{await api('/v1/devices/'+d.id,{method:'DELETE'});await removeLocalDevice(d.id);await reloadData();message('Browser rimosso dai nuovi invii. I file già ricevuti non sono revocati.');}catch(e){message(e.message,true);}};
    item.append(label,remove);return item;
  }));
  await configurePushUI(user, devices, api, reloadData);
}
function renderSettings() {
  if(!limits)return; const f=$('#settings-form').elements;
  f.namedItem('file').value=limits.maxFileBytes/1024**2; f.namedItem('storage').value=limits.maxBytes/1024**3;
  f.namedItem('transfers').value=limits.maxTransfers; f.namedItem('ttl').value=limits.maxTTL/3600;
  f.namedItem('downloads').value=limits.maxDownloads; f.namedItem('audit').value=limits.auditDays;
  f.namedItem('retention').checked=limits.allowRetention;
  $('#storage-status').textContent=`Occupati ${bytes(limits.usedBytes)} su ${bytes(limits.maxBytes)}. In upload: ${bytes(limits.reservedBytes)}.`;
}
let reloadQueue = Promise.resolve();
function reloadData(options = {}) {
  const next = reloadQueue.then(() => loadData(options));
  reloadQueue = next.catch(() => {});
  return next;
}
async function loadData({ inboxOnly = false } = {}) {
  if (!user) return;
  $('#refresh').disabled=true;
  try {
    if (inboxOnly) {
      [transfers,events,devices]=await Promise.all([api('/v1/transfers'),api('/v1/events'),api('/v1/devices')]);
    } else {
    [transfers,events,identities,devices,limits,browserSession,uploadPolicy]=await Promise.all([api('/v1/transfers'),api('/v1/events'),api('/v1/identities'),api('/v1/devices'),user.role==='admin'?api('/v1/settings'):null,api('/v1/session'),api('/v1/policy')]);
    user=identities.find(p=>p.id===user.id) || user;
    $('#upload-notify').disabled=!user.notifications;
    renderSession();
    $('#upload-policy').textContent=`Fino a ${bytes(Math.min(uploadPolicy.maxFileBytes,100*1024**2))} per file. La conservazione scelta vale solo per il prossimo invio.`;
    renderUploadRetention();
    }
    const keys=await localDevices();
    myDeviceIds=new Set(keys.filter(d=>d.user_id===user.id && devices.some(remote=>remote.id===d.id)).map(d=>d.id));
    for(const t of transfers){try{t.unlocked=await unlockTransfer(t,user.id,keys);}catch{t.unlocked=null;t.unlockError=true;}}
    const toSync=transfers.filter(t=>t.unlocked && devices.some(d=>d.user_id===user.id && !t.envelopes.some(e=>e.device_id===d.id)));
    keySyncPending=toSync.length;keySyncFailed=false;
    // Bound background work to stay within the shared request budget. Further files follow on the next refresh.
    for(const t of toSync.slice(0,4)){try{await shareTransferKeys(t,user.id,devices,api);keySyncPending--;}catch{keySyncFailed=true;break;}}
    renderKeySync();
    renderFiles();renderSummaries();renderEvents();
    if(!inboxOnly){await renderDevices();renderSettings();}
    if(selected && !transfers.some(t=>t.id===selected)){selected=null;$('#details-panel').hidden=true;}
    for(const id of retentionDrafts.keys())if(!transfers.some(t=>t.id===id))retentionDrafts.delete(id);
    if(selected && !$('#retention-form')?.contains(document.activeElement))(selectedView==='summary'?showSummary:showDetails)(selected);
  } finally { $('#refresh').disabled=false; }
}
watchInbox({
  enabled:()=>Boolean(user) && !$('#workspace').hidden,
  refresh:()=>reloadData({inboxOnly:true}),
  onError:error=>{
    if(error.status===401){user=null;$('#workspace').hidden=true;$('#logout').hidden=true;$('#login-panel').hidden=false;}
    message(error.status===401?error.message:'La casella non si è aggiornata. Controlla la connessione o premi Aggiorna.',true);
  }
});
async function signedIn(me) {
  user=me;
  let storage;try{storage=localStorage;}catch{storage={getItem:()=>null,setItem:()=>{throw new Error('Storage unavailable');}};}
  preferences=inboxPreferences(storage,user.id);$('#upload-notify').checked=preferences.notify;
  $('#login-panel').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;
  $('#identity').textContent=me.name+(me.role==='admin' && me.name!=='Amministratore'?' · Amministratore':'');
  $('#workspace-title').textContent=me.role==='admin'?'Amministrazione':'La tua casella';
  $('#settings-tab').hidden=me.role!=='admin';await reloadData();
}
$('#login-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const secret=$('#login-token').value.trim();const me=await api('/v1/session',{method:'POST',headers:{authorization:'Bearer '+secret,'x-remember-device':$('#login-remember').checked?'1':'0'}});$('#login-token').value='';message();await signedIn(me);}catch(e){message(e.message,true);}finally{button.disabled=false;}};
$('#logout').onclick=async()=>{try{await api('/v1/session',{method:'DELETE'});location.reload();}catch(e){message(e.message,true);}};
$('#refresh').onclick=()=>reloadData().then(()=>message('Casella aggiornata.')).catch(e=>message(e.message,true));
$('#key-sync-action').onclick=async()=>{const button=$('#key-sync-action');button.disabled=true;try{if(!myDeviceIds.size)await enrollDevice('Questo browser',api);await reloadData();}catch(error){message(error.message,true);}finally{button.disabled=false;}};
$('#push-open').onclick=()=>{switchTab('devices');$('#notifications-card').scrollIntoView({behavior:'smooth',block:'start'});};
function uploadMessage(text,error=false){$('#upload-state').textContent=text;$('#upload-state').classList.toggle('error',error);}
$('#upload-notify').onchange=()=>{if(!preferences.setNotify($('#upload-notify').checked))message('La preferenza avvisi vale per questa apertura: il browser non consente di conservarla.');};
$('#pick-file').onclick=()=>{if(!uploading)$('#upload-file').click();};
$('#take-photo').onclick=()=>{if(!uploading)$('#upload-photo').click();};
for(const input of [$('#upload-file'),$('#upload-photo')])input.onchange=()=>{const file=input.files[0];input.value='';if(file)sendFile(file);};
const dropZone=$('#quick-send');
let dragDepth=0;
const fileDrag=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
dropZone.addEventListener('dragenter',event=>{if(fileDrag(event)){event.preventDefault();dragDepth++;if(!uploading)dropZone.classList.add('drag-over');}});
dropZone.addEventListener('dragover',event=>{if(fileDrag(event)){event.preventDefault();event.dataTransfer.dropEffect=uploading?'none':'copy';}});
dropZone.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;dropZone.classList.remove('drag-over');}});
dropZone.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;dropZone.classList.remove('drag-over');if(uploading)return;const files=event.dataTransfer.files;if(files.length!==1){uploadMessage('Trascina un solo file alla volta.',true);return;}sendFile(files[0]);});
// Prevent the browser from navigating away with local files dropped outside the target.
for(const type of ['dragover','drop'])document.addEventListener(type,event=>{if(fileDrag(event))event.preventDefault();});
async function sendFile(file) {
  if(uploading)return;uploading=true;
  const retentionMode=$('#upload-retention').value,retentionDate=$('#upload-expires').value;
  for(const id of ['pick-file','take-photo','upload-notify','upload-retention','upload-expires'])$('#'+id).disabled=true;
  dropZone.setAttribute('aria-busy','true');uploadMessage('Preparazione di '+file.name+'…');
  try {
    const policy=await api('/v1/policy');
    if(retentionMode!=='temporary' && !policy.allowRetention)throw Error('La conservazione deve essere abilitata dall’amministratore in Impostazioni.');
    const retentionHeaders=retentionMode==='keep'?{'x-keep':'1'}:retentionMode==='date'?{'x-expires-at':chosenDeadline(retentionDate,policy)}:
      {'x-ttl-seconds':String(Math.min(86400,policy.maxTTL)),'x-max-downloads':String(Math.min(20,policy.maxDownloads))};
    let ownDevices=await api('/v1/recipient-devices/'+encodeURIComponent(user.id));
    let local=(await localDevices()).filter(d=>d.user_id===user.id && ownDevices.some(remote=>remote.id===d.id));
    if(!local.length){const added=await enrollDevice('Questo dispositivo',api);local=[added];ownDevices=await api('/v1/recipient-devices/'+encodeURIComponent(user.id));}
    const encrypted=await encryptBrowserFile(file,ownDevices,policy.maxFileBytes);
    uploadMessage('Invio di '+file.name+'…');
    const notify=$('#upload-notify').checked && user.notifications;
    const response=await fetch('/v1/transfers',{method:'POST',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(1800000),body:encrypted.body,headers:{
      'content-type':'application/octet-stream','x-download-token-sha256':encrypted.tokenHash,'x-file-metadata':encrypted.metadata,
      'x-recipient-id':user.id,'x-require-recipient':'1','x-sender-device-ids':local.map(d=>d.id).join(','),
      ...retentionHeaders,...(notify?{'x-notify':'1'}:{})
    }});
    if(!response.ok)throw new Error(`Invio non riuscito (${response.status}). Nessun nuovo tentativo automatico.`);
    const result=await response.json();preferences.markSeen(result.id);
    $('#upload-retention').value='temporary';$('#upload-expires').value='';renderUploadRetention();
    $('#search').value='';$('#filter').value='all';
    try{await reloadData();}catch{message('File inviato. L’elenco non si è aggiornato: premi Aggiorna.',true);}
    uploadMessage(file.name+' inviato. '+(result.expires_at===null?'Conservato senza scadenza.':'Scadenza: '+expirationLabel(result.expires_at)+'.')+(result.notification==='failed'?' Il file è disponibile, ma l’avviso non è riuscito.':result.notification==='skipped'?' Nessun altro dispositivo da avvisare.':''));
  } catch(error){uploadMessage(error.name==='TimeoutError'?'Invio non confermato. Aggiorna la casella prima di riprovare, per evitare duplicati.':error.message,true);}
  finally{uploading=false;dropZone.removeAttribute('aria-busy');for(const id of ['pick-file','take-photo','upload-retention','upload-expires'])$('#'+id).disabled=false;$('#upload-notify').disabled=!user?.notifications;}
}
function renderUploadRetention(){
  if(!uploadPolicy)return;
  const choice=$('#upload-retention'),input=$('#upload-expires');
  for(const option of choice.options)if(option.value!=='temporary')option.disabled=!uploadPolicy.allowRetention;
  choice.options[0].textContent='Temporaneo (fino a '+Math.min(86400,uploadPolicy.maxTTL)/3600+' ore)';
  $('#upload-date-label').hidden=choice.value!=='date';
  if(choice.value==='date'&&!input.value)input.value=localDateTime(Date.now()+Math.min(86400,uploadPolicy.maxTTL)*1000);
  input.min=localDateTime(Date.now()+60000);input.max=localDateTime(Date.now()+uploadPolicy.maxTTL*1000);
  $('#upload-retention-help').textContent=choice.value==='keep'?'Non verrà eliminato automaticamente. Download senza limite; resta nello spazio del servizio fino alla revoca manuale.':choice.value==='date'?'Download senza limite fino alla data scelta. Data massima: '+date(Date.now()+uploadPolicy.maxTTL*1000)+'.':
    `Eliminazione alla scadenza o dopo ${Math.min(20,uploadPolicy.maxDownloads)} download.`+(!uploadPolicy.allowRetention?' L’amministratore può abilitare le altre opzioni in Impostazioni.':'');
}
$('#upload-retention').onchange=renderUploadRetention;
$('#search').oninput=renderFiles;$('#filter').onchange=renderFiles;
$('#device-form').onsubmit=async event=>{event.preventDefault();event.submitter.disabled=true;try{await enrollDevice($('#device-name').value,api);await reloadData();message('Browser registrato. I prossimi invii potranno essere aperti da questa casella.');}catch(e){message(e.message,true);}finally{event.submitter.disabled=false;}};
$('#settings-form').onsubmit=async event=>{event.preventDefault();event.submitter.disabled=true;const f=event.target.elements;const n=name=>Number(f.namedItem(name).value);try{await api('/v1/settings',{method:'PATCH',body:JSON.stringify({maxFileBytes:Math.round(n('file')*1024**2),maxBytes:Math.round(n('storage')*1024**3),maxTransfers:n('transfers'),maxTTL:Math.round(n('ttl')*3600),maxDownloads:n('downloads'),auditDays:n('audit'),allowRetention:f.namedItem('retention').checked})});await reloadData();message('Limiti salvati. La conservazione dei file esistenti non cambia.');}catch(e){message(e.message,true);}finally{event.submitter.disabled=false;}};
api('/v1/me').then(signedIn).catch(e=>{if(e.status!==401)message(e.message,true);});

function renderSession() {
  $('#session-remember').checked=Boolean(browserSession?.remember);
  $('#session-remember').disabled=!browserSession;
  $('#session-state').textContent=browserSession?.remember ? 'Accesso mantenuto su questo browser. Si rinnova mentre usi la casella e scade dopo circa 90 giorni di inattività. “Esci” lo termina subito.' : 'Sessione di 8 ore. Attiva questa opzione per mantenere l’accesso sul tuo dispositivo personale senza reinserire la credenziale.';
}
$('#session-remember').onchange=async()=>{
  const checkbox=$('#session-remember');checkbox.disabled=true;
  try{browserSession=await api('/v1/session',{method:'PATCH',body:JSON.stringify({remember:checkbox.checked})});message(browserSession.remember?'Accesso mantenuto su questo dispositivo.':'Accesso limitato alle prossime 8 ore.');}
  catch(error){message(error.message,true);}
  finally{renderSession();}
};
