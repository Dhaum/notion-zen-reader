// public/sw.js - PWA 오프라인 캐싱, 영구 이미지 보존 및 백그라운드 동기화 서비스 워커
const CACHE_NAME = 'zen-reader-v4';
const IMAGE_CACHE_NAME = 'zen-images-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/storage-idb.js',
  '/js/app.js',
  '/js/reader.js',
  '/js/dashboard.js',
  '/js/offline.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png'
];

// 노션 및 AWS S3 이미지 URL 판별
function isNotionImageUrl(url) {
  const host = url.hostname.toLowerCase();
  const href = url.href.toLowerCase();
  return (
    host.includes('amazonaws.com') ||
    host.includes('notion.so') ||
    host.includes('notion-static.com') ||
    href.includes('prod-files-secure') ||
    href.includes('secure.notion-static.com') ||
    href.includes('notion.so/image') ||
    href.includes('s3.us-west-2.amazonaws.com')
  );
}

// S3 Presigned URL의 1시간 만료/쿼리스트링 변경에 대응하는 3단계 정밀 캐시 탐색
async function findCachedImage(cache, request) {
  // 1단계: 정확한 요청 URL 매칭
  let match = await cache.match(request);
  if (match) return match;

  // 2단계: 쿼리 파라미터(?X-Amz-Signature=...)를 무시한 매칭
  match = await cache.match(request, { ignoreSearch: true });
  if (match) return match;

  // 3단계: 동일한 S3 파일 pathname 매칭 (Presigned URL 시그니처 갱신 대응)
  try {
    const reqUrl = new URL(request.url);
    const keys = await cache.keys();
    for (const key of keys) {
      const keyUrl = new URL(key.url);
      if (keyUrl.pathname === reqUrl.pathname) {
        return await cache.match(key);
      }
    }
  } catch (e) {}

  return null;
}

// 1. 설치 단계: 정적 셸(Shell) 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] 정적 에셋 사전 캐싱');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. 활성화 단계: 구버전 정적 캐시 정리 (※ zen-images-v1 영구 캐시는 절대 보존!)
self.addEventListener('activate', (event) => {
  const PRESERVED_CACHES = [CACHE_NAME, IMAGE_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (!PRESERVED_CACHES.includes(key)) {
            console.log('[ServiceWorker] 구버전 캐시 삭제:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. 패치 단계
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // POST 요청(학습 로그 저장 등)은 캐싱 제외하고 통과
  if (event.request.method !== 'GET') {
    return;
  }

  // A. 노션 S3 이미지 URL 영구 캐싱 & 1시간 만료(403) 차단 Fallback
  if (isNotionImageUrl(url) || (event.request.destination === 'image' && !url.origin.includes(self.location.origin))) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const cachedResponse = await findCachedImage(cache, event.request);

      const fetchPromise = fetch(event.request)
        .then(async (networkResponse) => {
          // 정상 응답(200 OK) 또는 no-cors 불투명(opaque) 응답인 경우 영구 캐시 갱신
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            try {
              await cache.put(event.request, networkResponse.clone());
            } catch (err) {
              console.warn('[ServiceWorker] S3 이미지 캐시 저장 경고:', err);
            }
            return networkResponse;
          }

          // 만약 S3 Presigned URL이 1시간 만료되어 403 Forbidden을 반환하거나 에러인 경우
          // 이전에 캐시된 이미지가 존재하면 엑박 대신 캐시 바이너리 반환!
          if (cachedResponse) {
            console.warn(`[ServiceWorker] S3 1시간 만료(HTTP ${networkResponse.status}) 차단 -> zen-images-v1 영구 캐시 반환: ${url.pathname}`);
            return cachedResponse;
          }

          return networkResponse;
        })
        .catch((fetchErr) => {
          // 오프라인 상태 (네트워크 단절) 시 캐시 이미지 반환
          if (cachedResponse) {
            console.log(`[ServiceWorker] 오프라인 태블릿 -> zen-images-v1 영구 캐시 이미지 반환: ${url.pathname}`);
            return cachedResponse;
          }
          throw fetchErr;
        });

      // Stale-While-Revalidate: 캐시된 이미지가 있으면 0초 딜레이 즉각 반환하고 백그라운드에서 유효성 검사
      if (cachedResponse) {
        event.waitUntil(fetchPromise.catch(() => {}));
        return cachedResponse;
      }

      // 캐시에 없으면 네트워크 응답 대기
      return await fetchPromise;
    })());
    return;
  }

  // B. API 요청 (/api/documents, /api/documents/:id, /api/study-stats)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              console.log('[ServiceWorker] 오프라인 API 캐시에서 반환:', url.pathname);
              return cachedResponse;
            }
            return new Response(JSON.stringify({
              success: false,
              offline: true,
              message: "오프라인 상태입니다. 이전에 열람하지 않은 문서는 연결 후 조회 가능합니다."
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // C. 정적 파일 및 SPA 네비게이션: Cache-First 또는 Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).catch(() => caches.match('/index.html'));
    })
  );
});
