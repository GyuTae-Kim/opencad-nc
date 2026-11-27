// @vitest-environment jsdom
/**
 * 172차(WCAG 2.5.7 끄는 동작): 패널 크기 손잡이(넓은 화면 폭 8 — 패널 폭, 좁은 화면 높이 14 — 아래 시트 높이)는 끌기 말고 다른 길이 없었다.
 * 이제 끌지 않고 누르면(떼면) 다음 정해진 크기로 — 작게(최소) → 보통(CSS 기본) → 크게(최대) → 작게. 끌기는 그대로이고,
 * 끌기 판정은 코어와 같은 문턱(마우스·펜 4px, 손가락 10px)이다. 손잡이 풍선 글은 「끌거나 눌러 크기 바꾸기」(네 언어).
 * jsdom은 그리지 않으므로 패널·작업 영역의 크기(getBoundingClientRect)를 고정해 둔다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
