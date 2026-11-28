// @vitest-environment jsdom
/**
 * 208차: 초점 빠짐 전수 감사(WCAG 2.4.3 초점 차례·2.1.1). 누르면 자기나 조상이 숨거나(hidden) 막히거나 떼어지거나 다시 그려지는 칸을 키보드처럼(초점을 두고 click —
 * Enter·Space가 내는 것과 같음) 누른 뒤, 초점이 문서(body)로 빠지지 않는지(HTML focus fixup rule) 본다. 칸 목록은 그 차수 감사 표의 첫 화면 칸이고, 빠진 칸 이름을 모아 한 번에 견준다.
 * 고친 칸: 알림 상자 ✕·동작 버튼(dom.ts toast — 남은 알림의 같은 자리 버튼, 없으면 앱이 준 남는 칸 가운데 받는 첫 칸: 덮개 「취소」·3D 보기·시작 화면 열기 칸),
 * 이 브라우저에 내용이 없는 최근 문서 「열기」(그 줄을 지움 — 다음 항목의 「열기」, 비면 열기 칸 — 최근 문서 ✕와 같은 길).
 * 깎기 조각(sim.test 120·121·178차)·측정 띠(mobile.test 138·154차)·단축키 창(shortcuts·shortcuts-close207)의 칸은 그 시험이 본다.
 * jsdom에 없는 초점 규칙(inert·숨은 칸, 숨거나 막힌 칸의 focus fixup)은 focus-rules.ts(207차 흉내를 떼어 함께 씀). 뷰어 코어(WebGL)는 가짜, 해석은 워커와 같은 길(parseForView — 207차 꼴).
 * 앱이 기다리지 않고 받는 조각은 미리 받아 둔다(ci-guard 5번).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class FakeViewer {
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      // 코어 캔버스는 키보드 초점을 받는다(tabindex 0)
      this.canvas.tabIndex = 0;
      wrap.append(this.canvas);
      host.append(wrap);
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return 0;
    }
    get scene(): unknown {
      return null;
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
import { toast, toastArea } from '../../src/app/dom';
import { loadPanelInfo } from '../../src/app/panel';
import { RecentStore } from '../../src/app/recent';
import { browserFocus, focused } from './focus-rules';
import { memoryBackend, type MemoryBackend } from './recent-memory';

// Siemens: 다른 파일의 부프로그램(L9001 — 해석 판단 띠 「파일 더하기」 줄, 207차 시험과 같은 예제)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
const enc = (t: string): ArrayBuffer => new TextEncoder().encode(t).buffer as ArrayBuffer;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await tick();
};
const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('기다리다 시간이 다 됨');
    await new Promise((r) => setTimeout(r, 5));
  }
  await settle();
};

beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(3D 보기 위 UI·측정 도구·정보 탭 공구 경로 부분)을 미리 받아 둔다(ci-guard 5번)
  await import('../../src/app/viewer-ui');
  await import('../../src/app/measure-tools');
  await loadPanelInfo();
});
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
  vi.stubGlobal('matchMedia', (q: string) => ({ media: q, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  browserFocus();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

const mount = (backend: MemoryBackend): { app: NcViewerApp; root: HTMLElement } => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root, { recent: new RecentStore(backend) }), root };
};
const names = (root: ParentNode): string[] => [...root.querySelectorAll('.recent-list .recent-name')].map((n) => n.textContent ?? '');
const row = (root: ParentNode, i: number): HTMLElement => root.querySelectorAll<HTMLElement>('.recent-list > li')[i]!;

/** 칸을 키보드처럼 누른다(초점을 두고 받았는지 본 뒤 click). 누른 뒤 브라우저라면 초점이 문서로 빠졌을 칸의 이름을 lost에, 누른 뒤 초점을 seen에 */
const walker = () => {
  const lost: string[] = [];
  const seen = new Map<string, Element | null>();
  const press = async (name: string, el: HTMLElement | null | undefined, after: () => Promise<void> = settle): Promise<void> => {
    expect(el, name).toBeTruthy();
    el!.focus();
    expect(document.activeElement, name).toBe(el);
    el!.click();
    await after();
    const at = focused();
    seen.set(name, at);
    if (at === document.body) lost.push(name);
  };
  return { lost, seen, press };
};

describe('208차: 누르면 자기나 조상이 사라지는 칸 — 키보드로 누른 뒤 초점이 문서(body)로 빠지지 않음', () => {
  it('문서 없음(시작 화면): 최근 문서 ✕·내용 없는 「열기」·모두 지우기, 알림 상자 ✕(남은 알림·마지막)·「새로 고침」', async () => {
    const backend = memoryBackend();
    const store = new RecentStore(backend);
    for (const [i, n] of ['a.MPF', 'b.MPF', 'c.MPF', 'd.MPF'].entries()) await store.add(n, enc(SIE), i + 1);
    const { root } = mount(backend);
    await until(() => names(root).length === 4);
    expect(names(root)).toEqual(['d.MPF', 'c.MPF', 'b.MPF', 'a.MPF']);
    const zone = root.querySelector<HTMLElement>('.start .dropzone');
    const { lost, seen, press } = walker();
    const want = new Map<string, Element | null>();

    // 최근 문서 ✕(이미 맞음 — 다음 항목 ✕)
    await press('최근 문서 ✕', row(root, 1).querySelector<HTMLElement>('.recent-del'), () => until(() => names(root).length === 3));
    want.set('최근 문서 ✕', row(root, 1).querySelector('.recent-del'));
    // 이 브라우저에 내용이 없는 「열기」: 덮개(「취소」)를 거쳐 그 줄을 지우고 목록을 다시 그림 → 다음 항목의 「열기」
    for (const v of backend.entries.values()) if (v.entry.name === 'b.MPF') v.data = null as unknown as ArrayBuffer;
    await press('최근 문서 「열기」(내용 없음)', row(root, 1).querySelector<HTMLElement>('.recent-open'), () => until(() => names(root).length === 2));
    expect([names(root), root.querySelector('.start-error')!.textContent]).toEqual([['d.MPF', 'a.MPF'], 'b.MPF: 이 브라우저에 저장된 내용을 찾지 못해 최근 문서에서 지웠습니다.']);
    want.set('최근 문서 「열기」(내용 없음)', row(root, 1).querySelector('.recent-open'));

    // 알림 상자 ✕: 남은 알림이 있으면 그 알림의 ✕, 마지막이면 남는 칸(문서가 없음 — 시작 화면 열기 칸)
    toastArea().replaceChildren();
    toast('알림 하나');
    toast('알림 둘');
    const [x1, x2] = [...toastArea().querySelectorAll<HTMLElement>('.toast-x')];
    await press('알림 ✕(남은 알림)', x1);
    want.set('알림 ✕(남은 알림)', x2!);
    await press('알림 ✕(마지막 — 문서 없음)', x2);
    want.set('알림 ✕(마지막 — 문서 없음)', zone);
    // 동작 버튼(새 버전 「새로 고침」): 알림을 빼고 실행 — 같은 규칙
    let ran = 0;
    toast('새 버전이 있습니다.', 'info', 60_000, { label: '새로 고침', run: () => ran++ });
    await press('알림 「새로 고침」', toastArea().querySelector<HTMLElement>('.toast-act'));
    want.set('알림 「새로 고침」', zone);

    // 모두 지우기(이미 맞음 — 카드가 숨고 열기 칸)
    await press('모두 지우기', root.querySelector<HTMLElement>('.recent-clear'), () => until(() => names(root).length === 0));
    want.set('모두 지우기', zone);

    expect(lost).toEqual([]);
    expect([...want].map(([n, el]) => [n, seen.get(n) === el])).toEqual([...want].map(([n]) => [n, true]));
    expect([ran, toastArea().querySelectorAll('.toast-act').length]).toEqual([1, 0]);
  });

  it('문서: 최근 문서 「열기」·메뉴 항목·단면 축·판단 띠 「파일 더하기」·✕·패널 탭·몸통 버튼·재생 칸·패널 닫기·재생 띠 처음으로·✕·덮개 「취소」·알림 상자 ✕', async () => {
    const backend = memoryBackend();
    await new RecentStore(backend).add('part.MPF', enc(SIE), 1);
    const { app, root } = mount(backend);
    await until(() => names(root).length === 1);
    const { lost, seen, press } = walker();
    const want = new Map<string, Element | null>();
    const tool = (label: string): HTMLElement | null => root.querySelector<HTMLElement>(`.toolbar button[aria-label="${label}"]`);

    // 최근 문서 「열기」(내용 있음 — 새 문서는 3D 보기)
    await press('최근 문서 「열기」(내용 있음)', row(root, 0).querySelector<HTMLElement>('.recent-open'), () => until(() => app.state().docName === 'part.MPF' && !app.state().busy));
    const canvas = root.querySelector<HTMLElement>('.v3d canvas')!;
    want.set('최근 문서 「열기」(내용 있음)', canvas);

    // 펼침 메뉴 넷(설정·표준 뷰·보기 설정·그리기): 열면 첫 항목(고른 하나)에 초점 → 누르면 메뉴를 닫고 메뉴 버튼
    const menus = [...root.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')];
    expect(menus).toHaveLength(4);
    for (const btn of menus) {
      btn.click();
      const item = document.activeElement as HTMLElement;
      const name = `메뉴 항목(${btn.getAttribute('aria-label')})`;
      expect(item.closest('[role="menu"]'), name).toBeTruthy();
      await press(name, item);
      want.set(name, btn);
    }

    // 단면 상자 축 X(누른 축 버튼은 남음)
    root.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click();
    const x = [...root.querySelectorAll<HTMLElement>('.sec-pop .seg')].find((b) => b.textContent === 'X');
    await press('단면 상자 축 X', x);
    want.set('단면 상자 축 X', x!);

    // 해석 판단 띠: 「파일 더하기」(파일 고르기 — 띠는 그대로), ✕(176차 — 남은 줄의 같은 자리, 없으면 3D 보기)
    const notice = (): HTMLElement => root.querySelector<HTMLElement>('.notice-bar [data-notice="missing-program"]')!;
    const add = notice().querySelector<HTMLElement>('button.mb-btn:not(.icon)');
    await press('판단 띠 「파일 더하기」', add);
    want.set('판단 띠 「파일 더하기」', add);
    await press('판단 띠 ✕', notice().querySelector<HTMLElement>('button.mb-btn.icon'));

    // 패널: 탭 버튼(136차)·몸통 첫 버튼(137·175차 — 다시 그린 같은 칸이나 코드 목록)·재생 칸 「처음」·패널 닫기(154차 — 막대 「패널」)
    await press('패널 탭(정보)', root.querySelector<HTMLElement>('.panel-tab[data-tab="info"]'));
    await press('정보 탭 몸통 첫 버튼', root.querySelector<HTMLElement>('.panel-body button:not(:disabled)'));
    await press('패널 탭(공구)', root.querySelector<HTMLElement>('.panel-tab[data-tab="tools"]'));
    await press('공구 탭 몸통 첫 버튼', root.querySelector<HTMLElement>('.panel-body button:not(:disabled)'));
    await press('패널 재생 칸 「처음」', root.querySelector<HTMLElement>('.play-row button'));
    await press('패널 닫기', root.querySelector<HTMLElement>('button[aria-label="패널 닫기"]'));
    want.set('패널 닫기', tool('패널'));

    // 재생 띠(패널이 닫혔고 재생 자리가 있을 때): 처음으로(띠 그대로), ✕(177차 — 막대 「재생」)
    app.seek(1);
    const strip = root.querySelector<HTMLElement>('.play-strip:not(.sim-steps)')!;
    expect(strip.hidden).toBe(false);
    await press('재생 띠 처음으로', strip.querySelector<HTMLElement>('button[aria-label="처음으로"]'));
    await press('재생 띠 ✕', strip.querySelector<HTMLElement>('button[aria-label="재생 끝내기(전체 경로)"]'));
    want.set('재생 띠 ✕', tool('재생'));

    // 읽는 중 덮개 「취소」(180차 — 문서가 있으면 3D 보기)
    (app as unknown as { setBusy(stage: string | null, fraction?: number, name?: string): void }).setBusy('여는 중', 0.1, 'part.MPF');
    await press('덮개 「취소」', root.querySelector<HTMLElement>('.busy-cancel'));
    want.set('덮개 「취소」', canvas);

    // 알림 상자 ✕(남은 알림이 없음 — 덮개는 숨었고 문서가 있으니 3D 보기)
    toastArea().replaceChildren();
    toast('알림 하나');
    await press('알림 ✕(문서)', toastArea().querySelector<HTMLElement>('.toast-x'));
    want.set('알림 ✕(문서)', canvas);

    expect(lost).toEqual([]);
    expect([...want].map(([n, el]) => [n, seen.get(n) === el])).toEqual([...want].map(([n]) => [n, true]));
  });
});
