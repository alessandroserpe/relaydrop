// Refresh metadata only. File contents are downloaded solely by an explicit action.
export function watchInbox({ target = window, page = document, worker = navigator.serviceWorker, enabled, refresh, onError, delay = 400, interval = 30000 }) {
  let timer, running = false, pending = false, stopped = false;
  const available = () => !stopped && page.visibilityState === 'visible' && enabled();
  async function run() {
    timer = undefined;
    if (!available()) return;
    if (running) { pending = true; return; }
    running = true;
    try { await refresh(); } catch (error) { if (!stopped) onError(error); }
    finally {
      running = false;
      if (pending) { pending = false; schedule(); }
    }
  }
  function schedule() {
    if (!available()) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }
  const onMessage = event => { if (event.data?.type === 'relaydrop-inbox-updated') schedule(); };
  for (const name of ['focus', 'pageshow', 'online']) target.addEventListener(name, schedule);
  page.addEventListener('visibilitychange', schedule);
  worker?.addEventListener('message', onMessage);
  const poll = setInterval(schedule, interval);
  return () => {
    stopped = true; clearTimeout(timer); clearInterval(poll);
    for (const name of ['focus', 'pageshow', 'online']) target.removeEventListener(name, schedule);
    page.removeEventListener('visibilitychange', schedule);
    worker?.removeEventListener('message', onMessage);
  };
}
