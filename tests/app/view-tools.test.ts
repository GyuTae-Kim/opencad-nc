// @vitest-environment jsdom
/**
 * 확인 도구(app.ts·panel.ts): 해석 판단 띠. 뷰어 코어(WebGL)는 가짜로, 해석은 워커와 같은 길(parseForView)로 바로 부른다.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

import { translate } from '../../site/i18n.mjs';
import { NcViewerApp } from '../../src/app/app';

const ROOT = resolve(__dirname, '../..');

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

// 시험이 건 타이머(rAF 대신 쓰는 setTimeout 포함)를 적어 두고 시험마다 지운다. 남은 콜백이 파일 끝 뒤 jsdom을 내린 다음 돌면 전역 document가 없어
// 처리되지 않은 오류(ReferenceError: document is not defined)로 시험이 흔들렸다(110차) — 코드 목록 다시 그리기(패널 setOpen·renderCode의 rAF,
// 코드 찾기 250 ms 타이머)가 줄을 그리며 document.createElement를 부른다. 앱은 한 페이지에 하나라 dispose가 없고, 시험만 앱을 여럿 만든다
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const timers = new Set<unknown>();

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('setTimeout', (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id: unknown = realSetTimeout(() => {
      timers.delete(id);
      cb(...args);
    }, ms);
    timers.add(id);
    return id;
  });
  vi.stubGlobal('clearTimeout', (id: unknown) => {
    timers.delete(id);
    realClearTimeout(id as Parameters<typeof clearTimeout>[0]);
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  fake.opens.length = 0;
});
afterEach(() => {
  for (const id of timers) realClearTimeout(id as Parameters<typeof clearTimeout>[0]);
  timers.clear();
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

  it('160차: "Z 최저" 버튼은 마우스 화면에서도 누르는 칸이 24×24 이상(WCAG 2.5.8 — 둘레의 공구 줄은 누르면 다른 일), 수는 칸 오른쪽 그대로, 문장 안 버튼은 그대로', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    window.opencadApp!.setPanelTab('tools');
    const cells = [...root.querySelectorAll<HTMLButtonElement>('table.tools button.linkish')];
    expect(cells.map((b) => b.textContent)).toEqual(['-2', '-7']);
    // 둘레는 누르면 다른 일(공구 강조·첫 이동 줄)을 하는 공구 줄, 칸은 오른쪽 맞춤 수 칸
    expect(cells.every((b) => b.closest('tr')!.classList.contains('clickable') && b.parentElement!.matches('table.grid td.num'))).toBe(true);
    // jsdom은 CSS 크기를 그리지 않아 styles.css 글로 본다(148차 꼴): 주석과 @media 덩어리를 뺀 맨 바깥 규칙(마우스·손가락 모두에 걸림)
    const css = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()).filter((s) => s.includes('linkish')), body: m[2]! }));
    const sized = rules.filter((r) => r.sels.some((s) => cells.every((b) => b.matches(s))) && /min-height:\s*24px/.test(r.body));
    expect(sized).toHaveLength(1);
    expect(sized[0]!.body).toMatch(/min-width:\s*24px/);
    expect(sized[0]!.body).toMatch(/text-align:\s*inherit/);
    // 문장 안 버튼(깎기 탭 「시뮬레이션하지 않음 … 번 줄」 — 글줄 안 예외)에는 맞지 않아 그 글줄 높이는 그대로
    const inSentence = document.createElement('p').appendChild(document.createElement('button'));
    inSentence.className = 'linkish';
    expect(sized[0]!.sels.some((s) => inSentence.matches(s))).toBe(false);
  });
});

describe('패널 탭 버튼 초점(136차)', () => {
  it('136차: 키보드로 누른 패널 탭 버튼 때문에 탭 버튼 줄을 새로 만들어도 초점은 새 줄의 같은 탭 버튼에(다른 길의 다시 그리기도, 탭 줄 밖 초점은 그대로)', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    const tab = (k: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.panel-tabs [data-tab=${k}]`)!;
    expect([...root.querySelectorAll<HTMLElement>('.panel-tabs [role=tab]')].map((b) => b.dataset.tab)).toEqual(['code', 'tools', 'info', 'sim']);
    expect(api.state.panelTab).toBe('code');
    // 키보드(Enter·Space)로 누름 = 초점이 있는 버튼의 click
    const tools = tab('tools');
    tools.focus();
    tools.click();
    expect(api.state.panelTab).toBe('tools');
    expect(tools.isConnected).toBe(false);
    expect(tab('tools').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('tools'));
    // 초점이 (지금 탭이 아닌) 탭 버튼에 있는 채 다른 길이 다시 그려도 그 탭 버튼에
    const info = tab('info');
    info.focus();
    api.setPanelTab('code');
    expect(info.isConnected).toBe(false);
    expect(tab('code').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('info'));
    // 초점이 탭 줄 밖이면 그대로
    const out = document.body.appendChild(document.createElement('button'));
    out.focus();
    tab('tools').click();
    expect(api.state.panelTab).toBe('tools');
    expect(document.activeElement).toBe(out);
  });
});

describe('패널 몸통 다시 그리기 초점(137차)', () => {
  it('137차: 공구 탭 눈 버튼·정보 탭 해석 설정·기계·읽기 설정을 키보드로 바꿔 몸통을 새로 그려도(다시 읽은 뒤 포함) 초점은 새 몸통의 같은 칸에(몸통 밖 초점은 그대로)', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    api.setPanelTab('tools');
    const eyes = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('table.tools button.toggle')];
    expect(eyes().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    // 키보드(Enter·Space)로 누름 = 초점이 있는 버튼의 click — T2 눈 버튼(이름이 「T2 숨기기」 → 「T2 보이기」로 바뀌어 data-key가 열쇠)
    const eye = eyes()[1]!;
    eye.focus();
    eye.click();
    expect(eye.isConnected).toBe(false);
    expect(eyes()[1]!.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(eyes()[1]);
    // 정보 탭 해석 설정(G-code 형식 고르기 — 다시 읽은 뒤 정보 탭을 새로 그린다)
    api.setPanelTab('info');
    const dialect = (): HTMLSelectElement => root.querySelector<HTMLSelectElement>('select[aria-label="G-code 형식"]')!;
    const sel = dialect();
    sel.focus();
    sel.value = 'fanuc';
    sel.dispatchEvent(new Event('change'));
    await tick();
    await tick();
    expect(sel.isConnected).toBe(false);
    expect(dialect().value).toBe('fanuc');
    expect(document.activeElement).toBe(dialect());
    // 기계·읽기 설정(H·D 번호 확인 상자 — 감싼 label 글이 열쇠): 끄고 다시 켜도(기본값으로 돌림) 같은 칸에
    const hd = (): HTMLInputElement => [...root.querySelectorAll<HTMLLabelElement>('label.group-item')].find((l) => l.textContent === 'H·D 번호 확인')!.querySelector('input')!;
    for (const on of [false, true]) {
      const cb = hd();
      cb.focus();
      cb.click();
      await tick();
      await tick();
      expect(cb.isConnected).toBe(false);
      expect(hd().checked).toBe(on);
      expect(document.activeElement).toBe(hd());
    }
    // 초점이 몸통 밖이면 다시 읽어 새로 그려도 그대로
    const out = document.body.appendChild(document.createElement('button'));
    out.focus();
    dialect().value = 'auto';
    dialect().dispatchEvent(new Event('change'));
    await tick();
    await tick();
    expect(dialect().value).toBe('auto');
    expect(document.activeElement).toBe(out);
  });
});

describe('코드 탭으로 가는 몸통 버튼 초점(175차)', () => {
  const WARN = `G21 G90 G17\nT1 M6\nG0 X0 Y0 Z10\nG1 Z-1 F100\nG53 G0 Z0\nG0 X10\nG1 Z-1\nG53 G0 Z0\nM30`;
  it('175차: 초점이 정보 탭 해석 경고 버튼에 있으면 코드 탭으로 바꿔 몸통을 새로 그린 뒤 코드 목록으로(떼어진 버튼에서 문서로 빠지지 않게), 코드 목록에 있으면 코드 탭을 다시 그려도 그 목록에', async () => {
    const { app, root } = makeApp();
    await open(app, 'w.nc', WARN);
    const api = window.opencadApp!;
    const list = (): HTMLElement => root.querySelector<HTMLElement>('.panel-body .code-list')!;
    api.setPanelTab('info');
    const btn = [...root.querySelectorAll<HTMLButtonElement>('.warn-list .warn-item')].find((b) => b.textContent!.includes('G53 기계 좌표 쪽'))!;
    // 키보드(Enter·Space)로 누름 = 초점이 있는 버튼의 click
    btn.focus();
    btn.click();
    expect(api.state.panelTab).toBe('code');
    expect(api.state.selLine).toBe(4);
    expect(btn.isConnected).toBe(false);
    expect(document.activeElement).toBe(list());
    // 다른 길(API·다시 읽기·언어 바꿈의 show)로 코드 탭을 다시 그려 목록이 떼였다 다시 붙어도 그 목록에
    api.setPanelTab('code');
    expect(document.activeElement).toBe(list());
  });

  it('175차: 공구 탭 Z 최저도 같은 규칙(키보드로 누르면 코드 목록), 초점이 몸통 밖이면 코드 탭으로 바꿔 다시 그려도 그대로', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    const list = (): HTMLElement => root.querySelector<HTMLElement>('.panel-body .code-list')!;
    const cells = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('table.tools button.linkish')];
    api.setPanelTab('tools');
    const deep = cells()[1]!;
    deep.focus();
    deep.click();
    expect(api.state.panelTab).toBe('code');
    expect(api.state.selLine).toBe(11);
    expect(deep.isConnected).toBe(false);
    expect(document.activeElement).toBe(list());
    // 초점이 몸통 밖(다른 칸 — 누르기가 버튼에 초점을 주지 않는 브라우저도)이면 옮기지 않는다
    const out = document.body.appendChild(document.createElement('button'));
    out.focus();
    api.setPanelTab('tools');
    cells()[0]!.click();
    expect(api.state.panelTab).toBe('code');
    expect(document.activeElement).toBe(out);
    api.setPanelTab('code');
    expect(document.activeElement).toBe(out);
  });
});

describe('패널 몸통 이름(141차)', () => {
  it('141차: 패널 몸통(tabpanel)의 이름은 지금 탭 버튼(aria-labelledby), 탭 버튼마다 aria-controls는 몸통 — 탭을 바꾸거나 몸통을 새로 그리거나 새 문서를 열어도 지금 탭을 따르고 id는 하나뿐', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    const body = root.querySelector<HTMLElement>('.panel-body')!;
    const check = (label: string): void => {
      expect(body.getAttribute('role')).toBe('tabpanel');
      const by = document.getElementById(body.getAttribute('aria-labelledby') ?? '');
      expect(by?.textContent).toBe(label);
      expect(by?.getAttribute('role')).toBe('tab');
      expect(by?.getAttribute('aria-selected')).toBe('true');
      const tabs = [...root.querySelectorAll<HTMLElement>('.panel-tabs [role=tab]')];
      expect(tabs).toHaveLength(4);
      for (const b of tabs) expect(document.getElementById(b.getAttribute('aria-controls') ?? '')).toBe(body);
      const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
    };
    check('코드');
    root.querySelector<HTMLButtonElement>('.panel-tabs [data-tab=tools]')!.click();
    check('공구');
    // 몸통을 통째로 다시 그려도(공구 탭 눈 버튼 — 137차)
    const eye = root.querySelector<HTMLButtonElement>('table.tools button.toggle')!;
    eye.click();
    expect(eye.isConnected).toBe(false);
    check('공구');
    // 다른 길로 탭을 바꿔도(show — 해석 경고·찾기·작업 띠 버튼과 같은 길)
    api.setPanelTab('info');
    check('정보');
    // 새 문서(처음 탭 = 코드)
    await open(app, 'n.nc', MILL);
    expect(api.state.panelTab).toBe('code');
    check('코드');
  });
});

describe('패널 탭 줄 키(150차)', () => {
  it('150차: ←→(끝에서 둘레를 돎)·Home·End는 탭 사이로 초점만 옮기고(재생할 수 있는 G-code라도 한 이동 걷기로 가지 않음), Enter·Space로 고르며 Tab 차례는 고른 탭 하나', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    const tab = (k: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.panel-tabs [data-tab=${k}]`)!;
    const stops = (): (string | null)[] => [...root.querySelectorAll<HTMLElement>('.panel-tabs [role=tab]')].map((b) => b.getAttribute('tabindex'));
    // 초점이 있는 칸에 키를 보낸다(창 키 onKey는 창에서 캡처로 먼저 받는다) — 기본 동작을 막았으면 true
    const press = (key: string, shiftKey = false): boolean => !document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    tab('code').focus();
    expect(press('ArrowRight')).toBe(true);
    expect(api.state.playSec).toBeNull();
    expect(document.activeElement).toBe(tab('tools'));
    // 옮기기만 하고 고르지 않는다(수동 활성 — 깎기 탭은 처음 열 때 조각을 받고 원문을 훑는다)
    expect(api.state.panelTab).toBe('code');
    // ← 둘: 코드를 지나 끝(깎기)으로 둘레를 돎, →는 끝에서 처음으로, End·Home
    press('ArrowLeft');
    expect(document.activeElement).toBe(tab('code'));
    press('ArrowLeft');
    expect(document.activeElement).toBe(tab('sim'));
    press('ArrowRight');
    expect(document.activeElement).toBe(tab('code'));
    expect(press('End')).toBe(true);
    expect(document.activeElement).toBe(tab('sim'));
    expect(press('Home')).toBe(true);
    expect(document.activeElement).toBe(tab('code'));
    expect(api.state.panelTab).toBe('code');
    expect(api.state.playSec).toBeNull();
    expect(api.state.selLine).toBe(-1);
    // Tab 차례는 고른 탭(코드) 하나
    expect(stops()).toEqual(['0', '-1', '-1', '-1']);
    // 정보 탭으로 옮겨 누르면(Enter·Space = 초점 버튼의 click — 136차 시험 꼴) 고르고, Tab 차례도 정보 탭, 초점은 새 줄의 정보 탭(136차)
    press('End');
    press('ArrowLeft');
    expect(document.activeElement).toBe(tab('info'));
    tab('info').click();
    expect(api.state.panelTab).toBe('info');
    expect(stops()).toEqual(['-1', '-1', '0', '-1']);
    expect(document.activeElement).toBe(tab('info'));
    // 수정 키가 있으면 탭 줄 키가 아니다 — Shift+→는 지금처럼 앱 키(10이동 걷기), 초점은 그대로
    press('ArrowRight', true);
    expect(api.state.playSec).not.toBeNull();
    expect(document.activeElement).toBe(tab('info'));
  });
});

describe('앱 펼침 메뉴 키(151차)', () => {
  it('151차: 펼친 메뉴에서 Home·End는 처음·끝 항목으로 초점을 옮기고(창 키가 흘려보낸 키를 메뉴가 받음), Tab·Shift+Tab은 메뉴를 닫고 초점 이동은 브라우저 기본 동작으로 둔다', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    // 초점이 있는 칸에 키를 보낸다(창 키 onKey는 창에서 캡처로 먼저 받는다) — 기본 동작을 막았으면 true
    const press = (key: string, shiftKey = false): boolean => !document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    const parts = (name: string) => {
      const w = root.querySelector<HTMLElement>(`.toolbar .tbtn[aria-label="${name}"]`)!.closest<HTMLElement>('.menu-wrap')!;
      return { btn: w.querySelector<HTMLButtonElement>('.tbtn')!, list: w.querySelector<HTMLElement>('.menu')!, items: [...w.querySelectorAll<HTMLButtonElement>('.menu button')] };
    };
    // 표준 뷰(고른 항목이 없어 첫 항목에 초점)
    const views = parts('표준 뷰');
    views.btn.click();
    expect(views.list.hidden).toBe(false);
    expect(document.activeElement).toBe(views.items[0]);
    expect(press('End')).toBe(true);
    expect(document.activeElement).toBe(views.items[9]);
    expect(views.items[9]!.textContent).toBe('북서 등각');
    expect(press('Home')).toBe(true);
    expect(document.activeElement).toBe(views.items[0]);
    // ↑↓는 지금처럼 끝에서 둘레를 돎
    press('ArrowUp');
    expect(document.activeElement).toBe(views.items[9]);
    press('ArrowDown');
    expect(document.activeElement).toBe(views.items[0]);
    expect(api.state.playSec).toBeNull();
    // Tab은 메뉴를 닫고 기본 동작(다음 칸으로 초점 — jsdom은 옮기지 않음)은 막지 않는다
    expect(press('Tab')).toBe(false);
    expect(views.list.hidden).toBe(true);
    expect(views.btn.getAttribute('aria-expanded')).toBe('false');
    // 그리기(고른 그리기 모드에 초점): End는 끝 보이는 항목(소재 깎기), Shift+Tab도 닫는다
    const render = parts('그리기');
    render.btn.click();
    expect(document.activeElement).toBe(render.items[1]);
    expect(press('End')).toBe(true);
    expect(document.activeElement!.textContent).toBe('소재 깎기');
    expect(press('Tab', true)).toBe(false);
    expect(render.list.hidden).toBe(true);
    expect(render.btn.getAttribute('aria-expanded')).toBe('false');
    // Esc는 지금처럼 닫고 메뉴 버튼으로 초점
    views.btn.click();
    press('Escape');
    expect(views.list.hidden).toBe(true);
    expect(document.activeElement).toBe(views.btn);
  });
});

describe('앱 펼침 메뉴 초점 테두리(161차)', () => {
  it('161차: 키보드로 옮긴 메뉴 항목의 초점은 단면 축 버튼(.seg)과 같은 안쪽 2px 강조 테두리(바탕만 바꾸면 메뉴 바탕과 1.44:1·1.25:1 — WCAG 1.4.11), 마우스 올림 모양(바탕)은 그대로', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    // 표준 뷰·그리기·보기 설정·테마 메뉴의 항목(role 셋 — ↑↓·Home·End로 초점이 옮겨 다니는 칸)
    const items = [...root.querySelectorAll<HTMLButtonElement>('.menu button')];
    expect(items.length).toBeGreaterThan(10);
    expect(new Set(items.map((b) => b.getAttribute('role')))).toEqual(new Set(['menuitem', 'menuitemradio', 'menuitemcheckbox']));
    // jsdom은 CSS를 그리지 않아 styles.css 글로 본다(160차 꼴): 주석과 @media 덩어리를 뺀 맨 바깥 규칙
    const css = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const decl = (body: string): Record<string, string> =>
      Object.fromEntries(body.split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k!.trim(), v.join(':').trim()]));
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()), body: decl(m[2]!) }));
    // 메뉴 항목 모두에 맞는 .menu 선택자의 상태 규칙(맨 바깥 :focus-visible 기본 테두리보다 구체성이 높아 이긴다)
    const on = (state: string) => rules.filter((r) => r.sels.some((s) => s.includes('.menu') && s.endsWith(state) && items.every((b) => b.matches(s.slice(0, -state.length)))));
    // 같은 구체성이면 뒤 규칙이 이긴다 — :focus-visible 쪽에서 outline을 정하는 마지막 규칙
    const ring = on(':focus-visible').filter((r) => 'outline' in r.body).pop()!;
    const seg = rules.find((r) => r.sels.includes('.seg:focus-visible'))!.body;
    expect(seg).toEqual({ outline: '2px solid var(--accent)', 'outline-offset': '-2px' });
    expect(ring.body).toEqual(seg);
    // 마우스 올림은 그대로 바탕만(--bg-hover), 초점 테두리 규칙은 올림에 걸리지 않음
    expect(on(':hover').map((r) => r.body.background)).toEqual(['var(--bg-hover)']);
    expect(ring.sels.some((s) => s.includes(':hover'))).toBe(false);
  });
});

describe('잘리는 초점 테두리(162차)', () => {
  it('162차: 패널 탭·코드 목록은 부모가 잘라 바깥 초점 테두리가 한두 변만 남아(첫 탭은 세로 한 줄, 코드 목록은 찾기 줄 아래 가로 한 줄) 단면 축 버튼(.seg)과 같은 안쪽 2px 강조 테두리, 마우스 올림·고른 탭 모양과 vlist.css 차례는 그대로', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    window.opencadApp!.setPanelTab('code');
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.panel-tabs [role=tab]')];
    expect(tabs.map((b) => b.dataset.tab)).toEqual(['code', 'tools', 'info', 'sim']);
    const list = root.querySelector<HTMLElement>('.panel-body .code-list')!;
    expect(list.getAttribute('tabindex')).toBe('0');
    // jsdom은 CSS를 그리지 않아 CSS 글로 본다(160·161차 꼴): 주석과 @media 덩어리를 뺀 맨 바깥 규칙
    const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const decl = (body: string): Record<string, string> =>
      Object.fromEntries(body.split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k!.trim(), v.join(':').trim()]));
    const parse = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()), body: decl(m[2]!) }));
    const rules = parse(read('src/app/styles.css'));
    const body = (sel: string): Record<string, string> | undefined => rules.find((r) => r.sels.includes(sel))?.body;
    // 잘리는 까닭: 탭 줄은 가로 굴림 상자(세로도 auto)이고 높이가 탭 36px라 위·아래가, 코드 몸통은 여백 없이 잘라 왼·오른·아래가 잘린다
    expect(body('.panel-tabs')).toMatchObject({ 'overflow-x': 'auto' });
    expect(body('.panel-tab')).toMatchObject({ height: '36px' });
    expect(body('.panel-body.code')).toMatchObject({ padding: '0', overflow: 'hidden' });
    const seg = body('.seg:focus-visible');
    expect(seg).toEqual({ outline: '2px solid var(--accent)', 'outline-offset': '-2px' });
    // 칸 모두에 맞는 선택자의 상태 규칙(바탕 선택자가 빈 맨 :focus-visible 기본 테두리는 뺀다). 같은 구체성이면 뒤 규칙이 이긴다
    const on = (els: HTMLElement[], state: string) =>
      rules.filter((r) => r.sels.some((s) => s.endsWith(state) && s.length > state.length && els.every((e) => e.matches(s.slice(0, -state.length)))));
    for (const els of [tabs, [list]]) {
      const ring = on(els, ':focus-visible').filter((r) => 'outline' in r.body).pop();
      expect(ring?.body).toEqual(seg);
      expect(ring!.sels.some((s) => s.includes(':hover'))).toBe(false);
    }
    // 마우스 올림(글 색)·고른 탭(밑줄·굵은 글) 모양은 그대로
    expect(on(tabs, ':hover').map((r) => r.body)).toEqual([{ color: 'var(--text)' }]);
    expect(body('.panel-tab.active')).toEqual({ 'border-bottom-color': 'var(--accent)', color: 'var(--text)', 'font-weight': '600' });
    // vlist.css의 outline: 0(같은 구체성이라 뒤의 맨 :focus-visible에 지는 차례)은 그대로 — 새 규칙은 구체성이 높아 차례와 무관
    expect(parse(read('src/view/vlist.css')).find((r) => r.sels.includes('.vlist'))!.body.outline).toBe('0');
  });
});

describe('시작 화면 열기 칸 초점(167차)', () => {
  it('167차: 시작 화면 열기 칸(role=button)의 키보드 초점은 앱 기본 초점 테두리를 지우지 않아 마우스 올림(점선 테두리 색만)과 갈리고 강제 색 모드에서도 보임, 점선 테두리 색 바꿈과 잘리지 않는 여백은 그대로', () => {
    const { root } = makeApp();
    const zone = root.querySelector<HTMLElement>('.start .dropzone')!;
    expect([zone.getAttribute('role'), zone.getAttribute('tabindex')]).toEqual(['button', '0']);
    // jsdom은 CSS를 그리지 않아 styles.css 글로 본다(160~162차 꼴): 주석과 @media 덩어리를 뺀 맨 바깥 규칙
    const css = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const decl = (body: string): Record<string, string> =>
      Object.fromEntries(body.split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k!.trim(), v.join(':').trim()]));
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()), body: decl(m[2]!) }));
    const body = (sel: string): Record<string, string> | undefined => rules.find((r) => r.sels.includes(sel))?.body;
    // 열기 칸에 맞는 선택자의 상태 규칙(바탕 선택자가 빈 맨 :focus-visible 기본 테두리는 뺀다)
    const on = (state: string) => rules.filter((r) => r.sels.some((s) => s.endsWith(state) && s.length > state.length && zone.matches(s.slice(0, -state.length))));
    // 앱 기본 초점 테두리(다른 버튼이 쓰는 모양 — 바깥 1px에 2px 강조)
    expect(body(':focus-visible')).toEqual({ outline: '2px solid var(--accent)', 'outline-offset': '1px' });
    // 열기 칸의 초점 규칙은 outline을 정하지 않는다 — 구체성이 높아 outline: none이면 기본 테두리를 지워, 점선 테두리 색만 바뀌어 마우스 올림과 같았고
    // 강제 색 모드(테두리 색을 시스템 색으로 덮음)에서는 초점 전후가 같았다(WCAG 2.4.7)
    expect(on(':focus-visible').filter((r) => 'outline' in r.body)).toEqual([]);
    // 점선 테두리 색 바꿈은 초점·마우스 올림 모두 그대로, 마우스 올림에는 테두리(outline)가 없다
    expect(on(':focus-visible').map((r) => r.body['border-color'])).toEqual(['var(--accent)']);
    expect(on(':hover').map((r) => r.body)).toEqual([{ 'border-color': 'var(--accent)' }]);
    expect(body('.dropzone')).toMatchObject({ border: '2px dashed var(--border-soft)' });
    // 바깥 3px(1 + 2) 테두리가 잘리지 않음: 시작 화면은 굴림 상자이나 여백이 16px 이상(좁은 화면 20px 16px 32px — @media)
    expect(body('.start')).toMatchObject({ overflow: 'auto', padding: '28px 16px 40px' });
  });
});

describe('메뉴 항목 글 간격(170차)', () => {
  it('170차: 펼침 메뉴 항목은 고정 높이가 아니라 최소 높이(32px, 손가락 40px) — 메뉴 폭이 190px로 정해져 글 간격(WCAG 1.4.12)을 넓히면 긴 항목이 두세 줄이 되어 고정 높이 칸을 넘어 이웃 항목에 걸치거나 겹쳤다, 한 줄 항목의 높이·여백은 그대로', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    // 가장 긴 한국어 항목(제목 막대 설정 메뉴) — 기본 약 141~151px, 글자 간격 0.12em·낱말 간격 0.16em이면 33px 남짓 늘어 글 자리(144px)를 넘어 두 줄
    const items = [...root.querySelectorAll<HTMLButtonElement>('.menu button')];
    expect(items.map((b) => b.textContent)).toContain('밝은 / 어두운 테마로 바꾸기');
    // jsdom은 CSS를 그리지 않아 styles.css 글로 본다(160~169차 꼴): 주석을 뺀 글의 맨 바깥 규칙, @media 덩어리는 따로
    const raw = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const media = /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
    const decl = (body: string): Record<string, string> =>
      Object.fromEntries(body.split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k!.trim(), v.join(':').trim()]));
    const parse = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()), body: decl(m[2]!) }));
    const rules = parse(raw.replace(media, ''));
    const body = (sel: string): Record<string, string> | undefined => rules.find((r) => r.sels.includes(sel))?.body;
    // 메뉴 폭: 버튼 폭의 감싼 칸(relative) 안 absolute에 width가 없어 줄일 수 있는 만큼 줄고 min-width 190 — 항목 글 자리 190 − 테두리 2 − 여백 8 − 항목 여백 36 = 144px
    expect(body('.menu-wrap')).toEqual({ position: 'relative', display: 'inline-flex' });
    const menu = body('.menu')!;
    expect(menu).toMatchObject({ position: 'absolute', left: '0', 'min-width': '190px', padding: '4px', border: '1px solid var(--border)' });
    expect('width' in menu).toBe(false);
    const item = body('.menu button')!;
    const pad = item.padding!.split(' ').map((v) => parseFloat(v));
    expect(parseFloat(menu['min-width']!) - 2 * parseFloat(menu.border!) - 2 * parseFloat(menu.padding!) - pad[1]! - pad[3]!).toBe(144);
    // 줄을 바꾼다: .menu로 시작하는 규칙 어디에도 white-space가 없다
    expect(rules.filter((r) => r.sels.some((s) => s.startsWith('.menu')) && 'white-space' in r.body)).toEqual([]);
    // 항목은 최소 높이 32px(고정 height 없음) — 여백은 좌우만·테두리 0·flex: none(메뉴를 max-height로 줄여도 항목은 그대로 굴림) 그대로
    expect(item).toMatchObject({ flex: 'none', 'min-height': '32px', padding: '0 10px 0 26px', border: '0' });
    expect('height' in item).toBe(false);
    // 손가락 화면 규칙도 최소 높이 40px만
    const coarse = [...raw.matchAll(media)].map((m) => m[0]).filter((b) => b.includes('.menu button'));
    expect(coarse.flatMap((b) => parse(b).filter((r) => r.sels.includes('.menu button')).map((r) => r.body))).toEqual([{ 'min-height': '40px' }]);
    // 손셈: 글 13px/1.45 → 한 줄 18.85 < 32(기본 간격의 한 줄 항목은 높이 그대로), 줄 높이 1.5배 두 줄 39 > 32(고정 높이면 위아래 3.5씩 넘침)
    const font = rules.filter((r) => r.sels.includes('body')).map((r) => r.body.font).filter(Boolean);
    expect(font).toEqual(['13px/1.45 var(--font)']);
    const [size, lh] = font[0]!.split(' ')[0]!.split('/').map((v) => parseFloat(v));
    const min = parseFloat(item['min-height']!);
    expect([size! * lh! < min, size! * 1.5 * 2 > min]).toEqual([true, true]);
  });
});

describe('단면 펼침 상자 초점(152차)', () => {
  it('152차: 단면 상자(role=dialog, 모달 아님)는 열면 눌린 축 버튼에 초점·Esc는 닫고 단면 버튼으로, 초점이 상자·단면 버튼 밖으로 나가면(Tab으로 나감) 닫혀 그 칸의 Esc를 가져가지 않고, 펼친 메뉴도 같은 규칙', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    // 초점이 있는 칸에 키를 보낸다(창 키 onKey는 창에서 캡처로 먼저 받는다) — 기본 동작을 막았으면 true
    const press = (key: string, shiftKey = false): boolean => !document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    const tool = (name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.toolbar .tbtn[aria-label="${name}"]`)!;
    const btn = tool('단면');
    const pop = root.querySelector<HTMLElement>('.sec-pop')!;
    const axes = [...pop.querySelectorAll<HTMLButtonElement>('.seg')];
    // 열면 눌린 축 버튼(단면이 꺼져 있어 「끔」)에 초점
    btn.click();
    expect(pop.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(axes[0]);
    // 상자 안 칸·단면 버튼(Shift+Tab으로 돌아옴)으로 초점이 옮겨도 열린 채
    axes[3]!.focus();
    btn.focus();
    axes[1]!.focus();
    expect(pop.hidden).toBe(false);
    // 상자 밖 다음 칸(측정 버튼 — Tab으로 나간 꼴, jsdom은 Tab으로 초점을 옮기지 않아 focus()로)으로 초점이 가면 닫힌다
    tool('측정').focus();
    expect(pop.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // 그 칸의 Esc를 상자 닫기로 가져가지 않아 초점이 그대로(열린 채 남으면 창 키가 상자를 닫고 단면 버튼으로 초점을 옮겼다)
    press('Escape');
    expect(document.activeElement).toBe(tool('측정'));
    // Esc는 지금처럼 닫고 단면 버튼으로 초점
    btn.click();
    expect(document.activeElement).toBe(axes[0]);
    press('Escape');
    expect(pop.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
    // 펼친 메뉴도 같은 규칙: 초점이 메뉴 밖(여기서는 단면 버튼)으로 가면 닫힌다
    const views = tool('표준 뷰');
    const list = views.closest('.menu-wrap')!.querySelector<HTMLElement>('.menu')!;
    views.click();
    expect(list.hidden).toBe(false);
    btn.focus();
    expect(list.hidden).toBe(true);
    expect(views.getAttribute('aria-expanded')).toBe('false');
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

describe('코드 목록 지금 줄(173차)', () => {
  // 173차(WCAG 4.1.2): 고른 줄·재생 중인 줄은 바탕(.sel·.cur)으로만 보여 화면 읽기가 지금 줄을 몰랐다 — 줄은 role 없는 div라 aria-selected는 뜻이 없어
  // 전역 aria-current를 클래스와 같은 자리에서(지금 줄 = 고른 줄, 없으면 재생 중인 줄 — 한 무리에 하나)
  const current = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('.code-list .vlist-row[aria-current="true"]')].map((r) => r.querySelector('.ln')!.textContent!);
  const lnOf = (root: HTMLElement, cls: string): string[] => [...root.querySelectorAll<HTMLElement>(`.code-list .vlist-row.${cls}`)].map((r) => r.querySelector('.ln')!.textContent!);

  it('173차: 고른 줄에 aria-current="true" — API로 고름·코드 목록 ↓·줄 누름(다시 누르면 풂)·3D에서 고름·코드 찾기 어느 길로 바뀌어도 .sel과 함께, 지금 줄은 하나뿐', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    await tick();
    await tick();
    const api = window.opencadApp!;
    expect(root.querySelectorAll('.code-list .vlist-row')).toHaveLength(14);
    expect(current(root)).toEqual([]);
    api.selectLine(5);
    expect(current(root)).toEqual(['6']);
    expect(lnOf(root, 'sel')).toEqual(['6']);
    const list = root.querySelector<HTMLElement>('.code-list')!;
    list.focus();
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(api.state.selLine).toBe(6);
    expect(current(root)).toEqual(['7']);
    const row = (): HTMLElement => root.querySelector<HTMLElement>('.code-list .vlist-row[data-row="2"]')!;
    row().click();
    expect(current(root)).toEqual(['3']);
    row().click();
    expect(api.state.selLine).toBe(-1);
    expect(current(root)).toEqual([]);
    expect([...root.querySelectorAll('.code-list .vlist-row')].every((r) => r.getAttribute('aria-current') === 'false')).toBe(true);
    (app as unknown as { onPick(p: unknown): void }).onPick({ kind: 'line', id: 'nc-feed', index: 4, point: [0, 0, 0] });
    const picked = app.doc!.nc!.moves.line[4]!;
    expect(api.state.selLine).toBe(picked);
    expect(current(root)).toEqual([String(picked + 1)]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    const input = root.querySelector<HTMLInputElement>('.code-search input')!;
    input.value = ':13';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(api.state.selLine).toBe(12);
    expect(current(root)).toEqual(['13']);
    expect(lnOf(root, 'sel')).toEqual(['13']);
  });

  it('173차: 고른 줄이 없으면 재생 중인 줄이 지금 줄 — 재생이 옮기면 따라가고, 고른 줄이 생기면 그 줄로(재생 줄 .cur는 그대로 보임), 풀면 재생 줄로, 전체 경로면 없음', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    await tick();
    await tick();
    const api = window.opencadApp!;
    api.seek(1);
    const at = app.playbackInfo()!.line;
    expect(at).toBeGreaterThanOrEqual(0);
    expect(current(root)).toEqual([String(at + 1)]);
    expect(lnOf(root, 'cur')).toEqual([String(at + 1)]);
    api.selectLine(0);
    expect(current(root)).toEqual(['1']);
    expect(lnOf(root, 'cur')).toEqual([String(at + 1)]);
    api.seek(1e9);
    const end = app.playbackInfo()!.line;
    expect(end).toBeGreaterThan(at);
    expect(lnOf(root, 'cur')).toEqual([String(end + 1)]);
    expect(current(root)).toEqual(['1']);
    api.selectLine(-1);
    expect(current(root)).toEqual([String(end + 1)]);
    api.seek(null);
    expect(lnOf(root, 'cur')).toEqual([]);
    expect(current(root)).toEqual([]);
  });
});

describe('공구·가공 표 지금 줄(174차)', () => {
  // 174차(WCAG 4.1.2·1.3.1): 공구 표의 강조한 공구 줄·판재 가공 표의 고른 가공 줄(tr.current)은 바탕으로만 보여 화면 읽기가 몰랐다 — 표(table) 줄의
  // aria-selected는 격자 안에서만 뜻이 있어 173차 코드 목록과 같은 전역 aria-current를 줄을 만드는 자리에서(한 표에 하나, 다른 줄은 속성 없음)
  const rows = (root: HTMLElement, table: string, cell: number, sel = ''): string[] =>
    [...root.querySelectorAll<HTMLTableRowElement>(`.panel-body table.${table} tbody tr${sel}`)].map((tr) => tr.cells[cell]!.textContent!);
  const pick = (app: NcViewerApp, p: unknown): void => (app as unknown as { onPick(p: unknown): void }).onPick(p);

  it('174차: 공구 표 — 줄 누름·다시 눌러 풂·두 번 누름·3D에서 고름·빈 곳 누름(고르기)과 눈 버튼·탭 바꿈(다시 그림) 어느 길에도 강조한 공구 줄에만 aria-current="true"', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    window.opencadApp!.setPanelTab('tools');
    const tools = (sel = ''): string[] => rows(root, 'tools', 2, sel);
    const row = (n: string): HTMLTableRowElement => [...root.querySelectorAll<HTMLTableRowElement>('table.tools tbody tr')].find((tr) => tr.cells[2]!.textContent === n)!;
    expect(tools()).toEqual(['T1', 'T2']);
    expect(tools('[aria-current]')).toEqual([]);
    row('T1').click();
    expect(tools('.current')).toEqual(['T1']);
    expect(tools('[aria-current="true"]')).toEqual(['T1']);
    expect(tools('[aria-current]')).toEqual(['T1']);
    row('T2').click();
    expect(tools('.current')).toEqual(['T2']);
    expect(tools('[aria-current]')).toEqual(['T2']);
    row('T2').click();
    expect(tools('.current')).toEqual([]);
    expect(tools('[aria-current]')).toEqual([]);
    row('T1').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    expect(tools('[aria-current="true"]')).toEqual(['T1']);
    // 다시 그리는 길: 눈 버튼(T2 숨기기)·다른 탭에 갔다 옴 — 강조는 그대로
    root.querySelectorAll<HTMLButtonElement>('table.tools button.toggle')[1]!.click();
    expect(tools('.off')).toEqual(['T2']);
    expect(tools('[aria-current]')).toEqual(['T1']);
    root.querySelector<HTMLButtonElement>('.panel-tabs [data-tab=code]')!.click();
    root.querySelector<HTMLButtonElement>('.panel-tabs [data-tab=tools]')!.click();
    expect(tools('[aria-current="true"]')).toEqual(['T1']);
    // 3D에서 선분을 고르면 줄 고르기로 가고 공구 강조는 풀림, 빈 곳을 누르면 풀림
    pick(app, { kind: 'line', id: 'nc-feed', index: 4, point: [0, 0, 0] });
    expect(tools('.current')).toEqual([]);
    expect(tools('[aria-current]')).toEqual([]);
    row('T2').click();
    expect(tools('[aria-current="true"]')).toEqual(['T2']);
    pick(app, null);
    expect(tools('.current')).toEqual([]);
    expect(tools('[aria-current]')).toEqual([]);
  });

  it('174차: 판재 가공 표 — 줄 누름·API로 고름·3D에서 고름·빈 곳 누름(고르기)과 탭 바꿈(다시 그림) 어느 길에도 고른 가공 줄에만 aria-current="true"', async () => {
    const MPR = `[H\nVERSION="4.0 Alpha"\n_BSX=600.000000\n_BSY=400.000000\n_BSZ=19.000000\n\n<100 \\WerkStck\\\nLA="600"\nBR="400"\nDI="19"\n\n${[100, 200, 300].map((x) => `<102 \\BohrVert\\\nXA="${x}"\nYA="100"\nTI="12"\nDU="8"\n`).join('\n')}`;
    // 3D에서 고르면 그 줄로 굴린다(scrollIntoView — jsdom에 없어 잠깐 둔다, sim.test 꼴)
    const proto = Element.prototype as { scrollIntoView?: unknown };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = () => {};
    try {
      const { app, root } = makeApp();
      await open(app, 'p.mpr', MPR);
      expect(window.opencadApp!.state.panelTab).toBe('ops');
      const ops = (sel = ''): string[] => rows(root, 'grid', 0, sel);
      expect(ops()).toEqual(['1', '2', '3']);
      expect(ops('[aria-current]')).toEqual([]);
      root.querySelectorAll<HTMLTableRowElement>('.panel-body table.grid tbody tr')[1]!.click();
      expect(ops('.current')).toEqual(['2']);
      expect(ops('[aria-current="true"]')).toEqual(['2']);
      expect(ops('[aria-current]')).toEqual(['2']);
      app.selectMprOp(2);
      expect(ops('.current')).toEqual(['3']);
      expect(ops('[aria-current]')).toEqual(['3']);
      pick(app, { kind: 'mesh', id: 'mpr-op-0', index: 0, point: [0, 0, 0] });
      expect(ops('.current')).toEqual(['1']);
      expect(ops('[aria-current="true"]')).toEqual(['1']);
      // 다시 그리는 길: 다른 탭에 갔다 옴 — 고른 가공은 그대로
      root.querySelector<HTMLButtonElement>('.panel-tabs [data-tab=vars]')!.click();
      root.querySelector<HTMLButtonElement>('.panel-tabs [data-tab=ops]')!.click();
      expect(ops('[aria-current]')).toEqual(['1']);
      pick(app, null);
      expect(ops('.current')).toEqual([]);
      expect(ops('[aria-current]')).toEqual([]);
    } finally {
      proto.scrollIntoView = had;
    }
  });
});

describe('재생 띠(패널을 닫았을 때)', () => {
  it('패널이 닫혀 있고 재생 자리가 있으면 3D 보기 아래 띠: 시간·줄·상태, 이전·다음·끝내기', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    const strip = root.querySelector<HTMLElement>('.play-strip')!;
    api.seek(1);
    expect(strip.hidden).toBe(true);
    api.togglePanel(false);
    expect(strip.hidden).toBe(false);
    expect(strip.querySelector('.ps-time')!.textContent).toMatch(/^0:01\.0 \/ /);
    expect(strip.querySelector('.ps-state')!.textContent).toContain('T1');
    strip.querySelector<HTMLButtonElement>('button[aria-label="다음 이동"]')!.click();
    const line = api.state.selLine;
    expect(strip.querySelector('.ps-line')!.textContent).toBe(`줄 ${line + 1}`);
    strip.querySelector<HTMLButtonElement>('button[aria-label="재생 끝내기(전체 경로)"]')!.click();
    expect(api.state.playSec).toBeNull();
    expect(strip.hidden).toBe(true);
  });

  it('140차: 재생 위치 막대도 옆 시간 글을 aria-valuetext로 — 화면 읽기가 0~1000 수 대신 시간(패널 재생 막대와 같은 글)', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    const strip = root.querySelector<HTMLElement>('.play-strip')!;
    const range = strip.querySelector<HTMLInputElement>('input[aria-label="재생 위치"]')!;
    const time = (): string => strip.querySelector('.ps-time')!.textContent!;
    const panelRange = root.querySelector<HTMLInputElement>('.panel input[aria-label="재생 위치"]')!;
    api.seek(1);
    api.togglePanel(false);
    expect(strip.hidden).toBe(false);
    expect(time()).toMatch(/^0:01\.0 \/ /);
    expect(range.getAttribute('aria-valuetext')).toBe(time());
    expect(panelRange.getAttribute('aria-valuetext')).toBe(time());
    // 한 이동 앞으로: 시간 글과 함께 바뀐다
    strip.querySelector<HTMLButtonElement>('button[aria-label="다음 이동"]')!.click();
    expect(range.getAttribute('aria-valuetext')).toBe(time());
    expect(panelRange.getAttribute('aria-valuetext')).toBe(time());
  });

  it('178차: 다시 읽기·새 문서 열기는 재생을 멈추고 재생 자리를 지운다(전체 경로) — 띠도 함께 숨어 옛 시간·「재생 멈춤」으로 남지 않는다', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    const strip = root.querySelector<HTMLElement>('.play-strip')!;
    api.togglePanel(false);
    // 재생 자리가 있는 채(멈춤) 다시 읽기 — 해석 판단 띠의 동작 버튼과 같은 길
    api.seek(1);
    expect(strip.hidden).toBe(false);
    await api.reparse({});
    expect(api.state.playSec).toBeNull();
    expect(strip.hidden).toBe(true);
    // 재생 중 새 문서 열기: 새 문서는 재생 자리가 없다
    app.togglePlay();
    expect(api.state.playing).toBe(true);
    expect(strip.hidden).toBe(false);
    expect(strip.querySelector('button[aria-label="재생 멈춤"]')).not.toBeNull();
    expect(await open(app, 'n.nc', MILL)).toBe(true);
    expect(api.state.playing).toBe(false);
    expect(api.state.playSec).toBeNull();
    expect(strip.hidden).toBe(true);
    // 새 문서에서 재생 자리를 정하면 띠가 새 시간으로 다시 보인다
    api.seek(1);
    expect(strip.hidden).toBe(false);
    expect(strip.querySelector('.ps-time')!.textContent).toMatch(/^0:01\.0 \/ /);
  });

  it('181차: 읽는 동안 덮개가 뜨면 재생 띠를 숨기고 걷히면 다시 맞춘다 — 멈춘 재생 자리의 띠가 덮개 밑에 비쳐 Tab으로 닿고 눌려 읽는 중에 앞 문서 재생이 돌았다(다른 파일 열기·다시 읽기)', async () => {
    const { app, root } = makeApp();
    await open(app, 'm.nc', MILL);
    const api = window.opencadApp!;
    const strip = root.querySelector<HTMLElement>('.play-strip')!;
    const busy = root.querySelector<HTMLElement>('.busy')!;
    api.togglePanel(false);
    api.seek(1);
    expect(strip.hidden).toBe(false);
    // 해석을 풀 때까지 쥔다(덮개가 남는다 — 가짜 해석기 인스턴스의 open만 이 시험 동안 바꾼다)
    const client = (app as unknown as { client: { open: (...a: unknown[]) => Promise<unknown> } }).client;
    const real = client.open;
    let release = (): void => {};
    client.open = (...a) => new Promise((r) => (release = () => r(real.apply(client, a))));
    try {
      // 다른 파일 열기: 덮개가 뜨면 재생 띠도 숨는다
      const next = open(app, 'n.nc', MILL);
      expect(busy.hidden).toBe(false);
      expect(strip.hidden).toBe(true);
      // 「취소」: 덮개가 걷히면 앞 문서의 재생 자리 그대로 띠가 다시 보인다
      busy.querySelector<HTMLButtonElement>('.busy-cancel')!.click();
      expect(busy.hidden).toBe(true);
      expect(api.state.playSec).toBe(1);
      expect(strip.hidden).toBe(false);
      expect(strip.querySelector('.ps-time')!.textContent).toMatch(/^0:01\.0 \/ /);
      release();
      expect(await next).toBe(false);
      // 다시 읽기: 덮개 동안 숨고, 다 읽으면 재생 자리를 지워(178차) 숨은 채
      const again = api.reparse({});
      expect(busy.hidden).toBe(false);
      expect(strip.hidden).toBe(true);
      release();
      await again;
      expect(busy.hidden).toBe(true);
      expect(api.state.playSec).toBeNull();
      expect(strip.hidden).toBe(true);
    } finally {
      client.open = real;
    }
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

  it('판재 파일(MPR) 경고도 줄 번호·글·횟수를 따로 보이고(조각마다 번역), 누르면 코드 탭의 그 줄로', async () => {
    const { app, root } = makeApp();
    const mpr = `[H\nVERSION="4.0 Alpha"\nINCH="0"\n[001\nA="Q*2"\nKM="a"\n<100 \\WerkStck\\\nLA="200"\nBR="100"\nDI="19"\n<139 \\Komponente\\\nXA="50"\nYA="20"\n<139 \\Komponente\\\nXA="60"\nYA="20"\n<140 \\Etwas\\\nIN="1"\n!\n`;
    expect(await open(app, 'board.mpr', mpr)).toBe(true);
    const api = window.opencadApp!;
    api.setPanelTab('info');
    const items = [...root.querySelectorAll<HTMLButtonElement>('.warn-list .warn-item')];
    const macro = items.find((b) => b.textContent!.includes('Komponente'))!;
    expect(macro.querySelector('.ln')!.textContent).toBe('11번 줄');
    expect(macro.querySelector('.msg')!.textContent).toBe('지원하지 않는 매크로 <139 \\Komponente\\ — 목록과 위치(점)만 넣음');
    expect(macro.querySelector('.cnt')!.textContent).toBe('모두 2번');
    // 조각마다 다른 언어로: 줄 번호·경고 글·횟수에 한국어가 남지 않는다(변수 식 경고의 안쪽 까닭까지)
    for (const b of items)
      for (const part of b.querySelectorAll('.ln, .msg, .cnt'))
        for (const lang of ['en', 'ja', 'zh-CN', 'de']) expect(translate(part.textContent!, lang), `${lang}: ${part.textContent}`).not.toMatch(/[가-힣]/);
    expect(translate(macro.querySelector('.msg')!.textContent!, 'en')).toBe('Unsupported macro <139 \\Komponente\\ — listed with its position (point) only');
    expect(items.some((b) => b.querySelector('.msg')!.textContent!.startsWith('변수 A 식 "Q*2"을 계산할 수 없음 — '))).toBe(true);
    macro.click();
    expect(api.state.panelTab).toBe('code');
    expect(api.state.selLine).toBe(10);
    await tick();
    await tick();
    expect([...root.querySelectorAll<HTMLElement>('.code-list .vlist-row.warn')].map((r) => r.querySelector('.ln')!.textContent)).toContain('11');
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

  it('띠 안 버튼을 키보드로 누르면(초점이 그 버튼) 띠가 숨은 뒤 초점은 3D 보기로 — 동작은 다시 읽은 뒤, ✕는 곧바로(176차)', async () => {
    const { app, root } = makeApp();
    await open(app, 'od.nc', LATHE);
    // 코어 캔버스는 키보드 초점을 받는다(tabIndex 0 — 가짜 뷰어는 캔버스만 만든다)
    const canvas = fake.FakeViewer.last!.canvas;
    canvas.tabIndex = 0;
    const bar = root.querySelector<HTMLElement>('.notice-bar')!;
    const act = [...bar.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '밀링으로 읽기')!;
    act.focus();
    act.click();
    await tick();
    await tick();
    expect(bar.hidden).toBe(true);
    expect(document.activeElement).toBe(canvas);
    await open(app, 'od.nc', LATHE);
    const x = bar.querySelector<HTMLButtonElement>('button[aria-label="이 안내 닫기"]')!;
    x.focus();
    x.click();
    expect(bar.hidden).toBe(true);
    expect(document.activeElement).toBe(canvas);
  });

  it('초점이 띠 밖이면 띠 버튼을 눌러 띠가 숨어도 초점은 그대로(176차)', async () => {
    const { app, root } = makeApp();
    await open(app, 'od.nc', LATHE);
    const bar = root.querySelector<HTMLElement>('.notice-bar')!;
    const out = root.querySelector<HTMLButtonElement>('.tbtn[aria-label="열기"]')!;
    out.focus();
    [...bar.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '밀링으로 읽기')!.click();
    await tick();
    await tick();
    expect(bar.hidden).toBe(true);
    expect(document.activeElement).toBe(out);
    await open(app, 'od.nc', LATHE);
    out.focus();
    bar.querySelector<HTMLButtonElement>('button[aria-label="이 안내 닫기"]')!.click();
    expect(bar.hidden).toBe(true);
    expect(document.activeElement).toBe(out);
  });

  it('182차: 읽는 동안 덮개가 뜨면 덮는 자리(3D 보기·시작 화면·패널)를 inert로 — 덮개·「취소」·덮개 밖 막대는 아니고 걷히면 거둔다. 판단 띠에 있던 초점은 「취소」로, 걷히면 그 자리로(덮개 밑 판단 띠 버튼에 Tab이 닿고 눌려 읽던 파일을 버렸다 — WCAG 2.4.3)', async () => {
    const { app, root } = makeApp();
    await open(app, 'od.nc', LATHE);
    // 코어 캔버스는 키보드 초점을 받는다(tabIndex 0 — 가짜 뷰어는 캔버스만 만든다)
    const canvas = fake.FakeViewer.last!.canvas;
    canvas.tabIndex = 0;
    const busy = root.querySelector<HTMLElement>('.busy')!;
    const cancel = busy.querySelector<HTMLButtonElement>('.busy-cancel')!;
    const bar = root.querySelector<HTMLElement>('.notice-bar')!;
    const act = [...bar.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '밀링으로 읽기')!;
    const out = root.querySelector<HTMLButtonElement>('.tbtn[aria-label="열기"]')!;
    // 덮개가 덮는 자리 = 작업 영역(덮개의 부모)에서 덮개 밖 칸
    const covered = [...busy.parentElement!.children].filter((el) => el !== busy);
    expect(covered.map((el) => el.className)).toEqual(['view', 'start', 'panel']);
    const inert = (): boolean[] => covered.map((el) => el.hasAttribute('inert'));
    // 해석을 풀 때까지 쥔다(덮개가 남는다 — 가짜 해석기 인스턴스의 open만 이 시험 동안 바꾼다)
    const client = (app as unknown as { client: { open: (...a: unknown[]) => Promise<unknown> } }).client;
    const real = client.open;
    let release = (): void => {};
    client.open = (...a) => new Promise((r) => (release = () => r(real.apply(client, a))));
    // 브라우저처럼 inert 안 칸은 초점을 받지 않게(jsdom은 inert 속성만 두고 초점을 막지 않는다) — 이 시험 동안만
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, o?: FocusOptions): void {
      if (!this.closest('[inert]')) focus.call(this, o);
    };
    try {
      expect(inert()).toEqual([false, false, false]);
      // 판단 띠 동작 버튼을 키보드로(초점이 그 버튼) 눌러 다시 읽기: 덮는 자리만 inert, 초점은 「취소」로
      act.focus();
      act.click();
      expect(busy.hidden).toBe(false);
      expect(inert()).toEqual([true, true, true]);
      expect([busy, cancel, out].map((el) => el.closest('[inert]'))).toEqual([null, null, null]);
      expect(document.activeElement).toBe(cancel);
      // 덮개 밑 판단 띠 버튼은 초점을 받지 않는다
      act.focus();
      expect(document.activeElement).toBe(cancel);
      // Esc 취소: 걷히면 inert를 거두고 초점은 뜰 때 자리(판단 띠 버튼)로, 늦게 온 다시 읽기는 버린다(띠 그대로)
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(busy.hidden).toBe(true);
      expect(inert()).toEqual([false, false, false]);
      expect(document.activeElement).toBe(act);
      release();
      await tick();
      expect(act.isConnected).toBe(true);
      expect(bar.hidden).toBe(false);
      // 초점이 덮개 밖(제목 막대 「열기」)이면 그대로 — 새 문서는 전처럼 3D 보기로(결과를 넣기 앞에서 덮개를 걷어 inert가 없을 때)
      out.focus();
      const next = open(app, 'n.nc', MILL);
      expect(busy.hidden).toBe(false);
      expect(inert()).toEqual([true, true, true]);
      expect(document.activeElement).toBe(out);
      release();
      expect(await next).toBe(true);
      expect(busy.hidden).toBe(true);
      expect(inert()).toEqual([false, false, false]);
      expect(document.activeElement).toBe(canvas);
    } finally {
      HTMLElement.prototype.focus = focus;
      client.open = real;
    }
  });

  it('좁은 화면: 띠 글을 누르면 펼치고(다시 누르면 접음), 알림은 아래쪽 띠 맨 위보다 위로(--toast-clear)', async () => {
    const cbs: (() => void)[] = [];
    const roCb = (): void => cbs.forEach((cb) => cb());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          cbs.push(cb);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const { app, root } = makeApp();
    await open(app, 'od.nc', LATHE);
    const row = root.querySelector<HTMLElement>('.notice-bar .notice')!;
    const text = row.querySelector<HTMLElement>('.nt-text')!;
    expect(text.title).toBe(text.textContent);
    text.click();
    expect(row.classList.contains('open')).toBe(true);
    text.click();
    expect(row.classList.contains('open')).toBe(false);
    // 화면 아래쪽에 붙은 띠(재생 띠 top 513) 위로: innerHeight - 513 + 8
    const strip = root.querySelector<HTMLElement>('.play-strip')!;
    strip.hidden = false;
    strip.getBoundingClientRect = () => ({ top: 513, bottom: 631, height: 118, left: 8, right: 367, width: 359, x: 8, y: 513, toJSON: () => ({}) }) as DOMRect;
    // (jsdom은 CSS 사용자 속성을 담지 않으므로 넣는 값을 본다)
    const set = vi.spyOn(document.body.style, 'setProperty');
    roCb();
    expect(set).toHaveBeenLastCalledWith('--toast-clear', `${innerHeight - 513 + 8}px`);
    strip.hidden = true;
    roCb();
    expect(set).toHaveBeenLastCalledWith('--toast-clear', '0px');
  });

  it('185차: 폭 320px(WCAG 1.4.10 — 1280 화면 400% 확대)에서 동작 버튼은 줄을 바꾸지 않아 긴 버튼 글(독일어 「Als kleinstes Inkrement lesen」 등)이면 글 칸만 몇 글자 폭으로 줄던 것을 — 좁은 화면 규칙에서만 줄을 감싸 글 칸이 8em보다 좁아지면 버튼을 다음 줄로(✕도 정한 32px), 넓은 화면 규칙은 그대로', async () => {
    const { app, root } = makeApp();
    await open(app, 'od.nc', LATHE);
    // 띠 한 줄(app.ts renderNotices): 글(.nt-text)·동작 버튼(.mb-btn)·✕(.mb-btn.icon) — 아래에서 읽는 규칙의 선택자가 실제 칸에 맞는다
    const row = root.querySelector<HTMLElement>('.notice-bar .notice')!;
    const [text, act, close] = [...row.children] as HTMLElement[];
    expect([row.children.length, text!.matches('.notice .nt-text'), act!.matches('.notice .mb-btn:not(.icon)'), close!.matches('.notice .mb-btn.icon')]).toEqual([3, true, true, true]);
    // jsdom은 CSS를 그리지 않아 styles.css 글로 본다(160~170차 꼴): 주석을 뺀 글의 맨 바깥 규칙과 좁은 화면 덩어리(@media (max-width: 759.98px))
    const raw = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const media = /@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
    const decl = (body: string): Record<string, string> =>
      Object.fromEntries(body.split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k!.trim(), v.join(':').trim()]));
    const parse = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()), body: decl(m[2]!) }));
    const pick = (rules: ReturnType<typeof parse>, sel: string): Record<string, string> => Object.assign({}, ...rules.filter((r) => r.sels.includes(sel)).map((r) => r.body));
    const wide = parse(raw.replace(media, ''));
    const narrow = [...raw.matchAll(media)].filter((m) => m[1]!.trim() === '(max-width: 759.98px)').flatMap((m) => parse(m[2]!));
    const o = (sel: string): Record<string, string> => pick(wide, sel);
    const n = (sel: string): Record<string, string> => ({ ...o(sel), ...pick(narrow, sel) });
    // 넓은 화면(맨 바깥 규칙)은 그대로: 한 줄(감싸지 않음), 글 칸 기준 크기는 글 폭(auto), 버튼 글은 줄을 바꾸지 않음
    expect(o('.notice')).toEqual({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      padding: '5px 5px 5px 12px',
      border: '1px solid var(--border-soft)',
      'border-left': '3px solid var(--accent, #3b82f6)',
      'border-radius': '10px',
      background: 'color-mix(in srgb, var(--bg-panel) 94%, transparent)',
      'box-shadow': 'var(--shadow)',
      'font-size': '13px',
      'line-height': '1.35',
    });
    expect(o('.notice .nt-text')).toEqual({ flex: '1 1 auto', 'min-width': '0', 'overflow-wrap': 'anywhere' });
    expect(o('.mb-btn')).toMatchObject({ padding: '0 12px', border: '1px solid var(--border-soft)', 'font-size': '13px', 'white-space': 'nowrap' });
    // 폭 손셈(어림): 13px 글에서 한글·가나·한자 1em, 빈칸 0.3em, 그 밖(라틴·숫자·기호) 0.6em — Helvetica 꼴 라틴 평균(약 0.5em)보다 넉넉히
    const em = parseFloat(o('.notice')['font-size']!);
    const width = (s: string): number =>
      [...s].reduce((w, c) => w + (/[ᄀ-ᇿ　-ヿ㄰-㆏㐀-鿿가-힯＀-￯]/.test(c) ? 1 : c === ' ' ? 0.3 : 0.6) * em, 0);
    const nums = (v: string): number[] => v.split(' ').map((t) => parseFloat(t));
    const [, padR, , padL] = nums(o('.notice').padding!);
    const chrome = padL! + padR! + parseFloat(o('.notice')['border-left']!) + parseFloat(o('.notice').border!);
    const gap = parseFloat(o('.notice').gap!);
    const edge = 2 * nums(o('.mb-btn').padding!)[1]! + 2 * parseFloat(o('.mb-btn').border!);
    // ✕: 정한 폭 32, 자동 최소 크기는 정한 폭과 내용(그림 16 + 테두리 2) 가운데 작은 쪽 — 줄이 넘치면 여기까지 준다
    const xBase = parseFloat(o('.notice .mb-btn.icon').width!);
    const xMin = Math.min(xBase, parseFloat(o('.mb-btn svg').width!) + 2 * parseFloat(o('.mb-btn').border!));
    // 좁은 화면 띠 최대 폭: 100% − 16px
    const side = Number(/^calc\(100% - (\d+)px\)$/.exec(n('.notice-bar')['max-width']!)![1]);
    expect([chrome, gap, edge, xBase, xMin, side]).toEqual([21, 8, 26, 32, 18, 16]);
    const [grow, , auto] = n('.notice .nt-text').flex!.split(' ');
    const basis = n('.notice .nt-text')['flex-basis'] ?? auto!;
    const wraps = n('.notice')['flex-wrap'] === 'wrap';
    type Item = { base: number; min: number; grow: number };
    // 한 줄 크기 나누기(CSS Flexbox 9.7): 남으면 grow 비율로 더하고, 모자라면 shrink(모두 1) × 기준 크기 비율로 줄이되 최소에 걸린 칸은 묶고 다시 나눈다
    const share = (items: Item[], space: number): number[] => {
      const size = items.map((it) => it.base);
      const free = space - size.reduce((a, b) => a + b, 0);
      const grows = items.reduce((a, it) => a + it.grow, 0);
      if (free >= 0) return items.map((it) => it.base + (grows ? (free * it.grow) / grows : 0));
      const frozen = items.map(() => false);
      for (let hit = true; hit; ) {
        hit = false;
        const left = space - items.reduce((a, it, i) => a + (frozen[i] ? size[i]! : it.base), 0);
        const scaled = items.reduce((a, it, i) => a + (frozen[i] ? 0 : it.base), 0);
        items.forEach((it, i) => {
          if (frozen[i]) return;
          const v = it.base + (left * it.base) / scaled;
          size[i] = Math.max(v, it.min);
          if (v < it.min) hit = frozen[i] = true;
        });
      }
      return size;
    };
    /** 띠 한 줄(글·버튼·✕)을 화면 폭 vw에 놓으면: 글 칸 폭, ✕ 폭, 줄 수, 줄마다 칸이 띠 안에 드는지 */
    const lay = (vw: number, note: string, label: string): { text: number; x: number; lines: number; fits: boolean } => {
      const btn = width(label) + edge;
      const items: Item[] = [
        { base: basis === 'auto' ? width(note) : parseFloat(basis) * em, min: 0, grow: Number(grow) },
        { base: btn, min: btn, grow: 0 },
        { base: xBase, min: xMin, grow: 0 },
      ];
      // 띠 폭: 칸들의 한 줄 max-content(글 한 줄 + 버튼 + ✕ + 사이)와 좁은 화면 최대 폭 가운데 작은 쪽
      const inner = Math.min(width(note) + btn + xBase + 2 * gap + chrome, vw - side) - chrome;
      const lines: Item[][] = [];
      for (const it of items) {
        const last = lines.at(-1);
        const used = last ? last.reduce((a, x) => a + Math.max(x.base, x.min) + gap, 0) : 0;
        if (last && (!wraps || used + Math.max(it.base, it.min) <= inner)) last.push(it);
        else lines.push([it]);
      }
      const sizes = new Map<Item, number>();
      for (const line of lines) share(line, inner - gap * (line.length - 1)).forEach((s, i) => sizes.set(line[i]!, s));
      const fits = lines.every((l) => l.reduce((a, it) => a + sizes.get(it)!, 0) + gap * (l.length - 1) <= inner + 1e-9);
      return { text: sizes.get(items[0]!)!, x: sizes.get(items[2]!)!, lines: lines.length, fits };
    };
    // 동작 버튼 글 여섯(doc.ts noticeViews)과 판단 글 둘: 이 띠의 선반 판단(긴 글)·Siemens 판별(짧은 글 — 그래도 8em의 두 배 넘음)
    const labels = [...readFileSync(join(ROOT, 'src/app/doc.ts'), 'utf8').matchAll(/action: \{ label: '([^']+)'/g)].map((m) => m[1]!);
    expect(labels).toEqual(['작업 파일', '밀링으로 읽기', '최소 단위로 읽기', 'G-code 형식 바꾸기', '체계 바꾸기', '파일 더하기']);
    const notes = [text!.textContent!, 'Siemens Sinumerik 프로그램으로 읽었습니다(판별).'];
    const least = 8 * em;
    const bad: string[] = [];
    const wrapped: string[] = [];
    for (const lang of ['ko', 'en', 'ja', 'zh-CN', 'de']) {
      const tr = (s: string): string => (lang === 'ko' ? s : translate(s, lang));
      if (lang !== 'ko') expect([...notes, ...labels].map(tr).filter((s) => /[가-힣]/.test(s)), lang).toEqual([]);
      for (const [k, note] of notes.map(tr).entries()) {
        expect(width(note), `${lang}: ${note}`).toBeGreaterThan(2 * least);
        for (const label of labels.map(tr)) {
          for (const vw of [320, 390, 759]) {
            const r = lay(vw, note, label);
            if (r.text < least || r.x !== xBase || !r.fits) bad.push(`${vw} ${lang} 「${label}」: 글 ${Math.round(r.text)} ✕ ${Math.round(r.x)}${r.fits ? '' : ' 넘침'}`);
            if (vw === 390 && k === 0 && r.lines > 1) wrapped.push(`${lang} ${label}`);
          }
        }
      }
    }
    // 320·390·759(좁은 화면 끝)에서 다섯 언어·버튼 글 여섯·판단 글 둘 모두 글 칸 8em 이상, ✕ 32px, 칸이 띠 밖으로 넘치지 않음
    expect(bad).toEqual([]);
    // 휴대폰 검사 폭(390)에서 줄을 감싸는 것은 독일어 가장 긴 버튼 글뿐 — 나머지는 지금처럼 한 줄(글 칸이 남은 폭을 다 받음)
    expect(wrapped).toEqual(['de Als kleinstes Inkrement lesen']);
  });
});
