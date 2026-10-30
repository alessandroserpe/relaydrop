// Local UI preferences only: no credentials, file names, contents or encryption keys.
export function inboxPreferences(storage, userId) {
  const key='relaydrop.inbox.'+userId;
  let data;
  try{data=JSON.parse(storage.getItem(key));}catch{}
  let seen=new Set((Array.isArray(data?.seen)?data.seen:[]).filter(id=>/^[A-Za-z0-9_-]{32}$/.test(id)).slice(-500));
  let notify=data?.notify===true;
  function save(){try{storage.setItem(key,JSON.stringify({notify,seen:[...seen].slice(-500)}));return true;}catch{return false;}}
  return {get notify(){return notify;},setNotify(value){notify=Boolean(value);return save();},hasSeen:id=>seen.has(id),markSeen(id){seen.add(id);seen=new Set([...seen].slice(-500));save();}};
}
export function isNewArrival(record, localIds, preferences) {
  return !preferences.hasSeen(record.id) && !(record.sender_device_ids || []).some(id=>localIds.has(id));
}
export function expirationLabel(value, now=new Date()) {
  if(value===null)return 'Senza scadenza';
  const expiry=new Date(value);
  const day=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
  const delta=(day(expiry)-day(now))/86400000;
  const clock=new Intl.DateTimeFormat('it-IT',{hour:'2-digit',minute:'2-digit'}).format(expiry);
  if(expiry<=now)return 'In eliminazione';
  if(delta===0)return 'Oggi alle '+clock;
  if(delta===1)return 'Domani alle '+clock;
  return new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(expiry);
}

// datetime-local uses the device timezone; only ISO UTC timestamps cross the API.
export function localDateTime(value) {
  const d=new Date(value),pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
