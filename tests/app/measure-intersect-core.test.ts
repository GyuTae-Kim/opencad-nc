// @vitest-environment jsdom
/**
 * 17차 측정 붙잡기를 실제 3D 뷰어 코어(0.15.0 setMeasureSnap({ refine }) — 교차점·열린 수직 발) 판정으로: 해석기가 읽은 합성 G-code·PGI 장면을
 * 진짜 Viewer3d에 올리고 앱과 같은 붙잡기 선택(refine.ts ncSnapOptions·panelSnapOptions)을 주어
 * - 원호 × 직선, 원호 × 원호(같은 평면 — 꺾은선 교차점), XY 반원 × ZX 반원(꺾은선이 3D로 비켜 지나가 코어가 넓힌 교차로 넘긴다)의 교차점이
 *   두 곡선의 정확한 교차점(refined)
 * - 원호에서 멀리 떨어진 첫 점: 꺾은선 토막마다 발이 토막 밖이라 보통 수직 발이 없지만, 열린 수직 발(open)을 원 위 정확한 발로 다듬어 붙는다
 *   (0.14.0 'perpendicular' 계산 그대로 — 코어 점이 토막 끝일 뿐)
 * - 19차: 판재 구멍 테두리 × 각진 포켓 모서리(윤곽선이 모두 곧은 그물 — PanelSnapTable.straight)의 교차점도 원 위 정확한 교차점
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type SnapRefineInput } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import type { NcPayload } from '../../src/app/protocol';
import type { PanelSnapTable } from '../../src/scene';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions } from '../../src/app/refine';
import { ArcTangents } from '../../src/app/tangent';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const D = Math.PI / 180;

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
  // 앱(app.ts syncMeasureSnap)과 같은 붙잡기 선택 — 코어가 넘긴 다듬기 입력은 적어 둔다
  const o = 'panel' in src ? panelSnapOptions(src.panel) : ncSnapOptions(src.nc, arcCenters(src.nc), null, angle);
  const calls: SnapRefineInput[] = [];
  v.setMeasureSnap({ ...o, refine: (c) => (calls.push(c), o.refine!(c)) });
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
  /** 세계 사각형(XY 두 구석, 높이 z)을 화면에 채운다 */
  const zoomTo = (lo: readonly number[], hi: readonly number[], z = 0): void => {
    const a = v.project([lo[0]!, lo[1]!, z])!;
    const b = v.project([hi[0]!, hi[1]!, z])!;
    v.zoomToRect(a.x, b.y, b.x, a.y, false);
    v.renderNow();
  };
  /** X 둘레 ±0.6 × ±0.45를 화면에 채우고 가리킨다 */
  const hoverNear = (X: readonly number[]): void => {
    zoomTo([X[0]! - 0.6, X[1]! - 0.45], [X[0]! + 0.6, X[1]! + 0.45], X[2]);
    hover(X);
  };
  return { v, lock, at, hover, click, shiftDown, zoomTo, hoverNear, calls };
}

describe('교차점을 두 곡선의 정확한 교차점으로(실제 코어 0.15.0 refine)', () => {
  // 1: 위쪽 반원(중심 원점 R10, 5°씩 36토막) 2: y = 4 직선 3: 중심 (12,0) R8 원호 4: y = 8의 ZX 평면 원호(R6 — 3°에서 170°까지, 대칭이 아니라 꼭짓점이 z = 0에 오지 않는다)
  const s3 = (6 * Math.sin(3 * D)).toFixed(12);
  const c3 = (6 * Math.cos(3 * D)).toFixed(12);
  const s4 = (6 * Math.sin(170 * D)).toFixed(12);
  const c4 = (6 * Math.cos(170 * D)).toFixed(12);
  const r = parseForView(
    'x.nc',
    enc(
      [
        'G21 G90 G17',
        'G0 X10 Y0 Z0',
        'G3 X-10 Y0 I-10 J0 F500',
        'G0 X-12 Y4',
        'G1 X12 Y4',
        'G0 X4 Y0',
        'G2 X12 Y8 I8 J0',
        `G0 X${s3} Y8 Z${c3}`,
        `G18 G3 X${s4} Z${c4} I-${s3} K-${c3}`,
        'G17 G0 X20 Y20 Z0',
        'M2',
      ].join('\n'),
    ),
  );
  const src = { nc: r.nc!, scene: r.scene };

  it('원호 × 직선: 꺾은선 교차점(현 위)이 아니라 원 위 정확한 교차점(refined)', () => {
    const w = setup(src);
    const X = [Math.sqrt(84), 4, 0];
    w.hoverNear(X);
    const h = w.v.measureHoverSnap!;
    expect(h.snap).toBe('intersection');
    expect(h.refined).toBe(true);
    expect(dist(h.point, X)).toBeLessThan(1e-9);
    // 찍어도 그 점 — 중심(앱 점)에서 잰 거리가 반지름 그대로
    w.click(X);
    expect(w.v.measurePoints[0]).toMatchObject({ snap: 'intersection', refined: true });
    w.zoomTo([-11, -1], [13, 11]);
    w.click([0, 0, 0]);
    expect(Math.abs(w.v.measurement()!.distance - 10)).toBeLessThan(1e-9);
  });

  it('원호 × 원호(같은 평면): 두 원의 교점', () => {
    const w = setup(src);
    const X = [7.5, Math.sqrt(43.75), 0];
    w.hoverNear(X);
    const h = w.v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'intersection', refined: true });
    expect(dist(h.point, X)).toBeLessThan(1e-9);
  });

  it('XY 반원 × ZX 반원: 꺾은선은 3D로 비켜 지나가지만(넓힌 교차) 두 원의 3D 교차점에 붙는다', () => {
    // 4의 z = 0 자리가 x 어느 쪽인지(4의 장면 꼭짓점 — y = 8, |x| ≤ 6 — 가운데 z가 0에 가장 가까운 것)
    const l = r.scene.lines.find((x) => /^nc-cut/.test(x.id))!;
    let best = [0, 0, 1e9];
    for (let k = 0; k < l.positions.length; k += 3) {
      const p = [l.positions[k]!, l.positions[k + 1]!, l.positions[k + 2]!];
      if (Math.abs(p[1]! - 8) < 1e-6 && Math.abs(p[0]!) <= 6 + 1e-6 && Math.abs(p[2]!) < Math.abs(best[2]!)) best = p;
    }
    expect(Math.abs(best[2]!)).toBeGreaterThan(0.05);
    const X = [Math.sign(best[0]!) * 6, 8, 0];
    const w = setup(src);
    w.hoverNear(X);
    const h = w.v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'intersection', refined: true });
    expect(dist(h.point, X)).toBeLessThan(1e-9);
    // 코어가 넓힌 교차(열린 후보)로 넘겼다
    expect(w.calls.some((c) => c.kind === 'intersection' && c.open && !!c.other)).toBe(true);
  });
});

describe('원호에서 멀리 떨어진 첫 점의 수직 발(코어 0.15.0 열린 수직 발)', () => {
  // 위쪽 반원(R10, 5°씩) → 급속으로 81.3° 쪽 200 mm: 첫 점에서 각 현(직선)에 내린 발은 모두 현 밖(가장 가까운 현 80°~85°도 4 mm 밖)
  const fx = (200 * Math.cos(81.3 * D)).toFixed(12);
  const fy = (200 * Math.sin(81.3 * D)).toFixed(12);
  const r = parseForView('far.nc', enc(['G21 G90 G17', 'G0 X10 Y0 Z0', 'G3 X-10 Y0 I-10 J0 F500', `G0 X${fx} Y${fy}`, 'M2'].join('\n')));
  const src = { nc: r.nc!, scene: r.scene };

  it('꺾은선에는 수직 발이 없어도 원 위 정확한 발(반지름 방향)에 붙고, 잰 거리는 |첫 점| − 10', () => {
    const w = setup(src);
    const { v } = w;
    w.click([Number(fx), Number(fy), 0]);
    expect(v.measurePoints[0]!.snap).toBe('endpoint');
    const F = v.measurePoints[0]!.point;
    const fa = Math.atan2(F[1], F[0]);
    const FOOT = [10 * Math.cos(fa), 10 * Math.sin(fa), 0];
    // 현 80°~85° 직선에 내린 발은 현 밖(현 반 길이 0.44 mm보다 멀다)
    const a = [10 * Math.cos(80 * D), 10 * Math.sin(80 * D)];
    const b = [10 * Math.cos(85 * D), 10 * Math.sin(85 * D)];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!];
    const t = ((F[0] - a[0]!) * u[0]! + (F[1] - a[1]!) * u[1]!) / (u[0]! * u[0]! + u[1]! * u[1]!);
    expect(t < 0 || t > 1).toBe(true);
    w.hoverNear(FOOT);
    const h = v.measureHoverSnap!;
    expect(h.snap).toBe('perpendicular');
    expect(h.refined).toBe(true);
    expect(dist(h.point, FOOT)).toBeLessThan(1e-9);
    // 코어는 열린 수직 발만 넘겼다(코어 점은 토막 끝 — 꺾은선 꼭짓점이라 원 위)
    const perp = w.calls.filter((c) => c.kind === 'perpendicular');
    expect(perp.length).toBeGreaterThan(0);
    expect(perp.every((c) => c.open && Math.abs(Math.hypot(c.point[0], c.point[1]) - 10) < 1e-5)).toBe(true);
    w.click(FOOT);
    const m = v.measurement()!;
    expect(m.snapB).toBe('perpendicular');
    expect(Math.abs(m.distance - (Math.hypot(F[0], F[1]) - 10))).toBeLessThan(1e-9);
    expect(dot(m.directionB!, [-Math.cos(fa), -Math.sin(fa), 0])).toBeCloseTo(1, 9);
  });

  it('같은 자리에서 커서만 조금 움직여도 같은 발(결과가 광선에 기대지 않는다)', () => {
    const w = setup(src);
    const { v } = w;
    w.click([Number(fx), Number(fy), 0]);
    const F = v.measurePoints[0]!.point;
    const fa = Math.atan2(F[1], F[0]);
    const FOOT = [10 * Math.cos(fa), 10 * Math.sin(fa), 0];
    w.hoverNear(FOOT);
    const p0 = v.measureHoverSnap!.point;
    w.hover([FOOT[0]! + 0.004, FOOT[1]! - 0.003, 0]);
    expect(v.measureHoverSnap).toMatchObject({ snap: 'perpendicular', refined: true });
    expect(dist(v.measureHoverSnap!.point, p0)).toBe(0);
  });
});

describe('판재 구멍 테두리 × 각진 포켓 모서리(19차 — 윤곽선이 모두 곧은 그물)', () => {
  // 판 400 × 300 × 18, 윗면에서 판 구멍 Ø20(중심 (200,150), 32토막 원기둥)과 그 아래쪽을 가로지르는 각진 포켓(x 170~230, y 138~146, 깊이 3)
  const PGI = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <circle centerX="200" centerY="150" centerZ="0" radius="10" width="20" depth="12" direction="z-" empty="1" enable="1" order="1"/>
  <pocket length="60" width="8" depth="3" direction="z-" cornerRadius="0" angle="0" centerX="200" centerY="142" centerZ="0" enable="1" order="2"/>
 </panel>
</pgi>`;
  const r = parseForView('b.pgi', enc(PGI));
  const src = { panel: r.mpr!.snap! as PanelSnapTable, scene: r.scene };

  it('포켓 윗변(y = 146)이 구멍 테두리를 지나는 점: 토막끼리의 교차점이 아니라 원 위 정확한 교차점(refined)', () => {
    expect(src.panel.straight?.has('mpr-op-1')).toBe(true);
    const w = setup(src);
    const X = [200 - Math.sqrt(84), 146, 18];
    // 교차점 바로 위가 아니라 조금 옆(붙잡기 거리 안)을 가리킨다
    w.zoomTo([X[0]! - 0.6, X[1]! - 0.45], [X[0]! + 0.6, X[1]! + 0.45], 18);
    w.hover([X[0]! + 0.03, X[1]! + 0.02, 18]);
    const h = w.v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'intersection', refined: true });
    expect(dist(h.point, X)).toBeLessThan(1e-9);
    // 곧은 그물을 모르면(18차까지) 코어가 넘긴 교차점을 다듬지 못해 그 점에 붙지 않는다(토막끼리의 교차점이나 테두리 꼭짓점)
    const old = setup({ ...src, panel: { ...src.panel, straight: new Set<string>() } });
    old.zoomTo([X[0]! - 0.6, X[1]! - 0.45], [X[0]! + 0.6, X[1]! + 0.45], 18);
    old.hover([X[0]! + 0.03, X[1]! + 0.02, 18]);
    const o = old.v.measureHoverSnap!;
    expect(old.calls.some((c) => c.kind === 'intersection')).toBe(true);
    expect(o.refined).toBeFalsy();
    expect(dist(o.point, X)).toBeGreaterThan(1e-3);
  });
});
