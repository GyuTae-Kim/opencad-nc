// @vitest-environment jsdom
/**
 * 홈 화면 앱(pwa.ts)과 공유 받기 시작 인자(format.ts·app.ts): 서비스 워커 등록·새 판 알림, 데스크톱 파일 열기(launchQueue — 여러 파일),
 * ?recent=·?share=·?share-error=로 공유 받은 파일 열기. 뷰어 코어(WebGL)는 가짜로, 해석은 워커와 같은 길(parseForView)로 바로 부른다.
 */
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return 0;
    }
    getProjection(): string {
      return 'perspective';
    }
    getRenderMode(): string {
      return 'shadedEdges';
    }
    groups(): unknown[] {
      return [];
    }
  }
  return { FakeViewer, opens: [] as { name: string; extra: string[] }[] };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown, _progress: unknown, extra: { name: string; bytes: ArrayBuffer }[] = []) {
      fake.opens.push({ name, extra: extra.map((f) => f.name) });
      return parseForView(
        name,
        new Uint8Array(data),
        (opts ?? {}) as object,
        () => {},
        extra.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
      );
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';
import { parseOnceParams, shareErrorText, withoutOnceParams } from '../../src/app/format';
import { consumeLaunchQueue, registerServiceWorker, type SwContainer, type SwRegistration, type SwWorker } from '../../src/app/pwa';
import { RecentStore, recentId } from '../../src/app/recent';
import { memoryBackend, type MemoryBackend } from './recent-memory';

const MAIN = 'O1000 (MAIN)\nG21 G90 G54\nT1 M6\nS1000 M3\nG0 X0 Y0 Z5\nM98 P1001\nM30\n';
const SUB = 'O1001 (SUB)\nG1 Z-1 F100\nX10\nG0 Z5\nM99\n';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 80 && !ok(); i++) await tick();
};

function makeApp(recent: MemoryBackend, search = ''): { app: NcViewerApp; root: HTMLElement } {
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  history.replaceState(null, '', '/' + search);
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root, { recent: new RecentStore(recent) }), root };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  // jsdom의 Blob·File에는 arrayBuffer가 없다 — 브라우저처럼 읽히는 Node 것으로
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  fake.opens.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

/** 가짜 서비스 워커 손님 */
function fakeSw(opts: { controller: boolean; waiting?: boolean; fail?: boolean }) {
  const posted: unknown[] = [];
  const handlers: Record<string, (() => void)[]> = {};
  const worker = (state: string): SwWorker & { fire(): void; state: string } => {
    const fns: (() => void)[] = [];
    return {
      state,
      postMessage: (m: unknown) => void posted.push(m),
      addEventListener: (_t: 'statechange', fn: () => void) => void fns.push(fn),
      fire() {
        for (const f of fns) f();
      },
    };
  };
  const installing = worker('installing');
  const reg: SwRegistration & { installing: typeof installing } = {
    waiting: opts.waiting ? worker('installed') : null,
    installing,
    addEventListener: (t: string, fn: () => void) => void (handlers[t] ??= []).push(fn),
    update: async () => undefined,
  };
  let registered: { url: string; scope?: string } | null = null;
  const sw: SwContainer & { fire(t: string): void } = {
    controller: opts.controller ? {} : null,
    async register(url, o) {
      if (opts.fail) throw new Error('blocked');
      registered = { url: String(url), scope: o?.scope };
      return reg;
    },
    addEventListener: (t: string, fn: () => void) => void (handlers[t] ??= []).push(fn),
    fire(t) {
      for (const f of handlers[t] ?? []) f();
    },
  };
  return { sw, reg, posted, registered: () => registered };
}

describe('서비스 워커 등록과 새 판 알림', () => {
  it('앱 뿌리의 sw.js를 등록하고, 처음 설치는 알리지 않는다', async () => {
    const f = fakeSw({ controller: false });
    const offers: unknown[] = [];
    const reg = await registerServiceWorker((a) => offers.push(a), { sw: f.sw, base: 'https://x.test/app/en/../', reload: () => {} });
    expect(reg).toBe(f.reg);
    expect(f.registered()).toEqual({ url: 'https://x.test/app/sw.js', scope: 'https://x.test/app/' });
    f.reg.installing.state = 'installed';
    f.sw.fire('updatefound');
    f.reg.installing.fire();
    expect(offers).toHaveLength(0);
  });

  it('앞 판이 맡은 페이지에 새 판이 기다리면 알리고, 적용하면 SKIP_WAITING → 넘겨받은 뒤 한 번 다시 읽는다', async () => {
    const f = fakeSw({ controller: true, waiting: true });
    let apply: (() => void) | null = null;
    let reloads = 0;
    let visible: (() => void) | null = null;
    await registerServiceWorker((a) => (apply = a), { sw: f.sw, base: 'https://x.test/app/', reload: () => reloads++, onVisible: (fn) => (visible = fn) });
    expect(apply).toBeTypeOf('function');
    // 적용 전의 넘겨받기(다른 탭이 바꿈)는 다시 읽지 않는다
    f.sw.fire('controllerchange');
    expect(reloads).toBe(0);
    apply!();
    expect(f.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    f.sw.fire('controllerchange');
    f.sw.fire('controllerchange');
    expect(reloads).toBe(1);
    expect(visible).toBeTypeOf('function');
  });

  it('등록하지 못하거나 서비스 워커가 없으면 조용히 null', async () => {
    expect(await registerServiceWorker(() => {}, { sw: fakeSw({ controller: false, fail: true }).sw, base: 'https://x.test/', reload: () => {} })).toBeNull();
    expect(await registerServiceWorker(() => {}, { base: 'https://x.test/', reload: () => {} })).toBeNull();
    // 등록을 막은 자동화 브라우저: 결과 없이 끝나도 오류 없이 null
    const blocked = { controller: null, register: async () => undefined as unknown as SwRegistration, addEventListener: () => {} } satisfies SwContainer;
    expect(await registerServiceWorker(() => {}, { sw: blocked, base: 'https://x.test/', reload: () => {} })).toBeNull();
    // 시험(개발) 환경의 기본값은 등록하지 않는다
    expect(await registerServiceWorker(() => {})).toBeNull();
  });
});

describe('데스크톱 파일 열기(launchQueue)', () => {
  it('넘겨받은 파일을 모두 함께 넘기고, 읽지 못한 파일은 뺀다', async () => {
    let consumer: ((p: { files?: { getFile(): Promise<File> }[] }) => void) | null = null;
    const got: string[][] = [];
    const host = { launchQueue: { setConsumer: (cb: typeof consumer) => (consumer = cb) } };
    expect(consumeLaunchQueue((files) => got.push(files.map((f) => f.name)), host as never)).toBe(true);
    const handle = (name: string, ok = true) => ({ getFile: () => (ok ? Promise.resolve(new File(['G0'], name)) : Promise.reject(new Error('gone'))) });
    consumer!({ files: [handle('main.nc'), handle('lost.nc', false), handle('O1001.nc')] });
    consumer!({ files: [] });
    consumer!({ files: [handle('x.nc', false)] });
    await until(() => got.length > 0);
    await tick();
    expect(got).toEqual([['main.nc', 'O1001.nc']]);
    expect(consumeLaunchQueue(() => {}, {})).toBe(false);
  });
});

describe('공유 받기 시작 인자', () => {
  it('한 번 쓸 인자를 읽고, 주소에서 그것만 뺀다', () => {
    expect(parseOnceParams('?recent=a.nc%3A12&lang=en')).toEqual({ recent: 'a.nc:12', share: null, shareError: null });
    expect(parseOnceParams('?share=k1&share-error=')).toEqual({ recent: null, share: 'k1', shareError: null });
    expect(withoutOnceParams('https://x.test/app/en/?recent=a&share=b&share-error=c&sample#v')).toBe('https://x.test/app/en/?sample#v');
    expect(shareErrorText('too-big')).toMatch(/너무 커서/);
    expect(shareErrorText('store')).toMatch(/받지 못했습니다/);
  });

  it('?recent=<id>: 서비스 워커가 넣은 최근 문서를 바로 열고 주소에서 지운다', async () => {
    const recent = memoryBackend();
    const bytes = new TextEncoder().encode('G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nX10 Y5\nM30\n');
    const id = recentId('part.nc', bytes.length);
    recent.entries.set(id, { entry: { id, name: 'part.nc', size: bytes.length, time: 1 }, data: new NodeBlob([bytes]) as unknown as Blob });
    makeApp(recent, `?recent=${encodeURIComponent(id)}`);
    await until(() => window.opencadApp?.state.docName === 'part.nc');
    expect(window.opencadApp!.state.docName).toBe('part.nc');
    expect(location.search).toBe('');
    // 다시 연 항목은 맨 앞으로(시각 새로)
    expect(recent.entries.get(id)!.entry.time).toBeGreaterThan(1);
  });

  it('?share=<열쇠>: 공유 받은 여러 파일을 한 작업으로 열고, 한 번 쓸 자리는 지우며 이은 작업을 최근 문서에 둔다', async () => {
    const recent = memoryBackend();
    recent.shares.set('k1', [
      { name: 'O1001.nc', data: new NodeBlob([SUB]) as unknown as Blob },
      { name: 'main.nc', data: new NodeBlob([MAIN]) as unknown as Blob },
    ]);
    recent.shares.set('stale', [{ name: 'old.nc', data: new NodeBlob(['G0']) as unknown as Blob }]);
    makeApp(recent, '?share=k1');
    await until(() => !!window.opencadApp?.state.jobFiles);
    expect(window.opencadApp!.state.jobFiles).toEqual(['main.nc', 'O1001.nc']);
    expect(fake.opens.at(-1)).toEqual({ name: 'O1001.nc', extra: ['main.nc'] });
    expect(recent.shares.size).toBe(0);
    expect(location.search).toBe('');
    await until(() => recent.entries.size > 0);
    expect([...recent.entries.values()].map((v) => v.entry.files)).toEqual([2]);
  });

  it('찾지 못한 공유·공유 실패는 까닭을 알린다', async () => {
    const recent = memoryBackend();
    const { root } = makeApp(recent, '?share=gone');
    await until(() => !root.querySelector<HTMLElement>('.start-error')?.hidden);
    expect(root.querySelector('.start-error')!.textContent).toMatch(/공유한 파일을 이 브라우저에서 찾지 못했습니다/);
    makeApp(memoryBackend(), '?share-error=too-big');
    await tick();
    expect([...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' ')).toMatch(/너무 커서/);
    expect(location.search).toBe('');
  });
});
