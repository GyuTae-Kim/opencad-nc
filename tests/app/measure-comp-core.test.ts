// @vitest-environment jsdom
/**
 * 반경 보정 경로(공구 중심 — 'nc-comp' 선분 묶음, 워커가 보낸 보정 조각) 호의 측정(19차)을 실제 3D 뷰어 코어(0.17.0) 판정으로:
 * 해석기가 읽은 합성 G42 프로그램(보정 경로 보기를 켬)을 진짜 Viewer3d에 올리고 앱과 같은 붙잡기(ncSnapOptions — 보정 조각의 가운데 점·중심,
 * 곡선 위로 다듬기)와 MeasureLock 원호 접선(tangent.ts — 첫 점 식별자 nc-comp로 그 이동의 보정 호)을 준다.
 * - 보정 호 현 위를 가리키면 원 위(R13 그대로)로 다듬고, 그 점을 첫 점으로 찍으면 Shift가 그 자리의 접선으로 잠근다(식별자로 찾음)
 * - 원 중심에서 보정 호로 내린 수직 발도 원 위(거리 = 반지름)
 * - 보정 호의 가운데 점(앱 점 — 원 위)을 첫 점으로 찍어도 그 점의 접선(좌표로 찾음)
 * 화면 좌표로 가리키는 자리는 선·현 끝을 정확히 가리키지 않게 조금 비킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import { MOVE_ARC } from '../../src/model';
import { MeasureLock } from '../../src/app/measure-lock';
import { parseForView } from '../../src/app/payload';
import { arcCenters, snapPair } from '../../src/app/snap';
import { ncSnapOptions } from '../../src/app/refine';
import { ArcTangents } from '../../src/app/tangent';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

// G42(오른쪽) 공구 지름 6: 반시계 반원 R10(중심 (0,0)) → 보정 호 R13(−90° → 90°), 직선 둘, 시계 1/4 원 R20 → 보정 호 R17
const text = ['G21 G90 G17', 'T1 M6 (D=6)', 'G0 X-20 Y-20 Z0', 'G42 D1 G1 X0 Y-10 F300', 'G3 X0 Y10 I0 J10', 'G1 X-20 Y10', 'G1 X-20 Y30', 'G2 X0 Y50 I20 J0', 'G40 G1 X20 Y50', 'M2'].join('\n');
const r = parseForView('comp.nc', new TextEncoder().encode(text), { comp: true });
const nc = r.nc!;
const scene = r.scene;
const ARC = [...nc.moves.kind].indexOf(MOVE_ARC);
const D = Math.PI / 180;
const c13 = (deg: number, rr = 13): number[] => [rr * Math.cos(deg * D), rr * Math.sin(deg * D), 0];
/** 보정 호 R13의 현 가운데보다 조금 안쪽(현 위 — 다듬기 전) */
const chord = (deg: number): number[] => c13(deg, 13 * Math.cos(2.5 * D) - 0.02);
const ccw = (deg: number): number[] => [-Math.sin(deg * D), Math.cos(deg * D), 0];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const rad = (p: readonly number[]): number => Math.hypot(p[0]!, p[1]!);

function setup(doc: { nc: typeof nc; scene: typeof scene } = { nc, scene }) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(doc.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const angle = (doc.scene.meta as { arcAngle?: number }).arcAngle;
  v.setMeasureSnap(ncSnapOptions(doc.nc, arcCenters(doc.nc), null, angle));
  v.renderNow();
  const tangents = new ArcTangents();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn(), arcTangent: (a, p) => tangents.at(doc.nc, a, p, angle), tangentBy: () => tangents.by });
  /** 위에서 본 세계 상자 lo ~ hi(XY)를 3D 보기에 가득 차게(현이 붙잡기 거리보다 길게 — 측정 점은 그대로) */
  const zoom = (lo: readonly number[], hi: readonly number[]): void => {
    const a = v.project([lo[0]!, lo[1]!, 0])!;
    const b = v.project([hi[0]!, hi[1]!, 0])!;
    v.zoomToRect(a.x, b.y, b.x, a.y, false);
    v.renderNow();
  };
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
  const shiftDown = (): void => {
    lock.shiftDown();
    v.handleKey(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    v.renderNow();
    lock.update();
  };
  const shiftUp = (): void => {
    lock.shiftUp();
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    v.renderNow();
    lock.update();
  };
  return { v, lock, hover, click, shiftDown, shiftUp, zoom };
}

describe('반경 보정 경로 호의 측정(실제 코어 판정)', () => {
  it('보정 호 현 위 점은 원 위로, 그 점을 첫 점으로 찍으면 Shift가 보정 호의 접선으로 잠근다(식별자 nc-comp로 찾음) — 결과 "접선 방향"', () => {
    const w = setup();
    const { v, lock } = w;
    // 현(5° — 길이 1.13)이 붙잡기 거리보다 길게 보이도록 첫 점 둘레를 확대
    w.zoom([0, -14], [8, -9]);
    w.hover(chord(-72.5));
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: null, refined: true, segment: { kind: 'line', id: 'nc-comp', index: ARC } });
    expect(Math.abs(rad(h.point) - 13)).toBeLessThan(1e-9);
    w.click(chord(-72.5));
    const first = v.measurePoints[0]!;
    expect(first).toMatchObject({ refined: true, segment: { id: 'nc-comp', index: ARC } });
    const u = Math.atan2(first.point[1], first.point[0]) / D;
    expect(u).toBeCloseTo(-72.5, 1);
    // 커서를 보정 호의 다른 현 위(32.5° — 원호를 따라 앞)로: 코어 혼자서는 잠글 방향이 없다
    w.zoom([7, 4], [14, 10]);
    w.hover(chord(32.5));
    expect(v.measureHoverSnap).toMatchObject({ snap: null, refined: true });
    expect(v.measureHoverLock).toBeNull();
    expect(lock.snapshot()).toMatchObject({ hoverLock: 'tangent', tangentBy: 'segment' });
    w.shiftDown();
    const l = v.measureInferenceLock!;
    expect(l).toMatchObject({ kind: 'parallel', source: 'api' });
    expect(dot(l.direction, ccw(u))).toBeCloseTo(1, 12);
    expect(lock.snapshot()).toMatchObject({ lock: 'tangent' });
    // 전체를 보고 잠근 접선(첫 점에서 10 앞) 둘레를 찍는다
    v.fit(false);
    const along = [first.point[0] + 10 * ccw(u)[0]!, first.point[1] + 10 * ccw(u)[1]! + 0.3, 0];
    w.hover(along);
    expect(lock.snapshot()).toMatchObject({ tip: '접선 방향 · 잠금', lock: 'tangent' });
    w.click(along);
    const m = v.measurement()!;
    expect(m.lockedB).toBe(true);
    expect(lock.tangentResult(m)).toBe(true);
    expect(snapPair({ ...m, tangentB: true })?.[1]).toBe('접선 방향');
    w.shiftUp();
  });

  it('원 중심(첫 점)에서 보정 호 현으로 내린 수직 발은 원 위 — 거리가 반지름 그대로', () => {
    const w = setup();
    const { v } = w;
    w.click([0.05, 0.03, 0]);
    expect(v.measurePoints[0]).toMatchObject({ point: [0, 0, 0], snap: 'center' });
    w.hover(chord(12.5));
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'perpendicular', refined: true, segment: { id: 'nc-comp', index: ARC } });
    expect(Math.abs(rad(h.point) - 13)).toBeLessThan(1e-9);
    w.click(chord(12.5));
    expect(Math.abs(v.measurement()!.distance - 13)).toBeLessThan(1e-9);
  });

  it('보정 호의 가운데 점(앱 점 — 원 위, 식별자 없음)에서도 그 점의 접선으로 잠근다(좌표로 찾음)', () => {
    // G41(왼쪽) 지름 6: 반시계 135° 호 R20(중심 (0,0)) → 보정 호 R17 — 27토막이라 가운데 점(67.5°)이 현 가운데(꼭짓점이 아님)
    const e = 20 * Math.SQRT1_2;
    const t2 = ['G21 G90 G17', 'T1 M6 (D=6)', 'G0 X30 Y0 Z0', 'G41 D1 G1 X20 Y0 F300', `G3 X${-e} Y${e} I-20 J0`, 'G40 G1 X-30 Y20', 'M2'].join('\n');
    const r2 = parseForView('comp2.nc', new TextEncoder().encode(t2), { comp: true });
    const w = setup({ nc: r2.nc!, scene: r2.scene });
    const { v, lock } = w;
    const c17 = (deg: number, rr = 17): number[] => [rr * Math.cos(deg * D), rr * Math.sin(deg * D), 0];
    const mid = c17(67.5);
    w.zoom([mid[0]! - 4, mid[1]! - 3], [mid[0]! + 4, mid[1]! + 3]);
    w.hover(c17(67.5, 17.03));
    const h = v.measureHoverSnap!;
    expect(h.snap).toBe('midpoint');
    for (let k = 0; k < 3; k++) expect(h.point[k]).toBeCloseTo(mid[k]!, 9);
    expect(h.segment).toBeUndefined();
    w.click(c17(67.5, 17.03));
    expect(v.measurePoints[0]).toMatchObject({ snap: 'midpoint' });
    w.hover(c17(81, 17 * Math.cos(2.5 * D) - 0.02));
    expect(v.measureHoverSnap).toMatchObject({ snap: null, refined: true });
    expect(lock.snapshot()).toMatchObject({ hoverLock: 'tangent', tangentBy: 'coords' });
    w.shiftDown();
    expect(dot(v.measureInferenceLock!.direction, ccw(67.5))).toBeCloseTo(1, 12);
    w.shiftUp();
    expect(v.measureInferenceLock).toBeNull();
  });
});
