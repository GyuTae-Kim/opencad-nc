import { describe, expect, it } from 'vitest';
import { NC_EXTENSIONS } from '../src/extensions';
import { RECENT_DB, RECENT_MAX, RECENT_MAX_SIZE, RECENT_STORE } from '../src/app/recent';
import { fileHandling, manifestFor } from '../tools/site-metadata.mjs';
import { contentVersion, precacheable, precacheUrls, serviceWorkerSource } from '../tools/sw-plugin.mjs';

type Range = { lo: string; hi: string };
const inRange = (k: unknown, r: Range): boolean => typeof k === 'string' && k >= r.lo && k <= r.hi;

/** 서비스 워커 원본을 가짜 self·caches·fetch·indexedDB로 돌린다(최근 문서 저장소는 하나 — 열쇠를 밖에 둔다) */
function runSw(network: (url: string) => Response | Promise<Response>) {
  const listeners = new Map<string, (e: unknown) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: unknown) => (typeof r === 'string' ? r : (r as { url: string }).url);
  const cacheOf = (name: string) => {
    let m = stores.get(name);
    if (!m) stores.set(name, (m = new Map()));
    return {
      put: async (r: unknown, res: Response) => void m!.set(key(r), res),
      match: async (r: unknown) => m!.get(key(r))?.clone(),
      addAll: async (rs: unknown[]) => {
        for (const r of rs) m!.set(key(r), new Response(`cached ${key(r)}`));
      },
    };
  };
  const caches = {
    open: async (n: string) => cacheOf(n),
    match: async (r: unknown) => {
      for (const m of stores.values()) {
        const hit = m.get(key(r));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  // 아주 작은 IndexedDB: 저장소 하나(열쇠 밖), put·delete(열쇠·범위)·getAll(범위)
  const db = new Map<string, unknown>();
  const opened: { name: string; version: number }[] = [];
  let created = false;
  const IDBKeyRange = { bound: (lo: string, hi: string): Range => ({ lo, hi }) };
  const indexedDB = {
    open(name: string, version: number) {
      opened.push({ name, version });
      const req: Record<string, unknown> & { result?: unknown } = {};
      setTimeout(() => {
        const store = {
          put: (v: unknown, k: string) => void db.set(k, v),
          delete: (k: string | Range) => {
            if (typeof k === 'string') db.delete(k);
            else for (const x of [...db.keys()]) if (inRange(x, k)) db.delete(x);
          },
          getAll: (r: Range) => {
            const q: Record<string, unknown> = {};
            setTimeout(() => {
              q.result = [...db.entries()].filter(([k]) => inRange(k, r)).map(([, v]) => v);
              (q.onsuccess as () => void)?.();
            }, 0);
            return q;
          },
        };
        req.result = {
          objectStoreNames: { contains: () => created },
          createObjectStore: () => void (created = true),
          transaction() {
            const t: Record<string, unknown> = { objectStore: () => store };
            setTimeout(() => (t.oncomplete as () => void)?.(), 5);
            return t;
          },
          close() {},
        };
        if (!created) (req.onupgradeneeded as () => void)?.();
        (req.onsuccess as () => void)?.();
      }, 0);
      return req;
    },
  };
  const self = {
    location: { origin: 'https://x.test' },
    registration: { scope: 'https://x.test/app/' },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f),
  };
  const fetch = async (r: unknown) => network(key(r));
  new Function('self', 'caches', 'fetch', 'indexedDB', 'IDBKeyRange', serviceWorkerSource({ version: 'v1', urls: ['./', 'en/', 'manifest.webmanifest', 'assets/a.js'] }))(
    self,
    caches,
    fetch,
    indexedDB,
    IDBKeyRange,
  );
  const fire = async (request: Record<string, unknown>) => {
    let p: Promise<Response> | undefined;
    listeners.get('fetch')!({ request, respondWith: (x: Promise<Response>) => (p = x) });
    return p ? await p : undefined;
  };
  return { listeners, stores, db, opened, fire };
}

const req = (url: string, extra: Record<string, unknown> = {}) => ({ url, method: 'GET', mode: 'no-cors', headers: new Headers(), ...extra });
/** 공유 받기 POST(파일들) */
const share = (url: string, files: unknown[]) => req(url, { method: 'POST', formData: async () => ({ getAll: (n: string) => (n === 'file' ? files : []) }) });
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('오프라인 서비스 워커(sw.js)', () => {
  it('미리 담을 목록: 소스 맵·공유 그림·사이트맵 빼고, index.html은 디렉터리 주소', () => {
    expect(precacheable('assets/a.js.map')).toBe(false);
    expect(precacheable('og-opencad.jpg')).toBe(false);
    expect(precacheable('.nojekyll')).toBe(false);
    expect(precacheable('sw.js')).toBe(false);
    expect(precacheable('assets/a.js')).toBe(true);
    expect(precacheUrls(['index.html', 'en/index.html', 'en/manifest.webmanifest', 'sitemap.xml'])).toEqual(['./', 'en/', 'en/manifest.webmanifest']);
    // 판 이름은 내용 지문: 내용이 같으면 같고, 하나라도 바뀌면 다르다
    const a = contentVersion([{ name: 'a.js', content: 'x' }]);
    expect(contentVersion([{ name: 'a.js', content: 'x' }])).toBe(a);
    expect(contentVersion([{ name: 'a.js', content: 'y' }])).not.toBe(a);
  });

  it('워커의 최근 문서 저장소 이름·한도는 앱(recent.ts)과 같다', () => {
    const src = serviceWorkerSource({ version: 'v', urls: [] });
    expect(src).toContain(`const RECENT_DB = ${JSON.stringify(RECENT_DB)};`);
    expect(src).toContain(`const RECENT_STORE = ${JSON.stringify(RECENT_STORE)};`);
    expect(src).toContain(`const RECENT_MAX = ${RECENT_MAX};`);
    expect(src).toContain(`const RECENT_MAX_SIZE = ${RECENT_MAX_SIZE};`);
  });

  it('HTML은 네트워크 먼저(되면 담고, 안 되면 주소 인자 없이 담아 둔 것), 빌드 결과는 담아 둔 것 먼저', async () => {
    let online = true;
    const sw = runSw((url) => (online ? new Response(`net ${url}`, { headers: { 'content-type': 'text/html' } }) : Promise.reject(new Error('offline'))));
    const nav = req('https://x.test/app/en/?sample', { mode: 'navigate' });
    expect(await (await sw.fire(nav))!.text()).toBe('net https://x.test/app/en/?sample');
    await settle();
    online = false;
    // 오프라인: 같은 경로에 담아 둔 페이지(주소 인자 무시)
    expect(await (await sw.fire(nav))!.text()).toBe('net https://x.test/app/en/?sample');
    // 담아 두지 않은 언어 페이지는 앱 첫 페이지로
    sw.stores.set('opencad-nc-v1', new Map([['https://x.test/app/', new Response('cached root')]]));
    expect(await (await sw.fire(req('https://x.test/app/ja/?recent=a', { mode: 'navigate' })))!.text()).toBe('cached root');
    // 담아 둔 빌드 결과
    sw.stores.set('opencad-nc-v1', new Map([['https://x.test/app/assets/a.js', new Response('cached js')]]));
    expect(await (await sw.fire(req('https://x.test/app/assets/a.js')))!.text()).toBe('cached js');
    // 다른 출처는 손대지 않는다
    expect(await sw.fire(req('https://other.test/x.js'))).toBeUndefined();
  });

  it('담아 둔 것 먼저는 미리 담을 목록·assets/만: ?open= 파일·범위 밖 주소는 손대지 않고 담지도 않는다', async () => {
    let n = 0;
    const sw = runSw((url) => new Response(`net ${url} ${++n}`));
    expect(await sw.fire(req('https://x.test/app/fixtures/part.nc'))).toBeUndefined();
    expect(await sw.fire(req('https://x.test/app/fixtures/part.nc?v=2'))).toBeUndefined();
    expect(await sw.fire(req('https://x.test/other/x.js'))).toBeUndefined();
    expect(await sw.fire(req('https://x.test/other/', { mode: 'navigate' }))).toBeUndefined();
    expect(await (await sw.fire(req('https://x.test/app/assets/b.js')))!.text()).toBe('net https://x.test/app/assets/b.js 1');
    // 앱 정보는 주소 인자를 무시하고 담아 둔 것
    sw.stores.set('opencad-nc-v1', new Map([['https://x.test/app/manifest.webmanifest', new Response('{"cached":1}')]]));
    await settle();
    const cached = [...sw.stores.values()].flatMap((m) => [...m.keys()]);
    expect(cached.some((k) => k.includes('part.nc'))).toBe(false);
    await sw.fire(req('https://x.test/app/extra.html', { mode: 'navigate' }));
    await settle();
    expect([...sw.stores.values()].flatMap((m) => [...m.keys()]).some((k) => k.includes('extra.html'))).toBe(false);
  });

  it('공유 받기(파일 하나): 최근 문서 저장소(meta:·data: 열쇠)에 넣고 그 언어 페이지의 ?recent=<id>로 보낸다', async () => {
    const sw = runSw(() => new Response(''));
    const res = (await sw.fire(share('https://x.test/app/en/share-target', [new File(['G0 X1 Y2'], 'part.nc')])))!;
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://x.test/app/en/?recent=part.nc%3A8');
    expect(sw.opened[0]).toEqual({ name: RECENT_DB, version: 1 });
    expect((sw.db.get('meta:part.nc:8') as { name: string; size: number }).name).toBe('part.nc');
    expect(sw.db.get('data:part.nc:8')).toBeInstanceOf(File);
  });

  it('공유 받기는 최근 문서를 새것부터 8개만 남긴다(새로 받은 것은 남김)', async () => {
    const sw = runSw(() => new Response(''));
    for (let i = 0; i < RECENT_MAX; i++) {
      sw.db.set(`meta:old${i}.nc:1`, { id: `old${i}.nc:1`, name: `old${i}.nc`, size: 1, time: 1000 + i });
      sw.db.set(`data:old${i}.nc:1`, new Blob(['x']));
    }
    await sw.fire(share('https://x.test/app/share-target', [new File(['G1'], 'new.nc')]));
    await settle();
    const metas = [...sw.db.keys()].filter((k) => k.startsWith('meta:'));
    expect(metas).toHaveLength(RECENT_MAX);
    expect(metas).toContain('meta:new.nc:2');
    // 가장 오래된 것이 빠짐(내용도 함께)
    expect(sw.db.has('meta:old0.nc:1')).toBe(false);
    expect(sw.db.has('data:old0.nc:1')).toBe(false);
  });

  it('공유 받기(여러 파일·큰 파일): 한 번 쓸 자리(share:)에 두고 ?share=<열쇠>로, 파일이 없거나 너무 크면 까닭을 붙인다', async () => {
    const sw = runSw(() => new Response(''));
    const res = (await sw.fire(share('https://x.test/app/de/share-target', [new File(['O1000\nM98 P1001\nM30'], 'main.nc'), new File(['O1001\nM99'], 'C:\\job\\O1001.nc')])))!;
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/app/de/');
    const key = loc.searchParams.get('share')!;
    expect(key).toBeTruthy();
    const slot = sw.db.get('share:' + key) as { files: { name: string; data: File }[] };
    expect(slot.files.map((f) => f.name)).toEqual(['main.nc', 'O1001.nc']);
    expect([...sw.db.keys()].some((k) => k.startsWith('meta:'))).toBe(false);
    // 60MB 넘는 파일 하나도 한 번 쓸 자리로(최근 문서에는 앱이 넣지 않는다)
    const big = { size: 61 * 1024 * 1024, name: 'big.nc' };
    const res2 = (await sw.fire(share('https://x.test/app/share-target', [big])))!;
    expect(new URL(res2.headers.get('location')!).searchParams.has('share')).toBe(true);
    const none = (await sw.fire(share('https://x.test/app/share-target', [])))!;
    expect(none.headers.get('location')).toBe('https://x.test/app/?share-error=no-file');
    const huge = (await sw.fire(share('https://x.test/app/share-target', [{ size: 600 * 1024 * 1024, name: 'huge.nc' }])))!;
    expect(huge.headers.get('location')).toBe('https://x.test/app/?share-error=too-big');
  });
});

describe('앱 정보(manifest)의 파일 연결', () => {
  it('공유 받기·데스크톱 파일 열기는 뷰어가 여는 모든 확장자를 받는다', () => {
    const f = fileHandling(NC_EXTENSIONS) as {
      share_target: { action: string; method: string; enctype: string; params: { files: { name: string; accept: string[] }[] } };
      file_handlers: { action: string; accept: Record<string, string[]>; launch_type: string }[];
      launch_handler: { client_mode: string[] };
    };
    const dotted = NC_EXTENSIONS.map((e) => '.' + e);
    expect(f.share_target).toMatchObject({ action: './share-target', method: 'POST', enctype: 'multipart/form-data' });
    expect(f.share_target.params.files[0]!.name).toBe('file');
    for (const e of dotted) expect(f.share_target.params.files[0]!.accept).toContain(e);
    const handled = Object.values(f.file_handlers[0]!.accept).flat();
    expect(handled.sort()).toEqual([...dotted].sort());
    expect(f.file_handlers[0]!.accept['application/xml']).toEqual(['.xml']);
    // 주 프로그램과 부프로그램을 함께 고르면 창 하나로(한 작업)
    expect(f.file_handlers[0]!.launch_type).toBe('single-client');
    expect(f.launch_handler.client_mode[0]).toBe('focus-existing');
  });

  it('언어 앱 정보도 같은 파일 연결을 두고, 동작 주소는 그 언어 페이지 기준', () => {
    const ko = manifestFor('ko', NC_EXTENSIONS) as Record<string, unknown>;
    const en = manifestFor('en', NC_EXTENSIONS) as Record<string, unknown> & { share_target: { action: string }; file_handlers: { action: string }[] };
    expect(ko.share_target).toEqual(en.share_target);
    expect(new URL(en.share_target.action, 'https://x.test/app/en/manifest.webmanifest').href).toBe('https://x.test/app/en/share-target');
    expect(new URL(en.file_handlers[0]!.action, 'https://x.test/app/en/manifest.webmanifest').href).toBe('https://x.test/app/en/');
    expect(new URL(en.scope as string, 'https://x.test/app/en/manifest.webmanifest').href).toBe('https://x.test/app/');
    // 확장자 목록 없이 부르면(메타데이터의 짧은 이름 등) 파일 연결 없이
    expect('share_target' in manifestFor('en')).toBe(false);
  });
});
