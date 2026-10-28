// @vitest-environment jsdom
/**
 * 측정 도구를 문서를 열 때 나눠 받기(app.ts + core.ts loadMeasureTools·FirstUse): 시작 화면은 측정 도구 없이 그리고, 파일을 열면 코어와 함께 받아
 * 첫 문서가 보일 때 측정이 바로 켜진다. 받지 못해도 문서는 열고, 측정을 켜면 다시 받는다 — 받는 동안 단추는 눌림·받는 중(aria-busy)·상태 줄 안내,
 * 다시 누르기·Esc는 켜려던 것을 거두고(받기는 한 번), 받지 못하면 연결 상태에 맞는 안내를 띄운다.
 * 뷰어 코어(WebGL)·해석 워커는 가짜, 측정 도구 받기(loadMeasureTools)는 시험이 붙들거나 실패시킨다(진짜 조각을 그대로 줄 수도 있다).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    measureHoverSnap = null;
    measureInferenceLock = null;
    measureHoverLock = null;
    measureLabelRect = null;
    measurePoints = [];
    section = null;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      wrap.append(this.canvas);
      host.append(wrap);
      FakeViewer.last = this;
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return 0;
    }
    setMeasureMode(on: boolean): void {
      this.measureMode = on;
    }
    getRenderMode(): string {
      return 'shadedEdges';
    }
    getProjection(): string {
      return 'perspective';
    }
    groups(): unknown[] {
      return [];
    }
  }
  /** 측정 도구 받기 흉내: real = 진짜 조각, fail = 받지 못함, hold = release·reject를 부를 때까지 기다림(같은 약속 — onceImport처럼) */
  const ctl = {
    mode: 'real' as 'real' | 'fail' | 'hold',
    calls: 0,
    held: null as Promise<unknown> | null,
    release: () => {},
    reject: (_e: unknown) => {},
  };
  return { FakeViewer, ctl };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { loadNcFile } = await import('../../src/index');
  const { ncPayload } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer) {
      const { parsed, scene } = loadNcFile(name, new Uint8Array(data));
      if ('part' in parsed) throw new Error('not nc');
      return { kind: parsed.kind, scene, ms: 1, nc: ncPayload(parsed.program) };
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});
const CHUNK_ERROR = 'Failed to fetch dynamically imported module: http://127.0.0.1/assets/measure-tools-x.js';
vi.mock('../../src/app/core', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/app/core')>();
  const real = m.loadMeasureTools;
  const c = fake.ctl;
  return {
    ...m,
    loadMeasureTools: () => {
      c.calls++;
      if (c.mode === 'real') return real();
      if (c.mode === 'fail') return Promise.reject(new TypeError(CHUNK_ERROR));
      c.held ??= new Promise((res, rej) => {
        c.release = () => {
          c.held = null;
          res(real());
        };
        c.reject = (e) => {
          c.held = null;
          rej(e);
        };
      });
      return c.held;
    },
  };
});
vi.mock('../../src/app/dom', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/app/dom')>();
  return { ...m, toast: vi.fn(m.toast) };
});

import { NcViewerApp } from '../../src/app/app';
import { measureFailText } from '../../src/app/core';
import { toast } from '../../src/app/dom';
import { MEASURE_LOADING, statusMeasureHint } from '../../src/app/measure';

const PROGRAM = 'G21 G90 G17\nG0 X0 Y40 Z0\nG2 X40 Y40 I20 J-20 F500\nG1 X60 Y40\nM30\n';
const buf = (): ArrayBuffer => new TextEncoder().encode(PROGRAM).buffer as ArrayBuffer;

function makeApp(): { app: NcViewerApp; root: HTMLElement; btn: () => HTMLButtonElement; status: () => string } {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const app = new NcViewerApp(root);
  const btn = (): HTMLButtonElement => [...root.querySelectorAll<HTMLButtonElement>('.toolbar .tbtn')].find((b) => b.getAttribute('aria-label') === '측정')!;
  return { app, root, btn, status: () => root.querySelector('.st-sel')!.textContent ?? '' };
}
const esc = (): void => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.assign(fake.ctl, { mode: 'real', calls: 0, held: null });
  vi.mocked(toast).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('측정 도구는 문서를 열 때 받는다', () => {
  it('시작 화면은 측정 도구 없이 그리고, 파일을 열면 받아 문서가 보일 때 측정이 바로 켜진다(잠금 단추·툴팁 층도 그때)', async () => {
    const { app, root, btn } = makeApp();
    expect(fake.ctl.calls).toBe(0);
    expect(root.querySelector('.start')).not.toBeNull();
    expect(root.querySelector('.measure-bar .mb-lock')).toBeNull();
    expect(app.state().measureTools).toBe(false);
    expect(await app.openBuffer('arc.nc', buf())).toBe(true);
    expect(fake.ctl.calls).toBeGreaterThanOrEqual(1);
    expect(app.state().measureTools).toBe(true);
    // 잠금 단추는 측정 띠 단추 맨 앞, 알림은 띠 끝, 툴팁은 3D 보기 층
    const acts = root.querySelector('.measure-bar .mb-acts')!;
    expect(acts.firstElementChild!.classList.contains('mb-lock')).toBe(true);
    expect(root.querySelector('.measure-bar')!.lastElementChild!.classList.contains('measure-flash')).toBe(true);
    expect(root.querySelector('.view .snap-tip')).not.toBeNull();
    btn().click();
    expect(app.state()).toMatchObject({ measuring: true, measureLoading: false });
    expect(fake.FakeViewer.last!.measureMode).toBe(true);
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(btn().hasAttribute('aria-busy')).toBe(false);
  });

  it('코어 뒤에도 측정 도구가 늦으면 기다리지 않고 연다 — 받는 동안 누르면 눌림·받는 중, 다시 누르면 거두고, 받기는 한 번', async () => {
    fake.ctl.mode = 'hold';
    const { app, btn, status } = makeApp();
    const t0 = Date.now();
    expect(await app.openBuffer('arc.nc', buf())).toBe(true);
    // 코어를 받은 뒤 3초까지만 기다린다
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(app.state().measureTools).toBe(false);
    const calls = fake.ctl.calls;
    btn().click();
    expect(app.state()).toMatchObject({ measuring: false, measureLoading: true });
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(btn().getAttribute('aria-busy')).toBe('true');
    expect(status()).toBe(MEASURE_LOADING);
    // 다시 누르면 켜려던 것을 거둔다(받기는 계속)
    btn().click();
    expect(app.state().measureLoading).toBe(false);
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    expect(btn().hasAttribute('aria-busy')).toBe(false);
    expect(status()).not.toBe(MEASURE_LOADING);
    // 또 누르면 같은 받기를 기다린다
    btn().click();
    btn().click();
    btn().click();
    expect(app.state().measureLoading).toBe(true);
    expect(fake.ctl.calls - calls).toBe(1);
    fake.ctl.release();
    await vi.waitFor(() => expect(app.state().measuring).toBe(true));
    expect(app.state()).toMatchObject({ measureLoading: false, measureTools: true });
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(btn().hasAttribute('aria-busy')).toBe(false);
    expect(status()).toBe(statusMeasureHint(false));
    expect(toast).not.toHaveBeenCalled();
  });

  it('받는 동안 Esc는 켜려던 것을 거두고, 받은 뒤에도 켜지 않는다', async () => {
    fake.ctl.mode = 'fail';
    const { app, btn } = makeApp();
    expect(await app.openBuffer('arc.nc', buf())).toBe(true);
    fake.ctl.mode = 'hold';
    btn().click();
    expect(app.state().measureLoading).toBe(true);
    esc();
    expect(app.state().measureLoading).toBe(false);
    fake.ctl.release();
    await vi.waitFor(() => expect(app.state().measureTools).toBe(true));
    expect(app.state().measuring).toBe(false);
    expect(btn().getAttribute('aria-pressed')).toBe('false');
  });

  it('받지 못해도 문서는 열고, 측정을 켜면 다시 받는다 — 또 못 받으면 연결 상태에 맞는 안내, 다음 누르기에서 다시', async () => {
    fake.ctl.mode = 'fail';
    const { app, btn } = makeApp();
    expect(await app.openBuffer('arc.nc', buf())).toBe(true);
    expect(app.state()).toMatchObject({ parsed: true, measureTools: false });
    expect(toast).not.toHaveBeenCalled();
    // 새 판이 나와 예전 조각이 없음(연결은 됨)
    btn().click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(measureFailText(true), 'error', 8000));
    expect(app.state()).toMatchObject({ measuring: false, measureLoading: false });
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    expect(btn().hasAttribute('aria-busy')).toBe(false);
    // 연결이 끊김
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    btn().click();
    await vi.waitFor(() => expect(toast).toHaveBeenLastCalledWith(measureFailText(false), 'error', 8000));
    // 다시 누르면 다시 받아 켠다
    fake.ctl.mode = 'real';
    btn().click();
    await vi.waitFor(() => expect(app.state().measuring).toBe(true));
    expect(app.state().measureTools).toBe(true);
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('조각이 아닌 오류(만들다 실패)는 그 글로 알린다', async () => {
    fake.ctl.mode = 'fail';
    const { app, btn } = makeApp();
    expect(await app.openBuffer('arc.nc', buf())).toBe(true);
    fake.ctl.mode = 'hold';
    btn().click();
    fake.ctl.reject(new Error('boom'));
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('측정 도구를 열 수 없습니다: boom', 'error', 8000));
    expect(app.state().measureLoading).toBe(false);
  });
});
