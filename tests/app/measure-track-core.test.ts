// @vitest-environment jsdom
/**
 * 다른 점에서 끌어온 축(18차 — 3D 뷰어 코어 0.16.0 inference.track)을 실제 코어 판정으로: 앱의 추론 붙잡기(MEASURE_INFERENCE)가 track을 켜면
 * - 마우스가 점 붙잡기 위에 0.5초 머문 점을 기억하고, 첫 점 X축 위에서 그 점과 나란한 자리는 'X축 방향'(첫 점에서 그 축 — 잠글 수 있다),
 *   그 점을 지나는 축 위는 '끌어온 점에서 Y축'(툴팁·결과 이름)
 * - 조준 십자선(펜 포인터)도 머물면 기억하고, 손가락(touch) 포인터는 머무르지 않는다(길게 누르기는 앱의 정밀 조준)
 * - Esc는 첫 점 전에도 기억한 점부터 지운다
 * 19차(코어 0.17.0): 끌어온 두 점의 서로 다른 축이 만나는 점은 '끌어온 Y축과 X축의 교차'(trackOther — 첫 점 전에도),
 * 끌어온 축이 경로 선분과 만나는 점은 '끌어온 점에서 X축 · 모서리 위'(trackFrom과 segment) — 툴팁·결과 이름과 다섯 언어 사전
 * 머무르기는 코어의 setTimeout(0.5초)이라 횟수가 아니라 시간(0.7초)으로 기다린다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type Scene3d } from 'opencad-viewer3d';
import { MEASURE_INFERENCE, snapLabel, snapPair, trackMark, trackMarks } from '../../src/app/measure';
import { MeasureLock, snapTip } from '../../src/app/measure-lock';
import { catalogs, translate } from '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

// 위에서 본 두 선분: (0,0) → (40,0), (60,30) → (80,30)
const scene: Scene3d = { name: 'track', units: 'mm', meshes: [], lines: [{ id: 'path', positions: new Float32Array([0, 0, 0, 40, 0, 0, 60, 30, 0, 80, 30, 0]) }], points: [] };
const P = [60, 30, 0];
/** 머물거나 찍을 커서 자리(끝점에서 조금 비켜 — 선 끝을 정확히 가리키지 않는다. 끝점 붙잡기 거리 안이라 그 끝점에 붙는다) */
const nearP = [60.2, 30.1, 0];
const nearA = [0.2, 0.1, 0];
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// 0.17.0: 위 두 선분에 세로 선분 (100,−20) → (100,40)을 더한 장면 — P의 X축(y = 30)이 (100,30)에서 이 선분과 만난다
const scene17: Scene3d = { ...scene, lines: [{ id: 'path', positions: new Float32Array([0, 0, 0, 40, 0, 0, 60, 30, 0, 80, 30, 0, 100, -20, 0, 100, 40, 0]) }] };

function setup(sc: Scene3d = scene) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(sc);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  v.setMeasureSnap({ midpoints: true, inference: MEASURE_INFERENCE });
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const ptr = (type: string, p: readonly number[], pointerType = 'mouse'): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[], pointerType = 'mouse'): void => {
    ptr('pointermove', p, pointerType);
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
  /** 점 위에 머문다(코어 머무르기 0.5초를 시간으로 넘긴다) */
  const dwell = async (p: readonly number[], pointerType = 'mouse'): Promise<void> => {
    hover(p, pointerType);
    await wait(700);
    v.renderNow();
  };
  return { v, lock, hover, click, dwell };
}

describe('다른 점에서 끌어온 축(실제 코어 판정)', () => {
  it('앱 추론 붙잡기에 track이 켜져 있다(기본 머무르기 0.5초)', () => {
    expect(MEASURE_INFERENCE.track).toBe(true);
    const { v } = setup();
    expect(v.measureSnap?.inference).toMatchObject({ track: { dwellMs: 500 } });
  });

  it('머문 점을 기억하고 첫 점 X축 위 나란한 자리는 X축 방향, 그 점의 Y축 위는 끌어온 점에서 Y축 — 결과 이름도', async () => {
    const w = setup();
    const { v, lock } = w;
    await w.dwell(nearP);
    expect(v.measureTrackPoints).toEqual([P]);
    w.click(nearA);
    expect(v.measurePointCount).toBe(1);
    expect(v.measurePoints[0]!.point).toEqual([0, 0, 0]);
    // 첫 점에서는 기억한 점이 남는다
    expect(v.measureTrackPoints).toEqual([P]);
    w.hover([60, 0.4, 0]);
    expect(v.measureHoverSnap).toMatchObject({ snap: 'axis', axis: 'x', direction: [1, 0, 0], trackFrom: P });
    expect(lock.snapshot().tip).toBe('X축 방향');
    w.hover([60.5, 15, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'y', trackFrom: P });
    expect(h.direction).toBeUndefined();
    expect(h.point[0]).toBeCloseTo(60, 4);
    expect(lock.snapshot().tip).toBe('끌어온 점에서 Y축');
    w.click([60.5, 15, 0]);
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: 'endpoint', snapB: 'axis', axisB: 'y' });
    expect(trackMarks(v.measurePoints)).toEqual({ trackB: true });
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', '끌어온 점에서 Y축', false]);
    // 두 점째를 찍으면 잊는다
    expect(v.measureTrackPoints).toEqual([]);
  });

  it('조준 십자선(펜)도 머물면 기억하고, 손가락은 머무르지 않는다. Esc는 첫 점 전에도 기억한 점부터 지운다', async () => {
    const t = setup();
    await t.dwell(nearP, 'touch');
    expect(t.v.measureTrackPoints).toEqual([]);
    const w = setup();
    await w.dwell(nearP, 'pen');
    expect(w.v.measureTrackPoints).toEqual([P]);
    expect(w.v.handleKey(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
    expect(w.v.measureTrackPoints).toEqual([]);
    expect(w.v.measureMode).toBe(true);
  });

  it('툴팁 이름: 끌어온 점이 있어도 첫 점에서 그 축 방향이면 X축 방향, 아니면 끌어온 점에서 X축', () => {
    expect(snapTip({ snap: 'axis', axis: 'x', locked: false, trackFrom: [1, 2, 3], direction: [1, 0, 0] })?.name).toBe('X축 방향');
    expect(snapTip({ snap: 'axis', axis: 'z', locked: false, trackFrom: [1, 2, 3] })?.name).toBe('끌어온 점에서 Z축');
    expect(snapTip({ snap: 'axis', axis: 'x', locked: false })?.name).toBe('X축 방향');
    expect(trackMarks([{ trackFrom: [0, 0, 0] }, { trackFrom: [0, 0, 0], direction: [1, 0, 0] }])).toEqual({ trackA: true });
    expect(snapPair({ snapA: 'axis', axisA: 'x', snapB: 'endpoint', trackA: true })).toEqual(['끌어온 점에서 X축', '끝점', false]);
  });
});

describe('끌어온 축끼리의 교차·끌어온 축과 모서리의 교차(코어 0.17.0, 실제 코어 판정)', () => {
  it('두 점의 서로 다른 축이 만나는 점은 첫 점 전에도 붙고 "끌어온 Y축과 X축의 교차" — 찍은 점(measurePoints)의 trackOther로 결과 이름도', async () => {
    const w = setup(scene17);
    const { v, lock } = w;
    await w.dwell(nearA);
    await w.dwell(nearP);
    expect(v.measureTrackPoints).toHaveLength(2);
    // P(더 최근)의 Y축(x = 60)과 Q = (0,0)의 X축(y = 0)이 (60,0)에서 만난다 — 선 끝·경로를 정확히 가리키지 않는다
    w.hover([60.4, 0.3, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'y', trackFrom: P, trackOther: { from: [0, 0, 0], axis: 'x' } });
    expect(h.point).toEqual([60, 0, 0]);
    expect(trackMark(h)).toBe('x');
    expect(lock.snapshot().tip).toBe('끌어온 Y축과 X축의 교차');
    w.click([60.4, 0.3, 0]);
    expect(v.measurePoints[0]).toMatchObject({ snap: 'axis', axis: 'y', trackOther: { axis: 'x' } });
    w.click([80.2, 30.1, 0]);
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: 'axis', snapB: 'endpoint' });
    expect(m.distance).toBeCloseTo(Math.hypot(20, 30), 9);
    expect(trackMarks(v.measurePoints)).toEqual({ trackA: 'x' });
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끌어온 Y축과 X축의 교차', '끝점', false]);
  });

  it('끌어온 축이 경로 선분과 만나는 점은 "끌어온 점에서 X축 · 모서리 위"(그 선분 식별자) — 결과 이름도', async () => {
    const w = setup(scene17);
    const { v, lock } = w;
    await w.dwell(nearP);
    w.click(nearA);
    expect(v.measurePoints[0]!.point).toEqual([0, 0, 0]);
    w.hover([100.3, 30.4, 0]);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ snap: 'axis', axis: 'x', trackFrom: P, segment: { kind: 'line', id: 'path', index: 2 } });
    expect(h.trackOther).toBeUndefined();
    expect(h.point[0]).toBeCloseTo(100, 9);
    expect(h.point[1]).toBeCloseTo(30, 9);
    expect(trackMark(h)).toBe('edge');
    expect(lock.snapshot().tip).toBe('끌어온 점에서 X축 · 모서리 위');
    w.click([100.3, 30.4, 0]);
    const m = v.measurement()!;
    expect(m).toMatchObject({ snapA: 'endpoint', snapB: 'axis', axisB: 'x' });
    expect(trackMarks(v.measurePoints)).toEqual({ trackB: 'edge' });
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', '끌어온 점에서 X축 · 모서리 위', false]);
  });

  it('가르는 차례(trackOther → segment → direction)와 새 이름 9개가 다섯 언어 사전에 있다', () => {
    // 축끼리의 교차가 첫 점 축 위이기도 하면(direction) 교차가 먼저, 모서리 위도 방향이 있어도 모서리 위
    expect(trackMark({ trackFrom: [0, 0, 0], trackOther: { axis: 'z' }, direction: [1, 0, 0] })).toBe('z');
    expect(trackMark({ trackFrom: [0, 0, 0], segment: {}, direction: [1, 0, 0] })).toBe('edge');
    expect(trackMark({ trackFrom: [0, 0, 0], direction: [1, 0, 0] })).toBe(false);
    expect(trackMark({ segment: {} })).toBe(false);
    expect(snapTip({ snap: 'axis', axis: 'z', locked: true, trackFrom: [1, 2, 3], trackOther: { from: [0, 0, 0], axis: 'y' }, direction: [0, 0, 1] })).toEqual({ name: '끌어온 Z축과 Y축의 교차', locked: true });
    const labels: string[] = [];
    for (const a of ['x', 'y', 'z'] as const) {
      labels.push(snapLabel('axis', a, 'edge'));
      for (const b of ['x', 'y', 'z'] as const) if (a !== b) labels.push(snapLabel('axis', a, b));
    }
    expect(labels).toHaveLength(9);
    expect(labels).toContain('끌어온 점에서 Y축 · 모서리 위');
    expect(labels).toContain('끌어온 X축과 Z축의 교차');
    for (const code of ['en', 'ja', 'zh-CN', 'de'])
      for (const l of labels) {
        expect(catalogs[code]![l], `${code}: ${l}`).toBeTruthy();
        expect(translate(l, code), `${code}: ${l}`).not.toMatch(/[가-힣]/);
      }
    expect(translate('끌어온 Y축과 X축의 교차', 'en')).toBe('Intersection of tracked Y and X axes');
    expect(translate('끌어온 점에서 X축 · 모서리 위', 'de')).toBe('X-Achse vom gemerkten Punkt · Auf Kante');
  });
});
