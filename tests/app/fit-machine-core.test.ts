// @vitest-environment jsdom
/**
 * 70차(3D 뷰어 코어 0.65.0 `fit: false`): 기계 좌표 쪽 추정 이동 묶음(nc-machine — 장면 범위 Scene3d.bounds에서 일부러 뺀 선분)과
 * 선반 회전축(lathe-axis — 범위 둘레로 늘인 보조선)은 화면 맞춤 범위에서 뺀다. 코어 기본 규칙은 아무것도 숨기지 않으면 Scene3d.bounds,
 * 묶음 하나라도 숨기면 보이는 묶음 범위의 합이라 69차까지는 공구 하나를 숨기면 맞춤이 추정 안전 높이(경로 맨 위 + 25 mm)까지 넓어졌다.
 * - 장면: fit: false는 그 두 묶음에만(깎기 시뮬레이션 장면도 같은 선분 묶음을 쓴다)
 * - 앱(진짜 코어·가짜 WebGL): 정보 탭 길(app.setGroupVisible)로 범위를 줄이지 않는 묶음(안쪽 공구·급속 이송)을 숨겨도 맞춤 범위 = Scene3d.bounds,
 *   맞춘 카메라가 숨기기 전과 같다(밀링 G28·G53, Heidenhain M91, 선반 G28 U0 W0)
 * - fit 표시를 지운 장면(69차와 같은 장면)은 같은 숨김에서 맞춤 범위 Z 위가 안전 높이까지 넓어진다(이 시험이 차이를 잡는지)
 * 좌표는 float32로 정확한 값만 쓴다(숨김 길은 선분 좌표 float32로 범위를 센다). 해석 워커만 같은 스레드의 parseForView로 바꾼다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d';
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
import { composeSimScene } from '../../src/app/sim';

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

// 공구 둘(T2는 T1 안쪽), 끝에 G91 G28 Z0·G28 X0 Y0 — 추정 이동은 Z 10 → 35(안전 높이)
const FANUC = `O1000\nG21 G90 G17\nT1 M6\nG0 G54 X0 Y0 S1000 M3\nG43 H1 Z10.\nG1 Z-5. F100\nX60.\nY40.\nX0.\nY0.\nG0 Z10.\nG91 G28 Z0.\nG90\nT2 M6\nG0 X20. Y20. S2000 M3\nG43 H2 Z5.\nG1 Z-2. F80\nX30.\nG0 Z10.\nG91 G28 Z0.\nG28 X0. Y0.\nM30`;
// Fusion Haas 포스트 꼴: 공구 교환마다 G53 G0 Z0, 첫 진입은 안전 높이에서 내려오는 급속(끝점은 실제)
const HAAS = `%\nO3000\nG21 G90 G17\nG53 G0 Z0.\nT1 M6\nG0 G54 X50 Y50\nG43 H1 Z25\nG1 Z-5 F200\nX100\nG0 Z25\nG53 G0 Z0\nG91 G28 Z0\nG28 X0 Y0\nG90\nT2 M6\nG0 G54 X10 Y10\nG43 H2 Z25\nG1 Z-3 F200\nX20\nG0 Z25\nG53 G0 Z0.\nM30\n%`;
// Heidenhain M91: 두 공구 모두 기계 좌표 쪽 Z로 물러남
const M91 = `0 BEGIN PGM T MM\n1 TOOL CALL 5 Z S3000\n2 L Z-5 R0 FMAX M91\n3 L X+20 Y+20 R0 FMAX\n4 L Z+2 R0 FMAX\n5 L Z-3 F200\n6 L X+80\n7 L Z-10 R0 FMAX M91\n8 TOOL CALL 6 Z S2000\n9 L X+40 Y+20 R0 FMAX\n10 L Z+2 R0 FMAX\n11 L Z-1 F100\n12 L X+50\n13 L Z-10 R0 FMAX M91\n14 END PGM T MM`;
// 선반 G28 U0 W0(X·Z 안전 위치) 뒤 급속으로 들어감 — 급속은 공구 경로 안쪽, 회전축은 X 0
const LATHE = `O1\nG21 G99\nG28 U0 W0\nT0101\nG97 S1000 M3\nG0 X40. Z2.\nG1 Z-20. F0.2\nG1 X60.\nG0 Z2.\nG28 U0 W0\nT0202\nG0 X50. Z2.\nG1 Z-10. F0.2\nG1 X55.\nG0 Z2.\nG28 U0 W0\nM30`;

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const NO_FIT = ['nc-machine', 'lathe-axis'];

async function open(name: string, text: string, opts: Record<string, unknown> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = new NcViewerApp(document.getElementById('app')!);
  expect(await app.openBuffer(name, enc(text), opts)).toBe(true);
  await wait(20);
  return { app, v: app.viewer!, s: app.doc!.scene };
}

/** fit 표시를 지운 사본(69차와 같은 장면) */
const unmarked = (s: Scene3d): Scene3d => ({ ...s, lines: s.lines.map(({ fit: _fit, ...l }) => l) });

describe('기계 좌표 쪽 추정 이동·회전축은 화면 맞춤에서 뺀다(코어 0.65.0 fit: false)', () => {
  it('장면: fit: false는 nc-machine·lathe-axis에만, 깎기 시뮬레이션 장면도 그대로', async () => {
    const { s } = await open('fanuc.nc', FANUC);
    expect(s.lines.map((l) => [l.id, l.fit ?? null])).toEqual([
      ['nc-rapid', null],
      ['nc-machine', false],
      ['nc-cut-1', null],
      ['nc-cut-2', null],
    ]);
    expect(composeSimScene(s, [], true, null).lines.find((l) => l.id === 'nc-machine')?.fit).toBe(false);
    const lathe = await open('lathe.nc', LATHE, { lathe: true });
    for (const l of lathe.s.lines) expect([l.id, l.fit ?? null]).toEqual([l.id, NO_FIT.includes(l.id) ? false : null]);
    expect(lathe.s.lines.some((l) => l.id === 'lathe-axis')).toBe(true);
    expect([...lathe.s.meshes, ...(lathe.s.points ?? [])].every((x) => x.fit === undefined)).toBe(true);
  });

  // grow: fit 표시 없는 장면에서 숨김 길 맞춤 범위가 Scene3d.bounds보다 넓어진 몫(X 아래·X 위·Z 위) — 밀링은 Z 안전 높이(+25),
  // 선반은 X·Z 안전 위치(+25)와 회전축(X 0)
  for (const c of [
    { name: 'fanuc.nc', text: FANUC, hide: ['T2', '급속 이송'], top: 10, grow: [0, 0, 25] },
    { name: 'haas.nc', text: HAAS, hide: ['T1', '급속 이송'], top: 25, grow: [0, 0, 25] },
    { name: 'm91.h', text: M91, hide: [], top: 2, grow: [0, 0, 25] },
    { name: 'lathe.nc', text: LATHE, hide: ['T2', '급속 이송'], opts: { lathe: true }, grow: [-20, 25, 25] },
  ])
    it(`${c.name}: 범위를 줄이지 않는 묶음을 숨겨도 맞춤 범위 = Scene3d.bounds, 맞춘 카메라가 같다`, async () => {
      const { app, v, s } = await open(c.name, c.text, c.opts);
      expect(s.lines.some((l) => l.id === 'nc-machine')).toBe(true);
      if (c.top !== undefined) expect(s.bounds!.max[2]).toBe(c.top);
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
      // 69차와 같은 장면(fit 표시 없음): 같은 숨김에서 맞춤이 추정 이동(안전 높이)까지 넓어진다
      v.setScene(unmarked(s));
      v.setGroupVisible('없는 묶음', false);
      const wide = v.fitBounds;
      const b = s.bounds!;
      expect([wide.min[0] - b.min[0], wide.max[0] - b.max[0], wide.max[2] - b.max[2]]).toEqual(c.grow);
      v.fit(false);
      expect(v.getCamera()).not.toEqual(cam);
    });
});
