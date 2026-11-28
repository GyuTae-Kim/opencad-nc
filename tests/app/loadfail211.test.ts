// @vitest-environment jsdom
/**
 * 211차(WCAG 3.3.1 오류 알림·4.1.3): 열 때 받는 조각(동적 가져오기)을 받지 못했을 때(오프라인에서 새 판과 옛 캐시가 엇갈림·연결 끊김 — 가짜 import 실패로 흉내).
 * 전에는 console.error만 남아 빈 탭(정보 탭 조각)·「불러오는 중…」에 멈춘 탭(깎기 조각)·열리지 않는 창(단축키 창)으로 까닭 없이 보였다.
 * 이제 사용자가 보는 자리에 한 원문 「{이름}을(를) 불러오지 못했습니다.」와 「다시 시도」 — 탭이면 몸통의 글(role=alert)과 버튼, 창이면 알림 상자의 동작 버튼.
 * 같은 실패를 거듭해도 알림 상자는 같은 글 하나(쌓이지 않음 — 이미 있던 깎기 메뉴 알림도). 사전 조각·3D 보기 띠 조각은 첫 화면 소폭 허용을 넘어 이번에 넣지 않았다(README 남은 일 211차).
 * 가짜 실패: vi.mock 공장이 그 조각 이름이 ctl.fail에 있는 동안 던지고, 빼면 원래 모듈을 준다(던진 공장은 캐시되지 않아 다시 받기가 공장을 다시 부른다 —
 * 받은 뒤에는 캐시되어 다시 실패시킬 수 없으니 조각마다 「실패 → 받기」를 한 번씩, 시험 차례가 그것을 따른다).
 * 원래 모듈은 beforeAll에서 미리 평가해 둔다(ci-guard 5번 — 맨 위 곁효과 없는 모듈). 기다림은 vi.waitFor(마감 시간과 조건 — 13번). 초점 규칙은 focus-rules.ts(207·208차 흉내).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ctl = vi.hoisted(() => ({
  fail: new Set<string>(),
  error: (): Error => new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/assets/chunk-x.js'),
}));

const fake = vi.hoisted(() => {
  type Cb = (m: unknown) => void;
  type Section = { axis: string | null; t: number; flip: boolean; position: number };
  class FakeViewer {
    static last: FakeViewer | null = null;
    readonly canvas: HTMLCanvasElement;
    measureMode = false;
    measurePts = 0;
    readonly measureCbs: Cb[] = [];
    readonly hoverCbs: (() => void)[] = [];
    measureHoverSnap = null;
    measureInferenceLock = null;
    measureHoverLock = null;
    measureLabelRect = null;
    section: Section | null = null;
    readonly sectionCbs: ((s: Section | null) => void)[] = [];
    constructor(host: HTMLElement) {
      const wrap = document.createElement('div');
      wrap.className = 'v3d';
      this.canvas = document.createElement('canvas');
      this.canvas.tabIndex = 0;
      wrap.append(this.canvas);
      host.append(wrap);
      FakeViewer.last = this;
      return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => null) });
    }
    get measurePointCount(): number {
      return this.measurePts;
    }
    get measureTrackPoints(): number[][] {
      return [];
    }
    get scene(): unknown {
      return null;
    }
    setMeasureMode(on: boolean): void {
      this.measureMode = on;
    }
    onMeasure(cb: Cb): () => void {
      this.measureCbs.push(cb);
      return () => {};
    }
    onMeasureHoverChange(cb: () => void): () => void {
      this.hoverCbs.push(cb);
      return () => {};
    }
    onSectionChange(cb: (s: Section | null) => void): () => void {
      this.sectionCbs.push(cb);
      return () => {};
    }
    setScene(): void {
      this.measurePts = 0;
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
// 열 때 받는 조각: 이름이 ctl.fail에 있는 동안 받기 실패
vi.mock('../../src/app/panel-info', async (importOriginal) => {
  if (ctl.fail.has('info')) throw ctl.error();
  return importOriginal();
});
vi.mock('../../src/app/shortcuts', async (importOriginal) => {
  if (ctl.fail.has('shortcuts')) throw ctl.error();
  return importOriginal();
});
vi.mock('../../src/app/sim', async (importOriginal) => {
  if (ctl.fail.has('sim')) throw ctl.error();
  return importOriginal();
});

import { NcViewerApp } from '../../src/app/app';
import { browserFocus, focused } from './focus-rules';

// Siemens 예제(208·209차 시험과 같음 — 재생·깎기가 되는 G-code)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
const enc = (t: string): ArrayBuffer => new TextEncoder().encode(t).buffer as ArrayBuffer;
const WAIT = { timeout: 5000 };
/** 알림 상자 가운데 글(닫기·동작 버튼 글은 빼고 — 첫 마디)이 text인 것 */
const toastsWith = (text: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.toasts > .toast')].filter((t) => t.firstChild?.textContent === text);
/** 그 글의 알림이 꼭 하나(쌓이지 않음) */
const only = (text: string): HTMLElement => {
  const list = toastsWith(text);
  expect(list, text).toHaveLength(1);
  return list[0]!;
};

beforeAll(async () => {
  // 원래 조각을 미리 평가해 둔다(ci-guard 5번 — 공장이 받기를 허락할 때 바로 준다). 3D 보기 띠·측정 도구는 가짜로 두지 않는다(앱이 기다리지 않고 받는다)
  await Promise.all(['../../src/app/panel-info', '../../src/app/shortcuts', '../../src/app/sim'].map((m) => vi.importActual(m)));
  await import('../../src/app/viewer-ui');
  await import('../../src/app/measure-tools');
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
  browserFocus();
  localStorage.clear();
});
afterEach(() => {
  ctl.fail.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

const mount = (): { app: NcViewerApp; root: HTMLElement } => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root), root };
};

describe('211차: 열 때 받는 조각을 받지 못하면 보는 자리에 「…을(를) 불러오지 못했습니다.」와 다시 시도', () => {
  it('정보 탭 조각: 탭 몸통에 실패 글과 다시 시도 — 거듭 받지 못하면 초점은 새 다시 시도, 같은 조각의 다른 탭도 실패 글, 받으면 그리고 초점은 지금 탭 버튼', async () => {
    ctl.fail.add('info');
    const { app, root } = mount();
    // 첫 문서는 정보 탭 조각을 기다리다(3초 한도) 받지 못해도 연다(ensureViewer — 그대로)
    expect(await app.openBuffer('part.MPF', enc(SIE))).toBe(true);
    // 정보 탭: 빈 몸통이 아니라 실패 글(role=alert)과 다시 시도
    const api = window.opencadApp!;
    api.togglePanel(true);
    api.setPanelTab('info');
    const body = root.querySelector<HTMLElement>('.panel-body')!;
    const alert = (): HTMLElement | null => body.querySelector<HTMLElement>('p[role="alert"]');
    await vi.waitFor(() => expect(alert()).not.toBeNull(), WAIT);
    const first = alert()!;
    expect(first.textContent).toBe('정보을(를) 불러오지 못했습니다. 다시 시도');
    // 다시 시도해도 받지 못하면 새 실패 글의 다시 시도에 초점(문서로 빠지지 않음)
    const retry = first.querySelector<HTMLButtonElement>('button')!;
    retry.focus();
    retry.click();
    await vi.waitFor(() => expect(alert()).not.toBe(first), WAIT);
    expect(alert()!.textContent).toBe('정보을(를) 불러오지 못했습니다. 다시 시도');
    expect(focused()).toBe(alert()!.querySelector('button'));
    // 같은 조각의 다른 탭(공구)도 그리기마다 다시 받지 않고 실패 글
    api.setPanelTab('tools');
    expect(alert()!.textContent).toBe('공구을(를) 불러오지 못했습니다. 다시 시도');
    api.setPanelTab('info');
    // 받으면 그린다 — 초점은 지금 탭 버튼(207차 남는 칸)
    ctl.fail.delete('info');
    alert()!.querySelector<HTMLButtonElement>('button')!.focus();
    alert()!.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(body.querySelector('.prop-group')).not.toBeNull(), WAIT);
    expect(alert()).toBeNull();
    expect(focused()).toBe(root.querySelector('.panel-tab.active'));
  });

  it('키보드 단축키 창: 열리지 않으면 창 대신 알림 상자에 실패 글과 다시 시도 — 거듭 눌러도 알림은 하나, 다시 시도로 받으면 창이 열린다', async () => {
    ctl.fail.add('shortcuts');
    const { root } = mount();
    const dialogs = (): number => root.querySelectorAll('[role="dialog"][aria-modal="true"]').length;
    const TEXT = '키보드 단축키을(를) 불러오지 못했습니다.';
    // 설정 메뉴 항목 「키보드 단축키」(? 키와 같은 openShortcuts). ? 키는 창(window) 듣기라 앞 시험의 앱도 함께 받아 같은 조각을 동시에 두 번 받는다 —
    // vitest는 동시에 받는 둘째를 공장 안 가져오기로 보고 원래 모듈을 준다(가짜 실패가 풀림). 이 앱의 메뉴 항목으로 한 번씩 연다
    const keysItem = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.firstElementChild?.textContent === '키보드 단축키')!;
    keysItem.click();
    const a = await vi.waitFor(() => only(TEXT), WAIT);
    keysItem.click();
    // 둘째 실패: 같은 글의 알림이 새 알림으로 바뀐다(둘이 되지 않음)
    await vi.waitFor(() => expect(only(TEXT)).not.toBe(a), WAIT);
    expect(only(TEXT).querySelector('.toast-act')!.textContent).toBe('다시 시도');
    expect(dialogs()).toBe(0);
    ctl.fail.delete('shortcuts');
    only(TEXT).querySelector<HTMLButtonElement>('.toast-act')!.click();
    await vi.waitFor(() => expect(dialogs()).toBe(1), WAIT);
    expect(toastsWith(TEXT)).toHaveLength(0);
  });

  it('깎기 조각: 깎기 탭 몸통이 「불러오는 중…」에 멈추지 않고 실패 글과 다시 시도, 메뉴 길 알림(이미 있던 글)은 거듭해도 하나, 받으면 탭을 그린다', async () => {
    ctl.fail.add('sim');
    const { app, root } = mount();
    expect(await app.openBuffer('part.MPF', enc(SIE))).toBe(true);
    const api = window.opencadApp!;
    api.togglePanel(true);
    api.setPanelTab('sim');
    const body = root.querySelector<HTMLElement>('.panel-body')!;
    const alert = (): HTMLElement | null => body.querySelector<HTMLElement>('p[role="alert"]');
    await vi.waitFor(() => expect(alert()?.textContent).toBe('깎기을(를) 불러오지 못했습니다. 다시 시도'), WAIT);
    expect(body.textContent).not.toContain('불러오는 중…');
    // 메뉴 길(소재 깎기 — 108차 알림): 거듭 받지 못해도 알림 상자는 하나
    await api.setSim(true);
    await api.setSim(true);
    const simToasts = (): Element[] => [...document.querySelectorAll('.toasts > .toast.error')].filter((t) => t.firstChild?.textContent?.startsWith('시뮬레이션을 불러오지 못했습니다: '));
    expect(simToasts()).toHaveLength(1);
    // 다시 시도로 받으면 깎기 탭을 그리고 초점은 지금 탭 버튼
    ctl.fail.delete('sim');
    const retry = alert()!.querySelector<HTMLButtonElement>('button')!;
    retry.focus();
    retry.click();
    await vi.waitFor(() => expect(body.querySelector('.prop-group')).not.toBeNull(), WAIT);
    expect(alert()).toBeNull();
    expect(focused()).toBe(root.querySelector('.panel-tab.active'));
  });

  it('글은 네 언어 사전의 한 틀 — 틀이 잡은 이름(탭·메뉴 항목 글)도 그 언어 낱말로(앱은 mixSpan ui), 「다시 시도」도', async () => {
    const { translate } = await import('../../site/i18n.mjs');
    const LANGS = ['en', 'ja', 'zh-CN', 'de'];
    expect(LANGS.map((l) => translate('키보드 단축키을(를) 불러오지 못했습니다.', l, true))).toEqual([
      'Could not load "Keyboard shortcuts".',
      '「キーボードショートカット」を読み込めませんでした。',
      '无法加载“键盘快捷键”。',
      '„Tastenkürzel“ konnte nicht geladen werden.',
    ]);
    expect(LANGS.map((l) => translate('깎기을(를) 불러오지 못했습니다.', l, true))).toEqual(['Could not load "Simulate".', '「切削」を読み込めませんでした。', '无法加载“切削”。', '„Abtrag“ konnte nicht geladen werden.']);
    expect(LANGS.map((l) => translate('다시 시도', l))).toEqual(['Try again', 'もう一度試す', '再试一次', 'Noch einmal versuchen']);
  });
});
