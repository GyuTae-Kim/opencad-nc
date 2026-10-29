// @vitest-environment jsdom
/**
 * 잠근 선과 모서리·면의 교차(21차 — 3D 뷰어 코어 0.19.0 inference.lockEdges·lockFaces)를 실제 코어 판정으로:
 * 해석기가 읽은 합성 G-code·Heidenhain 장면을 진짜 Viewer3d에 올리고 앱과 같은 붙잡기 선택(refine.ts ncSnapOptions)과 앱의 잠금(MeasureLock)으로
 * - 잠근 X축이 기운 직선 경로와 만나는 점: 커서 쪽 잠근 선 위 점이 아니라 교차점(남은 좌표가 첫 점 그대로) — '잠근 X축 · 모서리 위'(툴팁에 "잠금"을 다시 붙이지 않는다)
 * - 잠근 X축이 원호를 나눈 현과 만나는 점: 0.18.0 'axisEdge' 다듬기가 그대로 불려 원 위 — 결과 이름과 거리도
 * - 원호 위를 미리 본 뒤 Shift로 그 축에 잠가도 점이 같은 자리에 남는다
 * - 잠근 Z축이 공작물(BLK FORM) 윗면을 뚫는 점: '잠근 Z축 · 면 위', 거리는 높이 그대로
 * - 원호 접선으로 잠근 선이 직선 경로와 만나는 점: '잠근 접선 방향 · 모서리 위'
 * - 새 선택을 끈 붙잡기와 잠그지 않은 미리 보기·잠근 선 위 교차가 없는 자리가 같다(0.18.0과 같은 값)
 * 커서는 선 끝·경로·면 경계를 정확히 가리키지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { MEASURE_INFERENCE, lockMeet, snapLabel, snapPair, trackMark, trackMarks } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters, movePointAt } from '../../src/app/snap';
import { ncSnapOptions } from '../../src/app/refine';
import { ArcTangents } from '../../src/app/tangent';
import { MOVE_ARC } from '../../src/model';
import { catalogs, translate } from '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// 1/4 원(중심 (20,20), R = 20√2 — 135°에서 45°로 위를 지남) → (60,40) → 첫 점 (60,45) → 급속 (100,60) → 기운 직선 (120,20)
const ARC = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G1 X60 Y45', 'G0 X100 Y60', 'G1 X120 Y20'].join('\n');
// y = 45가 원과 만나는 x = 20 + √175(62.1°), 기운 직선과 만나는 x = 107.5
const XA = 20 + Math.sqrt(175);
// 공작물 100 × 100 × 20(윗면 Z 0), 그 위 Z 30의 경로 — 첫 점 (50,50,30)
const BLK = ['0 BEGIN PGM T MM', '1 BLK FORM 0.1 Z X+0 Y+0 Z-20', '2 BLK FORM 0.2 X+100 Y+100 Z+0', '3 L X+150 Y+50 Z+30 R0 FMAX', '4 L X+50 Y+50 Z+30 F500', '5 END PGM T MM'].join('\n');
// 세로 직선 x = 30(y 80 → 48) 뒤 시계 방향 1/4 원 (0,40) → (40,40)(중심 (20,20)) → (60,40). 끝 (40,40)에서 원호 쪽 접선 (−1, 1)은 x = 30에서 y = 50
const TAN = ['G21 G90 G17', 'G0 X30 Y80 Z0', 'G1 X30 Y48 F500', 'G0 X0 Y40', 'G2 X40 Y40 I20 J-20', 'G1 X60 Y40'].join('\n');

function setup(name: string, text: string, view: 'top' | 'seIso' = 'top', tweak: (o: MeasureSnapOptions) => MeasureSnapOptions = (o) => o) {
  const r = parseForView(name, enc(text));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView(view, false);
  v.fit(false);
  v.setMeasureMode(true);
  const angle = (r.scene.meta as { arcAngle?: number }).arcAngle;
  // 앱(app.ts syncMeasureSnap)과 같은 붙잡기 선택, 앱(ensureMeasureTools)과 같은 원호 접선
  v.setMeasureSnap(tweak(ncSnapOptions(r.nc!, arcCenters(r.nc!), null, angle)));
  v.renderNow();
  const tangents = new ArcTangents();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn(), arcTangent: (a, p) => tangents.at(r.nc!, a, p, angle) });
  const ptr = (type: string, p: readonly number[], shift = false): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, shiftKey: shift });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  /** shift = Shift를 누른 채(코어는 포인터 사건의 shiftKey가 없으면 Shift 잠금을 푼다) */
  const hover = (p: readonly number[], shift = false): void => {
    ptr('pointermove', p, shift);
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
  /** 앱 onKey가 넘기는 길(handleKey) — 코어가 커서 아래 잠글 방향으로 잠근다 */
  const shiftDown = (): void => {
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
  return { v, r, lock, hover, click, shiftDown, zoomTo };
}

describe('잠근 축과 경로의 교차(코어 0.19.0 lockEdges, 실제 코어 판정)', () => {
  it('곧은 경로: 잠근 X축 위 커서 쪽 점이 아니라 기운 직선과 만나는 점 — "잠근 X축 · 모서리 위", 결과에 잠금을 다시 붙이지 않는다', () => {
    const w = setup('a.nc', ARC);
    const { v, lock } = w;
    w.click([60.2, 45.1, 0]);
    expect(v.measurePoints[0]).toMatchObject({ point: [60, 45, 0], snap: 'endpoint' });
    lock.arrow('x');
    expect(v.measureInferenceLock).toMatchObject({ kind: 'axis', axis: 'x' });
    w.hover([107.7, 45.3, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', locked: true, segment: { kind: 'line' } });
    expect(h.from).toBeUndefined();
    expect(h.refined).toBeFalsy();
    expect(h.point[0]).toBeCloseTo(107.5, 9);
    expect(h.point[1]).toBe(45);
    expect(h.point[2]).toBe(0);
    expect(trackMark(h)).toBe('lockEdge');
    expect(lock.snapshot().tip).toBe('잠근 X축 · 모서리 위');
    w.click([107.7, 45.3, 0]);
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: 'endpoint', snapB: 'axis', axisB: 'x', lockedB: true });
    expect(m.distance).toBeCloseTo(47.5, 9);
    expect(trackMarks(v.measurePoints)).toEqual({ trackB: 'lockEdge' });
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', '잠근 X축 · 모서리 위', false]);
  });

  it('원호: 잠근 X축이 현과 만나는 점도 0.18.0 다듬기로 원 위(refined, y·z가 첫 점 그대로)', () => {
    const w = setup('a.nc', ARC);
    const { v, lock } = w;
    w.click([60.2, 45.1, 0]);
    lock.arrow('x');
    w.zoomTo([29, 41], [37, 49]);
    w.hover([XA + 0.03, 45.04, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', locked: true, refined: true, segment: { kind: 'line' } });
    expect(h.point[1]).toBe(45);
    expect(h.point[2]).toBe(0);
    expect(Math.abs(h.point[0] - XA)).toBeLessThan(1e-9);
    expect(lock.snapshot().tip).toBe('잠근 X축 · 모서리 위');
    w.click([XA + 0.03, 45.04, 0]);
    const m = v.measurement()!;
    expect(Math.abs(m.distance - (60 - XA))).toBeLessThan(1e-9);
    expect(v.measurePoints[1]!.refined).toBe(true);
  });

  it('원호 위 교차를 미리 본 뒤 Shift로 그 축에 잠가도 점이 같은 자리(코어가 다듬기를 다시 부르지 않는다)', () => {
    const w = setup('a.nc', ARC);
    const { v, lock } = w;
    w.click([60.2, 45.1, 0]);
    w.zoomTo([29, 41], [37, 49]);
    w.hover([XA + 0.03, 45.04, 0]);
    const before = v.measureHoverSnap!;
    expect(before).toMatchObject({ snap: 'axis', axis: 'x', refined: true });
    expect(trackMark(before)).toBe('axisEdge');
    w.shiftDown();
    expect(v.measureInferenceLock).toMatchObject({ kind: 'axis', axis: 'x', source: 'shift' });
    w.hover([XA + 0.03, 45.04, 0], true);
    const after = v.measureHoverSnap!;
    expect(after).toMatchObject({ snap: 'axis', axis: 'x', locked: true, refined: true });
    expect(after.point).toEqual(before.point);
    expect(lock.snapshot().tip).toBe('잠근 X축 · 모서리 위');
  });

  it('원호 접선으로 잠근 선이 세로 경로와 만나는 점: "잠근 접선 방향 · 모서리 위"', () => {
    const w = setup('t.nc', TAN);
    const { v, r, lock } = w;
    w.click([40.2, 40.1, 0]);
    expect(v.measurePoints[0]).toMatchObject({ point: [40, 40, 0], snap: 'endpoint' });
    const arc = [...r.nc!.moves.kind].indexOf(MOVE_ARC);
    // 원호 가운데 점을 가리켜 잠금 단추(앱 판정 — 원호 접선)
    w.hover(movePointAt(r.nc!, arc, 0.5)!);
    expect(lock.hoverLock).toBe('tangent');
    expect(lock.toggle()).toBe(true);
    expect(lock.lock).toBe('tangent');
    w.zoomTo([26, 46], [34, 54]);
    w.hover([30.05, 50.12, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'parallel', locked: true, segment: { kind: 'line' } });
    expect(Math.abs(h.point[0] - 30)).toBeLessThan(1e-9);
    expect(Math.abs(h.point[1] - 50)).toBeLessThan(1e-9);
    expect(trackMark(h)).toBe('lockEdge');
    expect(lock.snapshot().tip).toBe('잠근 접선 방향 · 모서리 위');
    w.click([30.05, 50.12, 0]);
    const m = v.measurement()!;
    expect(lock.tangentResult(m)).toBe(true);
    expect(Math.abs(m.distance - 10 * Math.SQRT2)).toBeLessThan(1e-9);
    expect(snapPair({ ...m, tangentB: true, ...trackMarks(v.measurePoints) })).toEqual(['끝점', '잠근 접선 방향 · 모서리 위', false]);
  });
});

describe('잠근 축이 면을 뚫는 점(코어 0.19.0 lockFaces, 실제 코어 판정)', () => {
  it('잠근 Z축이 공작물 윗면을 뚫는 점: "잠근 Z축 · 면 위"(face — 공작물 그물), 거리는 높이 30', () => {
    const w = setup('t.h', BLK, 'seIso');
    const { v, lock } = w;
    w.click([50.1, 50.1, 30]);
    lock.arrow('z');
    w.hover([50.4, 50.3, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'z', locked: true, face: { id: 'nc-stock' } });
    expect(h.point).toEqual([50, 50, 0]);
    expect(trackMark(h)).toBe('lockFace');
    expect(lock.snapshot().tip).toBe('잠근 Z축 · 면 위');
    w.click([50.4, 50.3, 0]);
    const m = v.measurement()!;
    expect(m.distance).toBe(30);
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', '잠근 Z축 · 면 위', false]);
  });
});

describe('새 선택을 끈 붙잡기와 같은 자리(0.18.0과 같은 값)', () => {
  const off = (o: MeasureSnapOptions): MeasureSnapOptions => ({ ...o, inference: { ...MEASURE_INFERENCE, lockEdges: false, lockFaces: false } });
  const view = (h: Viewer3d['measureHoverSnap']) =>
    h && { snap: h.snap, point: h.point, axis: h.axis ?? null, refined: !!h.refined, segment: h.segment ?? null, face: h.face ?? null, locked: !!h.locked, direction: h.direction ?? null };

  it('잠그지 않은 미리 보기(첫 점 전·뒤)와 잠근 선 위 교차가 없는 자리는 같고, 교차가 있는 자리만 교차점으로 바뀐다', () => {
    const before = [[60.2, 45.1, 0], [107.7, 45.3, 0], [XA + 0.03, 45.02, 0], [20.3, 48.1, 0], [10, 10, 0]];
    const after = [[90, 45.2, 0], [40.1, 40.1, 0], [107.7, 45.3, 0], [XA + 0.03, 45.02, 0], [119.8, 20.3, 0]];
    const locked = [[90, 45.2, 0], [80, 44, 0], [115, 47, 0]];
    const seen: unknown[][] = [[], []];
    const meet: unknown[] = [];
    [setup('a.nc', ARC), setup('a.nc', ARC, 'top', off)].forEach((w, k) => {
      for (const p of before) {
        w.hover(p);
        seen[k]!.push(view(w.v.measureHoverSnap));
      }
      w.click([60.2, 45.1, 0]);
      for (const p of after) {
        w.hover(p);
        seen[k]!.push(view(w.v.measureHoverSnap));
      }
      w.lock.arrow('x');
      for (const p of locked) {
        w.hover(p);
        seen[k]!.push(view(w.v.measureHoverSnap));
      }
      w.hover([107.7, 45.3, 0]);
      meet.push(w.v.measureHoverSnap!.point);
    });
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0]!.filter(Boolean).length).toBeGreaterThan(8);
    // 켠 쪽은 기운 직선과 만나는 점, 끈 쪽은 커서에 가까운 잠근 선 위 점(0.18.0)
    expect((meet[0] as number[])[0]).toBeCloseTo(107.5, 9);
    expect(Math.abs((meet[1] as number[])[0]! - 107.5)).toBeGreaterThan(0.05);
  });

  it('새 이름 14개(잠근 X·Y·Z축, 나란한·수직·접선·모르는 방향 × 모서리 위·면 위)가 다섯 언어 사전에 있다', () => {
    const labels: string[] = [];
    for (const t of ['lockEdge', 'lockFace'] as const) {
      for (const a of ['x', 'y', 'z'] as const) labels.push(snapLabel('axis', a, t));
      labels.push(snapLabel('parallel', null, t), snapLabel('perpendicular', null, t), snapLabel('vertex', null, t));
      labels.push(snapPair({ snapA: 'endpoint', snapB: 'parallel', lockedB: true, tangentB: true, trackB: t })![1]);
    }
    expect(new Set(labels).size).toBe(14);
    expect(labels).toContain('잠근 Y축 · 면 위');
    expect(labels).toContain('잠근 나란한 방향 · 모서리 위');
    expect(labels).toContain('잠근 수직 방향 · 면 위');
    expect(labels).toContain('잠근 접선 방향 · 면 위');
    expect(labels).toContain('잠근 방향 · 모서리 위');
    for (const code of ['en', 'ja', 'zh-CN', 'de'])
      for (const l of labels) {
        expect(catalogs[code]![l], `${code}: ${l}`).toBeTruthy();
        expect(translate(l, code), `${code}: ${l}`).not.toMatch(/[가-힣]/);
      }
    expect(translate('잠근 X축 · 모서리 위', 'en')).toBe('Locked X axis · On edge');
    expect(translate('잠근 Z축 · 면 위', 'de')).toBe('Gesperrte Z-Achse · Auf Fläche');
    // 가르는 법: 잠근 선 위 점(locked)에 선분·면이 있으면 교차, 점 붙잡기를 옮겨 온 자리(from — 선분·면 없음)·끌어온 축은 아니다
    expect(trackMark({ snap: 'axis', locked: true, segment: {}, direction: [1, 0, 0] })).toBe('lockEdge');
    expect(trackMark({ snap: 'parallel', locked: true, face: {}, direction: [1, 1, 0] })).toBe('lockFace');
    expect(trackMark({ snap: 'axis', locked: true, direction: [1, 0, 0] })).toBe(false);
    expect(trackMark({ snap: 'axis', locked: true, trackFrom: [0, 0, 0], segment: {} })).toBe('edge');
    expect(lockMeet('axisEdge')).toBe(false);
    // 잠근 선 위 점이 교차가 아니면 결과에 잠금 그대로
    expect(snapPair({ snapA: 'endpoint', snapB: 'axis', axisB: 'x', lockedB: true })).toEqual(['끝점', 'X축 방향', true]);
  });
});
