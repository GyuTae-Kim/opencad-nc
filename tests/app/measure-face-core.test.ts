// @vitest-environment jsdom
/**
 * 축이 판재 원기둥 벽을 뚫는 점(21차 — 3D 뷰어 코어 0.19.0 refineFace 'axisFace')을 실제 코어 판정으로:
 * 해석기가 읽은 합성 PGI 판을 진짜 Viewer3d에 올리고 앱과 같은 붙잡기 선택(refine.ts panelSnapOptions)과 잠금(MeasureLock)으로
 * - 왼쪽면 수평 구멍 중심(첫 점 — 구멍 그물을 숨겨 판 너머로 고른다)에서 X축이 판 외곽선 둥근 모서리 R50을 뚫는 점: 삼각형 위가 아니라 원기둥 위(refined, y·z가 첫 점 그대로) — 'X축 · 면 위', 거리 390
 * - 같은 축으로 잠가도(lockFaces) 같은 점 — '잠근 X축 · 면 위'
 * - 판을 숨기면 보이는 수직 구멍 Ø10의 벽도 원기둥 위
 * - refineFace를 뺀 붙잡기와 평면(윗면)·벽이 아닌 자리의 미리 보기가 같다(0.18.0과 같은 값)
 * - 25차(코어 0.23.0 throughTranslucent): 판을 숨기지 않아도 반투명 판 너머 수직 구멍 벽을 축이 뚫는 점·붙잡기 없는 커서가 맞은 점(0.21.0 onFace)이 원기둥 위.
 *   판을 불투명으로 그리거나 판 너머를 고르지 않으면 판 윗면, 뒤에 불투명 그물이 없는 판 위 자리는 판 너머를 고르든 않든 같은 값
 * 커서는 벽 위 안쪽 자리(현의 경계·그물 윤곽선이 아닌 곳)를 가리킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { snapPair, trackMarks } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { panelSnapOptions } from '../../src/app/refine';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const D = Math.PI / 180;

// 판 400 × 300 × 18, 오른쪽 앞 모서리 R50(중심 (350,50)), 왼쪽면 수평 구멍 Ø8(y 20, z 9), 수직 구멍 Ø10(중심 (150,22), 깊이 12)
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <outlines>
   <outline x="0" y="0" bulge="0" banding="0"/>
   <outline x="350" y="0" bulge="0.41421356237309503" banding="0"/>
   <outline x="400" y="50" bulge="0" banding="0"/>
   <outline x="400" y="300" bulge="0" banding="0"/>
   <outline x="0" y="300" bulge="0" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0"/>
  </outlines>
  <hole x="0" y="20" z="9" diameter="8" depth="30" direction="x+" enable="1" order="1"/>
  <hole x="150" y="22" z="0" diameter="10" depth="12" direction="z-" enable="1" order="2"/>
 </panel>
</pgi>`;
// R50 위 y = 20인 자리 x = 390(−36.87°), Ø10 벽 위 y = 20인 자리 x = 150 + √21(−23.58°)
const R50 = [390, 20, 9];
const H10 = [150 + Math.sqrt(21), 20, 9];
/** 원기둥(축 Z — 중심 c, 반지름 r) 위 각 deg·높이 z인 자리(커서가 가리킬 벽 위 점) */
const onWall = (c: readonly number[], r: number, deg: number, z: number): number[] => [c[0]! + r * Math.cos(deg * D), c[1]! + r * Math.sin(deg * D), z];

function setup(tweak: (o: MeasureSnapOptions) => MeasureSnapOptions = (o) => o) {
  const r = parseForView('p.pgi', enc(PANEL));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  // 수평 구멍 그물(불투명)이 그 시작 중심(구멍 중심 점)을 가리지 않게 숨긴다 — 판(반투명)은 점을 가리지 않는다
  v.setItemVisible('mpr-op-0', false);
  v.setView('seIso', false);
  v.fit(false);
  v.setMeasureMode(true);
  // 앱(app.ts syncMeasureSnap)과 같은 판재 붙잡기 선택
  v.setMeasureSnap(tweak(panelSnapOptions(r.mpr!.snap!)));
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const ptr = (type: string, p: readonly number[]): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[]): void => {
    ptr('pointermove', p);
    v.renderNow();
    lock.update();
  };
  const click = (p: readonly number[]): void => {
    hover(p);
    ptr('pointerdown', p);
    ptr('pointerup', p);
    v.renderNow();
    lock.update();
  };
  /** 세계 상자(두 구석)가 화면을 채우게 */
  const zoomBox = (lo: readonly number[], hi: readonly number[]): void => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [lo[0]!, hi[0]!])
      for (const y of [lo[1]!, hi[1]!])
        for (const z of [lo[2]!, hi[2]!]) {
          const s = v.project([x, y, z])!;
          x0 = Math.min(x0, s.x);
          y0 = Math.min(y0, s.y);
          x1 = Math.max(x1, s.x);
          y1 = Math.max(y1, s.y);
        }
    v.zoomToRect(x0, y0, x1, y1, false);
    v.renderNow();
  };
  return { v, r, lock, hover, click, zoomBox };
}

describe('축이 판재 원기둥 벽을 뚫는 점(코어 0.19.0 refineFace, 실제 코어 판정)', () => {
  it('수평 구멍 중심에서 X축이 판 외곽선 R50을 뚫는 점: 원기둥 위 — "X축 · 면 위", 거리 390', () => {
    const w = setup();
    const { v, lock } = w;
    w.click([0, 20.2, 9.1]);
    expect(v.measurePoints[0]!.point).toEqual([0, 20, 9]);
    w.zoomBox([360, 0, 0], [400, 40, 18]);
    w.hover(onWall([350, 50], 50, -36.8, 9.15));
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', refined: true, face: { id: 'mpr-board' } });
    expect(h.trackFrom).toBeUndefined();
    expect(h.point[1]).toBe(20);
    expect(h.point[2]).toBe(9);
    expect(Math.abs(h.point[0] - R50[0]!)).toBeLessThan(1e-9);
    expect(lock.snapshot().tip).toBe('X축 · 면 위');
    w.click(onWall([350, 50], 50, -36.8, 9.15));
    const m = v.measurement()!;
    expect(Math.abs(m.distance - 390)).toBeLessThan(1e-9);
    expect(v.measurePoints[1]!.refined).toBe(true);
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })![1]).toBe('X축 · 면 위');
  });

  it('X축으로 잠가도(lockFaces) 같은 원기둥 위 점 — "잠근 X축 · 면 위"', () => {
    const w = setup();
    const { v, lock } = w;
    w.click([0, 20.2, 9.1]);
    lock.arrow('x');
    w.zoomBox([360, 0, 0], [400, 40, 18]);
    w.hover(onWall([350, 50], 50, -37, 8.9));
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', locked: true, refined: true, face: { id: 'mpr-board' } });
    expect(h.point[1]).toBe(20);
    expect(h.point[2]).toBe(9);
    expect(Math.abs(h.point[0] - R50[0]!)).toBeLessThan(1e-9);
    expect(lock.snapshot().tip).toBe('잠근 X축 · 면 위');
  });

  it('판을 숨기면 보이는 수직 구멍 Ø10의 벽: 원기둥 위', () => {
    const w = setup();
    const { v } = w;
    v.setItemVisible('mpr-board', false);
    w.click([0, 20.2, 9.1]);
    expect(v.measurePoints[0]!.point).toEqual([0, 20, 9]);
    w.zoomBox([140, 10, 4], [160, 30, 18]);
    w.hover(onWall([150, 22], 5, -23.2, 9.1));
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', refined: true, face: { id: 'mpr-op-1' } });
    expect(h.point[1]).toBe(20);
    expect(h.point[2]).toBe(9);
    expect(Math.abs(h.point[0] - H10[0]!)).toBeLessThan(1e-9);
  });

  it('refineFace를 뺀 붙잡기: 벽에서는 삼각형 위 점(처짐만큼 안쪽), 윗면·벽이 아닌 자리는 같은 값', () => {
    const plain = (o: MeasureSnapOptions): MeasureSnapOptions => {
      const { refineFace: _drop, ...rest } = o;
      return rest;
    };
    const view = (h: Viewer3d['measureHoverSnap']) => h && { snap: h.snap, point: h.point, axis: h.axis ?? null, refined: !!h.refined, face: h.face?.id ?? null, segment: h.segment?.id ?? null };
    const spots = [[200.3, 150.2, 18], [120.4, 0.3, 9.2], [399.6, 200.4, 18], [30.4, 20.6, 13.1]];
    const seen: unknown[][] = [[], []];
    const wall: number[][] = [];
    [setup(), setup(plain)].forEach((w, k) => {
      for (const p of spots) {
        w.hover(p);
        seen[k]!.push(view(w.v.measureHoverSnap));
      }
      w.click([0, 20.2, 9.1]);
      for (const p of spots) {
        w.hover(p);
        seen[k]!.push(view(w.v.measureHoverSnap));
      }
      w.zoomBox([360, 0, 0], [400, 40, 18]);
      w.hover(onWall([350, 50], 50, -36.8, 9.15));
      wall.push(w.v.measureHoverSnap!.point);
    });
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0]!.filter(Boolean).length).toBeGreaterThan(3);
    expect(Math.abs(wall[0]![0]! - 390)).toBeLessThan(1e-9);
    // 뺀 쪽은 현 위(원기둥 안쪽 — 중심에서 50보다 가깝다)
    expect(Math.hypot(wall[1]![0]! - 350, wall[1]![1]! - 50)).toBeLessThan(50 - 1e-4);
  });
});

describe('반투명 판 너머 구멍 벽(25차 — 코어 0.23.0 throughTranslucent, 실제 코어 판정)', () => {
  /** 판(투명도 0.35)을 지나 고르지 않는 붙잡기(24차까지와 같은 고르기) */
  const front = (o: MeasureSnapOptions): MeasureSnapOptions => ({ ...o, throughTranslucent: false });
  const view = (h: Viewer3d['measureHoverSnap']) => h && { snap: h.snap, point: h.point, axis: h.axis ?? null, refined: !!h.refined, face: h.face?.id ?? null, segment: h.segment?.id ?? null };
  const cylDev = (p: readonly number[]): number => Math.abs(Math.hypot(p[0]! - 150, p[1]! - 22) - 5);
  // 구멍 그물은 위·아래가 막힌 원기둥(불투명)이라 판 너머로 보이는 것은 그 바깥 벽이다. Ø10 벽의 눈 쪽(−42.5° — 토막 가운데, 높이 12):
  // 그 자리 광선은 구멍 테두리 바깥에서 판 윗면을 지나 판 안을 거쳐 벽에 닿는다(판을 지나지 않으면 판 윗면)
  const near = onWall([150, 22], 5, -42.5, 12.2);

  it('판을 숨기지 않아도 수평 구멍 중심의 X축이 수직 구멍 Ø10 벽을 뚫는 점: 원기둥 위 — "X축 · 면 위"(판 너머를 고르지 않으면 그 점에 붙지 않는다)', () => {
    const w = setup();
    w.click([0, 20.2, 9.1]);
    expect(w.v.measurePoints[0]!.point).toEqual([0, 20, 9]);
    w.zoomBox([140, 10, 4], [160, 30, 18]);
    w.hover(onWall([150, 22], 5, -23.2, 9.1));
    const h = w.v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', refined: true, face: { id: 'mpr-op-1' } });
    expect(h.point[1]).toBe(20);
    expect(h.point[2]).toBe(9);
    expect(Math.abs(h.point[0] - H10[0]!)).toBeLessThan(1e-9);
    expect(w.lock.snapshot().tip).toBe('X축 · 면 위');
    const old = setup(front);
    old.click([0, 20.2, 9.1]);
    old.zoomBox([140, 10, 4], [160, 30, 18]);
    old.hover(onWall([150, 22], 5, -23.2, 9.1));
    const g = old.v.measureHoverSnap;
    expect(g?.face?.id ?? null).not.toBe('mpr-op-1');
    expect(g && Math.abs(g.point[0] - H10[0]!) < 1e-9 && g.refined).toBeFalsy();
  });

  it('붙잡기 없는 커서가 판 너머 Ø10 벽(눈 쪽)을 맞은 점: 원기둥 위(onFace, refined) — 판을 지나지 않으면 판 윗면(높이 18)', () => {
    const faces: string[] = [];
    const w = setup((o) => ({ ...o, refineFace: (c) => (faces.push(`${c.kind}:${c.face.id}`), o.refineFace!(c)) }));
    w.zoomBox([143, 15, 4], [157, 29, 18]);
    w.hover(near);
    const h = w.v.measureHoverSnap!;
    expect(faces).toContain('onFace:mpr-op-1');
    expect(h).toMatchObject({ snap: null, refined: true });
    expect(cylDev(h.point)).toBeLessThan(1e-9);
    expect(h.point[2]).toBeGreaterThan(6);
    expect(h.point[2]).toBeLessThan(18);
    const old = setup(front);
    old.zoomBox([143, 15, 4], [157, 29, 18]);
    old.hover(near);
    const g = old.v.measureHoverSnap!;
    expect(g.snap).toBeNull();
    expect(g.refined).toBeFalsy();
    expect(Math.abs(g.point[2] - 18)).toBeLessThan(1e-4);
  });

  it('판을 불투명으로 그리면(setItemColor 알파 1 — setItemOpacity는 판 색 알파 0.35에 곱한다) 판 너머를 고르지 않는다 — 판을 지나지 않는 붙잡기와 같은 값. 뒤에 불투명 그물이 없는 판 위 자리도 같은 값', () => {
    const spots = [[200.3, 150.2, 18], [120.4, 0.3, 9.2], [399.6, 200.4, 18]];
    const seen: unknown[][] = [];
    for (const [tweak, opaque] of [[(o: MeasureSnapOptions) => o, true], [front, true], [front, false]] as const) {
      const w = setup(tweak);
      if (opaque) w.v.setItemColor('mpr-board', [0.86, 0.74, 0.55, 1]);
      w.zoomBox([143, 15, 4], [157, 29, 18]);
      const row: unknown[] = [view((w.hover(near), w.v.measureHoverSnap))];
      w.v.fit(false);
      w.v.renderNow();
      for (const p of spots) row.push(view((w.hover(p), w.v.measureHoverSnap)));
      seen.push(row);
    }
    expect(seen[0]).toEqual(seen[1]);
    // 반투명 판(그대로)에서도 뒤에 불투명 그물이 없는 판 위 세 자리는 판을 지나든 않든 같다
    const now = setup();
    const row = spots.map((p) => view((now.hover(p), now.v.measureHoverSnap)));
    expect(row).toEqual(seen[2]!.slice(1));
    expect(row.filter(Boolean).length).toBe(3);
  });
});
