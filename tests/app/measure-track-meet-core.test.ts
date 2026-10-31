// @vitest-environment jsdom
/**
 * 끌어온 점에서 모서리와 나란한 선·수직인 선이 만나는 점(31차 — 3D 뷰어 코어 0.29.0 inference.trackDirs { edge, meets: true })을 실제 코어 판정으로.
 * - G-code: 첫 점 (60,45), 끌어온 점 (100,60), 기운 직선 (100,60) → (120,20)을 지나간 뒤 수직인 선 (2,1)이 첫 점 X축과 만나는 (70,45)는
 *   '끌어온 점에서 모서리에 수직 · X축 위', 첫 점의 나란함(기운 직선과 나란한 첫 점 선)과 만나는 (62,41)은 '… · 나란한 방향 위',
 *   끌어온 점이 둘이면 다른 끌어온 점 (30,50)의 X축과 만나는 (80,50)은 '… · 끌어온 점 X축 위'. 만나는 점을 끄면(30차 꼴) 그 자리는 첫 점 축·나란함·안내 선 위 커서 자리다
 * - 원호 경로: 원호 중심을 끌어온 점으로 기운 직선과 나란한 선이 원호와 만나는 점은 앱 refine('axisEdge' — 축 이름 없는 선)이 원호 위로 옮긴다(30차 꼴은 원호 밖 커서 자리)
 * - 판재: 구멍 테두리(그물 윤곽선)와 만나는 점은 테두리 원 위로, 앞에서 본 보기에서 구멍 벽을 뚫는 점은 refineFace('axisFace')가 원기둥 위로 '… · 면 위'
 * - 측정 결과 이름(측정 도구 조각 trackDirNames → 첫 화면 snapPair), 이름 18개의 네 언어 사전, 휴대폰 폭보다 긴 툴팁 자리(placeTip)
 * 끌어온 점은 setMeasureTrackPoints로 준다(머무르기 시간을 기다리지 않는다). 가리키는 자리는 교차점에서 조금 비킨다(선·모서리를 정확히 가리키지 않는다).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions } from 'opencad-viewer3d';
import { MeasureLock, placeTip, snapTip, trackDirMeet, trackDirName, trackDirNames } from '../../src/app/measure-lock';
import { TRACK_PARALLEL_LABEL, TRACK_PERPENDICULAR_LABEL, snapPair, trackMarks } from '../../src/app/measure';
import { parseForView } from '../../src/app/payload';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions, panelSnapOptions } from '../../src/app/refine';
import { catalogs, translate } from '../../site/i18n.mjs';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
type V3 = [number, number, number];

// 위에서 본 G-code: 시계 원호(중심 (20,20) R √800) (0,40) → (40,40), 직선 → (60,40) → (60,45), 급속 → (100,60), 기운 직선 → (120,20)
const GCODE = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G1 X60 Y45', 'G0 X100 Y60', 'G1 X120 Y20', 'M2'].join('\n');
const R = Math.sqrt(800);
const FIRST: V3 = [60, 45, 0];
const T: V3 = [100, 60, 0];
/** 기운 직선 위(지나가면 기준 선분이 된다) */
const SLANT_AT: V3 = [110.1, 40.1, 0];
// 판재: 구멍(중심 (150,150) 지름 10 깊이 12 — 벽 z 6~18)과 기운 톱 홈(중심선 (250,50) → (350,150), 너비 8)
const PANEL = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <panel length="400" width="300" thickness="18" name="p" quantity="1">
  <hole x="150" y="150" z="0" diameter="10" depth="12" direction="z-" enable="1" order="1"/>
  <line startX="250" startY="50" startZ="0" endX="350" endY="150" endZ="0" width="8" depth="5" direction="z-" isSaw="1" enable="1" order="2"/>
 </panel>
</pgi>`;
/** 홈의 기운 윗모서리 위 */
const GROOVE_AT: V3 = [296.9, 103.2, 18];

/** meets: false면 30차 꼴(trackDirs { edge }만) */
function setup(name: string, text: string, meets = true) {
  const r = parseForView(name, enc(text));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const o: MeasureSnapOptions = r.nc ? ncSnapOptions(r.nc, arcCenters(r.nc), null, (r.scene.meta as { arcAngle?: number }).arcAngle) : panelSnapOptions(r.mpr!.snap!);
  const inf = o.inference as Record<string, unknown>;
  const edge = (inf.trackDirs as { edge: unknown }).edge;
  v.setMeasureSnap(meets ? o : { ...o, inference: { ...inf, trackDirs: { edge } } as MeasureSnapOptions['inference'] });
  v.renderNow();
  const lock = new MeasureLock({ viewer: () => v, touch: () => false, layer: host, changed: vi.fn() });
  const zoom = (lo: readonly number[], hi: readonly number[]): void => {
    const a = v.project(lo)!;
    const b = v.project(hi)!;
    v.zoomToRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), false);
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
  const hover = (p: readonly number[]) => {
    ptr('pointermove', p);
    v.renderNow();
    lock.update();
    return { h: v.measureHoverSnap, tip: lock.snapshot().tip };
  };
  const click = (p: readonly number[]): void => {
    hover(p);
    ptr('pointerdown', p);
    ptr('pointerup', p);
    v.renderNow();
    lock.update();
  };
  return { r, v, zoom, hover, click };
}

/** 교차점에서 조금 비킨 커서(k = 확대에 맞춘 배율) */
const off = (p: readonly number[], k = 1): V3 => [p[0]! + 0.07 * k, p[1]! + 0.05 * k, p[2]!];
const near = (a: readonly number[], b: readonly number[], tol = 1e-6): boolean => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) < tol;

describe('G-code: 끌어온 점 안내 선이 첫 점 축·첫 점의 나란함·다른 끌어온 점의 축과 만나는 점', () => {
  it('수직인 선 × 첫 점 X축 (70,45) — 끄면 첫 점 X축 위 커서 자리', () => {
    for (const meets of [true, false]) {
      const { v, hover, click } = setup('a.nc', GCODE, meets);
      click(FIRST);
      expect(v.measurePointCount).toBe(1);
      v.setMeasureTrackPoints([T]);
      hover(SLANT_AT);
      const a = hover(off([70, 45, 0]));
      if (meets) {
        expect(a.h).toMatchObject({ snap: 'perpendicular', trackFrom: T, axis: 'x' });
        expect(near(a.h!.point, [70, 45, 0])).toBe(true);
        // 세계 축과 만나면 축에 수직인 좌표는 첫 점 그대로(셈 오차 없이)
        expect(a.h!.point[1]).toBe(45);
        expect(trackDirMeet(a.h)).toBe('x');
        expect(a.tip).toBe('끌어온 점에서 모서리에 수직 · X축 위');
        // 첫 점 축과 만나면 Shift가 그 축에 잠근다(코어 0.17.0 축끼리 교차와 같은 규칙)
        expect(v.measureHoverLock).toMatchObject({ kind: 'axis', axis: 'x' });
      } else {
        expect(a.h).toMatchObject({ snap: 'axis', axis: 'x' });
        expect(a.h!.trackFrom).toBeUndefined();
        expect(a.tip).toBe('X축 방향');
      }
    }
  });

  it('수직인 선 × 첫 점의 나란함 (62,41)', () => {
    for (const meets of [true, false]) {
      const { v, hover, click } = setup('a.nc', GCODE, meets);
      click(FIRST);
      v.setMeasureTrackPoints([T]);
      hover(SLANT_AT);
      const a = hover(off([62, 41, 0]));
      if (meets) {
        expect(a.h).toMatchObject({ snap: 'perpendicular', trackFrom: T });
        expect(a.h!.axis).toBeUndefined();
        expect(near(a.h!.point, [62, 41, 0], 1e-9)).toBe(true);
        expect(trackDirMeet(a.h)).toBe('par');
        expect(a.tip).toBe('끌어온 점에서 모서리에 수직 · 나란한 방향 위');
      } else {
        expect(a.h).toMatchObject({ snap: 'parallel' });
        expect(a.h!.trackFrom).toBeUndefined();
        expect(a.tip).toBe('나란한 방향');
      }
    }
  });

  it('끌어온 점 둘: 수직인 선 × 다른 끌어온 점 (30,50)의 X축 (80,50)', () => {
    const { v, hover } = setup('a.nc', GCODE);
    v.setMeasureTrackPoints([T, [30, 50, 0]]);
    hover(SLANT_AT);
    const a = hover(off([80, 50, 0]));
    expect(a.h).toMatchObject({ snap: 'perpendicular', trackFrom: T, trackOther: { from: [30, 50, 0], axis: 'x' } });
    expect(near(a.h!.point, [80, 50, 0], 1e-9)).toBe(true);
    expect(trackDirMeet(a.h)).toBe('tx');
    expect(a.tip).toBe('끌어온 점에서 모서리에 수직 · 끌어온 점 X축 위');
    // 만나는 점에는 잠글 방향이 없다(다른 끌어온 점의 축)
    expect(v.measureHoverLock).toBeNull();
  });

  it('만나는 점에 찍은 측정 결과의 이름(측정 도구 조각이 짓고 첫 화면 snapPair가 그대로)', () => {
    const { v, hover, click } = setup('a.nc', GCODE);
    click(FIRST);
    v.setMeasureTrackPoints([T]);
    hover(SLANT_AT);
    click(off([70, 45, 0]));
    const m = v.measurement()!;
    expect(m.snapB).toBe('perpendicular');
    const pts = v.measurePoints;
    expect(trackMarks(pts)).toEqual({ trackB: 'dir' });
    expect(trackDirNames(pts)).toEqual({ nameB: '끌어온 점에서 모서리에 수직 · X축 위' });
    expect(snapPair({ ...m, ...trackMarks(pts), ...trackDirNames(pts) })).toEqual(['끝점', '끌어온 점에서 모서리에 수직 · X축 위', false]);
    // 이름을 붙이지 않으면(조각을 받기 전 — 측정 중에는 늘 받은 뒤다) 30차 이름
    expect(snapPair({ ...m, ...trackMarks(pts) })).toEqual(['끝점', TRACK_PERPENDICULAR_LABEL, false]);
  });
});

describe('곡선·곡면과 만나는 점은 앱이 곡선·원기둥 위로 다듬는다', () => {
  it('G-code 원호: 원호 중심에서 기운 직선과 나란한 선이 원호와 만나는 점(116.6°)', () => {
    const A: V3 = [20 - R / Math.sqrt(5), 20 + (2 * R) / Math.sqrt(5), 0];
    for (const meets of [true, false]) {
      const { v, zoom, hover } = setup('a.nc', GCODE, meets);
      v.setMeasureTrackPoints([[20, 20, 0]]);
      hover(SLANT_AT);
      zoom([A[0] - 12, A[1] - 12, 0], [A[0] + 12, A[1] + 12, 0]);
      const a = hover(off(A, 0.4));
      expect(a.h).toMatchObject({ snap: 'parallel', trackFrom: [20, 20, 0] });
      const onArc = Math.abs(Math.hypot(a.h!.point[0]! - 20, a.h!.point[1]! - 20) - R);
      if (meets) {
        expect(a.h!.segment).toMatchObject({ kind: 'line', id: expect.stringMatching(/^nc-cut-/) });
        expect(onArc).toBeLessThan(1e-5);
        expect(near(a.h!.point, A, 1e-5)).toBe(true);
        expect(a.tip).toBe('끌어온 점에서 모서리와 나란히 · 모서리 위');
      } else {
        expect(a.h!.segment).toBeUndefined();
        expect(onArc).toBeGreaterThan(1e-3);
        expect(a.tip).toBe(TRACK_PARALLEL_LABEL);
      }
    }
  });

  it('판재 구멍 테두리: 구멍 중심에서 기운 홈 모서리와 나란한 선이 테두리와 만나는 점(45°)', () => {
    const B: V3 = [150 + 5 / Math.SQRT2, 150 + 5 / Math.SQRT2, 18];
    const { v, zoom, hover } = setup('p.pgi', PANEL);
    zoom([100, 30, 18], [310, 200, 18]);
    v.setMeasureTrackPoints([[150, 150, 18]]);
    hover(GROOVE_AT);
    zoom([B[0] - 3, B[1] - 3, 18], [B[0] + 3, B[1] + 3, 18]);
    const a = hover(off(B, 0.1));
    expect(a.h).toMatchObject({ snap: 'parallel', trackFrom: [150, 150, 18], segment: { kind: 'edge' } });
    expect(Math.abs(Math.hypot(a.h!.point[0]! - 150, a.h!.point[1]! - 150) - 5)).toBeLessThan(1e-5);
    expect(a.h!.point[2]).toBeCloseTo(18, 5);
    expect(trackDirMeet(a.h)).toBe('edge');
    expect(a.tip).toBe('끌어온 점에서 모서리와 나란히 · 모서리 위');
  });

  it('판재 구멍 벽(앞에서 본 보기): 끌어온 점 (130,130,12)에서 홈 모서리와 나란한 선이 가까운 벽(225°)을 뚫는 점', () => {
    const W: V3 = [150 - 5 / Math.SQRT2, 150 - 5 / Math.SQRT2, 12];
    for (const meets of [true, false]) {
      const { v, zoom, hover } = setup('p.pgi', PANEL, meets);
      zoom([100, 30, 18], [310, 200, 18]);
      v.setMeasureTrackPoints([[130, 130, 12]]);
      hover(GROOVE_AT);
      v.setView('front', false);
      v.fit(false);
      zoom([W[0] - 3, W[1], W[2] - 3], [W[0] + 3, W[1], W[2] + 3]);
      const a = hover(off(W, 0.1));
      expect(a.h).toMatchObject({ snap: 'parallel', trackFrom: [130, 130, 12] });
      const rho = Math.hypot(a.h!.point[0]! - 150, a.h!.point[1]! - 150);
      if (meets) {
        expect(a.h!.face).toBeTruthy();
        expect(Math.abs(rho - 5)).toBeLessThan(1e-5);
        expect(a.h!.point[2]).toBe(12);
        expect(trackDirMeet(a.h)).toBe('face');
        expect(a.tip).toBe('끌어온 점에서 모서리와 나란히 · 면 위');
      } else {
        expect(a.h!.face).toBeUndefined();
        expect(Math.abs(rho - 5)).toBeGreaterThan(1e-3);
      }
    }
  });
});

describe('만나는 점의 이름(측정 도구 조각)', () => {
  const from: V3 = [0, 0, 0];
  it('만난 것 가르기: 첫 점 축 → 다른 끌어온 점의 축 → 선분 → 면 → 첫 점의 나란함', () => {
    expect(trackDirMeet({ snap: 'parallel', trackFrom: from, axis: 'y', direction: [0, 1, 0] })).toBe('y');
    expect(trackDirMeet({ snap: 'perpendicular', trackFrom: from, trackOther: { from: [1, 2, 3], axis: 'z' } })).toBe('tz');
    expect(trackDirMeet({ snap: 'parallel', trackFrom: from, segment: { kind: 'line', id: 'a', index: 0, raw: 0, ends: [from, [1, 0, 0]] } })).toBe('edge');
    expect(trackDirMeet({ snap: 'parallel', trackFrom: from, face: { id: 'm', index: 0, normal: [0, 0, 1] } })).toBe('face');
    expect(trackDirMeet({ snap: 'perpendicular', trackFrom: from, direction: [0.6, 0.8, 0] })).toBe('par');
    // 그 선 위 점(만난 것 없음)·잠근 점·첫 점의 나란함·끌어온 축은 만나는 점이 아니다(30차까지 이름 그대로)
    expect(trackDirMeet({ snap: 'parallel', trackFrom: from })).toBeNull();
    expect(trackDirMeet({ snap: 'parallel', trackFrom: from, axis: 'x', locked: true })).toBeNull();
    expect(trackDirMeet({ snap: 'parallel', direction: [1, 0, 0] })).toBeNull();
    expect(trackDirMeet({ snap: 'axis', trackFrom: from, axis: 'x' })).toBeNull();
    expect(snapTip({ snap: 'parallel', trackFrom: from })).toEqual({ name: TRACK_PARALLEL_LABEL, locked: false });
    expect(snapTip({ snap: 'parallel', trackFrom: from, face: { id: 'm', index: 0, normal: [0, 0, 1] } })).toEqual({ name: '끌어온 점에서 모서리와 나란히 · 면 위', locked: false });
  });

  it('이름 18개는 네 언어 사전에 있다', () => {
    const meets: [Record<string, unknown>, string][] = [
      ...(['x', 'y', 'z'] as const).map((a) => [{ axis: a, direction: [1, 0, 0] }, `${a.toUpperCase()}축 위`] as [Record<string, unknown>, string]),
      [{ direction: [0.6, 0.8, 0] }, '나란한 방향 위'],
      ...(['x', 'y', 'z'] as const).map((a) => [{ trackOther: { from: [1, 1, 1], axis: a } }, `끌어온 점 ${a.toUpperCase()}축 위`] as [Record<string, unknown>, string]),
      [{ segment: { kind: 'edge', id: 'm', index: 0, raw: 0, ends: [from, [1, 0, 0]] } }, '모서리 위'],
      [{ face: { id: 'm', index: 0, normal: [0, 0, 1] } }, '면 위'],
    ];
    const names = new Set<string>();
    for (const snap of ['parallel', 'perpendicular'] as const)
      for (const [extra, at] of meets) {
        const name = trackDirName({ snap, trackFrom: from, ...extra } as Parameters<typeof trackDirName>[0]);
        expect(name).toBe(`${snap === 'parallel' ? TRACK_PARALLEL_LABEL : TRACK_PERPENDICULAR_LABEL} · ${at}`);
        names.add(name!);
        for (const code of ['en', 'ja', 'zh-CN', 'de']) expect(catalogs[code]![name!], `${code}: ${name}`).toBeTruthy();
      }
    expect(names.size).toBe(18);
    expect(translate('끌어온 점에서 모서리에 수직 · 끌어온 점 Y축 위', 'en')).toBe('Perpendicular to edge from tracked point · On tracked Y axis');
    expect(translate('끌어온 점에서 모서리와 나란히 · X축 위', 'de')).toBe('Parallel zur Kante vom gemerkten Punkt · Auf X-Achse');
    expect(translate('끌어온 점에서 모서리와 나란히 · 면 위', 'ja')).toBe('追跡点からエッジに平行 · 面上');
  });
});

describe('휴대폰 폭보다 긴 툴팁 자리(placeTip)', () => {
  const L = { width: 375, height: 600 };
  it('점 양옆 어느 쪽에도 들어가지 않으면 점 아래(막히면 위)에서 가로만 3D 보기 안으로 민다', () => {
    // 너비 360: 오른쪽(192 + 360 > 371)도 왼쪽(180 − 12 − 360 < 4)도 밖 → 가로 375 − 4 − 360 = 11
    expect(placeTip(180, 100, 360, 36, L, null)).toEqual({ x: 11, y: 112 });
    // 아래 자리가 코어 거리 글상자와 겹치면 위
    expect(placeTip(180, 100, 360, 36, L, { x: 0, y: 120, width: 375, height: 20 })).toEqual({ x: 11, y: 52 });
    // 아래가 3D 보기 밖이면 위
    expect(placeTip(180, 580, 360, 36, L, null)).toEqual({ x: 11, y: 532 });
    // 3D 보기보다 넓으면(줄을 바꾸므로 오지 않는다) 예전처럼 오른쪽 아래
    expect(placeTip(180, 100, 400, 18, L, null)).toEqual({ x: 192, y: 112 });
    // 한쪽에 들어가면 예전 차례 그대로(왼쪽 아래)
    expect(placeTip(300, 100, 200, 18, L, null)).toEqual({ x: 88, y: 112 });
  });
});
