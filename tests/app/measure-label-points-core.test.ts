// @vitest-environment jsdom
/**
 * 33차(코어 0.31.0 setMeasureLabelAvoid의 points): 측정 거리 글상자가 측정 점 표식을 덮지 않게 — 실제 코어(가짜 캔버스 375 × 560, 휴대폰 폭)로.
 * - 32차 관찰(375px 정밀 조준 미리 보기): 글상자가 화면 폭의 절반을 넘어 캔버스 안으로 당겨지므로, 첫 점이 두 점 화면 가운데의 오른쪽 위면
 *   십자선·손가락과 겹치지 않는 기본 자리가 첫 점 표식을 덮었다. 앱 잠금 손잡이(measure-lock.ts)가 points: true를 넘기면 표식·십자선·손가락을 모두 비킨다
 * - 표식을 덮지 않던 자리는 그대로, 마우스(조준 없음)에서도 같은 규칙
 * 앱이 points를 넘기지 않았을 때(32차 꼴)는 그 값만 뺀 것을 코어에 넘겨 견준다. 커서는 첫 점 아래 빈 곳(첫 점 Y축 방향 붙잡기 — 축에서 0.3화소 비킨다)을,
 * 첫 점은 끝점에서 조금 비켜 가리킨다
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureLabelAvoid, type MeasureLabelRect, type Scene3d } from 'opencad-viewer3d';
import { MEASURE_INFERENCE } from '../../src/app/measure';
import { MeasureLock, type LockViewer } from '../../src/app/measure-lock';
import { installCanvasFakes } from './fake-webgl';

const W = 375;
const H = 560;
let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(W, H);
});
afterAll(() => restore());

// 첫 점 F (40,30)에서 위로 거의 세로로 뻗은 선분 하나(커서를 둘 F 아래는 빈 곳 — 첫 점 Y축 방향 붙잡기만)
const F = [40, 30, 0];
const scene: Scene3d = { name: 'pts', units: 'mm', meshes: [], lines: [{ id: 'path', positions: new Float32Array([40, 30, 0, 45, 60, 0]) }], points: [] };
/** 측정 점 표식 반지름(코어 LABEL_POINT_R) */
const MARK = 6;

/** 카메라 대상만 옮겨 세계 점 m이 캔버스 (dx, dy)에 오게(위에서 본 보기 — 화면 이동의 야코비안으로 세 번) */
function place(v: Viewer3d, m: readonly number[], dx: number, dy: number): void {
  for (let k = 0; k < 3; k++) {
    const s = v.project(m)!;
    const sx = v.project([m[0]! + 1, m[1]!, m[2]!])!;
    const sy = v.project([m[0]!, m[1]! + 1, m[2]!])!;
    const a = sx.x - s.x, b = sy.x - s.x, c = sx.y - s.y, d = sy.y - s.y;
    const det = a * d - b * c;
    const ex = dx - s.x, ey = dy - s.y;
    const cam = v.getCamera();
    v.setCamera({ ...cam, target: [cam.target[0] - (d * ex - b * ey) / det, cam.target[1] - (-c * ex + a * ey) / det, cam.target[2]] });
  }
}

/** points: false면 앱이 넘기는 값에서 points만 뺀다(32차 꼴) */
function setup(points: boolean, touch: boolean) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  v.setMeasureSnap({ midpoints: true, inference: MEASURE_INFERENCE });
  v.renderNow();
  const view = new Proxy(v, {
    get: (o, k) => {
      if (k === 'setMeasureLabelAvoid' && !points) return (a: MeasureLabelAvoid | null) => o.setMeasureLabelAvoid(a && (({ points: _p, ...rest }) => rest)(a));
      const x = Reflect.get(o, k, o) as unknown;
      return typeof x === 'function' ? (x as (...a: unknown[]) => unknown).bind(o) : x;
    },
  }) as unknown as LockViewer;
  const lock = new MeasureLock({ viewer: () => view, touch: () => touch, layer: host, changed: vi.fn() });
  const ptr = (type: string, x: number, y: number, pointerType: string): void => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    v.canvas.dispatchEvent(e);
  };
  const hoverXY = (x: number, y: number, pointerType: string): void => {
    ptr('pointermove', x, y, pointerType);
    v.renderNow();
    lock.update();
    // 앱이 맞춘 비킬 자리로 다시 그린다(코어는 그리기 때 자리를 고른다)
    v.renderNow();
  };
  /** F를 캔버스 at에 두고(끝점 붙잡기 — 끝에서 조금 비켜 누른다) 첫 점으로 */
  const first = (at: { x: number; y: number }, pointerType: string): void => {
    place(v, F, at.x, at.y);
    v.renderNow();
    const s = v.project([F[0]! + 0.07, F[1]! + 0.05, 0])!;
    hoverXY(s.x, s.y, pointerType);
    ptr('pointerdown', s.x, s.y, pointerType);
    ptr('pointerup', s.x, s.y, pointerType);
    v.renderNow();
    lock.update();
    expect(v.measurePoints[0]).toMatchObject({ point: F, snap: 'endpoint' });
  };
  return { v, lock, hoverXY, first };
}

/** 사각형 r이 화면 점 p 둘레 반지름 rad 원과 겹치는지 */
const near = (r: MeasureLabelRect, p: { x: number; y: number }, rad: number): boolean => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.width), Math.max(r.y - p.y, 0, p.y - r.y - r.height)) < rad;
const overlaps = (a: MeasureLabelRect, b: MeasureLabelRect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** 첫 점을 캔버스 f에 두고 커서(조준이면 십자선)를 c에 둔 미리 보기의 글상자·두 표식 자리 */
function preview(points: boolean, touch: boolean, f: { x: number; y: number }, c: { x: number; y: number }) {
  const w = setup(points, touch);
  const pointerType = touch ? 'pen' : 'mouse';
  w.first(f, pointerType);
  // 정밀 조준: 앱 aim.ts가 십자선을 옮기는 처리 안에서(펜 움직임 전) 손가락 자리(십자선 아래 64)를 알린다
  if (touch) w.lock.setAim({ x: c.x, y: c.y + 64 });
  w.hoverXY(c.x, c.y, pointerType);
  const v = w.v;
  const h = v.measureHoverSnap;
  expect(h).toMatchObject({ snap: 'axis', axis: 'y' });
  const hp = v.project(h!.point)!;
  const fp = v.project(v.measurePoints[0]!.point)!;
  const label = v.measureLabelRect!;
  expect(label).not.toBeNull();
  const out = { label, avoid: v.measureLabelAvoid, coverFirst: near(label, fp, MARK), coverHover: near(label, hp, MARK), fp, hp };
  v.dispose();
  return out;
}

describe('33차: 측정 거리 글상자가 측정 점 표식을 덮지 않는다(코어 0.31.0 points)', () => {
  it('휴대폰 정밀 조준: 32차 꼴은 십자선·손가락과 겹치지 않는 기본 자리가 첫 점 표식을 덮고, 앱이 points를 넘기면 표식·십자선·손가락을 모두 비킨다', () => {
    // 첫 점이 두 점 화면 가운데의 위 40화소(글상자 높이 안) — 글상자는 캔버스 오른쪽 끝으로 당겨져 첫 점 위에 온다
    const f = { x: 300, y: 300 };
    const c = { x: 300.3, y: 380 };
    const old = preview(false, true, f, c);
    expect(old.avoid?.points).toBeUndefined();
    // 원인 재현: 글상자(화면 폭의 절반을 넘는다)가 캔버스 안으로 당겨져 첫 점 표식을 덮는다 — 십자선(24)·손가락(44 네모)과는 겹치지 않는다
    expect(old.label.width).toBeGreaterThan(W / 2);
    expect(old.coverFirst).toBe(true);
    expect(near(old.label, c, 24)).toBe(false);
    const finger = { x: Math.round(c.x - 22), y: Math.round(c.y + 64 - 22), width: 44, height: 44 };
    expect(overlaps(old.label, finger)).toBe(false);
    const now = preview(true, true, f, c);
    expect(now.avoid).toMatchObject({ points: true, pointerRadius: 24 });
    expect(now.coverFirst).toBe(false);
    expect(now.coverHover).toBe(false);
    expect(near(now.label, c, 24)).toBe(false);
    expect(overlaps(now.label, finger)).toBe(false);
    // 캔버스 안
    expect(now.label.x >= 0 && now.label.y >= 0 && now.label.x + now.label.width <= W && now.label.y + now.label.height <= H).toBe(true);
    for (const r of now.avoid!.rects ?? []) expect(overlaps(now.label, r)).toBe(false);
  });

  it('마우스(조준 없음)에서도 표식을 덮던 자리만 옮긴다', () => {
    const f = { x: 300, y: 300 };
    const c = { x: 300.3, y: 380 };
    const old = preview(false, false, f, c);
    expect(old.coverFirst).toBe(true);
    const now = preview(true, false, f, c);
    expect(now.avoid).toMatchObject({ points: true });
    expect(now.avoid?.pointerRadius).toBeUndefined();
    expect(now.coverFirst || now.coverHover).toBe(false);
  });

  it('표식을 덮지 않던 자리는 그대로(첫 점이 가운데의 왼쪽)', () => {
    for (const touch of [true, false]) {
      const f = { x: 60, y: 300 };
      const c = { x: 60.3, y: 380 };
      const old = preview(false, touch, f, c);
      expect(old.coverFirst || old.coverHover).toBe(false);
      const now = preview(true, touch, f, c);
      expect(now.label).toEqual(old.label);
    }
  });
});
