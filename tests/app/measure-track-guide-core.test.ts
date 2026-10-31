// @vitest-environment jsdom
/**
 * 두 끌어온 점의 안내 선끼리 만나는 점(32차 — 3D 뷰어 코어 0.30.0 inference.trackDirs { edge, meets: { guides: true } })을 실제 코어 판정으로.
 * - G-code: 끌어온 점 P (100,60)·Q (30,50), 기운 직선 (100,60) → (120,20)(방향 (1,−2))을 지나간 뒤
 *   P에서 수직인 선 (2,1)과 Q에서 나란한 선 (1,−2)이 만나는 (40,30)은 '끌어온 점에서 모서리에 수직 · 끌어온 점 나란한 선 위',
 *   P에서 나란한 선과 Q에서 수직인 선이 만나는 (90,80)은 '끌어온 점에서 모서리와 나란히 · 끌어온 점 수직인 선 위'.
 *   31차 꼴(meets: true)이면 그 자리는 P의 안내 선 위 커서 자리다. 첫 점을 지나는 선이 아니라 잠글 방향이 없다
 * - 측정 결과 이름(측정 도구 조각 trackDirNames → 첫 화면 snapPair), 새 이름 3개의 네 언어 사전
 * 끌어온 점은 setMeasureTrackPoints로 준다(머무르기 시간을 기다리지 않는다). 가리키는 자리는 교차점에서 조금 비킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions } from 'opencad-viewer3d';
import { MeasureLock, snapTip, trackDirMeet, trackDirName, trackDirNames } from '../../src/app/measure-lock';
import { TRACK_PARALLEL_LABEL, TRACK_PERPENDICULAR_LABEL, snapPair, trackMarks } from '../../src/app/measure';
import { parseForView } from '../../src/app/payload';
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
type V3 = [number, number, number];

const GCODE = ['G21 G90 G17', 'G0 X0 Y40 Z0', 'G2 X40 Y40 I20 J-20 F500', 'G1 X60 Y40', 'G1 X60 Y45', 'G0 X100 Y60', 'G1 X120 Y20', 'M2'].join('\n');
const FIRST: V3 = [60, 45, 0];
const P: V3 = [100, 60, 0];
const Q: V3 = [30, 50, 0];
/** 기운 직선 위(지나가면 기준 선분이 된다) */
const SLANT_AT: V3 = [110.1, 40.1, 0];
const S5 = Math.sqrt(5);

/** guides: false면 31차 꼴(meets: true) */
function setup(guides = true) {
  const r = parseForView('a.nc', enc(GCODE));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const o = ncSnapOptions(r.nc!, arcCenters(r.nc!), null, (r.scene.meta as { arcAngle?: number }).arcAngle);
  const inf = o.inference as Record<string, unknown>;
  expect(inf.trackDirs).toMatchObject({ meets: { guides: true } });
  const edge = (inf.trackDirs as { edge: unknown }).edge;
  v.setMeasureSnap(guides ? o : { ...o, inference: { ...inf, trackDirs: { edge, meets: true } } as MeasureSnapOptions['inference'] });
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
  return { v, hover, click };
}

const off = (p: readonly number[]): V3 => [p[0]! + 0.07, p[1]! + 0.05, p[2]!];
const near = (a: readonly number[], b: readonly number[], tol = 1e-6): boolean => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) < tol;
const sameLine = (a: readonly number[], b: readonly number[]): boolean => Math.abs(Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) - 1) < 1e-9;

describe('G-code: 두 끌어온 점의 안내 선끼리 만나는 점', () => {
  it('P에서 수직인 선 × Q에서 나란한 선 (40,30) — 31차 꼴이면 P의 수직인 선 위 커서 자리', () => {
    for (const guides of [true, false]) {
      const { v, hover } = setup(guides);
      v.setMeasureTrackPoints([P, Q]);
      hover(SLANT_AT);
      const a = hover(off([40, 30, 0]));
      expect(a.h).toMatchObject({ snap: 'perpendicular', trackFrom: P });
      if (guides) {
        expect(near(a.h!.point, [40, 30, 0])).toBe(true);
        expect(a.h!.trackGuide).toMatchObject({ from: Q, kind: 'parallel' });
        expect(sameLine(a.h!.trackGuide!.dir, [1 / S5, -2 / S5, 0])).toBe(true);
        // 첫 점을 지나는 선이 아니라 방향이 없다(Shift·잠금 단추가 잠그지 않는다)
        expect(a.h!.direction).toBeUndefined();
        expect(v.measureHoverLock).toBeNull();
        expect(trackDirMeet(a.h)).toBe('gpar');
        expect(a.tip).toBe('끌어온 점에서 모서리에 수직 · 끌어온 점 나란한 선 위');
      } else {
        expect(a.h!.trackGuide).toBeUndefined();
        expect(near(a.h!.point, [40, 30, 0])).toBe(false);
        expect(a.tip).toBe(TRACK_PERPENDICULAR_LABEL);
      }
    }
  });

  it('P에서 나란한 선 × Q에서 수직인 선 (90,80)', () => {
    const { v, hover } = setup();
    v.setMeasureTrackPoints([P, Q]);
    hover(SLANT_AT);
    const a = hover(off([90, 80, 0]));
    expect(a.h).toMatchObject({ snap: 'parallel', trackFrom: P, trackGuide: { from: Q, kind: 'perpendicular' } });
    expect(near(a.h!.point, [90, 80, 0])).toBe(true);
    expect(trackDirMeet(a.h)).toBe('gperp');
    expect(a.tip).toBe('끌어온 점에서 모서리와 나란히 · 끌어온 점 수직인 선 위');
  });

  it('만나는 점에 찍은 측정 결과의 이름(측정 도구 조각이 짓고 첫 화면 snapPair가 그대로)', () => {
    const { v, hover, click } = setup();
    click(FIRST);
    expect(v.measurePointCount).toBe(1);
    v.setMeasureTrackPoints([P, Q]);
    hover(SLANT_AT);
    click(off([40, 30, 0]));
    const m = v.measurement()!;
    expect(m.snapB).toBe('perpendicular');
    expect(near(m.b, [40, 30, 0])).toBe(true);
    const pts = v.measurePoints;
    expect(pts[1]!.trackGuide).toMatchObject({ from: Q, kind: 'parallel' });
    expect(trackMarks(pts)).toEqual({ trackB: 'dir' });
    expect(trackDirNames(pts)).toEqual({ nameB: '끌어온 점에서 모서리에 수직 · 끌어온 점 나란한 선 위' });
    expect(snapPair({ ...m, ...trackMarks(pts), ...trackDirNames(pts) })).toEqual(['끝점', '끌어온 점에서 모서리에 수직 · 끌어온 점 나란한 선 위', false]);
  });
});

describe('안내 선끼리 만나는 점의 이름(측정 도구 조각)', () => {
  const from: V3 = [0, 0, 0];
  const guide = (kind: 'parallel' | 'perpendicular') => ({ from: [5, 5, 0] as V3, kind, dir: [1, 0, 0] as V3 });
  it('다른 끌어온 점의 안내 종류로 가르고, 네 언어 사전에 있다(나란한 두 선은 만나지 않아 3개)', () => {
    expect(trackDirMeet({ snap: 'perpendicular', trackFrom: from, trackGuide: guide('parallel') })).toBe('gpar');
    expect(trackDirMeet({ snap: 'parallel', trackFrom: from, trackGuide: guide('perpendicular') })).toBe('gperp');
    // 잠근 점·첫 점의 나란함은 만나는 점이 아니다
    expect(trackDirMeet({ snap: 'parallel', trackFrom: from, trackGuide: guide('perpendicular'), locked: true })).toBeNull();
    const names = [
      trackDirName({ snap: 'parallel', trackFrom: from, trackGuide: guide('perpendicular') }),
      trackDirName({ snap: 'perpendicular', trackFrom: from, trackGuide: guide('parallel') }),
      trackDirName({ snap: 'perpendicular', trackFrom: from, trackGuide: guide('perpendicular') }),
    ];
    expect(names).toEqual([
      `${TRACK_PARALLEL_LABEL} · 끌어온 점 수직인 선 위`,
      `${TRACK_PERPENDICULAR_LABEL} · 끌어온 점 나란한 선 위`,
      `${TRACK_PERPENDICULAR_LABEL} · 끌어온 점 수직인 선 위`,
    ]);
    for (const name of names) for (const code of ['en', 'ja', 'zh-CN', 'de']) expect(catalogs[code]![name!], `${code}: ${name}`).toBeTruthy();
    expect(snapTip({ snap: 'perpendicular', trackFrom: from, trackGuide: guide('parallel') })).toEqual({ name: names[1], locked: false });
    expect(translate(names[1]!, 'en')).toBe('Perpendicular to edge from tracked point · On tracked parallel');
    expect(translate(names[0]!, 'de')).toBe('Parallel zur Kante vom gemerkten Punkt · Auf gemerkter Senkrechte');
  });
});
