// @vitest-environment jsdom
/**
 * 172차(WCAG 2.5.7 끄는 동작): 패널 크기 손잡이(넓은 화면 폭 8 — 패널 폭, 좁은 화면 높이 14 — 아래 시트 높이)는 끌기 말고 다른 길이 없었다.
 * 이제 끌지 않고 누르면(떼면) 다음 정해진 크기로 — 작게(최소) → 보통(CSS 기본) → 크게(최대) → 작게. 끌기는 그대로이고,
 * 끌기 판정은 코어와 같은 문턱(마우스·펜 4px, 손가락 10px)이다. 손잡이 풍선 글은 「끌거나 눌러 크기 바꾸기」(네 언어).
 * jsdom은 그리지 않으므로 패널·작업 영역의 크기(getBoundingClientRect)를 고정해 둔다.
 * 223차(WCAG 2.1.1): 손잡이는 초점을 받는 분리자(role=separator — 넓은 화면 세로·시트 가로, 값은 폭 px·높이 %)이고 화살표·Home·End·Enter로 크기를 바꾼다.
 * 224차(WCAG 4.1.2): 창 폭만 바뀌면 방향·값이 다음 초점까지 앞 값이었다 — 작업 영역 크기 감시(ResizeObserver)가 맞춘다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NcPanel, type PanelHost } from '../../src/app/panel';
import { touchPointerEvent } from '../../src/app/aim';
import { catalogs } from '../../site/i18n.mjs';

const TITLE = '끌거나 눌러 크기 바꾸기';
const WIDTH_KEY = 'opencad-nc.panel.width';
const SHEET_KEY = 'opencad-nc.panel.sheet';

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

let workspace: HTMLElement;
let panel: NcPanel;
let grip: HTMLElement;
const innerWidth0 = window.innerWidth;

/** 화면 폭(넓은 화면 ≥ 760 · 좁은 화면 시트)과 패널 그린 크기로 패널을 새로 만든다 */
function make(screenWidth: number, panelRect: DOMRect): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: screenWidth });
  workspace?.remove();
  workspace = document.createElement('div');
  document.body.append(workspace);
  workspace.getBoundingClientRect = () => rect(0, 0, screenWidth, 800);
  panel = new NcPanel({} as PanelHost, workspace);
  panel.el.getBoundingClientRect = () => panelRect;
  grip = panel.el.querySelector('.panel-grip') as HTMLElement;
  grip.setPointerCapture = () => {};
}

/** 손잡이를 (x0, y0)에서 누르고 지나는 자리들을 거쳐 마지막 자리에서 뗀다(cancel이면 pointercancel) */
function press(type: 'pen' | 'touch', x0: number, y0: number, path: [number, number][] = [], cancel = false): void {
  grip.dispatchEvent(touchPointerEvent('pointerdown', 7, x0, y0, type));
  for (const [x, y] of path) grip.dispatchEvent(touchPointerEvent('pointermove', 7, x, y, type));
  const [x, y] = path[path.length - 1] ?? [x0, y0];
  grip.dispatchEvent(touchPointerEvent(cancel ? 'pointercancel' : 'pointerup', 7, x, y, type));
}

const panelW = (): string => panel.el.style.getPropertyValue('--panel-w');
const sheetH = (): string => workspace.style.getPropertyValue('--sheet-h');

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  workspace.remove();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth0 });
});

describe('패널 크기 손잡이의 한 점 대안(172차 — WCAG 2.5.7)', () => {
  it('넓은 화면: 끌지 않고 누르면 폭이 보통 380 → 크게 900 → 작게 260 → 보통 380으로 돌고 기억한다', () => {
    make(1200, rect(820, 0, 380, 800));
    press('pen', 820, 300);
    expect(panelW()).toBe('900px');
    expect(localStorage.getItem(WIDTH_KEY)).toBe('900');
    press('pen', 820, 300);
    expect(panelW()).toBe('260px');
    expect(localStorage.getItem(WIDTH_KEY)).toBe('260');
    press('pen', 820, 300);
    expect(panelW()).toBe('380px');
    expect(localStorage.getItem(WIDTH_KEY)).toBe('380');
  });

  it('넓은 화면: 끌면 전처럼 끈 만큼(정해진 크기로 가지 않음), 펜 6px도 끌기', () => {
    make(1200, rect(820, 0, 380, 800));
    press('pen', 1000, 300, [[900, 300]]);
    expect(panelW()).toBe('480px');
    expect(localStorage.getItem(WIDTH_KEY)).toBe('480');
    make(1200, rect(820, 0, 380, 800));
    press('pen', 1000, 300, [[1006, 300]]);
    expect(panelW()).toBe('374px');
  });

  it('손가락이 끌기 문턱(10px) 안에서 6px 떨려도 누르기로 쳐 다음 크기로', () => {
    make(1200, rect(820, 0, 380, 800));
    press('touch', 1000, 300, [[1006, 300]]);
    expect(panelW()).toBe('900px');
    expect(localStorage.getItem(WIDTH_KEY)).toBe('900');
  });

  it('pointercancel은 누르기가 아니다(크기 그대로 — 전처럼 그 크기만 기억)', () => {
    make(1200, rect(820, 0, 380, 800));
    press('touch', 1000, 300, [], true);
    expect(panelW()).toBe('');
    expect(localStorage.getItem(WIDTH_KEY)).toBe('380');
  });

  it('좁은 화면 시트: 누르면 높이가 보통 46% → 크게 85% → 작게 22% → 보통 46%로 돌고, 끌면 전처럼', () => {
    make(500, rect(0, 432, 500, 368));
    press('touch', 250, 432);
    expect(sheetH()).toBe('85%');
    expect(localStorage.getItem(SHEET_KEY)).toBe('0.850');
    press('touch', 250, 432);
    expect(sheetH()).toBe('22%');
    expect(localStorage.getItem(SHEET_KEY)).toBe('0.220');
    press('touch', 250, 432);
    expect(sheetH()).toBe('46%');
    expect(localStorage.getItem(SHEET_KEY)).toBe('0.460');
    make(500, rect(0, 432, 500, 368));
    press('touch', 250, 432, [[250, 232]]);
    expect(sheetH()).toBe('71%');
    expect(localStorage.getItem(SHEET_KEY)).toBe('0.710');
  });

  it('223차(WCAG 2.1.1): 넓은 화면 손잡이는 초점을 받는 세로 분리자(값 = 패널 폭이 작업 영역의 몇 %) — ← 20px 넓게·→ 좁게, Enter는 누르기와 같은 다음 크기, 바꾼 크기는 기억', () => {
    make(1200, rect(820, 0, 380, 800));
    const key = (k: string, init: KeyboardEventInit = {}): boolean => !grip.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
    // 380 / 1200 = 31.7%
    expect(['role', 'tabindex', 'aria-hidden', 'aria-orientation', 'aria-valuenow'].map((a) => grip.getAttribute(a))).toEqual(['separator', '0', null, 'vertical', '32']);
    grip.focus();
    expect(document.activeElement).toBe(grip);
    const seen: [boolean, string, string | null, string | null][] = [];
    for (const [k, init] of [['ArrowLeft'], ['ArrowRight'], ['Enter'], ['Enter'], ['ArrowUp'], ['Home'], ['ArrowLeft', { ctrlKey: true }], ['ArrowLeft', { altKey: true }]] as [string, KeyboardEventInit?][])
      seen.push([key(k, init), panelW(), localStorage.getItem(WIDTH_KEY), grip.getAttribute('aria-valuenow')]);
    expect(seen).toEqual([
      [true, '400px', '400', '33'],
      [true, '380px', '380', '32'],
      // Enter = 누르기(172차): 보통 → 크게(끌기 최대 900) → 작게
      [true, '900px', '900', '75'],
      [true, '260px', '260', '22'],
      // 세로 분리자의 ↑·Home·수정 키(Alt+← 뒤로 가기 등)는 손잡이 몫이 아님(기본 동작 그대로)
      [false, '260px', '260', '22'],
      [false, '260px', '260', '22'],
      [false, '260px', '260', '22'],
      [false, '260px', '260', '22'],
    ]);
    // 누르기·끌기도 값을 맞춘다
    press('pen', 820, 300);
    expect([panelW(), grip.getAttribute('aria-valuenow')]).toEqual(['380px', '32']);
  });

  it('223차: 좁은 화면 시트 손잡이는 가로 분리자(값 = 시트 높이 %) — ↑ 5% 높게·↓ 낮게(22~85%), Enter, 화면 폭이 바뀌면 초점을 받을 때 방향·값을 다시', () => {
    make(500, rect(0, 432, 500, 368));
    const key = (k: string): boolean => !grip.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    // 그리기 전(패널 숨김)에는 CSS 기본 46%
    expect(['aria-orientation', 'aria-valuenow'].map((a) => grip.getAttribute(a))).toEqual(['horizontal', '46']);
    const seen: [boolean, string, string | null, string | null][] = [];
    for (const k of ['ArrowUp', 'ArrowDown', 'Enter', 'ArrowUp', 'Enter', 'ArrowDown', 'End', 'ArrowLeft']) seen.push([key(k), sheetH(), localStorage.getItem(SHEET_KEY), grip.getAttribute('aria-valuenow')]);
    expect(seen).toEqual([
      [true, '51%', '0.510', '51'],
      [true, '46%', '0.460', '46'],
      [true, '85%', '0.850', '85'],
      // 가장 크면·작으면 그대로
      [true, '85%', '0.850', '85'],
      [true, '22%', '0.220', '22'],
      [true, '22%', '0.220', '22'],
      [false, '22%', '0.220', '22'],
      [false, '22%', '0.220', '22'],
    ]);
    // 화면 폭만 넓은 화면으로(패널 그린 폭 500 = 작업 영역 500)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    grip.focus();
    expect(['aria-orientation', 'aria-valuenow'].map((a) => grip.getAttribute(a))).toEqual(['vertical', '100']);
  });

  it('224차: 창 폭만 바뀌어도(초점 없이 — 화면 읽기 탐색 모드) 작업 영역 크기 감시가 방향·값을 맞춘다(223차는 초점을 받을 때까지 앞 값)', () => {
    const seen: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          seen.push(cb);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    try {
      make(500, rect(0, 432, 500, 368));
      expect(['aria-orientation', 'aria-valuenow'].map((a) => grip.getAttribute(a))).toEqual(['horizontal', '46']);
      // 창을 넓은 화면으로(작업 영역 1200 — 패널 그린 폭 500 = 42%), 초점은 손잡이 밖 그대로
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
      workspace.getBoundingClientRect = () => rect(0, 0, 1200, 800);
      for (const cb of seen) cb([], {} as ResizeObserver);
      expect([seen.length, document.activeElement === grip, ...['aria-orientation', 'aria-valuenow'].map((a) => grip.getAttribute(a))]).toEqual([1, false, 'vertical', '42']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('손잡이 풍선 글은 누르기도 알리고 네 언어로 옮긴다', () => {
    make(1200, rect(820, 0, 380, 800));
    expect(grip.title).toBe(TITLE);
    for (const code of ['en', 'ja', 'zh-CN', 'de']) {
      const text = catalogs[code]![TITLE];
      expect(text, code).toBeTruthy();
      expect(text, code).not.toMatch(/[가-힣]/);
    }
  });
});
