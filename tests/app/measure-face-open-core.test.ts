// @vitest-environment jsdom
/**
 * 축이 판재 원기둥 벽 삼각형을 비켜 가며 원기둥만 뚫는 자리(25차 — 3D 뷰어 코어 0.22.0 면의 열린 교차, refineFace 'axisFace'의 open)를 실제 코어 판정으로:
 * 해석기가 읽은 합성 PGI 판(위쪽 변에 볼록 호 — 중심 (200,260), R50, 37°→121°, 17토막. 꼭대기 90°가 86.412°~91.353° 토막 안)을 진짜 Viewer3d에 올리고
 * 앱과 같은 붙잡기 선택(refine.ts panelSnapOptions)으로 첫 점 (100, 309.995, z)의 X축이 호 꼭대기를 그 현 바깥(활꼴)으로 스치는 자리를 가리킨다.
 * - 높이 3: 커서 쪽 근(x ≈ 200.707)의 삼각형은 무게중심 쪽 힌트가 원기둥 밖이다. 22차까지의 길(코어 점에서 바깥쪽 근)은 null이라 축 위 커서 자리였고,
 *   25차 열린 후보 길은 원기둥 위 교차 — 'X축 · 면 위', 거리 100.707
 * - 높이 9: 힌트가 원기둥 안인 삼각형 — 22차 길로도 같은 점
 * - 같은 축의 다른 근(x ≈ 199.293)은 한 삼각형 위를 선이 두 번 지나는 자리라 힌트 쪽 근 하나만 받는다(코어 0.22.0의 한계 — 코어 요청)
 * 첫 점은 시험이 붙잡기 점 하나를 더해 찍는다. 커서는 근에서 화면 (1, 2)화소 옆이다(선·면 경계를 정확히 가리키지 않는다).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions, type SnapRefineFaceInput } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { snapPair, trackMarks } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { panelSnapOptions, panelWalls } from '../../src/app/refine';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const D = Math.PI / 180;
const at = (deg: number): number[] => [200 + 50 * Math.cos(deg * D), 260 + 50 * Math.sin(deg * D)].map((x) => +x.toFixed(6));
const [A0, A1] = [at(37), at(121)];
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <outlines>
   <outline x="0" y="0" bulge="0" banding="0"/>
   <outline x="400" y="0" bulge="0" banding="0"/>
   <outline x="400" y="300" bulge="0" banding="0"/>
   <outline x="${A0[0]}" y="${A0[1]}" bulge="${Math.tan(21 * D)}" banding="0"/>
   <outline x="${A1[0]}" y="${A1[1]}" bulge="0" banding="0"/>
   <outline x="0" y="300" bulge="0" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0"/>
  </outlines>
 </panel>
</pgi>`;
const YL = 309.995;
const r = parseForView('p.pgi', new TextEncoder().encode(PANEL));
const W = panelWalls(r.mpr!.snap!, 'mpr-board')[0]!;
const S = Math.sqrt(W.r * W.r - (YL - W.cv) ** 2);

/** 첫 점 (100, YL, z)를 찍고 꼭대기 둘레를 화면 가득. old면 22차 함수처럼 열린 후보도 open 없이(코어 점에서 바깥쪽 근) 다듬는다 */
function setup(z: number, old = false) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('back', false);
  v.fit(false);
  v.setMeasureMode(true);
  const first = [100, YL, z];
  const calls: SnapRefineFaceInput[] = [];
  const o = panelSnapOptions(r.mpr!.snap!);
  const opts: MeasureSnapOptions = {
    ...o,
    points: [...(o.points ?? []), { point: first, kind: 'center' }],
    refineFace: (c) => (calls.push(c), o.refineFace!(old ? { ...c, open: undefined } : c)),
  };
  v.setMeasureSnap(opts);
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const ptr = (type: string, p: readonly number[]): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x + 1, clientY: s.y + 2, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
    v.renderNow();
    lock.update();
  };
  const click = (p: readonly number[]): void => {
    ptr('pointermove', p);
    ptr('pointerdown', p);
    ptr('pointerup', p);
  };
  click(first);
  expect(v.measurePoints[0]).toMatchObject({ point: first, snap: 'center' });
  // 꼭대기 둘레 3 × 4(1화소 ≈ 0.0066)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const x of [198.5, 201.5])
    for (const y of [309.9, 310])
      for (const zz of [z - 2, z + 2]) {
        const s = v.project([x, y, zz])!;
        x0 = Math.min(x0, s.x);
        y0 = Math.min(y0, s.y);
        x1 = Math.max(x1, s.x);
        y1 = Math.max(y1, s.y);
      }
  v.zoomToRect(x0, y0, x1, y1, false);
  v.renderNow();
  return { v, lock, calls, hover: (p: readonly number[]) => ptr('pointermove', p), click };
}

describe('축이 판 외곽선 볼록 호 꼭대기를 그 현 바깥으로 스치는 자리(코어 0.22.0 면의 열린 교차, 실제 코어 판정)', () => {
  it('높이 3: 원기둥 밖 힌트의 삼각형으로 원기둥 위 교차 — "X축 · 면 위", 거리 100.707(22차 길이면 축 위 커서 자리)', () => {
    const Q = [W.cu + S, YL, 3];
    const w = setup(3);
    w.hover(Q);
    const h = w.v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', refined: true, face: { id: 'mpr-board' } });
    expect(Math.abs(h.point[0] - Q[0]!)).toBeLessThan(1e-9);
    expect(h.point[1]).toBe(YL);
    expect(h.point[2]).toBe(3);
    // 앱이 받은 열린 후보: 힌트가 원기둥 밖(중심에서 50보다 멀다)
    const c = w.calls.find((x) => x.open && x.face.index === h.face!.index)!;
    expect(c).toBeTruthy();
    expect(Math.hypot(c.point[0] - W.cu, c.point[1] - W.cv)).toBeGreaterThan(W.r);
    expect(w.lock.snapshot().tip).toBe('X축 · 면 위');
    w.click(Q);
    const m = w.v.measurement()!;
    expect(Math.abs(m.distance - (Q[0]! - 100))).toBeLessThan(1e-9);
    expect(snapPair({ ...m, ...trackMarks(w.v.measurePoints) })![1]).toBe('X축 · 면 위');
    // 22차 길: 다듬지 못해 축 위 커서 자리(원기둥에서 벗어난다)
    const o = setup(3, true);
    o.hover(Q);
    const g = o.v.measureHoverSnap!;
    expect(g).toMatchObject({ snap: 'axis', axis: 'x' });
    expect(g.refined).toBeFalsy();
    expect(Math.abs(g.point[0] - Q[0]!)).toBeGreaterThan(1e-4);
  });

  it('높이 9: 원기둥 안 힌트의 삼각형 — 25차·22차 길 모두 같은 원기둥 위 교차', () => {
    const Q = [W.cu + S, YL, 9];
    const got = [setup(9), setup(9, true)].map((w) => {
      w.hover(Q);
      const h = w.v.measureHoverSnap!;
      expect(h).toMatchObject({ snap: 'axis', axis: 'x', refined: true });
      return h.point;
    });
    expect(Math.abs(got[0]![0]! - Q[0]!)).toBeLessThan(1e-9);
    expect(got[1]).toEqual(got[0]);
  });

  it('같은 축의 다른 근(x ≈ 199.293)은 받지 않는다: 그 자리 삼각형의 힌트 쪽 근이 다른 근이다(코어가 한 삼각형 위 두 교차 가운데 힌트 쪽 하나만 받는다)', () => {
    const Q = [W.cu - S, YL, 9];
    const w = setup(9);
    w.hover(Q);
    const h = w.v.measureHoverSnap!;
    expect(h.refined).toBeFalsy();
    const c = w.calls.find((x) => x.open)!;
    expect(c).toBeTruthy();
    // 앱은 그 힌트(x ≈ 200.26)에 가까운 근(x ≈ 200.707)을 준다 — 커서에서 멀어 코어가 버린다
    const q = panelSnapOptions(r.mpr!.snap!).refineFace!(c)!;
    expect(Math.abs(q[0] - (W.cu + S))).toBeLessThan(1e-9);
  });
});
