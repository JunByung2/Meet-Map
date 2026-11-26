// 모여락 서비스 워커
// - 화면을 만드는 정적 파일(글꼴·아이콘·JS·CSS)만 저장해 두고 빠르게 연다.
// - /api (로그인 정보·사진·채팅 등 개인 데이터)와 페이지 HTML 은 절대 저장하지 않는다.
// - 인터넷이 끊기면 offline.html 을 보여준다.
const VERSION = 'moyeorak-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // 페이지 이동: 항상 서버에서 받고, 실패(오프라인)했을 때만 안내 화면
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  // 빌드된 정적 파일과 아이콘만 저장: 있으면 바로, 없으면 받아서 저장
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})
