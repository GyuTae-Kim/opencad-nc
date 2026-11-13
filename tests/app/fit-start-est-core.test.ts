// @vitest-environment jsdom
/**
 * 72차(3D 뷰어 코어 0.67.0 `LineSet3d.fitBox`): 출발점만 추정 안전 높이인 이동(FLAG_START_EST — G28 뒤 G1 진입, 선반 G28 뒤 G1 X50.,
 * G28 뒤 나선 호 진입)은 공구 묶음 안 선분이라 70차 `fit: false`로 뺄 수 없었다. 코어 기본 규칙은 아무것도 숨기지 않으면 Scene3d.bounds,
 * 묶음 하나라도 숨기면 보이는 묶음 범위의 합으로 맞추므로 71차까지는 다른 묶음 하나를 숨기면 맞춤이 추정 높이(+25 mm)까지 넓어졌다.
 * 그런 이동이 든 묶음에만 출발점을 뺀 상자(Scene3d.bounds를 셀 때와 같은 규칙 — 그 이동은 끝점만)를 준다.
 * - 장면: fitBox는 그 묶음에만, 상자는 그 묶음 선분 끝점 범위(그 이동은 끝점만), 이송 속도 색 장면·깎기 시뮬레이션 장면도 같은 상자
 * - 앱(진짜 코어·가짜 WebGL): 범위를 줄이지 않는 숨김(없는 이름·급속 이송·다른 공구)에서도 맞춤 범위 = Scene3d.bounds, 맞춘 카메라가 같다
 * - fitBox를 지운 장면(71차와 같은 장면)은 같은 숨김에서 맞춤이 추정 높이까지 넓어진다(이 시험이 차이를 잡는지)
 * 좌표는 float32로 정확한 값만 쓴다. 해석 워커만 같은 스레드의 parseForView로 바꾼다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Box3, Scene3d } from 'opencad-viewer3d';
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
import { parseForView } from '../../src/app/payload';
import { composeSimScene } from '../../src/app/sim';
import { parseGcode } from '../../src/gcode';
import { ncToScene } from '../../src/scene';

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
  vi.unstubAllGlobals();
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
});

// 프로그램 첫머리 G91 G28 Z0 뒤 G43 H1 G1 Z-5. 진입(출발점 Z75 = 경로 맨 위 Z50 + 25), 안쪽 공구 T2
const START = `O1\nG21 G90 G17\nG91 G28 Z0\nG90\nT1 M6\nS1000 M3\nG54 G0 X0 Y0\nG43 H1 G1 Z-5. F2000\nG1 X50. F500\nY20.\nG0 Z50.\nT2 M6\nG0 X10. Y5.\nG1 Z-1. F300\nX15.\nG0 Z50.\nM30`;
// 선반 G28 U0 W0 → G0 Z2.(X는 아직 안전 위치) → G1 X50.(출발점 X 반지름 75)
const LATHE = `O1\nG21 G99\nG28 U0 W0\nT0101\nG97 S1000 M3\nG0 X40. Z2.\nG1 Z-20. F0.2\nG0 X60.\nG0 Z2.\nG28 U0 W0\nT0202\nG0 Z2.\nG1 X50. F0.2\nG1 Z-20.\nG0 X100.\nM30`;
// G91 G28 Z0 뒤 G3 나선 호 진입(Z35 → Z-2) — 호를 나눈 조각 가운데 마지막 조각 끝만 상자에
const ARC = `O1\nG21 G90 G17\nG0 X0 Y0 Z10\nG91 G28 Z0\nG90\nT1 M6\nS1000 M3\nG54 G0 X10 Y0\nG43 H1 G3 X0 Y10 Z-2 I-10 J0 F300\nG1 X-20\nG0 Z10\nT2 M6\nG0 X0 Y0\nG1 Z-1 F100\nX5\nG0 Z10\nM30`;

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const box = (min: number[], max: number[]): Box3 => ({ min: min as Box3['min'], max: max as Box3['max'] });

async function open(name: string, text: string, opts: Record<string, unknown> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = new NcViewerApp(document.getElementById('app')!);
  expect(await app.openBuffer(name, enc(text), opts)).toBe(true);
  await wait(20);
  return { app, v: app.viewer!, s: app.doc!.scene };
}

/** fitBox를 지운 사본(71차와 같은 장면) */
const unboxed = (s: Scene3d): Scene3d => ({ ...s, lines: s.lines.map(({ fitBox: _fitBox, ...l }) => l) });
const boxes = (s: Scene3d): [string, Box3][] => s.lines.filter((l) => l.fitBox).map((l) => [l.id, l.fitBox!]);

// grow: fitBox 없는 장면에서 숨김 길 맞춤 범위가 Scene3d.bounds보다 넓어진 몫(X 위·Y 위·Z 위)
const CASES = [
  { name: 'start.nc', text: START, bounds: box([0, 0, -5], [50, 20, 50]), boxed: [['nc-cut-1', box([0, 0, -5], [50, 20, -5])]], hide: ['급속 이송', 'T2'], grow: [0, 0, 25] },
  { name: 'lathe.nc', text: LATHE, opts: { lathe: true }, bounds: box([20, 0, -20], [50, 0, 2]), boxed: [['nc-cut-2', box([25, 0, -20], [25, 0, 2])]], hide: ['T1', 'T2'], grow: [25, 0, 0] },
  { name: 'arc.nc', text: ARC, bounds: box([-20, 0, -2], [5, 10, 10]), boxed: [['nc-cut-1', box([-20, 10, -2], [0, 10, -2])]], hide: ['급속 이송', 'T1', 'T2'], grow: [5, 0, 25] },
] as const;

describe('추정 높이에서 출발한 이송이 든 묶음은 출발점을 뺀 상자로 화면을 맞춘다(코어 0.67.0 LineSet3d.fitBox)', () => {
  it('장면: fitBox는 그런 이동이 든 묶음에만(끝점만 — Scene3d.bounds 안), 이송 속도 색·깎기 시뮬레이션 장면도 같은 상자', () => {
    for (const c of CASES) {
      const s = parseForView(c.name, new Uint8Array(enc(c.text)), 'opts' in c ? c.opts : {}).scene;
      expect(s.bounds).toEqual(c.bounds);
      expect(boxes(s)).toEqual(c.boxed);
      for (const [, b] of boxes(s)) for (let a = 0; a < 3; a++) expect(b.min[a]! >= s.bounds!.min[a]! && b.max[a]! <= s.bounds!.max[a]!).toBe(true);
      // 기계 좌표 쪽 추정 이동 묶음(70차 fit: false)·급속·회전축에는 상자를 주지 않는다
      expect(s.lines.filter((l) => l.fitBox && (l.fit === false || !l.id.startsWith('nc-cut-'))).length).toBe(0);
      // 라이브러리 길(해석기 + ncToScene): 기본·이송 속도 색 모두 같은 상자
      const p = parseGcode(c.text, 'opts' in c ? c.opts : {});
      expect(boxes(ncToScene(p))).toEqual(c.boxed);
      expect(boxes(ncToScene(p, { colorBy: 'feed' }))).toEqual(c.boxed);
      expect(boxes(composeSimScene(s, [], true, null))).toEqual(c.boxed);
    }
    // 추정 이동이 없는 프로그램(또는 추정 높이에서 출발한 급속만 — 그 급속은 nc-machine)에는 상자가 없다
    const plain = parseForView('plain.nc', new Uint8Array(enc(`G21 G90 G17\nT1 M6\nG0 X0 Y0 Z5\nG1 Z-2 F100\nX30\nG0 Z5\nG91 G28 Z0\nG90\nT2 M6\nG0 X5 Y5\nG0 Z5\nG1 Z-1 F100\nX10\nG0 Z20\nM30`)), {}).scene;
    expect(plain.lines.some((l) => l.id === 'nc-machine')).toBe(true);
    expect(boxes(plain)).toEqual([]);
  });

  for (const c of CASES)
    it(`${c.name}: 범위를 줄이지 않는 묶음을 숨겨도 맞춤 범위 = Scene3d.bounds, 맞춘 카메라가 같다`, async () => {
      const { app, v, s } = await open(c.name, c.text, 'opts' in c ? c.opts : {});
      expect(boxes(s)).toEqual(c.boxed);
      expect(v.fitBounds).toEqual(s.bounds);
      v.fit(false);
      const cam = v.getCamera();
      // 범위를 줄이지 않는 숨김(없는 묶음 이름 — 코어는 숨김이 하나라도 있으면 보이는 묶음 범위 합으로 맞춘다)
      v.setGroupVisible('없는 묶음', false);
      expect(v.fitBounds).toEqual(s.bounds);
      v.fit(false);
      expect(v.getCamera()).toEqual(cam);
      v.setGroupVisible('없는 묶음', true);
      for (const g of c.hide) {
        app.setGroupVisible(g, false);
        expect(app.doc!.hiddenGroups.has(g)).toBe(true);
        expect(v.fitBounds).toEqual(s.bounds);
        v.fit(false);
        expect(v.getCamera()).toEqual(cam);
        app.setGroupVisible(g, true);
      }
      // 71차와 같은 장면(fitBox 없음): 같은 숨김에서 맞춤이 추정 높이(출발점)까지 넓어진다
      v.setScene(unboxed(s));
      v.setGroupVisible('없는 묶음', false);
      const wide = v.fitBounds;
      const b = s.bounds!;
      expect([wide.max[0] - b.max[0], wide.max[1] - b.max[1], wide.max[2] - b.max[2]]).toEqual(c.grow);
      v.fit(false);
      expect(v.getCamera()).not.toEqual(cam);
    });
});
