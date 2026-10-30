import test from 'node:test';
import assert from 'node:assert/strict';
import {inboxPreferences,isNewArrival,expirationLabel} from '../public/inbox.js';
test('new-arrival and notification preferences stay local, isolated by account, without storing names or keys',()=>{
 const map=new Map();const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const a=inboxPreferences(storage,'alice'),b=inboxPreferences(storage,'bob');const id='a'.repeat(32);
 assert.equal(a.notify,false);assert.equal(isNewArrival({id,sender_device_ids:['mac']},new Set(['mac']),a),false);
 assert.equal(isNewArrival({id,sender_device_ids:['phone']},new Set(['mac']),a),true);
 a.setNotify(true);a.markSeen(id);
 const restored=inboxPreferences(storage,'alice');assert.equal(restored.notify,true);assert.equal(isNewArrival({id},new Set(),restored),false);
 assert.equal(b.notify,false);assert.equal(b.hasSeen(id),false);
 const broken=inboxPreferences({getItem:()=>{throw Error();},setItem:()=>{throw Error();}},'alice');assert.equal(broken.setNotify(true),false);broken.markSeen(id);assert.equal(broken.hasSeen(id),true);
});
test('expiry labels use calendar days across month boundaries and distinguish expired files',()=>{
 const now=new Date(2026,9,31,18);
 assert.equal(expirationLabel(null,now),'Senza scadenza');
 assert.equal(expirationLabel(new Date(2026,9,31,20),now),'Oggi alle 20:00');
 assert.equal(expirationLabel(new Date(2026,10,1,12),now),'Domani alle 12:00');
 assert.equal(expirationLabel(new Date(2026,9,31,17),now),'In eliminazione');
});
