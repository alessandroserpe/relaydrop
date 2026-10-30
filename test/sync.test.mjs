import test from 'node:test';
import assert from 'node:assert/strict';
import { watchInbox } from '../public/sync.js';
const wait = () => new Promise(resolve => setTimeout(resolve, 35));
function fixture(t, overrides = {}) {
  const target = new EventTarget(), page = new EventTarget(), worker = new EventTarget();
  page.visibilityState = 'visible';
  let calls = 0;
  const errors = [];
  const stop = watchInbox({target, page, worker, enabled:()=>true, refresh:async()=>{calls++;}, onError:e=>errors.push(e), delay:5, interval:100000, ...overrides});
  t.after(stop);
  return {target,page,worker,errors,stop,get calls(){return calls;}};
}
test('returning to an open inbox coalesces lifecycle events and receives push updates', async t => {
  const f=fixture(t);
  f.target.dispatchEvent(new Event('focus'));
  f.target.dispatchEvent(new Event('pageshow'));
  f.page.dispatchEvent(new Event('visibilitychange'));
  await wait(); assert.equal(f.calls,1);
  f.worker.dispatchEvent(new MessageEvent('message',{data:{type:'unrelated'}}));
  await wait(); assert.equal(f.calls,1);
  f.worker.dispatchEvent(new MessageEvent('message',{data:{type:'relaydrop-inbox-updated'}}));
  await wait(); assert.equal(f.calls,2);
});
test('hidden or signed-out inboxes do not poll; returning online refreshes without a push', async t => {
  let signedIn=false;
  const f=fixture(t,{enabled:()=>signedIn,interval:15});
  await wait(); assert.equal(f.calls,0);
  signedIn=true;f.page.visibilityState='hidden';
  f.target.dispatchEvent(new Event('online'));
  await wait(); assert.equal(f.calls,0);
  f.page.visibilityState='visible';
  f.target.dispatchEvent(new Event('online'));
  await wait(); assert.ok(f.calls>=1);
  f.stop();const previous=f.calls;await wait();assert.equal(f.calls,previous);
});
test('a push during a pending refresh triggers one follow-up without overlapping requests', async t => {
  let calls=0, release;
  const f=fixture(t,{refresh:async()=>{calls++;if(calls===1)await new Promise(resolve=>{release=resolve;});}});
  f.target.dispatchEvent(new Event('focus'));await wait();assert.equal(calls,1);
  f.worker.dispatchEvent(new MessageEvent('message',{data:{type:'relaydrop-inbox-updated'}}));
  await wait();assert.equal(calls,1);
  release();await wait();assert.equal(calls,2);
});
test('failed refresh is reported and can recover on the next resume', async t => {
  let calls=0;
  const failure=new Error('offline');
  const f=fixture(t,{refresh:async()=>{if(++calls===1)throw failure;}});
  f.target.dispatchEvent(new Event('focus'));await wait();assert.deepEqual(f.errors,[failure]);
  f.target.dispatchEvent(new Event('online'));await wait();assert.equal(calls,2);
});
