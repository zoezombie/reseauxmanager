// Service worker : reçoit les notifications et ouvre la bonne vue quand on les touche.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Plateau', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Plateau', {
    body: d.body || '',
    tag: d.tag,
    data: { url: d.url || '/' },
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        try { await w.navigate(url); } catch {}
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
