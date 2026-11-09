// @vitest-environment jsdom
/**
 * 56차 3D 보기 키보드 붙잡기·고르기(keysnap.ts — 코어 0.46.0 setKeyboardSnap·0.47.0 pickCycle·messages)를 앱과 실제 코어(가짜 WebGL)로 본다.
 * 해석 워커만 같은 스레드의 parseForView로 바꾼다. 가상 커서는 캔버스 가운데에서 켜지므로 겨냥할 점을 화면 가운데로 맞춘다(경계를 정확히 가리키지 않는다).
 * - 키: 커서가 꺼져 있으면 캔버스 화살표는 앱 것(재생 걸음·줄 이동 — 앱이 쓰지 않는 화살표도 커서를 켜지 않는다), Enter로 켜면 화살표·Shift+화살표는 커서,
 *   Esc는 커서만 끄고(고른 것은 그대로) 다음 Esc가 고른 것을 지운다. 측정 첫 점 뒤에도 화살표는 커서를 옮긴다(방향 잠금은 커서가 꺼졌을 때)
 * - 알림: 화면에 보이지 않는 aria-live 영역에 지금 언어 글(측정은 코어 글 + 사전 틀, 고르기는 앱 묶음 이름)
 * - 고르기 Tab: 촘촘한 공구 경로(원호를 나눈 선분)·판재 가공(구멍 점과 그물)을 코드 줄·가공 단위로 묶어 돌리고, Enter는 그 묶음을 고른다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { installCanvasFakes } from './fake-webgl';

vi.mock('../../src/app/client', async () => {
  const { parseForView } = await import('../../src/app/payload');
  class ParseWorkerClient {
    async open(name: string, data: ArrayBuffer, opts = {}) {
      return parseForView(name, new Uint8Array(data), opts);
    }
    cancel(): void {}
  }
  return { ParseWorkerClient };
});

import '../../site/i18n.mjs';
import { NcViewerApp } from '../../src/app/app';
import { KEY_HELP, pickGroups } from '../../src/app/keysnap';

let restore: () => void;
const scroll = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  Element.prototype.scrollIntoView = () => {};
});
afterAll(() => {
  restore();
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
});

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
// 가운데 (20,15)를 지나는 줄 4(G1 X40 Y15)와 그 둘레
const LINES = ['G21 G90 G17', 'G0 X0 Y15 Z5', 'G1 Z0 F300', 'G1 X40 Y15', 'G1 X40 Y30', 'G1 X0 Y30', 'G0 Z5', 'M2'].join('\n');
// 촘촘한 공구 경로: 줄 4 위 (20,15) 둘레 반지름 0.3의 온 원(줄 8 — 원호를 선분 여럿으로 나눈다)
const DENSE = ['G21 G90 G17', 'G0 X0 Y15 Z5', 'G1 Z0 F300', 'G1 X40 Y15', 'G0 Z5', 'G0 X20.3 Y15', 'G1 Z0', 'G2 X20.3 Y15 I-0.3 J0', 'G0 Z5', 'M2'].join('\n');
// 판재: 포켓(가공 1) 가운데에 구멍(가공 2), 떨어진 곳에 구멍 하나(가공 3)
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <pocket length="80" width="60" depth="6" direction="z-" cornerRadius="0" angle="0" centerX="100" centerY="150" centerZ="0" enable="1" order="1"/>
  <hole x="100" y="150" z="0" diameter="10" depth="12" direction="z-" enable="1" order="2"/>
  <hole x="300" y="60" z="0" diameter="8" depth="10" direction="z-" enable="1" order="3"/>
 </panel>
</pgi>`;

/** 앱 하나를 시험 사이에 다시 쓴다(앱은 창 키 듣기를 떼지 않아, 앱을 새로 만들면 앞 앱도 같은 키를 받아 막는다) */
let shared: { app: NcViewerApp; root: HTMLElement } | null = null;

async function open(name: string, text: string) {
  if (!shared) {
    document.body.innerHTML = '<div id="app"></div>';
    const r = document.getElementById('app')!;
    shared = { app: new NcViewerApp(r), root: r };
  }
  const { app, root } = shared;
  if (app.state().measuring) app.toggleMeasure(false);
  // 앞 시험의 가상 커서는 캔버스가 초점을 잃으면 꺼진다(코어)
  app.viewer?.canvas.blur();
  expect(await app.openBuffer(name, enc(text))).toBe(true);
  const v = app.viewer!;
  v.setView('top', false);
  v.fit(false);
  v.renderNow();
  v.canvas.focus();
  /** 세계 점 p를 화면 가운데로(위에서 본 보기, 가로 반폭 w — 화면 800 × 600) */
  const center = (p: readonly number[], w: number): void => {
    v.setView('top', false);
    v.fit(false);
    const a = v.project([p[0]! - w, p[1]! - w * 0.75, p[2]!])!;
    const b = v.project([p[0]! + w, p[1]! + w * 0.75, p[2]!])!;
    v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
    v.renderNow();
    const s = v.project(p)!;
    expect(Math.abs(s.x - 400)).toBeLessThan(1);
    expect(Math.abs(s.y - 300)).toBeLessThan(1);
  };
  /** 캔버스가 받은 키(창 캡처의 앱 키 → 캔버스의 코어 키) */
  const key = (k: string, o: KeyboardEventInit = {}): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
    v.canvas.dispatchEvent(e);
    return e;
  };
  const live = (): string => (root.querySelector('.key-live')?.textContent ?? '').replace(/ $/, '');
  return { app, root, v, center, key, live };
}

describe('키보드 붙잡기 키(56차 — 앱 화살표와 가상 커서)', () => {
  it('커서가 꺼져 있으면 화살표는 재생 걸음·줄 이동, Enter로 켜면 화살표는 커서를 옮기고 Esc로 끄면 다시 앱 화살표', async () => {
    const { app, root, v, center, key, live } = await open('a.nc', LINES);
    // 알림 영역(화면 밖·번역층 건너뜀)과 캔버스 설명
    const region = root.querySelector('.key-live')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.hasAttribute('data-i18n-skip')).toBe(true);
    expect(v.canvas.getAttribute('aria-description')).toBe(KEY_HELP);
    center([20, 15, 0], 25);
    // Enter: 커서를 캔버스 가운데에 켠다(고르기 모드 — 그 자리 공구 경로 줄)
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(v.keyboardCursor).toMatchObject({ x: 400, y: 300, mode: 'pick' });
    expect(live()).toMatch(/^가상 커서를 켰습니다\. 줄 4 · 직선 이송 · F300: X 20, Y 15, Z 0\. 옮기기 ←→↑↓ · 후보 Tab · 고르기 Enter · 끄기 Esc$/);
    // 화살표·Shift+화살표는 커서(재생·줄은 그대로)
    key('ArrowRight');
    expect(v.keyboardCursor!.x).toBe(405);
    key('ArrowUp');
    expect(v.keyboardCursor!.y).toBe(295);
    key('ArrowLeft', { shiftKey: true });
    expect(v.keyboardCursor!.x).toBe(355);
    key('ArrowDown', { shiftKey: true });
    expect(v.keyboardCursor!).toMatchObject({ x: 355, y: 345 });
    expect(app.state().playSec).toBeNull();
    expect(app.state().selLine).toBe(-1);
    expect(live()).toMatch(/^(고를 것이 없습니다|.+: X .+, Y .+, Z .+)$/);
    // 후보가 없는 자리(화면 위 끝 — 공구 경로에서 60화소 넘게)의 Tab: 초점은 캔버스에 두고 '고를 것이 없습니다'만('후보 하나'가 아니다)
    for (let i = 0; i < 7; i++) key('ArrowUp', { shiftKey: true });
    expect(v.keyboardCursor!).toMatchObject({ y: 0, count: 0 });
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(live()).toBe('고를 것이 없습니다');
    // Esc: 커서만 끈다 → 화살표는 다시 앱 것(재생 걸음·줄 이동), 커서를 켜지 않는다
    key('Escape');
    expect(v.keyboardCursor).toBeNull();
    expect(live()).toBe('가상 커서를 껐습니다');
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expect(app.state().playSec).not.toBeNull();
    const line = app.state().selLine;
    expect(line).toBeGreaterThan(0);
    key('ArrowDown');
    expect(app.state().selLine).toBe(line + 1);
    expect(v.keyboardCursor).toBeNull();
  });

  it('Enter로 고르면 그 줄, Esc는 커서만 끄고 고른 것을 두며 다음 Esc가 지운다', async () => {
    const { app, v, center, key, live } = await open('a.nc', LINES);
    center([20, 15, 0], 25);
    key('Enter');
    key('Enter');
    expect(app.state().selLine).toBe(3);
    expect(live()).toBe('골랐습니다: 줄 4 · 직선 이송 · F300');
    expect(v.keyboardCursor).not.toBeNull();
    key('Escape');
    expect(v.keyboardCursor).toBeNull();
    expect(app.state().selLine).toBe(3);
    key('Escape');
    expect(app.state().selLine).toBe(-1);
  });

  it('앱이 쓰지 않는 캔버스 화살표(재생할 수 없는 판재)도 커서를 켜지 않는다 — 켜는 키는 Enter뿐', async () => {
    const { v, key } = await open('p.pgi', PANEL);
    for (const k of ['ArrowLeft', 'ArrowRight']) {
      expect(key(k).defaultPrevented, k).toBe(true);
      expect(v.keyboardCursor, k).toBeNull();
    }
    key('Enter');
    expect(v.keyboardCursor).not.toBeNull();
    // 다른 칸(단추)의 Enter·화살표는 커서와 상관없다
    key('Escape');
    const btn = document.querySelector<HTMLButtonElement>('.tbtn')!;
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(v.keyboardCursor).toBeNull();
  });

  it('측정: Enter로 첫 점, 그 뒤에도 화살표는 커서(방향 잠금 아님), Enter로 둘째 점과 결과 — 알림은 코어 글', async () => {
    const { app, v, center, key, live } = await open('a.nc', LINES);
    app.toggleMeasure(true);
    await vi.waitFor(() => expect(app.state().measuring).toBe(true));
    center([20, 15, 0], 25);
    key('Enter');
    expect(v.keyboardCursor).toMatchObject({ mode: 'measure' });
    // 측정 글의 수 꼴은 코어(측정 거리 글상자와 같은 자릿수)
    expect(live()).toMatch(/^가상 커서를 켰습니다\. 가운데 점: X 20\.0+, Y 15\.0+, Z 0\.0+\. 옮기기 ←→↑↓ · 후보 Tab · 찍기 Enter · 끄기 Esc$/);
    key('Enter');
    expect(v.measurePoints).toHaveLength(1);
    expect(live()).toMatch(/^첫 점을 찍었습니다\. 가운데 점: X 20\.0+, Y 15\.0+, Z 0\.0+$/);
    expect(app.state().measureLock?.lock).toBeNull();
    // 둘째 점 방향을 잡는 동안에도 화살표는 커서(앱 방향 잠금이 아니다 — → 가 X축을 잠그지 않는다)
    for (let i = 0; i < 6; i++) key('ArrowRight', { shiftKey: true });
    expect(v.keyboardCursor!.x).toBe(700);
    expect(app.state().measureLock?.lock).toBeNull();
    expect(v.measurePoints).toHaveLength(1);
    expect(live()).toMatch(/, 거리 \d/);
    key('Enter');
    expect(live()).toMatch(/^둘째 점을 찍었습니다\. 거리 [\d.]+ mm, X 차 [-\d.]+, Y 차 [-\d.]+, Z 차 [-\d.]+$/);
    expect(app.doc!.measure).not.toBeNull();
    expect(document.querySelector('.st-sel')!.textContent).toMatch(/^거리 /);
    // Esc는 측정 지우기가 먼저(코어), 그다음 커서를 끈다
    key('Escape');
    expect(v.measurePoints).toHaveLength(0);
    expect(v.keyboardCursor).not.toBeNull();
    key('Escape');
    expect(v.keyboardCursor).toBeNull();
    expect(app.state().measuring).toBe(true);
  });

  it('알림 글은 화면 언어로(사전의 같은 열쇠 틀 — 언어를 바꾸면 다시 준다)', async () => {
    const { app, root, center, key, live } = await open('a.nc', LINES);
    app.toggleMeasure(true);
    await vi.waitFor(() => expect(app.state().measuring).toBe(true));
    center([20, 15, 0], 25);
    document.documentElement.lang = 'en';
    try {
      root.dispatchEvent(new CustomEvent('languagechange', { detail: 'en' }));
      key('Enter');
      expect(live()).toMatch(/^Virtual cursor on\. Midpoint: X 20\.0+, Y 15\.0+, Z 0\.0+\. Move ←→↑↓ · Next candidate Tab · Pick point Enter · Turn off Esc$/);
      expect(live()).not.toMatch(/[가-힣]/);
      key('Enter');
      expect(live()).toMatch(/^First point picked\. Midpoint: X 20\.0+, Y 15\.0+, Z 0\.0+$/);
      key('Escape');
      key('Escape');
      expect(live()).toBe('Virtual cursor off');
    } finally {
      document.documentElement.lang = 'ko';
    }
  });
});

describe('겹친 것 고르기(56차 — pickCycle과 앱 묶음 Tab)', () => {
  it('촘촘한 공구 경로: 원호를 나눈 선분은 한 줄로 묶어 Tab이 다음 줄로 가고, Enter는 그 줄을 고른다', async () => {
    const { app, v, center, key, live } = await open('d.nc', DENSE);
    center([20, 15, 0], 25);
    key('Enter');
    const c = v.keyboardCursor!;
    const list = v.pickCandidates(c.x, c.y, { pointerType: 'keyboard' });
    expect(c.count).toBe(list.length);
    const g = pickGroups(app.doc!, list);
    const G = g.keys.length;
    // 원호(줄 8)의 선분 여럿이 한 묶음
    expect(g.keys).toContain('line:7');
    expect(g.of.filter((x) => x === g.keys.indexOf('line:7')).length).toBeGreaterThan(1);
    expect(list.length).toBeGreaterThan(G);
    expect(G).toBeGreaterThan(1);
    expect(live()).toMatch(new RegExp(` 1/${G}: X `));
    // Tab 한 바퀴: 묶음마다 첫 후보, 알림은 묶음 차례
    const seen: string[] = [];
    for (let i = 1; i <= G; i++) {
      const e = key('Tab');
      expect(e.defaultPrevented).toBe(true);
      const want = i % G;
      expect(v.keyboardCursor!.index, `Tab ${i}`).toBe(g.first[want]);
      expect(live(), `Tab ${i}`).toMatch(new RegExp(` ${want + 1}/${G}: X `));
      seen.push(live());
    }
    expect(seen.some((s) => s.startsWith('줄 8 · 원호 이송'))).toBe(true);
    // Shift+Tab: 앞 묶음(맨 앞에서는 마지막 묶음)
    key('Tab', { shiftKey: true });
    expect(v.keyboardCursor!.index).toBe(g.first[G - 1]);
    // 원호 묶음까지 가서 Enter → 줄 8
    const arc = g.keys.indexOf('line:7');
    while (g.of[v.keyboardCursor!.index] !== arc) key('Tab');
    key('Enter');
    expect(app.state().selLine).toBe(7);
    expect(live()).toMatch(/^골랐습니다: 줄 8 · 원호 이송 · F300$/);
  });

  it('판재: 판 너머 후보(pickCycle throughTranslucent — 누르기와 같은 선택)를 가공 단위로 묶어 돌리고, Enter는 그 가공을 고른다', async () => {
    const { app, v, center, key, live } = await open('p.pgi', PANEL);
    expect(app.pickThrough).toBe(true);
    center([100.6, 150.4, 18], 12);
    key('Enter');
    const c = v.keyboardCursor!;
    const list = v.pickCandidates(c.x, c.y, { pointerType: 'keyboard', throughTranslucent: true });
    expect(c.count).toBe(list.length);
    const g = pickGroups(app.doc!, list);
    // 포켓(가공 1)과 구멍(가공 2)이 겹친다
    expect(g.keys).toEqual(expect.arrayContaining(['op:0', 'op:1']));
    const G = g.keys.length;
    expect(live()).toMatch(new RegExp(`^가상 커서를 켰습니다\\. 가공 \\d · .+ 1/${G}: X `));
    const names = new Set<string>();
    for (let i = 0; i < G; i++) {
      key('Tab');
      expect(v.keyboardCursor!.index).toBe(g.first[(i + 1) % G]);
      names.add(live().replace(/ \d+\/\d+: .*$/, ''));
    }
    expect(names.size).toBe(G);
    while (g.keys[g.of[v.keyboardCursor!.index]!] !== 'op:1') key('Tab');
    key('Enter');
    expect(app.doc!.selKey).toBe('1');
    expect(document.querySelector('.st-sel')!.textContent).toMatch(/^가공 2 · /);
    expect(live()).toMatch(/^골랐습니다: 가공 2 · /);
  });

  it('후보가 한 묶음뿐이면 Tab은 코어를 돌리지 않고 "후보 하나"로 알린다(초점은 캔버스에 둔다)', async () => {
    const { app, v, center, key, live } = await open('p.pgi', PANEL);
    // 가공이 없는 판 위(판 윗면·밑면 — 한 그물)
    center([200.3, 250.2, 18], 8);
    key('Enter');
    const c = v.keyboardCursor!;
    const g = pickGroups(app.doc!, v.pickCandidates(c.x, c.y, { pointerType: 'keyboard', throughTranslucent: true }));
    expect(g.keys).toEqual(['mesh:mpr-board']);
    const before = v.keyboardCursor!.index;
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(v.keyboardCursor!.index).toBe(before);
    expect(live()).toMatch(/^판 400×300×18: X 200\.3, Y 250\.2, Z 18 \(후보 하나\)$/);
    expect(document.activeElement).toBe(v.canvas);
  });
});
