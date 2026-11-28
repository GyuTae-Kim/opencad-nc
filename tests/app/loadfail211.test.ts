// @vitest-environment jsdom
/**
 * 211차(WCAG 3.3.1 오류 알림·4.1.3): 열 때 받는 조각(동적 가져오기)을 받지 못했을 때(오프라인에서 새 판과 옛 캐시가 엇갈림·연결 끊김 — 가짜 import 실패로 흉내).
 * 전에는 console.error만 남아 빈 탭(정보 탭 조각)·「불러오는 중…」에 멈춘 탭(깎기 조각)·열리지 않는 창(단축키 창)으로 까닭 없이 보였다.
 * 이제 사용자가 보는 자리에 한 원문 「{이름}을(를) 불러오지 못했습니다.」와 「다시 시도」 — 탭이면 몸통의 글(role=alert)과 버튼, 창이면 알림 상자의 동작 버튼.
 * 같은 실패를 거듭해도 알림 상자는 같은 글 하나(쌓이지 않음 — 이미 있던 깎기 메뉴 알림도). 사전 조각·3D 보기 띠 조각은 첫 화면 소폭 허용을 넘어 211차에 넣지 않았다.
 * 212차: 그 둘도 — 3D 보기 띠는 알림 상자에 같은 글(이름 「가상 커서」)과 다시 시도(그 조각만 다시 받아 붙임), 언어 사전은 첫 사전이면 한국어로 세워 언어 메뉴를 두고
 * 메뉴에서 고른 언어와 함께 언어 이름으로 같은 글(지금 화면 언어 — 받지 못한 언어가 아니라 바꾸기 전 언어)과 다시 시도(그 언어로 바꾸기).
 * 같은 글 거르기는 원문으로 견줘 언어를 바꾼 사이의 같은 실패도 하나, 받기 실패 까닭 글(Firefox·Safari·vite)은 앱 원문 하나로.
 * 213차: 3D 보기 띠는 알림이 닫힌 뒤에도 띠가 필요한 때(뷰어가 있을 때 문서 열기·3D 보기 키 — 받는 중이 아닐 때, 뷰어마다 셋까지) 조용히 다시 받는다(다시 받지 못하면 같은 알림 하나).
 * 같은 글 거르기에서 mixSpan·문자열 밖 조각은 파일 이름 조각(translate="no")뿐이라 붙일 때의 글이 곧 원문 — 언어를 바꾼 사이의 같은 실패도 하나임을 고정한다.
 * 214차: 다시 받아 붙으면(조용한 다시 받기·창 다시 열기·메뉴로 고른 언어) 그 조각의 실패 알림을 닫는다(전에는 8초 남고 그 다시 시도는 아무것도 하지 않고 닫혔다).
 * 3D 보기 띠는 캔버스의 첫 손가락 누름(isPrimary pointerdown)·단면 켜기에도 조용히 다시 받는다(213차 뷰어마다 셋까지 그대로).
 * 알림의 다시 시도를 누른 뒤 또 받지 못하면 그 알림의 버튼을 「새로 고침」으로(같은 문서에서 받지 못한 모듈 받기를 브라우저가 기억할 수 있어 — HTML module map; 글·알림 하나는 그대로).
 * 215차: 탭 몸통의 다시 시도도 — 셈은 받기 함수(한 조각을 이름 넷이 함께 씀)로, 초점은 다시 그린 몸통의 같은 자리 버튼(글이 바뀌어도). 소재 깎기 메뉴 알림(108차)은 받기 실패면
 * 211차 틀(메뉴 항목 글)과 다시 시도(까닭은 콘솔에만 — 받기 실패가 아닌 오류는 108차 글 그대로), 다시 열 길이 있는 열기(예제·최근 문서·?open= 주소)가 예제·3D 보기 코어 조각을
 * 받지 못하면 같은 꼴(다시 시도 = 그 열기를 처음부터, 파일 고르기·끌어 놓기는 손에 바이트가 없어 지금처럼).
 * 가짜 실패: vi.mock 공장이 그 조각 이름이 ctl.fail에 있는 동안 던지고, 빼면 원래 모듈을 준다(던진 공장은 캐시되지 않아 다시 받기가 공장을 다시 부른다 —
 * 받은 뒤에는 캐시되어 다시 실패시킬 수 없으니 조각마다 「실패 → 받기」를 한 번씩, 시험 차례가 그것을 따른다 — 코어 약속(core.ts loadViewerCore)도 이 파일에서 한 번 받으면
 * 남아 3D 보기 띠 시험이 맨 앞, 사전 값을 보는 시험(site/i18n.mjs가 네 사전을 정적으로 가져옴)이 사전 시험 뒤).
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
    // 214차: 단면 켜기(손잡이 자리가 보이게 — 받아 붙인 띠의 손잡이가 켜진 단면에 보이는지)
    setSectionAxis(axis: string, t: number): void {
      this.section = { axis, t, flip: false, position: t };
      for (const cb of this.sectionCbs) cb(this.section);
    }
    sectionHandle(): { x: number; y: number; dx: number; dy: number } | null {
      return this.section ? { x: 40, y: 30, dx: 1, dy: 0 } : null;
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

// 215차: 3D 보기 코어 조각도(이 파일에서 처음 받을 때만 — 받으면 core.ts loadViewerCore 약속이 남는다)
vi.mock('opencad-viewer3d', async (importOriginal) => {
  if (ctl.fail.has('core')) throw ctl.error();
  return { ...(await importOriginal<object>()), Viewer3d: fake.FakeViewer };
});
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
  // 215차: 받기 실패가 아닌 오류(조각은 왔는데 만들지 못함 꼴 — 받기 실패 글이 아님)
  if (ctl.fail.has('sim-bad')) throw new Error('SimView를 만들지 못함');
  if (ctl.fail.has('sim')) throw ctl.error();
  return importOriginal();
});
// 215차: 예제 조각(열 때 받는 예제 글)
vi.mock('../../src/view/sample', async (importOriginal) => {
  if (ctl.fail.has('sample')) throw ctl.error();
  return importOriginal();
});
// 212차: 3D 보기 띠(코어와 함께 받는 viewer-ui)와 언어 사전 둘
vi.mock('../../src/app/viewer-ui', async (importOriginal) => {
  if (ctl.fail.has('ui')) throw ctl.error();
  return importOriginal();
});
vi.mock('../../site/locales/de.json', async (importOriginal) => {
  if (ctl.fail.has('de')) throw ctl.error();
  return importOriginal();
});
vi.mock('../../site/locales/ja.json', async (importOriginal) => {
  if (ctl.fail.has('ja')) throw ctl.error();
  return importOriginal();
});

import { touchPointerEvent } from '../../src/app/aim';
import { NcViewerApp } from '../../src/app/app';
import { isChunkLoadError } from '../../src/app/core';
import { installLocalization } from '../../src/app/i18n';
import { errorText } from '../../src/app/protocol';
import { browserFocus, focused } from './focus-rules';

// Siemens 예제(208·209차 시험과 같음 — 재생·깎기가 되는 G-code)
const SIE = ['; PART 1', 'G71 G17 G90', 'T="FLAT_D6" D1', 'M6', 'S1000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X20', 'G1 Y20', 'L9001', 'M30', ''].join('\n');
const enc = (t: string): ArrayBuffer => new TextEncoder().encode(t).buffer as ArrayBuffer;
const WAIT = { timeout: 5000 };
/** 3D 보기 띠 조각을 받지 못한 알림 글 */
const UI = '가상 커서을(를) 불러오지 못했습니다.';
/** 알림의 동작 버튼 글(다시 시도·새로 고침) */
const act = (t: HTMLElement): string | null | undefined => t.querySelector('.toast-act')?.textContent;
/** 알림 상자 가운데 글(닫기·동작 버튼 글은 빼고 — 첫 마디)이 text인 것 */
const toastsWith = (text: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.toasts > .toast')].filter((t) => t.firstChild?.textContent === text);
/** 그 글의 알림이 꼭 하나(쌓이지 않음) */
const only = (text: string): HTMLElement => {
  const list = toastsWith(text);
  expect(list, text).toHaveLength(1);
  return list[0]!;
};

beforeAll(async () => {
  // 원래 조각을 미리 평가해 둔다(ci-guard 5번 — 공장이 받기를 허락할 때 바로 준다). 측정 도구는 가짜로 두지 않는다(앱이 기다리지 않고 받는다).
  // 212차: 3D 보기 띠·사전 둘도 가짜 공장 뒤라 importActual로(import로 받으면 공장이 받기를 허락해 캐시되어 실패시킬 수 없다)
  const actual = ['../../src/app/panel-info', '../../src/app/shortcuts', '../../src/app/sim', '../../src/app/viewer-ui', '../../site/locales/de.json', '../../site/locales/ja.json', '../../src/view/sample'];
  await Promise.all(actual.map((m) => vi.importActual(m)));
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
  history.replaceState(null, '', '/');
});

const mount = (): { app: NcViewerApp; root: HTMLElement } => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  return { app: new NcViewerApp(root), root };
};

/** 언어 메뉴에서 그 언어를 고른다(site-kit 메뉴 항목 — 받기는 메뉴가 기다린다) */
const pick = (lang: string): void => document.querySelector<HTMLButtonElement>(`.language-list [data-language="${lang}"]`)!.click();

// 215차 묶음이 맨 앞: 3D 보기 코어 조각은 코어 약속이 이 파일에서 처음 받는 때만 실패시킬 수 있다(받으면 남는다). 3D 보기 띠·정보 탭 조각은 아래 시험 몫이라 받지 못하게 둔다
describe('215차: 다시 열 길이 있는 열기(예제·?open= 주소)가 예제·3D 보기 코어 조각을 받지 못할 때', () => {
  it('예제 조각·코어 조각: 까닭 없는 「{이름}을(를) 불러오지 못했습니다.」와 다시 시도(그 열기를 처음부터 — 예제는 예제를, 주소는 받기부터), 누른 다시 시도도 받지 못하면 「새로 고침」, 받으면 닫는다 — 손에 바이트가 없는 열기는 지금처럼', async () => {
    ctl.fail.add('sample');
    ctl.fail.add('core');
    ctl.fail.add('ui');
    ctl.fail.add('info');
    const { app, root } = mount();
    const startError = root.querySelector<HTMLElement>('.start-error')!;
    const SAMPLE = '예제 열기을(를) 불러오지 못했습니다.';
    const CORE = '3D 보기을(를) 불러오지 못했습니다.';
    // 예제 조각: 전에는 시작 화면 오류 칸에 까닭(브라우저 글을 바꾼 앱 글 — 이 시험 틀에서는 가짜 모듈 오류 글)만, 다시 시도 없음
    expect(await app.openSample()).toBe(false);
    const a = only(SAMPLE);
    expect([a.getAttribute('role'), act(a), a.textContent, startError.hidden, app.state().error]).toEqual(['alert', '다시 시도', `${SAMPLE}다시 시도×`, true, SAMPLE]);
    expect(console.error).toHaveBeenCalled();
    // 다시 시도 = 그 열기를 처음부터: 예제를 받아 해석하고 3D 보기 코어를 받는다 — 받지 못하면 그 이름으로 같은 꼴(전에는 「…: 3D 보기를 만들지 못했습니다: …」 오류 칸·다시 시도 없음)
    ctl.fail.delete('sample');
    a.querySelector<HTMLButtonElement>('.toast-act')!.click();
    const b = await vi.waitFor(() => only(CORE), WAIT);
    expect([act(b), toastsWith(SAMPLE).length, startError.hidden, app.state().error]).toEqual(['다시 시도', 0, true, CORE]);
    // 손에 바이트가 없는 열기(파일 고르기·끌어 놓기 — 바이트는 워커로 넘겨 비워진다, 같은 openBuffer 길에 다시 열 길을 주지 않음)는 지금처럼 오류 칸·다시 시도 없음
    expect(await app.openBuffer('pick.MPF', enc(SIE))).toBe(false);
    expect(startError.hidden).toBe(false);
    expect(startError.textContent).toMatch(/^pick\.MPF: 3D 보기를 만들지 못했습니다: /);
    expect(only(CORE)).toBe(b);
    // ?open= 주소: 같은 글 하나(새 알림), 남은 오류 칸은 감춘다(마지막 오류는 알림 — state().error도)
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, arrayBuffer: async () => enc(SIE) }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await app.openUrl('/files/url.MPF')).toBe(false);
    const c = only(CORE);
    expect([c === b, act(c), startError.hidden, app.state().error]).toEqual([false, '다시 시도', true, CORE]);
    // 그 다시 시도는 주소에서 다시 받는다 — 또 받지 못하면 214차 꼴로 「새로 고침」(같은 글 하나)
    c.querySelector<HTMLButtonElement>('.toast-act')!.click();
    await vi.waitFor(() => expect(act(only(CORE))).toBe('새로 고침'), WAIT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 받을 수 있게 되면(다른 길 — 예제 열기 버튼과 같은 openSample) 열고 남은 실패 알림을 닫는다(214차 꼴)
    ctl.fail.delete('core');
    expect(await app.openSample()).toBe(true);
    expect([toastsWith(CORE).length, toastsWith(SAMPLE).length, app.state().error, root.querySelector<HTMLElement>('.view')!.hidden]).toEqual([0, 0, null, false]);
  });
});

// 212차 묶음: 3D 보기 띠는 띠 조각이 이 파일에서 처음 받는 때만(215차 시험은 코어를 받되 띠는 받지 못하게 둔다), 사전 둘은 아래 211차 사전 값 시험(site/i18n.mjs가 정적으로 받음)보다 먼저 실패시킬 수 있다
describe('212차: 3D 보기 띠·언어 사전 조각을 받지 못할 때, 언어를 바꾼 사이의 같은 실패, 받기 실패 까닭 글', () => {
  it('3D 보기 띠 조각: 받지 못해도 문서는 열고 알림 상자에 「가상 커서을(를) 불러오지 못했습니다.」와 다시 시도 — 213차: 알림이 닫힌 뒤에도 다음 문서 열기·3D 보기 키에 조용히 다시 받는다(다시 받지 못하면 같은 알림 하나), 214차: 다시 시도도 받지 못하면 버튼은 「새로 고침」', async () => {
    // 정보 탭 조각도 받지 못하게 둔다(여기서 받으면 캐시되어 아래 211차 정보 탭 시험이 실패시킬 수 없다 — 받지 못한 약속은 비워진다)
    ctl.fail.add('ui');
    ctl.fail.add('info');
    const { app, root } = mount();
    expect(await app.openBuffer('part.MPF', enc(SIE))).toBe(true);
    const view = root.querySelector<HTMLElement>('.view')!;
    // 전에는 글 없이 빠지고 뷰어가 생긴 뒤 다시 받지 않았다(코어 약속이 받은 채 남음)
    const a = await vi.waitFor(() => only(UI), WAIT);
    expect(a.getAttribute('role')).toBe('alert');
    expect(act(a)).toBe('다시 시도');
    expect([view.querySelector('.sec-handle'), view.querySelector('.key-live')]).toEqual([null, null]);
    // 다시 받지 못하면 알림은 새 알림 하나로 바뀐다(같은 글 하나)
    a.querySelector<HTMLButtonElement>('.toast-act')!.click();
    await vi.waitFor(() => expect(only(UI)).not.toBe(a), WAIT);
    // 214차: 누른 다시 시도가 또 받지 못했다 — 그 알림의 버튼은 「새로 고침」(같은 문서의 다시 받기가 브라우저에 실패로 기억될 수 있어), 글은 그대로·알림 하나
    expect(act(only(UI))).toBe('새로 고침');
    // 213차: 알림을 닫으면(✕ — 8초 뒤 저절로 닫힐 때와 같다) 212차는 다시 받는 길이 없었다(다른 문서를 열어도 뷰어가 이미 있어 그대로 — 새로 고침뿐)
    only(UI).querySelector<HTMLButtonElement>('.toast-x')!.click();
    expect(toastsWith(UI)).toHaveLength(0);
    // 다음 문서 열기: 조용히 다시 받는다 — 받지 못하면 같은 알림이 다시 하나(214차: 조용한 다시 받기의 실패는 세지 않고 버튼은 앞 누름대로 「새로 고침」)
    expect(await app.openBuffer('part2.MPF', enc(SIE))).toBe(true);
    const b = await vi.waitFor(() => only(UI), WAIT);
    expect(act(b)).toBe('새로 고침');
    // 3D 보기 키(가상 커서를 켜는 Enter): 한 번 더 — 받지 못하면 그 알림이 새 알림으로 바뀐다(둘이 되지 않음).
    // 받아 붙는 길(단면 켜기)은 다음 시험의 새 뷰어로(조각은 이 파일에서 한 번만 받을 수 있다 — 받으면 캐시)
    fake.FakeViewer.last!.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(only(UI)).not.toBe(b), WAIT);
  });

  it('214차: 3D 보기 띠 조각 — 캔버스 첫 손가락 누름·단면 켜기에도 조용히 다시 받고, 받아 붙으면 남은 실패 알림을 닫는다(손잡이는 켜진 단면 자리에)', async () => {
    ctl.fail.add('ui');
    ctl.fail.add('info');
    // 새 앱·새 뷰어(조용한 다시 받기는 뷰어마다 셋까지 — 앞 시험의 뷰어는 둘을 썼다)
    const { app, root } = mount();
    expect(await app.openBuffer('part.MPF', enc(SIE))).toBe(true);
    const view = root.querySelector<HTMLElement>('.view')!;
    const a = await vi.waitFor(() => only(UI), WAIT);
    // 3D 보기 캔버스의 첫 손가락 누름: 213차는 키만이라 손가락만 쓰는 기기는 다음 문서 열기에서만 다시 받았다 — 받지 못하면 같은 알림 하나(새 알림)
    fake.FakeViewer.last!.canvas.dispatchEvent(touchPointerEvent('pointerdown', 7, 40, 30));
    await vi.waitFor(() => expect(only(UI)).not.toBe(a), WAIT);
    // 단면 켜기(손잡이가 필요한 때 — 단면 상자 X): 받을 수 있게 되면 받아 붙이고 손잡이는 켜진 단면 자리에 보인다
    ctl.fail.delete('ui');
    [...root.querySelectorAll<HTMLButtonElement>('.sec-pop .seg')].find((b) => b.textContent === 'X')!.click();
    await vi.waitFor(() => expect(view.querySelector('.key-live')).not.toBeNull(), WAIT);
    expect(view.querySelector<HTMLElement>('.sec-handle')?.hidden).toBe(false);
    // 남은 실패 알림은 닫는다 — 213차는 8초 남고 그 다시 시도(받은 뒤라 uiRetry 없음)는 아무것도 하지 않고 닫혔다
    expect(toastsWith(UI)).toHaveLength(0);
    // 다음 문서를 열어도 다시 받지 않는다(띠는 하나)
    expect(await app.openBuffer('part2.MPF', enc(SIE))).toBe(true);
    expect([view.querySelectorAll('.key-live').length, view.querySelectorAll('.sec-handle').length]).toEqual([1, 1]);
  });

  it('언어 사전 조각: 첫 사전을 받지 못하면 한국어로 세워 언어 메뉴를 두고, 메뉴에서 고른 언어도 — 지금 화면 언어로 「{언어 이름}을(를) 불러오지 못했습니다.」와 다시 시도, 언어를 바꾼 사이의 같은 실패도 하나 — 214차: 메뉴로 다시 골라 받으면 그 실패 알림을 닫는다', async () => {
    ctl.fail.add('de');
    ctl.fail.add('ja');
    const lang0 = document.documentElement.lang;
    history.replaceState(null, '', '/opencad-nc/de/');
    const { root } = mount();
    // 전에는 첫 사전 거부로 설치가 멈춰 언어 메뉴 없이 한국어 화면이었다(새로 고침뿐)
    const dispose = await installLocalization(root);
    try {
      expect(document.documentElement.lang).toBe('ko');
      expect(document.querySelector('.language-list [data-language="de"]')).not.toBeNull();
      // 글은 지금 화면 언어(한국어) — 받지 못한 독일어 사전 글이 아니다
      const DE = 'Deutsch을(를) 불러오지 못했습니다.';
      expect(only(DE).querySelector('.toast-act')!.textContent).toBe('다시 시도');
      // 메뉴에서 고른 일본어도 받지 못함: 화면은 한국어 그대로(전에는 글 없이 그대로)
      pick('ja');
      await vi.waitFor(() => only('日本語을(를) 불러오지 못했습니다.'), WAIT);
      expect(document.documentElement.lang).toBe('ko');
      // 다시 시도로 독일어를 받으면 독일어 화면, 그 알림은 빠지고 남은 일본어 알림은 새 언어로 다시 옮겨진다(202차 relangToasts)
      ctl.fail.delete('de');
      only(DE).querySelector<HTMLButtonElement>('.toast-act')!.click();
      await vi.waitFor(() => expect(document.documentElement.lang).toBe('de'), WAIT);
      expect(toastsWith(DE)).toHaveLength(0);
      const JA = '„日本語“ konnte nicht geladen werden.';
      const old = only(JA);
      // 독일어 화면에서 다시 일본어: 독일어 글로, 앞 알림(한국어 화면 때 붙인 같은 실패)과 원문으로 견줘 하나 — 211차는 붙일 때의 글로 견줘 둘이었다
      pick('ja');
      await vi.waitFor(() => expect(only(JA)).not.toBe(old), WAIT);
      // 214차: 메뉴로 다시 고른 실패는 알림의 다시 시도가 아니라 세지 않는다(버튼은 다시 시도 그대로)
      await vi.waitFor(() => expect(only(JA).querySelector('.toast-act')!.textContent).toBe('Noch einmal versuchen'), WAIT);
      expect(document.querySelectorAll('.toasts > .toast.error')).toHaveLength(1);
      expect(document.documentElement.lang).toBe('de');
      // 214차: 받을 수 있게 되면 메뉴에서 다시 골라 받은 언어의 실패 알림은 닫는다(전에는 새 언어로 다시 옮겨져 「日本語」를 읽지 못했다는 글이 일본어 화면에 남았다)
      ctl.fail.delete('ja');
      pick('ja');
      await vi.waitFor(() => expect(document.documentElement.lang).toBe('ja'), WAIT);
      expect(document.querySelectorAll('.toasts > .toast.error')).toHaveLength(0);
    } finally {
      dispose();
      document.documentElement.lang = lang0;
      history.replaceState(null, '', '/');
    }
  });

  it('받기 실패 까닭 글: Firefox·Safari·vite 미리 받기 글도 Chrome과 같은 앱 원문 하나로(알림에 브라우저 영어 글이 섞이지 않음) — 조각 받기 실패 알아보기는 그대로', () => {
    const NET = '파일을 받지 못했습니다(네트워크 오류).';
    const msgs = [
      'Failed to fetch dynamically imported module: http://127.0.0.1/assets/sim-a.js',
      'error loading dynamically imported module: http://127.0.0.1/assets/sim-a.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/sim-a.css',
    ];
    expect(msgs.map((m) => errorText(new TypeError(m)))).toEqual(msgs.map(() => NET));
    expect(msgs.map((m) => isChunkLoadError(new TypeError(m)))).toEqual([true, true, true, true]);
    expect([errorText(new TypeError('Load failed')), errorText(new Error('잘못된 줄')), isChunkLoadError(new TypeError('Load failed'))]).toEqual([NET, '잘못된 줄', false]);
  });
});

describe('211차: 열 때 받는 조각을 받지 못하면 보는 자리에 「…을(를) 불러오지 못했습니다.」와 다시 시도', () => {
  it('정보 탭 조각: 탭 몸통에 실패 글과 다시 시도, 같은 조각의 다른 탭도 실패 글 — 215차: 누른 다시 시도도 받지 못하면 그 버튼은 「새로 고침」(셈은 받기 함수 — 같은 조각의 다른 탭도), 초점은 다시 그린 몸통의 같은 자리 버튼', async () => {
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
    expect(alert()!.textContent).toBe('정보을(를) 불러오지 못했습니다. 다시 시도');
    // 같은 조각의 다른 탭(공구)도 그리기마다 다시 받지 않고 실패 글 — 탭을 바꿔 다시 그린 것은 다시 시도 누름이 아니라 세지 않는다
    api.setPanelTab('tools');
    expect(alert()!.textContent).toBe('공구을(를) 불러오지 못했습니다. 다시 시도');
    api.setPanelTab('info');
    const first = alert()!;
    // 다시 시도해도 받지 못하면(214차까지는 새 「다시 시도」 — 같은 문서에서는 또 곧바로 실패할 수 있다, HTML module map) 그 버튼은 「새로 고침」,
    // 초점은 그 버튼(문서로 빠지지 않음 — 버튼 글이 바뀌어도 137차 몸통 열쇠가 같은 자리, 214차는 글이 열쇠라 탭 버튼으로 갔을 꼴)
    const retry = first.querySelector<HTMLButtonElement>('button')!;
    retry.focus();
    retry.click();
    await vi.waitFor(() => expect(alert()).not.toBe(first), WAIT);
    expect(alert()!.textContent).toBe('정보을(를) 불러오지 못했습니다. 새로 고침');
    expect(focused()).toBe(alert()!.querySelector('button'));
    // 셈은 받기 함수(조각) 열쇠: 이름이 다른 같은 조각의 탭(공구)도 「새로 고침」(이름으로 세면 정보 탭의 누름이 닿지 않는다).
    // 받아 그리는 길(초점은 지금 탭 버튼)은 아래 깎기 시험이 본다(여기서는 몸통 버튼이 「새로 고침」뿐이고 jsdom에는 새로 고침이 없다)
    api.setPanelTab('tools');
    expect(alert()!.textContent).toBe('공구을(를) 불러오지 못했습니다. 새로 고침');
  });

  it('키보드 단축키 창: 열리지 않으면 창 대신 알림 상자에 실패 글과 다시 시도 — 거듭 눌러도 알림은 하나, 214차: 다시 시도도 받지 못하면 버튼은 「새로 고침」, 메뉴로 다시 열어 받으면 창이 열리고 실패 알림은 닫힌다', async () => {
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
    // 둘째 실패: 같은 글의 알림이 새 알림으로 바뀐다(둘이 되지 않음) — 214차: 메뉴 항목으로 다시 연 실패는 알림의 다시 시도가 아니라 세지 않는다
    await vi.waitFor(() => expect(only(TEXT)).not.toBe(a), WAIT);
    expect(act(only(TEXT))).toBe('다시 시도');
    expect(dialogs()).toBe(0);
    // 214차: 알림의 다시 시도도 받지 못하면 그 알림의 버튼은 「새로 고침」(글은 그대로 — 알림 하나)
    const b = only(TEXT);
    b.querySelector<HTMLButtonElement>('.toast-act')!.click();
    await vi.waitFor(() => expect(only(TEXT)).not.toBe(b), WAIT);
    expect(act(only(TEXT))).toBe('새로 고침');
    expect(dialogs()).toBe(0);
    // 받을 수 있게 되면 메뉴 항목으로 다시 열어 창이 열리고 남은 실패 알림은 닫는다(전에는 창 위에 8초 남고 그 버튼은 창이 열린 동안 아무것도 하지 않았다)
    ctl.fail.delete('shortcuts');
    keysItem.click();
    await vi.waitFor(() => expect(dialogs()).toBe(1), WAIT);
    expect(toastsWith(TEXT)).toHaveLength(0);
  });

  it('깎기 조각: 깎기 탭 몸통이 「불러오는 중…」에 멈추지 않고 실패 글과 다시 시도, 받으면 탭을 그린다 — 215차: 소재 깎기 메뉴 길은 받기 실패면 까닭 없는 211차 틀(메뉴 항목 글)과 다시 시도(받기 실패가 아닌 오류는 108차 글 그대로), 거듭해도 하나, 누른 다시 시도도 받지 못하면 「새로 고침」, 받으면 닫는다', async () => {
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
    // 받기 실패가 아닌 오류(조각은 왔는데 만들지 못함 꼴): 108차 글 그대로(까닭을 낀 글 — 가름은 core.ts isChunkLoadError)
    ctl.fail.add('sim-bad');
    await api.setSim(true);
    const olds = (): Element[] => [...document.querySelectorAll('.toasts > .toast.error')].filter((t) => t.firstChild?.textContent?.startsWith('시뮬레이션을 불러오지 못했습니다: '));
    expect(olds()).toHaveLength(1);
    ctl.fail.delete('sim-bad');
    // 메뉴 길(소재 깎기 — 108차 알림)의 받기 실패: 전에는 「시뮬레이션을 불러오지 못했습니다: 파일을 받지 못했습니다(네트워크 오류).」 꼴(까닭이 낀 글)에 다시 시도 없이 4초.
    // 이제 까닭은 콘솔에만, 이름은 메뉴 항목 글 — 거듭 받지 못해도 알림 상자는 하나(메뉴로 다시 연 실패는 세지 않아 다시 시도 그대로)
    const SIM = '소재 깎기을(를) 불러오지 못했습니다.';
    await api.setSim(true);
    await api.setSim(true);
    const m = only(SIM);
    expect([act(m), m.textContent]).toEqual(['다시 시도', `${SIM}다시 시도×`]);
    // 알림의 다시 시도(그 깎기를 처음부터)도 받지 못하면 「새로 고침」(214차 꼴 — 같은 글 하나)
    m.querySelector<HTMLButtonElement>('.toast-act')!.click();
    await vi.waitFor(() => expect(act(only(SIM))).toBe('새로 고침'), WAIT);
    // 탭 몸통의 다시 시도로 받으면 깎기 탭을 그리고 초점은 지금 탭 버튼, 메뉴 길의 실패 알림도 닫는다(214차 꼴 — 같은 조각)
    ctl.fail.delete('sim');
    const retry = alert()!.querySelector<HTMLButtonElement>('button')!;
    retry.focus();
    retry.click();
    await vi.waitFor(() => expect(body.querySelector('.prop-group')).not.toBeNull(), WAIT);
    expect(alert()).toBeNull();
    expect(focused()).toBe(root.querySelector('.panel-tab.active'));
    expect(toastsWith(SIM)).toHaveLength(0);
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
    // 215차: 새 이름(메뉴 항목·버튼 글 — 새 열쇠 0)
    expect(LANGS.map((l) => translate('소재 깎기을(를) 불러오지 못했습니다.', l, true))).toEqual(['Could not load "Stock removal".', '「素材の切削」を読み込めませんでした。', '无法加载“毛坯切削”。', '„Materialabtrag“ konnte nicht geladen werden.']);
    expect(LANGS.map((l) => translate('3D 보기을(를) 불러오지 못했습니다.', l, true))).toEqual(['Could not load "3D view".', '「3Dビュー」を読み込めませんでした。', '无法加载“3D视图”。', '„3D-Ansicht“ konnte nicht geladen werden.']);
    expect(LANGS.map((l) => translate('예제 열기을(를) 불러오지 못했습니다.', l, true))).toEqual(['Could not load "Open sample".', '「サンプルを開く」を読み込めませんでした。', '无法加载“打开示例”。', '„Beispiel öffnen“ konnte nicht geladen werden.']);
    expect(LANGS.map((l) => translate('다시 시도', l))).toEqual(['Try again', 'もう一度試す', '再试一次', 'Noch einmal versuchen']);
  });
});

// 213차: 맨 끝(앞 묶음이 조각마다 「실패 → 받기」를 마친 뒤 — 이 시험은 받기 실패를 쓰지 않는다)
describe('213차: 같은 글 알림 견주기 — mixSpan·문자열 밖 조각', () => {
  it('파일 이름 조각이 섞인 열기 실패 알림(조각마다 글 마디 — showError split)도 언어를 바꾼 사이의 같은 실패는 하나 — 파일 이름 조각(translate="no")은 번역하지 않아 붙일 때의 글이 곧 원문(고치기 전에도 통과 — 재발 막기)', async () => {
    const lang0 = document.documentElement.lang;
    const { app, root } = mount();
    const dispose = await installLocalization(root);
    // 이 파일 이름 조각으로 시작하는 오류 알림만(앞 시험의 앱 — 깎기 조각을 받은 앱 등 — 이 늦게 띄우는 다른 알림은 같은 상자에 와도 셈 밖)
    const errs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.toasts > .toast.error')].filter((t) => t.firstElementChild?.textContent === 'empty.MPF');
    try {
      expect(await app.openBuffer('part.MPF', enc(SIE))).toBe(true);
      // 이동이 없는 프로그램: 문서가 있으면 알림 상자에 [파일 이름 조각, ': ', 까닭 …](app.ts showError split — 조각마다 번역층이 따로 옮긴다)
      expect(await app.openBuffer('empty.MPF', enc('G90\nM30\n'))).toBe(false);
      await vi.waitFor(() => expect(errs()).toHaveLength(1), WAIT);
      const first = errs()[0]!;
      const name = first.firstElementChild!;
      expect([name.getAttribute('translate'), name.textContent, name.hasAttribute('data-i18n-skip')]).toEqual(['no', 'empty.MPF', false]);
      pick('en');
      await vi.waitFor(() => expect(document.documentElement.lang).toBe('en'), WAIT);
      // 영어 화면에서 같은 실패: 앞 알림(한국어 화면 때 붙임 — 번역층이 영어로 다시 옮김)과 견줘 새 알림 하나
      expect(await app.openBuffer('empty.MPF', enc('G90\nM30\n'))).toBe(false);
      await vi.waitFor(() => expect(errs()[0]).not.toBe(first), WAIT);
      expect(errs()).toHaveLength(1);
      expect(errs()[0]!.firstElementChild!.textContent).toBe('empty.MPF');
    } finally {
      dispose();
      document.documentElement.lang = lang0;
    }
  });
});
