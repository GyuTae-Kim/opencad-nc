/**
 * 오프라인용 서비스 워커(sw.js)의 본문. 빌드 끝에 공용 도구(opencad-site-kit/pwa/sw-plugin)가 미리 담을 목록과 판 이름(내용 지문)을 정해
 * 이 함수로 dist/sw.js를 쓴다(설정은 tools/site.mjs의 offline).
 * - HTML(이동 요청)은 네트워크 먼저(배포가 늘 보이게, 안 되면 담아 둔 것 — 담는 것은 미리 담을 목록의 페이지만).
 * - 담아 둔 것 먼저는 미리 담을 목록과 빌드 결과(assets/)뿐이다. 그 밖(?open=으로 받는 NC 파일 등)과 앱 범위 밖 주소는
 *   손대지 않고 네트워크로 보낸다(바뀐 파일이 옛것으로 열리거나 큰 파일이 캐시에 쌓이지 않게).
 * - 새 판은 기다리다가(skipWaiting 없음) 페이지가 "새로 고침"을 고르면(SKIP_WAITING) 바뀐다.
 * - Android 공유 받기(share_target, POST …/share-target): 파일 하나(60MB 이하)는 최근 문서 IndexedDB(src/app/recent.ts와 같은 꼴)에
 *   넣고 ?recent=<id>로 연다. 여러 파일(주 프로그램 + 부프로그램)이나 큰 파일은 한 번 쓸 자리(share:<열쇠>)에 두고 ?share=<열쇠>로
 *   연다 — 앱이 읽자마자 지우고, 여러 파일은 한 작업으로 이어 연다(이은 작업은 앱이 최근 문서에 둔다).
 * 돌려주는 글(첫 줄 주석 포함)은 sw.js에 그대로 들어간다 — 바꾸면 판 이름도 바뀐다.
 */

/**
 * 서비스 워커 원본. recent: 최근 문서 저장소의 이름·한도(src/app/recent.ts의 RECENT_DB·RECENT_STORE·RECENT_MAX·RECENT_MAX_SIZE —
 * 값이 같은지는 시험이 본다)
 */
export function serviceWorkerSource({ version, urls, recent = { db: 'opencad-nc', store: 'recent', max: 8, maxSize: 60 * 1024 * 1024 } }) {
  return `/* OpenCAD NC 뷰어 서비스 워커 — 빌드가 만든다(tools/sw-plugin.mjs). 판 ${version} */
'use strict';
const CACHE = 'opencad-nc-${version}';
const PRECACHE = ${JSON.stringify(urls)};
const SCOPE = self.registration.scope;
/** 담아 둔 것 먼저 쓸 경로(미리 담을 목록) */
const PRECACHE_PATHS = new Set(PRECACHE.map((u) => new URL(u, SCOPE).pathname));
const RECENT_DB = ${JSON.stringify(recent.db)};
const RECENT_STORE = ${JSON.stringify(recent.store)};
const RECENT_MAX = ${Number(recent.max)};
const RECENT_MAX_SIZE = ${Number(recent.maxSize)};
/** 한 번 쓸 자리(여러 파일·큰 파일)의 모두 합친 크기 한도 */
const SHARE_MAX_SIZE = 512 * 1024 * 1024;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(new URL(u, SCOPE), { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('opencad-nc-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** 최근 문서 저장소 열기(판 1: 저장소 하나, 열쇠를 밖에 둔다 — 목록 meta:<id>, 내용 data:<id>) — 앱 recent.ts와 같은 꼴 */
function openRecent() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RECENT_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(RECENT_STORE)) req.result.createObjectStore(RECENT_STORE);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB'));
    req.onsuccess = () => resolve(req.result);
  });
}

function finished(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error || new Error('IndexedDB'));
  });
}

/** 파일 이름(경로 조각 없이) */
const baseName = (f, i) => String((f && f.name) || 'shared-' + (i + 1) + '.nc').replace(/^.*[\\\\/]/, '');

/** 파일 하나를 최근 문서에 넣고(같은 이름·크기는 한 항목) 새것부터 RECENT_MAX개만 남긴다. 열쇠(id)를 돌려준다 */
async function putRecent(file) {
  const db = await openRecent();
  try {
    const name = baseName(file, 0);
    const id = name + ':' + file.size;
    const t = db.transaction(RECENT_STORE, 'readwrite');
    const s = t.objectStore(RECENT_STORE);
    s.put(file, 'data:' + id);
    s.put({ id, name, size: file.size, time: Date.now() }, 'meta:' + id);
    // 한도: 새로 넣은 것 말고 오래된 것부터(시각이 같으면 이름 순으로 뒤의 것) 지운다 — 앱 recent.ts의 overflowIds와 같은 차례
    const all = s.getAll(IDBKeyRange.bound('meta:', 'meta:\\uffff'));
    all.onsuccess = () => {
      const rest = (all.result || []).filter((e) => e && e.id !== id);
      rest.sort((a, b) => b.time - a.time || String(a.name).localeCompare(String(b.name)));
      for (const e of rest.slice(RECENT_MAX - 1)) {
        s.delete('meta:' + e.id);
        s.delete('data:' + e.id);
      }
    };
    await finished(t);
    return id;
  } finally {
    db.close();
  }
}

/** 여러 파일·큰 파일을 한 번 쓸 자리에 둔다(앱이 읽자마자 지운다). 열쇠를 돌려준다 */
async function putShare(files) {
  const db = await openRecent();
  try {
    const key = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const t = db.transaction(RECENT_STORE, 'readwrite');
    t.objectStore(RECENT_STORE).put({ time: Date.now(), files: files.map((f, i) => ({ name: baseName(f, i), data: f })) }, 'share:' + key);
    await finished(t);
    return key;
  } finally {
    db.close();
  }
}

/** 공유 받기: 파일을 최근 문서(하나)나 한 번 쓸 자리(여럿·큰 파일)에 넣고 그 언어 페이지에서 연다(실패하면 까닭을 붙여 페이지로) */
async function shareTarget(request) {
  const page = new URL('./', request.url);
  try {
    const form = await request.formData();
    const files = form.getAll('file').filter((f) => f && typeof f === 'object' && typeof f.size === 'number');
    const total = files.reduce((n, f) => n + f.size, 0);
    if (!files.length) page.searchParams.set('share-error', 'no-file');
    else if (total > SHARE_MAX_SIZE) page.searchParams.set('share-error', 'too-big');
    else if (files.length === 1 && files[0].size > 0 && files[0].size <= RECENT_MAX_SIZE) page.searchParams.set('recent', await putRecent(files[0]));
    else page.searchParams.set('share', await putShare(files));
  } catch (e) {
    page.searchParams.set('share-error', 'store');
  }
  return Response.redirect(page.href, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 앱 범위 밖(같은 출처의 다른 앱·파일 — GitHub Pages 프로젝트 사이트는 출처 하나를 함께 쓴다)은 손대지 않는다
  if (!url.href.startsWith(SCOPE)) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(shareTarget(req));
    return;
  }
  if (req.method !== 'GET') return;
  // HTML: 네트워크 먼저(새 배포가 바로 보이게), 안 되면 담아 둔 것(주소 인자 없이 같은 경로, 그것도 없으면 앱 첫 페이지)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    const key = new Request(url.origin + url.pathname);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && PRECACHE_PATHS.has(url.pathname)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(key)
            .then((hit) => hit || caches.match(new URL('./', SCOPE).href))
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }
  // 미리 담을 목록(아이콘·앱 정보 등)과 내용 지문 이름의 빌드 결과(assets/)만: 담아 둔 것 먼저, 없으면 받아서 담는다.
  // 그 밖(?open=으로 받는 NC 파일 등)은 손대지 않는다 — 네트워크 그대로, 담지 않는다
  const rel = url.pathname.slice(new URL(SCOPE).pathname.length);
  if (!PRECACHE_PATHS.has(url.pathname) && !rel.startsWith('assets/')) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: url.pathname.endsWith('.webmanifest') }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
}
