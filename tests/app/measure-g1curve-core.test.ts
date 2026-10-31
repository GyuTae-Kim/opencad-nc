// @vitest-environment jsdom
/**
 * G1으로 풀어 쓴 곡선 토막을 끌어온 점 나란함·수직과 첫 점 나란한 방향의 기준에서 빼기(34차 — refine.ts trackDirEdge + g1curve.ts)를 실제 코어 판정으로.
 * 기운 직선 이동 (0,0) → (40,20)을 지나간 뒤 CAM처럼 G1으로 나눈 원(중심 (100,40) R20, 허용치 0.05 — 현 꺾임 약 8°)의 현을 지나가도
 * 기준은 기운 직선 그대로다. 33차 꼴(곧은 이동이면 모두 기준)이면 그 현이 기준이 되어 끌어온 점·첫 점에서 현과 나란한 방향에 붙는다.
 * 곧은 이동만 지나가면 전·후가 같다. 가리키는 자리는 선 위를 조금 비킨다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type MeasureSnapOptions, type SnapSegment } from 'opencad-viewer3d';
import { MOVE_ARC, ncPathSetId } from '../../src/model';
import { MeasureLock } from '../../src/app/measure-lock';
import { parseForView } from '../../src/app/payload';
import { arcCenters } from '../../src/app/snap';
import { ncSnapOptions, trackDirEdge } from '../../src/app/refine';
import { g1CurvePieces } from '../../src/app/g1curve';
import { installCanvasFakes } from './fake-webgl';

let restore: () => void;
beforeAll(() => {
  restore = installCanvasFakes(800, 600);
});
afterAll(() => restore());

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
type V3 = [number, number, number];
const unit = (v: readonly number[]): V3 => {
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n];
};
const sameDir = (a: readonly number[], b: readonly number[]): boolean => {
  const u = unit(a);
  const w = unit(b);
  return Math.abs(Math.abs(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) - 1) < 1e-4;
};
const along = (p: readonly number[], d: readonly number[], t: number): V3 => {
  const u = unit(d);
  return [p[0]! + u[0] * t + 0.07, p[1]! + u[1] * t + 0.05, p[2]! + u[2] * t];
};
const edgeDir = (e: readonly (readonly number[])[]): V3 => [e[1]![0]! - e[0]![0]!, e[1]![1]! - e[0]![1]!, e[1]![2]! - e[0]![2]!];
const f3 = (x: number): string => (Math.round(x * 1000) / 1000).toFixed(3);

// 원(중심 (100,40) R20)을 처짐 0.05로 나눈 G1 — 0°에서 반시계 한 바퀴
const R = 20;
const N = Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.05 / R)));
const circle: V3[] = [];
for (let k = 0; k <= N; k++) circle.push([+f3(100 + R * Math.cos((2 * Math.PI * k) / N)), +f3(40 + R * Math.sin((2 * Math.PI * k) / N)), 0]);
const GCODE = ['G21 G90 G17', 'G0 X0 Y0 Z0', 'G1 X40 Y20 F500', `G0 X${f3(circle[0]![0])} Y${f3(circle[0]![1])}`, ...circle.slice(1).map((p) => `G1 X${f3(p[0])} Y${f3(p[1])}`), 'G0 X160 Y100', 'M2'].join('\n');
const SLANT: V3 = [2, 1, 0];
const T: V3 = [60, 85, 0];
const FIRST: V3 = [40, 20, 0];
/** 현 k(점 k → k + 1)의 가운데에서 원 중심 쪽으로 조금 */
const chordMid = (k: number): V3 => {
  const a = circle[k]!;
  const b = circle[k + 1]!;
  const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
  const d = unit([100 - m[0], 40 - m[1], 0]);
  return [m[0] + d[0] * 0.03, m[1] + d[1] * 0.03, 0];
};
const chordDir = (k: number): V3 => edgeDir([circle[k]!, circle[k + 1]!]);

/** old: 33차 꼴(곧은 이동이면 모두 기준 — 곡선 토막을 가리지 않음) */
function setup(old: boolean) {
  const r = parseForView('g1.nc', enc(GCODE));
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const v = new Viewer3d(host, { animate: false });
  v.setScene(r.scene);
  v.setView('top', false);
  v.fit(false);
  v.setMeasureMode(true);
  const nc = r.nc!;
  const o: MeasureSnapOptions = ncSnapOptions(nc, arcCenters(nc), null, (r.scene.meta as { arcAngle?: number }).arcAngle);
  if (old) {
    const m = nc.moves;
    const edge = (s: SnapSegment): boolean => s.kind === 'line' && s.index >= 0 && s.index < m.count && m.kind[s.index] !== MOVE_ARC && ncPathSetId(m.kind[s.index]!, m.flags[s.index]!, m.tool[s.index]!) === s.id;
    const inf = o.inference as Record<string, unknown>;
    v.setMeasureSnap({ ...o, inference: { ...inf, parallelEdge: edge, trackDirs: { ...(inf.trackDirs as object), edge } } as MeasureSnapOptions['inference'] });
  } else v.setMeasureSnap(o);
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
  return { r, v, hover, click };
}

describe('G1으로 풀어 쓴 곡선 토막은 나란함·수직의 기준이 아니다(실제 코어 판정)', () => {
  it('거르기 함수: 원을 나눈 G1 현은 받지 않고 기운 직선·급속은 받는다', () => {
    const r = parseForView('g1.nc', enc(GCODE));
    const nc = r.nc!;
    const mark = g1CurvePieces(nc);
    const edge = trackDirEdge(nc);
    const m = nc.moves;
    let chords = 0;
    for (let i = 0; i < m.count; i++) {
      const s: SnapSegment = { kind: 'line', id: ncPathSetId(m.kind[i]!, m.flags[i]!, m.tool[i]!), index: i, raw: i, ends: [[m.points[3 * i]!, m.points[3 * i + 1]!, m.points[3 * i + 2]!], [m.points[3 * i + 3]!, m.points[3 * i + 4]!, m.points[3 * i + 5]!]] };
      const onCircle = s.ends.every((e) => Math.abs(Math.hypot(e[0]! - 100, e[1]! - 40) - R) < 2e-3);
      if (onCircle && m.kind[i] !== 0) {
        chords++;
        expect(mark[i], `현 ${i}`).toBe(1);
        expect(edge(s)).toBe(false);
      } else {
        expect(mark[i], `이동 ${i}`).toBe(0);
        expect(edge(s)).toBe(true);
      }
    }
    expect(chords).toBe(N);
  });

  it('끌어온 점: 기운 직선 뒤 G1 현을 지나가도 기준은 기운 직선(33차 꼴이면 현)', () => {
    // 현 방향이 기운 직선과 크게 다른 현(방향 134° — 기운 직선 26.6°)
    const k = Math.round(N * 0.1);
    expect(sameDir(chordDir(k), SLANT)).toBe(false);
    for (const old of [false, true]) {
      const { v, hover } = setup(old);
      expect(v.setMeasureTrackPoints([T])).toBe(1);
      hover([20.07, 10.08, 0]);
      hover(chordMid(k));
      const slant = hover(along(T, SLANT, 25));
      const chord = hover(along(T, chordDir(k), 25));
      if (!old) {
        expect(slant.h).toMatchObject({ snap: 'parallel', trackFrom: T });
        expect(sameDir(edgeDir(slant.h!.edge!), SLANT)).toBe(true);
        expect(slant.tip).toBe('끌어온 점에서 모서리와 나란히');
        expect(chord.h?.snap === 'parallel' && !!chord.h.edge && sameDir(edgeDir(chord.h.edge), chordDir(k))).toBe(false);
      } else {
        expect(slant.h?.snap === 'parallel' && !!slant.h.edge && sameDir(edgeDir(slant.h.edge), SLANT)).toBe(false);
        expect(chord.h).toMatchObject({ snap: 'parallel', trackFrom: T });
        for (const e of chord.h!.edge!) expect(Math.abs(Math.hypot(e[0]! - 100, e[1]! - 40) - R)).toBeLessThan(2e-3);
      }
      v.dispose();
    }
  });

  it('첫 점 나란한 방향: 기운 직선 뒤 G1 현을 지나가도 기준은 기운 직선(33차 꼴이면 현)', () => {
    const k = Math.round(N * 0.6);
    expect(sameDir(chordDir(k), SLANT)).toBe(false);
    for (const old of [false, true]) {
      const { v, hover, click } = setup(old);
      click(FIRST);
      expect(v.measurePointCount).toBe(1);
      hover([20.07, 10.08, 0]);
      hover(chordMid(k));
      const slant = hover(along(FIRST, SLANT, 15));
      const chord = hover(along(FIRST, chordDir(k), 15));
      if (!old) {
        expect(slant.h).toMatchObject({ snap: 'parallel' });
        expect(slant.h!.trackFrom).toBeUndefined();
        expect(sameDir(edgeDir(slant.h!.edge!), SLANT)).toBe(true);
        expect(slant.tip).toBe('나란한 방향');
        expect(chord.h?.snap === 'parallel' && !!chord.h.edge && sameDir(edgeDir(chord.h.edge), chordDir(k))).toBe(false);
      } else {
        expect(chord.h).toMatchObject({ snap: 'parallel' });
        for (const e of chord.h!.edge!) expect(Math.abs(Math.hypot(e[0]! - 100, e[1]! - 40) - R)).toBeLessThan(2e-3);
      }
      v.dispose();
    }
  });

  it('곧은 이동만 지나가면 전·후가 같다', () => {
    const got = [false, true].map((old) => {
      const { v, hover } = setup(old);
      v.setMeasureTrackPoints([T]);
      hover([20.07, 10.08, 0]);
      const rows = [10, 20, 30].flatMap((t) => [hover(along(T, SLANT, t)), hover(along(T, [-1, 2, 0], t))]).map((x) => ({ snap: x.h?.snap ?? null, p: x.h?.point.map((q) => Math.round(q * 1e6) / 1e6) ?? null, tip: x.tip }));
      v.dispose();
      return rows;
    });
    expect(got[0]).toEqual(got[1]);
    expect(got[0]!.filter((x) => x.snap === 'parallel' || x.snap === 'perpendicular').length).toBeGreaterThan(2);
  });
});
