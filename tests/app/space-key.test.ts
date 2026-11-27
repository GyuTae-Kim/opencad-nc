// @vitest-environment jsdom
/**
 * 149차: 앱 창 키(app.ts onKey — 창 keydown 캡처)의 Space 재생/멈춤이 체크 상자처럼 Space를 스스로 쓰는 칸의 키를 먼저 가져가지 않는다(keys.ts isPressTarget).
 * 재생할 수 있는 G-code를 열고 정보 탭의 묶음(켜고 끄기)·다시 읽는 선택(선반 모드) 상자에 Space를 누르면 재생이 켜지지 않고 상자의 기본 동작(켜고 끄기)을 막지 않는다.
 * 범위 막대(재생 위치)는 Space를 쓰지 않아 지금처럼 재생/멈춤, 버튼은 지금처럼 버튼 몫. 뷰어 코어(WebGL)는 가짜로, 해석은 워커와 같은 길(parseForView)로 바로 부른다(lathe-tools.test 꼴).
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
    /** 정보 탭 묶음(켜고 끄기) 상자가 하나 그려지게 */
    groups(): unknown[] {
      return [{ name: '절삭 이송', visible: true, count: 2 }];
    }
  }
  return { FakeViewer };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown) {
      return parseForView(name, new Uint8Array(data), (opts ?? {}) as object);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';

/** 이동이 있는 G-code(재생할 수 있음) */
const PROGRAM = 'G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z-1 F200\nG1 X40 Y0\nG1 X40 Y30\nM30\n';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean): Promise<void> => {
  const end = Date.now() + 5000;
  for (let i = 0; (i < 50 || Date.now() < end) && !ok(); i++) await tick();
};
/** 그 요소에 Space를 누른다(창 캡처 듣기가 먼저 받는다). 돌려준 사건으로 기본 동작을 막았는지 본다 */
const space = (el: Element): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('149차: 창 키의 Space 재생은 Space를 스스로 쓰는 칸에 둔다', () => {
  it('정보 탭 체크 상자의 Space는 상자 몫(재생 안 켬·기본 동작 막지 않음), 범위 막대·문서 몸은 지금처럼 재생, 버튼은 버튼 몫', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    expect(await api.open('p.nc', PROGRAM)).toBe(true);
    await until(() => api.state.parsed);
    api.setPanelTab('info');
    const optBox = (): HTMLInputElement | undefined =>
      [...root.querySelectorAll<HTMLLabelElement>('label.group-item.opt')].find((l) => l.querySelector('.name')?.textContent === '선반 모드')?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? undefined;
    await until(() => !!optBox());
    expect(api.state.playing).toBe(false);

    // 묶음(켜고 끄기) 상자 — 첫 화면 panel.ts groupList
    const groupBox = root.querySelector<HTMLInputElement>('.groups input[type="checkbox"]')!;
    expect(groupBox).not.toBeNull();
    const a = space(groupBox);
    expect([a.defaultPrevented, api.state.playing]).toEqual([false, false]);

    // 다시 읽는 선택 상자(선반 모드 — panel.ts optToggle, 정보 탭 조각이 그림)
    const b = space(optBox()!);
    expect([b.defaultPrevented, api.state.playing]).toEqual([false, false]);

    // 경계(고치기 전과 같음): 재생 위치 막대는 Space를 쓰지 않아 재생/멈춤, 패널 탭 버튼은 버튼 몫, 문서 몸은 재생/멈춤
    const range = root.querySelector<HTMLInputElement>('.panel input[type="range"][aria-label="재생 위치"]')!;
    expect(range).not.toBeNull();
    const c = space(range);
    expect([c.defaultPrevented, api.state.playing]).toEqual([true, true]);
    api.togglePlay();
    expect(api.state.playing).toBe(false);
    const d = space(root.querySelector('#panel-tab-info')!);
    expect([d.defaultPrevented, api.state.playing]).toEqual([false, false]);
    const e = space(document.body);
    expect([e.defaultPrevented, api.state.playing]).toEqual([true, true]);
    api.togglePlay();
    expect(api.state.playing).toBe(false);
  });
});

describe('164차: 정보 탭 묶음(켜고 끄기) 상자 목록의 무리 이름', () => {
  it('상자 목록은 role=group이고 이름은 보이는 묶음 제목(h3 — aria-labelledby, id는 문서에 하나) — 상자 이름은 그대로, 몸통을 다시 그려도 같음', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    new NcViewerApp(root);
    const api = window.opencadApp!;
    expect(await api.open('p.nc', PROGRAM)).toBe(true);
    await until(() => api.state.parsed);
    const drawn = (): boolean => !!root.querySelector('.groups') && !!root.querySelector('label.group-item.opt');
    const check = (): void => {
      const list = root.querySelector<HTMLElement>('.groups')!;
      const by = list.getAttribute('aria-labelledby') ?? '';
      const title = by ? document.getElementById(by) : null;
      expect([list.getAttribute('role'), title?.tagName, title?.textContent, title?.parentElement === list.parentElement]).toEqual(['group', 'H3', '묶음(켜고 끄기)', true]);
      expect(document.querySelectorAll(`[id="${by}"]`)).toHaveLength(1);
      // 상자 자신의 이름(감싼 label 글 — 묶음 이름과 수)은 그대로
      const box = list.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect([box.closest('label')?.textContent, box.getAttribute('aria-label')]).toEqual(['절삭 이송2', null]);
    };
    api.setPanelTab('info');
    await until(drawn);
    check();
    // 다른 탭에 갔다 돌아와 몸통을 다시 그려도
    api.setPanelTab('tools');
    expect(root.querySelector('.groups')).toBeNull();
    api.setPanelTab('info');
    await until(drawn);
    check();
  });
});
