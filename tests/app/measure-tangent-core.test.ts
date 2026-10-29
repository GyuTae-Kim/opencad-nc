// @vitest-environment jsdom
/**
 * 원호 끝에서 접선 방향으로 잠그기(13차)를 실제 3D 뷰어 코어(0.12.0) 판정으로: 해석기가 읽은 합성 G-code 장면을 진짜 Viewer3d에 올리고
 * (앱 syncMeasureSnap과 같은 붙잡기 — 원호 중심·이동 가운데 점·추론), 앱의 MeasureLock에 원호 접선(tangent.ts)을 주어
 * - 첫 점이 원호 시작이고 커서가 그 원호 위(가운데 점)면 Shift가 접선 방향으로 잠근다(코어 혼자서는 잠글 방향이 없다)
 * - 원호를 나눈 첫 현의 끝을 가리키면 코어는 그 현 방향(접선에서 2.5° 어긋남)을 주지만 ↓는 접선으로 잠근다
 * - 원호 끝(직선이 이어짐)에서: 직선을 따라 가리키면 코어 판정(X축), 원호 위면 접선 — 휴대폰 잠금 단추, 결과 이름 "접선 방향"
 * - 방향 추론(축)은 코어 판정 그대로, 커서가 떠난 뒤 잠금은 마지막으로 본 것(접선이면 접선)
 * - 첫 점이 원호 가운데 점(앱의 가운데 점 붙잡기)이어도 그 점의 접선으로(14차) — Shift·↓·휴대폰 잠금 단추, 결과 이름 "접선 방향"
 * - 첫 점이 원호 위 다른 자리(현 위 — 코어 모서리 붙잡기, 현의 끝)여도 원호 위 가장 가까운 자리의 접선으로, 방향은 원호를 따라 커서 쪽(15차)
 * - 판재(MPR) 윤곽 가공의 호도 끝·가운데 점·현 위에서 같은 접선(15차 — 앱과 같은 판재 붙잡기 표)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import { parseNcFile, ncParsedToScene } from '../../src/index';
import { MOVE_ARC, type NcProgram } from '../../src/model';
import { LOCK_HINTS, SHIFT_LOCK_HINTS, lockHint } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { parseForView } from '../../src/app/payload';
import { arcCenters, movePointAt, snapPair } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions } from '../../src/app/refine';
import { ArcTangents, arcNearest, arcTangentAtF } from '../../src/app/tangent';
import type { PanelSnapTable } from '../../src/scene';
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

/** 띄울 장면과 붙잡기 자료: NC 이동(nc)이나 판재 붙잡기 표(panel) */
type Src = { nc: NcProgram; panel?: undefined; scene: typeof scene } | { nc?: undefined; panel: PanelSnapTable; scene: typeof scene };

function setup(touch = false, src: Src = { nc, scene }) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  const bar = document.createElement('div');
  document.body.append(host, bar);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(src.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  // 앱(app.ts syncMeasureSnap)과 같은 붙잡기(판재는 붙잡기 표의 중심·윤곽 요소) — 16차부터 곡선 위로 다듬기(refine)도
  const angle0 = (src.scene.meta as { arcAngle?: number }).arcAngle;
  v.setMeasureSnap(src.panel ? panelSnapOptions(src.panel) : ncSnapOptions(src.nc, arcCenters(src.nc), null, angle0));
  v.renderNow();
  const tangents = new ArcTangents();
  const angle = (src.scene.meta as { arcAngle?: number }).arcAngle;
  const lock = new MeasureLock({ viewer: () => v, touch: () => touch, layer: host, changed: vi.fn(), arcTangent: (a, p) => tangents.at(src.panel ?? src.nc, a, p, angle) });
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
    // 코어 0.16.0: 찍은 끝점에 그 점이 놓인 토막(원호 이동을 나눈 첫 현 — 이동 번호)의 식별자가 실린다
    expect(v.measurePoints).toMatchObject([{ point: A, snap: 'endpoint', segment: { kind: 'line', id: 'nc-cut-none', index: ARC, raw: 0 } }]);
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

/** 잠근 선(첫 점 a, 단위 방향 d) 위에 b가 있는지: (b − a) × d ≈ 0 */
const onLine = (a: readonly number[], d: readonly number[], b: readonly number[]): void => {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const c = [u[1]! * d[2]! - u[2]! * d[1]!, u[2]! * d[0]! - u[0]! * d[2]!, u[0]! * d[1]! - u[1]! * d[0]!];
  expect(Math.hypot(c[0]!, c[1]!, c[2]!)).toBeLessThan(1e-4);
};

describe('원호 위 아무 점에서 접선 방향 잠금(15차, 실제 코어 판정)', () => {
  // 맨 위와 같은 1/4 원(시계, 중심 (20,20), 5°씩 18개 현): 넷째 현의 가운데(원호에서 처짐만큼 안쪽)와 여섯째 현의 끝
  const v3 = movePointAt(nc, ARC, 3 / 18)!;
  const v4 = movePointAt(nc, ARC, 4 / 18)!;
  const CHORD = [(v3[0] + v4[0]) / 2, (v3[1] + v4[1]) / 2, 0];
  /** 첫 점(코어 점)에서 원호 위 가장 가까운 자리의 진행 방향 접선 */
  const tangentOf = (a: readonly number[]): number[] => arcTangentAtF(nc, ARC, arcNearest(nc, ARC, a)!.f)!;

  it('현 위(모서리 붙잡기)에 찍은 첫 점: 커서가 원호 앞쪽이면 Shift가 그 자리의 접선(커서 쪽)으로 잠그고, 결과는 접선 방향', () => {
    const w = setup();
    const { v, lock } = w;
    w.click(CHORD);
    expect(v.measurePointCount).toBe(1);
    const a = v.measurePoints[0]!;
    // 끝·가운데 점이 아닌 현 위 — 코어가 붙잡은 종류가 없다
    expect(a.snap).toBeNull();
    expect(Math.hypot(a.point[0] - CHORD[0]!, a.point[1] - CHORD[1]!)).toBeLessThan(0.05);
    const T = tangentOf(a.point);
    // 첫 점이 현 위라 원호에서 조금 벗어나도 넷째 현 가운데 자리(3.5/18)의 접선과 거의 같다
    expect(dot(T, arcTangentAtF(nc, ARC, 3.5 / 18)!)).toBeGreaterThan(Math.cos(0.01));
    w.hover(movePointAt(nc, ARC, 0.6)!);
    expect(lock.hoverLock).toBe('tangent');
    expect(w.hint()).toBe(SHIFT_LOCK_HINTS.tangent);
    w.shiftDown();
    const l = v.measureInferenceLock!;
    expect(l).toMatchObject({ kind: 'parallel', source: 'api' });
    // 원호를 따라 커서 쪽(진행 방향)
    expect(dot(l.direction, T)).toBeCloseTo(1, 9);
    expect(lock.snapshot()).toMatchObject({ lock: 'tangent', hoverLock: null, tip: '접선 방향 · 잠금' });
    expect(w.hint()).toBe(LOCK_HINTS.tangent);
    // 잠근 채 접선 가까이에 찍는다 — 둘째 점은 첫 점을 지나는 접선 위
    w.click([a.point[0] + 12 * T[0]!, a.point[1] + 12 * T[1]! + 0.6, 0]);
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: null, snapB: 'parallel', lockedB: true });
    onLine(m.a, T, m.b);
    expect(lock.tangentResult(m)).toBe(true);
    w.shiftUp();
  });

  it('커서가 원호 뒤쪽이면 반대 방향(같은 선) — 휴대폰 잠금 단추·↓, 원호 밖 빈 곳은 코어 판정', () => {
    const w = setup(true);
    const { v, lock } = w;
    w.click(CHORD, 'touch');
    const a = v.measurePoints[0]!.point;
    const T = tangentOf(a);
    // 원호 시작 쪽(첫 점 뒤)
    w.hover(movePointAt(nc, ARC, 0.05)!, 'pen');
    expect(lock.hoverLock).toBe('tangent');
    w.press();
    expect(dot(v.measureInferenceLock!.direction, T)).toBeCloseTo(-1, 9);
    expect(lock.snapshot()).toMatchObject({ lock: 'tangent', flash: null });
    w.press();
    expect(v.measureInferenceLock).toBeNull();
    // 원호 끝 (40,40)도 원호 위 — 앞쪽
    w.hover(B, 'pen');
    lock.arrow(null);
    expect(dot(v.measureInferenceLock!.direction, T)).toBeCloseTo(1, 9);
    lock.arrow(null);
    // 첫 점에서 아래로(빈 곳 — Y축 방향 추론): 원호 위가 아니므로 코어 판정
    w.hover([a[0], a[1] - 8, 0], 'pen');
    expect(lock.snapshot()).toMatchObject({ tip: 'Y축 방향', hoverLock: 'y' });
  });

  it('현의 끝(코어 끝점 붙잡기 — 원호 끝·가운데 점이 아님)도 그 자리의 접선', () => {
    const w = setup();
    const { v, lock } = w;
    const v6 = movePointAt(nc, ARC, 6 / 18)!;
    w.click(v6);
    expect(v.measurePoints[0]).toMatchObject({ snap: 'endpoint' });
    w.hover(movePointAt(nc, ARC, 0.85)!);
    expect(lock.hoverLock).toBe('tangent');
    lock.arrow(null);
    expect(dot(v.measureInferenceLock!.direction, arcTangentAtF(nc, ARC, 6 / 18)!)).toBeCloseTo(1, 6);
    expect(lock.lock).toBe('tangent');
  });
});

describe('판재 윤곽 호의 접선 방향 잠금(15차, 실제 코어 판정)', () => {
  // 판 300×200×19, 윤곽 가공: (20,20) → 직선 (80,20) → 반시계 호 R20(중심 (80,40)) (100,40) → 직선 (100,80)
  const MPR = [
    '[H',
    'VERSION="4.0 Alpha"',
    '_BSX=300.000000',
    '_BSY=200.000000',
    '_BSZ=19.000000',
    '',
    ']1',
    '$E0',
    'KP',
    'X=20',
    'Y=20',
    'Z=19',
    '',
    '$E1',
    'KL',
    'X=80',
    'Y=20',
    '',
    '$E2',
    'KA',
    'X=100',
    'Y=40',
    'DS=1',
    'R=20',
    '',
    '$E3',
    'KL',
    'X=100',
    'Y=80',
    '',
    '<100 \\WerkStck\\',
    'LA="300"',
    'BR="200"',
    'DI="19"',
    '',
    '<105 \\Konturfraesen\\',
    'EA="1:0"',
    'EE="1:3"',
    'TNO="101"',
    'ZA="5"',
    '!',
    '',
  ].join('\n');
  const r = parseForView('tan.mpr', new TextEncoder().encode(MPR));
  const panel = r.mpr!.snap!;
  const src: Src = { panel, scene: r.scene };
  const route = r.scene.lines.find((l) => /^mpr-op-/.test(l.id))!;
  const z = route.positions[2]!;
  const at = (deg: number): number[] => [80 + 20 * Math.cos((deg * Math.PI) / 180), 40 + 20 * Math.sin((deg * Math.PI) / 180), z];
  /** 반시계 원호 위 deg 자리의 진행 방향 */
  const fwd = (deg: number): number[] => [-Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), 0];

  it('호의 시작(끝점)에서 Shift는 호 쪽 접선(+X)으로 — 직선을 따라 가리키면 코어 판정(X축)', () => {
    const w = setup(false, src);
    const { v, lock } = w;
    w.click([80, 20, z]);
    expect(v.measurePoints[0]).toMatchObject({ snap: 'endpoint' });
    w.hover(at(-45));
    expect(v.measureHoverSnap).toMatchObject({ snap: 'midpoint' });
    expect(lock.hoverLock).toBe('tangent');
    w.shiftDown();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'parallel', source: 'api' });
    expect(dot(v.measureInferenceLock!.direction, [1, 0, 0])).toBeCloseTo(1, 9);
    expect(lock.snapshot()).toMatchObject({ lock: 'tangent' });
    w.shiftUp();
    // 앞 직선의 다른 끝 (20,20): 코어가 그 모서리 방향(X축)
    w.hover([20, 20, z]);
    expect(lock.hoverLock).toBe('x');
  });

  it('호의 가운데 점(앱 붙잡기)과 현 위의 첫 점: 커서 쪽 접선 — 휴대폰 잠금 단추, 결과 이름은 접선 방향', () => {
    const w = setup(true, src);
    const { v, lock } = w;
    w.click(at(-45), 'touch');
    expect(v.measurePoints[0]).toMatchObject({ snap: 'midpoint' });
    w.hover(at(-15), 'pen');
    expect(lock.hoverLock).toBe('tangent');
    w.press();
    expect(dot(v.measureInferenceLock!.direction, fwd(-45))).toBeCloseTo(1, 9);
    w.click([at(-45)[0]! + 10 * Math.SQRT1_2, at(-45)[1]! + 10 * Math.SQRT1_2 + 0.5, z], 'touch');
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: 'midpoint', snapB: 'parallel', lockedB: true });
    expect(lock.tangentResult(m)).toBe(true);
    // 새 첫 점: 둘째 현의 가운데(−82.5° 둘레, 호에서 처짐만큼 안쪽 — 모서리 붙잡기). 판 전체로는 현이 짧아(5화소 안팎) 호 둘레로 확대한다
    const p0 = w.at([74, 16, z]);
    const p1 = w.at([102, 44, z]);
    v.zoomToRect(p0.x, p1.y, p1.x, p0.y, false);
    v.renderNow();
    const c0 = at(-85);
    const c1 = at(-80);
    w.click([(c0[0]! + c1[0]!) / 2, (c0[1]! + c1[1]!) / 2, z], 'touch');
    expect(v.measurePoints).toHaveLength(1);
    const a = v.measurePoints[0]!;
    expect(a.snap).toBeNull();
    const deg = (Math.atan2(a.point[1] - 40, a.point[0] - 80) * 180) / Math.PI;
    expect(deg).toBeCloseTo(-82.5, 0);
    // 커서가 호 뒤쪽(시작 끝)이면 진행 반대
    w.hover([80, 20, z], 'pen');
    expect(lock.hoverLock).toBe('tangent');
    w.press();
    expect(dot(v.measureInferenceLock!.direction, fwd(deg))).toBeCloseTo(-1, 9);
    expect(lock.snapshot()).toMatchObject({ lock: 'tangent', tip: expect.stringContaining('접선 방향') });
  });
});
