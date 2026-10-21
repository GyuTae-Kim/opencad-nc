// @vitest-environment jsdom
/**
 * 확인 도구(app.ts·panel.ts): 해석 판단 띠. 뷰어 코어(WebGL)는 가짜로, 해석은 워커와 같은 길(parseForView)로 바로 부른다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    marker: number[] | null = null;
    markerOpts: unknown = null;
    limit: number | null = null;
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
    getProjection(): string {
      return 'perspective';
    }
    getRenderMode(): string {
      return 'shadedEdges';
    }
    groups(): unknown[] {
      return [];
    }
    setMarker(p: number[] | null, kind?: string, opts?: unknown): void {
      this.marker = p;
      this.markerOpts = p ? { kind, ...(opts as object) } : null;
    }
    setDrawLimitBySegmentId(id: number | null): null {
      this.limit = id;
      return null;
    }
  }
  return { FakeViewer, opens: [] as unknown[] };
});

vi.mock('opencad-viewer3d', async (importOriginal) => ({ ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer }));
vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts: unknown) {
      fake.opens.push(opts);
      return parseForView(name, new Uint8Array(data), (opts ?? {}) as object);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import { NcViewerApp } from '../../src/app/app';

function makeApp(): { app: NcViewerApp; root: HTMLElement } {
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root), root };
}
const open = (app: NcViewerApp, name: string, text: string): Promise<boolean> => app.openBuffer(name, new TextEncoder().encode(text).buffer as ArrayBuffer);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const LATHE = `%
O0001
G21 G18 G99
G50 S3000
T0101
G96 S200 M3
G0 X52. Z2.
G1 X40. Z-20. F0.2
G0 X52. Z2.
M30
%`;

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
  fake.opens.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const MILL = `G21 G17 G90 G54
T1 M6
S1000 M3
G0 X0 Y0 Z10
G43 H1 Z5
G1 Z-2 F100
X50
G0 Z30
T2 M6
G0 X10 Y10
G43 H2 Z5
G1 Z-7 F80
G0 Z30
M30`;

describe('공구별 절삭 범위(공구 탭·정보 탭)', () => {
  it('공구 탭 "Z 최저"를 누르면 가장 깊은 절삭 줄로, 정보 탭에 절삭 범위', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    window.opencadApp!.setPanelTab('tools');
    const cells = [...root.querySelectorAll<HTMLButtonElement>('table.tools button.linkish')];
    expect(cells.map((b) => b.textContent)).toEqual(['-2', '-7']);
    cells[1]!.click();
    expect(window.opencadApp!.state.selLine).toBe(11);
    expect(window.opencadApp!.state.panelTab).toBe("code");
    window.opencadApp!.setPanelTab('info');
    const info = root.querySelector('.panel')!.textContent!;
    expect(info).toContain('절삭 범위(이송·호·드릴)');
    expect(info).toContain('가장 깊은 Z');
  });
});

describe('현재 블록 상태', () => {
  it('줄을 고르면 패널 아래 띠에 이송·주축·공구·H·모달 G·끝점, 재생 중에는 재생 막대 아래', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    window.opencadApp!.selectLine(5);
    const foot = root.querySelector('.panel-foot')!.textContent!;
    expect(foot).toContain('직선 이송 · F100 · S1000 M3');
    expect(foot).toContain('T1 · G43 H1 · G54 · G90 · G17');
    expect(foot).toContain('끝점 X 0 · Y 0 · Z -2 mm');
    window.opencadApp!.seek(1);
    const play = root.querySelector<HTMLElement>('.play-state')!;
    expect(play.hidden).toBe(false);
    expect(play.textContent).toMatch(/T1 · G43 H1/);
  });
});

describe('블록 걷기·여기까지 그리기·코드 찾기', () => {
  it('→ 키·다음 단추는 한 이동씩(코드도 따라감), "여기까지"는 고른 줄의 마지막 이동까지', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const first = api.state;
    expect(first.playSec).not.toBeNull();
    expect(first.selLine).toBe(4);
    root.querySelector<HTMLButtonElement>('button[aria-label="다음 이동"]')!.click();
    expect(api.state.selLine).toBe(5);
    root.querySelector<HTMLButtonElement>('button[aria-label="이전 이동"]')!.click();
    expect(api.state.selLine).toBe(4);
    api.selectLine(11);
    const toHere = root.querySelector<HTMLButtonElement>('button[aria-label="여기까지 그리기"]')!;
    expect(toHere.disabled).toBe(false);
    toHere.click();
    // 12번째 줄(G1 Z-7)이 끝난 시각 = 마지막 이동 전
    expect(api.state.playSec).toBeGreaterThan(0);
    expect(fake.FakeViewer.last!.limit).toBe(app.doc!.nc!.lineMoves.moves[app.doc!.nc!.lineMoves.offsets[11]!]);
    // 재생 속도에 ×1000
    expect([...root.querySelectorAll('.play-row select option')].map((o) => o.textContent)).toEqual(['×1', '×10', '×100', '×1000']);
  });

  it('Ctrl+F는 코드 찾기 칸: 글·N 번호·":줄"로 가기, Enter 다음·Shift+Enter 이전', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    const input = root.querySelector<HTMLInputElement>('.code-search input')!;
    expect(document.activeElement).toBe(input);
    const enter = (shift = false): void => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: shift, bubbles: true }));
    };
    input.value = 'g43';
    input.dispatchEvent(new Event('input'));
    enter();
    expect(window.opencadApp!.state.selLine).toBe(4);
    expect(root.querySelector('.find-count')!.textContent).toBe('1/2');
    enter();
    expect(window.opencadApp!.state.selLine).toBe(10);
    enter(true);
    expect(window.opencadApp!.state.selLine).toBe(4);
    input.value = ':13';
    enter();
    expect(window.opencadApp!.state.selLine).toBe(12);
  });
});

describe('경고 → 줄', () => {
  it('정보 탭 경고를 누르면 그 줄로(다시 누르면 같은 경고의 다음 줄), 경고 줄은 코드 줄 앞에 표시', async () => {
    const { app, root } = makeApp();
    await open(app, 'w.nc', `G21 G90 G17\nT1 M6\nG0 X0 Y0 Z10\nG1 Z-1 F100\nG53 G0 Z0\nG0 X10\nG1 Z-1\nG53 G0 Z0\nM30`);
    const api = window.opencadApp!;
    api.setPanelTab('info');
    const btn = [...root.querySelectorAll<HTMLButtonElement>('.warn-list .warn-item')].find((b) => b.textContent!.includes('G53 기계 좌표 쪽'))!;
    expect(btn.querySelector('.ln')!.textContent).toBe('5번 줄');
    expect(btn.querySelector('.cnt')!.textContent).toBe('모두 2번');
    btn.click();
    expect(api.state.panelTab).toBe('code');
    expect(api.state.selLine).toBe(4);
    api.setPanelTab('info');
    [...root.querySelectorAll<HTMLButtonElement>('.warn-list .warn-item')].find((b) => b.textContent!.includes('G53 기계 좌표 쪽'))!.click();
    expect(api.state.selLine).toBe(7);
    await tick();
    await tick();
    const rows = [...root.querySelectorAll<HTMLElement>('.code-list .vlist-row.warn')].map((r) => r.querySelector('.ln')!.textContent);
    expect(rows).toEqual(expect.arrayContaining(['5', '8']));
  });
});

describe('해석 판단 띠', () => {
  it('선반처럼 보이면 선반으로 읽고 띠를 보이며, "밀링으로 읽기"는 선반을 끄고 다시 읽는다', async () => {
    const { app, root } = makeApp();
    expect(await open(app, 'od.nc', LATHE)).toBe(true);
    const bar = root.querySelector<HTMLElement>('.notice-bar')!;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain('선반 프로그램으로 보여');
    const btn = [...bar.querySelectorAll('button')].find((b) => b.textContent === '밀링으로 읽기')!;
    btn.click();
    await tick();
    await tick();
    expect(fake.opens[fake.opens.length - 1]).toEqual({ lathe: false });
    expect(bar.hidden).toBe(true);
  });

  it('✕는 이 문서에서 띠를 닫는다', async () => {
    const { app, root } = makeApp();
    await open(app, 'od.nc', LATHE);
    const bar = root.querySelector<HTMLElement>('.notice-bar')!;
    bar.querySelector<HTMLButtonElement>('button[aria-label="이 안내 닫기"]')!.click();
    expect(bar.hidden).toBe(true);
  });
});
