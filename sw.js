// Service Worker para EMOJIGHOST - Permite funcionamento offline total
const CACHE_NAME = 'emojighost-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './emojirepo.py.txt'
];

// Instalação do Service Worker e Cache de recursos estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removendo cache antigo:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Estratégia de Cache: Cache First, Fallback Network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cacheia novas requisições dinamicamente (ex: pako.js da CDN)
        if (event.request.url.startsWith('http') && event.request.method === 'GET') {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }
        return networkResponse;
      }).catch(() => {
        // Caso falhe e não esteja em cache
        return new Response('Rede indisponível. Funcionalidades de API externas desabilitadas.', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    })
  );
});
