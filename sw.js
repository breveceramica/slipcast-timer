/* Slipcast Timer — service worker
 *
 * Faz duas coisas:
 *
 * 1. NOTIFICAÇÕES. No Chrome/Android o construtor `new Notification()` é
 *    proibido — notificações precisam sair de um service worker, via
 *    registration.showNotification(). No iPhone o caminho é o mesmo, e o app
 *    ainda precisa estar adicionado à Tela de Início.
 *
 * 2. OFFLINE. Guarda o app em cache para ele abrir sem internet — no ateliê
 *    o WiFi cai, e um timer que não abre não serve pra nada.
 *    Estratégia: responde do cache na hora (rápido e offline) e atualiza em
 *    segundo plano, então a próxima abertura já pega a versão nova.
 */

const CACHE = 'slipcast-v7';
const ARQUIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ARQUIVOS))
      .catch(() => {})          // um arquivo faltando não pode travar a instalação
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const salvo = await cache.match(req, { ignoreSearch: true });

    // Busca em segundo plano e atualiza o cache para a próxima vez.
    // `cache: 'no-cache'` força revalidação com o servidor — sem isso o cache
    // HTTP do navegador pode devolver a versão velha e a atualização nunca chega.
    const rede = fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then(res => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);

    if (salvo) { e.waitUntil(rede); return salvo; }
    const res = await rede;
    return res || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});

// Toque na notificação: foca a aba já aberta ou abre o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abas) if ('focus' in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
