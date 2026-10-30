// @vitest-environment jsdom
/**
 * 깎기 시뮬레이션 소재(높이 지도 그물) 면을 축이 뚫는 점(21차 확인 — 코어 0.18.0 axisFaces, 실제 코어 판정):
 * 소재 그물은 격자 마디 높이를 잇는 삼각형 그 자체라(정확한 곡면이 따로 없다) 코어 점이 그린 면 위 점이고 앱은 다듬지 않는다(NC 붙잡기에 refineFace가 없다).
 * - 평 끝 Ø6 공구로 판 홈(깊이 5)의 바닥: 첫 점 Z축이 뚫는 점은 바닥 높이 그대로(거리 15)
 * - 홈 시작 쪽 벽(참 자리 x = 7.2 — 공구 중심 10.2 − 반지름 3): 첫 점 X축이 뚫는 점은 격자 한 칸(0.5) 안 — 벽은 칸 너비만큼만 안다
 * 격자 마디는 그물 꼭짓점이라 꼭짓점 붙잡기가 먼저다 — 첫 점을 마디에서 비켜 두고(0.2) 크게 당겨 마디에서 붙잡기 거리 밖을 가리킨다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d, type Mesh3d } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { ncSnapOptions } from '../../src/app/refine';
import { arcCenters } from '../../src/app/snap';
import { SimEngine } from '../../src/sim/engine';
import { HeightGrid, type GridSpec } from '../../src/sim/grid';
import { STOCK_RGB, buildBottom, buildWalls, fanIndices, gridIndices, gridOrigin, takeDirtyTiles } from '../../src/sim/mesh';
import { prepareTool } from '../../src/sim/tool';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

// 소재 40 × 40 × 20(윗면 Z 0), 홈: (10.2,20.2)에서 Z−5로 내려 (30.2,20.2)까지, 홈 안 (20.2,20.2)에서 Z−2.5로 내린 점(둘째 첫 점)
const TEXT = ['G21 G17 G90 G54', 'T1 M6', 'G0 X10.2 Y20.2 Z10', 'G1 Z-5 F100', 'G1 X30.2', 'G0 Z10', 'G0 X20.2 Y20.2', 'G1 Z-2.5', 'G0 Z10'].join('\n');
/** 장면 선분은 float32라 첫 점 좌표도 그 값 */
const F = Math.fround;
const SPEC: GridSpec = { x0: 0, y0: 0, nx: 81, ny: 81, dx: 0.5, dy: 0.5, top: 0, bottom: -20 };

/** dir = 보는 방향(눈 쪽 — 없으면 남동 등각) */
function setup(dir?: readonly number[]) {
  const r = parseForView('s.nc', new TextEncoder().encode(TEXT));
  const nc = r.nc!;
  const grid = new HeightGrid(SPEC);
  const tool = prepareTool({ kind: 'flat', diameter: 6, corner: 0, angle: 118 });
  const m = nc.moves;
  const engine = new SimEngine({ count: m.count, kind: m.kind, points: m.points, tool: m.tool, flags: m.flags, arc: m.arc, arcCenter: nc.arcs.center, arcPlane: nc.arcs.plane, arcSweep: nc.arcs.sweep }, grid, () => tool);
  engine.advance({ move: m.count, frac: 0 });
  // 앱(sim.ts)과 같은 소재 그물: 조각·옆면·바닥, 소재 윗면 가운데 원점
  const origin = gridOrigin(grid);
  const mesh = (id: string, a: { positions: Float32Array }, indices: Uint32Array): Mesh3d => ({ id, positions: a.positions, indices, origin, color: [STOCK_RGB[0], STOCK_RGB[1], STOCK_RGB[2], 1] });
  const sim = takeDirtyTiles(grid, origin, 'depth').map((t) => mesh(`sim-tile-${t.tx}-${t.ty}`, t, t.indices ?? (t.flat ? fanIndices(t.cols, t.rows) : gridIndices(t.cols, t.rows))));
  const walls = buildWalls(grid, origin, 'depth');
  const bottom = buildBottom(grid, origin);
  sim.push(mesh('sim-walls', walls, walls.indices), mesh('sim-bottom', bottom, bottom.indices));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene({ ...r.scene, meshes: [...r.scene.meshes.filter((x) => x.id !== 'nc-stock'), ...sim] });
  if (dir) v.setViewDir(dir, false);
  else v.setView('seIso', false);
  v.fit(false);
  v.setMeasureMode(true);
  const opts = ncSnapOptions(nc, arcCenters(nc), null, (r.scene.meta as { arcAngle?: number }).arcAngle);
  expect(opts.refineFace).toBeUndefined();
  v.setMeasureSnap(opts);
  v.renderNow();
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
  };
  const click = (p: readonly number[]): void => {
    hover(p);
    ptr('pointerdown', p);
    ptr('pointerup', p);
    v.renderNow();
  };
  const zoomBox = (lo: readonly number[], hi: readonly number[]): void => {
    const s = [lo[0]!, hi[0]!].flatMap((x) => [lo[1]!, hi[1]!].flatMap((y) => [lo[2]!, hi[2]!].map((z) => v.project([x, y, z])!)));
    v.zoomToRect(Math.min(...s.map((q) => q.x)), Math.min(...s.map((q) => q.y)), Math.max(...s.map((q) => q.x)), Math.max(...s.map((q) => q.y)), false);
    v.renderNow();
  };
  return { v, click, hover, zoomBox };
}

describe('깎기 시뮬레이션 소재 면(높이 지도 그물)을 축이 뚫는 점', () => {
  it('홈 바닥: 첫 점 Z축이 뚫는 점은 바닥 높이 그대로 — 다듬지 않는다', () => {
    // 너비 6·깊이 5 홈 가운데 바닥이 보이게 가파르게 내려다본다
    const w = setup([0.3, -0.3, 1]);
    const { v } = w;
    w.click([10.2, 20.2, 10]);
    expect(v.measurePoints[0]!.point).toEqual([F(10.2), F(20.2), 10]);
    w.zoomBox([9.7, 19.7, -5], [10.7, 20.7, -5]);
    w.hover([10.21, 20.215, -5]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'z' });
    expect(h.face?.id).toMatch(/^sim-tile-/);
    expect(h.refined).toBeFalsy();
    expect(h.point[0]).toBe(F(10.2));
    expect(h.point[1]).toBe(F(20.2));
    expect(h.point[2]).toBeCloseTo(-5, 5);
  });

  it('홈 시작 쪽 벽: 첫 점 X축이 뚫는 점은 참 벽(x = 7.2)에서 격자 한 칸 안, 남은 좌표는 첫 점 그대로', () => {
    const w = setup();
    const { v } = w;
    w.zoomBox([18, 18, -5], [22, 22, 0]);
    w.click([20.2, 20.2, -2.5]);
    expect(v.measurePoints[0]!.point).toEqual([F(20.2), F(20.2), -2.5]);
    // 그린 벽: y = 20·20.5 줄 모두 x = 7 마디(깎이지 않음)와 7.5 마디(바닥) 사이 — z = −2.5에서 x = 7.25
    w.zoomBox([6.7, 19.7, -3.5], [7.7, 20.7, -1.5]);
    w.hover([7.25, 20.22, -2.47]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x' });
    expect(h.face?.id).toMatch(/^sim-/);
    expect(h.refined).toBeFalsy();
    expect(h.point[1]).toBe(F(20.2));
    expect(h.point[2]).toBe(-2.5);
    expect(Math.abs(h.point[0] - 7.2)).toBeLessThanOrEqual(SPEC.dx);
  });
});
