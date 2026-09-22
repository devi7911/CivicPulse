/// <reference lib="webworker" />
// Service worker: lets CivicPulse open without a connection and shows push notifications.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// The app itself (HTML, JS, CSS, fonts, icons) is cached at install.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Any page address opens the cached app when offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Report photos and map tiles are kept for a while so recently seen screens still look right offline.
registerRoute(({ url }) => url.pathname.includes('/storage/v1/object/public/'),
  new CacheFirst({ cacheName: 'photos', plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 86400 })] }));
registerRoute(({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
  new CacheFirst({ cacheName: 'map-tiles', plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 14 * 86400 })] }));
// Public data (feed, events, helplines) is refreshed when online and served from cache when not.
registerRoute(({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/rest/v1/'),
  new NetworkFirst({ cacheName: 'api', networkTimeoutSeconds: 6, plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 3 * 86400 })] }));

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try { data = event.data?.json() ?? {}; } catch { data = { title: 'CivicPulse', body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title ?? 'CivicPulse', {
    body: data.body ?? '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag,
    data: { url: data.url ?? '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data?.url as string) ?? '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url.startsWith(self.location.origin));
    if (open) { await open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
