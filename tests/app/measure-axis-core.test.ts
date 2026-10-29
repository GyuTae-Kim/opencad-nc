// @vitest-environment jsdom
/**
 * 첫 점 축과 모서리·면의 교차, 축 교차 점 다듬기(20차 — 3D 뷰어 코어 0.18.0 inference.axisEdges·axisFaces, refine 'axisEdge')를 실제 코어 판정으로:
 * 해석기가 읽은 합성 G-code·Heidenhain 장면을 진짜 Viewer3d에 올리고 앱과 같은 붙잡기 선택(refine.ts ncSnapOptions)을 주어
 * - 첫 점 X축이 기운 직선 경로와 만나는 점은 'X축 · 모서리 위'(trackFrom 없이 segment) — 다듬지 않는다(곧은 이동)
 * - 첫 점 X축이 원호를 나눈 현과 만나는 점은 원 위 정확한 교차점(refined, 남은 좌표가 첫 점 그대로), 결과 이름과 거리도
 * - 끌어온 축이 원호와 만나는 점(19차 남은 일)도 원 위 — '끌어온 점에서 X축 · 모서리 위'
 * - 첫 점 Z축이 공작물(BLK FORM) 윗면을 뚫는 점은 'Z축 · 면 위'(face), 잰 거리가 높이 그대로
 * - 새 선택을 끈 붙잡기와 첫 점 전·새 후보가 없는 자리의 미리 보기가 같다(0.17.0과 같은 값)
 * 머무르기는 코어의 setTimeout(0.5초)이라 횟수가 아니라 시간(0.7초)으로 기다린다. 커서는 선 끝·경로·면 경계를 정확히 가리키지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions } from 'opencad-viewer3d';
import { parseForView } from '../../src/app/payload';
import { MEASURE_INFERENCE, snapLabel, snapPair, trackMark, trackMarks } from '../../src/app/measure';
import { MeasureLock } from '../../src/app/measure-lock';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions } from '../../src/app/refine';
import { catalogs, translate } from '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 1/4 원(중심 (20,20), R = 20√2 — 135°에서 45°로 위를 지남) → (60,40) → 첫 점 (60,45) → 급속 (100,60) → 기운 직선 (120,20)
const ARC = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G1 X60 Y45', 'G0 X100 Y60', 'G1 X120 Y20'].join('\n');
// y = 45가 원과 만나는 x = 20 + √175(62.1°), 기운 직선과 만나는 x = 107.5
const XA = 20 + Math.sqrt(175);
// 공작물 100 × 100 × 20(윗면 Z 0), 그 위 Z 30의 경로 — 첫 점 (50,50,30)
const BLK = ['0 BEGIN PGM T MM', '1 BLK FORM 0.1 Z X+0 Y+0 Z-20', '2 BLK FORM 0.2 X+100 Y+100 Z+0', '3 L X+150 Y+50 Z+30 R0 FMAX', '4 L X+50 Y+50 Z+30 F500', '5 END PGM T MM'].join('\n');

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
  // 앱(app.ts syncMeasureSnap)과 같은 붙잡기 선택
  v.setMeasureSnap(tweak(ncSnapOptions(r.nc!, arcCenters(r.nc!), null, angle)));
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
  const dwell = async (p: readonly number[]): Promise<void> => {
    hover(p);
    await wait(700);
    v.renderNow();
  };
  /** 세계 사각형(XY 두 구석)을 화면에 채운다 */
  const zoomTo = (lo: readonly number[], hi: readonly number[], z = 0): void => {
    const a = v.project([lo[0]!, lo[1]!, z])!;
    const b = v.project([hi[0]!, hi[1]!, z])!;
    v.zoomToRect(a.x, b.y, b.x, a.y, false);
    v.renderNow();
  };
  return { v, lock, hover, click, dwell, zoomTo };
}

describe('첫 점 축과 경로의 교차(코어 0.18.0 axisEdges, 실제 코어 판정)', () => {
  it('곧은 경로: "X축 · 모서리 위"(첫 점 축 — direction, 그 선분 식별자, 다듬지 않음)', () => {
    const w = setup('a.nc', ARC);
    const { v, lock } = w;
    w.click([60.2, 45.1, 0]);
    expect(v.measurePoints[0]).toMatchObject({ point: [60, 45, 0], snap: 'endpoint' });
    w.hover([107.7, 45.3, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', direction: [1, 0, 0], segment: { kind: 'line' } });
    expect(h.trackFrom).toBeUndefined();
    expect(h.refined).toBeFalsy();
    expect(h.point[0]).toBeCloseTo(107.5, 9);
    expect(h.point[1]).toBe(45);
    expect(trackMark(h)).toBe('axisEdge');
    expect(lock.snapshot().tip).toBe('X축 · 모서리 위');
    // Shift가 잠글 방향은 그 축
    expect(v.measureHoverLock).toMatchObject({ kind: 'axis', axis: 'x' });
  });

  it('원호: 현이 아니라 원 위 정확한 교차점(refined, y·z가 첫 점 그대로) — 결과 이름과 거리도', () => {
    const w = setup('a.nc', ARC);
    const { v, lock } = w;
    w.click([60.2, 45.1, 0]);
    w.zoomTo([29, 41], [37, 49]);
    w.hover([XA + 0.03, 45.02, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', direction: [1, 0, 0], refined: true, segment: { kind: 'line' } });
    expect(h.point[1]).toBe(45);
    expect(h.point[2]).toBe(0);
    expect(Math.abs(h.point[0] - XA)).toBeLessThan(1e-9);
    expect(Math.abs(Math.hypot(h.point[0] - 20, h.point[1] - 20) - 20 * Math.SQRT2)).toBeLessThan(1e-9);
    expect(lock.snapshot().tip).toBe('X축 · 모서리 위');
    w.click([XA + 0.03, 45.02, 0]);
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: 'endpoint', snapB: 'axis', axisB: 'x' });
    expect(Math.abs(m.distance - (60 - XA))).toBeLessThan(1e-9);
    expect(m.dy).toBe(0);
    expect(v.measurePoints[1]!.refined).toBe(true);
    expect(trackMarks(v.measurePoints)).toEqual({ trackB: 'axisEdge' });
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', 'X축 · 모서리 위', false]);
  });

  it('끌어온 축과 원호의 교차(19차 남은 일): 첫 점 전에도 원 위 — "끌어온 점에서 X축 · 모서리 위"', async () => {
    const w = setup('a.nc', ARC);
    const { v, lock } = w;
    await w.dwell([60.2, 45.1, 0]);
    expect(v.measureTrackPoints).toEqual([[60, 45, 0]]);
    w.zoomTo([29, 41], [37, 49]);
    w.hover([XA + 0.03, 45.02, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', trackFrom: [60, 45, 0], refined: true, segment: { kind: 'line' } });
    expect(h.point[1]).toBe(45);
    expect(Math.abs(h.point[0] - XA)).toBeLessThan(1e-9);
    expect(trackMark(h)).toBe('edge');
    expect(lock.snapshot().tip).toBe('끌어온 점에서 X축 · 모서리 위');
  });
});

describe('축이 면을 뚫는 점(코어 0.18.0 axisFaces, 실제 코어 판정)', () => {
  it('첫 점 Z축이 공작물 윗면을 뚫는 점: "Z축 · 면 위"(face — 공작물 그물), 거리는 높이 30', () => {
    const w = setup('t.h', BLK, 'seIso');
    const { v, lock } = w;
    w.click([50.1, 50.1, 30]);
    expect(v.measurePoints[0]).toMatchObject({ point: [50, 50, 30], snap: 'endpoint' });
    w.hover([50.4, 50.3, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'z', face: { id: 'nc-stock' } });
    expect(h.direction).toBeTruthy();
    expect(h.point).toEqual([50, 50, 0]);
    expect(trackMark(h)).toBe('axisFace');
    expect(lock.snapshot().tip).toBe('Z축 · 면 위');
    w.click([50.4, 50.3, 0]);
    const m = v.measurement()!;
    expect(m.distance).toBe(30);
    expect(trackMarks(v.measurePoints)).toEqual({ trackB: 'axisFace' });
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', 'Z축 · 면 위', false]);
  });
});

describe('새 선택을 끈 붙잡기와 같은 자리(0.17.0과 같은 값)', () => {
  const off = (o: MeasureSnapOptions): MeasureSnapOptions => ({ ...o, inference: { ...MEASURE_INFERENCE, axisEdges: false, axisFaces: false } });
  const view = (h: Viewer3d['measureHoverSnap']) => h && { snap: h.snap, point: h.point, axis: h.axis ?? null, refined: !!h.refined, segment: h.segment ?? null, direction: h.direction ?? null };

  it('첫 점 전, 그리고 첫 점 뒤 교차가 없는 자리(축 방향·끝점·원호 위)는 미리 보기가 같다', () => {
    const before = [[60.2, 45.1, 0], [107.7, 45.3, 0], [XA + 0.03, 45.02, 0], [20.3, 48.1, 0], [10, 10, 0]];
    const after = [[90, 45.2, 0], [40.1, 40.1, 0], [20.3, 48.1, 0], [119.8, 20.3, 0]];
    const seen: unknown[][] = [[], []];
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
    });
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0]!.filter(Boolean).length).toBeGreaterThan(5);
  });

  it('새 이름 9개(첫 점 축 · 모서리 위·면 위, 끌어온 점에서 · 면 위)가 다섯 언어 사전에 있다', () => {
    const labels: string[] = [];
    for (const a of ['x', 'y', 'z'] as const) for (const t of ['axisEdge', 'axisFace', 'face'] as const) labels.push(snapLabel('axis', a, t));
    expect(labels).toHaveLength(9);
    expect(labels).toContain('Y축 · 모서리 위');
    expect(labels).toContain('Z축 · 면 위');
    expect(labels).toContain('끌어온 점에서 X축 · 면 위');
    for (const code of ['en', 'ja', 'zh-CN', 'de'])
      for (const l of labels) {
        expect(catalogs[code]![l], `${code}: ${l}`).toBeTruthy();
        expect(translate(l, code), `${code}: ${l}`).not.toMatch(/[가-힣]/);
      }
    expect(translate('X축 · 모서리 위', 'en')).toBe('On X axis · On edge');
    expect(translate('끌어온 점에서 Z축 · 면 위', 'de')).toBe('Z-Achse vom gemerkten Punkt · Auf Fläche');
    // 가르는 법: 끌어온 점이 없는 축 붙잡기만 첫 점 축 · 모서리 위·면 위(끝점 같은 다른 종류의 선분 식별자는 아니다)
    expect(trackMark({ snap: 'endpoint', segment: {} })).toBe(false);
    expect(trackMark({ snap: 'axis', segment: {}, direction: [1, 0, 0] })).toBe('axisEdge');
    expect(trackMark({ snap: 'axis', face: {}, direction: [0, 0, 1] })).toBe('axisFace');
    expect(trackMark({ snap: 'axis', trackFrom: [0, 0, 0], face: {} })).toBe('face');
    expect(trackMark({ snap: 'axis', direction: [1, 0, 0] })).toBe(false);
  });
});
