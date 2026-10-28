// @vitest-environment jsdom
/**
 * 원호 끝에서 접선 방향으로 잠그기(13차)를 실제 3D 뷰어 코어(0.12.0) 판정으로: 해석기가 읽은 합성 G-code 장면을 진짜 Viewer3d에 올리고
 * (앱 syncMeasureSnap과 같은 붙잡기 — 원호 중심·이동 가운데 점·추론), 앱의 MeasureLock에 원호 접선(tangent.ts)을 주어
 * - 첫 점이 원호 시작이고 커서가 그 원호 위(가운데 점)면 Shift가 접선 방향으로 잠근다(코어 혼자서는 잠글 방향이 없다)
 * - 원호를 나눈 첫 현의 끝을 가리키면 코어는 그 현 방향(접선에서 2.5° 어긋남)을 주지만 ↓는 접선으로 잠근다
 * - 원호 끝(직선이 이어짐)에서: 직선을 따라 가리키면 코어 판정(X축), 원호 위면 접선 — 휴대폰 잠금 단추, 결과 이름 "접선 방향"
 * - 방향 추론(축)은 코어 판정 그대로, 커서가 떠난 뒤 잠금은 마지막으로 본 것(접선이면 접선)
 * - 첫 점이 원호 가운데 점(앱의 가운데 점 붙잡기)이어도 그 점의 접선으로(14차) — Shift·↓·휴대폰 잠금 단추, 결과 이름 "접선 방향"
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import { parseNcFile, ncParsedToScene } from '../../src/index';
import { MOVE_ARC, type NcProgram } from '../../src/model';
import { LOCK_HINTS, MEASURE_INFERENCE, SHIFT_LOCK_HINTS, lockHint } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters, moveSnapPoints, movePointAt, snapPair } from '../../src/app/snap';
import { ArcTangents } from '../../src/app/tangent';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

// (0,40) → (40,40) 시계 방향 1/4 원(중심 (20,20)) → 직선 (60,40)
const parsed = parseNcFile('arc.nc', ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40'].join('\n'));
const nc = (parsed as { program: NcProgram }).program;
const scene = ncParsedToScene(parsed);
const ARC = [...nc.moves.kind].indexOf(MOVE_ARC);
const H = Math.SQRT1_2;
const A = [0, 40, 0];
const B = [40, 40, 0];
const MID = movePointAt(nc, ARC, 0.5)!;

function setup(touch = false, src: { nc: NcProgram; scene: typeof scene } = { nc, scene }) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  const bar = document.createElement('div');
  document.body.append(host, bar);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(src.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  // 앱(app.ts syncMeasureSnap)과 같은 붙잡기
  v.setMeasureSnap({ points: arcCenters(src.nc).points, pointsFor: (p) => moveSnapPoints(p, src.nc), inference: MEASURE_INFERENCE });
  v.renderNow();
  const tangents = new ArcTangents();
  const angle = (src.scene.meta as { arcAngle: number }).arcAngle;
  const lock = new MeasureLock({ viewer: () => v, touch: () => touch, layer: host, changed: vi.fn(), arcTangent: (a, p) => tangents.at(src.nc, a, p, angle) });
  bar.append(lock.button, lock.flash);
  const at = (p: readonly number[]): { x: number; y: number } => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    return { x: s.x, y: s.y };
  };
  const ptr = (type: string, x: number, y: number, pointerType = 'mouse'): void => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[], pointerType = 'mouse'): void => {
    const s = at(p);
    ptr('pointermove', s.x, s.y, pointerType);
    v.renderNow();
    lock.update();
  };
  const click = (p: readonly number[], pointerType = 'mouse'): void => {
    hover(p, pointerType);
    const s = at(p);
    ptr('pointerdown', s.x, s.y, pointerType);
    ptr('pointerup', s.x, s.y, pointerType);
    v.renderNow();
    lock.update();
  };
  /** 앱 onKey 차례: 원호 접선을 먼저(shiftDown), 그다음 코어에 넘긴다(handleKey). 떼기는 앱 keyup(shiftUp) 뒤 코어가 듣는 창 keyup */
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
  const press = (): void => {
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'pointerType', { value: 'touch' });
    lock.button.dispatchEvent(down);
    v.renderNow();
    lock.update();
  };
  const hint = (): string | null => lockHint(v.measurePointCount, !!v.measurement(), lock.lock, touch, lock.hoverLock);
  return { v, lock, at, ptr, hover, click, shiftDown, shiftUp, press, hint };
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('원호 끝에서 접선 방향 잠금(실제 코어 판정)', () => {
  it('첫 점이 원호 시작이고 커서가 원호 가운데 점이면 Shift가 접선 방향으로 잠그고, 떼면 푼다', () => {
    const w = setup();
    const { v, lock } = w;
    w.click(A);
    expect(v.measurePoints).toEqual([{ point: A, snap: 'endpoint' }]);
    w.hover(MID);
    expect(v.measureHoverSnap).toMatchObject({ snap: 'midpoint' });
    // 코어 혼자서는 원호 위 점에서 잠글 방향이 없다
    expect(v.measureHoverLock).toBeNull();
    expect(lock.snapshot()).toMatchObject({ tip: '가운데 점', lock: null, hoverLock: 'tangent' });
    expect(w.hint()).toBe(SHIFT_LOCK_HINTS.tangent);
    w.shiftDown();
    const l = v.measureInferenceLock!;
    expect(l).toMatchObject({ kind: 'parallel', source: 'api' });
    expect(dot(l.direction, [H, H, 0])).toBeCloseTo(1, 12);
    expect(lock.snapshot()).toMatchObject({ tip: '접선 방향 · 잠금', lock: 'tangent', hoverLock: null });
    expect(w.hint()).toBe(LOCK_HINTS.tangent);
    // 잠근 채 다른 곳을 가리키면 접선(첫 점에서 오른쪽 위 45°) 위
    w.hover([10, 44, 0]);
    const p = v.measureHoverSnap!;
    expect(p).toMatchObject({ snap: 'parallel', locked: true });
    expect(p.point[1] - 40).toBeCloseTo(p.point[0], 6);
    w.shiftUp();
    expect(v.measureInferenceLock).toBeNull();
    expect(lock.lock).toBeNull();
  });

  it('원호를 나눈 첫 현의 끝: 코어는 그 현 방향을 주지만 ↓는 원호 접선으로 잠근다', () => {
    const w = setup();
    const { v, lock } = w;
    w.click(A);
    // 장면은 1/4 원을 5°씩 18개 현으로 그린다 — 첫 현의 끝(끝점 붙잡기)
    const v1 = movePointAt(nc, ARC, 1 / 18)!;
    w.hover(v1);
    expect(v.measureHoverSnap).toMatchObject({ snap: 'endpoint' });
    const core = v.measureHoverLock!;
    expect(core.kind).toBe('parallel');
    // 현은 접선에서 2.5° 어긋난다
    expect(dot(core.direction, [H, H, 0])).toBeLessThan(1 - 1e-4);
    expect(dot(core.direction, [H, H, 0])).toBeGreaterThan(Math.cos((3 * Math.PI) / 180));
    expect(lock.hoverLock).toBe('tangent');
    lock.arrow(null);
    expect(dot(v.measureInferenceLock!.direction, [H, H, 0])).toBeCloseTo(1, 12);
    expect(lock.lock).toBe('tangent');
    // 같은 키로 푼다
    lock.arrow(null);
    expect(v.measureInferenceLock).toBeNull();
  });

  it('원호 끝(직선이 이어짐) — 휴대폰 잠금 단추: 직선을 따라 가리키면 코어 판정(X축), 원호 위면 접선, 결과 이름은 접선 방향', () => {
    const w = setup(true);
    const { v, lock } = w;
    w.click(B, 'touch');
    expect(v.measurePointCount).toBe(1);
    // 정밀 조준(코어에 펜 포인터)으로 이어지는 직선의 다른 끝: 코어가 그 모서리 방향(X축)을 준다
    w.hover([60, 40, 0], 'pen');
    expect(lock.snapshot()).toMatchObject({ tip: '끝점', hoverLock: 'x' });
    w.press();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'axis', axis: 'x' });
    expect(lock.lock).toBe('x');
    w.press();
    expect(v.measureInferenceLock).toBeNull();
    // 원호 가운데 점: 끝 (40,40)에서 원호 쪽(왼쪽 위)으로
    w.hover(MID, 'pen');
    expect(lock.snapshot()).toMatchObject({ tip: '가운데 점', hoverLock: 'tangent' });
    w.press();
    expect(dot(v.measureInferenceLock!.direction, [-H, H, 0])).toBeCloseTo(1, 12);
    expect(lock.snapshot()).toMatchObject({ lock: 'tangent', flash: null, tip: '접선 방향 · 잠금' });
    expect(lock.button.getAttribute('aria-pressed')).toBe('true');
    // 둘째 점: 잠근 선 위(접선) — 결과는 코어 종류(나란함)지만 앱이 접선 방향으로 적는다
    w.click([20, 60, 0], 'touch');
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: 'endpoint', snapB: 'parallel', lockedB: true });
    expect(m.b[0] - 40).toBeCloseTo(-(m.b[1] - 40), 6);
    expect(lock.tangentResult(m)).toBe(true);
    expect(snapPair({ ...m, tangentB: true })).toEqual(['끝점', '접선 방향', true]);
    expect(snapPair(m)).toEqual(['끝점', '나란한 방향', true]);
    // 새 첫 점을 찍으면 잊는다
    w.click(A, 'touch');
    expect(lock.tangentResult(m)).toBe(false);
  });

  it('방향 추론(축)은 코어 판정 그대로이고, 커서가 떠난 뒤 잠금 단추는 마지막으로 본 것(접선이면 접선, 축이면 축)', () => {
    const w = setup(true);
    const { v, lock } = w;
    w.click(A, 'touch');
    // 첫 점에서 오른쪽(빈 곳): X축 방향 추론 — 원호 위가 아니다
    w.hover([12, 40, 0], 'pen');
    expect(lock.snapshot()).toMatchObject({ tip: 'X축 방향', hoverLock: 'x' });
    // 원호를 본 뒤 캔버스를 떠나면 접선
    w.hover(MID, 'pen');
    expect(lock.hoverLock).toBe('tangent');
    v.canvas.dispatchEvent(new MouseEvent('pointerleave'));
    v.renderNow();
    lock.update();
    expect(v.measureHoverSnap).toBeNull();
    w.press();
    expect(lock.lock).toBe('tangent');
    expect(dot(v.measureInferenceLock!.direction, [H, H, 0])).toBeCloseTo(1, 12);
    w.press();
    // 그 뒤 X축을 보고 떠나면 코어가 마지막으로 본 X축
    w.hover([12, 40, 0], 'pen');
    v.canvas.dispatchEvent(new MouseEvent('pointerleave'));
    v.renderNow();
    lock.update();
    w.press();
    expect(lock.lock).toBe('x');
  });
});

describe('원호 가운데 점에서 접선 방향 잠금(14차, 실제 코어 판정)', () => {
  // (20,0) → (0,20) 반시계 1/4 원(중심 (0,0)) → 직선 (0,40): 가운데 점 (14.14, 14.14)의 접선은 (−H, H) — 축과 나란하지 않다
  const p2 = parseNcFile('mid.nc', ['G21 G90 G17', 'G0 X20 Y0 Z0', 'G3 X0 Y20 I-20 J0 F500', 'G1 X0 Y40'].join('\n'));
  const src = { nc: (p2 as { program: NcProgram }).program, scene: ncParsedToScene(p2) };
  const arc = [...src.nc.moves.kind].indexOf(MOVE_ARC);
  const mid = movePointAt(src.nc, arc, 0.5)!;
  const T = [-H, H, 0];

  it('첫 점이 원호 가운데 점이고 커서가 그 원호 위면 Shift가 그 점의 접선으로 잠그고, 잠근 선 위에 찍은 결과는 접선 방향', () => {
    const w = setup(false, src);
    const { v, lock } = w;
    w.click(mid);
    expect(v.measurePoints).toHaveLength(1);
    expect(v.measurePoints[0]!.snap).toBe('midpoint');
    for (let k = 0; k < 3; k++) expect(v.measurePoints[0]!.point[k]).toBeCloseTo(mid[k]!, 5);
    // 원호의 다른 자리(현 위)
    w.hover(movePointAt(src.nc, arc, 0.15)!);
    expect(lock.hoverLock).toBe('tangent');
    expect(w.hint()).toBe(SHIFT_LOCK_HINTS.tangent);
    w.shiftDown();
    const l = v.measureInferenceLock!;
    expect(l).toMatchObject({ kind: 'parallel', source: 'api' });
    expect(Math.abs(dot(l.direction, T))).toBeCloseTo(1, 12);
    expect(lock.snapshot()).toMatchObject({ lock: 'tangent', hoverLock: null });
    expect(w.hint()).toBe(LOCK_HINTS.tangent);
    // 잠근 채 접선 가까이에 찍는다(원호에서 벗어난 곳)
    w.click([6, 22.5, 0]);
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: 'midpoint', snapB: 'parallel', lockedB: true });
    expect(m.b[0] - m.a[0]).toBeCloseTo(-(m.b[1] - m.a[1]), 6);
    expect(lock.tangentResult(m)).toBe(true);
    expect(snapPair({ ...m, tangentB: true })).toEqual(['가운데 점', '접선 방향', true]);
    w.shiftUp();
  });

  it('↓·휴대폰 잠금 단추도 같은 접선(원호 끝을 가리켜도), 원호 밖 빈 곳에서는 코어 판정', () => {
    const w = setup(true, src);
    const { v, lock } = w;
    w.click(mid, 'touch');
    expect(v.measurePointCount).toBe(1);
    // 원호 시작 끝(20,0)도 원호 위
    w.hover([20, 0, 0], 'pen');
    expect(lock.hoverLock).toBe('tangent');
    w.press();
    expect(Math.abs(dot(v.measureInferenceLock!.direction, T))).toBeCloseTo(1, 12);
    expect(lock.lock).toBe('tangent');
    w.press();
    expect(v.measureInferenceLock).toBeNull();
    // 가운데 점에서 위로(빈 곳 — Y축 방향 추론): 원호 위가 아니므로 코어 판정
    w.hover([mid[0], mid[1] + 8, 0], 'pen');
    expect(lock.snapshot()).toMatchObject({ tip: 'Y축 방향', hoverLock: 'y' });
    lock.arrow(null);
    expect(lock.lock).toBe('y');
  });
});
