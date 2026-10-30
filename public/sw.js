// No fetch handler or offline cache: private pages, keys and files are never cached here.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil(Promise.all([self.registration.showNotification('RelayDrop', {
    body: 'Un nuovo file è disponibile nella tua casella privata.',
    icon: '/v1/push/icon-192.png', tag: 'relaydrop-inbox'
  }), self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    for (const client of windows) client.postMessage({ type: 'relaydrop-inbox-updated' });
  })]));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const inbox = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === self.location.origin && ['/', '/dashboard'].includes(url.pathname);
    });
    if (inbox) { await inbox.navigate('/dashboard'); return inbox.focus(); }
    return self.clients.openWindow('/dashboard');
  })());
});
