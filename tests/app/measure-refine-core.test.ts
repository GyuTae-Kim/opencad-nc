// @vitest-environment jsdom
/**
 * 측정 붙잡기 다듬기·스플라인 접선(16차)을 실제 3D 뷰어 코어(0.14.0 setMeasureSnap({ refine })) 판정으로: 해석기가 읽은 합성 G-code·MPR 장면을
 * 진짜 Viewer3d에 올리고 앱과 같은 붙잡기 선택(refine.ts ncSnapOptions·panelSnapOptions)을 주어
 * - 원호를 나눈 현 위를 찍으면 찍힌 점이 원 위(반지름 1e-9 안, refined)이고, 중심에서 잰 거리가 반지름 그대로
 * - 첫 점에서 원호로 내린 수직 발이 원 위의 정확한 발(현 위 발이 아니라)이고 거리가 정확한 값
 * - 판재 윤곽 호의 현 위 점도 원 위
 * - 스플라인(G5): 조각 위 점·수직 발이 곡선 위, 가운데 점은 곡선 전체의 호 길이 가운데, 시작 끝·조각 위 첫 점에서 Shift가 정확한 접선
 * - 직선 위 점은 다듬지 않는다(refined 없음)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import type { NcPayload } from '../../src/app/protocol';
import type { PanelSnapTable } from '../../src/scene';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions } from '../../src/app/refine';
import { ArcTangents } from '../../src/app/tangent';
import { splineCurve } from '../../src/app/spline';
import { nearestOn, unitTangent } from '../../src/app/curve';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

type Src = { nc: NcPayload; scene: ReturnType<typeof parseForView>['scene'] } | { panel: PanelSnapTable; scene: ReturnType<typeof parseForView>['scene'] };

function setup(src: Src) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(src.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const angle = (src.scene.meta as { arcAngle?: number }).arcAngle;
  // 앱(app.ts syncMeasureSnap)과 같은 붙잡기 선택
  v.setMeasureSnap('panel' in src ? panelSnapOptions(src.panel) : ncSnapOptions(src.nc, arcCenters(src.nc), null, angle));
  v.renderNow();
  const tangents = new ArcTangents();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn(), arcTangent: (a, p) => tangents.at('panel' in src ? src.panel : src.nc, a, p, angle) });
  const at = (p: readonly number[]): { x: number; y: number } => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    return { x: s.x, y: s.y };
  };
  const ptr = (type: string, x: number, y: number): void => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[]): void => {
    const s = at(p);
    ptr('pointermove', s.x, s.y);
    v.renderNow();
    lock.update();
  };
  const click = (p: readonly number[]): void => {
    hover(p);
    const s = at(p);
    ptr('pointerdown', s.x, s.y);
    ptr('pointerup', s.x, s.y);
    v.renderNow();
    lock.update();
  };
  const shiftDown = (): void => {
    lock.shiftDown();
    v.handleKey(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    v.renderNow();
    lock.update();
  };
  /** 세계 사각형(XY 두 구석)을 화면에 채운다 */
  const zoomTo = (lo: readonly number[], hi: readonly number[], z = 0): void => {
    const a = v.project([lo[0]!, lo[1]!, z])!;
    const b = v.project([hi[0]!, hi[1]!, z])!;
    v.zoomToRect(a.x, b.y, b.x, a.y, false);
    v.renderNow();
  };
  return { v, lock, at, hover, click, shiftDown, zoomTo };
}

describe('원호 위로 다듬은 측정 점(실제 코어 0.14.0 refine)', () => {
  // (0,40) → (40,40) 시계 1/4 원(중심 (20,20), R = 20√2, 5°씩 18개 현) → 직선 (60,40)
  const r = parseForView('arc.nc', enc(['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40'].join('\n')));
  const src = { nc: r.nc!, scene: r.scene };
  const R = 20 * Math.SQRT2;
  const C = [20, 20, 0];
  const P = (deg: number): number[] => [20 + R * Math.cos((deg * Math.PI) / 180), 20 + R * Math.sin((deg * Math.PI) / 180), 0];
  /** 현(deg0 → deg1) 위 s 자리 */
  const onChord = (d0: number, d1: number, s: number): number[] => P(d0).map((v, k) => v + (P(d1)[k]! - v) * s);

  it('현 위를 찍으면 원 위 점(refined), 둘째 점도 — 중심에서 잰 거리가 반지름 그대로', () => {
    const w = setup(src);
    const { v } = w;
    // 중심(앱 점) → 현 위
    w.click(C);
    expect(v.measurePoints[0]).toMatchObject({ point: C, snap: 'center' });
    // 셋째 현(125° → 120°)의 1/3 자리 — 끝·가운데 점이 아님
    w.hover(onChord(125, 120, 0.3));
    const h = v.measureHoverSnap!;
    expect(h.refined).toBe(true);
    expect(Math.abs(dist(h.point, C) - R)).toBeLessThan(1e-9);
    w.click(onChord(125, 120, 0.3));
    const m = v.measurement()!;
    expect(Math.abs(m.distance - R)).toBeLessThan(1e-9);
    expect(v.measurePoints[1]!.refined).toBe(true);
    // 다듬지 않았으면 현 위(처짐 R(1 − cos 2.5°) ≈ 0.027 mm 안쪽)였다
    expect(R - R * Math.cos((2.5 * Math.PI) / 180)).toBeGreaterThan(0.02);
  });

  it('이어진 직선 위 점은 다듬지 않는다(refined 없음, 코어 점 그대로)', () => {
    const w = setup(src);
    const { v } = w;
    w.click([40, 40, 0]);
    expect(v.measurePoints[0]!.snap).toBe('endpoint');
    w.hover([52, 40.05, 0]);
    const h = v.measureHoverSnap!;
    expect(h.refined).toBeUndefined();
    expect(h.point[1]).toBeCloseTo(40, 6);
  });
});

describe('반원 위 수직 발(실제 코어 0.14.0 refine)', () => {
  // (10,0) → (−10,0) 반시계 반원(중심 원점, R 10 — 5°씩 36개 현) → 급속 F: 중심에서 82.5°(현 80°~85°의 가운데) 쪽 30 mm
  const ang = (82.5 * Math.PI) / 180;
  const fx = (30 * Math.cos(ang)).toFixed(12);
  const fy = (30 * Math.sin(ang)).toFixed(12);
  const r = parseForView('half.nc', enc(['G21 G90 G17', 'G0 X10 Y0 Z0', 'G3 X-10 Y0 I-10 J0 F500', `G0 X${fx} Y${fy}`].join('\n')));
  const src = { nc: r.nc!, scene: r.scene };
  const F0 = [Number(fx), Number(fy), 0];

  it('첫 점에서 원에 내린 발은 반지름 방향의 원 위 점이고, 잰 거리는 |첫 점| − 10(현 위 발이면 처짐만큼 길다)', () => {
    const w = setup(src);
    const { v } = w;
    w.click(F0);
    expect(v.measurePoints[0]).toMatchObject({ snap: 'endpoint' });
    // 찍힌 첫 점은 장면 꼭짓점(float32) — 정확한 발은 그 점에서
    const F = v.measurePoints[0]!.point;
    const fa = Math.atan2(F[1], F[0]);
    const FOOT = [10 * Math.cos(fa), 10 * Math.sin(fa), 0];
    // 발 둘레를 크게(현 하나가 화면 수백 화소 — 현 끝 붙잡기에서 멀게)
    w.zoomTo([FOOT[0]! - 0.6, FOOT[1]! - 0.45], [FOOT[0]! + 0.6, FOOT[1]! + 0.45]);
    w.hover(FOOT);
    const h = v.measureHoverSnap!;
    expect(h.snap).toBe('perpendicular');
    expect(h.refined).toBe(true);
    expect(dist(h.point, FOOT)).toBeLessThan(1e-9);
    w.click(FOOT);
    const m = v.measurement()!;
    expect(m.snapB).toBe('perpendicular');
    expect(Math.abs(m.distance - (Math.hypot(F[0]!, F[1]!) - 10))).toBeLessThan(1e-9);
    // 수직 발 방향(잠글 때 쓰는 첫 점 → 발)도 다듬은 발 쪽 — 반지름 방향
    expect(dot(m.directionB!, [-Math.cos(fa), -Math.sin(fa), 0])).toBeCloseTo(1, 12);
  });
});

describe('판재 윤곽 호 위로 다듬은 측정 점(실제 코어 0.14.0 refine)', () => {
  const MPR = ['[H', 'VERSION="4.0 Alpha"', '_BSX=300.000000', '_BSY=200.000000', '_BSZ=19.000000', '', ']1', '$E0', 'KP', 'X=20', 'Y=20', 'Z=19', '', '$E1', 'KL', 'X=80', 'Y=20', '', '$E2', 'KA', 'X=100', 'Y=40', 'DS=1', 'R=20', '', '$E3', 'KL', 'X=100', 'Y=80', '', '<100 \\WerkStck\\', 'LA="300"', 'BR="200"', 'DI="19"', '', '<105 \\Konturfraesen\\', 'EA="1:0"', 'EE="1:3"', 'TNO="101"', 'ZA="5"', '!', ''].join('\n');
  const r = parseForView('tan.mpr', enc(MPR));
  const src = { panel: r.mpr!.snap!, scene: r.scene };
  const z = r.scene.lines.find((l) => /^mpr-op-/.test(l.id))!.positions[2]!;
  const A = (deg: number): number[] => [80 + 20 * Math.cos((deg * Math.PI) / 180), 40 + 20 * Math.sin((deg * Math.PI) / 180), z];

  it('호를 나눈 현 위를 찍으면 원(중심 (80,40), R 20) 위 점', () => {
    const w = setup(src);
    const { v } = w;
    w.zoomTo([62, 14], [106, 50], z);
    const p = A(-60).map((x, k) => x + (A(-55)[k]! - x) * 0.4);
    w.click(p);
    const a = v.measurePoints[0]!;
    expect(a.snap).toBeNull();
    expect(a.refined).toBe(true);
    expect(Math.abs(Math.hypot(a.point[0] - 80, a.point[1] - 40) - 20)).toBeLessThan(1e-9);
    expect(a.point[2]).toBeCloseTo(z, 9);
  });
});

describe('스플라인 위로 다듬은 측정 점과 접선(실제 코어 0.14.0)', () => {
  // G5 (0,0) → (10,0), 조정점 (0,5)·(10,5): 대칭 3차 베지어 → 직선 (20,0)
  const r = parseForView('spl.nc', enc(['G21 G90 G17', 'G0 X0 Y0 Z0', 'G5 X10 Y0 I0 J5 P0 Q5 F300', 'G1 X20 Y0'].join('\n')));
  const nc = r.nc!;
  const src = { nc, scene: r.scene };
  const c = splineCurve(nc.splines!, 0, nc.moves.points)!;
  const B = (t: number): number[] => {
    const u = 1 - t;
    return [3 * u * u * t * 0 + 3 * u * t * t * 10 + t * t * t * 10, 3 * u * u * t * 5 + 3 * u * t * t * 5, 0];
  };

  it('조각 위를 찍으면 곡선 위 점(refined), 가운데 점은 곡선 위 (5, 3.75)', () => {
    const w = setup(src);
    const { v } = w;
    w.zoomTo([-1, -1], [11, 5]);
    // 조각 j의 가운데(곡선에서 처짐만큼 안쪽)
    const j = 4;
    const o = (c.move + j) * 3;
    const p = nc.moves.points;
    const mid = [(p[o]! + p[o + 3]!) / 2, (p[o + 1]! + p[o + 4]!) / 2, 0];
    w.hover(mid);
    const h = v.measureHoverSnap!;
    expect(h.refined).toBe(true);
    expect(nearestOn(c, h.point).dist).toBeLessThan(1e-9);
    // 곡선 전체의 호 길이 가운데(앱 점 — 대칭이라 t = 0.5)
    w.hover(B(0.5));
    expect(v.measureHoverSnap).toMatchObject({ snap: 'midpoint' });
    expect(dist(v.measureHoverSnap!.point, [5, 3.75, 0])).toBeLessThan(1e-9);
  });

  it('시작 끝에서 Shift는 정확한 시작 접선(+Y), 조각 위 첫 점은 그 자리의 정확한 접선(커서 쪽)', () => {
    const w = setup(src);
    const { v, lock } = w;
    w.zoomTo([-1, -1], [11, 5]);
    w.click([0, 0, 0]);
    expect(v.measurePoints[0]!.snap).toBe('endpoint');
    // 둘째 조각의 끝(현 끝 — 코어는 그 현 방향을 주려 하지만 곡선 위라 접선)
    const o = (c.move + 2) * 3;
    w.hover([nc.moves.points[o]!, nc.moves.points[o + 1]!, 0]);
    expect(lock.hoverLock).toBe('tangent');
    w.shiftDown();
    expect(dot(v.measureInferenceLock!.direction, [0, 1, 0])).toBeCloseTo(1, 12);
    expect(lock.lock).toBe('tangent');
    lock.shiftUp();
    v.clearMeasure();
    // 조각 위 첫 점(다듬어 곡선 위) → 커서는 곡선 뒤쪽(시작 쪽)
    const j = 6;
    const q = (c.move + j) * 3;
    const pts = nc.moves.points;
    w.click([(pts[q]! + pts[q + 3]!) / 2, (pts[q + 1]! + pts[q + 4]!) / 2, 0]);
    const a = v.measurePoints[0]!;
    expect(a.refined).toBe(true);
    const u = nearestOn(c, a.point).u;
    expect(nearestOn(c, a.point).dist).toBeLessThan(1e-9);
    w.hover(B(0.05));
    expect(lock.hoverLock).toBe('tangent');
    lock.arrow(null);
    const T = unitTangent(c, u)!;
    expect(dot(v.measureInferenceLock!.direction, T)).toBeCloseTo(-1, 9);
    expect(lock.lock).toBe('tangent');
  });

  it('첫 점에서 곡선에 내린 수직 발은 곡선 위의 정확한 발((B − 첫 점)·B′ = 0 — 베지어 식으로 따로 푼 값과 1e-9)', () => {
    // 첫 점: 조각 하나의 가운데 자리 t에서 곡선 바깥 법선으로 6 mm(급속 끝으로 더한다 — 스플라인 조각은 그대로)
    const n = c.moves;
    const t0 = (Math.round(0.8 * n) + 0.5) / n;
    const D = (t: number): number[] => {
      const u = 1 - t;
      return [6 * u * t * 10, 3 * u * u * 5 - 3 * t * t * 5, 0];
    };
    const d0 = D(t0);
    const l0 = Math.hypot(d0[0]!, d0[1]!);
    const q0 = B(t0);
    const fx = (q0[0]! + (6 * -d0[1]!) / l0).toFixed(12);
    const fy = (q0[1]! + (6 * d0[0]!) / l0).toFixed(12);
    const r2 = parseForView('spl2.nc', enc(['G21 G90 G17', 'G0 X0 Y0 Z0', 'G5 X10 Y0 I0 J5 P0 Q5 F300', 'G1 X20 Y0', `G0 X${fx} Y${fy}`].join('\n')));
    expect(r2.nc!.splines!.moves[0]).toBe(n);
    const w = setup({ nc: r2.nc!, scene: r2.scene });
    const { v } = w;
    w.click([Number(fx), Number(fy), 0]);
    expect(v.measurePoints[0]!.snap).toBe('endpoint');
    // 찍힌 첫 점은 장면 꼭짓점(float32) — 정확한 발은 그 점에서
    const F = v.measurePoints[0]!.point;
    // 베지어 식으로 정확한 발: g(t) = (B − F)·B′의 근(반 나누기)
    const g = (t: number): number => dot(B(t).map((x, k) => x - F[k]!), D(t));
    let lo = t0 - 0.5 / n;
    let hi = t0 + 0.5 / n;
    expect(g(lo) * g(hi)).toBeLessThan(0);
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (g(lo) * g(mid) <= 0) hi = mid;
      else lo = mid;
    }
    const foot = B((lo + hi) / 2);
    w.zoomTo([foot[0]! - 0.8, foot[1]! - 0.6], [foot[0]! + 0.8, foot[1]! + 0.6]);
    w.hover(foot);
    const h = v.measureHoverSnap!;
    expect(h.snap).toBe('perpendicular');
    expect(h.refined).toBe(true);
    expect(dist(h.point, foot)).toBeLessThan(1e-9);
    w.click(foot);
    expect(Math.abs(v.measurement()!.distance - dist(F, foot))).toBeLessThan(1e-9);
  });
});

describe('판 외곽선·포켓 둘레(그물 윤곽선)의 호도 측정에서 고르고 다듬고 접선으로(실제 코어 0.14.0)', () => {
  // 판 400 × 300 × 18, 오른쪽 앞 모서리를 R50 1/4 원으로 둥글린 외곽선(중심 (350,50)), 원형 포켓 Ø40(중심 (100,150), 윗면에서 10)
  const PGI = `<?xml version="1.0" encoding="utf-8"?>
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
  <circle centerX="100" centerY="150" centerZ="0" radius="20" width="8" depth="10" direction="z-" empty="1" enable="1" order="1"/>
 </panel>
</pgi>`;
  const r = parseForView('p.pgi', enc(PGI));
  const src = { panel: r.mpr!.snap!, scene: r.scene };
  const D = Math.PI / 180;
  /** 둥근 모서리 위 deg 자리(윗면 z 18) */
  const C = (deg: number): number[] => [350 + 50 * Math.cos(deg * D), 50 + 50 * Math.sin(deg * D), 18];

  it('붙잡기 표에 판 외곽선 호와 원형 포켓 둘레가 위·아래 고리마다 있다', () => {
    const o = src.panel.outlines!;
    expect([...o.keys()]).toEqual(['mpr-board', 'mpr-op-0']);
    expect(o.get('mpr-board')!.length).toBe(18);
    expect([...o.get('mpr-op-0')!].map((v) => Math.round(v * 1000) / 1000)).toEqual([120, 150, 18, 120, 150, 18, 100, 150, 6.283, 120, 150, 8, 120, 150, 8, 100, 150, 6.283]);
  });

  it('둥근 모서리 현 위를 가리키면 원 위 점(refined), 호의 가운데 점, 원형 포켓 둘레도 원 위', () => {
    const w = setup(src);
    const { v } = w;
    w.zoomTo([330, -5], [410, 60], 18);
    // 5°씩 18개 현(−90°부터) — −75° → −70° 현의 0.4 자리
    const p = C(-75).map((x, k) => x + (C(-70)[k]! - x) * 0.4);
    w.hover(p);
    const h = v.measureHoverSnap!;
    expect(h.refined).toBe(true);
    expect(Math.abs(Math.hypot(h.point[0] - 350, h.point[1] - 50) - 50)).toBeLessThan(1e-9);
    expect(h.point[2]).toBeCloseTo(18, 9);
    // 호의 가운데 점(앱 점 — 둘레 호의 가운데)
    w.hover(C(-45));
    expect(v.measureHoverSnap).toMatchObject({ snap: 'midpoint' });
    expect(dist(v.measureHoverSnap!.point, C(-45))).toBeLessThan(1e-9);
    // 원형 포켓 둘레(48각 기둥)
    const w2 = setup(src);
    w2.zoomTo([75, 125], [125, 175], 18);
    // 48각(7.5°씩) — 7.5° → 15° 현의 가운데
    const q = [100 + 20 * Math.cos(15 * D), 150 + 20 * Math.sin(15 * D), 18];
    const q2 = [100 + 20 * Math.cos(7.5 * D), 150 + 20 * Math.sin(7.5 * D), 18];
    const mid = q.map((x, k) => (x + q2[k]!) / 2);
    w2.hover(mid);
    const h2 = w2.v.measureHoverSnap!;
    expect(h2.refined).toBe(true);
    expect(Math.abs(Math.hypot(h2.point[0] - 100, h2.point[1] - 150) - 20)).toBeLessThan(1e-9);
  });

  it('둥근 모서리 현 위 첫 점(원 위로 다듬음)에서 Shift는 그 자리의 접선(커서 쪽)', () => {
    const w = setup(src);
    const { v, lock } = w;
    w.zoomTo([330, -5], [410, 60], 18);
    w.click(C(-75).map((x, k) => x + (C(-70)[k]! - x) * 0.4));
    const a = v.measurePoints[0]!;
    expect(a.refined).toBe(true);
    const deg = Math.atan2(a.point[1] - 50, a.point[0] - 350) / D;
    // 반시계 호: 진행 방향 (−sin, cos) — 커서는 앞쪽(−20°)
    w.hover(C(-20));
    expect(lock.hoverLock).toBe('tangent');
    w.shiftDown();
    expect(dot(v.measureInferenceLock!.direction, [-Math.sin(deg * D), Math.cos(deg * D), 0])).toBeCloseTo(1, 9);
    expect(lock.lock).toBe('tangent');
  });
});
