// @vitest-environment jsdom
/**
 * 잠근 선과 끌어온 점의 축이 만나는 점(25차 — 3D 뷰어 코어 0.21.0 inference.lockTracks, 23차에 준비)과 붙잡지 않은 커서가 판재 원기둥 벽을 맞은 점
 * (refineFace 'onFace')을 실제 코어 판정으로(jsdom 위 가짜 WebGL2, 앱과 같은 추론 붙잡기 MEASURE_INFERENCE·잠금 손잡이 MeasureLock):
 * - 첫 점 (10,0)(선분 끝) 뒤 (60,30)에 머물러 끌어온 다음 X축으로 잠그면, 잠근 X선이 끌어온 점의 Y축(x = 60)과 만나는 (60,0)에 붙는다 —
 *   툴팁·결과 '잠근 X축 · 끌어온 점에서 Y축'(이름에 잠금이 들어 있어 "잠금"을 다시 붙이지 않는다). Y축으로 잠그면 X축(y = 30)과 만나는 (10,30)
 * - Z축으로 잠그고 높이가 다른 점에 머물면 그 높이의 잠근 Z선 위 자리(끌어온 점과 나란한 자리 — '잠근 Z축 · 끌어온 점과 나란히')
 * - lockTracks를 끄면(22차와 같은 선택) 같은 자리가 커서를 잠근 선에 내린 자리('X축 방향 · 잠금')이고, 잠그지 않은 미리 보기는 켜고 끈 값이 같다
 * - 판 외곽선 R50 둥근 모서리를 붙잡기 없이 가리키면 삼각형 위가 아니라 원기둥 위 점(앱 refineFaceSnap — 'axisFace'만 받으면 22차처럼 삼각형 위)
 * - 새 이름 21개가 다섯 언어 사전에 있다
 * 머무르기는 코어의 setTimeout(0.5초)이라 횟수가 아니라 시간(0.7초)으로 기다린다. 커서는 선·경로 끝을 정확히 가리키지 않고 조금 옆을 가리킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions, type Scene3d, type SnapRefineFaceInput } from 'opencad-viewer3d';
import { MEASURE_INFERENCE, lockMeet, snapLabel, snapPair, trackMark, trackMarks } from '../../src/app/measure';
import { MeasureLock, snapTip } from '../../src/app/measure-lock';
import { parseForView } from '../../src/app/payload';
import { panelSnapOptions } from '../../src/app/refine';
import { catalogs, translate } from '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// 위에서 본 두 선분 (10,0) → (40,0), (60,30) → (80,30), 높이 5의 선분 (60,30,5) → (80,30,5)(Z 잠금에서 끌어올 점)
const scene: Scene3d = {
  name: 'lock-track',
  units: 'mm',
  meshes: [],
  lines: [{ id: 'path', positions: new Float32Array([10, 0, 0, 40, 0, 0, 60, 30, 0, 80, 30, 0, 60, 30, 5, 80, 30, 5]) }],
  points: [],
};
const A = [10, 0, 0];
const P = [60, 30, 0];

function setup(opts: { lockTracks?: boolean; view?: 'top' | 'seIso' } = {}) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(scene);
  v.setView(opts.view ?? 'top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const inference = opts.lockTracks === false ? { ...MEASURE_INFERENCE, lockTracks: false } : MEASURE_INFERENCE;
  v.setMeasureSnap({ midpoints: true, inference });
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const ptr = (type: string, p: readonly number[], dx = 0, dy = 0): void => {
    const s = v.project(p)!;
    expect(s.onScreen).toBe(true);
    const e = new MouseEvent(type, { clientX: s.x + dx, clientY: s.y + dy, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    v.canvas.dispatchEvent(e);
  };
  const hover = (p: readonly number[], dx = 2, dy = 1): void => {
    ptr('pointermove', p, dx, dy);
    v.renderNow();
    lock.update();
  };
  const click = (p: readonly number[], dx = 1, dy = 1): void => {
    hover(p, dx, dy);
    ptr('pointerdown', p, dx, dy);
    ptr('pointerup', p, dx, dy);
    v.renderNow();
    lock.update();
  };
  const dwell = async (p: readonly number[]): Promise<void> => {
    hover(p, 1, 1);
    await wait(700);
    v.renderNow();
  };
  return { v, lock, hover, click, dwell };
}

describe('잠근 선과 끌어온 점의 축이 만나는 점(코어 0.21.0 lockTracks, 실제 코어 판정)', () => {
  it('앱 추론 붙잡기에 lockTracks가 켜져 있다(track과 함께)', () => {
    expect(MEASURE_INFERENCE).toMatchObject({ track: true, lock: true, lockTracks: true });
  });

  it('X축으로 잠근 선이 끌어온 점의 Y축과 만나는 (60,0): 툴팁·결과 "잠근 X축 · 끌어온 점에서 Y축", 거리 50', async () => {
    const w = setup();
    const { v, lock } = w;
    w.click(A);
    expect(v.measurePoints[0]).toMatchObject({ point: A, snap: 'endpoint' });
    await w.dwell(P);
    expect(v.measureTrackPoints).toEqual([P]);
    lock.arrow('x');
    expect(lock.lock).toBe('x');
    w.hover([60, 0, 0], 2, -3);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ point: [60, 0, 0], snap: 'axis', axis: 'x', locked: true, trackOther: { from: P, axis: 'y' } });
    expect(h.trackFrom).toBeUndefined();
    expect(trackMark(h)).toBe('lockY');
    expect(lockMeet('lockY')).toBe(true);
    expect(snapTip(h)).toEqual({ name: '잠근 X축 · 끌어온 점에서 Y축', locked: true });
    expect(lock.snapshot().tip).toBe('잠근 X축 · 끌어온 점에서 Y축');
    w.click([60, 0, 0], 2, -3);
    const m = v.measurement()!;
    expect(m.distance).toBe(50);
    expect(trackMarks(v.measurePoints)).toEqual({ trackB: 'lockY' });
    expect(snapPair({ ...m, ...trackMarks(v.measurePoints) })).toEqual(['끝점', '잠근 X축 · 끌어온 점에서 Y축', false]);
  });

  it('Y축으로 잠그면 끌어온 점의 X축(y = 30)과 만나는 (10,30) — "잠근 Y축 · 끌어온 점에서 X축"', async () => {
    const w = setup();
    const { v, lock } = w;
    w.click(A);
    await w.dwell(P);
    lock.arrow('y');
    w.hover([10, 30, 0], -3, 2);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ point: [10, 30, 0], snap: 'axis', axis: 'y', locked: true, trackOther: { from: P, axis: 'x' } });
    expect(lock.snapshot().tip).toBe('잠근 Y축 · 끌어온 점에서 X축');
  });

  it('Z축으로 잠그고 높이 5의 점에 머물면 잠근 Z선 위 그 높이 — "잠근 Z축 · 끌어온 점과 나란히"', async () => {
    const w = setup({ view: 'seIso' });
    const { v, lock } = w;
    w.click(A);
    await w.dwell([60, 30, 5]);
    expect(v.measureTrackPoints).toEqual([[60, 30, 5]]);
    lock.arrow('z');
    w.hover([10, 0, 5], 2, 1);
    const h = v.measureHoverSnap!;
    expect(h).toMatchObject({ point: [10, 0, 5], snap: 'axis', axis: 'z', locked: true, trackFrom: [60, 30, 5] });
    expect(h.trackOther).toBeUndefined();
    expect(trackMark(h)).toBe('lockFrom');
    expect(lock.snapshot().tip).toBe('잠근 Z축 · 끌어온 점과 나란히');
  });

  it('lockTracks를 끄면 같은 자리가 22차처럼 커서를 잠근 선에 내린 자리이고, 잠그지 않은 미리 보기는 켜고 끈 값이 같다', async () => {
    const seen: unknown[][] = [];
    for (const on of [true, false]) {
      const w = setup({ lockTracks: on });
      const { v, lock } = w;
      w.click(A);
      await w.dwell(P);
      const free: unknown[] = [];
      for (const p of [[60, 0, 0], [30, 0.4, 0], [10, 30, 0], [70, 30.2, 0], [60, 12, 0]]) {
        w.hover(p, 2, -3);
        const h = v.measureHoverSnap;
        free.push(h && { point: h.point, snap: h.snap, axis: h.axis, trackFrom: h.trackFrom, trackOther: h.trackOther, segment: h.segment?.index, locked: h.locked });
      }
      seen.push(free);
      if (!on) {
        lock.arrow('x');
        w.hover([60, 0, 0], 2, -3);
        const h = v.measureHoverSnap!;
        expect(h).toMatchObject({ snap: 'axis', axis: 'x', locked: true });
        expect(h.trackOther).toBeUndefined();
        expect(h.point[0]).not.toBe(60);
        expect(lock.snapshot().tip).toBe('X축 방향 · 잠금');
      }
    }
    expect(seen[0]).toEqual(seen[1]);
  });
});

describe('붙잡지 않은 커서가 판재 원기둥 벽을 맞은 점(코어 0.21.0 refineFace onFace, 실제 코어 판정)', () => {
  // 판 400 × 300 × 18, 오른쪽 앞 모서리 R50(중심 (350,50))
  const PANEL = `<?xml version="1.0" encoding="utf-8"?>
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
 </panel>
</pgi>`;
  const panel = (tweak: (o: MeasureSnapOptions) => MeasureSnapOptions = (o) => o) => {
    const r = parseForView('p.pgi', new TextEncoder().encode(PANEL));
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    const v = new Viewer3d(host, { animate: false });
    v.setScene(r.scene);
    v.setView('seIso', false);
    v.fit(false);
    v.setMeasureMode(true);
    const faces: SnapRefineFaceInput[] = [];
    const o = tweak(panelSnapOptions(r.mpr!.snap!));
    v.setMeasureSnap({ ...o, refineFace: (c) => (faces.push(c), o.refineFace!(c)) });
    // 둥근 모서리를 화면 가득
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [360, 400]) for (const y of [0, 40]) for (const z of [0, 18]) {
      const s = v.project([x, y, z])!;
      x0 = Math.min(x0, s.x);
      y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x);
      y1 = Math.max(y1, s.y);
    }
    v.zoomToRect(x0, y0, x1, y1, false);
    v.renderNow();
    const hover = (p: readonly number[]): void => {
      const s = v.project(p)!;
      const e = new MouseEvent('pointermove', { clientX: s.x + 1, clientY: s.y + 2, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      v.canvas.dispatchEvent(e);
      v.renderNow();
    };
    return { v, hover, faces };
  };
  const D = Math.PI / 180;
  const onWall = (deg: number): number[] => [350 + 50 * Math.cos(deg * D), 50 + 50 * Math.sin(deg * D), 9.3];
  const cylDev = (p: readonly number[]): number => Math.abs(Math.hypot(p[0]! - 350, p[1]! - 50) - 50);

  it('둥근 모서리 R50을 가리키면 원기둥 위(붙잡기 없음, refined), axisFace만 받으면 22차처럼 삼각형 위', () => {
    for (const deg of [-62.5, -32.5]) {
      const now = panel();
      now.hover(onWall(deg));
      const h = now.v.measureHoverSnap!;
      expect(h).toMatchObject({ snap: null, refined: true });
      expect(h.face).toBeUndefined();
      expect(cylDev(h.point)).toBeLessThan(1e-9);
      expect(now.faces.map((c) => c.kind)).toContain('onFace');
      expect(snapTip(h)).toBeNull();
      // 22차와 같은 앱 함수(축이 면을 뚫는 점만)면 삼각형 위 — 처짐(50·(1 − cos 2.5°) ≈ 0.048)만큼 안쪽
      const old = panel((o) => ({ ...o, refineFace: (c) => (c.kind === 'axisFace' ? o.refineFace!(c) : null) }));
      old.hover(onWall(deg));
      const g = old.v.measureHoverSnap!;
      expect(g.snap).toBeNull();
      expect(g.refined).toBeFalsy();
      expect(cylDev(g.point)).toBeGreaterThan(1e-3);
      expect(cylDev(g.point)).toBeLessThan(0.05);
    }
  });

  it('판 윗면(평면)은 다듬지 않는다(코어 점 그대로)', () => {
    const w = panel();
    w.hover([385, 30, 18]);
    const h = w.v.measureHoverSnap!;
    expect(h.snap).toBeNull();
    expect(h.refined).toBeFalsy();
    expect(Math.abs(h.point[2] - 18)).toBeLessThan(1e-4);
  });
});

describe('새 이름(잠근 선 × 끌어온 점)', () => {
  it('새 이름 21개(잠근 축 6 + 나란함·수직·접선·모르는 방향 × 축 셋 12, 끌어온 점과 나란히 3)가 다섯 언어 사전에 있다', () => {
    const labels: string[] = [];
    for (const a of ['x', 'y', 'z'] as const)
      for (const t of ['lockX', 'lockY', 'lockZ'] as const) if (t !== `lock${a.toUpperCase()}`) labels.push(snapLabel('axis', a, t));
    for (const k of ['parallel', 'perpendicular', null] as const) for (const t of ['lockX', 'lockY', 'lockZ'] as const) labels.push(snapLabel(k, null, t));
    for (const a of ['x', 'y', 'z'] as const) labels.push(snapLabel('axis', a, 'lockFrom'));
    // 원호 접선으로 잠근 선(코어 종류는 나란함 — 이름만 접선 방향)
    for (const t of ['lockX', 'lockY', 'lockZ'] as const) labels.push(snapPair({ snapA: 'endpoint', snapB: 'parallel', lockedB: true, tangentB: true, trackB: t })![1]);
    expect(new Set(labels).size).toBe(21);
    expect(labels).toContain('잠근 나란한 방향 · 끌어온 점에서 Z축');
    expect(labels).toContain('잠근 방향 · 끌어온 점에서 X축');
    expect(labels).toContain('잠근 접선 방향 · 끌어온 점에서 Y축');
    for (const code of ['en', 'ja', 'zh-CN', 'de'])
      for (const l of labels) {
        expect(catalogs[code]![l], `${code}: ${l}`).toBeTruthy();
        expect(translate(l, code), `${code}: ${l}`).not.toMatch(/[가-힣]/);
      }
    expect(translate('잠근 X축 · 끌어온 점에서 Y축', 'en')).toBe('Locked X axis · On Y axis from tracked point');
    expect(translate('잠근 Z축 · 끌어온 점과 나란히', 'de')).toBe('Gesperrte Z-Achse · In Flucht mit gemerktem Punkt');
    // 가르는 법: 잠근 선 위 점의 trackOther(trackFrom 없이)는 끌어온 축, trackFrom만이면 나란한 자리, 잠그지 않은 trackFrom은 0.16.0 그대로
    expect(trackMark({ snap: 'axis', locked: true, trackOther: { axis: 'z' }, direction: [1, 0, 0] })).toBe('lockZ');
    expect(trackMark({ snap: 'parallel', locked: true, trackOther: { axis: 'x' }, direction: [1, 1, 0] })).toBe('lockX');
    expect(trackMark({ snap: 'axis', locked: true, trackFrom: [0, 0, 5], direction: [0, 0, 1] })).toBe('lockFrom');
    expect(trackMark({ snap: 'axis', trackFrom: [0, 0, 5] })).toBe(true);
    expect(snapPair({ snapA: 'endpoint', snapB: 'axis', axisB: 'z', lockedB: true, trackB: 'lockFrom' })).toEqual(['끝점', '잠근 Z축 · 끌어온 점과 나란히', false]);
  });
});
