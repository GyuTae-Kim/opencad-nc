// @vitest-environment jsdom
/**
 * 139차: 좌표축 버튼(도구 막대 "좌표축"·말풍선 「좌표축 보이기」, 좁은 화면 "보기 설정" → 좌표축 — app.ts toggleAxes)이 왼쪽 아래 축 표시만 끄고
 * 격자의 장면 안 X·Y축선(축 표시 글자와 같은 축 색)은 남기던 것 — 3D 뷰어 코어 0.113.0 축선 모양 hidden으로 둘을 함께 켜고 끈다
 * (코어 README 0.113.0 남은 한계·앱이 할 일 — 좌표축 버튼에서 둘을 함께 부름, STEP 141차와 같은 길).
 * 앱을 진짜 코어(가짜 WebGL)로 띄우고 해석 워커만 같은 스레드의 parseForView로 바꾼다(context-core.test.ts 꼴).
 * 그리기 수는 코어 stats.drawCalls(renderNow 한 번 — 격자 축선은 선 하나에 그리기 하나, 왼쪽 아래 축 표시는 2D 덧그림이라 들지 않는다).
 * 140차: 단면 펼침 상자의 0~1000 「단면 위치」 막대가 옆 값 글을 aria-valuetext로 — 가짜 뷰어는 단면 알림이 없어 같은 실제 코어로 본다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Viewer3d } from 'opencad-viewer3d';
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

import { NcViewerApp } from '../../src/app/app';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

/** 원점에서 시작하는 경로(x 0~20·y 0~10) — 격자가 세계 원점을 담아 X·Y축선이 둘 다 있다 */
const NC = 'G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG2 X20 Y0 I10 J0\nM30\n';
const open = (app: NcViewerApp, name: string): Promise<boolean> => app.openBuffer(name, new TextEncoder().encode(NC).buffer as ArrayBuffer);
/** 바로 한 번 그린 GL 그리기 호출 수 */
const draws = (v: Viewer3d): number => {
  v.renderNow();
  return v.stats.drawCalls;
};

describe('좌표축 버튼(139차 — 왼쪽 아래 축 표시와 격자의 장면 안 X·Y축선을 함께)', () => {
  it('실제 코어: 끄면 격자를 켠 채로 X·Y축선 그리기 둘만 빠지고, 격자 버튼을 껐다 켜도·새 문서에도 꺼진 채, 켜면 모양 없음(처음 뷰어와 같음)', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = new NcViewerApp(document.getElementById('app')!);
    expect(await open(app, 'a.nc')).toBe(true);
    const v = app.viewer!;
    expect([v.gridVisible, v.axesVisible, v.axesStyle]).toEqual([true, true, null]);
    const on = draws(v);
    expect(on).toBeGreaterThan(2);

    app.toggleAxes();
    expect([v.gridVisible, v.axesVisible, v.axesStyle?.hidden]).toEqual([true, false, true]);
    expect(draws(v)).toBe(on - 2);
    // 격자 버튼(F7)으로 껐다 켜도 축선은 좌표축 버튼을 따른다
    app.toggleGrid();
    app.toggleGrid();
    expect(v.gridVisible).toBe(true);
    expect(draws(v)).toBe(on - 2);

    // 다른 문서를 열어도(같은 뷰어에 새 장면) 꺼진 채 — 왼쪽 아래 축 표시처럼 뷰어가 든다
    expect(await open(app, 'b.nc')).toBe(true);
    expect(app.viewer).toBe(v);
    expect([v.gridVisible, v.axesVisible, v.axesStyle?.hidden]).toEqual([true, false, true]);
    const off = draws(v);
    app.toggleAxes();
    expect([v.gridVisible, v.axesVisible, v.axesStyle]).toEqual([true, true, null]);
    expect(draws(v)).toBe(off + 2);
  });

  it('app.ts: 도구 막대 좌표축 버튼·보기 설정 → 좌표축(toggleAxes)이 둘을 함께 — 코어 좌표축 함수를 따로 부르는 곳 없음', () => {
    const src = readFileSync(join(__dirname, '../../src/app/app.ts'), 'utf8');
    const i = src.indexOf('\n  toggleAxes(on?: boolean): void {');
    expect(i).toBeGreaterThan(0);
    const body = src.slice(i, src.indexOf('\n  }\n', i));
    expect(body).toContain('v.setAxesVisible(show);');
    expect(body).toContain('v.setAxesStyle({ hidden: !show });');
    expect(src.match(/\.setAxesVisible\(|\.setAxesStyle\(/g)).toHaveLength(2);
  });
});

describe('단면 위치 막대(140차 — 옆 값 글을 aria-valuetext로, 패널 재생 막대 꼴)', () => {
  it('실제 코어: X 단면이면 「X = 10 mm」, 막대를 옮기면 새 자리, 뒤집어도 축·위치만(번역층이 옮기지 않는 속성이라 낱말 없이), 끄면 뺌', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const app = new NcViewerApp(root);
    expect(await open(app, 'a.nc')).toBe(true);
    const range = root.querySelector<HTMLInputElement>('input[aria-label="단면 위치"]')!;
    const val = root.querySelector<HTMLElement>('.sec-val')!;
    const flip = root.querySelector<HTMLButtonElement>('button[title="잘라 내는 쪽 뒤집기"]')!;
    expect(val.textContent).toBe('꺼짐');
    expect(range.hasAttribute('aria-valuetext')).toBe(false);
    // 경로 x 0~20 — 가운데(t 0.5)
    app.setSectionAxis('x');
    expect(val.textContent).toBe('X = 10 mm');
    expect(range.getAttribute('aria-valuetext')).toBe('X = 10 mm');
    // 막대를 1/4로(화살표·끌기와 같은 input)
    range.value = '250';
    range.dispatchEvent(new Event('input'));
    expect(val.textContent).toBe('X = 5 mm');
    expect(range.getAttribute('aria-valuetext')).toBe('X = 5 mm');
    // 뒤집으면 보이는 글에만 「(뒤집음)」 — 뒤집음은 뒤집기 버튼의 눌림 상태가 알린다
    flip.click();
    expect(val.textContent).toBe('X = 5 mm (뒤집음)');
    expect(flip.getAttribute('aria-pressed')).toBe('true');
    expect(range.getAttribute('aria-valuetext')).toBe('X = 5 mm');
    // 끄면 막대가 막히고 값 글을 뺀다
    app.setSectionAxis(null);
    expect(val.textContent).toBe('꺼짐');
    expect(range.disabled).toBe(true);
    expect(range.hasAttribute('aria-valuetext')).toBe(false);
  });
});
