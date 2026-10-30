// @vitest-environment jsdom
/**
 * 정보 탭의 선반 공구 표(28차 — 선반 공구 끝 R 보정): 보정 경로 보기를 켠 선반 프로그램에서 보정 구간이 쓰는 공구마다 노즈 반지름(mm)·
 * 공구 방향을 고르면 기계·읽기 설정에 기억하고 다시 읽어 보정 구간에 쓴다(파일에 값이 없을 때). 뷰어 코어(WebGL)는 가짜로,
 * 해석은 워커와 같은 길(parseForView)로 바로 부른다.
 */
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
  return { FakeViewer, opens: [] as { name: string; opts: unknown }[] };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown) {
      fake.opens.push({ name, opts });
      return parseForView(name, new Uint8Array(data), (opts ?? {}) as object);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';
import { SETTINGS_KEY } from '../../src/app/settings';

/** Fanuc 선반(T0101 — 노즈 R·공구 방향은 기계의 보정 표에 있어 파일에 없다) */
const LATHE = `O1000\nG18 G21 G40 G99\nT0101\nG0 X80. Z5.\nG42 G1 X40. Z2. F0.2\nG1 Z-20.\nX60.\nG40 G0 X80.\nM30\n`;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean): Promise<void> => {
  const end = Date.now() + 5000;
  for (let i = 0; (i < 50 || Date.now() < end) && !ok(); i++) await tick();
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  localStorage.clear();
  fake.opens.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('정보 탭: 선반 공구 표', () => {
  it('노즈 반지름·공구 방향을 고르면 기억하고 다시 읽어 보정 구간에 쓴다(공구 방향 줄에 값과 출처)', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    await api.open('l.nc', LATHE, { lathe: true, comp: true });
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const dirRow = (): string | null => {
      const r = [...root.querySelectorAll('.prop-row')].find((e) => e.querySelector('.k')?.textContent === '공구 방향');
      return r?.querySelector('.v')?.textContent ?? null;
    };
    expect(dirRow()).toBe('모름 — 노즈 중심');
    expect([...root.querySelectorAll('.prop-row .k')].map((k) => k.textContent)).toContain('T1 노즈 R(mm) · 방향');
    const radius = root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 반지름(mm)"]')!;
    expect(radius.value).toBe('');
    radius.value = '0.4';
    radius.dispatchEvent(new Event('change'));
    await until(() => fake.opens.length === 2 && api.state.parsed);
    await tick();
    const sel = root.querySelector<HTMLSelectElement>('select[aria-label="T1 공구 방향"]')!;
    expect([...sel.options].map((o) => o.value)).toEqual(['', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    sel.value = '3';
    sel.dispatchEvent(new Event('change'));
    await until(() => fake.opens.length === 3 && api.state.parsed);
    await tick();
    expect(fake.opens[2]!.opts).toMatchObject({ comp: true, machine: { latheToolsMm: { 1: { radiusMm: 0.4, orientation: 3 } } } });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).latheTools).toEqual({ 1: { radiusMm: 0.4, orientation: 3 } });
    expect(dirRow()).toBe('3 · 선반 공구 표 T1');
    expect(root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 반지름(mm)"]')!.value).toBe('0.4');
    // 비우면 기억에서 빼고 다시 읽는다
    const r2 = root.querySelector<HTMLInputElement>('input[aria-label="T1 노즈 반지름(mm)"]')!;
    const s2 = root.querySelector<HTMLSelectElement>('select[aria-label="T1 공구 방향"]')!;
    r2.value = '';
    s2.value = '';
    s2.dispatchEvent(new Event('change'));
    await until(() => fake.opens.length === 4 && api.state.parsed);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).latheTools).toEqual({});
    expect(dirRow()).toBe('모름 — 노즈 중심');
  });
});
