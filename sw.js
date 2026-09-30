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
 *
 *    Página (HTML): REDE PRIMEIRO, cache só se estiver offline ou a rede
 *    demorar mais de 4s. Antes era "cache primeiro, atualiza em segundo
 *    plano", o que fazia cada versão nova só aparecer na abertura SEGUINTE —
 *    e no iPhone isso deixava o app preso numa versão antiga.
 *    Ícones e manifest: cache primeiro, atualizando em segundo plano.
 */

const CACHE = 'slipcast-v10';
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
      .then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' }))))
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

  // Navegação (a página em si): rede primeiro, com prazo
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })),
          new Promise((_, rej) => setTimeout(() => rej(new Error('lenta')), 4000)),
        ]);
        if (res && res.ok) cache.put('./', res.clone()).catch(() => {});
        return res;
      } catch (err) {
        return (await cache.match(req, { ignoreSearch: true }))
            || (await cache.match('./'))
            || (await cache.match('./index.html'))
            || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

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
